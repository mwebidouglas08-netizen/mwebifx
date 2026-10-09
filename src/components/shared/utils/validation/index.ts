export const address_permitted_special_characters_message = '.-#/ ';

export const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const isPhone = (value: string): boolean => /^\+?[0-9\s\-()]+$/.test(value);

export const isPostcode = (value: string): boolean => /^[a-zA-Z0-9\s-]+$/.test(value);

export const isAddress = (value: string): boolean => /^[a-zA-Z0-9\s.,\-#/]+$/.test(value);

export const isRequired = (value: string): boolean => value.trim().length > 0;

export const isNumber = (value: string): boolean => /^-?\d*\.?\d+$/.test(value);

export const isAlpha = (value: string): boolean => /^[a-zA-Z\s]+$/.test(value);

export const isAlphaNumeric = (value: string): boolean => /^[a-zA-Z0-9\s]+$/.test(value);
