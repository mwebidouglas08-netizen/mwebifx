import {
    ALGO_PRO_STRATEGIES,
    NEUTRADE_WINDOW,
    checkedTicks,
    meetsPercent,
    mostFrequentDigit,
    neutradeSignal,
    secondMostFrequentDigit,
    signalFromStrategy,
} from '../algo-pro-ai';

const over2 = { contractType: 'DIGITOVER', label: 'Trade Over 2', barrier: 2 };
const under7 = { contractType: 'DIGITUNDER', label: 'Trade Under 7', barrier: 7 };
const odd = { contractType: 'DIGITODD', label: 'Trade Odd' };
const even = { contractType: 'DIGITEVEN', label: 'Trade Even' };
const over4 = { contractType: 'DIGITOVER', label: 'Trade Over 4', barrier: 4 };
const under5 = { contractType: 'DIGITUNDER', label: 'Trade Under 5', barrier: 5 };

describe('Neutrade helpers', () => {
    it('meetsPercent uses exact integer math with a total>0 guard', () => {
        expect(meetsPercent(45, 60, 75)).toBe(true); // 75% exactly
        expect(meetsPercent(44, 60, 75)).toBe(false);
        expect(meetsPercent(33, 60, 55)).toBe(true); // 55% exactly
        expect(meetsPercent(32, 60, 55)).toBe(false);
        expect(meetsPercent(0, 0, 55)).toBe(false);
    });

    it('mostFrequentDigit resolves ties to the LOWEST digit', () => {
        expect(mostFrequentDigit([9, 9, 1, 1])).toBe(1);
        expect(mostFrequentDigit([7, 3, 7, 3, 3])).toBe(3);
        expect(mostFrequentDigit([])).toBeUndefined();
    });

    it('secondMostFrequentDigit orders count desc / digit asc and needs 2 distinct digits', () => {
        expect(secondMostFrequentDigit([1, 1, 2, 2, 3])).toBe(2);
        expect(secondMostFrequentDigit([5, 5, 5, 4])).toBe(4);
        expect(secondMostFrequentDigit([5, 5])).toBeUndefined();
        expect(secondMostFrequentDigit([])).toBeUndefined();
    });

    it('exposes a 60-digit window and the catalog entry', () => {
        expect(NEUTRADE_WINDOW).toBe(60);
        expect(checkedTicks('neutrade-ai', false)).toBe(60);
        expect(ALGO_PRO_STRATEGIES.find(s => s.id === 'neutrade-ai')).toMatchObject({ number: '08' });
    });
});

describe('neutradeSignal — normal mode gates', () => {
    it('rejects inputs shorter than 2 digits', () => {
        expect(neutradeSignal([], false)).toBeNull();
        expect(neutradeSignal([1], false)).toBeNull();
    });

    it('gate 1: last2 ≤ 2 with ≥75% over-2 in the 60 window → Over 2 (boundary exact)', () => {
        // 45 hits >2 + 13 zeros + last2 [1,2] = 60 digits, 45/60 = 75%.
        const digits = [...Array.from({ length: 45 }, () => 4), ...Array.from({ length: 13 }, () => 0), 1, 2];
        expect(neutradeSignal(digits, false)).toEqual(over2);
        // 44/60 = 73.3% < 75 → gate 1 fails; mode 4 (not >5) and second 0 (not >5) → null.
        const below = [...Array.from({ length: 44 }, () => 4), ...Array.from({ length: 14 }, () => 0), 1, 2];
        expect(neutradeSignal(below, false)).toBeNull();
    });

    it('gate 2: last2 ≤ 2 with mode60 > 5 → Over 2 even when over% < 75', () => {
        // 40 nines (over-2 hits, 66.7%) + 18 sixes + last2 [1,2]; mode = 9 > 5.
        const digits = [...Array.from({ length: 40 }, () => 9), ...Array.from({ length: 18 }, () => 6), 1, 2];
        expect(neutradeSignal(digits, false)).toEqual(over2);
    });

    it('gate 3: last2 ≥ 7 with ≥75% under-7 in the 60 window → Under 7 (boundary exact)', () => {
        const digits = [...Array.from({ length: 45 }, () => 5), ...Array.from({ length: 13 }, () => 8), 7, 9];
        expect(neutradeSignal(digits, false)).toEqual(under7);
        // 44/60 under-7 + mode 5 (not <4) + second 8 (not <4) → null.
        const below = [...Array.from({ length: 44 }, () => 5), ...Array.from({ length: 14 }, () => 8), 7, 9];
        expect(neutradeSignal(below, false)).toBeNull();
    });

    it('gate 4: last2 ≥ 7 with mode60 < 4 → Under 7 even when under% < 75', () => {
        // 40 threes (under-7 hits, 66.7%) + 18 nines + last2 [7,9]; mode = 3 < 4.
        const digits = [...Array.from({ length: 40 }, () => 3), ...Array.from({ length: 18 }, () => 9), 7, 9];
        expect(neutradeSignal(digits, false)).toEqual(under7);
    });

    it('mixed last2 (neither both ≤2 nor both ≥7) never trades in normal mode', () => {
        const digits = [...Array.from({ length: 58 }, () => 9), 1, 8];
        expect(neutradeSignal(digits, false)).toBeNull();
        const digits2 = [...Array.from({ length: 58 }, () => 0), 3, 7];
        expect(neutradeSignal(digits2, false)).toBeNull();
    });
});

describe('neutradeSignal — recovery mode gates (after a loss)', () => {
    it('gate a: all-even last2 with ≥55% odd in the 60 window → Odd (boundary exact)', () => {
        // 33 odd + 25 even + last2 [0,4] = 60, 33/60 = 55%.
        const digits = [...Array.from({ length: 33 }, () => 1), ...Array.from({ length: 25 }, () => 0), 0, 4];
        expect(neutradeSignal(digits, true)).toEqual(odd);
        // 32/60 = 53.3% < 55 and over4 = 0 → null.
        const below = [...Array.from({ length: 32 }, () => 1), ...Array.from({ length: 26 }, () => 0), 0, 4];
        expect(neutradeSignal(below, true)).toBeNull();
    });

    it('gate b: all-odd last2 with ≥55% even in the 60 window → Even', () => {
        const digits = [...Array.from({ length: 33 }, () => 0), ...Array.from({ length: 25 }, () => 3), 1, 5];
        expect(neutradeSignal(digits, true)).toEqual(even);
    });

    it('gate c: last2 ≤ 4 with ≥55% over-4 in the 60 window → Over 4', () => {
        // 33 sixes are over-4 but EVEN, so gate a's odd% stays at 25/60 (<55).
        const digits = [...Array.from({ length: 33 }, () => 6), ...Array.from({ length: 25 }, () => 1), 0, 4];
        expect(neutradeSignal(digits, true)).toEqual(over4);
    });

    it('gate d: last2 ≥ 5 with ≥55% under-5 in the 60 window → Under 5', () => {
        const digits = [...Array.from({ length: 33 }, () => 3), ...Array.from({ length: 25 }, () => 7), 5, 9];
        expect(neutradeSignal(digits, true)).toEqual(under5);
    });

    it('recovery mode replaces the normal gates entirely', () => {
        // Normal mode fires Over 2 here (last2 ≤2, 75% over-2); in recovery the
        // parity gates skip (mixed last2), gate c fails (0% over-4) → null.
        const digits = [...Array.from({ length: 45 }, () => 4), ...Array.from({ length: 13 }, () => 0), 1, 2];
        expect(neutradeSignal(digits, false)).toEqual(over2);
        expect(neutradeSignal(digits, true)).toBeNull();
    });

    it('recovery gate c outranks a would-be Over 2 setup', () => {
        // last2 [1,2] satisfies both normal Over 2 and recovery Over 4 entry;
        // with recovery on and over-4 ≥55 the reference trades Over 4.
        const digits = [...Array.from({ length: 40 }, () => 9), ...Array.from({ length: 18 }, () => 6), 1, 2];
        expect(neutradeSignal(digits, true)).toEqual(over4);
    });
});

describe('signalFromStrategy dispatch', () => {
    it('routes neutrade-ai through the exact regime gates', () => {
        const digits = [...Array.from({ length: 45 }, () => 4), ...Array.from({ length: 13 }, () => 0), 1, 2];
        expect(signalFromStrategy('neutrade-ai', [], digits, false)).toEqual(over2);
        expect(signalFromStrategy('neutrade-ai', [], digits, true)).toBeNull();
        expect(signalFromStrategy('neutrade-ai', [], [1], false)).toBeNull();
    });
});
