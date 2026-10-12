import { useEffect, useMemo, useState } from 'react';
import { ouBotEngine, EngineState } from './engine/engine';

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
