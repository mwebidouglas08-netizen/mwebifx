export const navigateToTransfer = (currency?: string) => {
    const params = currency ? `?currency=${currency}` : '';
    window.location.href = `/account/transfer${params}`;
};
