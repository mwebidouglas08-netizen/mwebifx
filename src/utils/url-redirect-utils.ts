export const generateUrlWithRedirect = (url: string, redirectUrl?: string): string => {
    if (!redirectUrl) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}redirect_to=${encodeURIComponent(redirectUrl)}`;
};
