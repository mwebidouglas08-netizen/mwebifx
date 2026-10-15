import { MarketCategory, TradeRecord } from '../core/types';
import { ContractFamily, SignalAction } from '../core/signal-types';
import { pipSizeDefault } from '../core/algo-pro-ai';
import {
    ContractRequest,
    applySettlementToRecord,
    executeBuyFresh,
    monitorUntilSettled,
    releaseQuote,
    requestContractQuote,
    settlementTimeoutMs,
} from '../deriv/execution';
import { currentLoginId, getTicksHistory, isApiReady, isAuthorized } from '../deriv/api';
import { SymbolSeries, TickFeed } from '../deriv/ticks';
import { isDemoAccount } from '@/utils/account-helpers';
import { paperWon } from './signal-scanner';

/** Log line rendered by the bulk-trader page (mirrors the scanner event shape). */
export type EngineLogEvent = {
    id: string;
    at: number;
    type: 'info' | 'success' | 'warn' | 'error' | 'quote' | 'purchase' | 'settlement' | 'risk';
    message: string;
    contractId?: number;
    profit?: number;
    result?: 'win' | 'loss';
};

export interface BulkTradeConfig {
    symbol: string;
    contractType: 'DIGITOVER' | 'DIGITUNDER' | 'CALL' | 'PUT';
    /** Digit prediction for DIGIT* contracts (e.g. '4'); ignored for CALL/PUT. */
    barrier: string;
    stake: number;
    /** Orders per run, 1..50. */
    count: number;
    duration: number;
    durationUnit: 't' | 's' | 'm';
    paperTrading: boolean;
    allowLiveTrading: boolean;
    maxConcurrent: number;
}

export const DEFAULT_BULK_CONFIG: BulkTradeConfig = {
    symbol: 'R_75',
    contractType: 'DIGITOVER',
    barrier: '4',
    stake: 1,
    count: 5,
    duration: 1,
    durationUnit: 't',
    paperTrading: true,
    allowLiveTrading: false,
    maxConcurrent: 3,
};

export interface BulkProgress {
    requested: number;
    bought: number;
    settled: number;
    won: number;
    lost: number;
    failed: number;
}

export interface BulkTraderState {
    status: 'idle' | 'starting' | 'running' | 'stopping' | 'error';
    message: string;
    config: BulkTradeConfig;
    progress: BulkProgress;
    trades: TradeRecord[];
    events: EngineLogEvent[];
    accountIsDemo: boolean;
}

const EVENT_CAP = 240;
/** Deriv rate-limits order traffic — space individual buys inside the queue. */
const BUY_SPACING_MS = 300;
/** Deriv's minimum order stake. */
const MIN_ORDER_STAKE = 0.35;
const MAX_COUNT = 50;
const MAX_CONCURRENT = 10;
const PAPER_TICK_TIMEOUT_MS = 15000;

const clampInt = (value: number, min: number, max: number): number => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
};

const FAMILY_OF: Record<BulkTradeConfig['contractType'], ContractFamily> = {
    DIGITOVER: 'over_under',
    DIGITUNDER: 'over_under',
    CALL: 'rise_fall',
    PUT: 'rise_fall',
};

const ACTION_OF: Record<BulkTradeConfig['contractType'], SignalAction> = {
    DIGITOVER: 'OVER',
    DIGITUNDER: 'UNDER',
    CALL: 'CALL',
    PUT: 'PUT',
};

const barrierNumber = (cfg: BulkTradeConfig): number | undefined => {
    if (cfg.contractType !== 'DIGITOVER' && cfg.contractType !== 'DIGITUNDER') return undefined;
    const b = Number(cfg.barrier);
    return Number.isFinite(b) ? b : undefined;
};

const categoryFor = (symbol: string): MarketCategory =>
    /^1HZ\d+V$/i.test(symbol) || /^R_\d+$/i.test(symbol) ? 'volatility' : 'other';

const empiricalProbFor = (cfg: BulkTradeConfig): number => {
    const b = Number(cfg.barrier);
    if (cfg.contractType === 'DIGITOVER') return Number.isFinite(b) ? (9 - b) / 10 : 0.5;
    if (cfg.contractType === 'DIGITUNDER') return Number.isFinite(b) ? b / 10 : 0.5;
    return 0.5;
};

/** Estimated payout ratio for a simulated (paper) order — same 0.95-edge model the scanner uses. */
const estimatePaperPayoutRatio = (prob: number): number => {
    const p = Math.min(Math.max(prob, 0.1), 0.9);
    return Math.min(Math.max(0.95 / p, 1.05), 2.0);
};

/** Paper settle decision — rise/fall needs two quotes, digit contracts use one tick's digit. */
const paperResult = (
    cfg: BulkTradeConfig,
    digit: number,
    quote: number,
    prevQuote: number | undefined
): boolean => {
    if (cfg.contractType === 'CALL') return prevQuote !== undefined ? quote > prevQuote : false;
    if (cfg.contractType === 'PUT') return prevQuote !== undefined ? quote < prevQuote : false;
    return paperWon(ACTION_OF[cfg.contractType], digit, barrierNumber(cfg) ?? 0);
};

const sleep = (ms: number): Promise<void> => new Promise<void>(r => setTimeout(r, ms));

interface TickValue {
    digit: number;
    quote: number;
    prevQuote?: number;
}

/**
 * Bulk Trader — fires up to 50 parallel orders of one contract on one market
 * through a bounded concurrency queue (structure mirrors `signal-scanner.ts`).
 *
 * Paper mode simulates each fill and settles it on the next real tick of the
 * same feed; live/demo mode quotes once per order, buys through
 * `executeBuyFresh` and monitors with `monitorUntilSettled`. Real orders on a
 * REAL account are refused unless `allowLiveTrading` is explicitly enabled.
 */
export class BulkTraderEngine {
    private listeners = new Set<(state: BulkTraderState) => void>();
    private state: BulkTraderState;
    private running = false;
    private runActive = false;
    private queueDone = false;
    private emergencyEngaged = false;
    private eventSeq = 0;
    private tradeSeq = 0;
    private openMonitors = 0;
    private feed: TickFeed | null = null;
    private tickWaiters = new Map<string, Array<(value: TickValue) => void>>();

    constructor() {
        this.state = {
            status: 'idle',
            message: 'Idle',
            config: { ...DEFAULT_BULK_CONFIG },
            progress: { requested: 0, bought: 0, settled: 0, won: 0, lost: 0, failed: 0 },
            trades: [],
            events: [],
            accountIsDemo: true,
        };
    }

    subscribe = (listener: (state: BulkTraderState) => void): (() => void) => {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    };

    getState = (): BulkTraderState => this.state;

    private update(patch: Partial<BulkTraderState>) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach(l => l(this.state));
    }

    private setStatus(status: BulkTraderState['status'], message: string) {
        this.update({ status, message });
    }

    logEvent(type: EngineLogEvent['type'], message: string, extra: Partial<EngineLogEvent> = {}) {
        const event: EngineLogEvent = {
            id: `bulk-${++this.eventSeq}-${Date.now()}`,
            at: Date.now(),
            type,
            message,
            ...extra,
        };
        const events = [event, ...this.state.events].slice(0, EVENT_CAP);
        this.update({ events });
    }

    /** Merge a config patch; order count and concurrency are clamped to sane bounds. */
    configure(patch: Partial<BulkTradeConfig>) {
        const config = { ...this.state.config, ...patch };
        config.count = clampInt(config.count, 1, MAX_COUNT);
        config.maxConcurrent = clampInt(config.maxConcurrent, 1, MAX_CONCURRENT);
        this.update({ config });
    }

    private bump(patch: Partial<BulkProgress>) {
        const p = this.state.progress;
        this.update({
            progress: {
                requested: p.requested + (patch.requested ?? 0),
                bought: p.bought + (patch.bought ?? 0),
                settled: p.settled + (patch.settled ?? 0),
                won: p.won + (patch.won ?? 0),
                lost: p.lost + (patch.lost ?? 0),
                failed: p.failed + (patch.failed ?? 0),
            },
        });
    }

    /**
     * Start a bulk run. Resolves once every order attempt has been dispatched;
     * open contracts keep monitoring in the background until they settle.
     */
    async start(config?: Partial<BulkTradeConfig>): Promise<void> {
        if (this.runActive) return;
        if (config) this.configure(config);
        const cfg = this.state.config;

        if (!isApiReady()) {
            this.setStatus('error', 'Connecting to Deriv market data… try again in a moment.');
            this.logEvent('error', 'Not connected to Deriv yet. Log in (or wait for the connection) and try again.');
            return;
        }

        const authorized = isAuthorized();
        const loginid = authorized ? currentLoginId() : '';
        const accountIsDemo = authorized ? isDemoAccount(loginid) : false;
        this.update({ accountIsDemo });

        if (!cfg.paperTrading) {
            if (!authorized) {
                this.setStatus('error', 'Live orders need a logged-in Deriv account — log in, or turn on Paper trading.');
                this.logEvent('error', 'Bulk run refused: no logged-in Deriv account (live mode).');
                return;
            }
            if (!accountIsDemo && !cfg.allowLiveTrading) {
                this.setStatus('error', 'Real account: enable Live trading before placing real orders.');
                this.logEvent(
                    'risk',
                    'Bulk run refused on a REAL account — Live trading is off. Enable Live trading (or Paper trading) to continue.'
                );
                return;
            }
        }

        this.runActive = true;
        this.running = true;
        this.queueDone = false;
        this.emergencyEngaged = false;
        this.tradeSeq = 0;
        this.update({
            progress: { requested: cfg.count, bought: 0, settled: 0, won: 0, lost: 0, failed: 0 },
            trades: [],
        });
        const barrierText = barrierNumber(cfg) !== undefined ? `(${barrierNumber(cfg)})` : '';
        this.logEvent(
            'info',
            cfg.paperTrading
                ? `Bulk run starting in PAPER mode: ${cfg.count} × ${cfg.contractType}${barrierText} on ${cfg.symbol} (simulated fills).`
                : `Bulk run starting on ${accountIsDemo ? 'DEMO' : 'REAL'} account: ${cfg.count} × ${cfg.contractType}${barrierText} on ${cfg.symbol}.`
        );

        this.setStatus('starting', `Preparing ${cfg.count} orders…`);

        if (cfg.paperTrading) {
            this.feed = new TickFeed({
                onTick: (symbol, _point, series) => this.onTick(symbol, series),
            });
            this.feed.setSymbols([cfg.symbol]);
            try {
                const hist = await getTicksHistory(cfg.symbol, 40);
                const prices: number[] = hist?.history?.prices?.map((p: any) => Number(p)) || [];
                this.feed.seed(cfg.symbol, 2, prices.filter(p => Number.isFinite(p)));
            } catch {
                // history warm-up is best-effort
            }
            this.feed.start();
        }

        this.setStatus('running', `Placing ${cfg.count} orders…`);
        await this.runQueue();
        this.queueDone = true;
        this.running = false;
        if (this.state.status === 'running') {
            this.setStatus(
                'running',
                this.openMonitors > 0 ? `Monitoring ${this.openMonitors} open contract(s)…` : 'Orders dispatched.'
            );
        }
        this.maybeFinalize();
    }

    /** Graceful stop: no new orders; already-open contracts keep monitoring. */
    stop(): void {
        if (!this.runActive) {
            if (this.state.status !== 'idle') this.setStatus('idle', 'Stopped');
            return;
        }
        const wasRunning = this.running;
        this.running = false;
        if (wasRunning) this.logEvent('info', 'Stopping — no new orders will be placed.');
        if (wasRunning || this.openMonitors > 0) {
            this.setStatus(
                'stopping',
                this.openMonitors > 0
                    ? `Stopping — monitoring ${this.openMonitors} open contract(s)…`
                    : 'Stopping — no new orders will be placed.'
            );
        }
        this.maybeFinalize();
    }

    /**
     * Stop hard. Open contracts cannot be cancelled — this app exposes no sell
     * API, so they are logged as remaining open and settle on their own.
     */
    emergencyStop(): void {
        this.emergencyEngaged = true;
        this.stop();
        const open = this.openMonitors;
        this.logEvent(
            'risk',
            `Emergency stop engaged — new orders halted.${
                open > 0
                    ? ` ${open} open contract(s) remain open: this app has no sell API, so they settle on their own.`
                    : ''
            }`
        );
        if (!this.runActive) this.update({ status: 'idle', message: 'Emergency stop engaged' });
    }

    private async runQueue(): Promise<void> {
        const cfg = this.state.config;
        const total = cfg.count;
        let nextIndex = 0;
        const worker = async (): Promise<void> => {
            while (this.running) {
                if (nextIndex >= total) return;
                const index = nextIndex;
                nextIndex += 1;
                try {
                    await this.buyOne(index);
                } catch (e: any) {
                    this.bump({ failed: 1 });
                    this.logEvent('error', `Order ${index + 1} failed: ${e?.message || 'unexpected error'}`);
                }
                if (!cfg.paperTrading && this.running && nextIndex < total) await sleep(BUY_SPACING_MS);
            }
        };
        const workers = Array.from({ length: Math.min(cfg.maxConcurrent, total) }, () => worker());
        await Promise.all(workers);
    }

    private async buyOne(index: number): Promise<void> {
        const cfg = this.state.config;
        if (!this.running) return;
        if (cfg.paperTrading) {
            this.paperBuy(index);
            return;
        }

        // Re-evaluate the ACTIVE account before every live order: the login can
        // switch mid-run, and a demo snapshot must never authorize real orders
        // without the Live-trading arm (or block a now-active demo).
        const authorized = isAuthorized();
        const loginid = authorized ? currentLoginId() : '';
        const accountIsDemo = authorized ? isDemoAccount(loginid) : false;
        if (accountIsDemo !== this.state.accountIsDemo) {
            this.update({ accountIsDemo });
            this.logEvent('info', `Active account switched to ${accountIsDemo ? 'DEMO' : 'REAL'} (${loginid || 'no session'}) — execution gate re-evaluated.`);
        }
        if (!authorized) {
            this.logEvent('error', 'No logged-in Deriv account before a live order — stopping the run.');
            this.stop();
            return;
        }
        if (!accountIsDemo && !cfg.allowLiveTrading) {
            this.logEvent('risk', 'REAL account active but Live trading is off — stopping the run before any real order.');
            this.stop();
            return;
        }

        const stake = cfg.stake;
        const barrier = barrierNumber(cfg);
        const quoteReq: ContractRequest = {
            symbol: cfg.symbol,
            family: FAMILY_OF[cfg.contractType],
            action: ACTION_OF[cfg.contractType],
            barrier,
            amount: stake,
            duration: cfg.duration,
            durationUnit: cfg.durationUnit,
        };
        const { quote, error } = await requestContractQuote(quoteReq);
        if (!quote) {
            this.bump({ failed: 1 });
            this.logEvent('error', `Quote failed for order ${index + 1}/${cfg.count}: ${error || 'no quote'}`);
            return;
        }
        if (!this.running) {
            releaseQuote(quote);
            this.logEvent('warn', `Stopped before order ${index + 1} could be placed.`);
            return;
        }
        this.logEvent(
            'quote',
            `Quote ${index + 1}/${cfg.count}: ${cfg.symbol} ${cfg.contractType}${barrier !== undefined ? `(${barrier})` : ''} — payout ${quote.payout.toFixed(2)} (stake ${stake.toFixed(2)})`
        );

        const record = this.buildRecord(quote.payout, stake, false, 'proposed');
        const buy = await executeBuyFresh(quote, stake, () => requestContractQuote(quoteReq));
        if (buy.error || buy.contractId === undefined) {
            this.update({
                trades: [{ ...record, stage: 'rejected', error: buy.error, closedAt: Date.now() }, ...this.state.trades],
            });
            this.bump({ failed: 1 });
            this.logEvent('error', `Order ${index + 1} rejected: ${buy.error || 'no contract id'}`);
            return;
        }
        const confirmed: TradeRecord = {
            ...record,
            stage: 'confirmed',
            contractId: buy.contractId,
            transactionId: buy.transactionId,
            stake: buy.buyPrice ?? stake,
        };
        this.update({ trades: [confirmed, ...this.state.trades] });
        this.bump({ bought: 1 });
        this.logEvent(
            'purchase',
            `Purchased #${buy.contractId}: ${cfg.symbol} ${cfg.contractType} @ ${cfg.duration}${cfg.durationUnit}`,
            { contractId: buy.contractId }
        );
        this.monitorLive(confirmed);
    }

    private buildRecord(
        payout: number,
        stake: number,
        simulated: boolean,
        stage: TradeRecord['stage']
    ): TradeRecord {
        const cfg = this.state.config;
        return {
            id: `bulk-${Date.now()}-${++this.tradeSeq}`,
            symbol: cfg.symbol,
            displayName: cfg.symbol,
            category: categoryFor(cfg.symbol),
            contractType: cfg.contractType as any,
            direction: cfg.contractType === 'DIGITUNDER' || cfg.contractType === 'PUT' ? 'under' : 'over',
            barrier: barrierNumber(cfg) ?? 0,
            duration: cfg.duration,
            durationUnit: cfg.durationUnit,
            stake,
            payout,
            payoutRatio: stake > 0 ? payout / stake : 0,
            empiricalProb: empiricalProbFor(cfg),
            expectedValue: 0,
            confidence: 0,
            stage,
            openedAt: Date.now(),
            simulated,
        };
    }

    private monitorLive(record: TradeRecord) {
        const cfg = this.state.config;
        this.openMonitors += 1;
        void (async () => {
            try {
                const settlement = await monitorUntilSettled(
                    record.contractId as number,
                    pipSizeDefault(record.symbol),
                    undefined,
                    settlementTimeoutMs(cfg.duration, cfg.durationUnit)
                );
                if ('error' in settlement) {
                    // The contract is still open or the outcome is unknown —
                    // count it as failed so requested = settled + failed always
                    // holds, and the record stays unsettled (never a fake win/loss).
                    this.update({
                        trades: [
                            { ...record, error: settlement.error, closedAt: Date.now() },
                            ...this.state.trades.filter(t => t.id !== record.id),
                        ],
                    });
                    this.bump({ failed: 1 });
                    this.logEvent(
                        'error',
                        `Settlement pending for #${record.contractId}: ${settlement.error} — counted as failed`,
                        { contractId: record.contractId }
                    );
                    return;
                }
                const settled = applySettlementToRecord(record, settlement);
                const won = settled.result === 'win';
                this.update({
                    trades: [settled, ...this.state.trades.filter(t => t.id !== record.id)],
                });
                this.bump({ settled: 1, won: won ? 1 : 0, lost: won ? 0 : 1 });
                this.logEvent(
                    'settlement',
                    `${won ? 'WIN' : 'LOSS'}: #${settled.contractId} ${settled.symbol} ${settled.contractType} — ${settled.profit >= 0 ? '+' : ''}${settled.profit.toFixed(2)}`,
                    { contractId: settled.contractId, result: settled.result, profit: settled.profit }
                );
            } catch (e: any) {
                this.update({
                    trades: [
                        { ...record, error: e?.message || 'settlement error', closedAt: Date.now() },
                        ...this.state.trades.filter(t => t.id !== record.id),
                    ],
                });
                this.bump({ failed: 1 });
                this.logEvent(
                    'error',
                    `Settlement failed for #${record.contractId}: ${e?.message || 'unexpected error'} — counted as failed`,
                    { contractId: record.contractId }
                );
            } finally {
                this.openMonitors -= 1;
                this.maybeFinalize();
            }
        })();
    }

    private paperBuy(index: number): void {
        const cfg = this.state.config;
        const stake = cfg.stake;
        const payoutRatio = estimatePaperPayoutRatio(empiricalProbFor(cfg));
        const record = this.buildRecord(stake * payoutRatio, stake, true, 'confirmed');
        this.update({ trades: [record, ...this.state.trades] });
        this.bump({ bought: 1 });
        this.logEvent(
            'purchase',
            `PAPER (no real order) ${index + 1}/${cfg.count}: ${cfg.symbol} ${cfg.contractType} — awaiting next tick`
        );

        this.openMonitors += 1;
        this.waitForNextTick(cfg.symbol, PAPER_TICK_TIMEOUT_MS)
            .then(({ digit, quote, prevQuote }) => {
                const won = paperResult(cfg, digit, quote, prevQuote);
                const profit = won ? stake * (record.payoutRatio - 1) : -stake;
                const settled: TradeRecord = {
                    ...record,
                    stage: 'settled',
                    exitDigit: digit,
                    result: won ? 'win' : 'loss',
                    profit,
                    closedAt: Date.now(),
                };
                this.update({ trades: [settled, ...this.state.trades.filter(t => t.id !== record.id)] });
                this.bump({ settled: 1, won: won ? 1 : 0, lost: won ? 0 : 1 });
                this.logEvent(
                    'settlement',
                    `PAPER ${won ? 'WIN' : 'LOSS'}: ${cfg.symbol} ${cfg.contractType} — exit digit ${digit} — ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} (simulated)`,
                    { result: won ? 'win' : 'loss', profit }
                );
            })
            .catch((e: any) => {
                // Bought but never settled — count as failed so the run's
                // requested = settled + failed accounting still holds.
                this.update({
                    trades: [
                        { ...record, error: e?.message || 'paper settle error', closedAt: Date.now() },
                        ...this.state.trades.filter(t => t.id !== record.id),
                    ],
                });
                this.bump({ failed: 1 });
                this.logEvent('error', `PAPER settle failed: ${e?.message || 'unexpected error'} — counted as failed`);
            })
            .finally(() => {
                this.openMonitors -= 1;
                this.maybeFinalize();
            });
    }

    private onTick(symbol: string, series: SymbolSeries) {
        const waiters = this.tickWaiters.get(symbol);
        if (!waiters || !waiters.length) return;
        this.tickWaiters.delete(symbol);
        const digits = series?.digits ?? [];
        const quotes = series?.quotes ?? [];
        const value: TickValue = {
            digit: digits.length ? digits[digits.length - 1] : 0,
            quote: quotes.length ? quotes[quotes.length - 1] : 0,
            prevQuote: quotes.length > 1 ? quotes[quotes.length - 2] : undefined,
        };
        waiters.forEach(cb => cb(value));
    }

    /** Resolve on the next real tick for `symbol`, or reject after `timeoutMs`. */
    private waitForNextTick(symbol: string, timeoutMs: number): Promise<TickValue> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const list = this.tickWaiters.get(symbol) || [];
                this.tickWaiters.set(symbol, list.filter(cb => cb !== handler));
                reject(new Error(`No tick for ${symbol} within ${timeoutMs}ms`));
            }, timeoutMs);
            const handler = (value: TickValue) => {
                clearTimeout(timer);
                resolve(value);
            };
            const list = this.tickWaiters.get(symbol) || [];
            list.push(handler);
            this.tickWaiters.set(symbol, list);
        });
    }

    private maybeFinalize() {
        if (!this.runActive || this.running || !this.queueDone || this.openMonitors > 0) return;
        this.runActive = false;
        if (this.feed) {
            this.feed.stop();
            this.feed = null;
        }
        this.tickWaiters.clear();
        const p = this.state.progress;
        const summary = this.emergencyEngaged
            ? 'Emergency stop engaged'
            : `Completed ${p.settled}/${p.requested} — ${p.won} won, ${p.lost} lost${p.failed ? `, ${p.failed} failed` : ''}`;
        this.setStatus('idle', summary);
        this.logEvent('success', `Bulk run finished: ${p.settled} settled (${p.won}W / ${p.lost}L), ${p.failed} failed.`);
    }
}

export const bulkTrader = new BulkTraderEngine();
