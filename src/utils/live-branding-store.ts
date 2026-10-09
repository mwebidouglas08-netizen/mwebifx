type Listener = (value: any) => void;

const listeners: Record<string, Listener[]> = {};

const notify = (key: string, value: any) => {
    (listeners[key] || []).forEach(fn => fn(value));
};

const subscribe = (key: string, listener: Listener) => {
    if (!listeners[key]) listeners[key] = [];
    listeners[key].push(listener);
    return () => {
        listeners[key] = listeners[key].filter(l => l !== listener);
    };
};

const getPreviewLogo = (): string | null => localStorage.getItem('preview_logo');

export const getPreviewLogo = getPreviewLogo;
export const subscribePreviewLogo = (listener: Listener) => subscribe('preview_logo', listener);

const getPreviewAppName = (): string | null => localStorage.getItem('preview_app_name');

export const getPreviewAppName = getPreviewAppName;
export const subscribePreviewAppName = (listener: Listener) => subscribe('preview_app_name', listener);

const getPreviewShowAppName = (): boolean => localStorage.getItem('preview_show_app_name') === 'true';

export const getPreviewShowAppName = getPreviewShowAppName;
export const subscribePreviewShowAppName = (listener: Listener) =>
    subscribe('preview_show_app_name', listener);
