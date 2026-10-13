// Mean-reversion Over/Under signals — the signal methodology of the signaltraker
// scanner, ported honestly:
//
//   - a fixed 10-tick digit window per market
//   - the 8 classic digit barriers: OVER 1..4 and UNDER 6..9
//   - a hit-rate strength score over that window
//   - a contrarian "cluster" branch that arms when >=2 of the last 3 digits
//     violate the barrier (counter-digits just printed -> expect reversion)
//   - signals only fire at >= 85 strength (signaltraker's trigger threshold)
//
// One deliberate change: signaltraker picked the barrier per symbol with a
// deterministic char-code hash (cosmetic, not statistical). Here every barrier
// is scored each cycle and the strongest qualifying one is chosen, so the
// contract is data-driven. Unlike signaltraker there is NO randomness in the
// score — the cluster band (their 82..94 random range) is anchored at 85 and
// rises 3 points per extra violating digit.

export const MR_WINDOW = 10;
export const MR_CLUSTER_WINDOW = 3;
export const MR_CLUSTER_MIN = 2;
export const MR_TRIGGER_THRESHOLD = 85;
// Wave branches (hit-rate only) must beat the theoretical base rate by this
// many points, otherwise trivially-true picks like "UNDER 9 at 90%" would
// score 90+ on almost every window and fire constantly. Cluster signals are
// contrarian by construction and skip this gate.
export const MR_WAVE_SKEW = 10;
export const MR_OVER_BARRIERS: readonly number[] = [1, 2, 3, 4];
export const MR_UNDER_BARRIERS: readonly number[] = [6, 7, 8, 9];

export type MeanReversionKind = 'OVER' | 'UNDER';

export interface MeanReversionPick {
    kind: MeanReversionKind;
    barrier: number;
    /** 45..99, deterministic. */
    strength: number;
    /** Hit rate of the barrier over the window (whole percent). */
    pct: number;
    /** True when the cluster (mean-reversion) branch fired. */
    cluster: boolean;
    violations: number;
    /** The last MR_CLUSTER_WINDOW digits. */
    recent: number[];
    rationale: string;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

const cleanDigits = (digits: number[]): number[] =>
    digits.filter(d => Number.isInteger(d) && d >= 0 && d <= 9);

/** Whole-percent share of the window that satisfies the barrier. */
export const barrierHitRate = (digits: number[], kind: MeanReversionKind, barrier: number): number => {
    const window = cleanDigits(digits).slice(-MR_WINDOW);
    if (!window.length) return 0;
    const hits = window.filter(d => (kind === 'UNDER' ? d < barrier : d > barrier)).length;
    return Math.round((hits / window.length) * 100);
};

const digitWins = (d: number, kind: MeanReversionKind, barrier: number): boolean =>
    kind === 'UNDER' ? d < barrier : d > barrier;

/** Theoretical win rate of the barrier under a uniform digit distribution. */
export const theoreticalRate = (kind: MeanReversionKind, barrier: number): number =>
    // UNDER wins on digits 0..barrier-1 — same `digitWins` math as above.
    kind === 'UNDER' ? (barrier / 10) * 100 : ((9 - barrier) / 10) * 100;

export interface BarrierEvaluation {
    kind: MeanReversionKind;
    barrier: number;
    strength: number;
    pct: number;
    cluster: boolean;
    violations: number;
    recent: number[];
    pattern: string;
}

/** Score one barrier against the last MR_WINDOW digits. */
export const evaluateBarrier = (
    digits: number[],
    kind: MeanReversionKind,
    barrier: number
): BarrierEvaluation => {
    const window = cleanDigits(digits).slice(-MR_WINDOW);
    const pct = barrierHitRate(window, kind, barrier);
    const recent = window.slice(-MR_CLUSTER_WINDOW);
    // Counter-digits = recent prints that would LOSE the contract.
    const violations = recent.filter(d => !digitWins(d, kind, barrier)).length;
    const cluster = violations >= MR_CLUSTER_MIN;
    const base = kind === 'UNDER' ? 55 + 0.44 * pct : 50 + 0.46 * pct;
    const raw = cluster ? 85 + (violations - MR_CLUSTER_MIN) * 3 : base;
    const strength = Math.round(clamp(raw, 45, 99));
    const pattern = cluster
        ? kind === 'UNDER'
            ? `Extreme peak cluster (recent: ${recent.join(', ')})`
            : `Bottom oversold cluster (recent: ${recent.join(', ')})`
        : kind === 'UNDER'
          ? `Low digit wave (${pct}% < ${barrier})`
          : `Support wave building strength (${pct}% > ${barrier})`;
    return { kind, barrier, strength, pct, cluster, violations, recent, pattern };
};

/**
 * Scan every barrier and return the strongest signal at or above `threshold`,
 * or null when nothing qualifies. Requires a full MR_WINDOW of real ticks so
 * a half-warmed market can never fire.
 */
export const scanMeanReversion = (
    digits: number[],
    threshold: number = MR_TRIGGER_THRESHOLD
): MeanReversionPick | null => {
    const window = cleanDigits(digits).slice(-MR_WINDOW);
    if (window.length < MR_WINDOW) return null;
    let best: BarrierEvaluation | null = null;
    for (const kind of ['UNDER', 'OVER'] as const) {
        const barriers = kind === 'UNDER' ? MR_UNDER_BARRIERS : MR_OVER_BARRIERS;
        for (const barrier of barriers) {
            const ev = evaluateBarrier(window, kind, barrier);
            if (ev.strength < threshold) continue;
            if (!ev.cluster && ev.pct - theoreticalRate(kind, barrier) < MR_WAVE_SKEW) continue;
            if (
                !best ||
                ev.strength > best.strength ||
                (ev.strength === best.strength && ev.pct > best.pct)
            ) {
                best = ev;
            }
        }
    }
    if (!best) return null;
    const branch = best.cluster ? 'cluster reversion' : 'hit-rate wave';
    return {
        kind: best.kind,
        barrier: best.barrier,
        strength: best.strength,
        pct: best.pct,
        cluster: best.cluster,
        violations: best.violations,
        recent: best.recent,
        rationale: `${best.kind} ${best.barrier} — ${best.pattern} [${branch}] over ${MR_WINDOW} ticks (strength ${best.strength}%)`,
    };
};
