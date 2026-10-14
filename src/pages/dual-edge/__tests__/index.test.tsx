import { render, screen } from '@testing-library/react';
import DualEdgePage from '../index';

jest.mock('@/hooks/useStore', () => ({ useStore: () => null }));
jest.mock(
    '@/bot/deriv/history',
    () => ({ fetchHistoricalTicks: jest.fn() }),
    { virtual: true }
);
jest.mock('@/bot/deriv/ticks', () => ({ TickFeed: jest.fn() }), { virtual: true });
jest.mock('@/bot/deriv/api', () => ({ isAuthorized: jest.fn(() => false) }), { virtual: true });
jest.mock(
    '@/bot/deriv/execution',
    () => ({
        requestContractQuote: jest.fn(),
        executeBuyFresh: jest.fn(),
        monitorUntilSettled: jest.fn(),
    }),
    { virtual: true }
);
jest.mock('@/bot/core/digit-stats', () => ({ winsFor: jest.fn(() => false) }), { virtual: true });
jest.mock(
    '@/bot/core/dual-edge',
    () => {
        const config = {
            mode: 'RECOVERY',
            baseStake: 1,
            stakeCap: 50,
            stakeFactor: 2,
            stakeStep: 1,
            maxRecoverySteps: 4,
            takeProfit: 10,
            stopLoss: 20,
        };
        const profile = { id: 'balanced', label: 'Balanced' };
        const sideState = (side: 'over' | 'under') => ({
            side,
            barrier: side === 'over' ? 1 : 8,
            stake: 1,
            step: 0,
            consecutiveLosses: 0,
            wins: 0,
            losses: 0,
            profit: 0,
            history: [],
        });
        return {
            DEFAULT_DUAL_CONFIG: config,
            DUAL_PROFILES: [profile],
            getDualProfile: () => profile,
            initialSideState: (side: 'over' | 'under') => sideState(side),
            nextStakePreview: (state: { stake: number }) => state.stake,
            dualTotals: () => ({ profit: 0, wins: 0, losses: 0, maxConsecutiveLosses: 0 }),
            dualStopReason: () => null,
            applySideResult: jest.fn(),
        };
    },
    { virtual: true }
);

describe('DualEdgePage', () => {
    it('renders both side cards, totals and engine controls in paper mode', () => {
        render(<DualEdgePage />);
        expect(screen.getByRole('heading', { name: 'Dual Edge' })).toBeInTheDocument();
        expect(screen.getByText('Guest · analysis only')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Over side' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Under side' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start engine' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Emergency stop' })).toBeEnabled();
        expect(screen.getByText('Stake flow (paper)')).toBeInTheDocument();
    });

    it('defaults to RECOVERY mode and warns about progression risk', () => {
        render(<DualEdgePage />);
        expect(screen.getByText(/RECOVERY barrier switching/i)).toBeInTheDocument();
        expect(screen.getByText(/recovery \/ martingale-style progressions lose heavily/i)).toBeInTheDocument();
        expect(screen.getByText(/no P\/L modelled in paper/i)).toBeInTheDocument();
    });
});
