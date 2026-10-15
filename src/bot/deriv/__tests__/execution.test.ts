jest.mock('../api', () => ({
    buyContract: jest.fn(),
    getOpenContract: jest.fn(),
    requestLive: jest.fn(),
    accountCurrency: jest.fn(() => 'USD'),
    accountBalance: jest.fn(() => 1000),
    currentSocket: jest.fn(() => 'sock-1'),
}));

import { executeBuy, monitorUntilSettled, requestQuote, settlementTimeoutMs } from '../execution';
import * as api from '../api';

const validReq = {
    symbol: 'R_75',
    direction: 'over' as const,
    barrier: 2,
    amount: 1,
    duration: 1,
    durationUnit: 't',
};

describe('requestQuote — input validation (regression: no validation before)', () => {
    beforeEach(() => {
        (api.requestLive as jest.Mock).mockReset();
    });

    it('accepts a valid request and reaches the proposal API', async () => {
        (api.requestLive as jest.Mock).mockResolvedValue({
            data: {
                proposal: {
                    id: 'p1',
                    ask_price: 1,
                    payout: 1.95,
                    contract_type: 'DIGITOVER',
                    barrier: '2',
                    currency: 'USD',
                },
            },
        });
        const { quote, error } = await requestQuote(validReq);
        expect(error).toBeUndefined();
        expect(quote?.id).toBe('p1');
        expect(api.requestLive).toHaveBeenCalled();
    });

    it.each([
        ['barrier above 9', { barrier: 10 }],
        ['negative barrier', { barrier: -1 }],
        ['fractional barrier', { barrier: 2.5 }],
    ])('refuses %s without spending a proposal request', async (_label, patch) => {
        const { quote, error } = await requestQuote({ ...validReq, ...patch });
        expect(quote).toBeUndefined();
        expect(error).toContain('barrier');
        expect(api.requestLive).not.toHaveBeenCalled();
    });

    it.each([
        ['zero stake', { amount: 0 }],
        ['negative stake', { amount: -2 }],
        ['non-numeric stake', { amount: Number.NaN }],
    ])('refuses %s without spending a proposal request', async (_label, patch) => {
        const { error } = await requestQuote({ ...validReq, ...patch });
        expect(error).toContain('stake');
        expect(api.requestLive).not.toHaveBeenCalled();
    });

    it.each([
        ['zero duration', { duration: 0 }],
        ['fractional duration', { duration: 1.5 }],
        ['negative duration', { duration: -1 }],
    ])('refuses %s without spending a proposal request', async (_label, patch) => {
        const { error } = await requestQuote({ ...validReq, ...patch });
        expect(error).toContain('duration');
        expect(api.requestLive).not.toHaveBeenCalled();
    });

    it('refuses an unsupported duration unit', async () => {
        const { error } = await requestQuote({ ...validReq, durationUnit: 'x' });
        expect(error).toContain('duration unit');
        expect(api.requestLive).not.toHaveBeenCalled();
    });

    it('still refuses an impossible barrier (DIGITOVER 9 can never win)', async () => {
        // 9 is a valid integer 0–9, but DIGITOVER(9) has no winning digit.
        const { error } = await requestQuote({ ...validReq, barrier: 9 });
        expect(error).toContain('No return');
        expect(api.requestLive).not.toHaveBeenCalled();
    });

    it('accepts the boundary barriers that can still win', async () => {
        (api.requestLive as jest.Mock).mockResolvedValue({
            data: {
                proposal: {
                    id: 'p2',
                    ask_price: 1,
                    payout: 9.5,
                    contract_type: 'DIGITOVER',
                    barrier: '0',
                    currency: 'USD',
                },
            },
        });
        const { quote, error } = await requestQuote({ ...validReq, barrier: 0 });
        expect(error).toBeUndefined();
        expect(quote?.id).toBe('p2');
    });
});

describe('settlementTimeoutMs (regression: hard 60s default killed long durations)', () => {
    it('gives 1-tick contracts a 95s window (5s tick + 90s head-room)', () => {
        expect(settlementTimeoutMs(1, 't')).toBe(95000);
    });

    it('scales with tick count', () => {
        expect(settlementTimeoutMs(10, 't')).toBe(140000);
    });

    it('uses wall-clock time for s / m / h / d durations', () => {
        expect(settlementTimeoutMs(30, 's')).toBe(120000);
        expect(settlementTimeoutMs(5, 'm')).toBe(390000);
        expect(settlementTimeoutMs(2, 'h')).toBe(7290000);
        expect(settlementTimeoutMs(1, 'd')).toBe(86490000);
    });

    it('falls back to the 1-tick window for malformed durations', () => {
        expect(settlementTimeoutMs(Number.NaN, 't')).toBe(95000);
        expect(settlementTimeoutMs(0, 't')).toBe(95000);
        expect(settlementTimeoutMs(3, 'weird')).toBe(105000);
    });
});

describe('executeBuy — executed payout (regression: records kept the pre-retry quote payout)', () => {
    const quote = {
        id: 'q1',
        askPrice: 1,
        payout: 1.95,
        longcode: 'Digit Over 4',
        contractType: 'DIGITOVER',
        barrier: '4',
        currency: 'USD',
    };

    beforeEach(() => {
        (api.buyContract as jest.Mock).mockReset();
    });

    it('returns the payout confirmed by the buy response', async () => {
        (api.buyContract as jest.Mock).mockResolvedValue({
            data: { buy: { contract_id: 7, transaction_id: 8, buy_price: 1, payout: 1.94 } },
        });
        const result = await executeBuy(quote, 1);
        expect(result.error).toBeUndefined();
        expect(result.contractId).toBe(7);
        expect(result.payout).toBe(1.94);
    });

    it('omits payout when the buy response has none so callers keep the quote value', async () => {
        (api.buyContract as jest.Mock).mockResolvedValue({
            data: { buy: { contract_id: 7, transaction_id: 8, buy_price: 1 } },
        });
        const result = await executeBuy(quote, 1);
        expect(result.error).toBeUndefined();
        expect(result.payout).toBeUndefined();
    });
});

describe('monitorUntilSettled — unknown outcome (regression: fabricated LOSS)', () => {
    beforeEach(() => {
        (api.getOpenContract as jest.Mock).mockReset();
    });

    it('returns an error instead of a win/loss when a sold contract has no outcome data', async () => {
        (api.getOpenContract as jest.Mock).mockResolvedValue({
            data: { proposal_open_contract: { contract_id: 42, is_sold: 1, buy_price: 1 } },
        });
        const result = await monitorUntilSettled(42, 2, undefined, 5000, 10);
        expect('error' in result).toBe(true);
        expect((result as { error: string }).error).toContain('no outcome');
    });

    it('returns the server settlement (win + true profit) when outcome data is present', async () => {
        (api.getOpenContract as jest.Mock).mockResolvedValue({
            data: {
                proposal_open_contract: {
                    contract_id: 42,
                    is_sold: 1,
                    is_won: 1,
                    profit: 0.95,
                    buy_price: 1,
                    sell_price: 1.95,
                    exit_tick: 1234.5678,
                },
            },
        });
        const result = await monitorUntilSettled(42, 4, undefined, 5000, 10);
        expect('error' in result).toBe(false);
        const settlement = result as import('../execution').Settlement;
        expect(settlement.isWon).toBe(true);
        expect(settlement.profit).toBe(0.95);
        expect(settlement.exitDigit).toBe(8);
    });
});
