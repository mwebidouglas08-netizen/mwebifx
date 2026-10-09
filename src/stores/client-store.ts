import { makeAutoObservable } from 'mobx';

export class ClientStore {
    is_logged_in = false;
    loginid = '';
    currency = '';
    balance = '0';
    email = '';
    residence = '';
    first_name = '';
    last_name = '';
    account_list: Record<string, any> = {};
    user_id: string | number | null = null;
    is_account_regenerating = false;
    all_accounts_balance: Record<string, any> = {};
    is_logging_out = false;
    should_hide_header = false;

    constructor() {
        makeAutoObservable(this, undefined, { autoBind: true });
    }

    setLoginId(loginid: string) {
        this.loginid = loginid;
    }

    setAccountList(list: Record<string, any>) {
        this.account_list = list;
    }

    setIsLoggedIn(value: boolean) {
        this.is_logged_in = value;
    }

    setBalance(balance: string) {
        this.balance = balance;
    }

    setCurrency(currency: string) {
        this.currency = currency;
    }

    setEmail(email: string) {
        this.email = email;
    }

    setResidence(residence: string) {
        this.residence = residence;
    }

    setFirstName(name: string) {
        this.first_name = name;
    }

    setLastName(name: string) {
        this.last_name = name;
    }

    setUserId(id: string | number) {
        this.user_id = id;
    }

    setIsAccountRegenerating(value: boolean) {
        this.is_account_regenerating = value;
    }

    setAllAccountsBalance(balances: Record<string, any>) {
        this.all_accounts_balance = balances;
    }

    setIsLoggingOut(value: boolean) {
        this.is_logging_out = value;
    }

    setShouldHideHeader(value: boolean) {
        this.should_hide_header = value;
    }

    checkAndRegenerateWebSocket() {
        // no-op stub
    }

    logout() {
        this.is_logged_in = false;
        this.loginid = '';
        this.currency = '';
        this.balance = '0';
        this.email = '';
        this.residence = '';
        this.first_name = '';
        this.last_name = '';
        this.account_list = {};
        this.user_id = null;
    }
}
