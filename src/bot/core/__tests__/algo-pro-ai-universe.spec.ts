import {
    ALGO_PRO_MARKETS,
    classifyUniverseCategory,
    filterUniverseByScope,
    isOneSecondMarket,
    pipSizeDefault,
    resolveUniversePipSize,
    scopeMarkets,
} from '../algo-pro-ai';

const DISCOVERED = [
    { symbol: 'R_10', displayName: 'Volatility 10 Index', category: 'volatility', pipSize: 3 },
    { symbol: 'R_15', displayName: 'Volatility 15 Index', category: 'volatility', pipSize: 3 },
    { symbol: 'R_35', displayName: 'Volatility 35 Index', category: 'volatility', pipSize: 3 },
    { symbol: 'R_60', displayName: 'Volatility 60 Index', category: 'volatility', pipSize: 3 },
    { symbol: 'R_90', displayName: 'Volatility 90 Index', category: 'volatility', pipSize: 3 },
    { symbol: '1HZ15V', displayName: 'Volatility 15 (1s) Index', category: 'volatility', pipSize: 2 },
    { symbol: '1HZ30V', displayName: 'Volatility 30 (1s) Index', category: 'volatility', pipSize: 2 },
    { symbol: '1HZ80V', displayName: 'Volatility 80 (1s) Index', category: 'volatility', pipSize: 2 },
    { symbol: '1HZ150V', displayName: 'Volatility 150 (1s) Index', category: 'volatility', pipSize: 2 },
    { symbol: '1HZ200V', displayName: 'Volatility 200 (1s) Index', category: 'volatility', pipSize: 2 },
    { symbol: 'JD10', displayName: 'Jump 10 Index', category: 'jump', pipSize: 3 },
    { symbol: 'stpRNG', displayName: 'Step Index', category: 'step', pipSize: 2 },
    { symbol: 'RDBULL', displayName: 'Range Break 100 Index', category: 'range', pipSize: 2 },
    { symbol: 'RDBEAR', displayName: 'Range Break 200 Index', category: 'range', pipSize: 2 },
];

describe('isOneSecondMarket', () => {
    it('flags 1HZ* symbols as one-second', () => {
        expect(isOneSecondMarket('1HZ15V')).toBe(true);
        expect(isOneSecondMarket('1HZ200V')).toBe(true);
        expect(isOneSecondMarket('R_15')).toBe(false);
        expect(isOneSecondMarket('JD10')).toBe(false);
    });
});

describe('classifyUniverseCategory', () => {
    it('classifies classic and 1s volatility indices by display name or symbol', () => {
        expect(classifyUniverseCategory('R_15', 'Volatility 15 Index')).toBe('volatility');
        expect(classifyUniverseCategory('1HZ15V', 'Volatility 15 (1s) Index')).toBe('volatility');
        expect(classifyUniverseCategory('R_60')).toBe('volatility');
        expect(classifyUniverseCategory('1HZ80V')).toBe('volatility');
    });

    it('classifies jump / step / range / crash / boom indices', () => {
        expect(classifyUniverseCategory('JD10', 'Jump 10 Index')).toBe('jump');
        expect(classifyUniverseCategory('JD10')).toBe('jump');
        expect(classifyUniverseCategory('stpRNG', 'Step Index')).toBe('step');
        expect(classifyUniverseCategory('stpRNG')).toBe('step');
        expect(classifyUniverseCategory('RDBULL', 'Range Break 100 Index')).toBe('range');
        expect(classifyUniverseCategory('RDBULL')).toBe('range');
        expect(classifyUniverseCategory('RDBEAR')).toBe('range');
        expect(classifyUniverseCategory('CRASH1000', 'Crash 1000 Index')).toBe('crash');
        expect(classifyUniverseCategory('BOOM500', 'Boom 500 Index')).toBe('boom');
    });

    it('classifies unknown synthetics as other', () => {
        expect(classifyUniverseCategory('WEIRD1', 'Mystery Index')).toBe('other');
    });
});

describe('filterUniverseByScope', () => {
    it('standard keeps classic volatility indices only (no 1HZ*, no jump/step/range)', () => {
        const out = filterUniverseByScope(DISCOVERED, 'standard');
        expect(out.map(m => m.symbol)).toEqual(['R_10', 'R_15', 'R_35', 'R_60', 'R_90']);
        expect(out.every(m => m.category === 'volatility' && !m.oneSecond)).toBe(true);
    });

    it('one-second keeps only 1HZ* volatility indices', () => {
        const out = filterUniverseByScope(DISCOVERED, 'one-second');
        expect(out.map(m => m.symbol)).toEqual(['1HZ15V', '1HZ30V', '1HZ80V', '1HZ150V', '1HZ200V']);
        expect(out.every(m => m.oneSecond)).toBe(true);
    });

    it('all keeps every discovered synthetic — the engine then applies the digit-contract filter', () => {
        const out = filterUniverseByScope(DISCOVERED, 'all');
        expect(out).toHaveLength(DISCOVERED.length);
        expect(out.map(m => m.symbol)).toContain('JD10');
        expect(out.map(m => m.symbol)).toContain('stpRNG');
        expect(out.map(m => m.symbol)).toContain('RDBULL');
    });

    it('classifies from symbol/display name when the category is missing', () => {
        const out = filterUniverseByScope(
            [
                { symbol: 'JD10', displayName: 'Jump 10 Index', pipSize: 3 },
                { symbol: '1HZ15V', displayName: 'Volatility 15 (1s) Index', pipSize: 2 },
            ],
            'all'
        );
        expect(out).toHaveLength(2);
        expect(out[0]).toMatchObject({ symbol: 'JD10', category: 'jump', oneSecond: false });
        expect(out[1]).toMatchObject({ symbol: '1HZ15V', category: 'volatility', oneSecond: true });
    });

    it('normalises a missing display name to the symbol and preserves pipSize', () => {
        const out = filterUniverseByScope([{ symbol: 'R_15', pipSize: 2 }], 'all');
        expect(out[0]).toMatchObject({ symbol: 'R_15', displayName: 'R_15', pipSize: 2, category: 'volatility' });
    });

    it('returns an empty list for an empty (offline) discovery result', () => {
        expect(filterUniverseByScope([], 'all')).toEqual([]);
        expect(filterUniverseByScope([], 'standard')).toEqual([]);
        expect(filterUniverseByScope([], 'one-second')).toEqual([]);
    });
});

describe('resolveUniversePipSize', () => {
    it('prefers the discovered pip over the hardcoded default', () => {
        expect(resolveUniversePipSize('R_10', 2)).toBe(2);
        expect(resolveUniversePipSize('1HZ10V', 3)).toBe(3);
    });

    it('falls back to the static default when discovery gives no usable pip', () => {
        expect(resolveUniversePipSize('R_10', undefined)).toBe(3);
        expect(resolveUniversePipSize('R_10', 0)).toBe(3);
        expect(resolveUniversePipSize('R_10', NaN)).toBe(3);
        expect(resolveUniversePipSize('1HZ10V', undefined)).toBe(2);
        expect(resolveUniversePipSize('JD10', undefined)).toBe(pipSizeDefault('JD10'));
    });
});

describe('static fallback catalog (backwards compatibility)', () => {
    it('ALGO_PRO_MARKETS / scopeMarkets expose the reference 13-market list', () => {
        expect(ALGO_PRO_MARKETS).toHaveLength(13);
        expect(scopeMarkets('all')).toHaveLength(13);
        expect(scopeMarkets('standard')).toHaveLength(5);
        expect(scopeMarkets('one-second')).toHaveLength(8);
    });

    it('the fallback catalog covers the classic + 1s families the scope filter targets', () => {
        const all = filterUniverseByScope(scopeMarkets('all'), 'all');
        expect(all.filter(m => m.category === 'volatility' && !m.oneSecond)).toHaveLength(5);
        expect(all.filter(m => m.oneSecond)).toHaveLength(8);
    });
});
