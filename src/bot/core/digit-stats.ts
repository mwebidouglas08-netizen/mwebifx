const DIGITS = 10;

export const computeDigitCounts = (digits: number[]): number[] => {
    const counts = new Array(DIGITS).fill(0);
    for (const d of digits) {
        const i = Math.floor(d);
        if (i >= 0 && i < DIGITS) counts[i] += 1;
    }
    return counts;
};

const logGamma = (x: number): number => {
    const cof = [
        76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
        0.1208650973866179e-2, -0.5395239384953e-5,
    ];
    let y = x;
    let tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) {
        y += 1;
        ser += cof[j] / y;
    }
    return -tmp + Math.log((2.5066282746310005 * ser) / x);
};

const gser = (a: number, x: number): number => {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 1000; n++) {
        ap += 1;
        del *= x / ap;
        sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
};

const gcf = (a: number, x: number): number => {
    const tiny = 1e-300;
    let b = x + 1 - a;
    let c = 1 / tiny;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i <= 1000; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < tiny) d = tiny;
        c = b + an / c;
        if (Math.abs(c) < tiny) c = tiny;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-12) break;
    }
    return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
};

export const regularizedGammaQ = (a: number, x: number): number => {
    if (x < 0 || a <= 0) return 1;
    if (x === 0) return 1;
    if (x < a + 1) return 1 - gser(a, x);
    return gcf(a, x);
};

export const chiSquarePValue = (chiSquare: number, degreesOfFreedom: number): number => {
    if (!Number.isFinite(chiSquare) || chiSquare <= 0) return 1;
    return regularizedGammaQ(degreesOfFreedom / 2, chiSquare / 2);
};

export const empiricalCountsToProbabilities = (counts: number[]): number[] => {
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return new Array(DIGITS).fill(0);
    return counts.map(c => c / total);
};

export const chiSquareUniformity = (counts: number[]): { chiSquare: number; pValue: number; df: number } => {
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return { chiSquare: 0, pValue: 1, df: DIGITS - 1 };
    const expected = total / DIGITS;
    let chiSquare = 0;
    for (const observed of counts) {
        const diff = observed - expected;
        chiSquare += (diff * diff) / expected;
    }
    const df = DIGITS - 1;
    return { chiSquare, pValue: chiSquarePValue(chiSquare, df), df };
};

export const wilsonInterval = (
    successes: number,
    n: number,
    z = 1.96
): [number, number] => {
    if (!n) return [0, 1];
    const p = successes / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
};

export const theoreticalProbability = (direction: 'over' | 'under', barrier: number): number => {
    if (direction === 'over') {
        const wins = DIGITS - 1 - barrier;
        return wins > 0 ? wins / DIGITS : 0;
    }
    const wins = barrier;
    return wins > 0 ? wins / DIGITS : 0;
};

export const winsFor = (direction: 'over' | 'under', barrier: number, digit: number): boolean =>
    direction === 'over' ? digit > barrier : digit < barrier;

export const empiricalProbability = (
    digits: number[],
    direction: 'over' | 'under',
    barrier: number
): number => {
    if (!digits.length) return 0;
    let wins = 0;
    for (const d of digits) if (winsFor(direction, barrier, d)) wins += 1;
    return wins / digits.length;
};

export interface BiasDetection {
    empiricalProb: number;
    theoreticalProb: number;
    ciLow: number;
    ciHigh: number;
    gap: number;
    isSignificant: boolean;
    sampleSize: number;
}

export const detectDirectionalBias = (
    digits: number[],
    direction: 'over' | 'under',
    barrier: number,
    z = 1.96
): BiasDetection => {
    const n = digits.length;
    const theoreticalProb = theoreticalProbability(direction, barrier);
    if (!n) {
        return {
            empiricalProb: 0,
            theoreticalProb,
            ciLow: 0,
            ciHigh: 1,
            gap: 0,
            isSignificant: false,
            sampleSize: 0,
        };
    }
    let wins = 0;
    for (const d of digits) if (winsFor(direction, barrier, d)) wins += 1;
    const empiricalProb = wins / n;
    const [ciLow, ciHigh] = wilsonInterval(wins, n, z);
    const gap = empiricalProb - theoreticalProb;
    const isSignificant = gap > 0 ? ciLow > theoreticalProb : ciHigh < theoreticalProb;
    return { empiricalProb, theoreticalProb, ciLow, ciHigh, gap, isSignificant, sampleSize: n };
};

export interface MarkovEvidence {
    hasDependence: boolean;
    maxConditionalGap: number;
    conditionedOn: number;
    sampleSize: number;
}

export const detectConditionalDependence = (
    digits: number[],
    z = 1.96
): MarkovEvidence => {
    if (digits.length < 200) {
        return { hasDependence: false, maxConditionalGap: 0, conditionedOn: -1, sampleSize: digits.length };
    }
    const marginal = empiricalCountsToProbabilities(computeDigitCounts(digits));
    let maxGap = 0;
    let bestPrev = -1;
    for (let prev = 0; prev < DIGITS; prev++) {
        const counts = new Array(DIGITS).fill(0);
        for (let i = 1; i < digits.length; i++) {
            if (digits[i - 1] === prev) counts[digits[i]] += 1;
        }
        const n = counts.reduce((a, b) => a + b, 0);
        if (n < 30) continue;
        const cond = empiricalCountsToProbabilities(counts);
        for (let d = 0; d < DIGITS; d++) {
            const [lo, hi] = wilsonInterval(counts[d], n, z);
            if (marginal[d] < lo || marginal[d] > hi) {
                const gap = Math.abs(cond[d] - marginal[d]);
                if (gap > maxGap) {
                    maxGap = gap;
                    bestPrev = prev;
                }
            }
        }
    }
    return { hasDependence: maxGap > 0.02, maxConditionalGap: maxGap, conditionedOn: bestPrev, sampleSize: digits.length };
};

export interface VolatilityProfile {
    meanAbsChange: number;
    stdAbsChange: number;
    currentVol: number;
    expansion: boolean;
    contraction: boolean;
}

export const analyzeVolatility = (quotes: number[], window = 20): VolatilityProfile => {
    if (quotes.length < 3) {
        return { meanAbsChange: 0, stdAbsChange: 0, currentVol: 0, expansion: false, contraction: false };
    }
    const changes: number[] = [];
    for (let i = 1; i < quotes.length; i++) changes.push(Math.abs(quotes[i] - quotes[i - 1]));
    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length;
    const std = Math.sqrt(variance);
    const recent = changes.slice(-window);
    const older = changes.slice(-window * 2, -window);
    const recentMean = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
    const olderMean = older.length ? older.reduce((a, b) => a + b, 0) / older.length : recentMean;
    return {
        meanAbsChange: mean,
        stdAbsChange: std,
        currentVol: recentMean,
        expansion: olderMean > 0 && recentMean > olderMean * 1.25,
        contraction: olderMean > 0 && recentMean < olderMean * 0.75,
    };
};

export interface MomentumProfile {
    rsi: number;
    trend: 'up' | 'down' | 'flat';
    smaShort: number;
    smaLong: number;
}

export const computeRsi = (quotes: number[], period = 14): number => {
    if (quotes.length <= period) return 50;
    const slice = quotes.slice(-(period + 1));
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < slice.length; i++) {
        const delta = slice[i] - slice[i - 1];
        if (delta >= 0) gains += delta;
        else losses -= delta;
    }
    if (gains === 0 && losses === 0) return 50;
    const rs = losses === 0 ? 100 : gains / losses;
    return 100 - 100 / (1 + rs);
};

export const analyzeMomentum = (quotes: number[], short = 5, long = 20): MomentumProfile => {
    if (quotes.length < long) {
        return { rsi: 50, trend: 'flat', smaShort: 0, smaLong: 0 };
    }
    const recent = quotes.slice(-short);
    const extended = quotes.slice(-long);
    const smaShort = recent.reduce((a, b) => a + b, 0) / recent.length;
    const smaLong = extended.reduce((a, b) => a + b, 0) / extended.length;
    const diff = smaShort - smaLong;
    const threshold = Math.abs(smaLong) * 0.0005;
    return {
        rsi: computeRsi(quotes),
        trend: diff > threshold ? 'up' : diff < -threshold ? 'down' : 'flat',
        smaShort,
        smaLong,
    };
};
