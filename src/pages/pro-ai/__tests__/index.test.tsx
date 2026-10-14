import { render, screen } from '@testing-library/react';
import ProAiPage from '../index';

jest.mock('@/hooks/useStore', () => ({ useStore: () => null }));
jest.mock(
    '@/bot/deriv/history',
    () => ({ fetchHistoricalTicks: jest.fn() }),
    { virtual: true }
);
jest.mock(
    '@/bot/deriv/execution',
    () => ({ requestQuote: jest.fn(), executeBuyFresh: jest.fn(), monitorUntilSettled: jest.fn() }),
    { virtual: true }
);
jest.mock(
    '@/bot/core/pro-ai',
    () => ({
        DEFAULT_PRO_AI_OPTIONS: {
            sampleSize: 100,
            recentWindow: 30,
            minSample: 40,
            minAiScore: 0.72,
            minRecentWinRate: 0.55,
        },
        PRO_AI_BOTS: [{ id: 'bot-1', name: 'Demo Bot' }],
        SCOPE_LABEL: {
            standard: 'Volatility Indices only',
            'one-second': 'Volatility Indices (1s) only',
            all: 'All Volatilities',
        },
        scopeMatches: (scope: string) => scope === 'all',
        scanProAiMarkets: jest.fn(() => []),
        evaluateProAiEntry: jest.fn(),
    }),
    { virtual: true }
);
jest.mock('@/bot/core/digit-stats', () => ({ winsFor: jest.fn(() => false) }), { virtual: true });

describe('ProAiPage', () => {
    it('renders in guest mode with controls and the honest disclaimer', () => {
        render(<ProAiPage />);
        expect(screen.getByRole('heading', { name: 'Pro AI' })).toBeInTheDocument();
        expect(screen.getByText('Guest · analysis only')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Run Pro AI scan/ })).toBeEnabled();
        expect(screen.getByRole('button', { name: /Log in for demo orders/ })).toBeInTheDocument();
        expect(screen.getByText('BUY candidates (0)')).toBeInTheDocument();
        expect(screen.getByText(/not a guaranteed edge/i)).toBeInTheDocument();
    });

    it('defaults the scan gates to the core defaults', () => {
        render(<ProAiPage />);
        expect(screen.getByText('Blocked evaluations (0)')).toBeInTheDocument();
        expect(screen.getByLabelText('Scope')).toHaveValue('all');
        expect(screen.getByLabelText('Sample size')).toHaveValue(100);
        expect(screen.getByLabelText('Min AI score')).toHaveValue(0.72);
        expect(screen.getByLabelText('Min recent win rate')).toHaveValue(0.55);
    });
});
