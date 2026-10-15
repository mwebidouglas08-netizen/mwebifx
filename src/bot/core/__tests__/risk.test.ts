import { applySettlement, evaluateOpportunity, initialRiskState, resumeTrading, suspendTrading } from '../risk';
import { ContractOpportunity, RiskLimits, RiskState, TradeRecord } from '../types';

const LIMITS: RiskLimits = {
    maxStake: 10,
    maxStakePctEquity: 0.02,
    maxDailyLoss: 20,
    maxTotalDrawdown: 50,
    maxConsecutiveLosses: 3,
    maxOpenPositions: 1,
    maxTradesPerSession: 100,
    minExpectedValue: 0.01,
    minPayoutRatio: 1.05,
    minConfidence: 0.6,
    minSampleSize: 500,
    cooldownAfterLosses: 2,
    cooldownMs: 120000,
};

const opp = (patch: Partial<ContractOpportunity> = {}): ContractOpportunity => ({
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
    ...patch,
});

describe('evaluateOpportunity — hard gates', () => {
    it('blocks when trading is suspended', () => {
        const state = { ...initialRiskState(1000), suspended: true, suspensionReason: 'Daily loss limit reached (20)' };
        const v = evaluateOpportunity(opp(), state, LIMITS, 1000);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('suspended');
        expect(v.reason).toContain('Daily loss limit');
    });

    it('blocks when the open-position limit is reached', () => {
        const state = { ...initialRiskState(1000), openPositions: 1 };
        const v = evaluateOpportunity(opp(), state, LIMITS, 1000);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('open_positions');
    });

    it('blocks when the session trade limit is reached', () => {
        const state = { ...initialRiskState(1000), tradesThisSession: 100 };
        const v = evaluateOpportunity(opp(), state, LIMITS, 1000);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('session_limit');
    });

    it('blocks when the daily loss limit is reached', () => {
        const state = { ...initialRiskState(1000), dailyPnl: -20 };
        const v = evaluateOpportunity(opp(), state, LIMITS, 1000);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('daily_loss');
    });

    it('blocks when max drawdown is reached', () => {
        const state = { ...initialRiskState(1000), drawdown: 50 };
        const v = evaluateOpportunity(opp(), state, LIMITS, 1000);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('drawdown');
    });

    it('blocks when the consecutive-loss limit is reached', () => {
        const state = { ...initialRiskState(1000), consecutiveLosses: 3 };
        const v = evaluateOpportunity(opp(), state, LIMITS, 1000);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('consecutive_losses');
    });

    it('blocks during the post-loss cooldown window', () => {
        const now = Date.now();
        const state: RiskState = {
            ...initialRiskState(1000),
            consecutiveLosses: 2,
            lastLossAt: now - 1000,
        };
        const v = evaluateOpportunity(opp(), state, LIMITS, 1000, now);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('cooldown');
        expect(v.reason).toContain('Cooldown active');
    });

    it('allows again once the cooldown window has passed', () => {
        const now = Date.now();
        const state: RiskState = {
            ...initialRiskState(1000),
            consecutiveLosses: 2,
            lastLossAt: now - 121000,
        };
        const v = evaluateOpportunity(opp(), state, LIMITS, 1000, now);
        expect(v.allowed).toBe(true);
    });
});

describe('evaluateOpportunity — edge gates', () => {
    it('blocks low confidence unless skipEdgeGates is set', () => {
        const state = initialRiskState(1000);
        const blocked = evaluateOpportunity(opp({ confidence: 0.5 }), state, LIMITS, 1000);
        expect(blocked.allowed).toBe(false);
        expect(blocked.gate).toBe('low_confidence');

        const skipped = evaluateOpportunity(opp({ confidence: 0.5 }), state, LIMITS, 1000, Date.now(), { skipEdgeGates: true });
        expect(skipped.allowed).toBe(true);
    });

    it('blocks a sample smaller than the minimum', () => {
        const v = evaluateOpportunity(opp({ sampleSize: 100 }), initialRiskState(1000), LIMITS, 1000);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('small_sample');
    });

    it('blocks expected value below the floor', () => {
        const v = evaluateOpportunity(opp({ expectedValuePct: 0.005 }), initialRiskState(1000), LIMITS, 1000);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('low_ev');
    });

    it('blocks a payout ratio below the floor', () => {
        const v = evaluateOpportunity(opp({ payoutRatio: 1.0 }), initialRiskState(1000), LIMITS, 1000);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('low_payout');
    });
});

describe('evaluateOpportunity — stake sizing (floor vs caps)', () => {
    it('caps the stake at maxStake when it is tighter than the equity cap', () => {
        // Equity 1000 × 2% = 20, but maxStake 10 wins → stake 10.
        const v = evaluateOpportunity(opp({ stake: 15 }), initialRiskState(1000), LIMITS, 1000);
        expect(v.allowed).toBe(true);
        expect(v.stake).toBe(10);
    });

    it('uses the equity cap when it is tighter than maxStake', () => {
        // Equity 200 × 2% = 4 → stake 4.
        const v = evaluateOpportunity(opp({ stake: 5 }), initialRiskState(200), LIMITS, 200);
        expect(v.allowed).toBe(true);
        expect(v.stake).toBe(4);
    });

    it('never floors a sub-minimum stake above the equity cap (regression: equity < 17.5)', () => {
        // Equity 10 × 2% = 0.20 < 0.35 minimum. The old code raised the stake
        // to 0.35 (breaching the cap) then compared against maxStake. It must
        // now refuse instead of violating its own caps.
        const v = evaluateOpportunity(opp({ stake: 1 }), initialRiskState(10), LIMITS, 10);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('stake_too_high');
        expect(v.stake).toBe(0);
        expect(v.reason).toContain('0.35');
    });

    it('floors at Deriv\'s 0.35 minimum when the caps still allow it', () => {
        // Equity 1000 × 2% = 20 and maxStake 10 — both above 0.35.
        const v = evaluateOpportunity(opp({ stake: 0.2 }), initialRiskState(1000), LIMITS, 1000);
        expect(v.allowed).toBe(true);
        expect(v.stake).toBe(0.35);
    });

    it('refuses when maxStake itself is below the 0.35 minimum', () => {
        const tight: RiskLimits = { ...LIMITS, maxStake: 0.3 };
        const v = evaluateOpportunity(opp({ stake: 1 }), initialRiskState(1000), tight, 1000);
        expect(v.allowed).toBe(false);
        expect(v.gate).toBe('stake_too_high');
    });
});

describe('applySettlement', () => {
    const trade = (result: 'win' | 'loss', profit: number): TradeRecord => ({
        id: 't1',
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
        expectedValue: 0.4,
        confidence: 0.8,
        stage: 'settled',
        result,
        profit,
        openedAt: Date.now(),
        simulated: false,
    });

    it('decrements open positions and accrues a win', () => {
        const state: RiskState = { ...initialRiskState(1000), openPositions: 1, tradesThisSession: 1 };
        const next = applySettlement(state, trade('win', 0.95), 1000.95, LIMITS);
        expect(next.openPositions).toBe(0);
        expect(next.dailyPnl).toBeCloseTo(0.95, 10);
        expect(next.consecutiveLosses).toBe(0);
    });

    it('increments consecutive losses and stamps lastLossAt on a loss', () => {
        const now = Date.now();
        const state: RiskState = { ...initialRiskState(1000), openPositions: 1, consecutiveLosses: 1 };
        const next = applySettlement(state, trade('loss', -1), 999, LIMITS, now);
        expect(next.consecutiveLosses).toBe(2);
        expect(next.lastLossAt).toBe(now);
        expect(next.dailyPnl).toBeCloseTo(-1, 10);
    });

    it('never drives open positions negative', () => {
        const next = applySettlement(initialRiskState(1000), trade('win', 0.95), 1000.95, LIMITS);
        expect(next.openPositions).toBe(0);
    });

    it('suspends when the daily loss limit is crossed', () => {
        const state: RiskState = { ...initialRiskState(1000), openPositions: 1, dailyPnl: -19.5 };
        const next = applySettlement(state, trade('loss', -1), 999, LIMITS);
        expect(next.suspended).toBe(true);
        expect(next.suspensionReason).toContain('Daily loss limit');
    });

    it('suspends when the consecutive-loss limit is crossed', () => {
        const state: RiskState = { ...initialRiskState(1000), openPositions: 1, consecutiveLosses: 2 };
        const next = applySettlement(state, trade('loss', -1), 999, LIMITS);
        expect(next.suspended).toBe(true);
        expect(next.suspensionReason).toContain('Consecutive loss limit');
    });

    it('updates peak equity and drawdown', () => {
        const state: RiskState = { ...initialRiskState(1000), openPositions: 1, peakEquity: 1000 };
        const next = applySettlement(state, trade('loss', -50), 950, { ...LIMITS, maxTotalDrawdown: 50 });
        expect(next.peakEquity).toBe(1000);
        expect(next.drawdown).toBe(50);
    });
});

describe('initialRiskState / suspend / resume', () => {
    it('starts clean', () => {
        const s = initialRiskState(500);
        expect(s).toEqual({
            suspended: false,
            suspensionReason: null,
            suspendedAt: null,
            consecutiveLosses: 0,
            dailyPnl: 0,
            peakEquity: 500,
            drawdown: 0,
            tradesThisSession: 0,
            lastLossAt: null,
            openPositions: 0,
        });
    });

    it('suspend stamps the reason and time', () => {
        const now = Date.now();
        const s = suspendTrading(initialRiskState(500), 'Manual halt', now);
        expect(s.suspended).toBe(true);
        expect(s.suspensionReason).toBe('Manual halt');
        expect(s.suspendedAt).toBe(now);
    });

    it('resume clears the suspension and resets loss bookkeeping', () => {
        const suspended: RiskState = {
            ...initialRiskState(450),
            suspended: true,
            suspensionReason: 'Daily loss limit reached (20)',
            suspendedAt: Date.now(),
            consecutiveLosses: 3,
            dailyPnl: -25,
            drawdown: 30,
        };
        const s = resumeTrading(suspended, 450);
        expect(s.suspended).toBe(false);
        expect(s.suspensionReason).toBeNull();
        expect(s.suspendedAt).toBeNull();
        expect(s.consecutiveLosses).toBe(0);
        expect(s.dailyPnl).toBe(0);
        expect(s.drawdown).toBe(0);
        expect(s.peakEquity).toBe(450);
    });
});
