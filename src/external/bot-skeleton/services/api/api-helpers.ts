class ApiHelpers {
    static instance: ApiHelpers;
    active_symbols = {
        retrieveActiveSymbols: () => Promise.resolve([]),
        active_symbols: [] as unknown[],
    };
    trading_times = {
        initialise: () => Promise.resolve(),
        trading_times: null as unknown,
        setTradingTimes: () => {},
    };
}

export default ApiHelpers;
