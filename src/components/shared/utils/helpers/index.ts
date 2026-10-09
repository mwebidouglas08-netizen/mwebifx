export const addComma = (value: string | number, decimal_places?: number): string => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (decimal_places !== undefined) {
        return num.toLocaleString(undefined, {
            minimumFractionDigits: decimal_places,
            maximumFractionDigits: decimal_places,
        });
    }
    return num.toLocaleString();
};

export const getCurrencyDisplayCode = (currency: string): string => currency.toUpperCase();

export const getDecimalPlaces = (currency: string): number => {
    const cryptoCurrencies = ['BTC', 'ETH', 'LTC', 'BCH', 'XRP'];
    if (cryptoCurrencies.includes(currency?.toUpperCase())) return 8;
    return 2;
};

export const isCryptocurrency = (currency: string): boolean => /^[A-Z]{2,5}$/.test(currency);
