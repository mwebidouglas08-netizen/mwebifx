export const validateEmail = (value: string): string | null => {
    if (!value) return 'This field is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Invalid email address';
    return null;
};

export const validatePhone = (value: string): string | null => {
    if (!value) return 'This field is required';
    if (!/^\+?[0-9\s\-()]+$/.test(value)) return 'Please enter a valid phone number';
    return null;
};

export const validateRequired = (value: string): string | null => {
    if (!value || !value.trim()) return 'This field is required';
    return null;
};

export const validateMinLength = (value: string, min: number): string | null => {
    if (value.length < min) return `Must be at least ${min} characters`;
    return null;
};

export const validateMaxLength = (value: string, max: number): string | null => {
    if (value.length > max) return `Must be at most ${max} characters`;
    return null;
};
