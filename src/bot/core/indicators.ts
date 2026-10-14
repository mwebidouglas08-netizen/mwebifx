/**
 * Chart-indicator math for the Analysis Tool: EMA, MACD and Bollinger Bands
 * over real quote series. RSI already lives in `digit-stats.ts`
 * (`computeRsi`, Wilder smoothing) and is re-used by the tool.
 *
 * All functions are pure and return aligned arrays (index-for-index with the
 * input, with `null` while the indicator is still warming up).
 */

const isFiniteNum = (n: number): boolean => Number.isFinite(n);

/** Exponential moving average over a quote series. */
export const ema = (values: number[], period: number): Array<number | null> => {
    const out: Array<number | null> = new Array(values.length).fill(null);
    if (period <= 0 || values.length < period) return out;

    let sum = 0;
    for (let i = 0; i < period; i += 1) sum += values[i];
    let prev = sum / period;
    out[period - 1] = prev;

    const k = 2 / (period + 1);
    for (let i = period; i < values.length; i += 1) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
};

export interface MacdOptions {
    fast?: number;
    slow?: number;
    signalPeriod?: number;
}

export interface MacdResult {
    macd: Array<number | null>;
    signal: Array<number | null>;
    histogram: Array<number | null>;
}

/** MACD line, signal line and histogram (default 12/26/9). */
export const macd = (quotes: number[], options: MacdOptions = {}): MacdResult => {
    const { fast = 12, slow = 26, signalPeriod = 9 } = options;
    const n = quotes.length;
    const fastLine = ema(quotes, fast);
    const slowLine = ema(quotes, slow);

    const macdLine: Array<number | null> = new Array(n).fill(null);
    for (let i = 0; i < n; i += 1) {
        if (fastLine[i] != null && slowLine[i] != null) {
            macdLine[i] = (fastLine[i] as number) - (slowLine[i] as number);
        }
    }

    // Signal line = EMA of the MACD line over its valid tail.
    const signal: Array<number | null> = new Array(n).fill(null);
    const firstValid = macdLine.findIndex(v => v != null);
    if (firstValid >= 0) {
        const tail = macdLine.slice(firstValid).map(v => v as number);
        const tailSignal = ema(tail, signalPeriod);
        for (let i = 0; i < tailSignal.length; i += 1) {
            signal[firstValid + i] = tailSignal[i];
        }
    }

    const histogram: Array<number | null> = new Array(n).fill(null);
    for (let i = 0; i < n; i += 1) {
        if (macdLine[i] != null && signal[i] != null) {
            histogram[i] = (macdLine[i] as number) - (signal[i] as number);
        }
    }

    return { macd: macdLine, signal, histogram };
};

export interface BollingerOptions {
    period?: number;
    mult?: number;
}

export interface BollingerResult {
    middle: Array<number | null>;
    upper: Array<number | null>;
    lower: Array<number | null>;
    /** Bandwidth (upper − lower) / middle at each index. */
    percentB: Array<number | null>;
}

/** Bollinger Bands (SMA ± mult × standard deviation). */
export const bollinger = (quotes: number[], options: BollingerOptions = {}): BollingerResult => {
    const { period = 20, mult = 2 } = options;
    const n = quotes.length;
    const middle: Array<number | null> = new Array(n).fill(null);
    const upper: Array<number | null> = new Array(n).fill(null);
    const lower: Array<number | null> = new Array(n).fill(null);
    const percentB: Array<number | null> = new Array(n).fill(null);

    for (let i = period - 1; i < n; i += 1) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j += 1) sum += quotes[j];
        const mean = sum / period;
        let variance = 0;
        for (let j = i - period + 1; j <= i; j += 1) {
            variance += (quotes[j] - mean) ** 2;
        }
        const stddev = Math.sqrt(variance / period);
        const up = mean + mult * stddev;
        const low = mean - mult * stddev;
        middle[i] = mean;
        upper[i] = up;
        lower[i] = low;
        percentB[i] = up > low ? (quotes[i] - low) / (up - low) : null;
    }

    return { middle, upper, lower, percentB };
};

/** Latest non-null value of an indicator series, or null while warming up. */
export const latest = (series: Array<number | null>): number | null => {
    for (let i = series.length - 1; i >= 0; i -= 1) {
        const v = series[i];
        if (v != null && isFiniteNum(v)) return v;
    }
    return null;
};
