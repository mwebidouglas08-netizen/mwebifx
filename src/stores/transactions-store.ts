import { makeAutoObservable } from 'mobx';

export class TransactionsStore {
    recovered_transactions: any[] = [];

    constructor() {
        makeAutoObservable(this);
    }

    recoverPendingContracts(contract: any) {
        if (contract && !this.recovered_transactions.find((t: any) => t.contract_id === contract.contract_id)) {
            this.recovered_transactions.push(contract);
        }
    }
}
