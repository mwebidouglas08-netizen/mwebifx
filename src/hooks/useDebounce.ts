import { useRef, useCallback } from 'react';

export const useDebounce = <T extends (...args: any[]) => void>(callback: T, delay: number): T => {
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    return useCallback(
        (...args: Parameters<T>) => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => callback(...args), delay);
        },
        [callback, delay]
    ) as T;
};
