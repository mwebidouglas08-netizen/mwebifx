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
    settlementTimeoutMs,
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
    autoTradeBlock: string | null;
    signalsGenerated: number;
    signalsExecuted: number;
}

export type ScannerListener = (state: SignalScannerState) => void;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export const DEFAULT_SIGNAL_CONFIG: SignalScannerConfig = {
    families: ['rise_fall', 'even_odd', 'over_under', 'mean_reversion'],
    sampleSize: 100,
    threshold: 58,
    // Over 2 / Under 7 sit at a 70% theoretical base, so a >=58% reading is a
    // genuine skew rather than noise — signals fire continuously across the
    // watched markets instead of starving at near-impossible barriers.
    overBarrier: 2,
    underBarrier: 7,
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
    autoTrade: false,
    allowLiveTrading: false,
    paperTrading: false,
    martingale: false,
    martingaleFactor: 2,
    martingaleMaxSteps: 3,
};

const EVENT_CAP = 240;
const PROBE_CONCURRENCY = 8;
/** Nominal bankroll used for paper trading (no real account balance). */
const PAPER_START_EQUITY = 1000;
/** Deriv's minimum order stake — the equity cap never blocks a trade this small. */
const MIN_ORDER_STAKE = 0.35;

const theoreticalOver = (barrier: number) => ((9 - barrier) / 10) * 100;
// DIGITUNDER(barrier) wins on digits 0..barrier-1 — `barrier` buckets, not barrier+1.
const theoreticalUnder = (barrier: number) => (barrier / 10) * 100;

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
    private eventSeq = 0;
    private martingaleStep = 0;
    private tickWaiters = new Map<string, Array<(digit: number, quote: number) => void>>();
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
            autoTradeBlock: null,
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

    private setAutoTradeBlock(reason: string | null, logChange = true) {
        if ((this.state.autoTradeBlock ?? null) === (reason ?? null)) return;
        this.update({ autoTradeBlock: reason });
        if (reason && logChange) this.logEvent('status', `Auto-trade paused — ${reason}`);
    }

    configure(config: Partial<SignalScannerConfig>) {
        this.update({ config: { ...this.state.config, ...config } });
    }

    setLiveTrading(enabled: boolean) {
        this.update({ liveTrading: enabled });
        this.configure({ allowLiveTrading: enabled });
        // Self-heal: while discovery is still running the scan loop hasn't
        // re-evaluated gates yet, so clear the live-off hold immediately —
        // the next scan re-arms it only if live trading is truly still off.
        if (
            enabled &&
            this.state.autoTradeBlock === 'live trading is off — switch on Live trading to place real orders'
        ) {
            this.setAutoTradeBlock(null);
        }
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
        // A real account without Live trading must keep running: paper mode and
        // signals-only scanning are safe, and the per-scan gate holds real
        // orders (surfaced on the auto-trade chip) until Live trading is on.
        // Terminating with status 'suspended' here previously froze paper mode
        // too and never self-healed when Live trading was later enabled.
        const liveOff = authorized && !accountIsDemo && !cfg.allowLiveTrading;

        this.running = true;
        this.lastTradeAt = 0;
        this.martingaleStep = 0;
        this.setAutoTradeBlock(null);
        // Paper and live bankrolls must never mix: paper always runs on the
        // nominal virtual bankroll (even when logged in — stacking simulated
        // P/L on the real balance produced "equity" figures that matched no
        // account), live always reads the real balance.
        const startEquity = cfg.paperTrading ? PAPER_START_EQUITY : authorized ? accountBalance() : 0;
        this.update({
            accountIsDemo,
            liveTrading: authorized ? cfg.allowLiveTrading : false,
            equity: startEquity,
            risk: initialRiskState(startEquity),
        });
        this.logEvent(
            'status',
            cfg.paperTrading
                ? authorized
                    ? `Scanner starting in PAPER-TRADING mode (simulated fills, ${PAPER_START_EQUITY} virtual bankroll) — your real ${accountIsDemo ? 'demo' : 'real'} balance is untouched.`
                    : `Scanner starting in PAPER-TRADING mode (simulated fills settled on real ticks, ${PAPER_START_EQUITY} virtual bankroll).`
                : authorized
                  ? `Scanner starting on ${accountIsDemo ? 'DEMO' : 'REAL'} account (${loginid}).`
                  : 'Scanner starting in signals-only mode. Log in to auto-trade.'
        );
        if (liveOff) {
            this.logEvent('risk', 'Real account: enable Live trading to place real orders.');
            if (cfg.autoTrade && !cfg.paperTrading) {
                this.setAutoTradeBlock('live trading is off — switch on Live trading to place real orders', false);
            }
        }

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
        // Always apply the probed pipSize — even when history fails, the series must
        // use the market's real pip size or digits go degenerate (e.g. pipSize 2
        // on a 0.1-pip market yields a constant digit 0 → fake "Even 100%").
        await Promise.all(
            watch.map(async s => {
                let prices: number[] = [];
                try {
                    const hist = await getTicksHistory(s.symbol, Math.max(cfg.sampleSize, cfg.minTicks) + 20);
                    prices = hist?.history?.prices?.map((p: any) => Number(p)) || [];
                } catch {
                    // history warm-up is best-effort
                }
                this.seedFromHistory(s.symbol, s.pipSize, prices.filter((p) => Number.isFinite(p)));
            })
        );

        this.feed.start();
        this.update({ equity: this.currentEquity(), risk: initialRiskState(this.currentEquity()) });
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
        this.setAutoTradeBlock(null);
    }

    emergencyStop() {
        this.stop();
        this.update({ status: 'stopped', message: 'Emergency stop engaged', openTrade: null });
        this.logEvent('risk', 'Emergency stop engaged — all activity halted.');
    }

    resumeAfterSuspend() {
        this.update({ risk: initialRiskState(this.currentEquity()) });
        this.setStatus('scanning', 'Risk reset. Resumed.');
        this.logEvent('risk', 'Risk reset. Scanning resumed.');
        this.setAutoTradeBlock(null);
    }

    /** Paper: the tracked virtual bankroll. Live: always the REAL balance —
     *  never a stale cache (the balance stream moves it on every buy/sell). */
    private currentEquity(): number {
        if (this.state.config.paperTrading) {
            return this.state.equity > 0 ? this.state.equity : PAPER_START_EQUITY;
        }
        const live = accountBalance();
        return live > 0 ? live : this.state.equity;
    }

    private onTick(symbol: string, series: SymbolSeries) {
        const waiters = this.tickWaiters.get(symbol);
        if (waiters && waiters.length) {
            const last = series.digits[series.digits.length - 1];
            const quote = series.quotes[series.quotes.length - 1];
            this.tickWaiters.delete(symbol);
            waiters.forEach(cb => cb(last, quote));
        }
    }

    /** Resolve on the next real tick for `symbol`, or reject after `timeoutMs`. */
    private waitForNextTick(symbol: string, timeoutMs = 10000): Promise<{ digit: number; quote: number }> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const list = this.tickWaiters.get(symbol) || [];
                this.tickWaiters.set(symbol, list.filter(cb => cb !== handler));
                reject(new Error(`No tick for ${symbol} within ${timeoutMs}ms`));
            }, timeoutMs);
            const handler = (digit: number, quote: number) => {
                clearTimeout(timer);
                resolve({ digit, quote });
            };
            const list = this.tickWaiters.get(symbol) || [];
            list.push(handler);
            this.tickWaiters.set(symbol, list);
        });
    }

    private currentStake(): number {
        const cfg = this.state.config;
        let stake = cfg.stake;
        if (cfg.martingale) {
            for (let i = 0; i < this.martingaleStep; i++) stake *= cfg.martingaleFactor;
        }
        stake = Math.min(stake, cfg.maxStake);
        // Shrink the stake to fit the equity cap, but never below Deriv's minimum
        // so small accounts still trade instead of being blocked outright.
        const equity = this.currentEquity();
        if (equity > 0) {
            const cap = equity * DEFAULT_RISK_LIMITS.maxStakePctEquity;
            stake = Math.min(stake, Math.max(cap, MIN_ORDER_STAKE));
        }
        return stake;
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
        // Restrict to families THIS symbol actually offers (probed at start-up).
        // Config families alone would signal e.g. Even/Odd on Step Index 200,
        // which Deriv only sells CALL/PUT on — a signal that can never be bought.
        const supported = this.familiesBySymbol.get(scan.symbol);
        const enabled = new Set(supported && supported.length ? supported.filter(f => cfg.families.includes(f)) : cfg.families);
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
        // Equity cap only applies when we actually know the equity, and never
        // blocks Deriv's minimum stake. Paper/pre-auth states have no balance,
        // so skip the cap there instead of blocking every trade.
        const equity = this.currentEquity();
        if (equity > 0) {
            const cap = Math.max(equity * limits.maxStakePctEquity, MIN_ORDER_STAKE);
            if (stake > cap) {
                return { ok: false, reason: 'Stake exceeds equity cap' };
            }
        }
        return { ok: true };
    }

    private async scan() {
        if (!this.running || this.busy) return;
        if (this.state.status === 'suspended') {
            if (this.state.config.autoTrade) this.setAutoTradeBlock(`suspended — ${this.state.message}`);
            return;
        }
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
            if (!cfg.autoTrade) {
                this.setAutoTradeBlock(null);
                return;
            }
            const paper = cfg.paperTrading;
            if (!paper && !isAuthorized()) {
                this.setAutoTradeBlock('not logged in — log in to your Deriv account, or enable Paper trading');
                return;
            }
            if (this.state.risk.suspended) {
                this.setAutoTradeBlock(`suspended — ${this.state.risk.suspensionReason || 'risk limit reached'}`);
                return;
            }
            // Re-evaluate the ACTIVE account at trade time: the login can
            // switch after start(), and a demo snapshot must never authorize
            // orders on a real account (or vice versa).
            const activeLogin = currentLoginId();
            const activeIsDemo = activeLogin ? isDemoAccount(activeLogin) : this.state.accountIsDemo;
            if (activeIsDemo !== this.state.accountIsDemo) {
                this.update({ accountIsDemo: activeIsDemo });
                this.logEvent('status', `Active account switched to ${activeIsDemo ? 'DEMO' : 'REAL'} (${activeLogin || 'no session'}) — execution gate re-evaluated.`);
            }
            if (!paper && this.state.liveTrading === false && !activeIsDemo) {
                this.setAutoTradeBlock('live trading is off — switch on Live trading to place real orders');
                return;
            }

            const now = Date.now();
            if (now - this.lastTradeAt < cfg.scanIntervalMs) return;
            // Try the strongest signals in order: if one can't be quoted (market
            // closed, contract unavailable), fall through to the next candidate
            // instead of losing the whole scan cycle to a single failure.
            const candidates = topSignals.filter(s => s.confidence > 0 && !this.quoteBlocked.has(s.symbol)).slice(0, 3);
            if (!candidates.length) {
                if (topSignals.length) this.setAutoTradeBlock('signals shown, but none clear the confidence gate');
                else this.setAutoTradeBlock(null);
                return;
            }

            const stake = this.currentStake();
            const gate = this.riskAllows(stake);
            if (!gate.ok) {
                this.setStatus('scanning', `Holding: ${gate.reason}`);
                this.logEvent('risk', `Holding: ${gate.reason}`);
                this.setAutoTradeBlock(`holding — ${gate.reason}`, false);
                return;
            }
            this.lastTradeAt = now;
            let placedAny = false;
            for (const candidate of candidates) {
                if (!this.running) break;
                const placed = await this.execute(candidate, stake);
                if (placed) {
                    placedAny = true;
                    break;
                }
                if (this.state.risk.suspended) break;
            }
            if (placedAny) this.setAutoTradeBlock(null);
            else if (this.state.risk.suspended) {
                this.setAutoTradeBlock(`suspended — ${this.state.risk.suspensionReason || 'risk limit reached'}`);
            } else this.setAutoTradeBlock('order attempts failed — check Live activity for quote/buy errors', false);
        } catch (e: any) {
            this.setStatus('error', e?.message || 'Scan error');
            this.logEvent('error', e?.message || 'Scan error');
        } finally {
            this.busy = false;
        }
    }

    /** Returns true when an order (real or paper) was actually placed. */
    private async execute(signal: Signal, stake: number): Promise<boolean> {
        const cfg = this.state.config;

        // Paper trading is a simulation: it settles on the next real tick using an
        // estimated payout. It must NOT depend on a live broker quote, which
        // requires an authorized session (unavailable in paper mode) and would
        // otherwise fail on markets the public socket can't price.
        if (cfg.paperTrading) {
            const ratio = estimatePayoutRatio(signal.strength);
            this.logEvent(
                'quote',
                `PAPER quote (estimated): ${signal.displayName} ${ACTION_LABEL[signal.action]} — ~${ratio.toFixed(2)}x (stake ${stake.toFixed(2)})`,
                { symbol: signal.symbol, action: signal.action }
            );
            await this.executePaper(signal, stake, { payout: stake * ratio });
            return true;
        }

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
            if (this.running) this.setStatus('scanning', `Quote failed: ${detail}. Skipping.`);
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
            return false;
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
            if (this.running) this.setStatus('scanning', `Order rejected: ${buy.error}`);
            this.logEvent('error', `Order rejected: ${buy.error}`, { symbol: signal.symbol });
            return false;
        }
        const confirmedStake = buy.buyPrice ?? stake;
        const confirmedPayout = buy.payout ?? quote.payout;
        const confirmed: TradeRecord = {
            ...record,
            stage: 'confirmed',
            contractId: buy.contractId,
            transactionId: buy.transactionId,
            stake: confirmedStake,
            payout: confirmedPayout,
            payoutRatio: confirmedStake > 0 ? confirmedPayout / confirmedStake : record.payoutRatio,
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
        const settlement = await monitorUntilSettled(
            buy.contractId,
            meta?.pipSize ?? 2,
            undefined,
            settlementTimeoutMs(cfg.duration, cfg.durationUnit)
        );
        if ('error' in settlement) {
            // Outcome unknown past the duration-aware window: keep the record
            // unsettled (never counted as a win or loss), release the open-position
            // slot so the scanner is not permanently stuck behind its own risk
            // gate, and say so plainly. Martingale is NOT advanced — the result
            // is unknown, so neither win nor loss logic may run.
            const unresolved: TradeRecord = { ...confirmed, error: settlement.error, closedAt: Date.now() };
            const remaining = this.state.trades.filter(t => t.id !== confirmed.id);
            this.update({
                trades: [unresolved, ...remaining],
                openTrade: null,
                risk: { ...this.state.risk, openPositions: Math.max(0, this.state.risk.openPositions - 1) },
            });
            if (this.running) this.setStatus('scanning', `Settlement unknown: ${settlement.error}`);
            this.logEvent('error', `Settlement unknown for #${buy.contractId}: ${settlement.error} — outcome not recorded, position slot released`, { contractId: buy.contractId });
            return true;
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
        if (risk.suspended) this.logEvent('risk', `Suspended: ${risk.suspensionReason}`);
        // A stop mid-contract must not be overwritten by the late settlement
        // status — otherwise the UI shows a ghost 'scanning' with no scan timer.
        if (this.running) {
            if (risk.suspended) this.setStatus('suspended', risk.suspensionReason || 'Risk limit reached');
            else this.setStatus('scanning', `Settled ${settled.result}. Scanning…`);
        }
        return true;
    }

    /** Paper trade: real live quote + real next-tick settlement, but no real order. */
    private async executePaper(signal: Signal, stake: number, quote: { payout: number }) {
        const cfg = this.state.config;
        const id = `paper-${Date.now()}`;
        const record: TradeRecord = {
            id,
            symbol: signal.symbol,
            displayName: signal.displayName,
            category: signal.category,
            contractType: signal.contractType as any,
            direction: signal.action === 'UNDER' || signal.action === 'PUT' ? 'under' : 'over',
            barrier: signal.barrier ?? 0,
            duration: 1,
            durationUnit: 't',
            stake,
            payout: quote.payout,
            payoutRatio: stake > 0 ? quote.payout / stake : 0,
            empiricalProb: signal.strength / 100,
            expectedValue: 0,
            confidence: signal.confidence,
            stage: 'confirmed',
            openedAt: Date.now(),
            simulated: true,
        };
        this.update({
            trades: [record, ...this.state.trades],
            openTrade: record,
            signalsExecuted: this.state.signalsExecuted + 1,
        });
        this.logEvent(
            'purchase',
            `PAPER (no real order): ${signal.displayName} ${ACTION_LABEL[signal.action]} — awaiting next tick`,
            { symbol: signal.symbol, action: signal.action }
        );
        this.setStatus('monitoring', `Paper trade open on ${signal.symbol} — waiting for next tick…`);

        // Rise/fall paper trades settle on real quote movement: entry quote at
        // open vs the next tick's quote. A single digit cannot decide CALL/PUT,
        // so previously every paper rise/fall trade settled as a fabricated loss.
        const isRiseFall = signal.action === 'CALL' || signal.action === 'PUT';
        const entryQuote = this.feed?.getSeries(signal.symbol)?.quotes.slice(-1)[0];

        let tick: { digit: number; quote: number };
        try {
            tick = await this.waitForNextTick(signal.symbol, 15000);
        } catch (e: any) {
            this.update({ openTrade: null });
            if (this.running) this.setStatus('scanning', `Paper trade could not settle: ${e?.message}`);
            this.logEvent('error', `PAPER settle failed: ${e?.message}`, { symbol: signal.symbol });
            return;
        }

        let won: boolean;
        if (isRiseFall) {
            if (entryQuote === undefined || !Number.isFinite(entryQuote)) {
                // No entry quote means the move cannot be judged — record an
                // unsettled trade rather than inventing a loss.
                this.update({ openTrade: null });
                if (this.running) this.setStatus('scanning', 'Paper trade could not settle: no entry quote');
                this.logEvent('error', `PAPER settle failed: no entry quote for ${signal.symbol} — outcome not recorded`, { symbol: signal.symbol });
                return;
            }
            won = signal.action === 'CALL' ? tick.quote > entryQuote : tick.quote < entryQuote;
        } else {
            won = paperWon(signal.action, tick.digit, signal.barrier ?? 0);
        }
        const digit = tick.digit;
        const profit = won ? stake * (record.payoutRatio - 1) : -stake;
        const settled: TradeRecord = {
            ...record,
            stage: 'settled',
            exitDigit: digit,
            result: won ? 'win' : 'loss',
            profit,
            closedAt: Date.now(),
        };
        const remaining = this.state.trades.filter(t => t.id !== id);
        // Paper equity is carried internally (no account balance involved).
        const equity = this.state.equity + profit;
        const limits: RiskLimits = {
            ...DEFAULT_RISK_LIMITS,
            maxStake: cfg.maxStake,
            maxDailyLoss: cfg.maxDailyLoss,
            maxConsecutiveLosses: cfg.maxConsecutiveLosses,
            maxOpenPositions: cfg.maxOpenPositions,
        };
        const risk = applySettlement(this.state.risk, settled, equity, limits);
        this.update({ trades: [settled, ...remaining], openTrade: null, equity, risk });
        if (cfg.martingale) {
            if (settled.result === 'loss') this.martingaleStep = Math.min(this.martingaleStep + 1, cfg.martingaleMaxSteps);
            else this.martingaleStep = 0;
        }
        this.logEvent(
            'settlement',
            isRiseFall
                ? `PAPER ${settled.result === 'win' ? 'WIN' : 'LOSS'}: ${signal.displayName} ${ACTION_LABEL[signal.action]} — quote ${entryQuote!.toFixed(6)} → ${tick.quote.toFixed(6)} — ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} (simulated)`
                : `PAPER ${settled.result === 'win' ? 'WIN' : 'LOSS'}: ${signal.displayName} ${ACTION_LABEL[signal.action]} — exit digit ${digit} — ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} (simulated)`,
            { symbol: signal.symbol, action: signal.action, result: settled.result, profit }
        );
        if (risk.suspended) this.logEvent('risk', `Suspended: ${risk.suspensionReason}`);
        // Never let a late paper-settle overwrite the stopped status (ghost
        // 'scanning' with no timer disables Start until a reload).
        if (this.running) {
            if (risk.suspended) this.setStatus('suspended', risk.suspensionReason || 'Risk limit reached');
            else this.setStatus('scanning', `Paper settled ${settled.result}. Scanning…`);
        }
    }
}

/** Estimated payout ratio for a simulated (paper) digit trade. */
const estimatePayoutRatio = (strengthPct: number): number => {
    const p = Math.min(Math.max(strengthPct / 100, 0.1), 0.9);
    // Deriv keeps a small edge on digit contracts; ~0.95 effective is typical.
    return Math.min(Math.max(0.95 / p, 1.05), 2.0);
};

export const paperWon = (action: string, digit: number, barrier: number): boolean => {
    switch (action) {
        case 'OVER':
        case 'DIGITOVER':
            return digit > barrier;
        case 'UNDER':
        case 'DIGITUNDER':
            return digit < barrier;
        case 'EVEN':
            return digit % 2 === 0;
        case 'ODD':
            return digit % 2 === 1;
        case 'MATCH':
            return digit === barrier;
        case 'DIFFER':
            return digit !== barrier;
        default:
            // Rise/fall and unknown actions cannot be settled from a single digit.
            // Returning false here fabricated losses for every paper CALL/PUT —
            // callers must settle those on real quote movement instead.
            throw new Error(`paperWon cannot settle action "${action}" from a digit — settle rise/fall on quotes`);
    }
};

export const signalScanner = new SignalScannerEngine();
