export const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const retry = async <T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> => {
    try {
        return await fn();
    } catch (error) {
        if (retries <= 1) throw error;
        await delay(delayMs);
        return retry(fn, retries - 1, delayMs);
    }
};

export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
    ]);
};
