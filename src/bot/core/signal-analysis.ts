// Statistical "skills" used by the AI Signal Scanner. These mirror the analysis
// primitives a typical Deriv signal bot exposes (digit frequency, even/odd %,
// over/under %, rise/fall %, match/differ %) and are pure, unit-testable
// functions over a digit/quote window. They do NOT predict the next digit —
// they measure the recent empirical distribution so a threshold can be applied.

export interface EvenOdd {
    even: number;
    odd: number;
}

export interface OverUnder {
    over: number;
    under: number;
}

export interface RiseFall {
    rise: number;
    fall: number;
}

export interface MatchDiffer {
    match: number;
    differ: number;
}

const pct = (part: number, total: number): number =>
    total > 0 ? Math.round((part / total) * 10000) / 100 : 0;

export const digitFrequency = (digits: number[]): number[] => {
    const counts = new Array(10).fill(0);
    for (const d of digits) if (d >= 0 && d <= 9 && Number.isInteger(d)) counts[d] += 1;
    return counts;
};

export const mostFrequentDigit = (digits: number[]): number => {
    const counts = digitFrequency(digits);
    let best = -1;
    let digit = 0;
    counts.forEach((c, i) => {
        if (c > best) {
            best = c;
            digit = i;
        }
    });
    return digit;
};

export const leastFrequentDigit = (digits: number[]): number => {
    const counts = digitFrequency(digits);
    let best = Infinity;
    let digit = 0;
    counts.forEach((c, i) => {
        if (c > 0 && c < best) {
            best = c;
            digit = i;
        }
    });
    return Number.isFinite(best) ? digit : 0;
};

export const evenOddPercent = (digits: number[]): EvenOdd => {
    const clean = digits.filter(d => d >= 0 && d <= 9);
    const total = clean.length;
    const even = clean.filter(d => d % 2 === 0).length;
    return { even: pct(even, total), odd: pct(total - even, total) };
};

export const overUnderPercent = (digits: number[], barrier: number): OverUnder => {
    const clean = digits.filter(d => d >= 0 && d <= 9);
    const total = clean.length;
    // DIGITOVER(barrier) wins on digit > barrier; DIGITUNDER(barrier) wins on
    // digit < barrier (the barrier digit itself loses both legs). Counting
    // `under` as <= barrier overstated the win rate by a full digit bucket and
    // made UNDER signals fire on losing distributions.
    const over = clean.filter(d => d > barrier).length;
    const under = clean.filter(d => d < barrier).length;
    return { over: pct(over, total), under: pct(under, total) };
};

export const riseFallPercent = (quotes: number[]): RiseFall => {
    let rise = 0;
    const moves = Math.max(0, quotes.length - 1);
    for (let i = 1; i < quotes.length; i++) {
        if (quotes[i] > quotes[i - 1]) rise += 1;
    }
    return { rise: pct(rise, moves), fall: pct(moves - rise, moves) };
};

export const matchDifferPercent = (digits: number[], digit: number): MatchDiffer => {
    const clean = digits.filter(d => d >= 0 && d <= 9);
    const total = clean.length;
    const match = clean.filter(d => d === digit).length;
    return { match: pct(match, total), differ: pct(total - match, total) };
};

// Simple SMA/EMA used for a trend direction on the quote series.
export const sma = (values: number[], period: number): number => {
    if (values.length < period || period <= 0) return 0;
    const slice = values.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
};

export const ema = (values: number[], period: number): number => {
    if (values.length < period || period <= 0) return 0;
    const k = 2 / (period + 1);
    let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) {
        e = values[i] * k + e * (1 - k);
    }
    return e;
};

export type TrendDirection = 'up' | 'down' | 'flat';

export const trendDirection = (quotes: number[]): TrendDirection => {
    const short = ema(quotes, 5);
    const long = ema(quotes, 20);
    if (!short || !long) return 'flat';
    const diff = (short - long) / (long || 1);
    if (diff > 0.0002) return 'up';
    if (diff < -0.0002) return 'down';
    return 'flat';
};
