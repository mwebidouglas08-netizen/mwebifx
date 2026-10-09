export const unique = <T>(arr: T[], key: keyof T): T[] => {
    const seen = new Set();
    return arr.filter(item => {
        const val = item[key];
        if (seen.has(val)) return false;
        seen.add(val);
        return true;
    });
};

export const isEmpty = (obj: unknown): boolean => {
    if (obj === null || obj === undefined) return true;
    if (typeof obj === 'object') return Object.keys(obj as object).length === 0;
    return false;
};

export const deepClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

export const pick = <T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> => {
    const result = {} as Pick<T, K>;
    keys.forEach(key => {
        if (key in obj) result[key] = obj[key];
    });
    return result;
};

export const omit = <T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> => {
    const result = { ...obj };
    keys.forEach(key => delete result[key]);
    return result;
};
