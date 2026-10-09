export const isForwardStarting = (shortcode: string, transactionTime?: number): boolean => {
    if (!shortcode) return false;
    const parts = shortcode.split('_');
    const isForward = parts.includes('FS') || shortcode.includes('FORWARD');
    if (!isForward) return false;
    if (transactionTime) {
        const startTime = parseInt(parts[3], 10);
        if (!isNaN(startTime) && transactionTime < startTime) return true;
    }
    return isForward;
};

export const parseShortcode = (shortcode: string): Record<string, string> => {
    if (!shortcode) return {};
    const parts = shortcode.split('_');
    return {
        contractType: parts[0] || '',
        symbol: parts[1] || '',
        payout: parts[2] || '',
        startTime: parts[3] || '',
        expiryTime: parts[4] || '',
    };
};
