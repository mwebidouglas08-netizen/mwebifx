// Algo Pro AI — exact port of the kicktrade.site AI scanner algorithm
// (chunk 247.50626e9a.js: tN / tE / tT / currentStake / orb confidence scoring)
// plus the Infinity Algo 1 digit-trigger recovery session (infinity-algo-1-cada0540.xml).
// All parameters and formulas below are copied verbatim from those bundles.

// ---------------------------------------------------------------------------
// Strategy catalog (exact tT list: ids, labels, descriptions, counts, accents)
// ---------------------------------------------------------------------------

export type AlgoProStrategyId =
    | 'even-odd-ai'
    | 'over-4-under-5-ai'
    | 'rise-fall-ai'
    | 'over-2-recovery-even-odd'
    | 'over-2-recovery-over-4-under-5'
    | 'under-7-recovery-even-odd'
    | 'under-7-recovery-over-4-under-5';

export interface AlgoProStrategy {
    id: AlgoProStrategyId;
    number: string;
    title: string;
    shortTitle: string;
    description: string;
    accent: string;
    primaryCount: number;
    recoveryCount?: number;
}

export const ALGO_PRO_STRATEGIES: AlgoProStrategy[] = [
    {
        id: 'even-odd-ai',
        number: '01',
        title: 'Even–Odd AI',
        shortTitle: 'Even–Odd AI',
        description: 'All Even digits trigger Odd. All Odd digits trigger Even.',
        accent: '#169bff',
        primaryCount: 5,
    },
    {
        id: 'over-4-under-5-ai',
        number: '02',
        title: 'Over 4–Under 5 AI',
        shortTitle: 'Over 4–Under 5 AI',
        description: 'Digits below 4 trigger Over 4. Digits above 5 trigger Under 5.',
        accent: '#00c7e8',
        primaryCount: 5,
    },
    {
        id: 'rise-fall-ai',
        number: '03',
        title: 'Rise–Fall AI',
        shortTitle: 'Rise–Fall AI',
        description: 'A rising run triggers Fall. A falling run triggers Rise.',
        accent: '#7f5cff',
        primaryCount: 5,
    },
    {
        id: 'over-2-recovery-even-odd',
        number: '04',
        title: 'Over 2 Recovery → Even–Odd',
        shortTitle: 'Over 2 Recovery · Even–Odd',
        description: 'The selected digit count below 2 triggers Over 2, followed by Even–Odd recovery after a loss.',
        accent: '#ff8500',
        primaryCount: 2,
        recoveryCount: 5,
    },
    {
        id: 'over-2-recovery-over-4-under-5',
        number: '05',
        title: 'Over 2 Recovery → Over 4–Under 5',
        shortTitle: 'Over 2 Recovery · Over 4–Under 5',
        description: 'The selected digit count below 2 triggers Over 2, followed by range recovery after a loss.',
        accent: '#ff8500',
        primaryCount: 2,
        recoveryCount: 5,
    },
    {
        id: 'under-7-recovery-even-odd',
        number: '06',
        title: 'Under 7 Recovery → Even–Odd',
        shortTitle: 'Under 7 Recovery · Even–Odd',
        description: 'The selected digit count above 7 triggers Under 7, followed by Even–Odd recovery after a loss.',
        accent: '#ff3f7d',
        primaryCount: 2,
        recoveryCount: 5,
    },
    {
        id: 'under-7-recovery-over-4-under-5',
        number: '07',
        title: 'Under 7 Recovery → Over 4–Under 5',
        shortTitle: 'Under 7 Recovery · Over 4–Under 5',
        description: 'The selected digit count above 7 triggers Under 7, followed by range recovery after a loss.',
        accent: '#ff3f7d',
        primaryCount: 2,
        recoveryCount: 5,
    },
];

export const DEFAULT_ALGO_PRO_STRATEGY: AlgoProStrategyId = 'even-odd-ai';

// ---------------------------------------------------------------------------
// Markets (exact tv list: 10 volatility indices with one-second flags)
// ---------------------------------------------------------------------------

export interface AlgoProMarket {
    symbol: string;
    displayName: string;
    oneSecond: boolean;
}

export const ALGO_PRO_MARKETS: AlgoProMarket[] = [
    { symbol: 'R_10', displayName: 'Volatility 10 Index', oneSecond: false },
    { symbol: 'R_25', displayName: 'Volatility 25 Index', oneSecond: false },
    { symbol: 'R_50', displayName: 'Volatility 50 Index', oneSecond: false },
    { symbol: 'R_75', displayName: 'Volatility 75 Index', oneSecond: false },
    { symbol: 'R_100', displayName: 'Volatility 100 Index', oneSecond: false },
    { symbol: '1HZ10V', displayName: 'Volatility 10 (1s) Index', oneSecond: true },
    { symbol: '1HZ25V', displayName: 'Volatility 25 (1s) Index', oneSecond: true },
    { symbol: '1HZ50V', displayName: 'Volatility 50 (1s) Index', oneSecond: true },
    { symbol: '1HZ75V', displayName: 'Volatility 75 (1s) Index', oneSecond: true },
    { symbol: '1HZ100V', displayName: 'Volatility 100 (1s) Index', oneSecond: true },
];

export type AlgoProScope = 'all' | 'standard' | 'one-second';

export const scopeMarkets = (scope: AlgoProScope): AlgoProMarket[] =>
    scope === 'standard'
        ? ALGO_PRO_MARKETS.filter(m => !m.oneSecond)
        : scope === 'one-second'
          ? ALGO_PRO_MARKETS.filter(m => m.oneSecond)
          : [...ALGO_PRO_MARKETS];

// ---------------------------------------------------------------------------
// Pip helpers (tw / orb defaults: 1HZ* → 2, standard → 3, fallback 2)
// ---------------------------------------------------------------------------

export const pipSizeDefault = (symbol: string): number => (symbol.startsWith('1HZ') ? 2 : 3);

export const pipSizeFromActiveSymbol = (symbol: string, pip_size?: number, decimal_places?: number): number => {
    if (Number.isFinite(pip_size as number) && (pip_size as number) >= 0 && (pip_size as number) <= 10) {
        return pip_size as number;
    }
    if (Number.isFinite(decimal_places as number) && (decimal_places as number) >= 0 && (decimal_places as number) <= 10) {
        return decimal_places as number;
    }
    return pipSizeDefault(symbol);
};

/** tw(): last digit of the quote at pip precision. */
export const lastDigitAt = (price: number, pipSize: number): number =>
    Number(price.toFixed(pipSize).slice(-1));

// ---------------------------------------------------------------------------
// Pattern helpers (tj / t_ / tk / tS / rise-fall streaks)
// ---------------------------------------------------------------------------

export const allBelow = (digits: number[], barrier: number): boolean => digits.length > 0 && digits.every(d => d < barrier);
export const allAbove = (digits: number[], barrier: number): boolean => digits.length > 0 && digits.every(d => d > barrier);
export const allEven = (digits: number[]): boolean => digits.length > 0 && digits.every(d => d % 2 === 0);
export const allOdd = (digits: number[]): boolean => digits.length > 0 && digits.every(d => d % 2 === 1);
export const allRising = (prices: number[]): boolean =>
    prices.length > 1 && prices.every((p, i) => i === 0 || p > prices[i - 1]);
export const allFalling = (prices: number[]): boolean =>
    prices.length > 1 && prices.every((p, i) => i === 0 || p < prices[i - 1]);

/** tE(): lookback window — 5 for *-ai strategies and recovery mode, else 2. */
export const checkedTicks = (strategyId: AlgoProStrategyId, recoveryMode: boolean): number => {
    if (recoveryMode) return 5;
    return strategyId.endsWith('-ai') ? 5 : 2;
};

// ---------------------------------------------------------------------------
// Signal engine (exact tN port)
// ---------------------------------------------------------------------------

export type AlgoProContractType = 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD' | 'CALL' | 'PUT';

export interface AlgoProSignal {
    contractType: AlgoProContractType;
    label: string;
    barrier?: number;
}

const evenOddPattern = (digits: number[]): AlgoProSignal | null => {
    const win = digits.slice(-5);
    if (allEven(win)) return { contractType: 'DIGITODD', label: 'Trade Odd' };
    if (allOdd(win)) return { contractType: 'DIGITEVEN', label: 'Trade Even' };
    return null;
};

const over4Under5Pattern = (digits: number[]): AlgoProSignal | null => {
    const win = digits.slice(-5);
    if (allBelow(win, 4)) return { contractType: 'DIGITOVER', label: 'Trade Over 4', barrier: 4 };
    if (allAbove(win, 5)) return { contractType: 'DIGITUNDER', label: 'Trade Under 5', barrier: 5 };
    return null;
};

const riseFallPattern = (prices: number[]): AlgoProSignal | null => {
    const win = prices.slice(-5);
    if (allRising(win)) return { contractType: 'PUT', label: 'Trade Fall' };
    if (allFalling(win)) return { contractType: 'CALL', label: 'Trade Rise' };
    return null;
};

/** tN(): strategy signal from rolling quote/digit buffers. */
export const signalFromStrategy = (
    strategyId: AlgoProStrategyId,
    prices: number[],
    digits: number[],
    recoveryMode: boolean
): AlgoProSignal | null => {
    switch (strategyId) {
        case 'even-odd-ai':
            return evenOddPattern(digits);
        case 'over-4-under-5-ai':
            return over4Under5Pattern(digits);
        case 'rise-fall-ai':
            return riseFallPattern(prices);
        case 'over-2-recovery-even-odd':
            if (recoveryMode) return evenOddPattern(digits);
            return allBelow(digits.slice(-2), 2) ? { contractType: 'DIGITOVER', label: 'Trade Over 2', barrier: 2 } : null;
        case 'over-2-recovery-over-4-under-5':
            if (recoveryMode) return over4Under5Pattern(digits);
            return allBelow(digits.slice(-2), 2) ? { contractType: 'DIGITOVER', label: 'Trade Over 2', barrier: 2 } : null;
        case 'under-7-recovery-even-odd':
            if (recoveryMode) return evenOddPattern(digits);
            return allAbove(digits.slice(-2), 7) ? { contractType: 'DIGITUNDER', label: 'Trade Under 7', barrier: 7 } : null;
        case 'under-7-recovery-over-4-under-5':
            if (recoveryMode) return over4Under5Pattern(digits);
            return allAbove(digits.slice(-2), 7) ? { contractType: 'DIGITUNDER', label: 'Trade Under 7', barrier: 7 } : null;
        default:
            return null;
    }
};

// ---------------------------------------------------------------------------
// Stake / dedupe / settlement helpers (tM)
// ---------------------------------------------------------------------------

/** currentStake(): stake × martingale^lossDepth, rounded to 1e-8. */
export const martingaleStake = (base: number, factor: number, lossDepth: number): number => {
    const raw = base * Math.pow(factor, Math.max(0, lossDepth));
    return Math.round(raw * 1e8) / 1e8;
};

/** lastTradeKey dedupe: one trade per symbol:epoch:contract:barrier. */
export const tradeKey = (symbol: string, epoch: number, contractType: string, barrier: number | undefined): string =>
    `${symbol}:${epoch}:${contractType}:${barrier ?? ''}`;

// ---------------------------------------------------------------------------
// Digit-pair confidence scanner (orb "AI Entry Scanner" profiles + scoring)
// ---------------------------------------------------------------------------

export type PairProfileId = 'over1_under8' | 'over2_under7' | 'over3_under6';

export interface PairProfile {
    id: PairProfileId;
    label: string;
    over: number;
    under: number;
}

export const PAIR_PROFILES: PairProfile[] = [
    { id: 'over1_under8', label: 'Over1 / Under8', over: 1, under: 8 },
    { id: 'over2_under7', label: 'Over2 / Under7', over: 2, under: 7 },
    { id: 'over3_under6', label: 'Over3 / Under6', over: 3, under: 6 },
];

const recentWindow = (digits: number[]): number[] =>
    digits.slice(-Math.min(250, Math.max(30, Math.round(0.12 * digits.length))));

const sideRate = (digits: number[], side: 'over' | 'under', barrier: number): number => {
    if (!digits.length) return 0;
    let wins = 0;
    for (const d of digits) {
        if (side === 'over' ? d > barrier : d < barrier) wins += 1;
    }
    return wins / digits.length;
};

export interface PairCandidate {
    side: 'over' | 'under';
    barrier: number;
    recoverySide: 'over' | 'under';
    recoveryBarrier: number;
    confidence: number;
    primaryRate: number;
    recentRate: number;
    recoveryRate: number;
    sample: number;
    recentSample: number;
}

const evaluateSide = (
    digits: number[],
    side: 'over' | 'under',
    barrier: number,
    recoverySide: 'over' | 'under',
    recoveryBarrier: number
): PairCandidate => {
    const primaryRate = sideRate(digits, side, barrier);
    const recentRate = sideRate(recentWindow(digits), side, barrier);
    const recoveryRate = sideRate(digits, recoverySide, recoveryBarrier);
    // Exact orb scoring: 0.55 primary (full sample) + 0.30 recent + 0.15 recovery.
    const confidence = 0.55 * primaryRate + 0.3 * recentRate + 0.15 * recoveryRate;
    return {
        side,
        barrier,
        recoverySide,
        recoveryBarrier,
        confidence,
        primaryRate,
        recentRate,
        recoveryRate,
        sample: digits.length,
        recentSample: Math.min(250, Math.max(30, Math.round(0.12 * digits.length))),
    };
};

/** Both candidates for a profile: over-primary and under-primary (swapped pair). */
export const digitPairCandidates = (digits: number[], profile: PairProfile): [PairCandidate, PairCandidate] => [
    evaluateSide(digits, 'over', profile.over, 'under', profile.under),
    evaluateSide(digits, 'under', profile.under, 'over', profile.over),
];

/** Best candidate for one market: higher confidence wins (orb picks max). */
export const bestPairCandidate = (digits: number[], profile: PairProfile): PairCandidate => {
    const [a, b] = digitPairCandidates(digits, profile);
    if (b.confidence > a.confidence) return b;
    if (a.confidence > b.confidence) return a;
    return b.recentRate > a.recentRate ? b : a;
};

/** Convert a pair candidate into a trade signal.
 *  - Primary: the candidate's own side/barrier (Over X / Under Y of the profile).
 *  - Recovery (after a loss): the paired partner (recoverySide/recoveryBarrier).
 *  Previously the under side mapped to `recoveryBarrier`, which traded
 *  "Under 2" while scoring the Under-7 rate — a mismatched barrier/payout. */
export const pairCandidateToSignal = (candidate: PairCandidate, recovery = false): AlgoProSignal => {
    const side = recovery ? candidate.recoverySide : candidate.side;
    const barrier = recovery ? candidate.recoveryBarrier : candidate.barrier;
    return {
        contractType: side === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
        label: `Trade ${side === 'over' ? 'Over' : 'Under'} ${barrier}`,
        barrier,
    };
};

export interface RankedMarketSignal {
    symbol: string;
    displayName: string;
    candidate: PairCandidate;
}

/** Sort markets by confidence desc, then recentRate desc (orb ranking). */
export const rankMarketSignals = (items: RankedMarketSignal[]): RankedMarketSignal[] =>
    [...items].sort((a, b) => {
        if (b.candidate.confidence !== a.candidate.confidence) {
            return b.candidate.confidence - a.candidate.confidence;
        }
        return b.candidate.recentRate - a.candidate.recentRate;
    });

// ---------------------------------------------------------------------------
// Signal quality — live favourability gate (measured rate vs house break-even)
// ---------------------------------------------------------------------------

/** Theoretical win probability of a contract on a fair wheel. */
export const theoreticalProbability = (contractType: AlgoProContractType, barrier?: number): number => {
    switch (contractType) {
        case 'DIGITOVER':
            return Math.min(1, Math.max(0, (10 - (barrier ?? 0)) / 10));
        case 'DIGITUNDER':
            return Math.min(1, Math.max(0, (barrier ?? 10) / 10));
        default:
            return 0.5; // DIGITEVEN / DIGITODD / CALL / PUT ≈ 50/50
    }
};

/** Break-even hit-rate: Deriv pays ≈ 0.95/p (≈5% margin), so the measured
 *  win-rate must exceed p/0.95 before a trade is even break-even. */
export const breakevenRate = (contractType: AlgoProContractType, barrier?: number): number =>
    theoreticalProbability(contractType, barrier) / 0.95;

export interface SignalQuality {
    /** Blended measured win-rate: 0.55·full-sample + 0.30·recent (orb weights). */
    blended: number;
    fullRate: number;
    recentRate: number;
    pTheory: number;
    breakeven: number;
    /** blended − breakeven (positive = favourable). */
    edge: number;
    sample: number;
    recentSample: number;
}

const qualityWindow = (n: number): number => Math.min(250, Math.max(30, Math.round(0.12 * n)));

interface RatePair {
    full: number;
    recent: number;
    sample: number;
    recentSample: number;
}

const winRate = (contractType: AlgoProContractType, barrier: number | undefined, digits: number[], prices: number[]): RatePair => {
    if (contractType === 'CALL' || contractType === 'PUT') {
        const moves: number[] = [];
        for (let i = 1; i < prices.length; i++) {
            if (prices[i] > prices[i - 1]) moves.push(1);
            else if (prices[i] < prices[i - 1]) moves.push(0);
        }
        const recentN = qualityWindow(moves.length);
        const recent = moves.slice(-recentN);
        const wins = (list: number[]) => (list.length ? list.filter(x => x === 1).length / list.length : 0);
        return {
            full: wins(moves),
            recent: wins(recent),
            sample: moves.length,
            recentSample: recent.length,
        };
    }
    const hit = (d: number): boolean => {
        switch (contractType) {
            case 'DIGITOVER':
                return d > (barrier ?? 0);
            case 'DIGITUNDER':
                return d < (barrier ?? 10);
            case 'DIGITEVEN':
                return d % 2 === 0;
            case 'DIGITODD':
                return d % 2 === 1;
            default:
                return false;
        }
    };
    const recentN = qualityWindow(digits.length);
    const recent = digits.slice(-recentN);
    return {
        full: digits.length ? digits.filter(hit).length / digits.length : 0,
        recent: recent.length ? recent.filter(hit).length / recent.length : 0,
        sample: digits.length,
        recentSample: recent.length,
    };
};

/** Measure a would-be signal against the live digit/quote buffers. */
export const signalQuality = (
    signal: Pick<AlgoProSignal, 'contractType' | 'barrier'>,
    digits: number[],
    prices: number[]
): SignalQuality => {
    const { full, recent, sample, recentSample } = winRate(signal.contractType, signal.barrier, digits, prices);
    const pTheory = theoreticalProbability(signal.contractType, signal.barrier);
    const breakeven = pTheory / 0.95;
    const blended = 0.55 * full + 0.3 * recent;
    return {
        blended,
        fullRate: full,
        recentRate: recent,
        pTheory,
        breakeven,
        edge: blended - breakeven,
        sample,
        recentSample,
    };
};

/** Favourability rule: enough live data, blended rate beats house break-even,
 *  and the RECENT window (current market state) clears it with a margin. */
export const QUALITY_MIN_SAMPLE = 30;
export const QUALITY_EDGE_MARGIN = 0.01;

export const isFavourable = (q: SignalQuality): boolean =>
    q.sample >= QUALITY_MIN_SAMPLE && q.blended >= q.breakeven && q.recentRate >= q.breakeven + QUALITY_EDGE_MARGIN;

/**
 * "Trade NOW" gate — a signal strong enough to skip the production cooldown and
 * fire the instant it is detected. Strong = measured edge of at least +2pp over
 * house break-even (and, in pair mode, pair confidence of at least 0.8).
 */
export const STRONG_SIGNAL_EDGE = 0.02;
export const STRONG_PAIR_CONFIDENCE = 0.8;

export const isStrongSignal = (edge: number, pairConfidence: number, usePairScanner: boolean): boolean =>
    edge >= STRONG_SIGNAL_EDGE && (!usePairScanner || pairConfidence >= STRONG_PAIR_CONFIDENCE);

// ---------------------------------------------------------------------------
// Infinity Algo 1 session (digit trigger + recovery, from infinity-algo-1.xml)
// ---------------------------------------------------------------------------

export interface InfinityAlgoConfig {
    entryDigit: number;
    initialBarrier: number;
    recoveryBarrier: number;
    baseStake: number;
    martingaleFactor: number;
    winTarget: number;
    stopLoss: number;
    useMartingale: boolean;
}

export const INFINITY_ALGO_DEFAULTS: InfinityAlgoConfig = {
    entryDigit: 4,
    initialBarrier: 1,
    recoveryBarrier: 4,
    baseStake: 0.5,
    martingaleFactor: 2,
    winTarget: 5,
    stopLoss: 50,
    useMartingale: true,
};

export interface InfinitySession {
    stake: number;
    prediction: number;
    runCount: number;
    wins: number;
    losses: number;
    totalProfit: number;
    ended: null | 'win_target' | 'stop_loss';
    message: string;
}

export const createInfinitySession = (cfg: InfinityAlgoConfig): InfinitySession => ({
    stake: cfg.baseStake,
    prediction: cfg.initialBarrier,
    runCount: 0,
    wins: 0,
    losses: 0,
    totalProfit: 0,
    ended: null,
    message: '',
});

/** Entry gate: wait until the live last digit equals the entry digit (4 in the bot). */
export const infinityEntryReady = (lastDigit: number, cfg: InfinityAlgoConfig): boolean => lastDigit === cfg.entryDigit;

/** after_purchase branch: win resets stake+prediction; loss flips to recovery + martingale. */
export const applyInfinitySettlement = (session: InfinitySession, won: boolean, profit: number, cfg: InfinityAlgoConfig): InfinitySession => {
    const totalProfit = Math.round((session.totalProfit + profit) * 1e8) / 1e8;
    const runCount = won ? session.runCount + 1 : session.runCount;
    const wins = won ? session.wins + 1 : session.wins;
    const losses = won ? session.losses : session.losses + 1;
    const stake = won ? cfg.baseStake : cfg.useMartingale ? session.stake * cfg.martingaleFactor : cfg.baseStake;
    const prediction = won ? cfg.initialBarrier : cfg.recoveryBarrier;
    let ended: InfinitySession['ended'] = null;
    let message = '';
    if (runCount >= cfg.winTarget) {
        ended = 'win_target';
        message = 'Session Completed!!!';
    } else if (totalProfit <= -cfg.stopLoss) {
        ended = 'stop_loss';
        message = 'Sorry!!! Stop Loss Hit';
    }
    return {
        stake: Math.round(stake * 1e8) / 1e8,
        prediction,
        runCount,
        wins,
        losses,
        totalProfit,
        ended,
        message,
    };
};
