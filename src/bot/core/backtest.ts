import { Direction } from './types';
import { empiricalProbability, theoreticalProbability } from './digit-stats';
import { computeExpectedValuePct } from './ev';

export interface BacktestParams {
    direction: Direction;
    barrier: number;
    payoutRatio: number;
    stake: number;
    lookback: number;
    minSample: number;
    minEvPct: number;
}

export interface BacktestTrade {
    index: number;
    digit: number;
    won: boolean;
    profit: number;
    empiricalProb: number;
    evPct: number;
}

export interface BacktestResult {
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    netProfit: number;
    profitFactor: number;
    maxDrawdown: number;
    maxConsecutiveLosses: number;
    expectedValuePerTrade: number;
    takeRate: number;
}

export const simulateOverUnder = (
    digits: number[],
    params: BacktestParams
): BacktestResult => {
    const { direction, barrier, payoutRatio, stake, lookback, minSample, minEvPct } = params;
    const theoretical = theoreticalProbability(direction, barrier);
    const trades: BacktestTrade[] = [];
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveLosses = 0;

    for (let i = lookback; i < digits.length; i++) {
        const window = digits.slice(i - lookback, i);
        const empirical = empiricalProbability(window, direction, barrier);
        if (window.length < minSample) continue;
        const evPct = computeExpectedValuePct(empirical, payoutRatio);
        if (empirical <= theoretical || evPct < minEvPct) continue;

        const digit = digits[i];
        const won = direction === 'over' ? digit > barrier : digit < barrier;
        const profit = won ? stake * (payoutRatio - 1) : -stake;
        equity += profit;
        if (equity > peak) peak = equity;
        if (peak - equity > maxDrawdown) maxDrawdown = peak - equity;
        if (won) consecutiveLosses = 0;
        else {
            consecutiveLosses += 1;
            if (consecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecutiveLosses;
        }
        trades.push({ index: i, digit, won, profit, empiricalProb: empirical, evPct });
    }

    const wins = trades.filter(t => t.won).length;
    const losses = trades.length - wins;
    const grossProfit = trades.filter(t => t.won).reduce((a, t) => a + t.profit, 0);
    const grossLoss = trades.filter(t => !t.won).reduce((a, t) => a + t.profit, 0);
    const net = grossProfit + grossLoss;
    return {
        trades: trades.length,
        wins,
        losses,
        winRate: trades.length ? wins / trades.length : 0,
        netProfit: net,
        profitFactor: grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : 0,
        maxDrawdown,
        maxConsecutiveLosses,
        expectedValuePerTrade: trades.length ? net / trades.length : 0,
        takeRate: digits.length - lookback ? trades.length / (digits.length - lookback) : 0,
    };
};

export interface OutOfSampleSplit {
    trainDigits: number[];
    testDigits: number[];
    splitAt: number;
}

export const chronologicalSplit = (digits: number[], trainRatio = 0.7): OutOfSampleSplit => {
    const splitAt = Math.floor(digits.length * trainRatio);
    return { trainDigits: digits.slice(0, splitAt), testDigits: digits.slice(splitAt), splitAt };
};

export interface ValidatedBacktest {
    train: BacktestResult;
    test: BacktestResult;
    isRobust: boolean;
    degradation: number;
}

export const validateOutOfSample = (
    digits: number[],
    params: BacktestParams,
    minTrainTrades = 20,
    maxDegradation = 0.6
): ValidatedBacktest => {
    const { trainDigits, testDigits } = chronologicalSplit(digits);
    const train = simulateOverUnder(trainDigits, params);
    const test = simulateOverUnder(testDigits, params);
    const trainEdge = train.trades ? train.netProfit / train.trades : 0;
    const testEdge = test.trades ? test.netProfit / test.trades : 0;
    const degradation = trainEdge > 0 ? 1 - testEdge / trainEdge : testEdge >= 0 ? 0 : 1;
    const isRobust =
        train.trades >= minTrainTrades &&
        test.trades >= 5 &&
        train.netProfit > 0 &&
        test.netProfit > 0 &&
        degradation <= maxDegradation;
    return { train, test, isRobust, degradation };
};
