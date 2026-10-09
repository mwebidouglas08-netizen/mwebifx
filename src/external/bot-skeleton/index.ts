export const api_base = {
    api: null as null | { onMessage: () => { subscribe: () => { unsubscribe: () => void } } },
    account_info: {} as Record<string, unknown>,
    is_running: false,
    init: async (_is_authenticated?: boolean) => {
        api_base.api = {
            onMessage: () => ({
                subscribe: () => ({ unsubscribe: () => {} }),
            }),
        };
    },
};

export class ApiHelpers {
    static instance: ApiHelpers;
    active_symbols = {
        retrieveActiveSymbols: () => Promise.resolve(),
    };
    trading_times = {
        initialise: () => Promise.resolve(),
        trading_times: null as unknown,
        setTradingTimes: () => {},
    };
}

export const ServerTime = {
    init: (common: { setServerTime: (time: any, is_stale: boolean) => void }) => {
        common.setServerTime(new Date(), false);
    },
};

export const timeSince = (date: string): string => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
};

export const getUrlBase = (path: string): string => path;
