const chart_api = {
    api: null as null | {
        send: (request: any) => Promise<any>;
        onMessage: () => { subscribe: () => { unsubscribe: () => void } };
        forget: (id: string) => void;
        forgetAll: (msgType?: string) => void;
    },
    init: async () => {
        chart_api.api = {
            send: () => Promise.resolve({}),
            onMessage: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
            forget: () => {},
            forgetAll: () => {},
        };
    },
};

export default chart_api;
