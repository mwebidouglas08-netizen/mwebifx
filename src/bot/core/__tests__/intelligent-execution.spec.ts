import {
    DEFAULT_MIN_CONFIDENCE,
    buildTradeOutcome,
    describeOutcome,
    evaluateCandidate,
    expectedValue,
    normalizeConfidence,
    rankCandidates,
    selectBestCandidate,
    selectFallbackCandidates,
    type ExecutableCandidate,
} from '../intelligent-execution';

const candidate = (over: Partial<ExecutableCandidate> = {}): ExecutableCandidate => ({
    symbol: 'R_100',
    confidence: 0.8,
    ...over,
});

describe('normalizeConfidence', () => {
    it('accepts both 0..100 and 0..1 scales', () => {
        expect(normalizeConfidence(58)).toBeCloseTo(0.58, 5);
        expect(normalizeConfidence(0.42)).toBe(0.42);
        expect(normalizeConfidence(75, 100)).toBe(0.75);
        expect(normalizeConfidence(0.9, 1)).toBe(0.9);
        expect(normalizeConfidence(75, 1)).toBe(1);
    });

    it('clamps out-of-range and non-finite input', () => {
        expect(normalizeConfidence(-5)).toBe(0);
        expect(normalizeConfidence(400)).toBe(1);
        expect(normalizeConfidence(Number.NaN)).toBe(0);
        expect(normalizeConfidence(Number.POSITIVE_INFINITY)).toBe(0);
    });
});

describe('expectedValue', () => {
    it('is positive only above the break-even win rate', () => {
        expect(expectedValue(0.6, 1.9)).toBeCloseTo(0.14, 6);
        expect(expectedValue(0.4, 1.9)).toBeLessThan(0);
        // 1 / 1.9 is exactly break-even for a 1.9x payout.
        expect(expectedValue(1 / 1.9, 1.9)).toBeCloseTo(0, 6);
    });
});

describe('evaluateCandidate', () => {
    it('rejects confidence below the gate', () => {
        const decision = evaluateCandidate(candidate({ confidence: 0.4 }), {
            minConfidence: DEFAULT_MIN_CONFIDENCE,
        });
        expect(decision.ok).toBe(false);
        expect(decision.reason).toContain('confidence');
    });

    it('normalises a 0..100 confidence before comparing', () => {
        const decision = evaluateCandidate(candidate({ confidence: 82 }), {
            minConfidence: DEFAULT_MIN_CONFIDENCE,
        });
        expect(decision.ok).toBe(true);
        expect(decision.confidence).toBeCloseTo(0.82, 5);
    });

    it('rejects readings backed by too few samples', () => {
        const decision = evaluateCandidate(candidate({ sampleSize: 12 }), {
            minConfidence: 0,
            minSample: 30,
        });
        expect(decision.ok).toBe(false);
        expect(decision.reason).toContain('sample');
    });

    it('rejects a structurally losing price when EV must be positive', () => {
        const decision = evaluateCandidate(
            candidate({ winRate: 0.45, payoutRatio: 1.9 }),
            { minConfidence: 0, requirePositiveEv: true }
        );
        expect(decision.ok).toBe(false);
        expect(decision.reason).toContain('expected value');
        expect(decision.expectedValue).toBeLessThan(0);
    });

    it('accepts a favourable, well-sampled candidate', () => {
        const decision = evaluateCandidate(
            candidate({ winRate: 0.6, payoutRatio: 1.9, sampleSize: 64, confidence: 90 }),
            { minConfidence: 0.58, minSample: 30, requirePositiveEv: true }
        );
        expect(decision.ok).toBe(true);
        expect(decision.expectedValue).toBeGreaterThan(0);
    });
});

describe('ranking and selection', () => {
    const list: ExecutableCandidate[] = [
        candidate({ symbol: 'R_10', confidence: 0.6, edge: 0.02 }),
        candidate({ symbol: 'R_25', confidence: 0.9, edge: 0.11 }),
        candidate({ symbol: 'R_50', confidence: 0.2, edge: 0.4 }),
    ];

    it('drops gated candidates and ranks the most favourable first', () => {
        const ranked = rankCandidates(list, { minConfidence: 0.5 });
        expect(ranked.map(c => c.symbol)).toEqual(['R_25', 'R_10']);
    });

    it('returns the single best pick', () => {
        expect(selectBestCandidate(list, { minConfidence: 0.5 })?.symbol).toBe('R_25');
    });

    it('returns null when nothing clears the gate', () => {
        expect(selectBestCandidate(list, { minConfidence: 0.99 })).toBeNull();
    });

    it('caps the ordered fallback list', () => {
        const many = Array.from({ length: 8 }, (_, i) =>
            candidate({ symbol: `R_${i}`, confidence: 0.7, edge: i / 100 })
        );
        const fallback = selectFallbackCandidates(many, { minConfidence: 0.5 }, 3);
        expect(fallback).toHaveLength(3);
        expect(fallback[0].symbol).toBe('R_7');
    });
});

describe('buildTradeOutcome', () => {
    it('derives profit from stake and payout', () => {
        const win = buildTradeOutcome(true, 10, 19);
        expect(win.expectedProfit).toBe(9);
        expect(win.profit).toBe(9);
        expect(win.mismatch).toBe(false);

        const loss = buildTradeOutcome(false, 10, 0);
        expect(loss.expectedProfit).toBe(-10);
        expect(loss.profit).toBe(-10);
        expect(loss.mismatch).toBe(false);
    });

    it('flags a settlement that does not add up', () => {
        const outcome = buildTradeOutcome(true, 10, 19, 2.5);
        expect(outcome.mismatch).toBe(true);
    });

    it('summarises for logs and voice', () => {
        expect(describeOutcome(buildTradeOutcome(true, 10, 19), 'R_100')).toBe('WIN R_100 — +9.00');
        expect(describeOutcome(buildTradeOutcome(false, 10, 0))).toBe('LOSS — -10.00');
    });
});
