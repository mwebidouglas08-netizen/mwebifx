import { render, screen } from '@testing-library/react';
import AnalysisToolPage from '../index';

jest.mock('@/hooks/useStore', () => ({ useStore: () => null }));
jest.mock(
    '@/bot/deriv/history',
    () => ({ fetchHistoricalTicks: jest.fn() }),
    { virtual: true }
);
jest.mock(
    '@/bot/core/digit-stats',
    () => ({
        chiSquareUniformity: jest.fn(),
        computeDigitCounts: jest.fn(),
        computeRsi: jest.fn(),
        empiricalProbability: jest.fn(),
        theoreticalProbability: jest.fn(() => 0.1),
        wilsonInterval: jest.fn(() => [0, 1]),
    }),
    { virtual: true }
);
jest.mock(
    '@/bot/core/indicators',
    () => ({ bollinger: jest.fn(), latest: jest.fn(), macd: jest.fn() }),
    { virtual: true }
);

describe('AnalysisToolPage', () => {
    it('renders controls, account badge and the empty state', () => {
        render(<AnalysisToolPage />);
        expect(screen.getByRole('heading', { name: 'Analysis Tool' })).toBeInTheDocument();
        expect(screen.getByText('Guest · analysis only')).toBeInTheDocument();
        expect(screen.getByLabelText('Symbol')).toHaveValue('R_50');
        expect(screen.getByLabelText('Range')).toHaveValue('500');
        expect(screen.getByRole('button', { name: /Run analysis/ })).toBeEnabled();
        expect(screen.getByText(/Pick a symbol and a range/i)).toBeInTheDocument();
        expect(screen.getByText(/do not predict the next tick/i)).toBeInTheDocument();
    });
});
