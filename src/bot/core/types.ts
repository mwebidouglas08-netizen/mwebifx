export type MarketCategory =
    | 'volatility'
    | 'crash'
    | 'boom'
    | 'jump'
    | 'step'
    | 'range'
    | 'other';

export type Direction = 'over' | 'under';

export type EngineStatus =
    | 'idle'
    | 'discovering'
    | 'warming'
    | 'scanning'
    | 'proposing'
    | 'awaiting-approval'
    | 'buying'
    | 'monitoring'
    | 'suspended'
    | 'stopped'
    | 'error';

export type TradeStage =
    | 'detected'
    | 'proposed'
    | 'submitted'
    | 'confirmed'
    | 'settled'
    | 'rejected';

export interface SyntheticSymbol {
    symbol: string;
    displayName: string;
    market: string;
    submarket: string;
    category: MarketCategory;
    pip: number;
    pipSize: number;
    exchangeIsOpen: boolean;
    isSuspended: boolean;
}

export interface DigitBarrier {
    direction: Direction;
    barrier: number;
    contractType: 'DIGITOVER' | 'DIGITUNDER';
}

export interface AvailableContract {
    contractType: 'DIGITOVER' | 'DIGITUNDER';
    barriers: number[];
    minStake?: number;
    maxStake?: number;
    minDuration?: number;
    maxDuration?: number;
    durationUnits?: string[];
}

export interface TickPoint {
    epoch: number;
    quote: number;
    digit: number;
}

export interface DigitStats {
    sampleSize: number;
    counts: number[];
    frequencies: number[];
    expected: number;
    chiSquare: number;
    pValue: number;
    isUniform: boolean;
    significant: boolean;
}

export interface ContractOpportunity {
    symbol: string;
    displayName: string;
    category: MarketCategory;
    contractType: 'DIGITOVER' | 'DIGITUNDER';
    direction: Direction;
    barrier: number;
    duration: number;
    durationUnit: string;
    stake: number;
    payout: number;
    payoutRatio: number;
    empiricalProb: number;
    theoreticalProb: number;
    edge: number;
    expectedValue: number;
    expectedValuePct: number;
    confidence: number;
    sampleSize: number;
    digitStats: DigitStats;
    quoteId?: string;
    longcode?: string;
    detectedAt: number;
}

export interface TradeRecord {
    id: string;
    contractId?: number;
    transactionId?: number;
    symbol: string;
    displayName: string;
    category: MarketCategory;
    contractType: 'DIGITOVER' | 'DIGITUNDER';
    direction: Direction;
    barrier: number;
    duration: number;
    durationUnit: string;
    stake: number;
    payout: number;
    payoutRatio: number;
    empiricalProb: number;
    expectedValue: number;
    confidence: number;
    entryEpoch?: number;
    exitEpoch?: number;
    entryTick?: number;
    exitTick?: number;
    exitDigit?: number;
    stage: TradeStage;
    result?: 'win' | 'loss';
    profit?: number;
    openedAt: number;
    closedAt?: number;
    error?: string;
    simulated: boolean;
}

export interface RiskLimits {
    maxStake: number;
    maxStakePctEquity: number;
    maxDailyLoss: number;
    maxTotalDrawdown: number;
    maxConsecutiveLosses: number;
    maxOpenPositions: number;
    maxTradesPerSession: number;
    minExpectedValue: number;
    minPayoutRatio: number;
    minConfidence: number;
    minSampleSize: number;
    cooldownAfterLosses: number;
    cooldownMs: number;
}

export interface RiskState {
    suspended: boolean;
    suspensionReason: string | null;
    suspendedAt: number | null;
    consecutiveLosses: number;
    dailyPnl: number;
    peakEquity: number;
    drawdown: number;
    tradesThisSession: number;
    lastLossAt: number | null;
    openPositions: number;
}

export interface EngineConfig {
    symbols: string[];
    categories: MarketCategory[];
    directions: Direction[];
    barriersOver: number[];
    barriersUnder: number[];
    stake: number;
    duration: number;
    durationUnit: string;
    limits: RiskLimits;
    scanIntervalMs: number;
    minTicksForAnalysis: number;
    allowLiveTrading: boolean;
}

export interface Opportunity {
    opportunity: ContractOpportunity;
}

export interface PerformanceSnapshot {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    grossProfit: number;
    grossLoss: number;
    netProfit: number;
    avgWin: number;
    avgLoss: number;
    expectedValuePerTrade: number;
    profitFactor: number;
    maxDrawdown: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    byCategory: Record<string, CategoryPerf>;
    byBarrier: Record<string, CategoryPerf>;
}

export interface CategoryPerf {
    trades: number;
    wins: number;
    net: number;
}
