jest.mock('../../deriv/execution', () => ({
    requestContractQuote: jest.fn(),
    requestQuote: jest.fn(),
    requestSimpleQuote: jest.fn(),
    executeBuyFresh: jest.fn(),
    monitorUntilSettled: jest.fn(),
    applySettlementToRecord: jest.fn(),
    isMarketUnavailableError: jest.fn(() => false),
    releaseQuote: jest.fn(),
    settlementTimeoutMs: jest.fn(() => 95000),
}));

jest.mock('../../deriv/api', () => ({
    isApiReady: jest.fn(),
    isAuthorized: jest.fn(),
    currentLoginId: jest.fn(),
    accountBalance: jest.fn(() => 1000),
    accountCurrency: jest.fn(() => 'USD'),
    getTicksHistory: jest.fn(),
    getContractsFor: jest.fn(),
    getActiveSymbols: jest.fn(),
    request: jest.fn(),
    requestLive: jest.fn(),
    buyContract: jest.fn(),
    getOpenContract: jest.fn(),
    currentSocket: jest.fn(),
}));

jest.mock('../../deriv/ticks', () => {
    class MockTickFeed {
        static instances: any[] = [];
        events: any;
        constructor(events: any = {}) {
            this.events = events;
            MockTickFeed.instances.push(this);
        }
        setSymbols() {}
        seed() {}
        start() {}
        stop() {}
        getSeries() {
            return undefined;
        }
    }
    return { TickFeed: MockTickFeed };
});

import { bulkTrader, DEFAULT_BULK_CONFIG, BulkTradeConfig } from '../bulk-trader';
import * as api from '../../deriv/api';
import * as execution from '../../deriv/execution';
import { TickFeed } from '../../deriv/ticks';

jest.setTimeout(20000);

const baseConfig: BulkTradeConfig = {
    ...DEFAULT_BULK_CONFIG,
    symbol: 'R_75',
    contractType: 'DIGITOVER',
    barrier: '4',
    stake: 1,
    duration: 1,
    durationUnit: 't',
};

const waitFor = async (condition: () => boolean, timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('waitFor timed out');
        await new Promise(r => setTimeout(r, 10));
    }
};

const feeds = (): any[] => (TickFeed as any).instances;

const pushTick = (digit: number, quote = 1234.5): void => {
    const list = feeds();
    const feed = list[list.length - 1];
    feed.events.onTick('R_75', { epoch: 1, quote, digit }, { digits: [digit], quotes: [quote - 0.1, quote] });
};

describe('BulkTraderEngine', () => {
    let buySeq = 0;

    beforeEach(() => {
        buySeq = 0;
        // The engine is a module-level singleton; fully reset it between tests
        // so a prior run's open monitors don't leak into the next start().
        (bulkTrader as any).runActive = false;
        (bulkTrader as any).running = false;
        (bulkTrader as any).openMonitors = 0;
        (bulkTrader as any).queueDone = false;
        (bulkTrader as any).feed = null;
        (bulkTrader as any).tickWaiters.clear();
        (bulkTrader as any).emergencyEngaged = false;
        (TickFeed as any).instances.length = 0;
        (api.isApiReady as jest.Mock).mockReturnValue(true);
        (api.isAuthorized as jest.Mock).mockReturnValue(true);
        (api.currentLoginId as jest.Mock).mockReturnValue('VRTC123');
        (api.getTicksHistory as jest.Mock).mockResolvedValue({ history: { prices: [] } });
        (execution.requestContractQuote as jest.Mock).mockImplementation(async () => ({
            quote: {
                id: 'q-1',
                askPrice: 1,
                payout: 1.95,
                longcode: 'Demo quote',
                contractType: 'DIGITOVER',
                barrier: '4',
                currency: 'USD',
            },
        }));
        (execution.executeBuyFresh as jest.Mock).mockImplementation(async () => {
            buySeq += 1;
            return { contractId: 100 + buySeq, transactionId: 1000 + buySeq, buyPrice: 1 };
        });
        (execution.monitorUntilSettled as jest.Mock).mockImplementation(async (contractId: number) => ({
            contractId,
            isWon: true,
            profit: 0.95,
            isSold: true,
            sellPrice: 1.95,
            buyPrice: 1,
        }));
        (execution.applySettlementToRecord as jest.Mock).mockImplementation((record, settlement) => ({
            ...record,
            stage: 'settled',
            contractId: settlement.contractId,
            result: settlement.isWon ? 'win' : 'loss',
            profit: settlement.profit,
            closedAt: Date.now(),
        }));
        (execution.releaseQuote as jest.Mock).mockImplementation(() => undefined);
    });

    afterEach(() => {
        bulkTrader.stop();
    });

    it('clamps order count and concurrency in configure', () => {
        bulkTrader.configure({ count: 999, maxConcurrent: 0 });
        expect(bulkTrader.getState().config.count).toBe(50);
        expect(bulkTrader.getState().config.maxConcurrent).toBe(1);
    });

    it('starts a paper run without touching the quote/buy API', async () => {
        const run = bulkTrader.start({ ...baseConfig, paperTrading: true, count: 2, maxConcurrent: 2 });
        await run;

        const state = bulkTrader.getState();
        expect(state.status).toBe('running');
        expect(state.progress).toEqual({ requested: 2, bought: 2, settled: 0, won: 0, lost: 0, failed: 0 });
        expect(execution.requestContractQuote).not.toHaveBeenCalled();
        expect(execution.executeBuyFresh).not.toHaveBeenCalled();
        expect(state.trades).toHaveLength(2);
        expect(state.trades.every(t => t.simulated && t.stage === 'confirmed')).toBe(true);
    });

    it('settles paper trades on the next tick and counts wins', async () => {
        await bulkTrader.start({ ...baseConfig, paperTrading: true, count: 2, maxConcurrent: 2 });
        pushTick(5);

        await waitFor(() => bulkTrader.getState().progress.settled === 2);
        const state = bulkTrader.getState();
        expect(state.progress.won).toBe(2);
        expect(state.progress.lost).toBe(0);
        expect(state.status).toBe('idle');
        expect(state.trades.every(t => t.stage === 'settled' && t.result === 'win')).toBe(true);
        expect(state.events.some(e => e.type === 'settlement' && e.message.startsWith('PAPER WIN'))).toBe(true);
    });

    it('counts a paper loss when the exit digit fails the barrier', async () => {
        await bulkTrader.start({ ...baseConfig, paperTrading: true, count: 2, maxConcurrent: 2 });
        pushTick(3);

        await waitFor(() => bulkTrader.getState().progress.settled === 2);
        const state = bulkTrader.getState();
        expect(state.progress.won).toBe(0);
        expect(state.progress.lost).toBe(2);
        expect(state.trades.every(t => t.result === 'loss' && t.profit === -1)).toBe(true);
    });

    it('runs live buys through the bounded concurrency queue and counts progress', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        (execution.executeBuyFresh as jest.Mock).mockImplementation(async () => {
            buySeq += 1;
            const n = buySeq;
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise(r => setTimeout(r, 25));
            inFlight -= 1;
            if (n === 4) return { error: 'Insufficient balance' };
            return { contractId: 100 + n, transactionId: 1000 + n, buyPrice: 1 };
        });
        (execution.monitorUntilSettled as jest.Mock).mockImplementation(async (contractId: number) => ({
            contractId,
            isWon: contractId !== 102,
            profit: contractId !== 102 ? 0.95 : -1,
            isSold: true,
            sellPrice: contractId !== 102 ? 1.95 : 0,
            buyPrice: 1,
        }));

        await bulkTrader.start({
            ...baseConfig,
            paperTrading: false,
            allowLiveTrading: true,
            count: 4,
            maxConcurrent: 2,
        });
        await waitFor(
            () => bulkTrader.getState().progress.settled + bulkTrader.getState().progress.failed >= 4
        );

        const state = bulkTrader.getState();
        expect(maxInFlight).toBeGreaterThan(1);
        expect(maxInFlight).toBeLessThanOrEqual(2);
        expect(execution.executeBuyFresh).toHaveBeenCalledTimes(4);
        expect(execution.requestContractQuote).toHaveBeenCalledTimes(4);
        expect(state.progress).toEqual({ requested: 4, bought: 3, settled: 3, won: 2, lost: 1, failed: 1 });
        expect(state.status).toBe('idle');
        expect(state.message).toContain('Completed 3/4');
        expect(state.trades.filter(t => t.stage === 'rejected')).toHaveLength(1);
        expect(state.trades.filter(t => t.stage === 'settled')).toHaveLength(3);
    });

    it('stop() prevents any further buys while letting open contracts settle', async () => {
        const run = bulkTrader.start({
            ...baseConfig,
            paperTrading: false,
            allowLiveTrading: true,
            count: 5,
            maxConcurrent: 1,
        });
        await waitFor(() => (execution.executeBuyFresh as jest.Mock).mock.calls.length >= 1);
        bulkTrader.stop();

        expect(bulkTrader.getState().status).toBe('stopping');
        await run;

        expect((execution.executeBuyFresh as jest.Mock).mock.calls.length).toBe(1);
        const state = bulkTrader.getState();
        expect(state.progress.bought).toBe(1);
        expect(state.status).toBe('idle');
        expect(state.events.some(e => e.message.includes('no new orders'))).toBe(true);
    });

    it('refuses live orders on a real account without allowLiveTrading', async () => {
        (api.currentLoginId as jest.Mock).mockReturnValue('CR98765');

        await bulkTrader.start({
            ...baseConfig,
            paperTrading: false,
            allowLiveTrading: false,
            count: 3,
        });

        const state = bulkTrader.getState();
        expect(state.status).toBe('error');
        expect(state.message).toContain('Live trading');
        expect(state.accountIsDemo).toBe(false);
        expect(state.events.some(e => e.type === 'risk' && e.message.includes('REAL account'))).toBe(true);
        expect(execution.requestContractQuote).not.toHaveBeenCalled();
        expect(execution.executeBuyFresh).not.toHaveBeenCalled();
    });

    it('refuses live orders when no account is logged in', async () => {
        (api.isAuthorized as jest.Mock).mockReturnValue(false);

        await bulkTrader.start({ ...baseConfig, paperTrading: false, count: 2 });

        expect(bulkTrader.getState().status).toBe('error');
        expect(bulkTrader.getState().message).toContain('logged-in');
        expect(execution.executeBuyFresh).not.toHaveBeenCalled();
    });

    it('emergencyStop logs that open contracts stay open (no sell API)', async () => {
        let release: ((v: any) => void) | null = null;
        (execution.monitorUntilSettled as jest.Mock).mockImplementation(
            () => new Promise(resolve => { release = resolve; })
        );

        await bulkTrader.start({
            ...baseConfig,
            paperTrading: false,
            allowLiveTrading: true,
            count: 1,
            maxConcurrent: 1,
        });
        await waitFor(() => bulkTrader.getState().progress.bought === 1);

        bulkTrader.emergencyStop();

        const state = bulkTrader.getState();
        expect(state.status).toBe('stopping');
        expect(state.message).toContain('monitoring');
        const risk = state.events.find(e => e.type === 'risk' && e.message.includes('Emergency stop'));
        expect(risk).toBeDefined();
        expect(risk!.message).toContain('no sell API');
        expect(risk!.message).toContain('remain open');

        release!({ contractId: 101, isWon: true, profit: 0.95, isSold: true, sellPrice: 1.95, buyPrice: 1 });
        await waitFor(() => bulkTrader.getState().status === 'idle');
        expect(bulkTrader.getState().message).toBe('Emergency stop engaged');
    });
});
