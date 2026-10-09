import { makeAutoObservable } from 'mobx';

export class QuickStrategyStore {
    is_open = false;

    constructor() {
        makeAutoObservable(this);
    }

    setOpen(open: boolean) {
        this.is_open = open;
    }
}
