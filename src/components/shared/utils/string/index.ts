export const capitalizeFirstLetter = (str: string): string =>
    str ? str.charAt(0).toUpperCase() + str.slice(1) : str;

export const toLowerCase = (str: string): string => str.toLowerCase();

export const toUpperCase = (str: string): string => str.toUpperCase();

export const truncate = (str: string, length: number): string =>
    str.length > length ? `${str.slice(0, length)}...` : str;

export const stripHtml = (str: string): string => str.replace(/<[^>]*>/g, '');

export const camelToKebab = (str: string): string =>
    str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

export const kebabToCamel = (str: string): string =>
    str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
