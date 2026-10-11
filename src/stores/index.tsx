import React, { createContext, useContext } from 'react';
import Bot from '@/external/bot-skeleton/scratch/dbot';
import RootStore from './root-store';

export { RootStore };

export const rootStore = new RootStore(Bot);

const StoreContext = createContext<RootStore | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode; mockStore?: RootStore }> = ({
    children,
    mockStore,
}) => {
    return <StoreContext.Provider value={mockStore ?? rootStore}>{children}</StoreContext.Provider>;
};

export const useStore = (): RootStore | null => useContext(StoreContext);

export const mockStore = (_ws?: unknown): RootStore => new RootStore(Bot);
