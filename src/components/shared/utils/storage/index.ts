export const getItem = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

export const setItem = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage full or unavailable
    }
};

export const removeItem = (key: string): void => {
    try {
        localStorage.removeItem(key);
    } catch {
        // Ignore
    }
};

export const clear = (): void => {
    try {
        localStorage.clear();
    } catch {
        // Ignore
    }
};

export const getJSON = <T>(key: string): T | null => {
    const item = getItem(key);
    if (!item) return null;
    try {
        return JSON.parse(item) as T;
    } catch {
        return null;
    }
};

export const setJSON = <T>(key: string, value: T): void => {
    setItem(key, JSON.stringify(value));
};
