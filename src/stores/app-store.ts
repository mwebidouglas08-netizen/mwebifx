import { makeAutoObservable } from 'mobx';

export class AppStore {
    api_helpers_store: any = null;

    constructor() {
        makeAutoObservable(this, undefined, { autoBind: true });
    }

    setDBotEngineStores() {
        this.api_helpers_store = {
            active_symbols: {
                retrieveActiveSymbols: (_force = false) => Promise.resolve(),
            },
        };
    }
}
