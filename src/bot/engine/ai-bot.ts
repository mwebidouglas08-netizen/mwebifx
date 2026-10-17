import {
    MarketCategory,
    PerformanceSnapshot,
    RiskLimits,
    RiskState,
    SyntheticSymbol,
    TradeRecord,
} from '../core/types';
import {
    AIBotConfig,
    AIBotEvent,
    AIBotStatus,
    MarketAnalysis,
    PurchaseType,
    RuleMatch,
} from '../core/ai-bot-types';
import { buildMarketAnalysis, firstMatch } from '../core/ai-bot-rules';
import { ContractFamily } from '../core/signal-types';
import {
    DEFAULT_RISK_LIMITS,
    applySettlement,
    initialRiskState,
} from '../core/risk';
import { computePerformance } from '../core/performance';
import { discoverSyntheticSymbols, detectSupportedFamilies } from '../deriv/discovery';
import { SymbolSeries, TickFeed } from '../deriv/ticks';
import {
    ProposalQuote,
    applySettlementToRecord,
    executeBuyFresh,
    isMarketUnavailableError,
    monitorUntilSettled,
    requestSimpleQuote,
    settlementTimeoutMs,
} from '../deriv/execution';
import {
    accountBalance,
    currentLoginId,
    getContractsFor,
    getTicksHistory,
    isApiReady,
    isAuthorized,
} from '../deriv/api';
import { isDemoAccount } from '@/utils/account-helpers';
import { buildTradeOutcome, evaluateCandidate } from '../core/intelligent-execution';
import { voiceService } from '@/services/voice-service';
import { soundService } from '@/services/sound-service';

export interface AIBotState {
    status: AIBotStatus;
    message: string;
    config: AIBotConfig;
    analyses: MarketAnalysis[];
    symbols: SyntheticSymbol[];
    decision: {
        symbol: string;
        displayName: string;
        contractType: PurchaseType;
        prediction?: number;
        rationale: string;
        at: number;
    } | null;
    trades: TradeRecord[];
    openTrade: TradeRecord | null;
    risk: RiskState;
    equity: number;
    accountIsDemo: boolean;
    liveTrading: boolean;
    events: AIBotEvent[];
    stats: {
        scans: number;
        decisions: number;
        trades: number;
        wins: number;
        losses: number;
        netPnl: number;
    };
    usingRecovery: boolean;
}

export type AIBotListener = (state: AIBotState) => void;

const FAMILY_OF: Partial<Record<PurchaseType, ContractFamily>> = {
    DIGITOVER: 'over_under',
    DIGITUNDER: 'over_under',
    DIGITEVEN: 'even_odd',
    DIGITODD: 'even_odd',
    DIGITMATCH: 'match_differ',
    DIGITDIFF: 'match_differ',
    CALL: 'rise_fall',
    PUT: 'rise_fall',
};

const directionOf = (ct: PurchaseType): 'over' | 'under' =>
    ct === 'DIGITUNDER' || ct === 'PUT' ? 'under' : 'over';

export const DEFAULT_AI_BOT_CONFIG: AIBotConfig = {
    symbols: [],
    contractType: 'DIGITOVER',
    prediction: 2,
    analysisMode: 'pattern',
    scanMode: 'always',
    scanTradeCount: 3,
    rules: [
        { id: 'ai-r1', enabled: true, logic: 'if', analysisMode: 'pattern', analysisType: 'last_digits', count: 1, operator: 'less_or_equal', digit: 1, purchase: 'DIGITOVER', prediction: 2 },
        { id: 'ai-r2', enabled: true, logic: 'else_if', analysisMode: 'pattern', analysisType: 'last_digits', count: 1, operator: 'greater_or_equal', digit: 8, purchase: 'DIGITUNDER', prediction: 7 },
    ],
    recoveryEnabled: false,
    recoveryRules: [
        { id: 'ai-v1', enabled: true, logic: 'if', analysisMode: 'pattern', analysisType: 'all_even', count: 4, purchase: 'DIGITODD' },
        { id: 'ai-v2', enabled: true, logic: 'else_if', analysisMode: 'pattern', analysisType: 'all_odd', count: 4, purchase: 'DIGITEVEN' },
    ],
    recoveryContractType: 'DIGITODD',
    martingaleEnabled: true,
    martingaleMultiplier: 2,
    stake: 1,
    maxStake: 50,
    duration: 1,
    durationUnit: 't',
    stopLoss: 30,
    takeProfit: 10,
    maxTrades: 0,
    sampleSize: 50,
    minTicks: 20,
    autoTrade: false,
    allowLiveTrading: false,
    scanIntervalMs: 2000,
    confirmScans: 1,
};

const EVENT_CAP = 240;
const PROBE_CONCURRENCY = 8;
/** Deriv's minimum order stake — the equity cap never blocks a trade this small. */
const MIN_ORDER_STAKE = 0.35;

export class AIBotEngine {
    private listeners = new Set<AIBotListener>();
    private feed: TickFeed | null = null;
    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private symbols: SyntheticSymbol[] = [];
    private familiesBySymbol = new Map<string, ContractFamily[]>();
    private quoteBlocked = new Set<string>();
    /** symbol:contractType:barrier combos Deriv cannot price ("no return"). */
    private comboBlocked = new Set<string>();
    private busy = false;
    private running = false;
    private eventSeq = 0;
    private martingaleStep = 0;
    private confirmKey: string | null = null;
    private confirmCount = 0;
    private decisionCounter = 0;
    private lastTradeAt = 0;
    private state: AIBotState;

    constructor() {
        this.state = {
            status: 'idle',
            message: 'Idle',
            config: { ...DEFAULT_AI_BOT_CONFIG },
            analyses: [],
            symbols: [],
            decision: null,
            trades: [],
            openTrade: null,
            risk: initialRiskState(0),
            equity: 0,
            accountIsDemo: true,
            liveTrading: false,
            events: [],
            stats: { scans: 0, decisions: 0, trades: 0, wins: 0, losses: 0, netPnl: 0 },
            usingRecovery: false,
        };
    }

    subscribe = (listener: AIBotListener): (() => void) => {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    };

    getState = (): AIBotState => this.state;

    private update(patch: Partial<AIBotState>) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach(l => l(this.state));
    }

    private setStatus(status: AIBotStatus, message: string) {
        this.update({ status, message });
    }

    logEvent(type: AIBotEvent['type'], message: string, extra: Partial<AIBotEvent> = {}) {
        const event: AIBotEvent = {
            id: `ai${++this.eventSeq}-${Date.now()}`,
            at: Date.now(),
            type,
            message,
            ...extra,
        };
        const events = [event, ...this.state.events].slice(0, EVENT_CAP);
        this.update({ events });
    }

    configure(config: Partial<AIBotConfig>) {
        this.update({ config: { ...this.state.config, ...config } });
    }

    setLiveTrading(enabled: boolean) {
        this.update({ liveTrading: enabled });
        this.configure({ allowLiveTrading: enabled });
    }

    getPerformance(): PerformanceSnapshot {
        return computePerformance(this.state.trades);
    }

    private activeRules() {
        const cfg = this.state.config;
        return this.state.usingRecovery && cfg.recoveryEnabled && cfg.recoveryRules.length
            ? cfg.recoveryRules
            : cfg.rules;
    }

    private currentStake(): number {
        const cfg = this.state.config;
        if (!cfg.martingaleEnabled) return cfg.stake;
        let stake = cfg.stake;
        for (let i = 0; i < this.martingaleStep; i++) stake *= cfg.martingaleMultiplier;
        return Math.min(stake, cfg.maxStake);
    }

    async start(config?: Partial<AIBotConfig>): Promise<void> {
        if (this.running) return;
        if (config) this.configure(config);

        if (!isApiReady()) {
            this.setStatus('error', 'Connecting to Deriv market data… try again in a moment.');
            this.logEvent('error', 'Not connected to Deriv yet. Log in (or wait for the connection) and try again.');
            return;
        }

        // Market discovery, signals and quotes all run on Deriv public endpoints and
        // do not require a login. Only trade EXECUTION requires authorization, which is
        // enforced at buy time — so scanning works immediately for every user.
        const authorized = isAuthorized();
        const loginid = authorized ? currentLoginId() : '';
        const accountIsDemo = authorized ? isDemoAccount(loginid) : false;
        const cfg = this.state.config;
        // Keep scanning on a real account without Live trading: the per-scan
        // reason list holds real orders (surfaced in the panel message) until
        // Live trading is on — no terminal suspension.
        const liveOff = authorized && !accountIsDemo && !cfg.allowLiveTrading;

        this.running = true;
        this.martingaleStep = 0;
        this.confirmKey = null;
        this.confirmCount = 0;
        this.decisionCounter = 0;
        this.lastTradeAt = 0;
        soundService.play('botStart');
        this.update({
            accountIsDemo,
            liveTrading: authorized ? cfg.allowLiveTrading : false,
            equity: accountBalance(),
            usingRecovery: false,
            stats: { scans: 0, decisions: 0, trades: 0, wins: 0, losses: 0, netPnl: 0 },
            risk: initialRiskState(accountBalance()),
        });
        this.logEvent(
            'status',
            authorized
                ? `AI Bot starting on ${accountIsDemo ? 'DEMO' : 'REAL'} account (${loginid}).`
                : 'AI Bot starting in signals-only mode. Log in to your Deriv account to enable auto-trade.'
        );
        if (liveOff) this.logEvent('risk', 'Real account: enable Live trading to place real orders.');

        this.setStatus('starting', 'Discovering markets…');
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

        // Probe contract availability before choosing watch markets. Many synthetic
        // indices (Boom/Crash family) only expose accumulator + multiplier contracts and
        // offer no digit contracts, so watching them could never produce a tradable
        // signal — the rules would match and then be silently discarded. Only markets
        // that can actually trade one of the configured rule families are warmed.
        const neededFamilies = new Set(
            (this.activeRules().map(r => FAMILY_OF[r.purchase]).filter(Boolean) as ContractFamily[])
        );
        const configured = cfg.symbols.filter(s => symbols.some(x => x.symbol === s));
        const ordered = [
            ...symbols.filter(s => configured.includes(s.symbol)),
            ...symbols.filter(s => !configured.includes(s.symbol)),
        ];
        const candidates = ordered;
        const probed: { s: SyntheticSymbol; fams: ContractFamily[] }[] = [];
        // Bounded concurrency so every candidate is probed without bursting the API.
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
                    this.familiesBySymbol.set(s.symbol, fams);
                    return { s, fams };
                })
            );
            probed.push(...resolved);
        }
        const tradable = probed
            .filter(p => p.fams.length > 0 && (!neededFamilies.size || p.fams.some(f => neededFamilies.has(f))))
            .map(p => p.s);

        const watch = configured.length
            ? tradable.filter(s => configured.includes(s.symbol))
            : tradable.slice(0, 6);
        if (!watch.length) {
            this.running = false;
            const fams = [...neededFamilies].join(', ') || 'digit';
            this.setStatus('error', `No market offers ${fams} contracts. Choose different rules or symbols.`);
            this.logEvent('error', `Market discovery found no market offering ${fams} contracts.`);
            return;
        }
        this.symbols = watch;
        this.update({ symbols: watch });

        this.setStatus('starting', `Warming ${watch.length} markets…`);
        this.feed = new TickFeed({
            onTick: () => undefined,
        });
        this.feed.setSymbols(watch.map(s => s.symbol));

        await Promise.all(
            watch.map(async s => {
                if (!this.familiesBySymbol.has(s.symbol)) {
                    try {
                        this.familiesBySymbol.set(s.symbol, detectSupportedFamilies(await getContractsFor(s.symbol)));
                    } catch {
                        this.familiesBySymbol.set(s.symbol, []);
                    }
                }
                try {
                    const hist = await getTicksHistory(s.symbol, Math.max(cfg.sampleSize, cfg.minTicks) + 20);
                    const prices: number[] = hist?.history?.prices?.map((p: any) => Number(p)) || [];
                    this.feed?.seed(s.symbol, s.pipSize, prices.filter(p => Number.isFinite(p)));
                } catch {
                    // best-effort warm-up
                }
            })
        );

        this.feed.start();
        this.update({ equity: accountBalance() });
        this.logEvent('scan', `Scanning ${watch.length} markets with ${this.activeRules().length} purchase rules.`);
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
        if (wasRunning) {
            soundService.play('botStop');
            this.logEvent('status', 'AI Bot stopped.');
        }
    }

    emergencyStop() {
        this.stop();
        this.update({ status: 'stopped', message: 'Emergency stop engaged', openTrade: null });
        this.logEvent('risk', 'Emergency stop engaged — all activity halted.');
    }

    resetLimits() {
        this.martingaleStep = 0;
        this.update({
            risk: initialRiskState(accountBalance()),
            usingRecovery: false,
        });
        this.setStatus('scanning', 'Limits reset. Scanning resumed.');
        this.logEvent('risk', 'Stop-loss/take-profit reset. Resumed.');
    }

    private familySupported(symbol: string, ct: PurchaseType): boolean {
        const fam = FAMILY_OF[ct];
        if (!fam) return true;
        const list = this.familiesBySymbol.get(symbol);
        if (!list) return true; // unknown yet — allow
        return list.length === 0 ? false : list.includes(fam);
    }

    private buildAnalysis(s: SyntheticSymbol, series: SymbolSeries): MarketAnalysis | null {
        const cfg = this.state.config;
        const digits = series.digits;
        const quotes = series.quotes;
        if (digits.length < cfg.minTicks) return null;
        return buildMarketAnalysis(s.symbol, s.displayName, digits, quotes, cfg);
    }

    /** True when the session should stop for profit/loss/trade-count reasons. */
    private limitReason(): string | null {
        const cfg = this.state.config;
        const { stats } = this.state;
        if (cfg.maxTrades > 0 && stats.trades >= cfg.maxTrades) return `Max trades reached (${cfg.maxTrades})`;
        if (cfg.stopLoss > 0 && stats.netPnl <= -cfg.stopLoss) return `Stop loss hit (-${cfg.stopLoss})`;
        if (cfg.takeProfit > 0 && stats.netPnl >= cfg.takeProfit) return `Take profit reached (+${cfg.takeProfit})`;
        return null;
    }

    private async scan() {
        if (!this.running || this.busy) return;
        if (this.state.status === 'suspended' || this.state.status === 'stopped') return;
        this.busy = true;
        try {
            const cfg = this.state.config;
            const rules = this.activeRules();
            const analyses: MarketAnalysis[] = [];
            let chosen: { analysis: MarketAnalysis; match: RuleMatch } | null = null;

            for (const s of this.symbols) {
                const series = this.feed?.getSeries(s.symbol);
                if (!series) continue;
                const analysis = this.buildAnalysis(s, series);
                if (!analysis) continue;
                analyses.push(analysis);
                if (chosen) continue;
                const match = firstMatch(rules, series.digits, series.quotes, {
                    contractType: cfg.contractType,
                    prediction: cfg.prediction,
                });
                if (match && this.familySupported(s.symbol, match.contractType) && !this.quoteBlocked.has(s.symbol)) {
                    chosen = { analysis, match };
                }
            }

            const stats = { ...this.state.stats, scans: this.state.stats.scans + 1 };
            this.update({ analyses, stats });
            if (!chosen) {
                this.confirmKey = null;
                this.confirmCount = 0;
                if (this.state.message.startsWith('Holding:')) {
                    this.update({ message: 'Scanning markets for signals…' });
                }
                return;
            }

            const { analysis, match } = chosen;
            const prediction = match.prediction ?? cfg.prediction;
            this.update({
                decision: {
                    symbol: analysis.symbol,
                    displayName: analysis.displayName,
                    contractType: match.contractType,
                    prediction,
                    rationale: match.rationale,
                    at: Date.now(),
                },
            });

            // Confirmation window — require the same decision N scans in a row.
            const key = `${analysis.symbol}|${match.contractType}|${prediction}`;
            if (key === this.confirmKey) this.confirmCount++;
            else {
                this.confirmKey = key;
                this.confirmCount = 1;
            }

            const reasons: string[] = [];
            if (!cfg.autoTrade) reasons.push('auto-trade off');
            if (this.state.risk.suspended) reasons.push('risk suspended');
            if (this.confirmCount < cfg.confirmScans) reasons.push(`confirming ${this.confirmCount}/${cfg.confirmScans}`);
            if (cfg.scanMode === 'on_entry' && stats.trades > 0) reasons.push('on-entry only');
            if (cfg.scanMode === 'every_n') {
                this.decisionCounter++;
                if (this.decisionCounter % Math.max(1, cfg.scanTradeCount) !== 0) {
                    reasons.push(`every ${cfg.scanTradeCount} decisions`);
                }
            }
            const limit = this.limitReason();
            if (limit) {
                reasons.push(limit);
            }
            if (this.state.openTrade) reasons.push('position open');
            // Execution requires an authorized Deriv session; scanning/signals do not.
            if (!isAuthorized()) reasons.push('log in to auto-trade');
            else {
                // Re-evaluate the ACTIVE account at trade time — a demo snapshot
                // from start() must never authorize orders on a real account.
                const activeLogin = currentLoginId();
                const activeIsDemo = activeLogin ? isDemoAccount(activeLogin) : this.state.accountIsDemo;
                if (activeIsDemo !== this.state.accountIsDemo) {
                    this.update({ accountIsDemo: activeIsDemo });
                    this.logEvent('status', `Active account switched to ${activeIsDemo ? 'DEMO' : 'REAL'} (${activeLogin || 'no session'}) — execution gate re-evaluated.`);
                }
                if (this.state.liveTrading === false && !activeIsDemo) reasons.push('live trading off');
            }

            if (reasons.length) {
                const held = reasons.find(r => r !== 'auto-trade off');
                if (held) this.update({ message: `Holding: ${held}` });
                else if (reasons.includes('auto-trade off')) {
                    this.update({ message: 'Holding: auto-trade is off — enable Auto-trade to place orders' });
                }
                if (!reasons.includes('auto-trade off')) {
                    this.logEvent('decision', `${analysis.displayName}: ${match.rationale} — holding (${reasons[0]})`, {
                        symbol: analysis.symbol,
                        contractType: match.contractType,
                    });
                }
                if (limit) this.enterSuspended(limit);
                return;
            }

            const now = Date.now();
            if (now - this.lastTradeAt < cfg.scanIntervalMs) return;
            const stake = this.currentStake();
            const gate = this.riskAllows(stake);
            if (!gate.ok) {
                this.setStatus('scanning', `Holding: ${gate.reason}`);
                this.logEvent('risk', `Holding: ${gate.reason}`);
                return;
            }

            this.lastTradeAt = now;
            this.update({ stats: { ...stats, decisions: stats.decisions + 1 } });
            // Voice: the decision survived confirmation, risk and limit gates —
            // say so before the quote/order path runs.
            voiceService.announceSignal({
                bot: 'AI Bot',
                market: analysis.displayName,
                signal: match.contractType + (prediction !== undefined ? ` ${prediction}` : ''),
                strong: true,
                executed: false,
            });
            await this.execute(analysis, match, prediction, stake);
        } catch (e: any) {
            this.setStatus('error', e?.message || 'Scan error');
            this.logEvent('error', e?.message || 'Scan error');
        } finally {
            this.busy = false;
        }
    }

    private enterSuspended(reason: string) {
        this.setStatus('suspended', reason);
        this.logEvent('risk', `Suspended: ${reason}`);
    }

    private riskAllows(stake: number): { ok: boolean; reason?: string } {
        const { risk, config } = this.state;
        const limits: RiskLimits = {
            ...DEFAULT_RISK_LIMITS,
            maxStake: config.maxStake,
            maxDailyLoss: config.stopLoss || DEFAULT_RISK_LIMITS.maxDailyLoss,
            maxConsecutiveLosses: DEFAULT_RISK_LIMITS.maxConsecutiveLosses,
            maxOpenPositions: 1,
        };
        if (risk.suspended) return { ok: false, reason: risk.suspensionReason || 'Suspended' };
        if (risk.openPositions >= limits.maxOpenPositions) return { ok: false, reason: 'Open position in progress' };
        if (stake > limits.maxStake) stake = limits.maxStake;
        // Equity cap only applies when we know the balance, and never blocks Deriv's
        // minimum stake — a pre-auth/zero balance must not block every trade.
        const equity = accountBalance();
        if (equity > 0) {
            const cap = Math.max(equity * limits.maxStakePctEquity, MIN_ORDER_STAKE);
            if (stake > cap) return { ok: false, reason: 'Stake exceeds equity cap' };
        }
        return { ok: true };
    }

    private empiricalProb(analysis: MarketAnalysis, ct: PurchaseType): number {
        switch (ct) {
            case 'DIGITOVER': return analysis.over / 100;
            case 'DIGITUNDER': return analysis.under / 100;
            case 'DIGITEVEN': return analysis.even / 100;
            case 'DIGITODD': return analysis.odd / 100;
            case 'CALL': return analysis.rise / 100;
            case 'PUT': return analysis.fall / 100;
            default: return 0.1;
        }
    }

    private async execute(analysis: MarketAnalysis, match: RuleMatch, prediction: number, stake: number) {
        const cfg = this.state.config;
        const ct = match.contractType;
        const meta = this.symbols.find(s => s.symbol === analysis.symbol);
        const comboKey = `${analysis.symbol}:${ct}:${prediction ?? ''}`;
        if (this.comboBlocked.has(comboKey)) return;
        // A brand-new proposal per order: Deriv refuses cached proposal ids
        // (the price has moved by the time we buy), which showed up as
        // "Order rejected" on every attempt.
        const quoteReq = {
            symbol: analysis.symbol,
            contractType: ct,
            barrier: prediction,
            amount: stake,
            duration: cfg.duration,
            durationUnit: cfg.durationUnit,
        };
        this.setStatus('proposing', `Quote: ${analysis.displayName} ${ct}`);
        const { quote, error } = await requestSimpleQuote(quoteReq);
        if (!quote) {
            const detail = error || 'no quote';
            if (this.running) this.setStatus('scanning', `Quote failed: ${detail}. Skipping.`);
            this.logEvent('error', `Quote failed on ${analysis.displayName} ${ct}: ${detail}`, {
                symbol: analysis.symbol,
            });
            if (/no return/i.test(detail)) {
                this.comboBlocked.add(comboKey);
                this.logEvent(
                    'error',
                    `${analysis.displayName} ${ct}(${prediction ?? ''}) cannot profit at this barrier - skipping that combination`,
                    { symbol: analysis.symbol }
                );
            }
            if (isMarketUnavailableError(detail)) {
                this.quoteBlocked.add(analysis.symbol);
                this.logEvent(
                    'error',
                    `${analysis.displayName} does not offer ${cfg.duration}${cfg.durationUnit} ${ct} contracts - removing it from the scan.`,
                    { symbol: analysis.symbol }
                );
            }
            return;
        }
        this.logEvent('quote', `Quote: ${analysis.displayName} ${ct}${prediction !== undefined ? `(${prediction})` : ''} — payout ${quote.payout.toFixed(2)} (stake ${stake.toFixed(2)})`, { symbol: analysis.symbol, contractType: ct });

        const prob = this.empiricalProb(analysis, ct);
        const ev = prob * quote.payout - stake;
        // Intelligent execution standard: never fire an order whose measured
        // probability cannot clear the quoted payout — i.e. a structurally
        // losing price. This mirrors the OU bot's EV threshold and Algo Pro's
        // favourability filter so every bot behaves consistently.
        const breakeven = stake > 0 && quote.payout > 0 ? stake / quote.payout : 1;
        const verdict = evaluateCandidate(
            {
                symbol: analysis.symbol,
                confidence: prob,
                winRate: prob,
                breakeven,
                payoutRatio: stake > 0 ? quote.payout / stake : 0,
            },
            { minConfidence: 0, requirePositiveEv: true }
        );
        if (!verdict.ok) {
            if (this.running) this.setStatus('scanning', `Holding: ${verdict.reason || 'negative expected value'}`);
            this.logEvent(
                'decision',
                `Skipped ${analysis.displayName} ${ct}: ${verdict.reason || 'negative expected value'} — measured ${(prob * 100).toFixed(1)}% vs break-even ${(breakeven * 100).toFixed(1)}%`,
                { symbol: analysis.symbol, contractType: ct }
            );
            return;
        }
        const record: TradeRecord = {
            id: `ai-${Date.now()}`,
            symbol: analysis.symbol,
            displayName: analysis.displayName,
            category: (meta?.category || 'other') as MarketCategory,
            contractType: ct as any,
            direction: directionOf(ct),
            barrier: prediction,
            duration: cfg.duration,
            durationUnit: cfg.durationUnit,
            stake,
            payout: quote.payout,
            payoutRatio: stake > 0 ? quote.payout / stake : 0,
            empiricalProb: prob,
            expectedValue: ev,
            confidence: prob,
            stage: 'proposed',
            openedAt: Date.now(),
            simulated: false,
        };

        this.setStatus('buying', `Submitting: ${analysis.displayName} ${ct}`);
        const buy = await executeBuyFresh(quote, stake, () => requestSimpleQuote(quoteReq));
        if (buy.error || buy.contractId === undefined) {
            if (buy.error && /no return/i.test(buy.error)) this.comboBlocked.add(comboKey);
            this.update({ trades: [{ ...record, stage: 'rejected', error: buy.error, closedAt: Date.now() }, ...this.state.trades] });
            if (this.running) this.setStatus('scanning', `Order rejected: ${buy.error}`);
            this.logEvent('error', `Order rejected: ${buy.error}`, { symbol: analysis.symbol });
            return;
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
            risk: {
                ...this.state.risk,
                openPositions: this.state.risk.openPositions + 1,
                tradesThisSession: this.state.risk.tradesThisSession + 1,
            },
            stats: { ...this.state.stats, trades: this.state.stats.trades + 1 },
        });
        this.logEvent('purchase', `Purchased #${buy.contractId}: ${analysis.displayName} ${ct} @ ${cfg.duration}${cfg.durationUnit}`, { symbol: analysis.symbol, contractId: buy.contractId, contractType: ct });
        voiceService.announceSignal({
            bot: 'AI Bot',
            market: analysis.displayName,
            signal: ct + (prediction !== undefined ? ` ${prediction}` : ''),
            confidence: prob,
            executed: true,
        });
        this.setStatus('monitoring', `Monitoring #${buy.contractId}…`);

        const settlement = await monitorUntilSettled(
            buy.contractId,
            meta?.pipSize ?? 2,
            undefined,
            settlementTimeoutMs(cfg.duration, cfg.durationUnit)
        );
        if ('error' in settlement) {
            // Outcome unknown past the duration-aware window: leaving `openTrade`
            // set and `openPositions` incremented deadlocked this bot behind the
            // "Open position in progress" gate. Keep the record unsettled (never
            // counted as a win or loss in performance), release the slot and say
            // so plainly. Martingale progression is deliberately NOT advanced —
            // the result is unknown, so neither win nor loss logic may run.
            const unresolved: TradeRecord = { ...confirmed, error: settlement.error, closedAt: Date.now() };
            const remaining = this.state.trades.filter(t => t.id !== confirmed.id);
            this.update({
                trades: [unresolved, ...remaining],
                openTrade: null,
                risk: { ...this.state.risk, openPositions: Math.max(0, this.state.risk.openPositions - 1) },
            });
            if (this.running) this.setStatus('scanning', `Settlement unknown: ${settlement.error}`);
            this.logEvent('error', `Settlement unknown #${buy.contractId}: ${settlement.error} — outcome not recorded, position slot released`, { contractId: buy.contractId });
            return;
        }
        const settled = applySettlementToRecord(confirmed, settlement);
        const outcome = buildTradeOutcome(settled.result === 'win', settled.stake, settled.payout, settled.profit);
        if (outcome.mismatch) {
            this.logEvent('error', `Settlement mismatch on #${buy.contractId}: reported ${settled.profit.toFixed(2)}, expected ${outcome.expectedProfit.toFixed(2)}`);
        }
        const remaining = this.state.trades.filter(t => t.id !== confirmed.id);
        const trades = [settled, ...remaining];
        const equity = accountBalance();
        const limits: RiskLimits = {
            ...DEFAULT_RISK_LIMITS,
            maxStake: cfg.maxStake,
            maxDailyLoss: cfg.stopLoss || DEFAULT_RISK_LIMITS.maxDailyLoss,
            maxConsecutiveLosses: DEFAULT_RISK_LIMITS.maxConsecutiveLosses,
            maxOpenPositions: 1,
        };
        const risk = applySettlement(this.state.risk, settled, equity, limits);
        const won = settled.result === 'win';
        const stats = {
            ...this.state.stats,
            wins: this.state.stats.wins + (won ? 1 : 0),
            losses: this.state.stats.losses + (won ? 0 : 1),
            netPnl: this.state.stats.netPnl + settled.profit,
        };
        // Martingale + recovery progression.
        if (won) {
            this.martingaleStep = 0;
            this.update({ usingRecovery: false });
        } else {
            if (cfg.martingaleEnabled) this.martingaleStep = Math.min(this.martingaleStep + 1, 6);
            if (cfg.recoveryEnabled) this.update({ usingRecovery: true });
        }

        this.update({ trades, openTrade: null, equity, risk, stats });
        this.logEvent(
            'settlement',
            `${won ? 'WIN' : 'LOSS'}: #${buy.contractId} ${analysis.displayName} ${ct} — ${settled.profit >= 0 ? '+' : ''}${settled.profit.toFixed(2)}`,
            { symbol: analysis.symbol, contractId: buy.contractId, contractType: ct, result: settled.result, profit: settled.profit }
        );
        voiceService.announceSettlement({ bot: 'AI Bot', won, profit: settled.profit, contractType: ct, market: analysis.displayName });

        // Never let a late settlement overwrite the stopped status (ghost
        // 'scanning' with no timer disables Start until a reload).
        const limit = this.limitReason();
        if (this.running && limit) this.enterSuspended(limit);
        else if (this.running && risk.suspended) this.enterSuspended(risk.suspensionReason || 'Risk limit reached');
        else if (this.running) this.setStatus('scanning', `Settled ${settled.result}. Scanning…`);
    }
}

export const aiBot = new AIBotEngine();
