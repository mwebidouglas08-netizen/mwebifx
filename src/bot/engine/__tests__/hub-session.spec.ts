import { nextStakeAfter, sessionStopReason } from '../hub-session';

describe('hub-session pure helpers', () => {
    describe('nextStakeAfter', () => {
        it('returns the base stake with no losses or no multiplier', () => {
            expect(nextStakeAfter(1, 2, 0)).toBe(1);
            expect(nextStakeAfter(1, 1, 5)).toBe(1);
            expect(nextStakeAfter(1, 0, 3)).toBe(1);
        });

        it('compounds the base stake by the multiplier per consecutive loss', () => {
            expect(nextStakeAfter(0.5, 2, 1)).toBe(1);
            expect(nextStakeAfter(0.5, 2, 2)).toBe(2);
            expect(nextStakeAfter(0.5, 2, 3)).toBe(4);
            expect(nextStakeAfter(0.5, 2, 4)).toBe(8);
        });

        it('rounds to two decimals', () => {
            expect(nextStakeAfter(0.35, 1.5, 1)).toBe(0.52);
            expect(nextStakeAfter(0.35, 2, 1)).toBe(0.7);
            expect(nextStakeAfter(0.8, 1.3, 2)).toBe(1.35);
        });

        it('treats an invalid base as zero', () => {
            expect(nextStakeAfter(0, 2, 1)).toBe(0);
            expect(nextStakeAfter(Number.NaN, 2, 1)).toBe(0);
        });
    });

    describe('sessionStopReason', () => {
        it('stops with congratulations when take profit is reached', () => {
            expect(sessionStopReason(10, 1, 10, 50)).toContain('TakeProfit Achieved');
            expect(sessionStopReason(12.5, 1, 10, 50)).toContain('12.50');
        });

        it('stops with a stop-loss message when the loss budget is breached', () => {
            expect(sessionStopReason(-50, 1, 10, 50)).toContain('Stop Loss Hit');
            expect(sessionStopReason(-52, 1, 10, 50)).toContain('-52.00');
        });

        it('mirrors the reference stop when the next stake exceeds the remaining budget', () => {
            const reason = sessionStopReason(-7.14, 8, 10, 10);
            expect(reason).toContain('Next stake 8.00');
            expect(reason).toContain('2.86');
        });

        it('keeps running when limits and the next stake fit the budget', () => {
            expect(sessionStopReason(0, 1, 10, 50)).toBeNull();
            expect(sessionStopReason(-7.14, 4, 10, 20)).toBeNull();
        });

        it('ignores disabled limits', () => {
            expect(sessionStopReason(100, 1, 0, 0)).toBeNull();
            expect(sessionStopReason(-100, 999, 0, 0)).toBeNull();
        });
    });
});
