import { ContractOpportunity, RiskLimits, RiskState, TradeRecord } from './types';

/** Deriv's minimum order stake — sizing never goes below it. */
export const MIN_ORDER_STAKE = 0.35;

export const DEFAULT_RISK_LIMITS: RiskLimits = {
    maxStake: 1,
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

export const initialRiskState = (peakEquity: number): RiskState => ({
    suspended: false,
    suspensionReason: null,
    suspendedAt: null,
    consecutiveLosses: 0,
    dailyPnl: 0,
    peakEquity,
    drawdown: 0,
    tradesThisSession: 0,
    lastLossAt: null,
    openPositions: 0,
});

export type RiskGate =
    | 'ok'
    | 'suspended'
    | 'stake_too_high'
    | 'low_confidence'
    | 'small_sample'
    | 'low_ev'
    | 'low_payout'
    | 'daily_loss'
    | 'drawdown'
    | 'consecutive_losses'
    | 'open_positions'
    | 'session_limit'
    | 'cooldown';

export interface RiskVerdict {
    allowed: boolean;
    gate: RiskGate;
    reason: string;
    stake: number;
}

export const evaluateOpportunity = (
    opp: ContractOpportunity,
    state: RiskState,
    limits: RiskLimits,
    equity: number,
    now = Date.now(),
    opts: { skipEdgeGates?: boolean } = {}
): RiskVerdict => {
    if (state.suspended) {
        return { allowed: false, gate: 'suspended', reason: state.suspensionReason || 'Trading suspended', stake: 0 };
    }
    if (state.openPositions >= limits.maxOpenPositions) {
        return {
            allowed: false,
            gate: 'open_positions',
            reason: `Open position limit reached (${limits.maxOpenPositions})`,
            stake: 0,
        };
    }
    if (state.tradesThisSession >= limits.maxTradesPerSession) {
        return {
            allowed: false,
            gate: 'session_limit',
            reason: `Session trade limit reached (${limits.maxTradesPerSession})`,
            stake: 0,
        };
    }
    if (state.dailyPnl <= -limits.maxDailyLoss) {
        return {
            allowed: false,
            gate: 'daily_loss',
            reason: `Daily loss limit reached (${limits.maxDailyLoss})`,
            stake: 0,
        };
    }
    if (state.drawdown >= limits.maxTotalDrawdown) {
        return {
            allowed: false,
            gate: 'drawdown',
            reason: `Max drawdown reached (${limits.maxTotalDrawdown})`,
            stake: 0,
        };
    }
    if (state.consecutiveLosses >= limits.maxConsecutiveLosses) {
        return {
            allowed: false,
            gate: 'consecutive_losses',
            reason: `Consecutive loss limit reached (${limits.maxConsecutiveLosses})`,
            stake: 0,
        };
    }
    if (
        state.consecutiveLosses >= limits.cooldownAfterLosses &&
        state.lastLossAt &&
        now - state.lastLossAt < limits.cooldownMs
    ) {
        const waitMs = limits.cooldownMs - (now - state.lastLossAt);
        return {
            allowed: false,
            gate: 'cooldown',
            reason: `Cooldown active, ${Math.ceil(waitMs / 1000)}s remaining`,
            stake: 0,
        };
    }
    if (!opts.skipEdgeGates) {
        if (opp.confidence < limits.minConfidence) {
            return {
                allowed: false,
                gate: 'low_confidence',
                reason: `Confidence ${opp.confidence.toFixed(2)} below ${limits.minConfidence}`,
                stake: 0,
            };
        }
        if (opp.sampleSize < limits.minSampleSize) {
            return {
                allowed: false,
                gate: 'small_sample',
                reason: `Sample ${opp.sampleSize} below ${limits.minSampleSize}`,
                stake: 0,
            };
        }
        if (opp.expectedValuePct < limits.minExpectedValue) {
            return {
                allowed: false,
                gate: 'low_ev',
                reason: `EV ${opp.expectedValuePct.toFixed(3)} below ${limits.minExpectedValue}`,
                stake: 0,
            };
        }
        if (opp.payoutRatio < limits.minPayoutRatio) {
            return {
                allowed: false,
                gate: 'low_payout',
                reason: `Payout ratio ${opp.payoutRatio.toFixed(2)} below ${limits.minPayoutRatio}`,
                stake: 0,
            };
        }
    }

    const stake = Math.min(opp.stake, limits.maxStake, equity * limits.maxStakePctEquity);
    let rounded = Math.round(stake * 100) / 100;
    // Deriv's minimum order stake is 0.35. Floor at it only when the floor
    // itself still respects both caps — the old unconditional
    // `Math.max(0.35, …)` could size above `equity * maxStakePctEquity`
    // (equity < 17.5) or above a sub-0.35 maxStake, violating the very caps
    // it then claimed to enforce.
    if (rounded < MIN_ORDER_STAKE) {
        if (MIN_ORDER_STAKE <= limits.maxStake && MIN_ORDER_STAKE <= equity * limits.maxStakePctEquity) {
            rounded = MIN_ORDER_STAKE;
        } else {
            return {
                allowed: false,
                gate: 'stake_too_high',
                reason: `Sized stake ${rounded.toFixed(2)} is below Deriv's ${MIN_ORDER_STAKE} minimum and cannot be floored without breaching the stake caps (max ${limits.maxStake}, equity cap ${(equity * limits.maxStakePctEquity).toFixed(2)})`,
                stake: 0,
            };
        }
    }
    if (rounded > limits.maxStake) {
        return {
            allowed: false,
            gate: 'stake_too_high',
            reason: `Sized stake ${rounded} exceeds max ${limits.maxStake}`,
            stake: 0,
        };
    }
    return { allowed: true, gate: 'ok', reason: 'All risk gates passed', stake: rounded };
};

export const applySettlement = (
    state: RiskState,
    trade: TradeRecord,
    equity: number,
    limits: RiskLimits,
    now = Date.now()
): RiskState => {
    const profit = trade.profit ?? 0;
    const next: RiskState = {
        ...state,
        openPositions: Math.max(0, state.openPositions - 1),
        dailyPnl: state.dailyPnl + profit,
        peakEquity: Math.max(state.peakEquity, equity),
    };
    next.drawdown = Math.max(0, next.peakEquity - equity);
    if (trade.result === 'loss') {
        next.consecutiveLosses = state.consecutiveLosses + 1;
        next.lastLossAt = now;
    } else if (trade.result === 'win') {
        next.consecutiveLosses = 0;
    }
    if (next.dailyPnl <= -limits.maxDailyLoss) {
        next.suspended = true;
        next.suspensionReason = `Daily loss limit reached (${limits.maxDailyLoss})`;
        next.suspendedAt = now;
    } else if (next.drawdown >= limits.maxTotalDrawdown) {
        next.suspended = true;
        next.suspensionReason = `Max drawdown reached (${limits.maxTotalDrawdown})`;
        next.suspendedAt = now;
    } else if (next.consecutiveLosses >= limits.maxConsecutiveLosses) {
        next.suspended = true;
        next.suspensionReason = `Consecutive loss limit reached (${limits.maxConsecutiveLosses})`;
        next.suspendedAt = now;
    }
    return next;
};

export const suspendTrading = (state: RiskState, reason: string, now = Date.now()): RiskState => ({
    ...state,
    suspended: true,
    suspensionReason: reason,
    suspendedAt: now,
});

export const resumeTrading = (state: RiskState, equity: number): RiskState => ({
    ...state,
    suspended: false,
    suspensionReason: null,
    suspendedAt: null,
    consecutiveLosses: 0,
    dailyPnl: 0,
    drawdown: 0,
    peakEquity: equity,
});
