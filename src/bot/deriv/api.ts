import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export interface ApiResult<T = any> {
    data?: T;
    error?: { code?: string; message?: string; [k: string]: any };
}

export const isApiReady = (): boolean =>
    Boolean(api_base.api && api_base.api.connection && (api_base.api.connection as any).readyState === 1);

export const isAuthorized = (): boolean => Boolean(api_base.is_authorized);

export const currentLoginId = (): string => api_base.account_id || '';

export const accountBalance = (): number => {
    const info = api_base.account_info as any;
    const b = info?.balance;
    return typeof b === 'number' ? b : Number(b) || 0;
};

export const accountCurrency = (): string => {
    const info = api_base.account_info as any;
    return info?.currency || 'USD';
};

export const request = async <T = any>(
    payload: Record<string, unknown>,
    timeoutMs = 15000
): Promise<ApiResult<T>> => {
    const api = api_base.api as any;
    if (!api) return { error: { code: 'NoConnection', message: 'No Deriv API connection' } };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
    });

    try {
        const response = (await Promise.race([api.send(payload), timeout])) as T & {
            error?: { code?: string; message?: string };
        };
        if (timer) clearTimeout(timer);
        if (response && (response as any).error) {
            return { error: (response as any).error };
        }
        return { data: response };
    } catch (e: any) {
        if (timer) clearTimeout(timer);
        return {
            error: { code: e?.code || 'RequestFailed', message: e?.message || String(e) },
        };
    }
};

export const getActiveSymbols = async (): Promise<any[]> => {
    const { data, error } = await request<{ active_symbols?: any[] }>({ active_symbols: 'brief' }, 20000);
    if (error) throw new Error(error.message || 'Failed to fetch active symbols');
    return data?.active_symbols || [];
};

export const getContractsFor = async (symbol: string): Promise<any[]> => {
    const { data, error } = await request<{ contracts_for?: { available?: any[] } }>(
        { contracts_for: symbol },
        20000
    );
    if (error) throw new Error(error.message || `Failed to fetch contracts for ${symbol}`);
    return data?.contracts_for?.available || [];
};

export const getProposal = async (params: Record<string, unknown>): Promise<ApiResult<any>> =>
    request<any>({ ...params, proposal: 1 }, 12000);

export const buyContract = async (proposalId: string, price: number): Promise<ApiResult<any>> =>
    request<any>({ buy: proposalId, price }, 15000);

export const getOpenContract = async (contractId: number): Promise<ApiResult<any>> =>
    request<any>({ proposal_open_contract: 1, contract_id: contractId }, 12000);

export const getTicksHistory = async (
    symbol: string,
    count: number,
    end: 'latest' = 'latest'
): Promise<any> => {
    const { data, error } = await request<any>(
        { ticks_history: symbol, count, end, style: 'ticks' },
        20000
    );
    if (error) throw new Error(error.message || `Failed to fetch ticks for ${symbol}`);
    return data;
};
