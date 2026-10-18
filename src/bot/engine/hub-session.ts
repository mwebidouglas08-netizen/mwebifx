import { TickFeed, SymbolSeries } from '../deriv/ticks';
import {
    requestSimpleQuote,
    executeBuy,
    monitorUntilSettled,
    releaseQuote,
    settlementTimeoutMs,
} from '../deriv/execution';
import { pipSizeDefault } from '../core/algo-pro-ai';

export type HubContractType =
    | 'DIGITEVEN'
    | 'DIGITODD'
    | 'DIGITOVER'
    | 'DIGITUNDER'
    | 'DIGITMATCH'
    | 'DIGITDIFF'
    | 'CALL'
    | 'PUT';

export interface HubTradeIntent {
    symbol: string;
    contractType: HubContractType;
    barrier?: number;
}

export interface HubTradeRow {
    id: number;
    symbol: string;
    name: string;
    contract: string;
    stake: number;
    payout: number;
    result: 'win' | 'loss' | null;
    profit: number;
    at: number;
}

export interface HubSessionSnapshot {
    running: boolean;
    busy: boolean;
    trades: number;
    wins: number;
    losses: number;
    profit: number;
    nextStake: number;
    tickCount: number;
    marketTicks: Record<string, number>;
    digits: Record<string, number[]>;
    quotes: Record<string, number>;
    rows: HubTradeRow[];
    journal: string[];
    lastMessage: string;
}

export interface HubSessionOptions {
    symbols: string[];
    stake: number;
    /** Multiplier applied to the stake after each loss; 1 disables recovery. */
    martingale: number;
    takeProfit: number;
    stopLoss: number;
    durationTicks?: number;
    nameOf?: (symbol: string) => string;
    evaluate: (symbol: string, series: SymbolSeries, state: HubSessionSnapshot) => HubTradeIntent | null;
}

export const nextStakeAfter = (base: number, multiplier: number, losses: number): number => {
    if (!Number.isFinite(base) || base <= 0) return 0;
    if (!Number.isFinite(multiplier) || multiplier <= 1 || losses <= 0) return base;
    return Math.round(base * Math.pow(multiplier, losses) * 100) / 100;
};

export const sessionStopReason = (
    profit: number,
    nextStake: number,
    takeProfit: number,
    stopLoss: number
): string | null => {
    if (takeProfit > 0 && profit >= takeProfit) return `Congratulations. TakeProfit Achieved: ${profit.toFixed(2)}`;
    if (stopLoss > 0 && profit <= -stopLoss) return `Sorry!!! Stop Loss Hit: ${profit.toFixed(2)}`;
    if (stopLoss > 0 && nextStake > stopLoss + profit) {
        return `Stopped. Next stake ${nextStake.toFixed(2)} exceeds the remaining loss budget of ${(stopLoss + profit).toFixed(2)}.`;
    }
    return null;
};

const contractLabel = (contractType: HubContractType, barrier?: number): string => {
    switch (contractType) {
        case 'DIGITOVER':
            return `Over ${barrier}`;
        case 'DIGITUNDER':
            return `Under ${barrier}`;
        case 'DIGITMATCH':
            return `Matches ${barrier}`;
        case 'DIGITDIFF':
            return `Differs ${barrier}`;
        default:
            return contractType.replace('DIGIT', '');
    }
};

export class HubSession {
    private opts: HubSessionOptions;
    private feed: TickFeed | null = null;
    private snap: HubSessionSnapshot;
    private consecutiveLosses = 0;
    private inFlight = false;
    private tickTotal = 0;
    private idSeq = 0;
    private hooks: { onTick?: (symbol: string, series: SymbolSeries) => void };
    onSnapshot?: (s: HubSessionSnapshot) => void;

    constructor(
        opts: HubSessionOptions,
        hooks: { onSnapshot?: (s: HubSessionSnapshot) => void; onTick?: (symbol: string, series: SymbolSeries) => void } = {}
    ) {
        this.opts = opts;
        this.hooks = hooks;
        this.onSnapshot = hooks.onSnapshot;
        this.snap = this.emptySnap();
    }

    private emptySnap(): HubSessionSnapshot {
        const digits: Record<string, number[]> = {};
        const quotes: Record<string, number> = {};
        const marketTicks: Record<string, number> = {};
        for (const s of this.opts.symbols) {
            digits[s] = [];
            quotes[s] = 0;
            marketTicks[s] = 0;
        }
        return {
            running: false,
            busy: false,
            trades: 0,
            wins: 0,
            losses: 0,
            profit: 0,
            nextStake: this.opts.stake,
            tickCount: 0,
            marketTicks,
            digits,
            quotes,
            rows: [],
            journal: [],
            lastMessage: '',
        };
    }

    getSnapshot = (): HubSessionSnapshot => this.snap;

    updateOptions(patch: Partial<HubSessionOptions>) {
        this.opts = { ...this.opts, ...patch };
    }

    private emit() {
        this.onSnapshot?.(this.snap);
    }

    private log(message: string) {
        this.snap.lastMessage = message;
        this.snap.journal = [...this.snap.journal.slice(-199), message];
    }

    start() {
        if (this.snap.running) return;
        this.snap = this.emptySnap();
        this.snap.running = true;
        this.consecutiveLosses = 0;
        this.log(`Multi-Market Scanner Activated. ${this.opts.symbols.length} Markets`);
        const feed = new TickFeed({
            onTick: (symbol, _point, series) => {
                this.tickTotal += 1;
                this.snap.tickCount = this.tickTotal;
                this.snap.marketTicks = { ...this.snap.marketTicks, [symbol]: (this.snap.marketTicks[symbol] || 0) + 1 };
                this.snap.digits = { ...this.snap.digits, [symbol]: [...series.digits] };
                this.snap.quotes = { ...this.snap.quotes, [symbol]: series.quotes[series.quotes.length - 1] || 0 };
                this.hooks.onTick?.(symbol, series);
                if (!this.inFlight) {
                    const intent = this.opts.evaluate(symbol, series, this.snap);
                    if (intent) void this.execute(intent);
                }
                this.emit();
            },
        });
        this.feed = feed;
        feed.setSymbols(this.opts.symbols);
        feed.start();
        this.emit();
    }

    stop(reason = 'Bot stopped by user') {
        if (!this.snap.running) return;
        this.snap.running = false;
        this.feed?.stop();
        this.feed = null;
        this.log(reason);
        this.emit();
    }

    /** One-shot manual buy used by Quick Bot / Speedbot / Manual Trader buttons. */
    async buyOnce(intent: HubTradeIntent, amount?: number): Promise<HubTradeRow | null> {
        return this.execute(intent, amount, true);
    }

    private async execute(intent: HubTradeIntent, amount?: number, manual = false): Promise<HubTradeRow | null> {
        if (this.inFlight) return null;
        this.inFlight = true;
        if (!manual) {
            this.snap.busy = true;
            this.snap.nextStake = this.snap.nextStake || this.opts.stake;
        }
        const stake = amount ?? (this.snap.nextStake || this.opts.stake);
        const duration = this.opts.durationTicks ?? 1;
        let row: HubTradeRow | null = null;
        try {
            const name = this.opts.nameOf?.(intent.symbol) || intent.symbol;
            this.log(`Buy: ${contractLabel(intent.contractType, intent.barrier)} (${stake.toFixed(2)}) on ${name}`);
            const { quote, error } = await requestSimpleQuote({
                symbol: intent.symbol,
                contractType: intent.contractType,
                barrier: intent.barrier,
                amount: stake,
                duration,
                durationUnit: 't',
            });
            if (!quote) {
                this.log(`Trade error: ${error || 'no quote'}`);
                return null;
            }
            const buy = await executeBuy(quote, stake);
            releaseQuote(quote);
            if (buy.error || !buy.contractId) {
                this.log(`Trade error: ${buy.error || 'buy failed'}`);
                return null;
            }
            const pip = this.feed?.getSeries(intent.symbol)?.pipSize || pipSizeDefault(intent.symbol);
            const settle = await monitorUntilSettled(
                buy.contractId,
                pip,
                undefined,
                settlementTimeoutMs(duration, 't')
            );
            if ('error' in settle) {
                this.log(`Settlement error: ${settle.error}`);
                return null;
            }
            const profit = settle.profit || 0;
            const result: 'win' | 'loss' = settle.isWon ? 'win' : 'loss';
            row = {
                id: ++this.idSeq,
                symbol: intent.symbol,
                name,
                contract: contractLabel(intent.contractType, intent.barrier),
                stake,
                payout: buy.payout || settle.profit || 0,
                result,
                profit,
                at: Date.now(),
            };
            if (!manual) {
                this.snap.trades += 1;
                if (result === 'win') {
                    this.snap.wins += 1;
                    this.consecutiveLosses = 0;
                    this.snap.nextStake = this.opts.stake;
                    this.log(`Contract won: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} USD`);
                } else {
                    this.snap.losses += 1;
                    this.consecutiveLosses += 1;
                    this.snap.nextStake = nextStakeAfter(this.opts.stake, this.opts.martingale, this.consecutiveLosses);
                    this.log(`Contract lost: ${profit.toFixed(2)} USD`);
                }
                this.snap.profit = Math.round((this.snap.profit + profit) * 100) / 100;
                this.snap.rows = [row, ...this.snap.rows].slice(0, 100);
                const stop = sessionStopReason(this.snap.profit, this.snap.nextStake, this.opts.takeProfit, this.opts.stopLoss);
                if (stop) this.stop(stop);
            } else {
                this.snap.rows = [row, ...this.snap.rows].slice(0, 100);
                this.log(`${result === 'win' ? 'Contract won' : 'Contract lost'}: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} USD`);
            }
            return row;
        } finally {
            this.inFlight = false;
            this.snap.busy = false;
            this.emit();
        }
    }

    dispose() {
        this.feed?.stop();
        this.feed = null;
        this.snap.running = false;
    }
}
