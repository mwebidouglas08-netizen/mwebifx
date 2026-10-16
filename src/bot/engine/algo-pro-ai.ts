import {
    AlgoProContractType,
    AlgoProMarket,
    AlgoProScope,
    AlgoProSignal,
    AlgoProStrategyId,
    DEFAULT_ALGO_PRO_STRATEGY,
    PairProfileId,
    PAIR_PROFILES,
    bestPairCandidate,
    isFavourable,
    lastDigitAt,
    martingaleStake,
    pairCandidateToSignal,
    pipSizeDefault,
    scopeMarkets,
    signalFromStrategy,
    signalQuality,
    tradeKey,
} from '../core/algo-pro-ai';
import { paperWon } from './signal-scanner';
import { SymbolSeries, TickFeed } from '../deriv/ticks';
import {
    ContractRequest,
    executeBuyFresh,
    isMarketUnavailableError,
    monitorUntilSettled,
    requestContractQuote,
    settlementTimeoutMs,
} from '../deriv/execution';
import { currentLoginId, getTicksHistory, isApiReady, isAuthorized } from '../deriv/api';
import { isDemoAccount } from '@/utils/account-helpers';
import { contractSpokenLabel, voiceService } from '@/services/voice-service';

export interface AlgoProSettings {
    strategyId: AlgoProStrategyId;
    scope: AlgoProScope;
    profileId: PairProfileId;
    /** One-shot orb scan as continuous gate: only trade the best digit-pair signal. */
    usePairScanner: boolean;
    pairConfidenceGate: number;
    stake: number;
    ticks: number;
    takeProfit: number;
    stopLoss: number;
    winTarget: number;
    martingale: number;
    paperTrading: boolean;
    allowLiveTrading: boolean;
    /** Minimum ms between two consecutive orders (production anti-thrash guard). */
    cooldownMs: number;
    /** Voice announcements for favourable signals + settlements. */
    voiceAnnounce: boolean;
}

export interface AlgoProMarketState {
    symbol: string;
    displayName: string;
    oneSecond: boolean;
    pipSize: number;
    lastQuote: number;
    lastDigit: number;
    digits: number[];
    prices: number[];
    signal: AlgoProSignal | null;
    pairConfidence: number;
    /** Live measured edge of the would-be trade (win-rate − house break-even). */
    signalEdge: number;
    /** True only when the measured rate clears break-even with a margin. */
    favourable: boolean;
    checked: number;
    status: string;
    trading: boolean;
}

export type AlgoProEventType = 'status' | 'discover' | 'signal' | 'purchase' | 'settlement' | 'error' | 'risk';

export interface AlgoProEvent {
    id: string;
    at: number;
    type: AlgoProEventType;
    message: string;
    symbol?: string;
    contractId?: number;
    result?: 'win' | 'loss' | 'unknown';
    profit?: number;
}

export interface AlgoProTradeRecord {
    id: string;
    symbol: string;
    displayName: string;
    contractType: AlgoProContractType;
    barrier?: number;
    stake: number;
    duration: number;
    contractId?: number;
    stage: 'confirmed' | 'settled' | 'unknown' | 'rejected';
    result?: 'win' | 'loss';
    profit?: number;
    exitDigit?: number;
    openedAt: number;
    closedAt?: number;
    error?: string;
    simulated: boolean;
}

export interface AlgoProState {
    running: boolean;
    loading: boolean;
    error: string;
    markets: AlgoProMarketState[];
    readySignals: number;
    totalProfit: number;
    activeContractId: number | null;
    activeMarket: string;
    activeSignal: string;
    lossDepth: number;
    recoveryMode: boolean;
    runCount: number;
    wins: number;
    losses: number;
    winStreakTargetHit: boolean;
    status: string;
    executionBlock: string | null;
    accountIsDemo: boolean;
    liveTrading: boolean;
    trades: AlgoProTradeRecord[];
    events: AlgoProEvent[];
    settings: AlgoProSettings;
}

export type AlgoProListener = (state: AlgoProState) => void;

const BUFFER = 64;
const EVENT_CAP = 240;
const PAPER_PAYOUT_RATIO = 0.95;

export const DEFAULT_ALGO_PRO_SETTINGS: AlgoProSettings = {
    strategyId: DEFAULT_ALGO_PRO_STRATEGY,
    scope: 'all',
    profileId: 'over2_under7',
    usePairScanner: true,
    pairConfidenceGate: 0.65,
    stake: 0.5,
    ticks: 1,
    takeProfit: 5,
    stopLoss: 30,
    winTarget: 0,
    martingale: 2,
    paperTrading: true,
    allowLiveTrading: false,
    cooldownMs: 1500,
    voiceAnnounce: true,
};

const normalizeSettings = (s: Partial<AlgoProSettings>): AlgoProSettings => {
    const base = { ...DEFAULT_ALGO_PRO_SETTINGS, ...s };
    return {
        ...base,
        stake: Math.max(0.01, Number.isFinite(base.stake) ? base.stake : 0.5),
        ticks: Math.min(10, Math.max(1, Math.round(base.ticks || 1))),
        takeProfit: Math.max(0, Number.isFinite(base.takeProfit) ? base.takeProfit : 5),
        stopLoss: Math.max(0, Number.isFinite(base.stopLoss) ? base.stopLoss : 30),
        winTarget: Math.max(0, Math.round(base.winTarget || 0)),
        martingale: Math.max(1, Number.isFinite(base.martingale) ? base.martingale : 1),
        pairConfidenceGate: Math.min(1, Math.max(0, base.pairConfidenceGate)),
        cooldownMs: Math.min(60000, Math.max(0, Number.isFinite(base.cooldownMs) ? base.cooldownMs : 1500)),
    };
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export class AlgoProEngine {
    private listeners = new Set<AlgoProListener>();
    private feed: TickFeed | null = null;
    private disposers: (() => void)[] = [];
    private generation = 0;
    private executionBusy = false;
    private lastTradeKey = '';
    private eventSeq = 0;
    private settings: AlgoProSettings | null = null;
    private tickWaiters = new Map<string, Array<(digit: number, quote: number) => void>>();
    private pipSizes = new Map<string, number>();
    /** Production anti-thrash: timestamp of the last order we fired. */
    private lastOrderAt = 0;
    /** Per-market throttle so a persistently favourable market is only spoken once. */
    private lastDetectionAt = new Map<string, number>();
    /** Watchdog: last moment any tick arrived, used to self-heal a dead feed. */
    private lastTickAt = 0;
    private watchdogTimer: ReturnType<typeof setInterval> | null = null;
    private state: AlgoProState;

    constructor() {
        this.state = {
            running: false,
            loading: false,
            error: '',
            markets: [],
            readySignals: 0,
            totalProfit: 0,
            activeContractId: null,
            activeMarket: '',
            activeSignal: '',
            lossDepth: 0,
            recoveryMode: false,
            runCount: 0,
            wins: 0,
            losses: 0,
            winStreakTargetHit: false,
            status: 'Scanner idle',
            executionBlock: null,
            accountIsDemo: true,
            liveTrading: false,
            trades: [],
            events: [],
            settings: { ...DEFAULT_ALGO_PRO_SETTINGS },
        };
    }

    subscribe = (listener: AlgoProListener): (() => void) => {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    };

    getState = (): AlgoProState => this.state;

    private update(patch: Partial<AlgoProState>) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach(l => l(this.state));
    }

    private logEvent(type: AlgoProEventType, message: string, extra: Partial<AlgoProEvent> = {}) {
        const event: AlgoProEvent = {
            id: `ap${++this.eventSeq}-${Date.now()}`,
            at: Date.now(),
            type,
            message,
            ...extra,
        };
        this.update({ events: [event, ...this.state.events].slice(0, EVENT_CAP) });
    }

    private setExecutionBlock(reason: string | null) {
        if ((this.state.executionBlock ?? null) === (reason ?? null)) return;
        this.update({ executionBlock: reason });
    }

    /** Voice hook — only speaks when the bot is armed for it AND global voice is on. */
    private say(text: string, force = false) {
        if (!this.state.settings.voiceAnnounce) return;
        voiceService.speak(text, { force });
    }

    /**
     * Announce a freshly-detected favourable signal (throttled per market so a
     * market that stays favourable doesn't repeat itself every tick).
     */
    private announceDetection(m: AlgoProMarketState) {
        if (!this.state.settings.voiceAnnounce) return;
        const now = Date.now();
        const last = this.lastDetectionAt.get(m.symbol) ?? 0;
        if (now - last < 8000) return;
        this.lastDetectionAt.set(m.symbol, now);
        voiceService.announceSignal({
            bot: 'Algo Pro AI',
            market: m.displayName,
            signal: m.signal?.label ?? contractSpokenLabel(m.signal?.contractType, m.signal?.barrier),
            confidence: m.signal?.contractType ? m.pairConfidence : undefined,
            executed: false,
        });
    }

    configure(patch: Partial<AlgoProSettings>) {
        this.settings = normalizeSettings({ ...(this.settings ?? DEFAULT_ALGO_PRO_SETTINGS), ...patch });
        this.update({ settings: this.settings });
    }

    getPerformance() {
        const trades = this.state.trades;
        return {
            profit: this.state.totalProfit,
            wins: this.state.wins,
            losses: this.state.losses,
            trades: trades.length,
        };
    }

    async start(patch?: Partial<AlgoProSettings>): Promise<void> {
        if (this.state.running || this.state.loading) return;
        if (patch) this.configure(patch);
        else if (!this.settings) this.settings = normalizeSettings({});
        const settings = this.settings!;

        if (!isApiReady()) {
            this.update({ error: 'Not connected to Deriv yet. Log in (or wait for the connection) and try again.' });
            this.logEvent('error', 'Not connected to Deriv yet. Log in (or wait for the connection) and try again.');
            return;
        }

        const authorized = isAuthorized();
        const loginid = authorized ? currentLoginId() : '';
        const accountIsDemo = authorized ? isDemoAccount(loginid) : false;
        const paper = settings.paperTrading;
        if (!paper && !authorized) {
            const msg = 'Not logged in — log in to your Deriv account, or enable Paper trading.';
            this.update({ error: msg });
            this.logEvent('error', msg);
            return;
        }

        const gen = ++this.generation;
        this.update({
            loading: true,
            error: '',
            running: false,
            status: 'Loading markets…',
            executionBlock: null,
            accountIsDemo,
            liveTrading: authorized && settings.allowLiveTrading,
        });
        this.logEvent(
            'status',
            paper
                ? 'Algo Pro AI starting in PAPER-TRADING mode (simulated fills on real ticks).'
                : `Algo Pro AI starting on ${accountIsDemo ? 'DEMO' : 'REAL'} account (${loginid}).`
        );

        const markets = scopeMarkets(settings.scope);
        const states: AlgoProMarketState[] = markets.map(m => ({
            symbol: m.symbol,
            displayName: m.displayName,
            oneSecond: m.oneSecond,
            pipSize: pipSizeDefault(m.symbol),
            lastQuote: 0,
            lastDigit: -1,
            digits: [],
            prices: [],
            signal: null,
            pairConfidence: 0,
            signalEdge: 0,
            favourable: false,
            checked: signalLookback(settings.strategyId, false),
            status: 'Waiting for ticks…',
            trading: false,
        }));
        this.update({ markets: states, status: `Warming up ${markets.length} markets…`, loading: true });

        await Promise.all(
            markets.map(async m => {
                let prices: number[] = [];
                try {
                    const hist = await getTicksHistory(m.symbol, BUFFER + 20);
                    prices = hist?.history?.prices?.map((p: any) => Number(p)).filter((p: number) => Number.isFinite(p)) || [];
                } catch {
                    // warm-up is best-effort
                }
                const seed = this.feedSeed(m.symbol, prices);
                this.pipSizes.set(m.symbol, pipSizeDefault(m.symbol));
                const idx = this.state.markets.findIndex(x => x.symbol === m.symbol);
                if (idx >= 0) {
                    const next = [...this.state.markets];
                    next[idx] = { ...next[idx], digits: seed.digits, prices: seed.prices };
                    this.update({ markets: next });
                }
            })
        );
        if (gen !== this.generation) return;

        this.feed = new TickFeed({ onTick: (symbol, _p, series) => this.onTick(symbol, series) });
        this.feed.setSymbols(markets.map(m => m.symbol));
        this.feed.start();
        this.lastTickAt = Date.now();
        this.startWatchdog(gen);
        this.update({ loading: false, running: true, status: 'Scanning' });
        this.logEvent('discover', `Scanning ${markets.length} volatility markets (${settings.scope}) — strategy ${settings.strategyId}.`);
        this.say(`Algo Pro AI started. Scanning ${markets.length} markets.`);
    }

    // -----------------------------------------------------------------------
    // Production reliability: tick watchdog
    // -----------------------------------------------------------------------

    private static readonly WATCHDOG_INTERVAL_MS = 15000;
    /** If every market has been silent this long, the socket/feed is stuck. */
    private static readonly TICK_STALL_MS = 45000;

    private startWatchdog(gen: number) {
        this.stopWatchdog();
        this.watchdogTimer = setInterval(() => {
            if (gen !== this.generation || !this.state.running) {
                this.stopWatchdog();
                return;
            }
            const stalled = Date.now() - this.lastTickAt;
            if (stalled < AlgoProEngine.TICK_STALL_MS) return;
            this.logEvent('error', `No ticks for ${Math.round(stalled / 1000)}s — resubscribing market feed.`);
            this.say('Market feed stalled. Reconnecting.');
            try {
                this.feed?.stop();
                const symbols = this.state.markets.map(m => m.symbol);
                this.feed = new TickFeed({ onTick: (symbol, _p, series) => this.onTick(symbol, series) });
                this.feed.setSymbols(symbols);
                this.feed.start();
                this.lastTickAt = Date.now();
            } catch (e: any) {
                this.logEvent('error', `Feed restart failed: ${e?.message || String(e)}`);
            }
        }, AlgoProEngine.WATCHDOG_INTERVAL_MS);
    }

    private stopWatchdog() {
        if (this.watchdogTimer !== null) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    private feedSeed(symbol: string, prices: number[]): { digits: number[]; prices: number[] } {
        const pip = this.pipSizes.get(symbol) ?? pipSizeDefault(symbol);
        const clean = prices.filter(p => Number.isFinite(p)).slice(-BUFFER);
        this.feed?.seed(symbol, pip, clean);
        return {
            prices: clean,
            digits: clean.map(p => lastDigitAt(p, pip)),
        };
    }

    stop(reason?: string) {
        const wasRunning = this.state.running;
        this.generation++;
        this.stopWatchdog();
        this.feed?.stop();
        this.feed = null;
        this.disposers.forEach(d => d());
        this.disposers = [];
        this.lastDetectionAt.clear();
        this.update({
            running: false,
            loading: false,
            status: reason ? reason : 'Scanner idle',
            markets: this.state.markets.map(m => ({ ...m, trading: false, status: 'Scanning' })),
        });
        if (wasRunning) {
            this.logEvent('status', reason || 'Scanner stopped.');
            if (reason) this.say(reason, true);
        }
        this.setExecutionBlock(null);
    }

    private onTick(symbol: string, series: SymbolSeries) {
        if (!this.state.running) return;
        this.lastTickAt = Date.now();
        const settings = this.settings!;
        const pip = this.pipSizes.get(symbol) ?? pipSizeDefault(symbol);
        const quote = series.quotes[series.quotes.length - 1];
        const digits = series.digits.slice(-BUFFER);
        const prices = series.quotes.slice(-BUFFER);
        const lastDigit = digits[digits.length - 1] ?? lastDigitAt(quote, pip);
        const idx = this.state.markets.findIndex(m => m.symbol === symbol);
        if (idx < 0) return;
        const evald = this.evaluateMarket(digits, prices, settings, this.state.recoveryMode);
        const markets = [...this.state.markets];
        const prev = markets[idx];
        const trading = !!this.state.activeContractId && this.state.activeMarket === symbol;
        markets[idx] = {
            ...prev,
            lastQuote: quote,
            lastDigit,
            digits,
            prices,
            signal: evald.signal,
            pairConfidence: evald.pairConfidence,
            signalEdge: evald.signalEdge,
            favourable: evald.favourable,
            checked: signalLookback(settings.strategyId, this.state.recoveryMode),
            trading,
            status: trading
                ? 'Trading'
                : !evald.signal
                  ? 'Scanning'
                  : evald.favourable
                    ? evald.signal.label
                    : 'Weak signal — holding',
        };
        const readySignals = markets.filter(m => this.signalEligible(m)).length;
        this.update({ markets, readySignals });

        const waiters = this.tickWaiters.get(symbol);
        if (waiters?.length) {
            this.tickWaiters.delete(symbol);
            waiters.forEach(cb => cb(lastDigit, quote));
        }

        // Voice: speak a newly-detected favourable signal (throttled) when the
        // scanner is between trades, then let the ranking loop decide execution.
        if (!this.state.activeContractId && !this.executionBusy && this.signalEligible(markets[idx])) {
            this.announceDetection(markets[idx]);
        }

        this.maybeExecute(markets[idx], quote, lastDigit);
    }

    /**
     * Compute the trade this market would take right now plus its live
     * favourability: pair mode uses the orb pair candidate (confidence gate),
     * pattern mode uses the strategy streak — BOTH must then clear the
     * measured break-even filter (isFavourable) before any order may fire.
     */
    private evaluateMarket(
        digits: number[],
        prices: number[],
        settings: AlgoProSettings,
        recoveryMode: boolean
    ): { signal: AlgoProSignal | null; pairConfidence: number; signalEdge: number; favourable: boolean } {
        const profile = PAIR_PROFILES.find(p => p.id === settings.profileId) ?? PAIR_PROFILES[1];
        const best = bestPairCandidate(digits, profile);
        const signal = settings.usePairScanner
            ? pairCandidateToSignal(best, recoveryMode)
            : signalFromStrategy(settings.strategyId, prices, digits, recoveryMode);
        if (!signal) return { signal: null, pairConfidence: best.confidence, signalEdge: 0, favourable: false };
        const quality = signalQuality(signal, digits, prices);
        return {
            signal,
            pairConfidence: best.confidence,
            signalEdge: quality.edge,
            favourable: isFavourable(quality),
        };
    }

    private signalEligible(m: AlgoProMarketState): boolean {
        const s = this.state.settings;
        if (!m.signal || !m.favourable) return false;
        if (s.usePairScanner) return m.pairConfidence >= s.pairConfidenceGate;
        return true;
    }

    private maybeExecute(_trigger: AlgoProMarketState, _quote: number, _lastDigit: number) {
        const settings = this.state.settings;
        if (!this.state.running || !settings) return;
        if (this.state.activeContractId || this.executionBusy) return;

        // Production anti-thrash: never fire two orders inside the cooldown
        // window even when several markets are favourable simultaneously.
        if (settings.cooldownMs > 0 && Date.now() - this.lastOrderAt < settings.cooldownMs) return;

        // Trade the MOST favourable eligible market, not whichever market's
        // tick happened to arrive first: rank by measured edge, then pair
        // confidence. Markets failing the favourability filter never enter.
        const eligible = this.state.markets.filter(m => this.signalEligible(m));
        if (!eligible.length) return;
        eligible.sort((a, b) => b.signalEdge - a.signalEdge || b.pairConfidence - a.pairConfidence);
        const m = eligible[0];
        const signal = m.signal;
        if (!signal) return;

        // One trade per pattern tick: symbol:epoch:contract:barrier dedupe.
        const epoch = Math.floor(m.lastQuote * 100);
        const key = tradeKey(m.symbol, epoch, signal.contractType, signal.barrier);
        if (key === this.lastTradeKey) return;

        const cfgBlock = this.executionGate(settings);
        if (cfgBlock) {
            this.setExecutionBlock(cfgBlock);
            return;
        }

        this.lastOrderAt = Date.now();
        const stake = martingaleStake(settings.stake, settings.martingale, this.state.lossDepth);
        // Never let an unexpected throw inside the order path wedge
        // executionBusy/activeContractId — that would silently kill the session.
        void this.executeSignal(m, signal, stake, key, m.lastDigit).catch(e => {
            this.executionBusy = false;
            this.update({ activeContractId: null, activeMarket: '', activeSignal: '', status: 'Scanning' });
            this.logEvent('error', `Execution failed unexpectedly: ${e?.message || String(e)}`, { symbol: m.symbol });
            this.say('Trade execution failed. Continuing to scan.');
        });
    }

    private executionGate(settings: AlgoProSettings): string | null {
        if (!this.state.running) return 'scanner stopped';
        if (settings.paperTrading) return null;
        if (!isAuthorized()) return 'not logged in — log in or enable Paper trading';
        // Re-evaluate the account at trade time: the login can switch after
        // start(), and a live flag armed on demo must never leak onto real.
        const loginid = currentLoginId();
        const accountIsDemo = loginid ? isDemoAccount(loginid) : this.state.accountIsDemo;
        if (!settings.allowLiveTrading && !accountIsDemo) {
            return 'live trading is off — switch on Live trading to place real orders';
        }
        return null;
    }

    private waitForNextTick(symbol: string, timeoutMs = 15000): Promise<{ digit: number; quote: number }> {
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

    private async executeSignal(
        m: AlgoProMarketState,
        signal: AlgoProSignal,
        stake: number,
        key: string,
        lastDigit: number
    ): Promise<void> {
        const settings = this.state.settings;
        this.executionBusy = true;
        this.lastTradeKey = key;
        this.setExecutionBlock(null);

        const contractRequest: ContractRequest = {
            symbol: m.symbol,
            family: signal.contractType === 'CALL' || signal.contractType === 'PUT' ? 'rise_fall' : signal.contractType === 'DIGITEVEN' || signal.contractType === 'DIGITODD' ? 'even_odd' : 'over_under',
            action: signal.contractType === 'DIGITOVER' ? 'OVER' : signal.contractType === 'DIGITUNDER' ? 'UNDER' : signal.contractType === 'DIGITEVEN' ? 'EVEN' : signal.contractType === 'DIGITODD' ? 'ODD' : signal.contractType === 'CALL' ? 'CALL' : 'PUT',
            barrier: signal.barrier,
            amount: stake,
            duration: settings.ticks,
            durationUnit: 't',
        };

        const recordId = `ap-${Date.now()}`;
        const openRecord: AlgoProTradeRecord = {
            id: recordId,
            symbol: m.symbol,
            displayName: m.displayName,
            contractType: signal.contractType,
            barrier: signal.barrier,
            stake,
            duration: settings.ticks,
            stage: 'confirmed',
            openedAt: Date.now(),
            simulated: settings.paperTrading,
        };

        this.update({
            activeMarket: m.symbol,
            activeSignal: signal.label,
            status: `${signal.label} on ${m.displayName}…`,
        });
        this.logEvent('signal', `${signal.label} on ${m.displayName} — ${signal.contractType}${signal.barrier !== undefined ? ` ${signal.barrier}` : ''} @ stake ${stake.toFixed(2)}`, {
            symbol: m.symbol,
        });
        voiceService.announceSignal({
            bot: 'Algo Pro AI',
            market: m.displayName,
            signal: contractSpokenLabel(signal.contractType, signal.barrier),
            confidence: m.pairConfidence,
            executed: true,
        });

        if (settings.paperTrading) {
            // Paper: settle on the next real tick using the digit rules (digit
            // contracts) or quote movement (rise/fall). No real order is placed.
            this.update({ activeContractId: 0, trades: [openRecord, ...this.state.trades], status: `Paper trade open on ${m.displayName}…` });
            this.logEvent('purchase', `PAPER (no real order): ${m.displayName} ${signal.contractType}${signal.barrier !== undefined ? ` ${signal.barrier}` : ''} — awaiting next tick`, { symbol: m.symbol });
            try {
                const tick = await this.waitForNextTick(m.symbol);
                let won: boolean;
                if (signal.contractType === 'CALL' || signal.contractType === 'PUT') {
                    const entryQuote = m.lastQuote;
                    if (!Number.isFinite(entryQuote) || entryQuote === 0) {
                        this.closeUnknown(recordId, 'no entry quote — outcome not recorded');
                        return;
                    }
                    won = signal.contractType === 'CALL' ? tick.quote > entryQuote : tick.quote < entryQuote;
                } else {
                    won = paperWon(signal.contractType, tick.digit, signal.barrier ?? 0);
                }
                const profit = won ? stake * (PAPER_PAYOUT_RATIO - 1) : -stake;
                this.settle(recordId, won, profit, tick.digit);
            } catch (e: any) {
                this.closeUnknown(recordId, e?.message || 'paper settle failed');
            } finally {
                this.executionBusy = false;
                this.update({ activeContractId: null, activeMarket: '', activeSignal: '' });
            }
            return;
        }

        this.update({ activeContractId: -1, status: `Preparing ${signal.contractType} on ${m.displayName}…` });
        const { quote: proposal, error } = await requestContractQuote(contractRequest);
        if (!proposal) {
            this.executionBusy = false;
            this.update({ activeContractId: null, activeMarket: '', activeSignal: '', status: 'Scanning' });
            this.logEvent('error', `Quote failed on ${m.displayName} ${signal.contractType}: ${error || 'no quote'}`, { symbol: m.symbol });
            if (error && isMarketUnavailableError(error)) {
                this.logEvent('error', `${m.displayName} does not offer ${settings.ticks}t contracts — skipping.`, { symbol: m.symbol });
            }
            return;
        }
        const buy = await executeBuyFresh(proposal, stake, () => requestContractQuote(contractRequest));
        if (buy.error || buy.contractId === undefined) {
            this.executionBusy = false;
            this.update({ activeContractId: null, activeMarket: '', activeSignal: '', status: 'Scanning' });
            this.update({
                trades: [
                    { ...openRecord, stage: 'rejected', error: buy.error, closedAt: Date.now() },
                    ...this.state.trades,
                ],
            });
            this.logEvent('error', `Order rejected: ${buy.error}`, { symbol: m.symbol });
            return;
        }

        const confirmed: AlgoProTradeRecord = { ...openRecord, contractId: buy.contractId, stake: buy.buyPrice ?? stake };
        this.update({
            activeContractId: buy.contractId,
            trades: [confirmed, ...this.state.trades],
            status: `${signal.contractType} placed on ${m.displayName}`,
        });
        this.logEvent('purchase', `${signal.contractType} placed on ${m.displayName} — contract #${buy.contractId} @ ${settings.ticks}t`, {
            symbol: m.symbol,
            contractId: buy.contractId,
        });

        const settlement = await monitorUntilSettled(buy.contractId, this.pipSizes.get(m.symbol) ?? pipSizeDefault(m.symbol), undefined, settlementTimeoutMs(settings.ticks, 't'));
        this.executionBusy = false;
        this.update({ activeContractId: null, activeMarket: '', activeSignal: '' });
        if ('error' in settlement) {
            this.closeUnknown(recordId, settlement.error, buy.contractId);
            return;
        }
        const won = settlement.profit > 1e-6;
        const pip = this.pipSizes.get(m.symbol) ?? pipSizeDefault(m.symbol);
        const exitDigit = settlement.exitTick !== undefined ? lastDigitAt(settlement.exitTick, pip) : undefined;
        this.settle(recordId, won, settlement.profit, exitDigit);
    }

    private closeUnknown(id: string, error: string, contractId?: number) {
        const trades = this.state.trades.map(t => (t.id === id ? { ...t, stage: 'unknown' as const, error, closedAt: Date.now(), contractId } : t));
        this.update({ trades, status: `Settlement unknown: ${error}` });
        this.logEvent('error', `Settlement unknown${contractId ? ` for #${contractId}` : ''}: ${error} — outcome not recorded, session counters untouched`, { contractId, result: 'unknown' });
    }

    private settle(id: string, won: boolean, profit: number, exitDigit?: number) {
        const settings = this.state.settings;
        const trades = this.state.trades.map(t =>
            t.id === id ? { ...t, stage: 'settled' as const, result: won ? ('win' as const) : ('loss' as const), profit, exitDigit, closedAt: Date.now() } : t
        );
        const totalProfit = Math.round((this.state.totalProfit + profit) * 1e8) / 1e8;
        const lossDepth = won ? 0 : this.state.lossDepth + 1;
        const recoveryMode = settings.strategyId.includes('recovery') && !won;
        const runCount = won ? this.state.runCount + 1 : this.state.runCount;
        const wins = won ? this.state.wins + 1 : this.state.wins;
        const losses = won ? this.state.losses : this.state.losses + 1;
        this.update({
            trades,
            totalProfit,
            lossDepth,
            recoveryMode,
            runCount,
            wins,
            losses,
            status: won ? 'Last AI trade won' : 'Last AI trade lost',
            markets: this.state.markets.map(m => {
                const evald = this.evaluateMarket(m.digits, m.prices, settings, recoveryMode);
                return {
                    ...m,
                    trading: false,
                    signal: evald.signal,
                    pairConfidence: evald.pairConfidence,
                    signalEdge: evald.signalEdge,
                    favourable: evald.favourable,
                    checked: signalLookback(settings.strategyId, recoveryMode),
                    status: !evald.signal
                        ? 'Scanning'
                        : evald.favourable
                          ? evald.signal.label
                          : 'Weak signal — holding',
                };
            }),
        });
        this.logEvent(
            'settlement',
            `${won ? 'WIN' : 'LOSS'}: ${id} — ${profit >= 0 ? '+' : ''}${round2(profit).toFixed(2)}${exitDigit !== undefined ? ` (exit digit ${exitDigit})` : ''}`,
            { result: won ? 'win' : 'loss', profit }
        );
        if (this.state.settings.voiceAnnounce) {
            const traded = this.state.trades.find(t => t.id === id);
            voiceService.announceSettlement({
                bot: 'Algo Pro AI',
                won,
                profit,
                contractType: traded?.contractType,
                market: traded?.displayName,
            });
        }

        // Session guards (kicktrade exact: "Take profit reached" / "Stop loss reached";
        // win target from Infinity Algo 1).
        if (settings.takeProfit > 0 && totalProfit + 1e-6 >= settings.takeProfit) {
            const msg = `Take profit reached: ${totalProfit.toFixed(2)}`;
            this.say(msg, true);
            this.stop(msg);
            return;
        }
        if (settings.stopLoss > 0 && totalProfit - 1e-6 <= -settings.stopLoss) {
            const msg = `Stop loss reached: ${totalProfit.toFixed(2)}`;
            this.say(msg, true);
            this.stop(msg);
            return;
        }
        if (settings.winTarget > 0 && runCount >= settings.winTarget) {
            this.update({ winStreakTargetHit: true });
            const msg = `Session completed: ${runCount} wins reached`;
            this.say(msg, true);
            this.stop(msg);
        }
    }
}

const signalLookback = (strategyId: AlgoProStrategyId, recoveryMode: boolean): number => {
    if (recoveryMode) return 5;
    return strategyId.endsWith('-ai') ? 5 : 2;
};

export const algoProEngine = new AlgoProEngine();
