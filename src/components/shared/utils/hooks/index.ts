import { useEffect, useRef } from 'react';

export const usePrevious = <T>(value: T): T | undefined => {
    const ref = useRef<T>(undefined);
    useEffect(() => {
        ref.current = value;
    }, [value]);
    return ref.current;
};

export const useMount = (callback: () => void) => {
    useEffect(() => {
        callback();
    }, []);
};

export const useUnmount = (callback: () => void) => {
    useEffect(() => () => callback(), []);
};
