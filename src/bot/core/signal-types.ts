import { MarketCategory } from './types';

export type ContractFamily = 'rise_fall' | 'even_odd' | 'over_under' | 'match_differ';

export type SignalAction = 'CALL' | 'PUT' | 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'MATCH' | 'DIFFER';

export const FAMILY_LABEL: Record<ContractFamily, string> = {
    rise_fall: 'Rise / Fall',
    even_odd: 'Even / Odd',
    over_under: 'Over / Under',
    match_differ: 'Match / Differ',
};

export const ACTION_LABEL: Record<SignalAction, string> = {
    CALL: 'Rise',
    PUT: 'Fall',
    EVEN: 'Even',
    ODD: 'Odd',
    OVER: 'Over',
    UNDER: 'Under',
    MATCH: 'Match',
    DIFFER: 'Differ',
};

export const ACTION_CONTRACT_TYPE: Record<SignalAction, string> = {
    CALL: 'CALL',
    PUT: 'PUT',
    EVEN: 'DIGITEVEN',
    ODD: 'DIGITODD',
    OVER: 'DIGITOVER',
    UNDER: 'DIGITUNDER',
    MATCH: 'DIGITMATCH',
    DIFFER: 'DIGITDIFF',
};

export interface Signal {
    id: string;
    at: number;
    symbol: string;
    displayName: string;
    category: MarketCategory;
    family: ContractFamily;
    action: SignalAction;
    contractType: string;
    barrier?: number;
    strength: number;
    confidence: number;
    sampleSize: number;
    rationale: string;
}

export interface SignalScannerConfig {
    families: ContractFamily[];
    sampleSize: number;
    threshold: number;
    overBarrier: number;
    underBarrier: number;
    matchDigit: number;
    stake: number;
    duration: number;
    durationUnit: string;
    maxStake: number;
    maxDailyLoss: number;
    maxConsecutiveLosses: number;
    maxOpenPositions: number;
    scanIntervalMs: number;
    minTicks: number;
    autoTrade: boolean;
    allowLiveTrading: boolean;
    martingale: boolean;
    martingaleFactor: number;
    martingaleMaxSteps: number;
}

export type ScannerStatus =
    | 'idle'
    | 'discovering'
    | 'warming'
    | 'scanning'
    | 'proposing'
    | 'buying'
    | 'monitoring'
    | 'suspended'
    | 'stopped'
    | 'error';

export type ScannerEventType =
    | 'status'
    | 'discover'
    | 'scan'
    | 'signal'
    | 'quote'
    | 'purchase'
    | 'settlement'
    | 'risk'
    | 'error';

export interface ScannerEvent {
    id: string;
    at: number;
    type: ScannerEventType;
    message: string;
    symbol?: string;
    contractId?: number;
    action?: SignalAction;
    profit?: number;
    result?: 'win' | 'loss';
}

export interface MarketScan {
    symbol: string;
    displayName: string;
    category: MarketCategory;
    sampleSize: number;
    lastQuote: number;
    even: number;
    odd: number;
    over: number;
    under: number;
    overBarrier: number;
    rise: number;
    fall: number;
    match: number;
    differ: number;
    matchDigit: number;
    mostFreqDigit: number;
    leastFreqDigit: number;
    rsi: number;
    trend: string;
    strongest: number;
    stale: boolean;
}
