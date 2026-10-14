import {
    empiricalProbability,
    theoreticalProbability,
    wilsonInterval,
    winsFor,
} from './digit-stats';

/**
 * Pro AI — automated digit-entry scoring, modelled on SmartFlip's Pro AI
 * ("Over 1 Pro" … "Under 6 Pro") bots.
 *
 * The algorithm is a transparent heuristic, not a predictive model:
 *
 *  1. Take the last `sampleSize` real last-digits for a market.
 *  2. `winRate`      — share of those digits that satisfy the bot's barrier.
 *  3. `recentWinRate` — the same over the trailing `recentWindow` digits, so a
 *     market whose edge just flipped is penalised.
 *  4. `qualityScore` — the Wilson lower bound of the win rate: how confidently
 *     the sample supports the measured edge (small samples score low).
 *  5. `aiScore = 0.45 * qualityScore + 0.55 * winRate` — the same blend
 *     SmartFlip applies; a BUY requires `aiScore >= 0.72` **and**
 *     `recentWinRate >= 0.55`.
 *  6. Two hard blocks (SmartFlip's `noTradeZone` / `oppositeExtreme`):
 *     - opposite extreme — every digit in the bot's lookback window lost;
 *     - no-trade zone — the recent window is below the theoretical (fair)
 *       probability for the barrier.
 *
 * A candidate is honest about what it is: a ranked heuristic on historical
 * digits. It is not a win-rate guarantee.
 */

export interface ProAiBot {
    id: string;
    name: string;
    barrier: number;
    direction: 'over' | 'under';
    /** Ticks the bot waits before it considers an entry (SmartFlip lookback). */
    lookback: number;
}

export const PRO_AI_BOTS: ProAiBot[] = [
    { id: 'over-1', name: 'Over 1 Pro', barrier: 1, direction: 'over', lookback: 3 },
    { id: 'under-8', name: 'Under 8 Pro', barrier: 8, direction: 'under', lookback: 3 },
    { id: 'over-2', name: 'Over 2 Pro', barrier: 2, direction: 'over', lookback: 4 },
    { id: 'under-7', name: 'Under 7 Pro', barrier: 7, direction: 'under', lookback: 4 },
    { id: 'over-3', name: 'Over 3 Pro', barrier: 3, direction: 'over', lookback: 5 },
    { id: 'under-6', name: 'Under 6 Pro', barrier: 6, direction: 'under', lookback: 5 },
];

export type ProAiScope = 'standard' | 'one-second' | 'all';

export const SCOPE_LABEL: Record<ProAiScope, string> = {
    standard: 'Volatility Indices only',
    'one-second': 'Volatility Indices (1s) only',
    all: 'All Volatilities',
};

/** 1-second synthetic symbols are `1HZ<digits>V` (e.g. 1HZ10V). */
export const isOneSecondSymbol = (symbol: string): boolean => /^1HZ\d+V$/i.test(symbol);

/** Plain volatility indices are `R_<digits>` (e.g. R_75). */
export const isStandardSymbol = (symbol: string): boolean => /^R_\d+$/i.test(symbol);

export const scopeMatches = (scope: ProAiScope, symbol: string): boolean => {
    if (scope === 'all') return true;
    if (scope === 'one-second') return isOneSecondSymbol(symbol);
    return isStandardSymbol(symbol);
};

export interface ProAiScanOptions {
    /** Total sample of digits used for the base win rate (default 100). */
    sampleSize?: number;
    /** Trailing window used for `recentWinRate` (default 30). */
    recentWindow?: number;
    /** Minimum digits required before anything can qualify (default 40). */
    minSample?: number;
    /** aiScore gate (default 0.72, SmartFlip's threshold). */
    minAiScore?: number;
    /** recentWinRate gate (default 0.55, SmartFlip's threshold). */
    minRecentWinRate?: number;
}

export const DEFAULT_PRO_AI_OPTIONS: Required<ProAiScanOptions> = {
    sampleSize: 100,
    recentWindow: 30,
    minSample: 40,
    minAiScore: 0.72,
    minRecentWinRate: 0.55,
};

export type ProAiSignal = 'BUY' | 'BLOCK';

export interface ProAiEvaluation {
    botId: string;
    barrier: number;
    direction: 'over' | 'under';
    sampleSize: number;
    winRate: number;
    recentWinRate: number;
    /** Hold-out check on the newest 30% of the sample. */
    validationWinRate: number;
    theoretical: number;
    qualityScore: number;
    confidenceScore: number;
    aiScore: number;
    signal: ProAiSignal;
    blockReason: string | null;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Score one market's digit history against one Pro AI bot. Pure function —
 * no I/O — so it is directly unit-testable.
 */
export const evaluateProAiEntry = (
    digits: number[],
    bot: ProAiBot,
    options: ProAiScanOptions = {}
): ProAiEvaluation => {
    const opts = { ...DEFAULT_PRO_AI_OPTIONS, ...options };
    const sample = digits.slice(-Math.max(opts.sampleSize, bot.lookback + opts.minSample));
    const n = sample.length;
    const theoretical = theoreticalProbability(bot.direction, bot.barrier);

    const wins = sample.filter(d => winsFor(bot.direction, bot.barrier, d)).length;
    const winRate = n ? wins / n : 0;

    const recent = sample.slice(-Math.max(1, Math.min(opts.recentWindow, n)));
    const recentWins = recent.filter(d => winsFor(bot.direction, bot.barrier, d)).length;
    const recentWinRate = recent.length ? recentWins / recent.length : 0;

    const validationSize = Math.max(1, Math.floor(n * 0.3));
    const validation = sample.slice(-validationSize);
    const validationWins = validation.filter(d => winsFor(bot.direction, bot.barrier, d)).length;
    const validationWinRate = validation.length ? validationWins / validation.length : 0;

    const [ciLow, ciHigh] = wilsonInterval(wins, n);
    const qualityScore = ciLow;
    const confidenceScore = clamp01((ciHigh - ciLow) > 0 ? (winRate - ciLow) / (ciHigh - ciLow) : 0);

    const aiScore = clamp01(0.45 * qualityScore + 0.55 * winRate);

    // Hard blocks — checked before the score gates.
    let blockReason: string | null = null;
    const lookbackWindow = sample.slice(-bot.lookback);
    const lookbackAllLost =
        lookbackWindow.length === bot.lookback &&
        lookbackWindow.every(d => !winsFor(bot.direction, bot.barrier, d));
    if (n < opts.minSample) {
        blockReason = `Insufficient sample (${n}/${opts.minSample} ticks)`;
    } else if (lookbackAllLost) {
        blockReason = 'Opposite extreme — the lookback window is all losses';
    } else if (recentWinRate < theoretical) {
        blockReason = `No-trade zone — recent ${(recentWinRate * 100).toFixed(0)}% is below fair ${(theoretical * 100).toFixed(0)}%`;
    }

    let signal: ProAiSignal = 'BUY';
    if (!blockReason) {
        if (aiScore < opts.minAiScore) {
            signal = 'BLOCK';
            blockReason = `AI score ${(aiScore * 100).toFixed(1)}% below ${(opts.minAiScore * 100).toFixed(0)}% gate`;
        } else if (recentWinRate < opts.minRecentWinRate) {
            signal = 'BLOCK';
            blockReason = `Recent win rate ${(recentWinRate * 100).toFixed(1)}% below ${(opts.minRecentWinRate * 100).toFixed(0)}% gate`;
        }
    } else {
        signal = 'BLOCK';
    }

    return {
        botId: bot.id,
        barrier: bot.barrier,
        direction: bot.direction,
        sampleSize: n,
        winRate,
        recentWinRate,
        validationWinRate,
        theoretical,
        qualityScore,
        confidenceScore,
        aiScore,
        signal,
        blockReason,
    };
};

export interface ProAiMarketInput {
    symbol: string;
    displayName?: string;
    digits: number[];
}

export interface ProAiCandidate extends ProAiEvaluation {
    symbol: string;
    displayName: string;
}

/**
 * Score every market × bot combination and return BUY candidates ranked by
 * AI score (best first). Blocked evaluations are excluded.
 */
export const scanProAiMarkets = (
    markets: ProAiMarketInput[],
    options: ProAiScanOptions & { scope?: ProAiScope; bots?: ProAiBot[] } = {}
): ProAiCandidate[] => {
    const { scope, bots, ...evalOpts } = options;
    const botList = bots ?? PRO_AI_BOTS;
    const out: ProAiCandidate[] = [];
    for (const market of markets) {
        if (scope && !scopeMatches(scope, market.symbol)) continue;
        for (const bot of botList) {
            const evaluation = evaluateProAiEntry(market.digits, bot, evalOpts);
            if (evaluation.signal !== 'BUY') continue;
            out.push({
                ...evaluation,
                symbol: market.symbol,
                displayName: market.displayName ?? market.symbol,
            });
        }
    }
    out.sort((a, b) => b.aiScore - a.aiScore || b.recentWinRate - a.recentWinRate);
    return out;
};

/** Empirical win rate of a digit sequence against a barrier (helper for UI). */
export const proAiWinRate = (digits: number[], direction: 'over' | 'under', barrier: number): number =>
    empiricalProbability(digits, direction, barrier);
