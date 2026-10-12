import { AvailableContract, MarketCategory, SyntheticSymbol } from '../core/types';
import { ContractFamily } from '../core/signal-types';
import { getActiveSymbols, getContractsFor } from './api';

const computePipSize = (pip: unknown, quote?: unknown): number => {
    if (typeof pip === 'number' && pip > 0) {
        const s = pip.toString();
        const dot = s.indexOf('.');
        if (dot >= 0) return s.length - dot - 1;
    }
    if (typeof quote === 'string' && quote.includes('.')) {
        return quote.length - quote.indexOf('.') - 1;
    }
    return 2;
};

// The Deriv `active_symbols` payload has two shapes depending on endpoint/version.
// Classic responses carry `symbol` + `display_name` with `submarket: 'synthetic_index'`;
// the /trading/v1 options endpoint returns `underlying_symbol` + `underlying_symbol_name`
// with the top-level `market: 'synthetic_index'` and a granular submarket
// (random_index, crash_index, …). Normalize both so discovery never misses markets.
const symbolOf = (s: { symbol?: string; underlying_symbol?: string }): string =>
    s.symbol || s.underlying_symbol || '';

const displayNameOf = (s: { display_name?: string; underlying_symbol_name?: string; symbol?: string }): string =>
    s.display_name || s.underlying_symbol_name || s.symbol || '';

// Submarkets that only ever contain synthetic (synthetic-index) instruments.
const SYNTHETIC_SUBMARKETS = new Set([
    'synthetic_index',
    'random_index',
    'random_daily',
    'crash_index',
    'jump_index',
    'range_index',
    'step_index',
]);

export const categorizeSymbol = (s: {
    symbol?: string;
    underlying_symbol?: string;
    display_name?: string;
    underlying_symbol_name?: string;
    submarket?: string;
    subgroup?: string;
}): MarketCategory => {
    const haystack = `${displayNameOf(s)} ${s.subgroup || ''} ${symbolOf(s)}`.toLowerCase();
    if (/crash/.test(haystack)) return 'crash';
    if (/boom/.test(haystack)) return 'boom';
    if (/jump/.test(haystack)) return 'jump';
    if (/step/.test(haystack)) return 'step';
    if (/range/.test(haystack)) return 'range';
    if (/volatility|vol index|vix/.test(haystack)) return 'volatility';
    if (/synthetic/.test(haystack) || s.submarket === 'synthetic_index') return 'other';
    return 'other';
};

const isSynthetic = (s: {
    market?: string;
    submarket?: string;
    display_name?: string;
    underlying_symbol_name?: string;
}): boolean => {
    if (s.market === 'synthetic_index' || s.submarket === 'synthetic_index') return true;
    if (s.submarket && SYNTHETIC_SUBMARKETS.has(s.submarket)) return true;
    const d = displayNameOf(s).toLowerCase();
    return /volatility|crash|boom|jump|step index|range break/.test(d);
};

export const discoverSyntheticSymbols = async (): Promise<SyntheticSymbol[]> => {
    const raw = await getActiveSymbols();
    const out: SyntheticSymbol[] = [];
    for (const s of raw) {
        const symbol = symbolOf(s);
        if (!symbol) continue;
        if (!isSynthetic(s)) continue;
        const pip = s.pip ?? s.pip_size;
        out.push({
            symbol,
            displayName: displayNameOf(s) || symbol,
            market: s.market || 'synthetic_index',
            submarket: s.submarket || 'synthetic_index',
            category: categorizeSymbol(s),
            pip: typeof pip === 'number' ? pip : Number(pip) || 0,
            pipSize: computePipSize(typeof pip === 'number' ? pip : Number(pip) || 0, s.spot),
            exchangeIsOpen: s.exchange_is_open === 1 || s.exchange_is_open === true,
            isSuspended: s.is_trading_suspended === 1 || s.is_trading_suspended === true,
        });
    }
    return out.sort((a, b) => a.category.localeCompare(b.category) || a.symbol.localeCompare(b.symbol));
};

const DIGIT_TYPES = new Set(['DIGITOVER', 'DIGITUNDER']);

export const detectSupportedFamilies = (contractsAvailable: any[]): ContractFamily[] => {
    const types = new Set<string>();
    for (const c of contractsAvailable) {
        if (c?.contract_type) types.add(String(c.contract_type));
    }
    const families: ContractFamily[] = [];
    if (types.has('CALL') || types.has('PUT')) families.push('rise_fall');
    if (types.has('DIGITEVEN') || types.has('DIGITODD')) families.push('even_odd');
    if (types.has('DIGITOVER') || types.has('DIGITUNDER')) families.push('over_under');
    if (types.has('DIGITMATCH') || types.has('DIGITDIFFER')) families.push('match_differ');
    return families;
};

export const extractDigitContracts = (contractsAvailable: any[]): AvailableContract[] => {
    const out: AvailableContract[] = [];
    for (const c of contractsAvailable) {
        if (!DIGIT_TYPES.has(c.contract_type)) continue;
        const barriers: number[] = [];
        const range = c.last_digit_range;
        if (Array.isArray(range)) {
            for (const r of range) {
                const n = Math.round(Number(r));
                if (Number.isFinite(n) && n >= 0 && n <= 9 && !barriers.includes(n)) barriers.push(n);
            }
        } else {
            for (let i = 0; i <= 9; i++) barriers.push(i);
        }
        const durationUnits: string[] = [];
        const durs = c.duration_choices || c.durations || [];
        if (Array.isArray(durs)) for (const d of durs) durationUnits.push(String(d));
        out.push({
            contractType: c.contract_type as 'DIGITOVER' | 'DIGITUNDER',
            barriers: barriers.sort((a, b) => a - b),
            minStake: Number(c.min_stake) || undefined,
            maxStake: Number(c.max_stake) || undefined,
            minDuration: Number(c.min_contract_duration) || undefined,
            maxDuration: Number(c.max_contract_duration) || undefined,
            durationUnits: durationUnits.length ? durationUnits : ['t'],
        });
    }
    return out;
};

export const discoverDigitContracts = async (symbol: string): Promise<AvailableContract[]> => {
    try {
        const available = await getContractsFor(symbol);
        return extractDigitContracts(available);
    } catch {
        return [];
    }
};
