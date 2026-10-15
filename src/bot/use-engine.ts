import { useEffect, useMemo, useState } from 'react';
import { ouBotEngine, EngineState } from './engine/engine';
import { signalScanner, SignalScannerState } from './engine/signal-scanner';
import { aiBot, AIBotState } from './engine/ai-bot';
import { bulkTrader, BulkTraderState } from './engine/bulk-trader';
import { copyTrading, CopyTradingState } from './engine/copy-trading';
import { algoProEngine, AlgoProState } from './engine/algo-pro-ai';

export const useOUBotEngine = (): EngineState => {
    const [state, setState] = useState<EngineState>(() => ouBotEngine.getState());

    useEffect(() => ouBotEngine.subscribe(setState), []);

    return state;
};

export const useOUPerformance = () => {
    const state = useOUBotEngine();
    return useMemo(() => {
        const snapshot = ouBotEngine.getPerformance();
        void state;
        return snapshot;
    }, [state.trades]);
};

export const useSignalScanner = (): SignalScannerState => {
    const [state, setState] = useState<SignalScannerState>(() => signalScanner.getState());

    useEffect(() => signalScanner.subscribe(setState), []);

    return state;
};

export const useScannerPerformance = () => {
    const state = useSignalScanner();
    return useMemo(() => {
        const snapshot = signalScanner.getPerformance();
        void state;
        return snapshot;
    }, [state.trades]);
};

export const useAIBot = (): AIBotState => {
    const [state, setState] = useState<AIBotState>(() => aiBot.getState());

    useEffect(() => aiBot.subscribe(setState), []);

    return state;
};

export const useAIPerformance = () => {
    const state = useAIBot();
    return useMemo(() => {
        const snapshot = aiBot.getPerformance();
        void state;
        return snapshot;
    }, [state.trades]);
};

export const useBulkTrader = (): BulkTraderState => {
    const [state, setState] = useState<BulkTraderState>(() => bulkTrader.getState());

    useEffect(() => bulkTrader.subscribe(setState), []);

    return state;
};

export const useCopyTrading = (): CopyTradingState => {
    const [state, setState] = useState<CopyTradingState>(() => copyTrading.getState());

    useEffect(() => copyTrading.subscribe(setState), []);

    return state;
};

export const useAlgoProAi = (): AlgoProState => {
    const [state, setState] = useState<AlgoProState>(() => algoProEngine.getState());

    useEffect(() => algoProEngine.subscribe(setState), []);

    return state;
};

export const useAlgoProPerformance = () => {
    const state = useAlgoProAi();
    return useMemo(() => {
        const snapshot = algoProEngine.getPerformance();
        void state;
        return snapshot;
    }, [state.trades, state.totalProfit]);
};
