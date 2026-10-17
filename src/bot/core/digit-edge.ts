import { Direction } from './types';
import { barrierIsValid } from './ev';
import { empiricalProbability, theoreticalProbability } from './digit-stats';

export interface BarrierRanking {
    barrier: number;
    empiricalProb: number;
    theoreticalProb: number;
    breakeven: number;
    /** empiricalProb − breakeven: positive means the recent rate clears the payout. */
    edge: number;
    absEdge: number;
    /** empiricalProb × payoutRatio − 1, for ranking-aware display. */
    expectedValuePct: number;
    sampleSize: number;
}

/** One payout ratio for every barrier, or one priced per barrier. */
export type PayoutRatioSource = number | ((barrier: number) => number);

export const breakevenRate = (payoutRatio: number): number =>
    payoutRatio > 0 ? 1 / payoutRatio : Number.POSITIVE_INFINITY;

/**
 * Zero-margin payout estimate for a barrier: the inverse of its theoretical
 * win rate, so the breakeven equals that theoretical probability. A
 * ranking-only stand-in for a live quote — buys always re-price via
 * requestQuote, so this never enters an EV decision.
 */
export const fairPayoutRatio = (direction: Direction, barrier: number): number => {
    const theoretical = theoreticalProbability(direction, barrier);
    return theoretical > 0 ? 1 / theoretical : 0;
};

/**
 * Rank candidate barriers by |empirical − breakeven| over recent digits. Used
 * to decide which discovered-but-unconfigured barriers are worth spending the
 * proposal budget on. Invalid, duplicate and unpriceable (payout ratio ≤ 0)
 * barriers are dropped; ties break toward the higher empirical rate, then the
 * lower barrier, so ordering is deterministic.
 */
export const rankBarriers = (
    digits: number[],
    direction: Direction,
    barriers: number[],
    payoutRatio: PayoutRatioSource,
    limit?: number
): BarrierRanking[] => {
    if (!digits.length || !barriers.length) return [];
    const seen = new Set<number>();
    const ranked: BarrierRanking[] = [];
    for (const barrier of barriers) {
        if (!Number.isInteger(barrier) || seen.has(barrier)) continue;
        seen.add(barrier);
        if (!barrierIsValid(direction, barrier)) continue;
        const ratio = typeof payoutRatio === 'function' ? payoutRatio(barrier) : payoutRatio;
        if (!(ratio > 0)) continue;
        const breakeven = breakevenRate(ratio);
        const empiricalProb = empiricalProbability(digits, direction, barrier);
        const edge = empiricalProb - breakeven;
        ranked.push({
            barrier,
            empiricalProb,
            theoreticalProb: theoreticalProbability(direction, barrier),
            breakeven,
            edge,
            absEdge: Math.abs(edge),
            expectedValuePct: empiricalProb * ratio - 1,
            sampleSize: digits.length,
        });
    }
    ranked.sort((a, b) => b.absEdge - a.absEdge || b.empiricalProb - a.empiricalProb || a.barrier - b.barrier);
    return limit === undefined ? ranked : ranked.slice(0, Math.max(0, limit));
};

export interface SessionGuardVerdict {
    stop: boolean;
    reason: string | null;
    sessionProfit: number;
}

/**
 * Session take-profit / stop-loss in account currency. A target of 0 (or less)
 * disables that guard; the 1e-6 epsilon matches the Algo Pro engine so float
 * noise on an exactly-hit target still stops the session.
 */
export const evaluateSessionGuard = (
    sessionProfit: number,
    takeProfit: number,
    stopLoss: number
): SessionGuardVerdict => {
    if (takeProfit > 0 && sessionProfit + 1e-6 >= takeProfit) {
        return { stop: true, reason: 'Session take-profit reached', sessionProfit };
    }
    if (stopLoss > 0 && sessionProfit - 1e-6 <= -stopLoss) {
        return { stop: true, reason: 'Session stop-loss reached', sessionProfit };
    }
    return { stop: false, reason: null, sessionProfit };
};
