export class DerivWSAccountsService {
    static async fetchAccountsList(_token: string): Promise<any[]> {
        return [];
    }

    static storeAccounts(accounts: any[]): void {
        localStorage.setItem('accounts_list', JSON.stringify(accounts));
    }

    static async getAuthenticatedWebSocketURL(token: string): Promise<string> {
        return `wss://ws.derivws.com/websockets/v3?app_id=1089&l=EN&brand=deriv&token=${token}`;
    }
}
