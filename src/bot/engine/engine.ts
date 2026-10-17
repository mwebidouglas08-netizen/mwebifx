import {
    BotMode,
    ContractOpportunity,
    DigitStats,
    EngineConfig,
    EngineEvent,
    EngineStatus,
    EventType,
    RiskState,
    SyntheticSymbol,
    TickPoint,
    TradeRecord,
} from '../core/types';
import {
    chiSquareUniformity,
    detectDirectionalBias,
    detectConditionalDependence,
    analyzeMomentum,
    analyzeVolatility,
} from '../core/digit-stats';
import { assessEdge, EdgeAssessment } from '../core/ev';
import {
    DEFAULT_RISK_LIMITS,
    MIN_ORDER_STAKE,
    applySettlement,
    evaluateOpportunity,
    initialRiskState,
    resumeTrading,
    suspendTrading,
} from '../core/risk';
import { evaluateSessionGuard, fairPayoutRatio, rankBarriers } from '../core/digit-edge';
import { computePerformance } from '../core/performance';
import { discoverDigitContracts, discoverSyntheticSymbols } from '../deriv/discovery';
import { TickFeed, SymbolSeries } from '../deriv/ticks';
import {
    OverUnderRequest,
    applySettlementToRecord,
    executeBuyFresh,
    monitorUntilSettled,
    releaseQuote,
    requestQuote,
    settlementTimeoutMs,
    ProposalQuote,
} from '../deriv/execution';
import { accountBalance, currentLoginId, isApiReady, isAuthorized, getTicksHistory, refreshBalance } from '../deriv/api';
import { isDemoAccount } from '@/utils/account-helpers';
import { buildTradeOutcome } from '../core/intelligent-execution';
import { voiceService } from '@/services/voice-service';
import { soundService } from '@/services/sound-service';

export interface EngineState {
    status: EngineStatus;
    message: string;
    symbols: SyntheticSymbol[];
    series: Record<string, DigitStats & { sampleSize: number; stale: boolean; quote: number }>;
    opportunities: ContractOpportunity[];
    trades: TradeRecord[];
    openTrade: TradeRecord | null;
    risk: RiskState;
    config: EngineConfig;
    equity: number;
    accountIsDemo: boolean;
    liveTrading: boolean;
    dryRun: boolean;
    /** Explicit setDryRun(true) hold — kept separate so account re-evaluation cannot clear it. */
    manualHold: boolean;
    events: EngineEvent[];
}

export type EngineListener = (state: EngineState) => void;

// Session take-profit / stop-loss live on EngineConfig itself (0 = disabled)
// without touching core/types for every engine.
declare module '../core/types' {
    interface EngineConfig {
        /** Session take-profit in account currency; 0 (or unset) disables it. */
        takeProfit?: number;
        /** Session stop-loss in account currency; 0 (or unset) disables it. */
        stopLoss?: number;
    }
}

/** Session guard defaults — both enabled, both in account currency. */
const DEFAULT_TAKE_PROFIT = 10;
const DEFAULT_STOP_LOSS = 10;

const DEFAULT_CONFIG: EngineConfig = {
    symbols: [],
    categories: ['volatility', 'crash', 'boom', 'jump', 'step', 'range', 'other'],
    directions: ['over', 'under'],
    barriersOver: [2, 3],
    barriersUnder: [7, 8],
    stake: 1,
    duration: 1,
    durationUnit: 't',
    limits: { ...DEFAULT_RISK_LIMITS },
    scanIntervalMs: 3000,
    // Kept in lock-step with the risk gate so the warm-up buffer and the
    // scan's minSampleSize gate can never drift apart.
    minTicksForAnalysis: DEFAULT_RISK_LIMITS.minSampleSize,
    allowLiveTrading: false,
    mode: 'edge',
    activeIntervalMs: 12000,
    takeProfit: DEFAULT_TAKE_PROFIT,
    stopLoss: DEFAULT_STOP_LOSS,
};

const QUOTE_TTL_MS = 12000;
const MAX_CANDIDATES_PER_SCAN = 12;
const PROPOSAL_DELAY_MS = 200;
const PROPOSALS_PER_SCAN = 20;
const WATCHDOG_INTERVAL_MS = 15000;
/** If every market has been silent this long, the socket/feed is stuck. */
const TICK_STALL_MS = 45000;
/** Max discovered-but-unconfigured barriers quoted per symbol per direction. */
const EXPANDED_BARRIERS_PER_DIRECTION = 2;

interface CachedQuote {
    quote: ProposalQuote;
    at: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export const computeConfidence = (
    ciLow: number,
    ciHigh: number,
    payoutRatio: number
): number => {
    if (payoutRatio <= 0) return 0;
    const breakeven = 1 / payoutRatio;
    if (ciHigh <= breakeven) return 0;
    if (ciLow >= breakeven) return 1;
    const span = ciHigh - ciLow;
    return span > 0 ? clamp01((ciHigh - breakeven) / span) : 0;
};

export class OUBotEngine {
    private listeners = new Set<EngineListener>();
    private feed: TickFeed | null = null;
    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private symbols: SyntheticSymbol[] = [];
    private digitContracts = new Map<string, { over: number[]; under: number[] }>();
    private quoteCache = new Map<string, CachedQuote>();
    private proposalBudget = PROPOSALS_PER_SCAN;
    private lastProposalAt = 0;
    private busy = false;
    private running = false;
    private lastActiveTradeAt = 0;
    private eventSeq = 0;
    /** Any-symbol tick heartbeat for the stall watchdog. */
    private lastTickAt = 0;
    private watchdogTimer: ReturnType<typeof setInterval> | null = null;
    /** Bumped on every start()/stop() so async work cannot resurrect a dead session. */
    private generation = 0;
    private rebuildingFeed = false;
    /** Candidates skipped this scan because the proposal budget hit zero. */
    private scanUnquoted = 0;
    /** Equity observed at start(); session profit is measured against it. */
    private startingEquity = 0;
    private state: EngineState;

    constructor() {
        this.state = {
            status: 'idle',
            message: 'Idle',
            symbols: [],
            series: {},
            opportunities: [],
            trades: [],
            openTrade: null,
            risk: initialRiskState(0),
            config: { ...DEFAULT_CONFIG },
            equity: 0,
            accountIsDemo: true,
            liveTrading: false,
            dryRun: true,
            manualHold: false,
            events: [],
        };
    }

    subscribe = (listener: EngineListener): (() => void) => {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    };

    getState = (): EngineState => this.state;

    private update(patch: Partial<EngineState>) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach(l => l(this.state));
    }

    private setStatus(status: EngineStatus, message: string) {
        this.update({ status, message });
    }

    logEvent(type: EventType, message: string, extra: Partial<EngineEvent> = {}) {
        const event: EngineEvent = {
            id: `e${++this.eventSeq}-${Date.now()}`,
            at: Date.now(),
            type,
            message,
            ...extra,
        };
        const events = [event, ...this.state.events].slice(0, 240);
        this.update({ events });
    }

    setMode(mode: BotMode) {
        this.configure({ mode });
        this.logEvent('status', mode === 'active' ? 'Mode: Active (demo practice) — trades on a cadence regardless of edge.' : 'Mode: Edge (disciplined) — trades only on positive expected value.');
    }

    configure(config: Partial<EngineConfig>) {
        this.update({ config: { ...this.state.config, ...config } });
    }

    setLiveTrading(enabled: boolean) {
        this.update({ liveTrading: enabled, manualHold: false, dryRun: !enabled || !isAuthorized() });
        this.configure({ allowLiveTrading: enabled });
    }

    setDryRun(enabled: boolean) {
        // Never leave dry-run off without an authorized Deriv session.
        this.update({ manualHold: enabled, dryRun: enabled || !isAuthorized() });
    }

    /**
     * Re-evaluate the ACTIVE account and the execution gate. The login can
     * switch after start(); a demo snapshot must never keep authorizing real
     * orders (or block a demo that is now active).
     */
    private refreshAccountGate(): void {
        const authorized = isAuthorized();
        const loginid = authorized ? currentLoginId() : '';
        const accountIsDemo = authorized ? isDemoAccount(loginid) : false;
        const cfg = this.state.config;
        const dryRun = this.state.manualHold || !authorized || (!accountIsDemo && !cfg.allowLiveTrading);
        if (accountIsDemo === this.state.accountIsDemo && dryRun === this.state.dryRun) return;
        this.update({ accountIsDemo, dryRun, equity: accountBalance() });
        this.logEvent(
            'status',
            `Execution gate re-evaluated for ${authorized ? `${accountIsDemo ? 'DEMO' : 'REAL'} account (${loginid})` : 'no session'}${dryRun ? ' — holding orders.' : ' — orders allowed.'}`
        );
    }

    emergencyStop() {
        this.stop();
        this.update({
            status: 'stopped',
            message: 'Emergency stop engaged',
            openTrade: null,
        });
        this.logEvent('risk', 'Emergency stop engaged — all activity halted.');
    }

    private createFeed(): TickFeed {
        return new TickFeed({
            onTick: (symbol, point, series) => this.onTick(symbol, point, series),
            onStatus: (connected, error) => {
                if (!connected && this.running) {
                    this.setStatus('scanning', `Reconnecting to market data… ${error || ''}`.trim());
                }
            },
        });
    }

    async start(config?: Partial<EngineConfig>): Promise<void> {
        if (this.running) return;
        if (config) this.configure(config);

        if (!isApiReady()) {
            this.setStatus('error', 'Connecting to Deriv market data… try again in a moment.');
            this.logEvent('error', 'Not connected to Deriv yet. Log in (or wait for the connection) and try again.');
            return;
        }

        // Discovery, analysis and quotes run on public endpoints (no login required);
        // execution is gated on authorization when orders are placed.
        const authorized = isAuthorized();
        const loginid = authorized ? currentLoginId() : '';
        const accountIsDemo = authorized ? isDemoAccount(loginid) : false;
        const cfg = this.state.config;
        // Keep analysing on a real account without Live trading: dry-run holds
        // every order until Live trading is on — no terminal suspension, and
        // demo accounts trade demo funds without needing the Live toggle.
        const dryRun = !authorized || (!accountIsDemo && !cfg.allowLiveTrading);
        if (authorized && !accountIsDemo && !cfg.allowLiveTrading) {
            this.logEvent('risk', 'Real account: enable Live Trading to place real orders — running analysis only.');
        }

        this.running = true;
        const gen = ++this.generation;
        this.lastActiveTradeAt = 0;
        soundService.play('botStart');
        this.update({ accountIsDemo, dryRun, manualHold: false, equity: accountBalance() });
        this.logEvent(
            'status',
            authorized
                ? `Engine starting on ${accountIsDemo ? 'DEMO' : 'REAL'} account (${loginid}) — mode: ${cfg.mode === 'active' ? 'Active (demo practice)' : 'Edge (disciplined)'}.`
                : 'Engine starting in signals-only mode. Log in to your Deriv account to place orders.'
        );

        this.setStatus('discovering', 'Discovering synthetic markets…');
        try {
            await this.discover();
        } catch (e: any) {
            this.running = false;
            this.setStatus('error', e?.message || 'Market discovery failed');
            this.logEvent('error', e?.message || 'Market discovery failed');
            return;
        }

        this.setStatus('warming', `Warming up ${this.symbols.length} markets…`);

        // The feed must exist before warm-up: bootstrapDigits() writes into the series
        // objects owned by the feed, and a null feed silently discarded the history.
        this.feed = this.createFeed();
        this.feed.setSymbols(this.symbols.map(s => s.symbol));

        await this.bootstrapDigits();
        this.logEvent('discover', `Discovered ${this.symbols.length} synthetic markets. Digit buffers warmed.`);

        this.feed.start();
        this.lastTickAt = Date.now();
        this.startWatchdog(gen);

        this.startingEquity = accountBalance();
        this.update({ equity: accountBalance(), risk: initialRiskState(accountBalance()) });
        this.setStatus('scanning', cfg.mode === 'active' ? 'Active practice: placing trades on a cadence…' : 'Scanning for statistically defensible edges…');
        this.scanTimer = setInterval(() => this.scan(), cfg.scanIntervalMs);
        this.scan();
    }

    stop() {
        const wasRunning = this.running;
        this.running = false;
        this.generation++;
        this.stopWatchdog();
        if (this.scanTimer) clearInterval(this.scanTimer);
        this.scanTimer = null;
        if (this.feed) this.feed.stop();
        this.feed = null;
        if (this.state.status !== 'stopped') {
            this.setStatus('idle', 'Stopped');
        }
        if (wasRunning) {
            soundService.play('botStop');
            this.logEvent('status', 'Engine stopped.');
        }
    }

    // -----------------------------------------------------------------------
    // Production reliability: tick watchdog (ported from Algo Pro)
    // -----------------------------------------------------------------------

    private startWatchdog(gen: number) {
        this.stopWatchdog();
        this.watchdogTimer = setInterval(() => {
            if (gen !== this.generation || !this.running) {
                this.stopWatchdog();
                return;
            }
            const stalled = Date.now() - this.lastTickAt;
            if (stalled < TICK_STALL_MS || this.rebuildingFeed) return;
            void this.rebuildFeed(gen);
        }, WATCHDOG_INTERVAL_MS);
    }

    private stopWatchdog() {
        if (this.watchdogTimer !== null) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    /**
     * Every market silent at once means the feed is stuck: tear it down and
     * rebuild in place (stop → new feed → re-subscribe → re-seed digit history
     * → start). The generation check keeps a rebuild from resurrecting the
     * engine after stop(), and rebuildingFeed blocks overlapping rebuilds.
     */
    private async rebuildFeed(gen: number): Promise<void> {
        this.rebuildingFeed = true;
        try {
            this.feed?.stop();
            if (gen !== this.generation || !this.running) return;
            const feed = this.createFeed();
            this.feed = feed;
            feed.setSymbols(this.symbols.map(s => s.symbol));
            this.lastTickAt = Date.now(); // hold the stall clock while history re-seeds
            await this.bootstrapDigits(feed);
            if (gen !== this.generation || !this.running) {
                // Only tear down the feed this rebuild created — a newer
                // start() may already own this.feed.
                if (this.feed === feed) {
                    feed.stop();
                    this.feed = null;
                }
                return;
            }
            feed.start();
            this.lastTickAt = Date.now();
            this.logEvent('error', 'Market data stalled — feed restarted');
        } catch (e: any) {
            this.logEvent('error', `Feed restart failed: ${e?.message || String(e)}`);
        } finally {
            this.rebuildingFeed = false;
        }
    }

    resumeAfterSuspend() {
        if (!this.running) return;
        this.update({ risk: resumeTrading(this.state.risk, accountBalance()) });
        this.setStatus('scanning', 'Risk suspension lifted. Resuming scan…');
    }

    private async discover() {
        const cfg = this.state.config;
        const all = await discoverSyntheticSymbols();
        const filtered = all.filter(
            s =>
                s.exchangeIsOpen &&
                !s.isSuspended &&
                (cfg.categories.length === 0 || cfg.categories.includes(s.category)) &&
                (cfg.symbols.length === 0 || cfg.symbols.includes(s.symbol))
        );
        this.symbols = filtered;
        this.digitContracts.clear();
        // Resolve digit-contract availability in small batches: a sequential loop over
        // every synthetic index made start-up slow enough to time out on flaky links.
        const CONCURRENCY = 8;
        for (let i = 0; i < filtered.length; i += CONCURRENCY) {
            const batch = filtered.slice(i, i + CONCURRENCY);
            const resolved = await Promise.all(
                batch.map(async s => {
                    try {
                        const contracts = await discoverDigitContracts(s.symbol);
                        const over = contracts.find(c => c.contractType === 'DIGITOVER')?.barriers ?? [];
                        const under = contracts.find(c => c.contractType === 'DIGITUNDER')?.barriers ?? [];
                        return { symbol: s.symbol, over, under };
                    } catch {
                        return { symbol: s.symbol, over: [] as number[], under: [] as number[] };
                    }
                })
            );
            for (const r of resolved) this.digitContracts.set(r.symbol, { over: r.over, under: r.under });
        }
        this.update({
            symbols: filtered,
            series: {},
        });
    }

    private async bootstrapDigits(feed: TickFeed | null = this.feed) {
        const cfg = this.state.config;
        await Promise.all(
            this.symbols.map(async s => {
                try {
                    // Seed at least as many samples as the scan gate requires, otherwise
                    // the bot idles waiting for live ticks to reach minSampleSize. The
                    // bootstrap never drifts below limits.minSampleSize.
                    const need = Math.max(cfg.minTicksForAnalysis, cfg.limits.minSampleSize) + 20;
                    const hist = await getTicksHistory(s.symbol, need);
                    const history = (hist?.history?.prices ?? []) as string[];
                    const pipSize = s.pipSize;
                    const digits: number[] = [];
                    for (const p of history) {
                        const fixed = Number(p).toFixed(pipSize);
                        digits.push(Number(fixed[fixed.length - 1]));
                    }
                    const series = feed?.getSeries(s.symbol);
                    if (series && digits.length) {
                        series.digits = digits.slice(-2000);
                        series.quotes = history.slice(-500).map(Number);
                        series.tickCount = digits.length;
                        series.pipSize = pipSize;
                    }
                } catch {
                    // symbol may be closed; live ticks will fill it if it opens
                }
            })
        );
    }

    private onTick(symbol: string, _point: TickPoint, _series: SymbolSeries) {
        if (!this.running) return;
        // Heartbeat for the stall watchdog — tracked in dry-run too, so an
        // unauthorized session still detects (and rebuilds) a dead feed.
        this.lastTickAt = Date.now();
        if (this.state.dryRun) return;
        void symbol;
    }

    private buildOpportunity(
        s: SyntheticSymbol,
        series: SymbolSeries,
        direction: 'over' | 'under',
        barrier: number,
        quote: ProposalQuote,
        stats: DigitStats
    ): ContractOpportunity {
        const digits = series.digits;
        const bias = detectDirectionalBias(digits, direction, barrier);
        const stake = Math.max(this.state.config.stake, 0.35);
        const edge = assessEdge(bias.empiricalProb, quote.payout, stake, this.state.config.limits.minExpectedValue);
        const confidence = computeConfidence(bias.ciLow, bias.ciHigh, edge.payoutRatio);
        return {
            symbol: s.symbol,
            displayName: s.displayName,
            category: s.category,
            contractType: direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
            direction,
            barrier,
            duration: this.state.config.duration,
            durationUnit: this.state.config.durationUnit,
            stake,
            payout: quote.payout,
            payoutRatio: edge.payoutRatio,
            empiricalProb: bias.empiricalProb,
            theoreticalProb: bias.theoreticalProb,
            edge: bias.gap,
            expectedValue: edge.expectedValue,
            expectedValuePct: edge.expectedValuePct,
            confidence,
            sampleSize: bias.sampleSize,
            digitStats: stats,
            quoteId: quote.id,
            longcode: quote.longcode,
            detectedAt: Date.now(),
        };
    }

    private async getQuoteCached(req: OverUnderRequest): Promise<ProposalQuote | null> {
        const key = `${req.symbol}|${req.direction}|${req.barrier}|${req.duration}${req.durationUnit}`;
        const cached = this.quoteCache.get(key);
        if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached.quote;
        if (this.proposalBudget <= 0) {
            // Counted so the scan can report exactly how many ranked candidates
            // went unquoted this pass instead of failing silently.
            this.scanUnquoted += 1;
            return null;
        }
        const sinceLast = Date.now() - this.lastProposalAt;
        if (sinceLast < PROPOSAL_DELAY_MS) {
            await new Promise(r => setTimeout(r, PROPOSAL_DELAY_MS - sinceLast));
        }
        this.proposalBudget -= 1;
        this.lastProposalAt = Date.now();
        const { quote, error } = await requestQuote(req);
        if (error || !quote) return null;
        const previous = this.quoteCache.get(key);
        if (previous) releaseQuote(previous.quote);
        this.quoteCache.set(key, { quote, at: Date.now() });
        return quote;
    }

    /**
     * Preview quotes exist only to rank opportunities; the buy path re-quotes.
     * Detach their live proposal streams once the scan is done so no stream
     * keeps refreshing (and spending the shared proposal budget) unseen.
     */
    private releaseCachedQuoteStreams(): void {
        this.quoteCache.forEach(entry => releaseQuote(entry.quote));
    }

    private async scan() {
        if (!this.running || this.busy) return;
        if (this.state.status === 'suspended') return;
        this.busy = true;
        try {
            const cfg = this.state.config;
            this.proposalBudget = PROPOSALS_PER_SCAN;
            this.scanUnquoted = 0;
            const seriesMap = new Map<string, SymbolSeries>();
            const seriesStats: EngineState['series'] = {};
            for (const s of this.symbols) {
                const series = this.feed?.getSeries(s.symbol);
                if (!series) continue;
                // Publish live digit stats for every watched market so the panel
                // refreshes each scan (state.series was previously never populated).
                seriesStats[s.symbol] = {
                    ...this.statsFrom(series),
                    sampleSize: series.digits.length,
                    stale: series.stale,
                    quote: series.quotes[series.quotes.length - 1] ?? 0,
                };
                if (series.digits.length >= cfg.limits.minSampleSize && !series.stale) {
                    seriesMap.set(s.symbol, series);
                }
            }
            const opportunities: ContractOpportunity[] = [];
            const active = cfg.mode === 'active';
            const seriesList = Array.from(seriesMap.entries());
            for (const [symbol, series] of seriesList) {
                const meta = this.symbols.find(x => x.symbol === symbol);
                if (!meta) continue;
                const stats = this.statsFrom(series);
                const barriers = this.digitContracts.get(symbol);
                for (const direction of cfg.directions) {
                    const discovered = (direction === 'over' ? barriers?.over : barriers?.under) ?? [];
                    const configured = direction === 'over' ? cfg.barriersOver : cfg.barriersUnder;
                    const allowed = discovered.filter(b => configured.includes(b));
                    // Barrier auto-expansion: discovered barriers outside the
                    // configured list join the scan only when they rank in the
                    // top-2 by |empirical − breakeven| on recent digits, so new
                    // contract ranges get attention without burning the budget.
                    const extras = discovered.filter(b => !configured.includes(b));
                    const rankedExtras = rankBarriers(
                        series.digits,
                        direction,
                        extras,
                        b => fairPayoutRatio(direction, b),
                        EXPANDED_BARRIERS_PER_DIRECTION
                    );
                    for (const candidate of rankedExtras) allowed.push(candidate.barrier);
                    for (const barrier of allowed) {
                        const quote = await this.getQuoteCached({
                            symbol,
                            direction,
                            barrier,
                            amount: cfg.stake,
                            duration: cfg.duration,
                            durationUnit: cfg.durationUnit,
                        });
                        if (!quote) continue;
                        const opp = this.buildOpportunity(meta, series, direction, barrier, quote, stats);
                        // Edge mode keeps setups with a real confidence reading (the
                        // confidence gate below decides); Active mode keeps every
                        // quoted contract so there is always a candidate.
                        if (active || opp.confidence > 0) opportunities.push(opp);
                    }
                }
            }
            if (this.scanUnquoted > 0) {
                this.logEvent('scan', `Scan budget exhausted — ${this.scanUnquoted} candidate(s) unquoted`);
            }
            // High confidence first; EV breaks ties.
            opportunities.sort((a, b) => b.confidence - a.confidence || b.expectedValuePct - a.expectedValuePct);
            const top = opportunities.slice(0, MAX_CANDIDATES_PER_SCAN);
            this.update({ opportunities: top, series: seriesStats });

            if (!this.running) return;
            if (this.state.risk.suspended) return;
            this.refreshAccountGate();
            // Keep tracked equity fresh so the session guards below (and the
            // stake sanity check in execute) always see the current balance.
            const equity = accountBalance();
            if (equity !== this.state.equity) this.update({ equity });
            if (this.enforceSessionGuard()) return;
            if (this.state.dryRun) {
                const why = isAuthorized()
                    ? 'Holding: enable Live trading to place real orders'
                    : 'Holding: log in to place orders';
                if (this.state.message !== why) this.setStatus('scanning', why);
                return;
            }

            if (active) {
                const now = Date.now();
                if (now - this.lastActiveTradeAt < cfg.activeIntervalMs) return;
                this.lastActiveTradeAt = now;
                const best = top[0];
                if (!best) {
                    this.setStatus('scanning', 'Waiting for a tradable contract…');
                    return;
                }
                const verdict = evaluateOpportunity(best, this.state.risk, cfg.limits, accountBalance(), now, { skipEdgeGates: true });
                if (!verdict.allowed) {
                    this.setStatus('scanning', `Holding: ${verdict.reason}`);
                    this.logEvent('risk', `Holding: ${verdict.reason}`);
                    return;
                }
                this.announceOpportunity(best);
                await this.execute(best, verdict.stake);
            } else {
                // Confidence-driven execution: walk the ranked candidates and trade
                // the first setup whose confidence and sample clear the gates.
                // Previously only top[0] was evaluated, so one failing best-ranked
                // quote froze the bot even when a high-confidence runner-up existed.
                let holdReason = 'No high-confidence setup yet';
                for (const opp of top) {
                    if (!this.running) return;
                    if (opp.confidence < cfg.limits.minConfidence) {
                        holdReason = `Confidence ${opp.confidence.toFixed(2)} below ${cfg.limits.minConfidence} on ${opp.displayName}`;
                        continue;
                    }
                    if (opp.sampleSize < cfg.limits.minSampleSize) {
                        holdReason = `Sample ${opp.sampleSize} below ${cfg.limits.minSampleSize} on ${opp.displayName}`;
                        continue;
                    }
                    const verdict = evaluateOpportunity(opp, this.state.risk, cfg.limits, accountBalance(), Date.now(), { skipEdgeGates: true });
                    if (!verdict.allowed) {
                        holdReason = verdict.reason;
                        if (this.state.risk.suspended) {
                            this.logEvent('risk', `Holding: ${verdict.reason}`);
                            return;
                        }
                        continue;
                    }
                    this.announceOpportunity(opp);
                    await this.execute(opp, verdict.stake);
                    return;
                }
                this.setStatus('scanning', `Holding: ${holdReason}`);
            }
        } catch (e: any) {
            this.setStatus('error', e?.message || 'Scan error');
            this.logEvent('error', e?.message || 'Scan error');
        } finally {
            this.releaseCachedQuoteStreams();
            this.busy = false;
        }
    }

    private statsFrom(series: SymbolSeries): DigitStats {
        const counts = new Array(10).fill(0);
        for (const d of series.digits) if (d >= 0 && d <= 9) counts[d] += 1;
        const { chiSquare, pValue } = chiSquareUniformity(counts);
        const total = counts.reduce((a, b) => a + b, 0) || 1;
        return {
            sampleSize: total,
            counts,
            frequencies: counts.map(c => c / total),
            expected: total / 10,
            chiSquare,
            pValue,
            isUniform: pValue > 0.05,
            significant: pValue <= 0.05,
        };
    }

    /** Voice: the setup cleared every gate and is about to be executed. */
    private announceOpportunity(opp: ContractOpportunity) {
        voiceService.announceSignal({
            bot: 'OU Bot',
            market: opp.displayName,
            signal: `${opp.direction === 'over' ? 'Over' : 'Under'} ${opp.barrier}`,
            confidence: opp.confidence,
            strong: opp.confidence >= 0.8,
            executed: false,
        });
    }

    private async execute(opp: ContractOpportunity, stake: number) {
        const cfg = this.state.config;
        const active = cfg.mode === 'active';
        // Stake sanity: floor at Deriv's minimum and never stake more than the
        // account can cover. Tracked equity is refreshed every scan; fall back
        // to the API snapshot before the first scan has run.
        const trackedEquity = this.state.equity > 0 ? this.state.equity : accountBalance();
        const orderStake = Math.max(stake, MIN_ORDER_STAKE);
        if (orderStake > trackedEquity) {
            const reason = `Stake ${orderStake.toFixed(2)} exceeds available equity ${trackedEquity.toFixed(2)}`;
            this.logEvent('risk', `Holding on ${opp.displayName} ${opp.direction} ${opp.barrier}: ${reason}`);
            if (this.running) this.setStatus('scanning', `Holding: ${reason}`);
            return;
        }
        const quoteReq: OverUnderRequest = {
            symbol: opp.symbol,
            direction: opp.direction,
            barrier: opp.barrier,
            amount: orderStake,
            duration: cfg.duration,
            durationUnit: cfg.durationUnit,
        };
        this.setStatus('proposing', `Requesting quote: ${opp.displayName} ${opp.direction} ${opp.barrier}`);
        const { quote, error } = await requestQuote(quoteReq);
        if (error || !quote) {
            if (this.running) this.setStatus('scanning', `Quote failed: ${error || 'no quote'}`);
            this.logEvent('error', `Quote failed on ${opp.displayName}: ${error || 'no quote'}`);
            return;
        }
        const finalEdge = assessEdge(opp.empiricalProb, quote.payout, orderStake, cfg.limits.minExpectedValue);
        // Re-check the rank-time gates against the FRESH payout — the market
        // can move between scan and buy. Active mode keeps its skipEdgeGates
        // behaviour but must still refuse an outright negative-EV payout.
        const gateFailure = this.buyGateFailure(finalEdge, opp, active);
        if (gateFailure) {
            releaseQuote(quote);
            this.logEvent('risk', `Holding on ${opp.displayName} ${opp.direction} ${opp.barrier}: ${gateFailure}`);
            if (this.running) this.setStatus('scanning', `Holding: ${gateFailure}`);
            return;
        }

        const record: TradeRecord = {
            id: `ou-${Date.now()}`,
            symbol: opp.symbol,
            displayName: opp.displayName,
            category: opp.category,
            contractType: opp.contractType,
            direction: opp.direction,
            barrier: opp.barrier,
            duration: cfg.duration,
            durationUnit: cfg.durationUnit,
            stake: orderStake,
            payout: quote.payout,
            payoutRatio: finalEdge.payoutRatio,
            empiricalProb: opp.empiricalProb,
            expectedValue: finalEdge.expectedValue,
            confidence: opp.confidence,
            stage: 'proposed',
            openedAt: Date.now(),
            simulated: false,
        };
        this.logEvent('quote', `Quote: ${opp.displayName} ${opp.direction} ${opp.barrier} — payout ${finalEdge.payoutRatio.toFixed(2)}× (stake ${orderStake.toFixed(2)} → ${quote.payout.toFixed(2)})`, { symbol: opp.symbol, direction: opp.direction, barrier: opp.barrier, stake: orderStake, payout: quote.payout });
        this.setStatus('buying', `Submitting order: ${opp.direction} ${opp.barrier} on ${opp.displayName}`);
        const buy = await executeBuyFresh(quote, orderStake, () => requestQuote(quoteReq));
        if (buy.error || buy.contractId === undefined) {
            this.update({
                trades: [{ ...record, stage: 'rejected', error: buy.error, closedAt: Date.now() }, ...this.state.trades],
            });
            if (this.running) this.setStatus('scanning', `Order rejected: ${buy.error}`);
            this.logEvent('error', `Order rejected: ${buy.error}`, { symbol: opp.symbol });
            return;
        }
        const confirmedStake = buy.buyPrice ?? orderStake;
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
        });
        this.logEvent('purchase', `Purchased contract #${buy.contractId}: ${opp.displayName} ${opp.direction} ${opp.barrier} @ ${opp.duration}${opp.durationUnit}`, { symbol: opp.symbol, contractId: buy.contractId, direction: opp.direction, barrier: opp.barrier, stake: confirmed.stake, payout: confirmed.payout });
        voiceService.announceSignal({
            bot: 'OU Bot',
            market: opp.displayName,
            signal: `${opp.direction} ${opp.barrier}`,
            confidence: opp.confidence,
            executed: true,
        });
        this.setStatus('monitoring', `Monitoring contract #${buy.contractId}…`);

        const meta = this.symbols.find(x => x.symbol === opp.symbol);
        const settlement = await monitorUntilSettled(
            buy.contractId,
            meta?.pipSize ?? 2,
            undefined,
            settlementTimeoutMs(cfg.duration, cfg.durationUnit)
        );
        if ('error' in settlement) {
            // The contract may still be live on Deriv's side, but its outcome is
            // unknown past the duration-aware window. Leaving `openTrade` set and
            // `openPositions` incremented permanently deadlocked the engine behind
            // the "Open position limit reached" gate. Record the failure on the
            // trade (still excluded from performance — no fabricated win/loss),
            // release the slot so the scan loop can continue, and say so plainly.
            const failed: TradeRecord = { ...confirmed, error: settlement.error, closedAt: Date.now() };
            const remaining = this.state.trades.filter(t => t.id !== confirmed.id);
            this.update({
                trades: [failed, ...remaining],
                openTrade: null,
                risk: { ...this.state.risk, openPositions: Math.max(0, this.state.risk.openPositions - 1) },
            });
            if (this.running) this.setStatus('scanning', `Settlement unknown: ${settlement.error}`);
            this.logEvent('error', `Settlement unknown for #${buy.contractId}: ${settlement.error} — outcome not recorded, position slot released`, { contractId: buy.contractId });
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
        const risk = applySettlement(this.state.risk, settled, equity, cfg.limits);
        this.update({ trades, openTrade: null, equity, risk });
        this.logEvent(
            'settlement',
            `${settled.result === 'win' ? 'WIN' : 'LOSS'}: #${buy.contractId} ${opp.displayName} ${opp.direction} ${opp.barrier} — exit digit ${settled.exitDigit ?? '—'}, ${settled.profit >= 0 ? '+' : ''}${settled.profit.toFixed(2)}`,
            { symbol: opp.symbol, contractId: buy.contractId, direction: opp.direction, barrier: opp.barrier, result: settled.result, profit: settled.profit, exitDigit: settled.exitDigit, payout: settled.payout }
        );
        // Mirror Algo Pro: force a balance refresh after a live settlement so
        // equity accounting (and the header) reflects it immediately instead
        // of waiting for the next socket push.
        if (!settled.simulated) void refreshBalance();
        voiceService.announceSettlement({
            bot: 'OU Bot',
            won: settled.result === 'win',
            profit: settled.profit,
            market: opp.displayName,
        });
        // Never let a late settlement overwrite the stopped status (ghost
        // 'scanning' with no timer disables Start until a reload).
        if (risk.suspended) this.logEvent('risk', `Suspended: ${risk.suspensionReason}`);
        if (this.running) {
            if (risk.suspended) this.setStatus('suspended', risk.suspensionReason || 'Risk limit reached');
            else this.setStatus('scanning', `Settled ${settled.result}: ${settled.profit?.toFixed(2)}. Reassessing market…`);
        }
        // Session take-profit / stop-loss — last, so a fired guard is the
        // final word on the engine's status.
        this.enforceSessionGuard();
    }

    /** Buy-time re-check of the rank-time gates on the FRESH edge. Active
     * mode keeps skipEdgeGates but must still refuse negative EV. Returns the
     * failed gate as a human-readable reason, or null to proceed. */
    private buyGateFailure(edge: EdgeAssessment, opp: ContractOpportunity, active: boolean): string | null {
        const limits = this.state.config.limits;
        if (active) {
            return edge.expectedValuePct < 0
                ? `EV ${edge.expectedValuePct.toFixed(3)} is negative on the live quote`
                : null;
        }
        if (edge.expectedValuePct < limits.minExpectedValue) {
            return `EV ${edge.expectedValuePct.toFixed(3)} below ${limits.minExpectedValue}`;
        }
        if (edge.payoutRatio < limits.minPayoutRatio) {
            return `Payout ratio ${edge.payoutRatio.toFixed(2)} below ${limits.minPayoutRatio}`;
        }
        if (opp.confidence < limits.minConfidence) {
            return `Confidence ${opp.confidence.toFixed(2)} below ${limits.minConfidence}`;
        }
        return null;
    }

    /**
     * Session take-profit / stop-loss: session profit is equity minus the
     * equity observed at start(). A risk suspension already halts trading and
     * keeps its own status, so it takes precedence. Returns true when a guard
     * fired and the engine was stopped.
     */
    private enforceSessionGuard(): boolean {
        if (!this.running || this.state.risk.suspended) return false;
        const cfg = this.state.config;
        const equity = this.state.equity > 0 ? this.state.equity : accountBalance();
        if (this.startingEquity <= 0) {
            // Anchor the session on the first observed balance (signals-only
            // starts have none) so a late login cannot look like instant profit.
            this.startingEquity = equity;
            if (equity <= 0) return false;
        }
        const sessionProfit = equity - this.startingEquity;
        const verdict = evaluateSessionGuard(
            sessionProfit,
            cfg.takeProfit ?? DEFAULT_TAKE_PROFIT,
            cfg.stopLoss ?? DEFAULT_STOP_LOSS
        );
        if (!verdict.stop || !verdict.reason) return false;
        this.logEvent(
            'risk',
            `${verdict.reason} — session profit ${sessionProfit >= 0 ? '+' : ''}${sessionProfit.toFixed(2)}`
        );
        voiceService.announceGuard(verdict.reason, 'OU Bot');
        this.stop();
        this.update({ status: 'stopped', message: verdict.reason });
        return true;
    }

    getPerformance() {
        return computePerformance(this.state.trades);
    }

    getMarketsAnalysis() {
        return this.symbols.map(s => {
            const series = this.feed?.getSeries(s.symbol);
            const digits = series?.digits ?? [];
            const quotes = series?.quotes ?? [];
            const stats = this.statsFrom({ digits } as SymbolSeries);
            const markov = detectConditionalDependence(digits);
            const momentum = analyzeMomentum(quotes);
            const volatility = analyzeVolatility(quotes);
            return { symbol: s, stats, markov, momentum, volatility, quote: quotes[quotes.length - 1] ?? 0, stale: series?.stale ?? true };
        });
    }
}

export const ouBotEngine = new OUBotEngine();
