import { useEffect, useMemo, useState } from 'react';
import { ouBotEngine, EngineState } from './engine/engine';
import { signalScanner, SignalScannerState } from './engine/signal-scanner';
import { aiBot, AIBotState } from './engine/ai-bot';

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
