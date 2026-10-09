export const addComma = (num: number | string, decimal_places?: number): string => {
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(n)) return String(num);
    const fixed = decimal_places !== undefined ? n.toFixed(decimal_places) : String(n);
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
};

export const getDecimalPlaces = (currency: string): number => {
    const cryptoCurrencies = ['BTC', 'ETH', 'LTC', 'BCH', 'XRP', 'USDT', 'USDC', 'eUSDT', 'tUSDT', 'BTC', 'ETH'];
    if (cryptoCurrencies.includes(currency?.toUpperCase())) return 8;
    const zeroDecimalCurrencies = ['JPY', 'KRW', 'VND', 'CLP'];
    if (zeroDecimalCurrencies.includes(currency?.toUpperCase())) return 0;
    return 2;
};

export const formatMoney = (currency: string, amount: number, decimal_places?: number): string => {
    const places = decimal_places ?? getDecimalPlaces(currency);
    return addComma(amount.toFixed(places), places);
};
