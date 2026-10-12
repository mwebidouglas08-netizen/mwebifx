import {
    ContractOpportunity,
    DigitStats,
    EngineConfig,
    EngineStatus,
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
import { assessEdge } from '../core/ev';
import {
    DEFAULT_RISK_LIMITS,
    applySettlement,
    evaluateOpportunity,
    initialRiskState,
    resumeTrading,
    suspendTrading,
} from '../core/risk';
import { computePerformance } from '../core/performance';
import { discoverDigitContracts, discoverSyntheticSymbols } from '../deriv/discovery';
import { TickFeed, SymbolSeries } from '../deriv/ticks';
import {
    OverUnderRequest,
    applySettlementToRecord,
    executeBuy,
    monitorUntilSettled,
    requestQuote,
    ProposalQuote,
} from '../deriv/execution';
import { accountBalance, currentLoginId, isApiReady, isAuthorized, getTicksHistory } from '../deriv/api';
import { isDemoAccount } from '@/utils/account-helpers';

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
}

export type EngineListener = (state: EngineState) => void;

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
    minTicksForAnalysis: 300,
    allowLiveTrading: false,
};

const QUOTE_TTL_MS = 12000;
const MAX_CANDIDATES_PER_SCAN = 12;

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
    private busy = false;
    private running = false;
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

    configure(config: Partial<EngineConfig>) {
        this.update({ config: { ...this.state.config, ...config } });
    }

    setLiveTrading(enabled: boolean) {
        this.update({ liveTrading: enabled });
    }

    setDryRun(enabled: boolean) {
        this.update({ dryRun: enabled });
    }

    emergencyStop() {
        this.stop();
        this.update({
            status: 'stopped',
            message: 'Emergency stop engaged',
            openTrade: null,
        });
    }

    async start(config?: Partial<EngineConfig>): Promise<void> {
        if (this.running) return;
        if (config) this.configure(config);

        if (!isApiReady()) {
            this.setStatus('error', 'Not connected to Deriv. Please log in first.');
            return;
        }
        if (!isAuthorized()) {
            this.setStatus('error', 'Not authorized. Please log in to your Deriv account.');
            return;
        }

        const loginid = currentLoginId();
        const accountIsDemo = isDemoAccount(loginid);
        const cfg = this.state.config;
        if (!accountIsDemo && !cfg.allowLiveTrading) {
            this.update({ accountIsDemo, dryRun: true });
            this.setStatus('suspended', 'Live trading disabled on a real account. Enable Live Trading to place real orders.');
            return;
        }

        this.running = true;
        this.update({ accountIsDemo, dryRun: !cfg.allowLiveTrading, equity: accountBalance() });

        this.setStatus('discovering', 'Discovering synthetic markets…');
        try {
            await this.discover();
        } catch (e: any) {
            this.running = false;
            this.setStatus('error', e?.message || 'Market discovery failed');
            return;
        }

        this.setStatus('warming', `Warming up ${this.symbols.length} markets…`);
        await this.bootstrapDigits();

        this.feed = new TickFeed({
            onTick: (symbol, point, series) => this.onTick(symbol, point, series),
            onStatus: (connected, error) => {
                if (!connected && this.running) {
                    this.setStatus('scanning', `Reconnecting to market data… ${error || ''}`.trim());
                }
            },
        });
        this.feed.setSymbols(this.symbols.map(s => s.symbol));
        this.feed.start();

        this.update({ equity: accountBalance(), risk: initialRiskState(accountBalance()) });
        this.setStatus('scanning', 'Scanning markets for statistically defensible edges…');
        this.scanTimer = setInterval(() => this.scan(), cfg.scanIntervalMs);
        this.scan();
    }

    stop() {
        this.running = false;
        if (this.scanTimer) clearInterval(this.scanTimer);
        this.scanTimer = null;
        if (this.feed) this.feed.stop();
        this.feed = null;
        if (this.state.status !== 'stopped') {
            this.setStatus('idle', 'Stopped');
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
        for (const s of filtered) {
            const contracts = await discoverDigitContracts(s.symbol);
            const over = contracts.find(c => c.contractType === 'DIGITOVER')?.barriers ?? [];
            const under = contracts.find(c => c.contractType === 'DIGITUNDER')?.barriers ?? [];
            this.digitContracts.set(s.symbol, { over, under });
        }
        this.update({
            symbols: filtered,
            series: {},
        });
    }

    private async bootstrapDigits() {
        const cfg = this.state.config;
        await Promise.all(
            this.symbols.map(async s => {
                try {
                    const hist = await getTicksHistory(s.symbol, cfg.minTicksForAnalysis);
                    const history = (hist?.history?.prices ?? []) as string[];
                    const pipSize = s.pipSize;
                    const digits: number[] = [];
                    for (const p of history) {
                        const fixed = Number(p).toFixed(pipSize);
                        digits.push(Number(fixed[fixed.length - 1]));
                    }
                    const series = this.feed?.getSeries(s.symbol);
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
        const { quote, error } = await requestQuote(req);
        if (error || !quote) return null;
        this.quoteCache.set(key, { quote, at: Date.now() });
        return quote;
    }

    private async scan() {
        if (!this.running || this.busy) return;
        if (this.state.status === 'suspended') return;
        this.busy = true;
        try {
            const cfg = this.state.config;
            const seriesMap = new Map<string, SymbolSeries>();
            for (const s of this.symbols) {
                const series = this.feed?.getSeries(s.symbol);
                if (series && series.digits.length >= cfg.limits.minSampleSize && !series.stale) {
                    seriesMap.set(s.symbol, series);
                }
            }
            const opportunities: ContractOpportunity[] = [];
            const seriesList = Array.from(seriesMap.entries());
            for (const [symbol, series] of seriesList) {
                const meta = this.symbols.find(x => x.symbol === symbol);
                if (!meta) continue;
                const stats = this.statsFrom(series);
                const barriers = this.digitContracts.get(symbol);
                for (const direction of cfg.directions) {
                    const allowed = direction === 'over'
                        ? barriers?.over.filter(b => cfg.barriersOver.includes(b)) ?? []
                        : barriers?.under.filter(b => cfg.barriersUnder.includes(b)) ?? [];
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
                        if (opp.expectedValue > 0 && opp.confidence > 0) opportunities.push(opp);
                    }
                }
            }
            opportunities.sort(
                (a, b) => b.expectedValuePct * b.confidence - a.expectedValuePct * a.confidence
            );
            const top = opportunities.slice(0, MAX_CANDIDATES_PER_SCAN);
            this.update({ opportunities: top });

            if (this.state.dryRun || !this.running) return;
            if (this.state.risk.suspended) return;

            const best = top[0];
            if (!best) return;
            const verdict = evaluateOpportunity(
                best,
                this.state.risk,
                cfg.limits,
                accountBalance()
            );
            if (!verdict.allowed) {
                this.setStatus('scanning', `Holding: ${verdict.reason}`);
                return;
            }
            await this.execute(best, verdict.stake);
        } catch (e: any) {
            this.setStatus('error', e?.message || 'Scan error');
        } finally {
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

    private async execute(opp: ContractOpportunity, stake: number) {
        const cfg = this.state.config;
        this.setStatus('proposing', `Requesting quote: ${opp.displayName} ${opp.direction} ${opp.barrier}`);
        const { quote, error } = await requestQuote({
            symbol: opp.symbol,
            direction: opp.direction,
            barrier: opp.barrier,
            amount: stake,
            duration: cfg.duration,
            durationUnit: cfg.durationUnit,
        });
        if (error || !quote) {
            this.setStatus('scanning', `Quote failed: ${error || 'no quote'}`);
            return;
        }
        const finalEdge = assessEdge(opp.empiricalProb, quote.payout, stake, cfg.limits.minExpectedValue);
        if (finalEdge.expectedValuePct < cfg.limits.minExpectedValue || finalEdge.payoutRatio < cfg.limits.minPayoutRatio) {
            this.setStatus('scanning', 'Quote no longer meets EV threshold. Skipping.');
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
            stake,
            payout: quote.payout,
            payoutRatio: finalEdge.payoutRatio,
            empiricalProb: opp.empiricalProb,
            expectedValue: finalEdge.expectedValue,
            confidence: opp.confidence,
            stage: 'proposed',
            openedAt: Date.now(),
            simulated: false,
        };
        this.setStatus('buying', `Submitting order: ${opp.direction} ${opp.barrier} on ${opp.displayName}`);
        const buy = await executeBuy(quote, stake);
        if (buy.error || buy.contractId === undefined) {
            this.update({
                trades: [{ ...record, stage: 'rejected', error: buy.error, closedAt: Date.now() }, ...this.state.trades],
            });
            this.setStatus('scanning', `Order rejected: ${buy.error}`);
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
        });
        this.setStatus('monitoring', `Monitoring contract #${buy.contractId}…`);

        const meta = this.symbols.find(x => x.symbol === opp.symbol);
        const settlement = await monitorUntilSettled(buy.contractId, meta?.pipSize ?? 2);
        if ('error' in settlement) {
            this.setStatus('scanning', `Settlement pending: ${settlement.error}`);
            return;
        }
        const settled = applySettlementToRecord(confirmed, settlement);
        const remaining = this.state.trades.filter(t => t.id !== confirmed.id);
        const trades = [settled, ...remaining];
        const equity = accountBalance();
        const risk = applySettlement(this.state.risk, settled, equity, cfg.limits);
        this.update({ trades, openTrade: null, equity, risk });
        if (risk.suspended) {
            this.setStatus('suspended', risk.suspensionReason || 'Risk limit reached');
        } else {
            this.setStatus('scanning', `Settled ${settled.result}: ${settled.profit?.toFixed(2)}. Reassessing market…`);
        }
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
