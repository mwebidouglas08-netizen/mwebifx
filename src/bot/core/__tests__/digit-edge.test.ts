import { breakevenRate, evaluateSessionGuard, fairPayoutRatio, rankBarriers } from '../digit-edge';

const digitsFromCounts = (counts: number[]): number[] => {
    const out: number[] = [];
    for (let d = 0; d < 10; d++) {
        for (let i = 0; i < (counts[d] ?? 0); i++) out.push(d);
    }
    return out;
};

/** 1000 digits, 100 of each 0–9: perfectly uniform. */
const UNIFORM = digitsFromCounts(new Array(10).fill(100));

/** Heavily skewed toward high digits: 820 nines, 20 of every other digit (1000 total). */
const HIGH_SKEW = digitsFromCounts([20, 20, 20, 20, 20, 20, 20, 20, 20, 820]);

const PAYOUT = 1.95; // breakeven ≈ 0.5128

describe('rankBarriers — edge and breakeven math', () => {
    it('computes breakeven as the inverse of the payout ratio', () => {
        const [top] = rankBarriers(UNIFORM, 'under', [8], PAYOUT);
        expect(top.breakeven).toBeCloseTo(1 / PAYOUT, 10);
        expect(top.edge).toBeCloseTo(top.empiricalProb - top.breakeven, 10);
        expect(top.absEdge).toBeCloseTo(Math.abs(top.edge), 10);
        expect(top.expectedValuePct).toBeCloseTo(top.empiricalProb * PAYOUT - 1, 10);
    });

    it('ranks uniform digits by distance from breakeven, both directions', () => {
        // Uniform: over 2 → 0.7, over 3 → 0.6, over 6 → 0.3 (breakeven ≈ 0.5128).
        const over = rankBarriers(UNIFORM, 'over', [2, 3, 6], PAYOUT);
        expect(over.map(c => c.barrier)).toEqual([6, 2, 3]);
        expect(over[0].edge).toBeCloseTo(0.3 - 1 / PAYOUT, 10);
        expect(over[1].edge).toBeCloseTo(0.7 - 1 / PAYOUT, 10);
        // Uniform: under 7 → 0.7, under 8 → 0.8.
        const under = rankBarriers(UNIFORM, 'under', [7, 8], PAYOUT);
        expect(under.map(c => c.barrier)).toEqual([8, 7]);
        expect(under[0].empiricalProb).toBeCloseTo(0.8, 10);
    });

    it('ranks skewed digits toward the direction of the skew', () => {
        // 820 nines: over 2 → 0.94, over 4 → 0.90, over 6 → 0.86.
        const over = rankBarriers(HIGH_SKEW, 'over', [2, 4, 6], PAYOUT);
        expect(over.map(c => c.barrier)).toEqual([2, 4, 6]);
        expect(over[0].empiricalProb).toBeCloseTo(0.94, 10);
        // under 1 → 0.02, under 3 → 0.04, under 8 → 0.16: all far below breakeven,
        // ranked by magnitude of the (negative) edge.
        const under = rankBarriers(HIGH_SKEW, 'under', [1, 3, 8], PAYOUT);
        expect(under.map(c => c.barrier)).toEqual([1, 3, 8]);
        expect(under[0].edge).toBeCloseTo(0.02 - 1 / PAYOUT, 10);
        expect(under[0].expectedValuePct).toBeLessThan(0);
    });

    it('breaks exact ties toward the higher empirical rate, then the lower barrier', () => {
        const flat = digitsFromCounts([0, 0, 0, 0, 0, 1000, 0, 0, 0, 0]);
        // Only digit 5 appears: over 2 and over 3 both win 100% (edge +0.5),
        // over 5 always loses (edge −0.5) so all three tie on |edge| and the
        // empirical-rate tie-break sorts them.
        const ranked = rankBarriers(flat, 'over', [3, 2, 5], 2);
        expect(ranked.map(c => c.barrier)).toEqual([2, 3, 5]);
    });

    it('records the digit sample size on every candidate', () => {
        const [top] = rankBarriers(UNIFORM, 'under', [8], PAYOUT);
        expect(top.sampleSize).toBe(UNIFORM.length);
    });
});

describe('rankBarriers — per-barrier payout pricing', () => {
    it('prices each barrier from its theoretical rate so breakeven equals theory', () => {
        const ranked = rankBarriers(UNIFORM, 'under', [7, 8], b => fairPayoutRatio('under', b));
        expect(ranked).toHaveLength(2);
        const under7 = ranked.find(c => c.barrier === 7)!;
        const under8 = ranked.find(c => c.barrier === 8)!;
        expect(under7.breakeven).toBeCloseTo(0.7, 10);
        expect(under8.breakeven).toBeCloseTo(0.8, 10);
        expect(under8.edge).toBeCloseTo(0.8 - 0.8, 10); // uniform digits ≈ fair
        expect(under7.expectedValuePct).toBeCloseTo(0.7 * (1 / 0.7) - 1, 10);
    });

    it('reflects a skew against the theoretical breakeven', () => {
        const [top] = rankBarriers(HIGH_SKEW, 'under', [8], b => fairPayoutRatio('under', b));
        expect(top.edge).toBeCloseTo(0.16 - 0.8, 10);
        expect(top.expectedValuePct).toBeCloseTo(0.16 * (1 / 0.8) - 1, 10);
        expect(top.theoreticalProb).toBeCloseTo(0.8, 10);
    });
});

describe('rankBarriers — guards on inputs', () => {
    it('returns an empty list for an empty digit history', () => {
        expect(rankBarriers([], 'over', [2, 3], PAYOUT)).toEqual([]);
    });

    it('returns an empty list when no barriers are supplied', () => {
        expect(rankBarriers(UNIFORM, 'over', [], PAYOUT)).toEqual([]);
    });

    it('handles a single-digit history', () => {
        const ranked = rankBarriers([9], 'over', [2, 3], 2);
        expect(ranked).toHaveLength(2);
        expect(ranked[0].empiricalProb).toBe(1);
        expect(ranked[0].sampleSize).toBe(1);
    });

    it('drops duplicates and barriers invalid for the direction', () => {
        // Valid over barriers are 0–8: 2 (edge +0.19), 0 (+0.39), 8 (−0.41);
        // ranked by |edge| the worst deviation comes first.
        const ranked = rankBarriers(UNIFORM, 'over', [2, 2, 9, -1, 2.5, 0, 8], PAYOUT);
        expect(ranked.map(c => c.barrier)).toEqual([8, 0, 2]);
        // Under barriers are 1–9: under 1 (−0.41) outranks under 9 (+0.39).
        expect(rankBarriers(UNIFORM, 'under', [0, 1, 9], PAYOUT).map(c => c.barrier)).toEqual([1, 9]);
    });

    it('skips barriers whose payout ratio is not positive', () => {
        expect(rankBarriers(UNIFORM, 'over', [2, 3], 0)).toEqual([]);
        expect(rankBarriers(UNIFORM, 'over', [2, 3], () => -1)).toEqual([]);
    });

    it('caps the list at the requested limit', () => {
        const capped = rankBarriers(UNIFORM, 'under', [5, 6, 7, 8, 9], PAYOUT, 2);
        expect(capped.map(c => c.barrier)).toEqual([9, 8]);
        expect(rankBarriers(UNIFORM, 'under', [5, 6, 7], PAYOUT, 0)).toEqual([]);
    });
});

describe('breakevenRate', () => {
    it('is the inverse of a positive payout ratio', () => {
        expect(breakevenRate(2)).toBe(0.5);
        expect(breakevenRate(1.95)).toBeCloseTo(1 / 1.95, 10);
    });

    it('is infinite when the payout ratio is not positive', () => {
        expect(breakevenRate(0)).toBe(Number.POSITIVE_INFINITY);
        expect(breakevenRate(-2)).toBe(Number.POSITIVE_INFINITY);
    });
});

describe('fairPayoutRatio', () => {
    it('inverts the theoretical win rate', () => {
        expect(fairPayoutRatio('over', 2)).toBeCloseTo(1 / 0.7, 10);
        expect(fairPayoutRatio('under', 8)).toBeCloseTo(1.25, 10);
        expect(fairPayoutRatio('over', 8)).toBeCloseTo(10, 10);
    });

    it('returns 0 when the barrier has no theoretical wins', () => {
        expect(fairPayoutRatio('over', 9)).toBe(0);
    });
});

describe('evaluateSessionGuard', () => {
    it('fires the take-profit when session profit reaches the target', () => {
        const v = evaluateSessionGuard(10, 10, 10);
        expect(v.stop).toBe(true);
        expect(v.reason).toBe('Session take-profit reached');
        expect(v.sessionProfit).toBe(10);
        expect(evaluateSessionGuard(12.5, 10, 10).reason).toBe('Session take-profit reached');
    });

    it('fires the stop-loss when session profit drops to the target', () => {
        const v = evaluateSessionGuard(-10, 10, 10);
        expect(v.stop).toBe(true);
        expect(v.reason).toBe('Session stop-loss reached');
        expect(evaluateSessionGuard(-15.25, 10, 10).reason).toBe('Session stop-loss reached');
    });

    it('tolerates float noise just below a hit target', () => {
        expect(evaluateSessionGuard(9.999, 10, 10).stop).toBe(false);
        expect(evaluateSessionGuard(-9.999, 10, 10).stop).toBe(false);
    });

    it('does not stop inside the band', () => {
        const v = evaluateSessionGuard(4.5, 10, 10);
        expect(v.stop).toBe(false);
        expect(v.reason).toBeNull();
    });

    it('treats zero (or negative) targets as disabled', () => {
        expect(evaluateSessionGuard(500, 0, 10).stop).toBe(false);
        expect(evaluateSessionGuard(-500, 10, 0).stop).toBe(false);
        expect(evaluateSessionGuard(500, 0, 0).stop).toBe(false);
        expect(evaluateSessionGuard(-500, -1, -1).stop).toBe(false);
    });

    it('checks take-profit first when both targets would fire', () => {
        const v = evaluateSessionGuard(20, 10, 10);
        expect(v.reason).toBe('Session take-profit reached');
    });

    it('ignores the opposite direction of each guard', () => {
        expect(evaluateSessionGuard(-50, 10, 10).reason).toBe('Session stop-loss reached');
        expect(evaluateSessionGuard(50, 10, 10).reason).toBe('Session take-profit reached');
        expect(evaluateSessionGuard(-50, 10, 0).stop).toBe(false);
        expect(evaluateSessionGuard(50, 0, 10).stop).toBe(false);
    });
});
