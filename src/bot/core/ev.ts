import { Direction } from './types';

export interface EdgeAssessment {
    payoutRatio: number;
    expectedValue: number;
    expectedValuePct: number;
    kellyFraction: number;
    isPositiveEv: boolean;
    isMateriallyPositive: boolean;
}

export const computePayoutRatio = (payout: number, stake: number): number =>
    stake > 0 ? payout / stake : 0;

export const computeExpectedValue = (probability: number, payout: number, stake: number): number =>
    probability * payout - stake;

export const computeExpectedValuePct = (probability: number, payoutRatio: number): number =>
    probability * payoutRatio - 1;

export const computeKellyFraction = (
    probability: number,
    payoutRatio: number,
    cap = 0.05
): number => {
    const b = payoutRatio - 1;
    if (b <= 0 || probability <= 0 || probability >= 1) return 0;
    const q = 1 - probability;
    const f = (b * probability - q) / b;
    if (f <= 0) return 0;
    return Math.min(f, cap);
};

export const assessEdge = (
    probability: number,
    payout: number,
    stake: number,
    minEvPct: number
): EdgeAssessment => {
    const payoutRatio = computePayoutRatio(payout, stake);
    const expectedValue = computeExpectedValue(probability, payout, stake);
    const expectedValuePct = computeExpectedValuePct(probability, payoutRatio);
    const kellyFraction = computeKellyFraction(probability, payoutRatio);
    const isPositiveEv = expectedValue > 0;
    const isMateriallyPositive = isPositiveEv && expectedValuePct >= minEvPct;
    return {
        payoutRatio,
        expectedValue,
        expectedValuePct,
        kellyFraction,
        isPositiveEv,
        isMateriallyPositive,
    };
};

export const sizedStake = (
    baseStake: number,
    kellyFraction: number,
    equity: number,
    maxStakePctEquity: number,
    maxStake: number
): number => {
    const kellyStake = equity * kellyFraction;
    const pctCap = equity * maxStakePctEquity;
    const stake = Math.min(baseStake, kellyStake || baseStake, pctCap || baseStake, maxStake);
    return Math.max(0, Math.round(stake * 100) / 100);
};

export const barrierIsValid = (direction: Direction, barrier: number): boolean => {
    if (!Number.isInteger(barrier) || barrier < 0 || barrier > 9) return false;
    if (direction === 'over') return barrier >= 0 && barrier <= 8;
    return barrier >= 1 && barrier <= 9;
};

export const isOverUnderContract = (contractType: string): contractType is 'DIGITOVER' | 'DIGITUNDER' =>
    contractType === 'DIGITOVER' || contractType === 'DIGITUNDER';

export const directionForContract = (contractType: 'DIGITOVER' | 'DIGITUNDER'): Direction =>
    contractType === 'DIGITOVER' ? 'over' : 'under';

export const contractForDirection = (direction: Direction): 'DIGITOVER' | 'DIGITUNDER' =>
    direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
