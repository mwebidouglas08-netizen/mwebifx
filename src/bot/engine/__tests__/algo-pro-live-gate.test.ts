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
    currentLoginId: jest.fn(() => 'CR123'),
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
    class MockSymbolSeries {
        constructor(_opts?: any) {}
        push(_d: number, _q: number) {}
        get last() {
            return undefined;
        }
        lastDigit() {
            return undefined;
        }
        series() {
            return [];
        }
    }
    return { TickFeed: MockTickFeed, SymbolSeries: MockSymbolSeries };
});

jest.mock('../../deriv/discovery', () => ({
    discoverSyntheticSymbols: jest.fn(async () => []),
    discoverDigitContracts: jest.fn(async () => []),
    detectSupportedFamilies: jest.fn(() => ['over_under', 'rise_fall']),
}));

jest.mock('@/utils/account-helpers', () => ({
    isDemoAccount: jest.fn(() => true),
}));

import { AlgoProEngine } from '../algo-pro-ai';
import * as api from '../../deriv/api';
import { isDemoAccount } from '@/utils/account-helpers';

const authorizedMock = api.isAuthorized as jest.Mock;
const loginIdMock = api.currentLoginId as jest.Mock;
const demoMock = isDemoAccount as jest.Mock;

describe('AlgoProEngine.executionGate — demo/real account gating', () => {
    let engine: AlgoProEngine;
    let gate: () => string | null;

    beforeEach(() => {
        jest.clearAllMocks();
        authorizedMock.mockReturnValue(true);
        loginIdMock.mockReturnValue('CR123');
        demoMock.mockReturnValue(false); // real account by default in these tests
        engine = new AlgoProEngine();
        (engine as any).state.running = true;
        engine.configure({ paperTrading: false, allowLiveTrading: false });
        gate = () => (engine as any).executionGate(engine.getState().settings);
    });

    it('blocks a real account when live trading is not armed', () => {
        const reason = gate();
        expect(reason).toContain('live trading is off');
        expect(reason).toContain('Live trading');
    });

    it('allows a real account once live trading is armed', () => {
        engine.configure({ allowLiveTrading: true });
        expect(gate()).toBeNull();
    });

    it('allows demo accounts without arming live trading', () => {
        demoMock.mockReturnValue(true);
        expect(gate()).toBeNull();
    });

    it('always allows paper trading, even logged out', () => {
        engine.configure({ paperTrading: true });
        expect(gate()).toBeNull();

        authorizedMock.mockReturnValue(false);
        expect(gate()).toBeNull();
    });

    it('blocks when there is no Deriv session', () => {
        authorizedMock.mockReturnValue(false);
        expect(gate()).toContain('not logged in');
    });

    it('re-evaluates the account at trade time — stale demo state never lets a real order through', () => {
        // Engine state still believes the account is the demo one from start()...
        expect((engine as any).state.accountIsDemo).toBe(true);
        // ...but the active login is now a REAL account.
        loginIdMock.mockReturnValue('CR999');
        demoMock.mockReturnValue(false);
        expect(gate()).toContain('live trading is off');
    });

    it('keeps the live flag from demo sessions from leaking onto a switched real account when disarmed', () => {
        // demo account, live flag off → open
        demoMock.mockReturnValue(true);
        engine.configure({ allowLiveTrading: false });
        expect(gate()).toBeNull();

        // same engine, user switches to real → must be blocked again
        demoMock.mockReturnValue(false);
        loginIdMock.mockReturnValue('CR456');
        expect(gate()).toContain('live trading is off');
    });

    it('blocks before the scanner starts', () => {
        (engine as any).state.running = false;
        engine.configure({ allowLiveTrading: true, paperTrading: true });
        expect(gate()).toContain('scanner stopped');
    });
});
