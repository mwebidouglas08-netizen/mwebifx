import React, { createContext, useContext } from 'react';
import { ClientStore } from './client-store';
import { CommonStore } from './common-store';
import { AppStore } from './app-store';
import { TransactionsStore } from './transactions-store';
import { QuickStrategyStore } from './quick-strategy-store';

export class RootStore {
    client: ClientStore;
    common: CommonStore;
    app: AppStore;
    transactions: TransactionsStore;
    quick_strategy: QuickStrategyStore;

    constructor() {
        this.client = new ClientStore();
        this.common = new CommonStore();
        this.app = new AppStore();
        this.transactions = new TransactionsStore();
        this.quick_strategy = new QuickStrategyStore();
    }
}

export const rootStore = new RootStore();

const StoreContext = createContext<RootStore | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return <StoreContext.Provider value={rootStore}>{children}</StoreContext.Provider>;
};

export const useStore = (): RootStore | null => useContext(StoreContext);
