/**
 * Types for the independent AI Bot — a rule-based digit trading bot that
 * mirrors popular third-party bots (e.g. "Quantum Edge AI", "Vertex Digits").
 *
 * The decision model is faithful to those bots: an ordered list of purchase
 * rules evaluated against live digit/quote analysis. Each rule fires when its
 * analysis condition matches and produces a contract to buy (with an optional
 * barrier/prediction). The first matching enabled rule wins.
 */

export type AnalysisMode = 'pattern' | 'percentage';
export type ScanMode = 'always' | 'every_n' | 'on_entry';
export type AnalysisType = 'last_digits' | 'all_even' | 'all_odd' | 'percentage';
export type Comparison = 'greater_or_equal' | 'less_or_equal';
export type PercentageType = 'rise' | 'fall' | 'odd' | 'even' | 'over' | 'under';
export type RuleLogic = 'if' | 'else_if';

/** Contract types the AI Bot can purchase. */
export type PurchaseType =
    | 'DIGITOVER'
    | 'DIGITUNDER'
    | 'DIGITEVEN'
    | 'DIGITODD'
    | 'DIGITMATCH'
    | 'DIGITDIFF'
    | 'CALL'
    | 'PUT';

export interface PurchaseRule {
    id: string;
    enabled: boolean;
    logic: RuleLogic;
    analysisMode: AnalysisMode;
    analysisType: AnalysisType;
    /** Number of recent samples the pattern applies to (e.g. last N digits). */
    count: number;
    /** Comparison operator for `last_digits`. */
    operator?: Comparison;
    /** Threshold digit for `last_digits` (0-9) and barrier source for over/under %s. */
    digit?: number;
    /** Which percentage to read for `percentage` rules. */
    percentageType?: PercentageType;
    /** Threshold the percentage must meet (55 = 55%). */
    percentageThreshold?: number;
    /** Sample window for the percentage. */
    sampleSize?: number;
    comparison?: Comparison;
    purchase: PurchaseType;
    /** Barrier/prediction for over/under/match/differ (0-9). */
    prediction?: number;
}

export interface AIBotConfig {
    /** Symbols to scan (the bot watches all of them). */
    symbols: string[];
    /** Fallback contract type when no rule specifies one. */
    contractType: PurchaseType;
    /** Fallback prediction/barrier (0-9). */
    prediction: number;
    analysisMode: AnalysisMode;
    scanMode: ScanMode;
    /** For `every_n`: only trade every Nth qualifying decision. */
    scanTradeCount: number;
    /** Ordered initial purchase rules. */
    rules: PurchaseRule[];
    /** Recovery mode swaps to recovery rules after a loss (optional). */
    recoveryEnabled: boolean;
    recoveryRules: PurchaseRule[];
    recoveryContractType: PurchaseType;
    martingaleEnabled: boolean;
    martingaleMultiplier: number;
    stake: number;
    maxStake: number;
    duration: number;
    durationUnit: string;
    /** Stop the session after losing this much (currency units). */
    stopLoss: number;
    /** Stop the session after profiting this much (currency units). */
    takeProfit: number;
    /** 0 = unlimited trades. */
    maxTrades: number;
    sampleSize: number;
    minTicks: number;
    autoTrade: boolean;
    allowLiveTrading: boolean;
    scanIntervalMs: number;
    /** Require a rule to match on this many consecutive scans before trading. */
    confirmScans: number;
}

export interface RuleMatch {
    rule: PurchaseRule;
    contractType: PurchaseType;
    prediction?: number;
    rationale: string;
}

/** Per-symbol live analysis snapshot surfaced in the AI Bot panel. */
export interface MarketAnalysis {
    symbol: string;
    displayName: string;
    sampleSize: number;
    lastDigits: number[];
    even: number;
    odd: number;
    over: number;
    under: number;
    rise: number;
    fall: number;
    overBarrier: number;
    underBarrier: number;
    matchedRuleId?: string;
    matchedContractType?: PurchaseType;
    rationale?: string;
}

export type AIBotStatus =
    | 'idle'
    | 'starting'
    | 'scanning'
    | 'proposing'
    | 'buying'
    | 'monitoring'
    | 'suspended'
    | 'stopped'
    | 'error';

export interface AIBotEvent {
    id: string;
    at: number;
    type: 'status' | 'scan' | 'decision' | 'quote' | 'purchase' | 'settlement' | 'risk' | 'error';
    message: string;
    symbol?: string;
    contractId?: number;
    result?: 'win' | 'loss';
    profit?: number;
    contractType?: string;
}

export const PURCHASE_LABEL: Record<PurchaseType, string> = {
    DIGITOVER: 'Digit Over',
    DIGITUNDER: 'Digit Under',
    DIGITEVEN: 'Digit Even',
    DIGITODD: 'Digit Odd',
    DIGITMATCH: 'Digit Match',
    DIGITDIFF: 'Digit Differs',
    CALL: 'Rise',
    PUT: 'Fall',
};
