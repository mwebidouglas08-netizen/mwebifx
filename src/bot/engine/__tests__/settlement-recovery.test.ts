jest.mock('../../deriv/execution', () => ({
    requestQuote: jest.fn(),
    requestSimpleQuote: jest.fn(),
    requestContractQuote: jest.fn(),
    executeBuyFresh: jest.fn(),
    monitorUntilSettled: jest.fn(),
    applySettlementToRecord: jest.fn(),
    releaseQuote: jest.fn(),
    settlementTimeoutMs: jest.fn((duration: number) => duration * 5000 + 90000),
    isMarketUnavailableError: jest.fn(() => false),
}));

jest.mock('../../deriv/api', () => ({
    isApiReady: jest.fn(() => true),
    isAuthorized: jest.fn(() => true),
    currentLoginId: jest.fn(() => 'VRTC1'),
    accountBalance: jest.fn(() => 1000),
    accountCurrency: jest.fn(() => 'USD'),
    refreshBalance: jest.fn(() => Promise.resolve()),
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

jest.mock('../../deriv/discovery', () => ({
    discoverSyntheticSymbols: jest.fn(async () => []),
    discoverDigitContracts: jest.fn(async () => []),
    detectSupportedFamilies: jest.fn(() => ['over_under', 'rise_fall']),
}));

jest.mock('@/utils/account-helpers', () => ({
    isDemoAccount: jest.fn(() => true),
}));

import { OUBotEngine, ouBotEngine } from '../engine';
import { signalScanner, paperWon } from '../signal-scanner';
import { bulkTrader } from '../bulk-trader';
import * as execution from '../../deriv/execution';
import * as api from '../../deriv/api';

jest.setTimeout(20000);

const quote = {
    id: 'q-1',
    askPrice: 1,
    payout: 1.95,
    longcode: 'Demo',
    contractType: 'DIGITOVER',
    barrier: '2',
    currency: 'USD',
    socket: 'sock-1',
};

const opp = {
    symbol: 'R_75',
    displayName: 'Volatility 75 Index',
    category: 'volatility',
    contractType: 'DIGITOVER',
    direction: 'over',
    barrier: 2,
    duration: 1,
    durationUnit: 't',
    stake: 1,
    payout: 1.95,
    payoutRatio: 1.95,
    empiricalProb: 0.75,
    theoreticalProb: 0.7,
    edge: 0.05,
    expectedValue: 0.4625,
    expectedValuePct: 0.4625,
    confidence: 0.8,
    sampleSize: 1000,
    digitStats: {
        sampleSize: 1000,
        counts: new Array(10).fill(100),
        frequencies: new Array(10).fill(0.1),
        expected: 100,
        chiSquare: 0,
        pValue: 1,
        isUniform: true,
        significant: false,
    },
    detectedAt: Date.now(),
};

describe('OUBotEngine — settlement failure must not deadlock the engine (regression)', () => {
    let engine: OUBotEngine;

    beforeEach(() => {
        engine = new OUBotEngine();
        (engine as any).running = true;
        (engine as any).symbols = [
            {
                symbol: 'R_75',
                displayName: 'Volatility 75 Index',
                market: 'major',
                submarket: 'synthetic_index',
                category: 'volatility',
                pip: 0.01,
                pipSize: 2,
                exchangeIsOpen: true,
                isSuspended: false,
            },
        ];
        (execution.requestQuote as jest.Mock).mockResolvedValue({ quote });
        (execution.executeBuyFresh as jest.Mock).mockResolvedValue({
            contractId: 555,
            transactionId: 9,
            buyPrice: 1,
        });
        (execution.applySettlementToRecord as jest.Mock).mockImplementation((record: any, settlement: any) => ({
            ...record,
            stage: 'settled',
            result: settlement.isWon ? 'win' : 'loss',
            profit: settlement.profit,
            closedAt: Date.now(),
        }));
    });

    it('releases the open-trade slot and leaves the record unsettled when settlement times out', async () => {
        (execution.monitorUntilSettled as jest.Mock).mockResolvedValue({
            error: 'Settlement timeout: contract #555 still open after 95000ms — do not record as settled',
        });

        await (engine as any).execute(opp, 1);

        const state = engine.getState();
        // The slot is released — the next scan is NOT blocked by
        // "Open position limit reached".
        expect(state.openTrade).toBeNull();
        expect(state.risk.openPositions).toBe(0);
        // The record is NOT fabricated into a win or loss.
        const record = state.trades.find((t: any) => t.contractId === 555);
        expect(record).toBeDefined();
        expect(record.stage).toBe('confirmed'); // still unsettled
        expect(record.result).toBeUndefined();
        expect(record.profit).toBeUndefined();
        expect(record.error).toContain('Settlement timeout');
        // The event log explains exactly what happened.
        expect(state.events.some(e => e.message.includes('Settlement unknown'))).toBe(true);
        expect(state.events.some(e => e.message.includes('position slot released'))).toBe(true);
    });

    it('requests a duration-aware settlement window (regression: 60s default killed long durations)', async () => {
        (execution.monitorUntilSettled as jest.Mock).mockResolvedValue({
            error: 'Settlement timeout',
        });
        // execute() reads the duration from the engine config, not the opportunity.
        engine.configure({ duration: 5, durationUnit: 'm' });

        await (engine as any).execute(opp, 1);

        // settlementTimeoutMs(duration, unit) is passed as the 4th argument.
        expect(execution.monitorUntilSettled).toHaveBeenCalledWith(
            555,
            2,
            undefined,
            5 * 5000 + 90000
        );
    });

    it('still settles normally through applySettlementToRecord on success', async () => {
        (execution.monitorUntilSettled as jest.Mock).mockResolvedValue({
            contractId: 555,
            isWon: true,
            profit: 0.95,
            isSold: true,
            sellPrice: 1.95,
            buyPrice: 1,
        });

        await (engine as any).execute(opp, 1);

        const state = engine.getState();
        expect(state.openTrade).toBeNull();
        expect(state.risk.openPositions).toBe(0);
        const record = state.trades.find((t: any) => t.contractId === 555);
        expect(record.stage).toBe('settled');
        expect(record.result).toBe('win');
        expect(record.profit).toBe(0.95);
    });
});

describe('SignalScannerEngine — paper rise/fall settles on real quotes (regression)', () => {
    beforeEach(() => {
        (signalScanner as any).running = true;
        (signalScanner as any).configure({ paperTrading: true, autoTrade: true });
    });

    afterEach(() => {
        (signalScanner as any).running = false;
    });

    const paperSignal = (action: 'CALL' | 'PUT') => ({
        id: `s-${action}`,
        at: Date.now(),
        symbol: 'R_75',
        displayName: 'Volatility 75 Index',
        category: 'volatility',
        family: 'rise_fall',
        action,
        contractType: action,
        barrier: undefined,
        strength: 65,
        confidence: 0.3,
        sampleSize: 100,
        rationale: 'test',
    });

    /** Drive a paper trade and resolve it with the next tick's quote. */
    const runPaper = async (action: 'CALL' | 'PUT', entryQuote: number, exitQuote: number) => {
        const feed = {
            getSeries: () => ({ digits: [5], quotes: [entryQuote] }),
        };
        (signalScanner as any).feed = feed;
        const run = (signalScanner as any).executePaper(paperSignal(action), 1, { payout: 1.95 });
        // Deliver the next tick: onTick fires waiters with the new series.
        await new Promise(r => setTimeout(r, 0));
        (signalScanner as any).onTick('R_75', {
            digits: [5],
            quotes: [entryQuote, exitQuote],
        });
        await run;
        return signalScanner.getState();
    };

    it('settles a paper CALL as a win when the quote rises', async () => {
        const state = await runPaper('CALL', 1000, 1001);
        const settled = state.trades.find(t => t.simulated && t.stage === 'settled');
        expect(settled).toBeDefined();
        expect(settled!.result).toBe('win');
        expect(settled!.profit).toBeCloseTo(0.95, 5);
        expect(state.events.some(e => e.type === 'settlement' && e.message.includes('PAPER WIN'))).toBe(true);
    });

    it('settles a paper CALL as a loss when the quote falls (not when it is flat)', async () => {
        const state = await runPaper('CALL', 1000, 999);
        const settled = state.trades.find(t => t.simulated && t.stage === 'settled');
        expect(settled!.result).toBe('loss');
        expect(settled!.profit).toBe(-1);
    });

    it('settles a paper PUT as a win when the quote falls', async () => {
        const state = await runPaper('PUT', 1000, 999);
        const settled = state.trades.find(t => t.simulated && t.stage === 'settled');
        expect(settled!.result).toBe('win');
    });

    it('paperWon throws for rise/fall instead of fabricating a loss (regression)', () => {
        // The old default returned false — every paper CALL/PUT was a fake loss.
        expect(() => paperWon('CALL', 5, 0)).toThrow(/cannot settle/);
        expect(() => paperWon('PUT', 5, 0)).toThrow(/cannot settle/);
        // Digit contracts still settle from the digit.
        expect(paperWon('DIGITOVER', 5, 2)).toBe(true);
        expect(paperWon('DIGITUNDER', 5, 7)).toBe(true);
    });
});

describe('BulkTraderEngine — settle failures are counted (regression)', () => {
    beforeEach(() => {
        (bulkTrader as any).runActive = false;
        (bulkTrader as any).running = false;
        (bulkTrader as any).openMonitors = 0;
        (bulkTrader as any).queueDone = false;
        (bulkTrader as any).feed = null;
        (bulkTrader as any).tickWaiters.clear();
        (bulkTrader as any).emergencyEngaged = false;
        (api.isApiReady as jest.Mock).mockReturnValue(true);
        (api.isAuthorized as jest.Mock).mockReturnValue(true);
        (api.currentLoginId as jest.Mock).mockReturnValue('VRTC123');
        (api.getTicksHistory as jest.Mock).mockResolvedValue({ history: { prices: [] } });
        (execution.requestContractQuote as jest.Mock).mockResolvedValue({ quote });
        (execution.executeBuyFresh as jest.Mock).mockResolvedValue({
            contractId: 700,
            transactionId: 9,
            buyPrice: 1,
        });
        (execution.releaseQuote as jest.Mock).mockImplementation(() => undefined);
        (execution.applySettlementToRecord as jest.Mock).mockImplementation((record: any, settlement: any) => ({
            ...record,
            stage: 'settled',
            result: settlement.isWon ? 'win' : 'loss',
            profit: settlement.profit,
            closedAt: Date.now(),
        }));
    });

    afterEach(() => {
        bulkTrader.stop();
    });

    it('counts a settlement timeout as failed so requested = settled + failed holds', async () => {
        (execution.monitorUntilSettled as jest.Mock).mockResolvedValue({ error: 'Settlement timeout: still open' });

        await bulkTrader.start({
            symbol: 'R_75',
            contractType: 'DIGITOVER',
            barrier: '4',
            stake: 1,
            count: 2,
            duration: 1,
            durationUnit: 't',
            paperTrading: false,
            allowLiveTrading: true,
            maxConcurrent: 1,
        });

        const deadline = Date.now() + 5000;
        while (bulkTrader.getState().status !== 'idle' && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 10));
        }

        const { progress } = bulkTrader.getState();
        // Regression: the timeout path used to bump nothing, so
        // settled + failed silently dropped below requested.
        expect(progress.requested).toBe(2);
        expect(progress.settled).toBe(0);
        expect(progress.failed).toBe(2);
        expect(progress.settled + progress.failed).toBe(progress.requested);
    });
});

describe('OUBotEngine singleton export', () => {
    it('exports a constructed singleton', () => {
        expect(ouBotEngine).toBeInstanceOf(OUBotEngine);
    });
});
