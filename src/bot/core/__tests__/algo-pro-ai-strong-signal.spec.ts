import { STRONG_PAIR_CONFIDENCE, STRONG_SIGNAL_EDGE, isStrongSignal } from '../algo-pro-ai';

describe('isStrongSignal', () => {
    it('accepts an edge that clears the strong threshold in single-market mode', () => {
        expect(isStrongSignal(STRONG_SIGNAL_EDGE, 0, false)).toBe(true);
        expect(isStrongSignal(0.05, 0, false)).toBe(true);
        expect(isStrongSignal(0.1, 0, false)).toBe(true);
    });

    it('rejects a sub-threshold edge even with a perfect pair confidence', () => {
        expect(isStrongSignal(STRONG_SIGNAL_EDGE - 0.001, 1, false)).toBe(false);
        expect(isStrongSignal(0.019, 1, true)).toBe(false);
        expect(isStrongSignal(0, 1, true)).toBe(false);
    });

    it('also requires the pair-confidence floor when the pair scanner is on', () => {
        expect(isStrongSignal(0.05, STRONG_PAIR_CONFIDENCE, true)).toBe(true);
        expect(isStrongSignal(0.05, 1, true)).toBe(true);
        expect(isStrongSignal(0.05, STRONG_PAIR_CONFIDENCE - 0.01, true)).toBe(false);
        expect(isStrongSignal(0.05, 0, true)).toBe(false);
    });

    it('uses the exported thresholds as its defaults', () => {
        expect(STRONG_SIGNAL_EDGE).toBe(0.02);
        expect(STRONG_PAIR_CONFIDENCE).toBe(0.8);
    });
});
