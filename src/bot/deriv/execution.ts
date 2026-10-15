import { Direction, TradeRecord } from '../core/types';
import { SignalAction, ContractFamily, ACTION_CONTRACT_TYPE } from '../core/signal-types';
import {
    buyContract,
    getOpenContract,
    requestLive,
    accountCurrency,
    accountBalance,
    currentSocket,
    ApiResult,
} from './api';

export interface OverUnderRequest {
    symbol: string;
    direction: Direction;
    barrier: number;
    amount: number;
    duration: number;
    durationUnit: string;
}

export interface ContractRequest {
    symbol: string;
    family: ContractFamily;
    action: SignalAction;
    barrier?: number;
    amount: number;
    duration: number;
    durationUnit: string;
}

export interface ProposalQuote {
    id: string;
    askPrice: number;
    payout: number;
    longcode: string;
    contractType: string;
    barrier: string;
    currency: string;
    minStake?: number;
    maxStake?: number;
    /** Socket the proposal was issued on — ids cannot be bought across sockets. */
    socket?: unknown;
    /** Detach from the live proposal stream (server forgets the subscription). */
    release?: () => void;
}

const contractTypeFor = (direction: Direction): string =>
    direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER';

export const buildProposalParams = (req: OverUnderRequest): Record<string, unknown> => ({
    proposal: 1,
    amount: req.amount,
    basis: 'stake',
    contract_type: contractTypeFor(req.direction),
    currency: accountCurrency(),
    duration: req.duration,
    duration_unit: req.durationUnit,
    symbol: req.symbol,
    barrier: String(req.barrier),
});

const sleep = (ms: number): Promise<void> => new Promise<void>(r => setTimeout(r, ms));

// Deriv draws `proposal`, `buy` and `proposal_open_contract` from ONE shared
// budget (360/min, 14400/hour - developers.deriv.com/docs/limits). Proposals are
// serialised through a pacing queue and retried once after a backoff when the
// budget is hit, so scanning can never starve the buy/polling calls.
const PROPOSAL_MIN_GAP_MS = 250;
const PROPOSAL_WINDOW_MS = 60000;
const PROPOSAL_MAX_PER_WINDOW = 300;
const RATE_LIMIT_BACKOFF_MS = 4000;
let lastProposalAt = 0;
let proposalStamps: number[] = [];
let proposalChain: Promise<unknown> = Promise.resolve();

const errorText = (err?: { code?: string; message?: string }): string =>
    `${err?.code || ''} ${err?.message || ''}`;

/** Human-readable detail for UI/logs - keeps the Deriv code visible (`[PriceMoved]`). */
const detailText = (err?: { code?: string; message?: string }): string => {
    const parts = [err?.message, err?.code ? `[${err.code}]` : ''].filter(Boolean);
    return parts.length ? parts.join(' ') : '';
};

const isShapeError = (err?: { code?: string; message?: string }): boolean =>
    /Input validation failed|field is not allowed|symbol,\s*underlying_symbol/i.test(errorText(err));

const isRateLimitError = (err?: { code?: string; message?: string }): boolean =>
    /rate limit/i.test(errorText(err));

const acquireProposalSlot = (): Promise<void> => {
    const run = async (): Promise<void> => {
        sweepLiveQuotes();
        const now = Date.now();
        proposalStamps = proposalStamps.filter(t => now - t < PROPOSAL_WINDOW_MS);
        if (proposalStamps.length >= PROPOSAL_MAX_PER_WINDOW) {
            const wait = PROPOSAL_WINDOW_MS - (now - proposalStamps[0]) + 100;
            await sleep(Math.max(wait, 200));
            proposalStamps = proposalStamps.filter(t => Date.now() - t < PROPOSAL_WINDOW_MS);
        }
        const gap = PROPOSAL_MIN_GAP_MS - (Date.now() - lastProposalAt);
        if (gap > 0) await sleep(gap);
        lastProposalAt = Date.now();
        proposalStamps.push(lastProposalAt);
    };
    const next = proposalChain.then(run, run);
    proposalChain = next.catch(() => undefined);
    return next;
};

// Live proposal subscriptions must not outlive their buy: every quote is
// released explicitly after the buy attempt, and this janitor catches the
// remaining paths (aborted signals, EV rejections) so no stream keeps
// ticking in the background.
const QUOTE_MAX_LIVE_MS = 45000;
const liveQuotes = new Set<{ at: number; q: ProposalQuote }>();

const sweepLiveQuotes = (): void => {
    const cutoff = Date.now() - QUOTE_MAX_LIVE_MS;
    liveQuotes.forEach(entry => {
        if (entry.at >= cutoff) return;
        liveQuotes.delete(entry);
        releaseQuote(entry.q);
    });
};

/** Idempotently detach a quote from its live proposal stream. */
export const releaseQuote = (q?: ProposalQuote | null): void => {
    const rel = q?.release;
    if (!rel) return;
    if (q) q.release = undefined;
    try {
        rel();
    } catch {
        /* stream already gone */
    }
};

const sendProposal = async (params: Record<string, unknown>): Promise<ApiResult<any> & { release?: () => void }> => {
    await acquireProposalSlot();
    let res = await requestLive({ ...params, proposal: 1 });
    if (res.error && isRateLimitError(res.error)) {
        res.release?.();
        await sleep(RATE_LIMIT_BACKOFF_MS);
        await acquireProposalSlot();
        res = await requestLive({ ...params, proposal: 1 });
    }
    return res;
};

const parseQuote = (response: any): ProposalQuote | null => {
    const p = response?.proposal;
    if (!p) return null;
    const askPrice = Number(p.ask_price);
    const payout = Number(p.payout);
    if (!Number.isFinite(askPrice) || !Number.isFinite(payout)) return null;
    return {
        id: String(p.id),
        askPrice,
        payout,
        longcode: p.longcode || '',
        contractType: p.contract_type || '',
        barrier: String(p.barrier ?? ''),
        currency: p.currency || accountCurrency(),
        minStake: Number(p.validation_params?.stake?.min) || undefined,
        maxStake: Number(p.validation_params?.stake?.max) || undefined,
    };
};

/**
 * Barriers where the contract can never win are rejected by Deriv with
 * `ContractBuyValidationError … no return`. Catch them before spending a
 * proposal request: DIGITOVER(9) needs a digit above 9, DIGITUNDER(0) below 0.
 */
const impossibleBarrierError = (params: Record<string, unknown>): string | null => {
    const ct = String(params.contract_type || '');
    if (params.barrier === undefined) return null;
    const b = Number(params.barrier);
    if (!Number.isFinite(b)) return null;
    if (ct.startsWith('DIGITOVER') && b >= 9) return `No return: ${ct}(${b}) can never win`;
    if (ct.startsWith('DIGITUNDER') && b <= 0) return `No return: ${ct}(${b}) can never win`;
    return null;
};

const VALID_DURATION_UNITS = new Set(['t', 's', 'm', 'h', 'd']);

/**
 * Reject malformed proposals before they spend a request on the shared
 * Deriv budget: stake must be positive, duration a whole number >= 1 in a
 * supported unit, and a digit barrier (when present) an integer 0–9.
 */
const validateTradeParams = (params: Record<string, unknown>): string | null => {
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return `Invalid stake: ${params.amount} — it must be a positive number`;
    }
    const duration = Number(params.duration);
    if (!Number.isInteger(duration) || duration < 1) {
        return `Invalid duration: ${params.duration} — it must be a whole number of at least 1`;
    }
    const unit = String(params.duration_unit ?? '');
    if (!VALID_DURATION_UNITS.has(unit)) {
        return `Invalid duration unit: "${params.duration_unit}" — use t (ticks), s, m, h or d`;
    }
    if (params.barrier !== undefined) {
        const b = Number(params.barrier);
        if (!Number.isInteger(b) || b < 0 || b > 9) {
            return `Invalid digit barrier: ${params.barrier} — it must be a whole number 0–9`;
        }
    }
    return null;
};

/**
 * Wall-clock window to wait for a contract to settle, sized from its own
 * duration plus head-room for polling. The old hard 60s default timed out
 * (and risked a stuck open-position slot) on any contract longer than a
 * minute — e.g. 5-minute or hourly durations.
 */
export const settlementTimeoutMs = (duration: number, durationUnit: string): number => {
    const d = Number.isFinite(duration) && duration >= 1 ? Math.floor(duration) : 1;
    const headRoom = 90000;
    switch (durationUnit) {
        case 's':
            return d * 1000 + headRoom;
        case 'm':
            return d * 60000 + headRoom;
        case 'h':
            return d * 3600000 + headRoom;
        case 'd':
            return d * 86400000 + headRoom;
        case 't':
        default:
            // Tick contracts: ~5s per tick is a safe upper bound across symbols.
            return d * 5000 + headRoom;
    }
};

/** Parse, stamp the issuing socket and drop quotes that cannot profit. */
const finalizeQuote = (
    response: any,
    release: () => void = () => undefined
): { quote?: ProposalQuote; error?: string } => {
    const quote = parseQuote(response);
    if (!quote) {
        release();
        return { error: 'Malformed proposal response' };
    }
    quote.socket = currentSocket();
    quote.release = release;
    liveQuotes.add({ at: Date.now(), q: quote });
    if (quote.payout <= quote.askPrice + 1e-9) {
        releaseQuote(quote);
        return {
            error: `No return: payout ${quote.payout.toFixed(2)} never exceeds the ${quote.askPrice.toFixed(2)} stake`,
        };
    }
    return { quote };
};

/**
 * Request a proposal on both API shapes and report the meaningful failure.
 *
 * The classic/authenticated socket accepts `symbol`; the trading/v1 socket
 * requires `underlying_symbol` and rejects `symbol` outright. When both shapes
 * fail, the second (the shape the socket actually wants) wins - reporting the
 * expected field-validation error of the first would mask the real reason
 * (rate limit, duration not offered, stake below minimum, ...).
 */
const requestProposal = async (
    params: Record<string, unknown>
): Promise<{ quote?: ProposalQuote; error?: string }> => {
    const invalid = validateTradeParams(params);
    if (invalid) return { error: invalid };
    const blocked = impossibleBarrierError(params);
    if (blocked) return { error: blocked };
    const first = await sendProposal(params);
    if (!first.error && first.data) return finalizeQuote(first.data, first.release);
    first.release?.();
    const fallbackParams = { ...params };
    delete (fallbackParams as any).symbol;
    (fallbackParams as any).underlying_symbol = params.symbol;
    const second = await sendProposal(fallbackParams);
    if (!second.error && second.data) return finalizeQuote(second.data, second.release);
    second.release?.();
    const winner =
        second.error && !isShapeError(second.error)
            ? second.error
            : first.error && !isShapeError(first.error)
              ? first.error
              : second.error || first.error;
    return { error: detailText(winner) || 'Proposal failed' };
};

export const requestQuote = async (req: OverUnderRequest): Promise<{ quote?: ProposalQuote; error?: string }> =>
    requestProposal(buildProposalParams(req));

const buildContractParams = (req: ContractRequest): Record<string, unknown> => {
    const params: Record<string, unknown> = {
        proposal: 1,
        amount: req.amount,
        basis: 'stake',
        contract_type: ACTION_CONTRACT_TYPE[req.action],
        currency: accountCurrency(),
        duration: req.duration,
        duration_unit: req.durationUnit,
        symbol: req.symbol,
    };
    if (
        req.family === 'over_under' ||
        req.family === 'match_differ' ||
        req.family === 'mean_reversion'
    ) {
        if (req.barrier !== undefined) params.barrier = String(req.barrier);
    }
    return params;
};

export const requestContractQuote = async (
    req: ContractRequest
): Promise<{ quote?: ProposalQuote; error?: string }> => requestProposal(buildContractParams(req));

export interface SimpleContractRequest {
    symbol: string;
    /** Raw Deriv contract type, e.g. DIGITOVER, DIGITEVEN, CALL. */
    contractType: string;
    barrier?: number;
    amount: number;
    duration: number;
    durationUnit: string;
}

const needsBarrier = (contractType: string): boolean =>
    contractType.startsWith('DIGITOVER') ||
    contractType.startsWith('DIGITUNDER') ||
    contractType.startsWith('DIGITMATCH') ||
    contractType.startsWith('DIGITDIFF');

/** Request a proposal for any contract type (used by the AI Bot). */
export const requestSimpleQuote = async (
    req: SimpleContractRequest
): Promise<{ quote?: ProposalQuote; error?: string }> => {
    const params: Record<string, unknown> = {
        proposal: 1,
        amount: req.amount,
        basis: 'stake',
        contract_type: req.contractType,
        currency: accountCurrency(),
        duration: req.duration,
        duration_unit: req.durationUnit,
        symbol: req.symbol,
    };
    if (req.barrier !== undefined && needsBarrier(req.contractType)) {
        params.barrier = String(req.barrier);
    }
    return requestProposal(params);
};

export interface BuyResult {
    contractId?: number;
    transactionId?: number;
    buyPrice?: number;
    error?: string;
}
export const executeBuy = async (quote: ProposalQuote, amount: number): Promise<BuyResult> => {
    // Buy at the price Deriv just quoted (basis is always `stake`, so ask_price
    // is the stake). Passing a stale/recomputed number is what triggers
    // PriceMoved rejections; Deriv's guidance is to buy against a fresh
    // proposal and pass that quote's price as the maximum.
    const price = Number.isFinite(quote.askPrice) && quote.askPrice > 0 ? quote.askPrice : amount;
    if (quote.minStake !== undefined && price + 1e-9 < quote.minStake) {
        return { error: `Stake ${price} is below the ${quote.minStake} minimum for this market` };
    }
    if (quote.maxStake !== undefined && price - 1e-9 > quote.maxStake) {
        return { error: `Stake ${price} is above the ${quote.maxStake} maximum for this market` };
    }
    const currency = accountCurrency();
    if (quote.currency && currency && quote.currency !== currency) {
        return { error: `Quote currency ${quote.currency} does not match account currency ${currency}` };
    }
    const { data, error } = await buyContract(quote.id, price);
    if (error) return { error: detailText(error) || 'Buy failed' };
    const b = data?.buy;
    if (!b) return { error: 'Empty buy response' };
    const contractId = Number(b.contract_id);
    const transactionId = Number(b.transaction_id);
    const buyPrice = Number(b.buy_price);
    if (!Number.isFinite(contractId)) return { error: 'No contract_id in buy response' };
    return { contractId, transactionId, buyPrice };
};

const RETRYABLE_BUY_RE =
    /price\s*moved|proposal\s*(expired|not\s*found|invalid)|proposal.*expired|unknown\s+contract\s+proposal|invalidcontractproposal|rate\s*limit/i;

/** True when the rejection is caused by a stale quote and a fresh one can fix it. */
export const isRetryableBuyError = (message: string): boolean => RETRYABLE_BUY_RE.test(message || '');

/**
 * `InvalidContractProposal` (the buy variant of "Unknown contract proposal") is
 * also what Deriv returns when the demo/live balance cannot cover the stake —
 * surface the actual balance so the log explains itself. `InsufficientBalance`
 * already says it outright and is left untouched.
 */
const explainBuyFailure = (error: string, amount: number): string => {
    if (!/unknown\s+contract\s+proposal|invalidcontractproposal/i.test(error)) {
        return error;
    }
    const balance = accountBalance();
    const currency = accountCurrency();
    if (balance > 0 && balance + 1e-9 < amount) {
        return `${error} — balance ${balance.toFixed(2)} ${currency} is below the ${amount.toFixed(2)} ${currency} stake: top up the account or lower the stake`;
    }
    if (balance > 0) {
        return `${error} — balance ${balance.toFixed(2)} ${currency} covers the stake; a live proposal was re-subscribed and the id was still refused (connection reset mid-trade)`;
    }
    return `${error} — a fresh quote was retried; check the account balance and WebSocket connection`;
};

/**
 * True when the market/contract cannot be traded with the current settings at
 * all (duration not offered, asset not tradable, contract type unknown). These
 * never resolve by retrying, so the market is parked instead of re-failed on
 * every scan.
 */
export const isMarketUnavailableError = (message: string): boolean =>
    /TradingDurationNotAllowed|InvalidInputAsset|InvalidContractType|MarketIsClosed|market is closed/i.test(
        message || ''
    );

/**
 * Buy against a fresh quote. If Deriv rejects the quote as stale/moved,
 * refresh it through `refetch` (which issues a brand new proposal) and retry
 * once - bots cache quotes for EV previews, and a cached id is exactly what
 * Deriv refuses.
 */
export const executeBuyFresh = async (
    quote: ProposalQuote,
    amount: number,
    refetch: () => Promise<{ quote?: ProposalQuote; error?: string }>
): Promise<BuyResult> => {
    // Buy and always detach the live proposal stream afterwards — a kept-alive
    // subscription would keep streaming (and count against the shared budget)
    // long after the trade decision was made.
    const buyOnce = async (q: ProposalQuote): Promise<BuyResult> => {
        try {
            return await executeBuy(q, amount);
        } finally {
            releaseQuote(q);
        }
    };
    let attempt = quote;
    // Proposal ids belong to the socket that issued them. If the connection was
    // regenerated since the quote (account switch, visibility refresh), the old
    // id is meaningless — silently re-quote on the live socket instead of
    // handing Deriv a dead id ("Unknown contract proposal").
    if (quote.socket !== undefined && quote.socket !== currentSocket()) {
        const fresh = await refetch();
        if (!fresh.quote) {
            releaseQuote(quote);
            return {
                error: explainBuyFailure(
                    `API connection changed during the quote (refresh failed: ${fresh.error || 'no quote'})`,
                    amount
                ),
            };
        }
        releaseQuote(quote);
        attempt = fresh.quote;
    }
    const first = await buyOnce(attempt);
    if (!first.error) return first;
    if (!isRetryableBuyError(first.error)) {
        return { error: explainBuyFailure(first.error, amount) };
    }
    const fresh = await refetch();
    if (!fresh.quote) {
        return {
            error: explainBuyFailure(
                `${first.error} (refresh failed: ${fresh.error || 'no quote'})`,
                amount
            ),
        };
    }
    const second = await buyOnce(fresh.quote);
    if (!second.error) return second;
    return { error: explainBuyFailure(second.error, amount) };
};

export interface Settlement {
    contractId: number;
    isSold: boolean;
    isWon: boolean;
    profit: number;
    sellPrice: number;
    buyPrice: number;
    entryTick?: number;
    exitTick?: number;
    entryEpoch?: number;
    exitEpoch?: number;
    exitDigit?: number;
    barrier?: number;
    status?: string;
    outcome?: string;
}

const settleFrom = (poc: any): Settlement | { error: string } => {
    const sellPrice = Number(poc.sell_price ?? poc.bid_price ?? 0);
    const buyPrice = Number(poc.buy_price ?? 0);
    const hasWinFlag = poc.is_won !== undefined && poc.is_won !== null;
    const hasProfit = poc.profit !== undefined && poc.profit !== null;
    const hasSellPrice = poc.sell_price !== undefined || poc.bid_price !== undefined;
    // A sold contract with NO outcome data must become an unknown settlement —
    // deriving profit 0 from absent prices used to fabricate a LOSS.
    if (!hasWinFlag && !hasProfit && !hasSellPrice) {
        return {
            error: `Contract #${poc.contract_id ?? '?'} sold but the server sent no outcome (is_won/profit/sell_price missing) — not recorded`,
        };
    }
    const profit = hasProfit ? Number(poc.profit) : sellPrice - buyPrice;
    const isWon = hasWinFlag ? poc.is_won === 1 || poc.is_won === true : profit > 0;
    const exitTick = poc.exit_tick !== undefined ? Number(poc.exit_tick) : undefined;
    return {
        contractId: Number(poc.contract_id),
        isSold: poc.is_sold === 1 || poc.is_sold === true || poc.is_expired === 1,
        isWon,
        profit,
        sellPrice,
        buyPrice,
        entryTick: poc.entry_tick !== undefined ? Number(poc.entry_tick) : undefined,
        exitTick,
        entryEpoch: poc.entry_tick_time !== undefined ? Number(poc.entry_tick_time) : undefined,
        exitEpoch: poc.exit_tick_time !== undefined ? Number(poc.exit_tick_time) : undefined,
        // exitDigit is derived by the caller via deriveExitDigit (pipSize-dependent).
        barrier: poc.barrier !== undefined ? Number(poc.barrier) : undefined,
        status: poc.status,
        outcome: poc.outcome,
    };
};

const deriveExitDigit = (settlement: Settlement, pipSize: number): number | undefined => {
    if (settlement.exitTick === undefined) return undefined;
    const fixed = settlement.exitTick.toFixed(pipSize);
    return Number(fixed[fixed.length - 1]);
};

export const monitorUntilSettled = async (
    contractId: number,
    pipSize: number,
    onProgress?: (poc: any) => void,
    timeoutMs = 60000,
    pollMs = 1000
): Promise<Settlement | { error: string }> => {
    const deadline = Date.now() + timeoutMs;
    let lastPoc: any = null;
    while (Date.now() < deadline) {
        const { data, error } = await getOpenContract(contractId);
        if (error) {
            await new Promise(r => setTimeout(r, pollMs));
            continue;
        }
        const poc = data?.proposal_open_contract;
        if (!poc) {
            await new Promise(r => setTimeout(r, pollMs));
            continue;
        }
        lastPoc = poc;
        onProgress?.(poc);
        if (poc.is_sold === 1 || poc.is_sold === true || poc.is_expired === 1) {
            const settlement = settleFrom(poc);
            if ('error' in settlement) return settlement;
            settlement.exitDigit = deriveExitDigit(settlement, pipSize);
            return settlement;
        }
        await new Promise(r => setTimeout(r, pollMs));
    }
    if (lastPoc) {
        const sold = lastPoc.is_sold === 1 || lastPoc.is_sold === true || lastPoc.is_expired === 1;
        if (sold) {
            const settlement = settleFrom(lastPoc);
            if ('error' in settlement) return settlement;
            settlement.exitDigit = deriveExitDigit(settlement, pipSize);
            return settlement;
        }
        return {
            error: `Settlement timeout: contract #${contractId} still open after ${timeoutMs}ms — do not record as settled`,
        };
    }
    return { error: 'Settlement timeout: no data received' };
};

export const applySettlementToRecord = (
    record: TradeRecord,
    settlement: Settlement
): TradeRecord => ({
    ...record,
    stage: 'settled',
    contractId: settlement.contractId,
    entryTick: settlement.entryTick,
    exitTick: settlement.exitTick,
    entryEpoch: settlement.entryEpoch,
    exitEpoch: settlement.exitEpoch,
    exitDigit: settlement.exitDigit,
    result: settlement.isWon ? 'win' : 'loss',
    profit: settlement.profit,
    closedAt: Date.now(),
});
