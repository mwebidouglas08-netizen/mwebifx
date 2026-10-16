import {
    DEFAULT_USD_TO_KES,
    convertAmount,
    getConvertedBalance,
    getDisplayCurrency,
    getUsdToKesRate,
    setDisplayCurrency,
    setUsdToKesRate,
    subscribeCurrencyPreferences,
    toggleDisplayCurrency,
} from '../currency-conversion';

describe('currency conversion', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('converts USD to KSH and back with the stored rate', () => {
        setUsdToKesRate(130);
        expect(convertAmount(10, 'USD', 'KSH')).toBeCloseTo(1300, 6);
        expect(convertAmount(1300, 'KSH', 'USD')).toBeCloseTo(10, 6);
        expect(convertAmount(10, 'USD', 'USD')).toBe(10);
    });

    it('falls back to the default rate when storage is unusable', () => {
        expect(getUsdToKesRate()).toBe(DEFAULT_USD_TO_KES);
        setUsdToKesRate(Number.NaN);
        expect(getUsdToKesRate()).toBe(DEFAULT_USD_TO_KES);
    });

    it('renders both currencies for a USD balance', () => {
        setUsdToKesRate(129.5);
        const view = getConvertedBalance(100, 'USD', 'USD');
        expect(view.formatted).toBe('100.00 USD');
        expect(view.secondary).toBe('12,950.00 KSH');
        expect(view.didConvert).toBe(false);
    });

    it('swaps the primary line when the display preference is KSH', () => {
        setUsdToKesRate(129.5);
        const view = getConvertedBalance(100, 'USD', 'KSH');
        expect(view.formatted).toBe('12,950.00 KSH');
        expect(view.secondary).toBe('100.00 USD');
        expect(view.didConvert).toBe(true);
    });

    it('shows a KSH account in USD when USD is preferred', () => {
        setUsdToKesRate(129.5);
        const view = getConvertedBalance(1295, 'KSH', 'USD');
        expect(view.formatted).toBe('10.00 USD');
        expect(view.secondary).toBe('1,295.00 KSH');
    });

    it('leaves unsupported currencies untouched', () => {
        const view = getConvertedBalance(100, 'EUR', 'KSH');
        expect(view.formatted).toBe('100.00 EUR');
        expect(view.secondary).toBe('');
    });

    it('persists and notifies subscribers of display-currency changes', () => {
        const listener = jest.fn();
        const unsubscribe = subscribeCurrencyPreferences(listener);

        expect(getDisplayCurrency()).toBe('USD');
        expect(toggleDisplayCurrency()).toBe('KSH');
        expect(getDisplayCurrency()).toBe('KSH');
        expect(listener).toHaveBeenCalledTimes(1);

        setDisplayCurrency('USD');
        expect(getDisplayCurrency()).toBe('USD');
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        setDisplayCurrency('KSH');
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('tolerates a bad stored display preference', () => {
        window.localStorage.setItem('dv_display_currency', 'GBP');
        expect(getDisplayCurrency()).toBe('USD');
    });
});
