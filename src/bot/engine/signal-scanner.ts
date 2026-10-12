import {
    MarketCategory,
    PerformanceSnapshot,
    RiskLimits,
    RiskState,
    SyntheticSymbol,
    TradeRecord,
} from '../core/types';
import {
    ACTION_LABEL,
    ACTION_CONTRACT_TYPE,
    ContractFamily,
    MarketScan,
    ScannerEvent,
    ScannerEventType,
    ScannerStatus,
    Signal,
    SignalAction,
    SignalScannerConfig,
} from '../core/signal-types';
import {
    evenOddPercent,
    leastFrequentDigit,
    matchDifferPercent,
    mostFrequentDigit,
    overUnderPercent,
    riseFallPercent,
    trendDirection,
} from '../core/signal-analysis';
import { computeRsi } from '../core/digit-stats';
import {
    MR_TRIGGER_THRESHOLD,
    MeanReversionPick,
    scanMeanReversion,
} from '../core/mean-reversion';
import {
    DEFAULT_RISK_LIMITS,
    applySettlement,
    initialRiskState,
} from '../core/risk';
import { computePerformance } from '../core/performance';
import { discoverSyntheticSymbols, detectSupportedFamilies } from '../deriv/discovery';
import { SymbolSeries, TickFeed } from '../deriv/ticks';
import {
    ContractRequest,
    ProposalQuote,
    applySettlementToRecord,
    executeBuyFresh,
    isMarketUnavailableError,
    monitorUntilSettled,
    requestContractQuote,
} from '../deriv/execution';
import { accountBalance, currentLoginId, getContractsFor, getTicksHistory, isApiReady, isAuthorized } from '../deriv/api';
import { isDemoAccount } from '@/utils/account-helpers';

export interface SignalScannerState {
    status: ScannerStatus;
    message: string;
    symbols: SyntheticSymbol[];
    markets: MarketScan[];
    signals: Signal[];
    trades: TradeRecord[];
    openTrade: TradeRecord | null;
    risk: RiskState;
    config: SignalScannerConfig;
    equity: number;
    accountIsDemo: boolean;
    liveTrading: boolean;
    events: ScannerEvent[];
    signalsGenerated: number;
    signalsExecuted: number;
}

export type ScannerListener = (state: SignalScannerState) => void;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export const DEFAULT_SIGNAL_CONFIG: SignalScannerConfig = {
    families: ['rise_fall', 'even_odd', 'over_under', 'mean_reversion'],
    sampleSize: 100,
    threshold: 58,
    overBarrier: 5,
    underBarrier: 4,
    matchDigit: 7,
    stake: 1,
    duration: 1,
    durationUnit: 't',
    maxStake: 5,
    maxDailyLoss: 20,
    maxConsecutiveLosses: 4,
    maxOpenPositions: 1,
    scanIntervalMs: 2000,
    minTicks: 60,
    autoTrade: true,
    allowLiveTrading: false,
    martingale: false,
    martingaleFactor: 2,
    martingaleMaxSteps: 3,
};

const EVENT_CAP = 240;
const PROBE_CONCURRENCY = 8;

const theoreticalOver = (barrier: number) => ((9 - barrier) / 10) * 100;
const theoreticalUnder = (barrier: number) => ((barrier + 1) / 10) * 100;

const confidenceAbove = (strength: number, baseline: number): number => {
    if (baseline >= 100) return 0;
    return clamp01((strength - baseline) / (100 - baseline));
};

export class SignalScannerEngine {
    private listeners = new Set<ScannerListener>();
    private feed: TickFeed | null = null;
    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private symbols: SyntheticSymbol[] = [];
    private familiesBySymbol = new Map<string, ContractFamily[]>();
    private quoteBlocked = new Set<string>();
    private busy = false;
    private running = false;
    private lastTradeAt = 0;
    private authWarned = false;
    private eventSeq = 0;
    private martingaleStep = 0;
    private state: SignalScannerState;

    constructor() {
        this.state = {
            status: 'idle',
            message: 'Idle',
            symbols: [],
            markets: [],
            signals: [],
            trades: [],
            openTrade: null,
            risk: initialRiskState(0),
            config: { ...DEFAULT_SIGNAL_CONFIG },
            equity: 0,
            accountIsDemo: true,
            liveTrading: false,
            events: [],
            signalsGenerated: 0,
            signalsExecuted: 0,
        };
    }

    subscribe = (listener: ScannerListener): (() => void) => {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    };

    getState = (): SignalScannerState => this.state;

    private update(patch: Partial<SignalScannerState>) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach(l => l(this.state));
    }

    private setStatus(status: ScannerStatus, message: string) {
        this.update({ status, message });
    }

    logEvent(type: ScannerEventType, message: string, extra: Partial<ScannerEvent> = {}) {
        const event: ScannerEvent = {
            id: `s${++this.eventSeq}-${Date.now()}`,
            at: Date.now(),
            type,
            message,
            ...extra,
        };
        const events = [event, ...this.state.events].slice(0, EVENT_CAP);
        this.update({ events });
    }

    configure(config: Partial<SignalScannerConfig>) {
        this.update({ config: { ...this.state.config, ...config } });
    }

    setLiveTrading(enabled: boolean) {
        this.update({ liveTrading: enabled });
        this.configure({ allowLiveTrading: enabled });
    }

    getPerformance(): PerformanceSnapshot {
        return computePerformance(this.state.trades);
    }

    private seedFromHistory(symbol: string, pipSize: number, prices: number[]) {
        this.feed?.seed(symbol, pipSize, prices);
    }

    async start(config?: Partial<SignalScannerConfig>): Promise<void> {
        if (this.running) return;
        if (config) this.configure(config);

        if (!isApiReady()) {
            this.setStatus('error', 'Connecting to Deriv market data… try again in a moment.');
            this.logEvent('error', 'Not connected to Deriv yet. Log in (or wait for the connection) and try again.');
            return;
        }

        // Discovery, signals and quotes run on public endpoints (no login required).
        // Auto-trade execution is gated on authorization at buy time.
        const authorized = isAuthorized();
        const loginid = authorized ? currentLoginId() : '';
        const accountIsDemo = authorized ? isDemoAccount(loginid) : false;
        const cfg = this.state.config;
        if (authorized && !accountIsDemo && !cfg.allowLiveTrading) {
            this.update({ accountIsDemo, liveTrading: false });
            this.setStatus('suspended', 'Live trading disabled on a real account. Enable Live trading to place real orders.');
            this.logEvent('risk', 'Real account: enable Live trading to place real orders.');
            return;
        }

        this.running = true;
        this.lastTradeAt = 0;
        this.martingaleStep = 0;
        this.authWarned = false;
        this.update({ accountIsDemo, liveTrading: authorized ? cfg.allowLiveTrading : false, equity: accountBalance() });
        this.logEvent(
            'status',
            authorized
                ? `Scanner starting on ${accountIsDemo ? 'DEMO' : 'REAL'} account (${loginid}).`
                : 'Scanner starting in signals-only mode. Log in to your Deriv account to enable auto-trade.'
        );

        this.setStatus('discovering', 'Discovering synthetic markets…');
        let symbols: SyntheticSymbol[];
        try {
            symbols = await discoverSyntheticSymbols();
        } catch (e: any) {
            this.running = false;
            this.setStatus('error', e?.message || 'Market discovery failed');
            this.logEvent('error', e?.message || 'Market discovery failed');
            return;
        }
        symbols = symbols.filter(s => !s.isSuspended && s.exchangeIsOpen).slice(0, 40);

        // Probe contract availability before choosing scan targets. Symbols are sorted
        // by category, so the first entries are Boom/Crash indices that often expose only
        // accumulator/multiplier contracts. Keep markets that can actually trade at least
        // one configured family, otherwise the scanner watches markets it can never signal.
        const neededFamilies = new Set(cfg.families);
        const candidates = symbols;
        const probed: { s: SyntheticSymbol; fams: ContractFamily[] }[] = [];
        for (let i = 0; i < candidates.length; i += PROBE_CONCURRENCY) {
            const batch = candidates.slice(i, i + PROBE_CONCURRENCY);
            const resolved = await Promise.all(
                batch.map(async s => {
                    let fams: ContractFamily[] = [];
                    try {
                        fams = detectSupportedFamilies(await getContractsFor(s.symbol));
                    } catch {
                        fams = [];
                    }
                    // Mean reversion trades DIGITOVER / DIGITUNDER contracts, so
                    // any market offering over/under can run the MR strategy.
                    if (fams.includes('over_under')) fams = [...fams, 'mean_reversion'];
                    this.familiesBySymbol.set(s.symbol, fams);
                    return { s, fams };
                })
            );
            probed.push(...resolved);
        }
        const watch = probed.filter(p => p.fams.some(f => neededFamilies.has(f))).map(p => p.s);
        if (!watch.length) {
            this.running = false;
            const fams = [...neededFamilies].join(', ') || 'configured';
            this.setStatus('error', `No market offers ${fams} contracts. Adjust the families or symbols.`);
            this.logEvent('error', `Market discovery found no market offering ${fams} contracts.`);
            return;
        }
        this.symbols = watch;
        this.update({ symbols: watch });

        this.setStatus('warming', `Warming up ${watch.length} markets…`);
        this.feed = new TickFeed({
            onTick: (symbol, _point, series) => this.onTick(symbol, series),
        });
        this.feed.setSymbols(watch.map(s => s.symbol));

        // Seed digit history in parallel (family availability was resolved above).
        await Promise.all(
            watch.map(async s => {
                try {
                    const hist = await getTicksHistory(s.symbol, Math.max(cfg.sampleSize, cfg.minTicks) + 20);
                    const prices: number[] = hist?.history?.prices?.map((p: any) => Number(p)) || [];
                    this.seedFromHistory(s.symbol, s.pipSize, prices.filter((p) => Number.isFinite(p)));
                } catch {
                    // history warm-up is best-effort
                }
            })
        );

        this.feed.start();
        this.update({ equity: accountBalance(), risk: initialRiskState(accountBalance()) });
        const famCount = new Set([...this.familiesBySymbol.values()].flat()).size;
        this.logEvent('discover', `Scanning ${watch.length} markets across ${famCount || cfg.families.length} contract families.`);
        this.setStatus('scanning', 'Scanning markets for signals…');
        this.scanTimer = setInterval(() => this.scan(), cfg.scanIntervalMs);
        this.scan();
    }

    stop() {
        const wasRunning = this.running;
        this.running = false;
        if (this.scanTimer) clearInterval(this.scanTimer);
        this.scanTimer = null;
        if (this.feed) this.feed.stop();
        this.feed = null;
        if (this.state.status !== 'stopped') this.setStatus('idle', 'Stopped');
        if (wasRunning) this.logEvent('status', 'Scanner stopped.');
    }

    emergencyStop() {
        this.stop();
        this.update({ status: 'stopped', message: 'Emergency stop engaged', openTrade: null });
        this.logEvent('risk', 'Emergency stop engaged — all activity halted.');
    }

    resumeAfterSuspend() {
        this.update({ risk: initialRiskState(accountBalance()) });
        this.setStatus('scanning', 'Risk reset. Resumed.');
        this.logEvent('risk', 'Risk reset. Scanning resumed.');
    }

    private onTick(symbol: string, series: SymbolSeries) {
        void series;
        void symbol;
    }

    private currentStake(): number {
        const cfg = this.state.config;
        if (!cfg.martingale) return cfg.stake;
        let stake = cfg.stake;
        for (let i = 0; i < this.martingaleStep; i++) stake *= cfg.martingaleFactor;
        return Math.min(stake, cfg.maxStake);
    }

    private buildMarketScan(symbol: string, series: SymbolSeries): MarketScan | null {
        const cfg = this.state.config;
        const digits = series.digits.slice(-cfg.sampleSize);
        const quotes = series.quotes.slice(-cfg.sampleSize);
        if (digits.length < cfg.minTicks) return null;
        const meta = this.symbols.find(s => s.symbol === symbol);
        const eo = evenOddPercent(digits);
        const ouOver = overUnderPercent(digits, cfg.overBarrier);
        const ouUnder = overUnderPercent(digits, cfg.underBarrier);
        const rf = riseFallPercent(quotes);
        const md = matchDifferPercent(digits, cfg.matchDigit);
        const most = mostFrequentDigit(digits);
        const least = leastFrequentDigit(digits);
        const rsi = computeRsi(quotes, 14);
        const trend = trendDirection(quotes);
        // Mean-reversion pick (signaltraker-style): full 10-tick window, 8
        // barriers, cluster override. Fires at >=85 strength (or the raised
        // user threshold, whichever is stricter).
        const mr = scanMeanReversion(digits, Math.max(cfg.threshold, MR_TRIGGER_THRESHOLD));
        const strongest = Math.max(
            eo.even,
            eo.odd,
            ouOver.over,
            ouUnder.under,
            rf.rise,
            rf.fall,
            mr?.strength ?? 0
        );
        return {
            symbol,
            displayName: meta?.displayName || symbol,
            category: meta?.category || ('other' as MarketCategory),
            sampleSize: digits.length,
            lastQuote: quotes[quotes.length - 1] ?? 0,
            even: eo.even,
            odd: eo.odd,
            over: ouOver.over,
            under: ouUnder.under,
            overBarrier: cfg.overBarrier,
            rise: rf.rise,
            fall: rf.fall,
            match: md.match,
            differ: md.differ,
            matchDigit: cfg.matchDigit,
            mostFreqDigit: most,
            leastFreqDigit: least,
            rsi,
            trend,
            strongest,
            stale: series.stale,
            meanReversion: mr,
        };
    }

    private signalsFromMarket(scan: MarketScan): Signal[] {
        const cfg = this.state.config;
        const enabled = new Set(cfg.families);
        const out: Signal[] = [];
        const mk = (
            family: ContractFamily,
            action: SignalAction,
            strength: number,
            baseline: number,
            barrier: number | undefined,
            rationale: string
        ): void => {
            if (strength < cfg.threshold) return;
            const confidence = confidenceAbove(strength, baseline);
            out.push({
                id: `${scan.symbol}-${action}-${Date.now()}`,
                at: Date.now(),
                symbol: scan.symbol,
                displayName: scan.displayName,
                category: scan.category,
                family,
                action,
                contractType: ACTION_CONTRACT_TYPE[action],
                barrier,
                strength,
                confidence,
                sampleSize: scan.sampleSize,
                rationale,
            });
        };

        if (enabled.has('rise_fall')) {
            if (scan.rise >= scan.fall) mk('rise_fall', 'CALL', scan.rise, 50, undefined, `Rise ${scan.rise}% vs Fall ${scan.fall}% (EMA trend ${scan.trend})`);
            else mk('rise_fall', 'PUT', scan.fall, 50, undefined, `Fall ${scan.fall}% vs Rise ${scan.rise}% (EMA trend ${scan.trend})`);
        }
        if (enabled.has('even_odd')) {
            if (scan.even >= scan.odd) mk('even_odd', 'EVEN', scan.even, 50, undefined, `Even ${scan.even}% vs Odd ${scan.odd}%`);
            else mk('even_odd', 'ODD', scan.odd, 50, undefined, `Odd ${scan.odd}% vs Even ${scan.even}%`);
        }
        if (enabled.has('over_under')) {
            mk('over_under', 'OVER', scan.over, theoreticalOver(cfg.overBarrier), cfg.overBarrier, `Over ${cfg.overBarrier} at ${scan.over}% (base ${theoreticalOver(cfg.overBarrier).toFixed(0)}%)`);
            mk('over_under', 'UNDER', scan.under, theoreticalUnder(cfg.underBarrier), cfg.underBarrier, `Under ${cfg.underBarrier} at ${scan.under}% (base ${theoreticalUnder(cfg.underBarrier).toFixed(0)}%)`);
        }
        if (enabled.has('mean_reversion')) {
            const mr: MeanReversionPick | null | undefined = scan.meanReversion;
            if (mr) {
                const baseline = mr.kind === 'UNDER' ? theoreticalUnder(mr.barrier) : theoreticalOver(mr.barrier);
                mk('mean_reversion', mr.kind, mr.strength, baseline, mr.barrier, mr.rationale);
            }
        }
        if (enabled.has('match_differ')) {
            mk('match_differ', 'MATCH', scan.match, 10, cfg.matchDigit, `Match ${cfg.matchDigit} at ${scan.match}% (base 10%)`);
            mk('match_differ', 'DIFFER', scan.differ, 90, cfg.matchDigit, `Differ from ${cfg.matchDigit} at ${scan.differ}% (base 90%)`);
        }

        out.sort((a, b) => b.confidence * b.strength - a.confidence * a.strength);
        return out;
    }

    private riskAllows(stake: number): { ok: boolean; reason?: string } {
        const { risk, config } = this.state;
        const limits: RiskLimits = {
            ...DEFAULT_RISK_LIMITS,
            maxStake: config.maxStake,
            maxDailyLoss: config.maxDailyLoss,
            maxConsecutiveLosses: config.maxConsecutiveLosses,
            maxOpenPositions: config.maxOpenPositions,
        };
        if (risk.suspended) return { ok: false, reason: risk.suspensionReason || 'Suspended' };
        if (risk.openPositions >= limits.maxOpenPositions) return { ok: false, reason: 'Open position in progress' };
        if (risk.dailyPnl <= -limits.maxDailyLoss) return { ok: false, reason: 'Daily loss limit' };
        if (risk.consecutiveLosses >= limits.maxConsecutiveLosses) return { ok: false, reason: 'Consecutive loss limit' };
        if (stake > limits.maxStake) stake = limits.maxStake;
        if (stake > accountBalance() * limits.maxStakePctEquity) return { ok: false, reason: 'Stake exceeds equity cap' };
        return { ok: true };
    }

    private async scan() {
        if (!this.running || this.busy) return;
        if (this.state.status === 'suspended') return;
        this.busy = true;
        try {
            const cfg = this.state.config;
            const markets: MarketScan[] = [];
            const signals: Signal[] = [];
            for (const s of this.symbols) {
                const series = this.feed?.getSeries(s.symbol);
                if (!series) continue;
                const scan = this.buildMarketScan(s.symbol, series);
                if (!scan) continue;
                markets.push(scan);
                if (this.familiesBySymbol.get(s.symbol)?.length === 0) continue;
                if (this.quoteBlocked.has(s.symbol)) continue;
                signals.push(...this.signalsFromMarket(scan));
            }
            signals.sort((a, b) => b.confidence * b.strength - a.confidence * a.strength);
            const topSignals = signals.slice(0, 20);
            markets.sort((a, b) => b.strongest - a.strongest);
            this.update({
                markets: markets.slice(0, 30),
                signals: topSignals,
                signalsGenerated: this.state.signalsGenerated + (signals.length ? 1 : 0),
            });

            if (!this.running) return;
            if (!cfg.autoTrade) return;
            if (!isAuthorized()) {
                if (!this.authWarned) {
                    this.authWarned = true;
                    this.logEvent('status', 'Auto-trade is on — log in to your Deriv account to place orders.');
                }
                return;
            }
            if (this.state.risk.suspended) return;
            if (this.state.liveTrading === false && !this.state.accountIsDemo) return;

            const now = Date.now();
            if (now - this.lastTradeAt < cfg.scanIntervalMs) return;
            const best = topSignals[0];
            if (!best || best.confidence <= 0) return;

            const stake = this.currentStake();
            const gate = this.riskAllows(stake);
            if (!gate.ok) {
                this.setStatus('scanning', `Holding: ${gate.reason}`);
                this.logEvent('risk', `Holding: ${gate.reason}`);
                return;
            }
            this.lastTradeAt = now;
            await this.execute(best, stake);
        } catch (e: any) {
            this.setStatus('error', e?.message || 'Scan error');
            this.logEvent('error', e?.message || 'Scan error');
        } finally {
            this.busy = false;
        }
    }

    private async execute(signal: Signal, stake: number) {
        const cfg = this.state.config;
        // A brand-new proposal per order: Deriv refuses cached/stale proposal
        // ids by the time the buy lands (prices are short-lived).
        const quoteReq: ContractRequest = {
            symbol: signal.symbol,
            family: signal.family,
            action: signal.action,
            barrier: signal.barrier,
            amount: stake,
            duration: cfg.duration,
            durationUnit: cfg.durationUnit,
        };
        this.setStatus('proposing', `Requesting quote: ${signal.displayName} ${ACTION_LABEL[signal.action]}`);
        const { quote, error } = await requestContractQuote(quoteReq);
        if (!quote) {
            const detail = error || 'no quote';
            this.setStatus('scanning', `Quote failed: ${detail}. Skipping.`);
            this.logEvent('error', `Quote failed on ${signal.displayName} ${signal.action}: ${detail}`, {
                symbol: signal.symbol,
            });
            if (isMarketUnavailableError(detail)) {
                this.quoteBlocked.add(signal.symbol);
                this.logEvent(
                    'error',
                    `${signal.displayName} does not offer ${cfg.duration}${cfg.durationUnit} contracts - removing it from the scan.`,
                    { symbol: signal.symbol }
                );
            }
            return;
        }
        this.logEvent('quote', `Quote: ${signal.displayName} ${ACTION_LABEL[signal.action]} — payout ${quote.payout.toFixed(2)} (stake ${stake.toFixed(2)})`, { symbol: signal.symbol, action: signal.action });

        const record: TradeRecord = {
            id: `sig-${Date.now()}`,
            symbol: signal.symbol,
            displayName: signal.displayName,
            category: signal.category,
            contractType: signal.contractType as any,
            direction: signal.action === 'UNDER' || signal.action === 'PUT' ? 'under' : 'over',
            barrier: signal.barrier ?? 0,
            duration: cfg.duration,
            durationUnit: cfg.durationUnit,
            stake,
            payout: quote.payout,
            payoutRatio: stake > 0 ? quote.payout / stake : 0,
            empiricalProb: signal.strength / 100,
            expectedValue: 0,
            confidence: signal.confidence,
            stage: 'proposed',
            openedAt: Date.now(),
            simulated: false,
        };

        this.setStatus('buying', `Submitting order: ${signal.displayName} ${ACTION_LABEL[signal.action]}`);
        const buy = await executeBuyFresh(quote, stake, () => requestContractQuote(quoteReq));
        if (buy.error || buy.contractId === undefined) {
            this.update({ trades: [{ ...record, stage: 'rejected', error: buy.error, closedAt: Date.now() }, ...this.state.trades] });
            this.setStatus('scanning', `Order rejected: ${buy.error}`);
            this.logEvent('error', `Order rejected: ${buy.error}`, { symbol: signal.symbol });
            return;
        }
        const confirmed: TradeRecord = {
            ...record,
            stage: 'confirmed',
            contractId: buy.contractId,
            transactionId: buy.transactionId,
            stake: buy.buyPrice ?? stake,
        };
        this.update({
            trades: [confirmed, ...this.state.trades],
            openTrade: confirmed,
            risk: { ...this.state.risk, openPositions: this.state.risk.openPositions + 1, tradesThisSession: this.state.risk.tradesThisSession + 1 },
            signalsExecuted: this.state.signalsExecuted + 1,
        });
        this.logEvent('purchase', `Purchased #${buy.contractId}: ${signal.displayName} ${ACTION_LABEL[signal.action]} @ ${cfg.duration}${cfg.durationUnit}`, { symbol: signal.symbol, contractId: buy.contractId, action: signal.action });
        this.setStatus('monitoring', `Monitoring contract #${buy.contractId}…`);

        const meta = this.symbols.find(x => x.symbol === signal.symbol);
        const settlement = await monitorUntilSettled(buy.contractId, meta?.pipSize ?? 2);
        if ('error' in settlement) {
            this.setStatus('scanning', `Settlement pending: ${settlement.error}`);
            this.logEvent('error', `Settlement pending for #${buy.contractId}: ${settlement.error}`, { contractId: buy.contractId });
            return;
        }
        const settled = applySettlementToRecord(confirmed, settlement);
        const remaining = this.state.trades.filter(t => t.id !== confirmed.id);
        const trades = [settled, ...remaining];
        const equity = accountBalance();
        const limits: RiskLimits = {
            ...DEFAULT_RISK_LIMITS,
            maxStake: cfg.maxStake,
            maxDailyLoss: cfg.maxDailyLoss,
            maxConsecutiveLosses: cfg.maxConsecutiveLosses,
            maxOpenPositions: cfg.maxOpenPositions,
        };
        const risk = applySettlement(this.state.risk, settled, equity, limits);
        this.update({ trades, openTrade: null, equity, risk });
        if (cfg.martingale) {
            if (settled.result === 'loss') this.martingaleStep = Math.min(this.martingaleStep + 1, cfg.martingaleMaxSteps);
            else this.martingaleStep = 0;
        }
        this.logEvent(
            'settlement',
            `${settled.result === 'win' ? 'WIN' : 'LOSS'}: #${buy.contractId} ${signal.displayName} ${ACTION_LABEL[signal.action]} — ${settled.profit >= 0 ? '+' : ''}${settled.profit.toFixed(2)}`,
            { symbol: signal.symbol, contractId: buy.contractId, action: signal.action, result: settled.result, profit: settled.profit }
        );
        if (risk.suspended) {
            this.setStatus('suspended', risk.suspensionReason || 'Risk limit reached');
            this.logEvent('risk', `Suspended: ${risk.suspensionReason}`);
        } else {
            this.setStatus('scanning', `Settled ${settled.result}. Scanning…`);
        }
    }
}

export const signalScanner = new SignalScannerEngine();
