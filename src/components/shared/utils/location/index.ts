export const getLocation = () => window.location;

export const getHostname = () => window.location.hostname;

export const getOrigin = () => window.location.origin;

export const getPathname = () => window.location.pathname;

export const getSearch = () => window.location.search;

export const getHash = () => window.location.hash;

export const redirect = (url: string) => {
    window.location.href = url;
};

export const reload = () => window.location.reload();
