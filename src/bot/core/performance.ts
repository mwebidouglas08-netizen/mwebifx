import { CategoryPerf, PerformanceSnapshot, TradeRecord } from './types';

const emptyPerf = (): CategoryPerf => ({ trades: 0, wins: 0, net: 0 });

export const computePerformance = (trades: TradeRecord[]): PerformanceSnapshot => {
    const settled = trades.filter(t => t.stage === 'settled' && typeof t.profit === 'number');
    let wins = 0;
    let losses = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let expectedValueSum = 0;
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let runningWin = 0;
    let runningLoss = 0;
    const byCategory: Record<string, CategoryPerf> = {};
    const byBarrier: Record<string, CategoryPerf> = {};
    let peak = 0;
    let trough = 0;
    let equity = 0;
    let maxDrawdown = 0;

    for (const t of settled) {
        const profit = t.profit ?? 0;
        equity += profit;
        if (equity > peak) peak = equity;
        if (equity - peak < -maxDrawdown) maxDrawdown = peak - equity;
        trough = Math.min(trough, equity);

        expectedValueSum += t.expectedValue ?? 0;
        if (t.result === 'win') {
            wins += 1;
            grossProfit += profit;
            consecutiveLosses = 0;
            consecutiveWins += 1;
            runningWin += 1;
            maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
        } else {
            losses += 1;
            grossLoss += profit;
            consecutiveWins = 0;
            consecutiveLosses += 1;
            runningLoss += 1;
            maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
        }

        const catKey = t.category || 'other';
        byCategory[catKey] = byCategory[catKey] || emptyPerf();
        byCategory[catKey].trades += 1;
        byCategory[catKey].wins += t.result === 'win' ? 1 : 0;
        byCategory[catKey].net += profit;

        const barKey = `${t.direction} ${t.barrier}`;
        byBarrier[barKey] = byBarrier[barKey] || emptyPerf();
        byBarrier[barKey].trades += 1;
        byBarrier[barKey].wins += t.result === 'win' ? 1 : 0;
        byBarrier[barKey].net += profit;
    }

    void runningWin;
    void runningLoss;
    const total = wins + losses;
    const netProfit = grossProfit + grossLoss;
    return {
        totalTrades: total,
        wins,
        losses,
        winRate: total ? wins / total : 0,
        grossProfit,
        grossLoss,
        netProfit,
        avgWin: wins ? grossProfit / wins : 0,
        avgLoss: losses ? grossLoss / losses : 0,
        expectedValuePerTrade: total ? expectedValueSum / total : 0,
        profitFactor: grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : 0,
        maxDrawdown: Math.abs(maxDrawdown),
        maxConsecutiveWins,
        maxConsecutiveLosses,
        byCategory,
        byBarrier,
    };
};

export const emptyPerformance = (): PerformanceSnapshot => ({
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    grossProfit: 0,
    grossLoss: 0,
    netProfit: 0,
    avgWin: 0,
    avgLoss: 0,
    expectedValuePerTrade: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    byCategory: {},
    byBarrier: {},
});
