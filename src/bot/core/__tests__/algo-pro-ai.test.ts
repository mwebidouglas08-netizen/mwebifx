import {
    ALGO_PRO_MARKETS,
    ALGO_PRO_STRATEGIES,
    INFINITY_ALGO_DEFAULTS,
    PAIR_PROFILES,
    allAbove,
    allBelow,
    allEven,
    allFalling,
    allOdd,
    allRising,
    applyInfinitySettlement,
    bestPairCandidate,
    checkedTicks,
    createInfinitySession,
    digitPairCandidates,
    infinityEntryReady,
    lastDigitAt,
    martingaleStake,
    pairCandidateToSignal,
    pipSizeDefault,
    rankMarketSignals,
    scopeMarkets,
    signalFromStrategy,
    tradeKey,
} from '../algo-pro-ai';

describe('lastDigitAt (tw)', () => {
    it('extracts the last digit at pip precision', () => {
        expect(lastDigitAt(1234.5678, 3)).toBe(8);
        expect(lastDigitAt(1234.5678, 2)).toBe(7);
        expect(lastDigitAt(1234.56, 2)).toBe(6);
    });
});

describe('pipSizeDefault', () => {
    it('uses 2 for 1s markets and 3 for standard R_*', () => {
        expect(pipSizeDefault('1HZ10V')).toBe(2);
        expect(pipSizeDefault('R_10')).toBe(3);
    });
});

describe('scopeMarkets', () => {
    it('scopes the exact 10-market list', () => {
        expect(ALGO_PRO_MARKETS).toHaveLength(10);
        expect(scopeMarkets('all')).toHaveLength(10);
        expect(scopeMarkets('standard')).toHaveLength(5);
        expect(scopeMarkets('one-second')).toHaveLength(5);
        expect(scopeMarkets('standard').every(m => !m.oneSecond)).toBe(true);
        expect(scopeMarkets('one-second').every(m => m.oneSecond)).toBe(true);
    });
});

describe('pattern helpers', () => {
    it('allBelow / allAbove / parity / streaks', () => {
        expect(allBelow([0, 1], 2)).toBe(true);
        expect(allBelow([0, 2], 2)).toBe(false);
        expect(allAbove([8, 9], 7)).toBe(true);
        expect(allAbove([7, 9], 7)).toBe(false);
        expect(allEven([0, 2, 8])).toBe(true);
        expect(allEven([0, 3])).toBe(false);
        expect(allOdd([1, 3, 9])).toBe(true);
        expect(allOdd([1, 2])).toBe(false);
        expect(allRising([1, 2, 3])).toBe(true);
        expect(allRising([1, 3, 2])).toBe(false);
        expect(allFalling([3, 2, 1])).toBe(true);
        expect(allFalling([3, 1, 2])).toBe(false);
        expect(allEven([])).toBe(false);
    });
});

describe('checkedTicks (tE)', () => {
    it('lookback 5 for *-ai strategies and recovery mode, else 2', () => {
        expect(checkedTicks('even-odd-ai', false)).toBe(5);
        expect(checkedTicks('rise-fall-ai', false)).toBe(5);
        expect(checkedTicks('over-2-recovery-even-odd', false)).toBe(2);
        expect(checkedTicks('over-2-recovery-even-odd', true)).toBe(5);
        expect(checkedTicks('under-7-recovery-over-4-under-5', true)).toBe(5);
    });
});

describe('signalFromStrategy (tN)', () => {
    it('even-odd-ai: all-even tail triggers Odd, all-odd tail triggers Even', () => {
        expect(signalFromStrategy('even-odd-ai', [], [0, 2, 4, 6, 8], false)).toEqual({
            contractType: 'DIGITODD',
            label: 'Trade Odd',
        });
        expect(signalFromStrategy('even-odd-ai', [], [1, 3, 5, 7, 9], false)).toEqual({
            contractType: 'DIGITEVEN',
            label: 'Trade Even',
        });
        expect(signalFromStrategy('even-odd-ai', [], [1, 3, 5, 7, 8], false)).toBeNull();
    });

    it('over-4-under-5-ai: all-below-4 triggers Over 4, all-above-5 triggers Under 5', () => {
        expect(signalFromStrategy('over-4-under-5-ai', [], [0, 1, 2, 3, 0], false)).toEqual({
            contractType: 'DIGITOVER',
            label: 'Trade Over 4',
            barrier: 4,
        });
        expect(signalFromStrategy('over-4-under-5-ai', [], [6, 7, 8, 9, 6], false)).toEqual({
            contractType: 'DIGITUNDER',
            label: 'Trade Under 5',
            barrier: 5,
        });
        expect(signalFromStrategy('over-4-under-5-ai', [], [0, 1, 4, 6, 9], false)).toBeNull();
    });

    it('rise-fall-ai: rising run triggers Fall (PUT), falling run triggers Rise (CALL)', () => {
        expect(signalFromStrategy('rise-fall-ai', [1, 2, 3, 4, 5], [], false)).toEqual({
            contractType: 'PUT',
            label: 'Trade Fall',
        });
        expect(signalFromStrategy('rise-fall-ai', [5, 4, 3, 2, 1], [], false)).toEqual({
            contractType: 'CALL',
            label: 'Trade Rise',
        });
        expect(signalFromStrategy('rise-fall-ai', [1, 3, 2, 4, 5], [], false)).toBeNull();
    });

    it('over-2 recovery strategies: primary = two digits below 2 → Over 2', () => {
        expect(signalFromStrategy('over-2-recovery-even-odd', [], [5, 0, 1], false)).toEqual({
            contractType: 'DIGITOVER',
            label: 'Trade Over 2',
            barrier: 2,
        });
        expect(signalFromStrategy('over-2-recovery-over-4-under-5', [], [0, 1], false)).toEqual({
            contractType: 'DIGITOVER',
            label: 'Trade Over 2',
            barrier: 2,
        });
        expect(signalFromStrategy('over-2-recovery-even-odd', [], [0, 2], false)).toBeNull();
    });

    it('under-7 recovery strategies: primary = two digits above 7 → Under 7', () => {
        expect(signalFromStrategy('under-7-recovery-even-odd', [], [8, 9], false)).toEqual({
            contractType: 'DIGITUNDER',
            label: 'Trade Under 7',
            barrier: 7,
        });
        expect(signalFromStrategy('under-7-recovery-over-4-under-5', [], [7, 9], false)).toBeNull();
    });

    it('recovery mode swaps to the 5-digit Even–Odd / Over4–Under5 patterns', () => {
        expect(signalFromStrategy('over-2-recovery-even-odd', [], [0, 2, 4, 6, 8], true)).toEqual({
            contractType: 'DIGITODD',
            label: 'Trade Odd',
        });
        expect(signalFromStrategy('under-7-recovery-over-4-under-5', [], [0, 1, 2, 3, 1], true)).toEqual({
            contractType: 'DIGITOVER',
            label: 'Trade Over 4',
            barrier: 4,
        });
    });

    it('matches the strategy catalog', () => {
        expect(ALGO_PRO_STRATEGIES).toHaveLength(7);
        expect(ALGO_PRO_STRATEGIES.map(s => s.id)).toEqual([
            'even-odd-ai',
            'over-4-under-5-ai',
            'rise-fall-ai',
            'over-2-recovery-even-odd',
            'over-2-recovery-over-4-under-5',
            'under-7-recovery-even-odd',
            'under-7-recovery-over-4-under-5',
        ]);
        expect(ALGO_PRO_STRATEGIES.every(s => s.primaryCount === 2 || s.primaryCount === 5)).toBe(true);
    });
});

describe('martingaleStake / tradeKey', () => {
    it('applies factor^lossDepth rounded to 1e-8', () => {
        expect(martingaleStake(0.5, 2, 0)).toBe(0.5);
        expect(martingaleStake(0.5, 2, 1)).toBe(1);
        expect(martingaleStake(0.5, 2, 2)).toBe(2);
        expect(martingaleStake(0.5, 2, 3)).toBe(4);
        expect(martingaleStake(0.5, 2, -1)).toBe(0.5);
    });

    it('builds the symbol:epoch:type:barrier dedupe key', () => {
        expect(tradeKey('R_10', 123, 'DIGITOVER', 2)).toBe('R_10:123:DIGITOVER:2');
        expect(tradeKey('R_10', 123, 'CALL', undefined)).toBe('R_10:123:CALL:');
    });
});

describe('digit-pair confidence scanner (orb)', () => {
    const digits = Array.from({ length: 100 }, (_, i) => (i * 3) % 10);

    it('exposes the three exact profiles', () => {
        expect(PAIR_PROFILES.map(p => p.id)).toEqual(['over1_under8', 'over2_under7', 'over3_under6']);
        expect(PAIR_PROFILES[0]).toMatchObject({ over: 1, under: 8 });
        expect(PAIR_PROFILES[2]).toMatchObject({ over: 3, under: 6 });
    });

    it('scores confidence as 0.55·primary + 0.30·recent + 0.15·recovery', () => {
        const profile = PAIR_PROFILES[1];
        const [overCand] = digitPairCandidates(digits, profile);
        const expected =
            0.55 * overCand.primaryRate + 0.3 * overCand.recentRate + 0.15 * overCand.recoveryRate;
        expect(overCand.confidence).toBeCloseTo(expected, 10);
        expect(overCand.barrier).toBe(2);
        expect(overCand.recoverySide).toBe('under');
        expect(overCand.recoveryBarrier).toBe(7);
    });

    it('picks the higher-confidence side and converts to a signal', () => {
        // Over-2 wins on 3..9: 70 mid digits (3-6) + 30 highs (8-9) → over-2
        // hits 100% while under-7 only hits 70%, so the over side dominates.
        const midHeavy = Array.from({ length: 70 }, (_, i) => 3 + (i % 4)).concat(
            Array.from({ length: 30 }, (_, i) => 8 + (i % 2))
        );
        const best = bestPairCandidate(midHeavy, PAIR_PROFILES[1]);
        expect(best.side).toBe('over');
        expect(best.barrier).toBe(2);
        expect(pairCandidateToSignal(best)).toEqual({
            contractType: 'DIGITOVER',
            label: 'Trade Over 2',
            barrier: 2,
        });
    });

    it('ranks markets by confidence desc then recentRate desc', () => {
        const ranked = rankMarketSignals([
            {
                symbol: 'A',
                displayName: 'A',
                candidate: { ...digitPairCandidateStub(0.5, 0.4) },
            },
            {
                symbol: 'B',
                displayName: 'B',
                candidate: { ...digitPairCandidateStub(0.7, 0.6) },
            },
            {
                symbol: 'C',
                displayName: 'C',
                candidate: { ...digitPairCandidateStub(0.5, 0.55) },
            },
        ]);
        expect(ranked.map(r => r.symbol)).toEqual(['B', 'C', 'A']);
    });
});

const digitPairCandidateStub = (confidence: number, recentRate: number) => ({
    side: 'over' as const,
    barrier: 2,
    recoverySide: 'under' as const,
    recoveryBarrier: 7,
    confidence,
    primaryRate: 0.5,
    recentRate,
    recoveryRate: 0.5,
    sample: 100,
    recentSample: 30,
});

describe('Infinity Algo 1 session', () => {
    it('uses the exact defaults from the bot XML', () => {
        expect(INFINITY_ALGO_DEFAULTS).toEqual({
            entryDigit: 4,
            initialBarrier: 1,
            recoveryBarrier: 4,
            baseStake: 0.5,
            martingaleFactor: 2,
            winTarget: 5,
            stopLoss: 50,
            useMartingale: true,
        });
    });

    it('fires the entry only when the live digit equals the entry digit', () => {
        expect(infinityEntryReady(4, INFINITY_ALGO_DEFAULTS)).toBe(true);
        expect(infinityEntryReady(3, INFINITY_ALGO_DEFAULTS)).toBe(false);
    });

    it('resets on a win, recovers + doubles on a loss', () => {
        const cfg = INFINITY_ALGO_DEFAULTS;
        let s = createInfinitySession(cfg);
        expect(s).toMatchObject({ stake: 0.5, prediction: 1, runCount: 0, ended: null });

        // Win: stake+prediction reset, run count +1, +0.9 profit.
        s = applyInfinitySettlement(s, true, 0.45, cfg);
        expect(s).toMatchObject({ stake: 0.5, prediction: 1, runCount: 1, wins: 1 });

        // Loss: prediction flips to recovery 4, stake ×2, total −0.05.
        s = applyInfinitySettlement(s, false, -0.5, cfg);
        expect(s).toMatchObject({ stake: 1, prediction: 4, losses: 1, totalProfit: -0.05 });
    });

    it('stops with "Session Completed!!!" at the win target', () => {
        const cfg = { ...INFINITY_ALGO_DEFAULTS, winTarget: 1 };
        let s = createInfinitySession(cfg);
        s = applyInfinitySettlement(s, true, 0.45, cfg);
        expect(s.ended).toBe('win_target');
        expect(s.message).toBe('Session Completed!!!');
    });

    it('stops with "Sorry!!! Stop Loss Hit" when profit ≤ −stopLoss', () => {
        const cfg = { ...INFINITY_ALGO_DEFAULTS, stopLoss: 1 };
        let s = createInfinitySession(cfg);
        s = applyInfinitySettlement(s, false, -1.1, cfg);
        expect(s.ended).toBe('stop_loss');
        expect(s.message).toBe('Sorry!!! Stop Loss Hit');
    });

    it('keeps stake flat when Use Martingale is FALSE', () => {
        const cfg = { ...INFINITY_ALGO_DEFAULTS, useMartingale: false };
        let s = createInfinitySession(cfg);
        s = applyInfinitySettlement(s, false, -0.5, cfg);
        expect(s.stake).toBe(0.5);
        expect(s.prediction).toBe(4);
    });
});
