export const clearInvalidTokenParams = () => {
    const url = new URL(window.location.href);
    ['token', 'token1', 'token2', 'token3'].forEach(param => url.searchParams.delete(param));
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
};
