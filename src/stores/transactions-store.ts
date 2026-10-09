import { makeAutoObservable } from 'mobx';

export class TransactionsStore {
    recovered_transactions: any[] = [];
    transactions: any[] = [];
    statistics = {
        total_payout: 0,
        total_profit: 0,
        total_stake: 0,
        won_contracts: 0,
        lost_contracts: 0,
        number_of_runs: 0,
    };

    constructor() {
        makeAutoObservable(this);
    }

    recoverPendingContracts(contract: any) {
        if (contract && !this.recovered_transactions.find((t: any) => t.contract_id === contract.contract_id)) {
            this.recovered_transactions.push(contract);
        }
    }
}
