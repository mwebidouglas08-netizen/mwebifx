import {
    chiSquareUniformity,
    computeDigitCounts,
    computeRsi,
    detectDirectionalBias,
    empiricalProbability,
    theoreticalProbability,
    wilsonInterval,
    winsFor,
} from '../digit-stats';

describe('winsFor (DIGITOVER / DIGITUNDER digit math)', () => {
    it('DIGITOVER wins only when the digit is strictly greater than the barrier', () => {
        expect(winsFor('over', 4, 5)).toBe(true);
        expect(winsFor('over', 4, 9)).toBe(true);
        expect(winsFor('over', 4, 4)).toBe(false); // equality loses
        expect(winsFor('over', 4, 3)).toBe(false);
        expect(winsFor('over', 4, 0)).toBe(false);
    });

    it('DIGITUNDER wins only when the digit is strictly less than the barrier', () => {
        expect(winsFor('under', 7, 6)).toBe(true);
        expect(winsFor('under', 7, 0)).toBe(true);
        expect(winsFor('under', 7, 7)).toBe(false); // equality loses
        expect(winsFor('under', 7, 8)).toBe(false);
        expect(winsFor('under', 7, 9)).toBe(false);
    });

    it('handles the extreme barriers', () => {
        // Over 0 wins on digits 1..9 (9 of 10).
        expect(winsFor('over', 0, 1)).toBe(true);
        expect(winsFor('over', 0, 0)).toBe(false);
        // Under 9 wins on digits 0..8 (9 of 10).
        expect(winsFor('under', 9, 8)).toBe(true);
        expect(winsFor('under', 9, 9)).toBe(false);
    });
});

describe('theoreticalProbability', () => {
    it('DIGITOVER(barrier) wins on (9 - barrier) of 10 digits', () => {
        expect(theoreticalProbability('over', 0)).toBeCloseTo(0.9, 10);
        expect(theoreticalProbability('over', 2)).toBeCloseTo(0.7, 10);
        expect(theoreticalProbability('over', 4)).toBeCloseTo(0.5, 10);
        expect(theoreticalProbability('over', 8)).toBeCloseTo(0.1, 10);
        expect(theoreticalProbability('over', 9)).toBe(0); // can never win
    });

    it('DIGITUNDER(barrier) wins on barrier of 10 digits', () => {
        expect(theoreticalProbability('under', 1)).toBeCloseTo(0.1, 10);
        expect(theoreticalProbability('under', 5)).toBeCloseTo(0.5, 10);
        expect(theoreticalProbability('under', 7)).toBeCloseTo(0.7, 10);
        expect(theoreticalProbability('under', 9)).toBeCloseTo(0.9, 10);
        expect(theoreticalProbability('under', 0)).toBe(0); // can never win
    });
});

describe('empiricalProbability', () => {
    it('matches a hand-counted digit sample', () => {
        // Digits above 4: 5,6,7,8,9 → 5 wins out of 10.
        const digits = [4, 5, 6, 7, 8, 9, 3, 2, 1, 0];
        expect(empiricalProbability(digits, 'over', 4)).toBeCloseTo(0.5, 10);
        // Digits below 7: 4,5,6,3,2,1,0 → 7 wins out of 10.
        expect(empiricalProbability(digits, 'under', 7)).toBeCloseTo(0.7, 10);
    });

    it('returns 0 for an empty sample', () => {
        expect(empiricalProbability([], 'over', 4)).toBe(0);
    });
});

describe('wilsonInterval', () => {
    it('brackets the observed proportion for a large sample', () => {
        const [lo, hi] = wilsonInterval(70, 100);
        expect(lo).toBeLessThan(0.7);
        expect(hi).toBeGreaterThan(0.7);
        expect(lo).toBeGreaterThanOrEqual(0);
        expect(hi).toBeLessThanOrEqual(1);
    });

    it('returns [0, 1] for n = 0', () => {
        expect(wilsonInterval(0, 0)).toEqual([0, 1]);
    });

    it('is wider for smaller samples', () => {
        const wide = wilsonInterval(7, 10);
        const narrow = wilsonInterval(700, 1000);
        expect(wide[1] - wide[0]).toBeGreaterThan(narrow[1] - narrow[0]);
    });
});

describe('detectDirectionalBias', () => {
    it('flags a significant over-representation of over-2 wins', () => {
        // 90 digits, all ≥ 3 → empirical 1.0 vs theoretical 0.7.
        const digits = Array.from({ length: 90 }, () => 5);
        const bias = detectDirectionalBias(digits, 'over', 2);
        expect(bias.empiricalProb).toBeCloseTo(1, 10);
        expect(bias.theoreticalProb).toBeCloseTo(0.7, 10);
        expect(bias.gap).toBeCloseTo(0.3, 10);
        expect(bias.isSignificant).toBe(true);
        expect(bias.sampleSize).toBe(90);
    });

    it('is not significant for a fair uniform sample', () => {
        // Exactly uniform: 10 of each digit → over-4 wins 50/100 = 0.5 = theory.
        const digits: number[] = [];
        for (let d = 0; d <= 9; d++) for (let i = 0; i < 10; i++) digits.push(d);
        const bias = detectDirectionalBias(digits, 'over', 4);
        expect(bias.empiricalProb).toBeCloseTo(0.5, 10);
        expect(bias.gap).toBeCloseTo(0, 10);
        expect(bias.isSignificant).toBe(false);
    });

    it('handles an empty sample without dividing by zero', () => {
        const bias = detectDirectionalBias([], 'under', 7);
        expect(bias.empiricalProb).toBe(0);
        expect(bias.sampleSize).toBe(0);
        expect(bias.isSignificant).toBe(false);
    });
});

describe('computeDigitCounts / chiSquareUniformity', () => {
    it('counts each digit occurrence', () => {
        expect(computeDigitCounts([0, 0, 9, 9, 9, 5])).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 3]);
    });

    it('a perfectly uniform sample has a high p-value (not rejected as biased)', () => {
        const counts = new Array(10).fill(100);
        const { pValue, chiSquare } = chiSquareUniformity(counts);
        expect(chiSquare).toBeCloseTo(0, 10);
        expect(pValue).toBeCloseTo(1, 10);
    });

    it('a heavily skewed sample has a low p-value (rejected as biased)', () => {
        const counts = [1000, 1, 1, 1, 1, 1, 1, 1, 1, 1];
        const { pValue } = chiSquareUniformity(counts);
        expect(pValue).toBeLessThan(0.05);
    });

    it('an empty count array reports uniform (no evidence against it)', () => {
        const { pValue, df } = chiSquareUniformity(new Array(10).fill(0));
        expect(pValue).toBe(1);
        expect(df).toBe(9);
    });
});

describe('computeRsi', () => {
    it('returns 50 when there is not enough data', () => {
        expect(computeRsi([1, 2, 3], 14)).toBe(50);
    });

    it('approaches ~99 on a pure rally (rs capped at 100)', () => {
        const rally = Array.from({ length: 20 }, (_, i) => 100 + i);
        // rs is capped at 100 when losses are zero → RSI = 100 - 100/101 ≈ 99.01.
        expect(computeRsi(rally, 14)).toBeCloseTo(100 - 100 / 101, 5);
    });

    it('approaches 0 on a pure sell-off', () => {
        const crash = Array.from({ length: 20 }, (_, i) => 100 - i);
        expect(computeRsi(crash, 14)).toBeCloseTo(0, 5);
    });

    it('returns 50 on a flat series (no gains, no losses)', () => {
        const flat = new Array(20).fill(50);
        expect(computeRsi(flat, 14)).toBe(50);
    });
});
