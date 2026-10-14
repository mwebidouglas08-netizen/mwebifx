/**
 * Dual Edge — the two-sided Over/Under recovery engine, modelled on
 * SmartFlip's Dual Edge bot (modes: RECOVERY and MKULIMA).
 *
 * The bot runs **both** sides of a complementary barrier pair (e.g. Over 1
 * and Under 8) and applies a documented stake/prediction progression:
 *
 * - `RECOVERY` — after a loss the side switches to its recovery barrier
 *   (the pair that sits at ~50%: over→4, under→5) and the stake multiplies
 *   by `stakeFactor`, capped by `stakeCap` and `maxRecoverySteps`. A win
 *   resets the side to its initial barrier and base stake.
 * - `MKULIMA` — the barrier never changes (keeps the original payout edge);
 *   the stake follows a d'Alembert ladder: +`stakeStep` per loss,
 *   −`stakeStep` per win, floored at the base stake and capped at
 *   `stakeCap`.
 *
 * Every transition is a pure function so the progression can be unit-tested
 * without a socket. `profit` is only tracked when a `payoutRatio` is passed
 * with the result (fetched live from the proposal); otherwise wins/losses and
 * stake flow are counted and profit stays untouched — nothing is invented.
 */

export type DualMode = 'RECOVERY' | 'MKULIMA';
export type DualSide = 'over' | 'under';

export interface DualProfile {
    id: string;
    label: string;
    /** Digits the bot waits before the first entry. */
    lookback: number;
    over: { initial: number; recovery: number };
    under: { initial: number; recovery: number };
}

/** Profiles lifted from SmartFlip's Dual Edge configuration tables. */
export const DUAL_PROFILES: DualProfile[] = [
    {
        id: 'OU_1_8',
        label: 'Over 1 / Under 8',
        lookback: 2,
        over: { initial: 1, recovery: 4 },
        under: { initial: 8, recovery: 5 },
    },
    {
        id: 'OU_2_7',
        label: 'Over 2 / Under 7',
        lookback: 3,
        over: { initial: 2, recovery: 4 },
        under: { initial: 7, recovery: 5 },
    },
    {
        id: 'OU_3_6',
        label: 'Over 3 / Under 6',
        lookback: 4,
        over: { initial: 3, recovery: 4 },
        under: { initial: 6, recovery: 5 },
    },
];

export const getDualProfile = (id: string): DualProfile =>
    DUAL_PROFILES.find(p => p.id === id) ?? DUAL_PROFILES[0];

export interface DualConfig {
    mode: DualMode;
    baseStake: number;
    stakeCap: number;
    /** RECOVERY: multiplier per loss (default 2 = classic recovery). */
    stakeFactor: number;
    /** MKULIMA: fixed ladder step per result. */
    stakeStep: number;
    /** Stop after this many consecutive losses on one side. */
    maxRecoverySteps: number;
    /** Stop when total profit reaches this (0 = disabled). */
    takeProfit: number;
    /** Stop when total loss reaches this (0 = disabled). */
    stopLoss: number;
}

export const DEFAULT_DUAL_CONFIG: DualConfig = {
    mode: 'RECOVERY',
    baseStake: 1,
    stakeCap: 50,
    stakeFactor: 2,
    stakeStep: 1,
    maxRecoverySteps: 4,
    takeProfit: 20,
    stopLoss: 20,
};

export interface DualSideState {
    side: DualSide;
    barrier: number;
    stake: number;
    step: number;
    consecutiveLosses: number;
    wins: number;
    losses: number;
    /** Net P/L — only updated when a payoutRatio is supplied with a result. */
    profit: number;
    history: Array<{ won: boolean; barrier: number; stake: number }>;
}

const historyCap = 200;

export const initialSideState = (
    side: DualSide,
    profile: DualProfile,
    config: DualConfig
): DualSideState => ({
    side,
    barrier: profile[side].initial,
    stake: config.baseStake,
    step: 0,
    consecutiveLosses: 0,
    wins: 0,
    losses: 0,
    profit: 0,
    history: [],
});

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface SideResultInput {
    won: boolean;
    /** Real payout ratio from the proposal; omit to skip P/L accounting. */
    payoutRatio?: number;
}

/**
 * Pure state transition for one side after a settled contract.
 */
export const applySideResult = (
    state: DualSideState,
    profile: DualProfile,
    config: DualConfig,
    result: SideResultInput
): DualSideState => {
    const next: DualSideState = {
        ...state,
        history: [...state.history, { won: result.won, barrier: state.barrier, stake: state.stake }].slice(-historyCap),
    };

    if (result.won) {
        next.wins += 1;
        next.consecutiveLosses = 0;
        if (result.payoutRatio && result.payoutRatio > 0) {
            next.profit = round2(next.profit + state.stake * (result.payoutRatio - 1));
        }
        if (config.mode === 'RECOVERY') {
            next.barrier = profile[state.side].initial;
            next.stake = config.baseStake;
            next.step = 0;
        } else {
            next.stake = round2(Math.max(config.baseStake, state.stake - config.stakeStep));
        }
        return next;
    }

    next.losses += 1;
    next.consecutiveLosses = state.consecutiveLosses + 1;
    next.step = state.step + 1;
    next.profit = round2(next.profit - state.stake);

    if (config.mode === 'RECOVERY') {
        next.barrier = profile[state.side].recovery;
        next.stake = round2(Math.min(state.stake * config.stakeFactor, config.stakeCap));
    } else {
        next.stake = round2(Math.min(state.stake + config.stakeStep, config.stakeCap));
    }
    return next;
};

/** True when the side has burnt through its recovery ladder. */
export const sideExhausted = (state: DualSideState, config: DualConfig): boolean =>
    state.consecutiveLosses > config.maxRecoverySteps;

export interface DualTotals {
    profit: number;
    wins: number;
    losses: number;
    maxConsecutiveLosses: number;
}

export const dualTotals = (sides: DualSideState[]): DualTotals => {
    const profit = round2(sides.reduce((sum, s) => sum + s.profit, 0));
    const wins = sides.reduce((sum, s) => sum + s.wins, 0);
    const losses = sides.reduce((sum, s) => sum + s.losses, 0);
    const maxConsecutiveLosses = sides.reduce((max, s) => Math.max(max, s.consecutiveLosses), 0);
    return { profit, wins, losses, maxConsecutiveLosses };
};

/**
 * Global stop check — returns a human-readable reason to stop, or null to
 * keep running. Mirrors the risk-gate pattern used by the other engines.
 */
export const dualStopReason = (
    sides: DualSideState[],
    config: DualConfig
): string | null => {
    const totals = dualTotals(sides);
    if (config.takeProfit > 0 && totals.profit >= config.takeProfit) {
        return `Take profit hit (+${totals.profit.toFixed(2)})`;
    }
    if (config.stopLoss > 0 && totals.profit <= -config.stopLoss) {
        return `Stop loss hit (${totals.profit.toFixed(2)})`;
    }
    for (const side of sides) {
        if (sideExhausted(side, config)) {
            return `${side.side} side exhausted ${config.maxRecoverySteps + 1} consecutive losses`;
        }
    }
    return null;
};

/** Stake the side would use for its next entry (for UI preview). */
export const nextStakePreview = (state: DualSideState, config: DualConfig): number =>
    Math.min(state.stake, config.stakeCap);
