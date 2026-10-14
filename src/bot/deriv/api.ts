import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export interface ApiResult<T = any> {
    data?: T;
    error?: { code?: string; message?: string; [k: string]: any };
}

export const isApiReady = (): boolean =>
    Boolean(api_base.api && api_base.api.connection && (api_base.api.connection as any).readyState === 1);

export const isAuthorized = (): boolean => Boolean(api_base.is_authorized);

export const currentLoginId = (): string => api_base.account_id || '';

/** Identity of the live Deriv socket — proposal ids are connection-scoped, so a
 * quote issued before a socket regeneration can no longer be bought afterwards. */
export const currentSocket = (): unknown => api_base.api;

export const accountBalance = (): number => {
    const info = api_base.account_info as any;
    const b = info?.balance;
    return typeof b === 'number' ? b : Number(b) || 0;
};

export const accountCurrency = (): string => {
    const info = api_base.account_info as any;
    return info?.currency || 'USD';
};

const stringifyError = (value: unknown): string => {
    try {
        const json = JSON.stringify(value);
        if (json && json !== '{}') return json;
    } catch {
        /* circular or non-serializable — fall through */
    }
    return String(value);
};

const extractError = (e: any): { code: string; message: string } => {
    if (typeof e === 'string') return { code: 'RequestFailed', message: e };
    if (e instanceof Error) return { code: (e as any).code || 'RequestFailed', message: e.message };
    if (typeof e?.error === 'string') return { code: String(e?.code || 'RequestFailed'), message: e.error };
    const inner = e?.error && typeof e.error === 'object' ? e.error : e?.data?.error && typeof e.data.error === 'object' ? e.data.error : e;
    const code = inner?.code || e?.code || 'RequestFailed';
    const message = inner?.message || e?.message || stringifyError(e);
    return { code: String(code), message: String(message || 'Request failed') };
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
        return { error: extractError(e) };
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

export interface LiveRequest {
    data?: any;
    /** Server errors may omit code/message depending on the request path. */
    error?: { code?: string; message?: string };
    /** Detach from the live stream; the server forgets the subscription. */
    release: () => void;
}

/**
 * Request that must keep its server-side subscription alive (proposals).
 *
 * On the trading/v1 socket a one-shot `proposal` id is not purchasable by the
 * time `buy` is issued - the server answers "Unknown contract proposal"
 * (InvalidContractProposal) even for a brand-new id on the same connection.
 * Deriv's own bots buy against a SUBSCRIBED proposal (`subscribe: 1`): the id
 * then stays valid and the stream refreshes `ask_price` until we let go. The
 * deriv-api client manages that stream through `api.subscribe()` and forgets
 * the subscription when the last observer detaches.
 */
export const requestLive = async (
    payload: Record<string, unknown>,
    timeoutMs = 12000
): Promise<LiveRequest> => {
    const api = api_base.api as any;
    if (!api) {
        return {
            error: { code: 'NoConnection', message: 'No Deriv API connection' },
            release: () => undefined,
        };
    }
    if (typeof api.subscribe !== 'function') {
        const res = await request<any>(payload, timeoutMs);
        return { ...res, release: () => undefined };
    }
    return new Promise<LiveRequest>(resolve => {
        let settled = false;
        let observer: { unsubscribe?: () => void } | null = null;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            try {
                observer?.unsubscribe?.();
            } catch {
                /* observer already torn down */
            }
        };
        const done = (outcome: { data?: any; error?: { code: string; message: string } }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ ...outcome, release });
        };
        const timer = setTimeout(() => {
            release();
            done({ error: { code: 'RequestTimeout', message: 'Request timeout' } });
        }, timeoutMs);
        try {
            observer = api.subscribe(payload).subscribe({
                next: (msg: any) => {
                    if (settled) return;
                    if (msg?.error) {
                        release();
                        done({ error: msg.error });
                        return;
                    }
                    done({ data: msg });
                },
                error: (err: any) => {
                    release();
                    done({ error: extractError(err) });
                },
            });
        } catch (e: any) {
            done({ error: extractError(e) });
        }
    });
};

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
