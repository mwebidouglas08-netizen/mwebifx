import { makeAutoObservable } from 'mobx';

export class BlocklyStore {
    is_loading = false;

    constructor() {
        makeAutoObservable(this, undefined, { autoBind: true });
    }

    setLoading(value: boolean) {
        this.is_loading = value;
    }
}
