import { Direction, TradeRecord } from '../core/types';
import { SignalAction, ContractFamily, ACTION_CONTRACT_TYPE } from '../core/signal-types';
import { buyContract, getOpenContract, getProposal, accountCurrency } from './api';

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

export const requestQuote = async (req: OverUnderRequest): Promise<{ quote?: ProposalQuote; error?: string }> => {
    const params = buildProposalParams(req);
    const first = await getProposal(params);
    if (!first.error && first.data) {
        const quote = parseQuote(first.data);
        if (quote) return { quote };
    }
    const fallbackParams = { ...params };
    delete (fallbackParams as any).symbol;
    (fallbackParams as any).underlying_symbol = req.symbol;
    const second = await getProposal(fallbackParams);
    if (!second.error && second.data) {
        const quote = parseQuote(second.data);
        if (quote) return { quote };
    }
    const err = first.error || second.error;
    return { error: err?.message || err?.code || 'Proposal failed' };
};

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
    if (req.family === 'over_under' || req.family === 'match_differ') {
        if (req.barrier !== undefined) params.barrier = String(req.barrier);
    }
    return params;
};

export const requestContractQuote = async (
    req: ContractRequest
): Promise<{ quote?: ProposalQuote; error?: string }> => {
    const params = buildContractParams(req);
    const first = await getProposal(params);
    if (!first.error && first.data) {
        const quote = parseQuote(first.data);
        if (quote) return { quote };
    }
    const fallbackParams = { ...params };
    delete (fallbackParams as any).symbol;
    (fallbackParams as any).underlying_symbol = req.symbol;
    const second = await getProposal(fallbackParams);
    if (!second.error && second.data) {
        const quote = parseQuote(second.data);
        if (quote) return { quote };
    }
    const err = first.error || second.error;
    return { error: err?.message || err?.code || 'Proposal failed' };
};

export interface BuyResult {
    contractId?: number;
    transactionId?: number;
    buyPrice?: number;
    error?: string;
}

export const executeBuy = async (quote: ProposalQuote, amount: number): Promise<BuyResult> => {
    const { data, error } = await buyContract(quote.id, amount);
    if (error) return { error: error.message || error.code || 'Buy failed' };
    const b = data?.buy;
    if (!b) return { error: 'Empty buy response' };
    const contractId = Number(b.contract_id);
    const transactionId = Number(b.transaction_id);
    const buyPrice = Number(b.buy_price);
    if (!Number.isFinite(contractId)) return { error: 'No contract_id in buy response' };
    return { contractId, transactionId, buyPrice };
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
