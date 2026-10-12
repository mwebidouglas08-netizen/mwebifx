import { Direction, TradeRecord } from '../core/types';
import { SignalAction, ContractFamily, ACTION_CONTRACT_TYPE } from '../core/signal-types';
import { buyContract, getOpenContract, getProposal, accountCurrency, ApiResult } from './api';

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

const sendProposal = async (params: Record<string, unknown>): Promise<ApiResult<any>> => {
    await acquireProposalSlot();
    let res = await getProposal(params);
    if (res.error && isRateLimitError(res.error)) {
        await sleep(RATE_LIMIT_BACKOFF_MS);
        await acquireProposalSlot();
        res = await getProposal(params);
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
    const first = await sendProposal(params);
    if (!first.error && first.data) {
        const quote = parseQuote(first.data);
        if (quote) return { quote };
        return { error: 'Malformed proposal response' };
    }
    const fallbackParams = { ...params };
    delete (fallbackParams as any).symbol;
    (fallbackParams as any).underlying_symbol = params.symbol;
    const second = await sendProposal(fallbackParams);
    if (!second.error && second.data) {
        const quote = parseQuote(second.data);
        if (quote) return { quote };
        return { error: 'Malformed proposal response' };
    }
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

const RETRYABLE_BUY_RE = /price\s*moved|proposal\s*(expired|not\s*found|invalid)|proposal.*expired|rate\s*limit/i;

/** True when the rejection is caused by a stale quote and a fresh one can fix it. */
export const isRetryableBuyError = (message: string): boolean => RETRYABLE_BUY_RE.test(message || '');

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
    const first = await executeBuy(quote, amount);
    if (!first.error || !isRetryableBuyError(first.error)) return first;
    const fresh = await refetch();
    if (!fresh.quote) {
        return { error: `${first.error} (refresh failed: ${fresh.error || 'no quote'})` };
    }
    const second = await executeBuy(fresh.quote, amount);
    if (!second.error) return second;
    return { error: `${second.error}` };
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

const settleFrom = (poc: any): Settlement => {
    const sellPrice = Number(poc.sell_price ?? poc.bid_price ?? 0);
    const buyPrice = Number(poc.buy_price ?? 0);
    const profit = Number(poc.profit ?? sellPrice - buyPrice);
    const isWon = poc.is_won === 1 || poc.is_won === true || profit > 0;
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
        exitDigit:
            exitTick !== undefined && poc.exit_tick_time !== undefined
                ? undefined
                : undefined,
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
            settlement.exitDigit = deriveExitDigit(settlement, pipSize);
            return settlement;
        }
        await new Promise(r => setTimeout(r, pollMs));
    }
    if (lastPoc) {
        const settlement = settleFrom(lastPoc);
        settlement.exitDigit = deriveExitDigit(settlement, pipSize);
        return settlement;
    }
    return { error: 'Settlement timeout' };
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
