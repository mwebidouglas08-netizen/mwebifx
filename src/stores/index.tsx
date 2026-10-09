import React, { createContext, useContext } from 'react';
import { ClientStore } from './client-store';
import { CommonStore } from './common-store';
import { AppStore } from './app-store';
import { TransactionsStore } from './transactions-store';
import { QuickStrategyStore } from './quick-strategy-store';
import { UiStore } from './ui-store';
import { DashboardStore } from './dashboard-store';
import { BlocklyStore } from './blockly-store';
import { LoadModalStore } from './load-modal-store';
import { GoogleDriveStore } from './google-drive-store';
import { JournalStore } from './journal-store';
import { RunPanelStore } from './run-panel-store';
import { FlyoutStore } from './flyout-store';
import { FlyoutHelpStore } from './flyout-help-store';

export class RootStore {
    client: ClientStore;
    common: CommonStore;
    app: AppStore;
    transactions: TransactionsStore;
    quick_strategy: QuickStrategyStore;
    ui: UiStore;
    dashboard: DashboardStore;
    blockly_store: BlocklyStore;
    load_modal: LoadModalStore;
    google_drive: GoogleDriveStore;
    journal: JournalStore;
    run_panel: RunPanelStore;
    flyout: FlyoutStore;
    flyout_help: FlyoutHelpStore;

    constructor() {
        this.client = new ClientStore();
        this.common = new CommonStore();
        this.app = new AppStore();
        this.transactions = new TransactionsStore();
        this.quick_strategy = new QuickStrategyStore();
        this.ui = new UiStore();
        this.dashboard = new DashboardStore();
        this.blockly_store = new BlocklyStore();
        this.load_modal = new LoadModalStore();
        this.google_drive = new GoogleDriveStore();
        this.journal = new JournalStore();
        this.run_panel = new RunPanelStore();
        this.flyout = new FlyoutStore();
        this.flyout_help = new FlyoutHelpStore();
    }
}

export const rootStore = new RootStore();

const StoreContext = createContext<RootStore | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return <StoreContext.Provider value={rootStore}>{children}</StoreContext.Provider>;
};

export const useStore = (): RootStore | null => useContext(StoreContext);
