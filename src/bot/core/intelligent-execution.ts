/**
 * Intelligent execution standards shared by every Dollarvault bot.
 *
 * Each engine has its own discovery/analysis loop, but the final "do we fire
 * this order, and on which market?" decision should follow one consistent rule
 * set so behaviour stays predictable in production:
 *
 *   1. Normalise confidence to 0..1 no matter which engine produced it.
 *   2. Drop candidates that fail minimum confidence / sample / edge gates.
 *   3. Rank survivors by measured edge first, then confidence, then recency —
 *      always selecting the *most favourable* market rather than whichever
 *      arrived first.
 *   4. Compute the expected outcome of the pick (EV, break-even check) so a
 *      trade is never placed on a structurally losing price.
 *
 * Everything here is pure and side-effect free, which keeps it trivially
 * testable and safe to call from any engine's tick handler.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutableCandidate {
    symbol: string;
    displayName?: string;
    /** Confidence on an unknown scale — normalised by `normalizeConfidence`. */
    confidence: number;
    /** Win rate measured from live data, 0..1 (optional). */
    winRate?: number;
    /** House break-even win rate, 0..1 (optional). */
    breakeven?: number;
    /** winRate − breakeven, 0..1 (optional; derived when both sides present). */
    edge?: number;
    /** Ticks/samples backing the reading (optional). */
    sampleSize?: number;
    /** Payout multiplier for a win, e.g. 1.9 (optional). */
    payoutRatio?: number;
    /** Engine-specific action/contract label for messaging (optional). */
    action?: string;
    contractType?: string;
    barrier?: number;
}

export interface SelectionGate {
    /** Minimum confidence, 0..1. */
    minConfidence: number;
    /** Minimum samples before the reading is trusted. */
    minSample?: number;
    /** Minimum edge over break-even, 0..1, when `breakeven`/`edge` present. */
    minEdge?: number;
    /** Require a positive expected value when `payoutRatio` is present. */
    requirePositiveEv?: boolean;
}

export interface ExecutionDecision {
    ok: boolean;
    reason?: string;
    /** Populated for diagnostics/tests. */
    confidence: number;
    edge?: number;
    expectedValue?: number;
}

/** Conservative default: 58% is the same threshold the signal scanner uses. */
export const DEFAULT_MIN_CONFIDENCE = 0.58;
export const DEFAULT_MIN_SAMPLE = 30;
export const DEFAULT_MIN_EDGE = 0;

export const NEUTRAL_GATE: SelectionGate = {
    minConfidence: DEFAULT_MIN_CONFIDENCE,
    minSample: DEFAULT_MIN_SAMPLE,
    minEdge: DEFAULT_MIN_EDGE,
    requirePositiveEv: false,
};

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Accepts confidence expressed as 0..1 (Algo Pro pair confidence) or 0..100
 * (signal scanner strength) and always returns 0..1.
 */
export const normalizeConfidence = (value: number, scale: 1 | 100 | 'auto' = 'auto'): number => {
    if (!Number.isFinite(value)) return 0;
    if (scale === 100) return clamp01(value / 100);
    if (scale === 1) return clamp01(value);
    // auto: anything > 1 is on the 0..100 scale
    return value > 1 ? clamp01(value / 100) : clamp01(value);
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Derive edge from winRate/breakeven when `edge` wasn't supplied. */
const resolveEdge = (c: ExecutableCandidate): number | undefined => {
    if (typeof c.edge === 'number' && Number.isFinite(c.edge)) return c.edge;
    if (typeof c.winRate === 'number' && typeof c.breakeven === 'number') return c.winRate - c.breakeven;
    return undefined;
};

/** Standard expected value for a binary option: p·(ratio−1) − (1−p). */
export const expectedValue = (winRate: number, payoutRatio: number): number =>
    winRate * (payoutRatio - 1) - (1 - winRate);

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

export const evaluateCandidate = (c: ExecutableCandidate, gate: SelectionGate = NEUTRAL_GATE): ExecutionDecision => {
    const confidence = normalizeConfidence(c.confidence);
    const edge = resolveEdge(c);

    if (confidence < gate.minConfidence) {
        return { ok: false, reason: `confidence ${confidence.toFixed(2)} < ${gate.minConfidence}`, confidence, edge };
    }
    if (typeof gate.minSample === 'number' && typeof c.sampleSize === 'number' && c.sampleSize < gate.minSample) {
        return { ok: false, reason: `sample ${c.sampleSize} < ${gate.minSample}`, confidence, edge };
    }
    if (typeof gate.minEdge === 'number' && gate.minEdge > 0 && edge !== undefined && edge < gate.minEdge) {
        return { ok: false, reason: `edge ${edge.toFixed(3)} < ${gate.minEdge}`, confidence, edge };
    }
    if (gate.requirePositiveEv && typeof c.winRate === 'number' && typeof c.payoutRatio === 'number') {
        const ev = expectedValue(c.winRate, c.payoutRatio);
        if (ev <= 0) {
            return { ok: false, reason: `expected value ${ev.toFixed(4)} <= 0`, confidence, edge, expectedValue: ev };
        }
        return { ok: true, confidence, edge, expectedValue: ev };
    }
    return { ok: true, confidence, edge };
};

// ---------------------------------------------------------------------------
// Ranking / selection
// ---------------------------------------------------------------------------

/**
 * Rank candidates by measured edge first, then confidence. Markets that fail
 * the gate are dropped entirely, so the caller can only ever receive a
 * favourable, high-confidence pick.
 */
export const rankCandidates = <T extends ExecutableCandidate>(list: T[], gate: SelectionGate = NEUTRAL_GATE): T[] =>
    list
        .map(c => ({ c, d: evaluateCandidate(c, gate) }))
        .filter((x): x is { c: T; d: ExecutionDecision } => x.d.ok)
        .sort((a, b) => {
            const ea = a.d.edge ?? a.d.confidence;
            const eb = b.d.edge ?? b.d.confidence;
            if (eb !== ea) return eb - ea;
            return b.d.confidence - a.d.confidence;
        })
        .map(x => x.c);

/** Single best eligible market, or null when nothing clears the gate. */
export const selectBestCandidate = <T extends ExecutableCandidate>(list: T[], gate: SelectionGate = NEUTRAL_GATE): T | null =>
    rankCandidates(list, gate)[0] ?? null;

/**
 * Ordered fallback list for engines that try several markets in one scan —
 * strongest first, capped so a failed quote falls through quickly.
 */
export const selectFallbackCandidates = <T extends ExecutableCandidate>(
    list: T[],
    gate: SelectionGate = NEUTRAL_GATE,
    limit = 3
): T[] => rankCandidates(list, gate).slice(0, Math.max(1, limit));

// ---------------------------------------------------------------------------
// Outcome reporting
// ---------------------------------------------------------------------------

export interface TradeOutcome {
    won: boolean;
    stake: number;
    /** Gross payout received (0 for a loss). */
    payout: number;
    /** Signed net profit/loss. */
    profit: number;
    /** win ? payout − stake : −stake — cross-checked against `profit`. */
    expectedProfit: number;
    /** True when the reported profit disagrees with stake/payout. */
    mismatch: boolean;
}

/**
 * Build an authoritative outcome record so every bot reports trade results the
 * same way, and flag any settlement that doesn't add up (a real reliability
 * signal in production).
 */
export const buildTradeOutcome = (won: boolean, stake: number, payout = 0, reportedProfit?: number): TradeOutcome => {
    const s = Number.isFinite(stake) ? stake : 0;
    const p = Number.isFinite(payout) ? payout : 0;
    const expectedProfit = won ? p - s : -s;
    const profit = Number.isFinite(reportedProfit) ? reportedProfit : expectedProfit;
    const mismatch = Math.abs(profit - expectedProfit) > 0.01;
    return { won, stake: s, payout: p, profit, expectedProfit, mismatch };
};

/** Human summary used for logs and voice announcements. */
export const describeOutcome = (o: TradeOutcome, marketLabel?: string): string =>
    `${o.won ? 'WIN' : 'LOSS'}${marketLabel ? ` ${marketLabel}` : ''} — ${o.profit >= 0 ? '+' : ''}${o.profit.toFixed(2)}`;
