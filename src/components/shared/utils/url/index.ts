export const getBaseUrl = (): string => `${window.location.protocol}//${window.location.host}`;

export const getFullUrl = (path: string): string => `${getBaseUrl()}${path}`;

export const addQueryParams = (url: string, params: Record<string, string>): string => {
    const separator = url.includes('?') ? '&' : '?';
    const queryString = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    return `${url}${separator}${queryString}`;
};

export const removeQueryParams = (url: string): string => url.split('?')[0];

// Restored from the original Deriv App Builder source (deleted in 956dcae).
// Used by app-content.jsx to set the smartcharts public path.
export const getUrlBase = (path = ''): string => {
    const l = window.location;

    if (!/^\/(br_)/.test(l.pathname)) return path;

    return `/${l.pathname.split('/')[1]}${/^\//.test(path) ? path : `/${path}`}`;
};
