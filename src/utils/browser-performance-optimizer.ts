export const browserOptimizer = {
    isSafariBrowser: () => false,
    needsPerformanceOptimization: () => false,
    queueOperation: (_id: string, callback: () => void) => callback(),
};
