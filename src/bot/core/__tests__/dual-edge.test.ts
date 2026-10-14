import {
    DEFAULT_DUAL_CONFIG,
    DualConfig,
    DualProfile,
    DualSideState,
    applySideResult,
    dualStopReason,
    dualTotals,
    getDualProfile,
    initialSideState,
    nextStakePreview,
    sideExhausted,
} from '../dual-edge';

const profile: DualProfile = getDualProfile('OU_1_8');

const recovery: DualConfig = {
    ...DEFAULT_DUAL_CONFIG,
    mode: 'RECOVERY',
    baseStake: 1,
    stakeFactor: 2,
    stakeCap: 50,
};

const mkulima: DualConfig = {
    ...DEFAULT_DUAL_CONFIG,
    mode: 'MKULIMA',
    baseStake: 1,
    stakeStep: 1,
    stakeCap: 50,
};

describe('RECOVERY mode', () => {
    it('starts the over side at its initial barrier and base stake', () => {
        const s = initialSideState('over', profile, recovery);

        expect(s.barrier).toBe(1);
        expect(s.stake).toBe(1);
        expect(s.step).toBe(0);
        expect(s.wins).toBe(0);
        expect(s.losses).toBe(0);
    });

    it('switches to the recovery barrier and doubles the stake on a loss', () => {
        const s0 = initialSideState('over', profile, recovery);
        const s1 = applySideResult(s0, profile, recovery, { won: false });

        expect(s1.barrier).toBe(4);
        expect(s1.stake).toBe(2);
        expect(s1.step).toBe(1);
        expect(s1.consecutiveLosses).toBe(1);
        expect(s1.losses).toBe(1);
    });

    it('caps the recovery stake at stakeCap', () => {
        const capped: DualConfig = { ...recovery, stakeCap: 3 };
        let s = initialSideState('over', profile, capped);

        s = applySideResult(s, profile, capped, { won: false });
        expect(s.stake).toBe(2);
        s = applySideResult(s, profile, capped, { won: false });
        expect(s.stake).toBe(3);
        s = applySideResult(s, profile, capped, { won: false });
        expect(s.stake).toBe(3);
        expect(s.barrier).toBe(4);
    });

    it('resets barrier, stake and step on a win', () => {
        let s = initialSideState('over', profile, recovery);
        s = applySideResult(s, profile, recovery, { won: false });
        expect(s.barrier).toBe(4);

        const won = applySideResult(s, profile, recovery, { won: true });

        expect(won.barrier).toBe(1);
        expect(won.stake).toBe(1);
        expect(won.step).toBe(0);
        expect(won.consecutiveLosses).toBe(0);
        expect(won.wins).toBe(1);
    });

    it('runs the under side against its own barrier pair (8 → 5)', () => {
        let s = initialSideState('under', profile, recovery);
        expect(s.barrier).toBe(8);

        s = applySideResult(s, profile, recovery, { won: false });
        expect(s.barrier).toBe(5);
        expect(s.stake).toBe(2);
    });
});

describe('MKULIMA mode', () => {
    it('keeps the barrier unchanged and walks the stake ladder', () => {
        let s = initialSideState('over', profile, mkulima);
        expect(s.barrier).toBe(1);
        expect(s.stake).toBe(1);

        s = applySideResult(s, profile, mkulima, { won: false });
        expect(s.stake).toBe(2);
        expect(s.barrier).toBe(1);

        s = applySideResult(s, profile, mkulima, { won: false });
        expect(s.stake).toBe(3);
        expect(s.step).toBe(2);
        expect(s.barrier).toBe(1);

        s = applySideResult(s, profile, mkulima, { won: true });
        expect(s.stake).toBe(2);
        expect(s.barrier).toBe(1);

        s = applySideResult(s, profile, mkulima, { won: true });
        expect(s.stake).toBe(1);

        s = applySideResult(s, profile, mkulima, { won: true });
        expect(s.stake).toBe(1);
        expect(s.barrier).toBe(1);
    });

    it('floors the ladder at the base stake and caps it at stakeCap', () => {
        const capped: DualConfig = { ...mkulima, stakeCap: 4 };
        let s = initialSideState('over', profile, capped);

        s = applySideResult(s, profile, capped, { won: false });
        s = applySideResult(s, profile, capped, { won: false });
        s = applySideResult(s, profile, capped, { won: false });
        expect(s.stake).toBe(4);
        s = applySideResult(s, profile, capped, { won: false });
        expect(s.stake).toBe(4);
    });
});

describe('dualStopReason', () => {
    const sideWith = (patch: Partial<DualSideState>): DualSideState => ({
        ...initialSideState('over', profile, recovery),
        ...patch,
    });

    it('reports take profit when the combined profit reaches the target', () => {
        const sides = [sideWith({ profit: 25, wins: 3 })];
        const reason = dualStopReason(sides, { ...recovery, takeProfit: 20, stopLoss: 20 });

        expect(reason).toContain('Take profit');
    });

    it('reports stop loss when the combined loss reaches the limit', () => {
        const sides = [sideWith({ profit: -25, losses: 3 })];
        const reason = dualStopReason(sides, { ...recovery, takeProfit: 20, stopLoss: 20 });

        expect(reason).toContain('Stop loss');
    });

    it('reports the exhausted side once consecutive losses exceed maxRecoverySteps', () => {
        const sides = [sideWith({ consecutiveLosses: 5, losses: 5 })];
        const reason = dualStopReason(sides, recovery);

        expect(reason).toContain('exhausted');
        expect(reason).toContain('over side');
        expect(sideExhausted(sides[0], recovery)).toBe(true);
    });

    it('returns null while everything is inside the limits', () => {
        const sides = [sideWith({ profit: -5, consecutiveLosses: 2, losses: 2 })];

        expect(dualStopReason(sides, recovery)).toBeNull();
        expect(sideExhausted(sides[0], recovery)).toBe(false);
    });
});

describe('profit accounting', () => {
    it('leaves profit untouched for a win without a payoutRatio', () => {
        const s0 = initialSideState('over', profile, recovery);
        const s1 = applySideResult(s0, profile, recovery, { won: true });

        expect(s1.profit).toBe(0);
        expect(s1.wins).toBe(1);
    });

    it('credits stake × (payoutRatio − 1) for a win with a payoutRatio', () => {
        const s0 = initialSideState('over', profile, recovery);
        const s1 = applySideResult(s0, profile, recovery, { won: true, payoutRatio: 1.95 });

        expect(s1.profit).toBeCloseTo(0.95, 2);
    });

    it('deducts the staked amount on a loss (as documented in the module)', () => {
        let s = initialSideState('over', profile, recovery);
        s = applySideResult(s, profile, recovery, { won: false });
        expect(s.profit).toBe(-1);

        s = applySideResult(s, profile, recovery, { won: false });
        expect(s.profit).toBe(-3);
    });

    it('sums both sides through dualTotals', () => {
        const over = applySideResult(initialSideState('over', profile, recovery), profile, recovery, {
            won: true,
            payoutRatio: 2,
        });
        const under = applySideResult(initialSideState('under', profile, recovery), profile, recovery, {
            won: false,
        });
        const totals = dualTotals([over, under]);

        expect(totals.wins).toBe(1);
        expect(totals.losses).toBe(1);
        expect(totals.profit).toBe(0);
        expect(nextStakePreview(under, recovery)).toBe(2);
    });
});
