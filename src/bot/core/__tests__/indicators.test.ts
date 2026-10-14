import { bollinger, ema, latest, macd } from '../indicators';

const assertHistogramIdentity = (quotes: number[]): void => {
    const { macd: line, signal, histogram } = macd(quotes);
    let checked = 0;
    for (let i = 0; i < quotes.length; i += 1) {
        if (line[i] != null && signal[i] != null) {
            expect(histogram[i]).toBeCloseTo((line[i] as number) - (signal[i] as number), 10);
            checked += 1;
        } else {
            expect(histogram[i]).toBeNull();
        }
    }
    expect(checked).toBeGreaterThan(0);
};

describe('ema', () => {
    it('seeds with the SMA of the first `period` values', () => {
        const out = ema([1, 2, 3, 4, 5], 3);

        expect(out[0]).toBeNull();
        expect(out[1]).toBeNull();
        expect(out[2]).toBeCloseTo(2, 10);
        expect(out[3]).toBeCloseTo(3, 10);
        expect(out[4]).toBeCloseTo(4, 10);
    });

    it('returns all nulls while the series is shorter than the period', () => {
        expect(ema([1, 2], 3).every(v => v === null)).toBe(true);
        expect(ema([1, 2, 3], 0).every(v => v === null)).toBe(true);
        expect(ema([], 5).every(v => v === null)).toBe(true);
    });
});

describe('macd', () => {
    it('histogram equals macd − signal wherever both lines are defined', () => {
        const quotes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 3 + i * 0.25);
        const { histogram } = macd(quotes);

        expect(histogram[0]).toBeNull();
        assertHistogramIdentity(quotes);
    });

    it('stays flat at zero on a constant series', () => {
        const { macd: line, signal, histogram } = macd(Array(60).fill(100));

        expect(line[24]).toBeNull();
        expect(line[59]).toBeCloseTo(0, 10);
        expect(signal[59]).toBeCloseTo(0, 10);
        expect(histogram[59]).toBeCloseTo(0, 10);
        assertHistogramIdentity(Array(60).fill(100));
    });

    it('keeps the identity on a linear ramp', () => {
        const quotes = Array.from({ length: 60 }, (_, i) => 50 + i);

        assertHistogramIdentity(quotes);
    });
});

describe('bollinger', () => {
    it('collapses upper, lower and middle onto the same value for a constant series', () => {
        const quotes = Array(40).fill(7);
        const { middle, upper, lower, percentB } = bollinger(quotes, { period: 20, mult: 2 });

        expect(middle[18]).toBeNull();
        expect(upper[18]).toBeNull();
        for (let i = 19; i < quotes.length; i += 1) {
            expect(middle[i]).toBeCloseTo(7, 10);
            expect(upper[i]).toBeCloseTo(7, 10);
            expect(lower[i]).toBeCloseTo(7, 10);
            expect(percentB[i]).toBeNull();
        }
    });

    it('widens the bands on a moving series and keeps percentB in [0, 1]', () => {
        const quotes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? i : -i));
        const { middle, upper, lower, percentB } = bollinger(quotes, { period: 10, mult: 2 });

        expect(middle[29]).not.toBeNull();
        expect((upper[29] as number)).toBeGreaterThan(middle[29] as number);
        expect((lower[29] as number)).toBeLessThan(middle[29] as number);
        expect(percentB[29]).toBeGreaterThanOrEqual(0);
        expect(percentB[29]).toBeLessThanOrEqual(1);
    });
});

describe('latest', () => {
    it('returns the last valid value of a series', () => {
        expect(latest([null, 1, null, 2, null])).toBe(2);
        expect(latest([1, 2, 3])).toBe(3);
        expect(latest([5, NaN])).toBe(5);
        expect(latest([1, NaN, 4])).toBe(4);
    });

    it('returns null while the indicator is still warming up', () => {
        expect(latest([null, null])).toBeNull();
        expect(latest([])).toBeNull();
        expect(latest([NaN])).toBeNull();
    });
});
