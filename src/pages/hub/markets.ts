export interface HubMarket {
    symbol: string;
    name: string;
}

/** The reference scanner universe: 13 volatility indices in reference order. */
export const VOL_MARKETS: HubMarket[] = [
    { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index' },
    { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ15V', name: 'Volatility 15 (1s) Index' },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ30V', name: 'Volatility 30 (1s) Index' },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ90V', name: 'Volatility 90 (1s) Index' },
    { symbol: 'R_10', name: 'Volatility 10 Index' },
    { symbol: 'R_100', name: 'Volatility 100 Index' },
    { symbol: 'R_25', name: 'Volatility 25 Index' },
    { symbol: 'R_50', name: 'Volatility 50 Index' },
    { symbol: 'R_75', name: 'Volatility 75 Index' },
];

export const volName = (symbol: string): string =>
    VOL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;

export const volSymbolByName = (name: string): string =>
    VOL_MARKETS.find(m => m.name === name)?.symbol || '';

/** Extended synthetic list used by Speedbot / Bulk Trader market pickers. */
export const EXTENDED_MARKETS: HubMarket[] = [
    ...VOL_MARKETS,
    { symbol: 'BOOM1000N', name: 'Boom 1000 Index' },
    { symbol: 'BOOM150N', name: 'Boom 150 Index' },
    { symbol: 'BOOM300N', name: 'Boom 300 Index' },
    { symbol: 'BOOM50N', name: 'Boom 50 Index' },
    { symbol: 'BOOM500N', name: 'Boom 500 Index' },
    { symbol: 'BOOM600N', name: 'Boom 600 Index' },
    { symbol: 'BOOM900N', name: 'Boom 900 Index' },
    { symbol: 'CRASH1000N', name: 'Crash 1000 Index' },
    { symbol: 'CRASH150N', name: 'Crash 150 Index' },
    { symbol: 'CRASH300N', name: 'Crash 300 Index' },
    { symbol: 'CRASH50N', name: 'Crash 50 Index' },
    { symbol: 'CRASH500N', name: 'Crash 500 Index' },
    { symbol: 'CRASH600N', name: 'Crash 600 Index' },
    { symbol: 'CRASH900N', name: 'Crash 900 Index' },
    { symbol: 'JD10', name: 'Jump 10 Index' },
    { symbol: 'JD100', name: 'Jump 100 Index' },
    { symbol: 'JD25', name: 'Jump 25 Index' },
    { symbol: 'JD50', name: 'Jump 50 Index' },
    { symbol: 'JD75', name: 'Jump 75 Index' },
    { symbol: 'RB100', name: 'Range Break 100 Index' },
    { symbol: 'RB200', name: 'Range Break 200 Index' },
    { symbol: 'BULL', name: 'Bull Market Index' },
    { symbol: 'BEAR', name: 'Bear Market Index' },
    { symbol: 'R_10', name: 'Volatility 10 Index' },
    { symbol: 'stpRNG', name: 'Step Index 100' },
    { symbol: 'stpRNG2', name: 'Step Index 200' },
    { symbol: 'stpRNG3', name: 'Step Index 300' },
    { symbol: 'stpRNG4', name: 'Step Index 400' },
    { symbol: 'stpRNG5', name: 'Step Index 500' },
];

/** Even/Odd digit helpers shared by scanner pages. */
export const isEvenDigit = (d: number): boolean => d % 2 === 0;

export const digitPercent = (digits: number[], predicate: (d: number) => boolean): number => {
    if (!digits.length) return 0;
    const hits = digits.filter(predicate).length;
    return (hits * 100) / digits.length;
};

export const trailingAll = (digits: number[], n: number, predicate: (d: number) => boolean): boolean => {
    if (digits.length < n) return false;
    return digits.slice(-n).every(predicate);
};
