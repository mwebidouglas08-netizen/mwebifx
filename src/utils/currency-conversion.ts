/**
 * Dollarvault currency conversion — view account balances in both US Dollars
 * (USD) and Kenyan Shillings (KSH / KES).
 *
 * Design:
 *  - USD is the settlement currency for Deriv accounts, so conversion is a
 *    pure display concern: USD → KSH multiplies, KSH → USD divides.
 *  - The FX rate is user-overridable and persisted in localStorage
 *    (`dv_fx_rate`); a sensible default is used when nothing is stored.
 *  - Display preference (`dv_display_currency`) persists the toggle choice.
 *  - All functions are SSR-safe and tolerate bad/missing storage.
 */

/** Approximate USD → KSH rate used until the user overrides it. */
export const DEFAULT_USD_TO_KES = 129.5;

const RATE_KEY = 'dv_fx_rate';
const DISPLAY_KEY = 'dv_display_currency';

export type DisplayCurrency = 'USD' | 'KSH';

const isBrowser = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

// ---------------------------------------------------------------------------
// Change notification (so React components can re-render on toggle)
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to display-currency / rate changes. Returns an unsubscribe fn. */
export const subscribeCurrencyPreferences = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const notify = (): void => listeners.forEach(l => l());

// ---------------------------------------------------------------------------
// Rate persistence
// ---------------------------------------------------------------------------

export const getUsdToKesRate = (): number => {
    if (!isBrowser()) return DEFAULT_USD_TO_KES;
    try {
        const raw = window.localStorage.getItem(RATE_KEY);
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_TO_KES;
    } catch {
        return DEFAULT_USD_TO_KES;
    }
};

export const setUsdToKesRate = (rate: number): number => {
    const clamped = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_USD_TO_KES;
    if (isBrowser()) {
        try {
            window.localStorage.setItem(RATE_KEY, String(clamped));
        } catch {
            // ignore
        }
    }
    notify();
    return clamped;
};

// ---------------------------------------------------------------------------
// Display-currency preference
// ---------------------------------------------------------------------------

export const getDisplayCurrency = (): DisplayCurrency => {
    if (!isBrowser()) return 'USD';
    try {
        const raw = window.localStorage.getItem(DISPLAY_KEY);
        return raw === 'KSH' ? 'KSH' : 'USD';
    } catch {
        return 'USD';
    }
};

export const setDisplayCurrency = (currency: DisplayCurrency): DisplayCurrency => {
    const value = currency === 'KSH' ? 'KSH' : 'USD';
    if (isBrowser()) {
        try {
            window.localStorage.setItem(DISPLAY_KEY, value);
        } catch {
            // ignore
        }
    }
    notify();
    return value;
};

export const toggleDisplayCurrency = (): DisplayCurrency =>
    setDisplayCurrency(getDisplayCurrency() === 'KSH' ? 'USD' : 'KSH');

// ---------------------------------------------------------------------------
// Conversion math
// ---------------------------------------------------------------------------

/** Convert an amount between account currency and display currency. */
export const convertAmount = (
    amount: number,
    from: string,
    to: string,
    rate: number = getUsdToKesRate()
): number => {
    if (!Number.isFinite(amount)) return 0;
    const f = normalizeCurrency(from);
    const t = normalizeCurrency(to);
    if (f === t) return amount;
    if (f === 'USD' && t === 'KSH') return amount * rate;
    if (f === 'KSH' && t === 'USD') return amount / rate;
    return amount;
};

/** Map any KES/KSH/USD spelling to the canonical pair we support. */
const normalizeCurrency = (currency: string): 'USD' | 'KSH' | 'OTHER' => {
    const c = (currency || '').toUpperCase();
    if (c === 'USD' || c === 'US$') return 'USD';
    if (c === 'KES' || c === 'KSH' || c === 'KSHS' || c === 'K' || c === 'KES ') return 'KSH';
    return 'OTHER';
};

export interface ConvertedBalance {
    /** Original amount in the account currency. */
    original: number;
    /** Original currency code as given (e.g. 'USD'). */
    originalCurrency: string;
    /** Converted amount in the display currency. */
    converted: number;
    /** Display currency code ('USD' | 'KSH'). */
    displayCurrency: DisplayCurrency;
    /** Formatted display string, e.g. "1,295.00 KSH". */
    formatted: string;
    /** Formatted secondary string (the other currency), e.g. "10.00 USD". */
    secondary: string;
    /** True when a conversion actually happened. */
    didConvert: boolean;
}

const formatNumber = (n: number, decimals = 2): string => {
    if (!Number.isFinite(n)) return '0.00';
    if (typeof Intl !== 'undefined') {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(n);
    }
    return n.toFixed(decimals);
};

/**
 * Convert a balance and produce formatted primary/secondary strings ready for
 * display. Respects the user's saved display-currency preference.
 */
export const getConvertedBalance = (
    amount: number,
    accountCurrency: string,
    display?: DisplayCurrency
): ConvertedBalance => {
    const acct = normalizeCurrency(accountCurrency);
    const want = display ?? getDisplayCurrency();
    const rate = getUsdToKesRate();
    const original = Number.isFinite(amount) ? amount : 0;

    // Only USD accounts can be shown in KSH (and vice-versa). Anything else
    // (EUR, crypto, …) is shown unchanged with a KSH equivalent when possible.
    if (acct === 'KSH') {
        if (want === 'USD' || want === 'KSH') {
            const usd = original / rate;
            return {
                original,
                originalCurrency: 'KSH',
                converted: want === 'USD' ? usd : original,
                displayCurrency: want,
                formatted: `${formatNumber(want === 'USD' ? usd : original)} ${want}`,
                secondary: `${formatNumber(want === 'USD' ? original : usd)} ${want === 'USD' ? 'KSH' : 'USD'}`,
                didConvert: want !== 'KSH' || true,
            };
        }
    }

    if (acct === 'USD') {
        if (want === 'KSH') {
            const ksh = original * rate;
            return {
                original,
                originalCurrency: 'USD',
                converted: ksh,
                displayCurrency: 'KSH',
                formatted: `${formatNumber(ksh)} KSH`,
                secondary: `${formatNumber(original)} USD`,
                didConvert: true,
            };
        }
        return {
            original,
            originalCurrency: 'USD',
            converted: original,
            displayCurrency: 'USD',
            formatted: `${formatNumber(original)} USD`,
            secondary: `${formatNumber(original * rate)} KSH`,
            didConvert: false,
        };
    }

    // Non-USD/KSH account currency: show as-is plus a KSH estimate when the
    // account is USD-quoted (most Deriv accounts are). For other currencies
    // we simply echo the amount with its own code.
    const code = (accountCurrency || 'USD').toUpperCase();
    return {
        original,
        originalCurrency: code,
        converted: original,
        displayCurrency: want === 'KSH' ? 'KSH' : 'USD',
        formatted: `${formatNumber(original)} ${code}`,
        secondary: '',
        didConvert: false,
    };
};

/** Compact helper for bot Equity readouts: returns the KSH view when enabled. */
export const formatBalanceForDisplay = (
    amount: number,
    accountCurrency: string,
    display?: DisplayCurrency
): string => getConvertedBalance(amount, accountCurrency, display).formatted;

/** KSH ↔ USD label pair for toggle buttons. */
export const CURRENCY_TOGGLE_LABELS: [DisplayCurrency, DisplayCurrency] = ['USD', 'KSH'];
