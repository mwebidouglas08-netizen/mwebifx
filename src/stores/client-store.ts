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

    constructor() {
        makeAutoObservable(this);
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
