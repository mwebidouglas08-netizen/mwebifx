import {
    evenOddPercent,
    overUnderPercent,
    riseFallPercent,
} from './signal-analysis';
import {
    AIBotConfig,
    MarketAnalysis,
    PurchaseRule,
    RuleMatch,
} from './ai-bot-types';

const clampDigit = (n: number | undefined, fallback: number): number => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(9, Math.round(v)));
};

const satisfiesOperator = (value: number, operator: 'greater_or_equal' | 'less_or_equal', digit: number): boolean =>
    operator === 'less_or_equal' ? value <= digit : value >= digit;

/**
 * Evaluate one rule against live digits + quotes. Returns true when the rule's
 * analysis condition is met. Digits are the most recent sample (index 0 = oldest).
 */
export const evaluateRule = (
    rule: PurchaseRule,
    digits: number[],
    quotes: number[],
    opts: { defaultOverBarrier?: number; defaultUnderBarrier?: number } = {}
): boolean => {
    if (!rule.enabled) return false;
    const count = Math.max(1, Math.floor(rule.count || 1));

    if (rule.analysisType === 'percentage') {
        const sample = Math.max(2, Math.floor(rule.sampleSize || opts.defaultOverBarrier || 0) || 20);
        const digitsWindow = digits.slice(-sample);
        const quotesWindow = quotes.slice(-sample);
        if (digitsWindow.length < Math.min(sample, 2)) return false;
        const barrier = clampDigit(rule.digit, 5);
        const type = rule.percentageType || 'odd';
        let pct = 0;
        if (type === 'rise' || type === 'fall') {
            if (quotesWindow.length < 2) return false;
            const rf = riseFallPercent(quotesWindow);
            pct = type === 'rise' ? rf.rise : rf.fall;
        } else if (type === 'even' || type === 'odd') {
            const eo = evenOddPercent(digitsWindow);
            pct = type === 'even' ? eo.even : eo.odd;
        } else if (type === 'over') {
            pct = overUnderPercent(digitsWindow, barrier).over;
        } else {
            pct = overUnderPercent(digitsWindow, barrier).under;
        }
        const threshold = Number(rule.percentageThreshold ?? 55);
        const comparison = rule.comparison || 'greater_or_equal';
        return comparison === 'less_or_equal' ? pct <= threshold : pct >= threshold;
    }

    if (digits.length < count) return false;
    const window = digits.slice(-count);

    if (rule.analysisType === 'all_even') return window.every(d => d % 2 === 0);
    if (rule.analysisType === 'all_odd') return window.every(d => d % 2 === 1);

    // last_digits
    const digit = clampDigit(rule.digit, 5);
    const operator = rule.operator || 'less_or_equal';
    return window.every(d => satisfiesOperator(d, operator, digit));
};

/**
 * Walk the ordered rule list and return the first match. Rules behave like an
 * if / else_if chain: the first enabled rule whose analysis condition holds wins.
 */
export const firstMatch = (
    rules: PurchaseRule[],
    digits: number[],
    quotes: number[],
    fallback: { contractType: PurchaseRule['purchase']; prediction?: number },
    opts?: { defaultOverBarrier?: number; defaultUnderBarrier?: number }
): RuleMatch | null => {
    for (const rule of rules) {
        if (!rule.enabled) continue;
        if (evaluateRule(rule, digits, quotes, opts)) {
            return {
                rule,
                contractType: rule.purchase,
                prediction: rule.prediction,
                rationale: describeRule(rule),
            };
        }
    }
    void fallback;
    return null;
};

/** Human-readable rationale for an activity feed / panel. */
export const describeRule = (rule: PurchaseRule): string => {
    const label = (s: string) => s.replace(/_/g, ' ');
    if (rule.analysisType === 'percentage') {
        const type = label(rule.percentageType || 'odd');
        const cmp = rule.comparison === 'less_or_equal' ? '≤' : '≥';
        return `${type} ${cmp} ${rule.percentageThreshold ?? 55}% over ${rule.sampleSize ?? 20} → ${label(rule.purchase)}`;
    }
    if (rule.analysisType === 'all_even' || rule.analysisType === 'all_odd') {
        const kind = rule.analysisType === 'all_even' ? 'all even' : 'all odd';
        return `last ${rule.count} ${kind} → ${label(rule.purchase)}`;
    }
    const op = rule.operator === 'less_or_equal' ? '≤' : '≥';
    return `last digit ${op} ${rule.digit ?? 5} → ${label(rule.purchase)}${rule.prediction !== undefined ? ` (${rule.prediction})` : ''}`;
};

/** Build the live analysis snapshot for a symbol (surfaced in the panel). */
export const buildMarketAnalysis = (
    symbol: string,
    displayName: string,
    digits: number[],
    quotes: number[],
    cfg: Pick<AIBotConfig, 'rules' | 'sampleSize' | 'prediction' | 'contractType'>
): MarketAnalysis => {
    const sample = digits.slice(-cfg.sampleSize);
    const eo = evenOddPercent(sample);
    const overBarrier = cfg.prediction;
    const underBarrier = cfg.prediction;
    const ouOver = overUnderPercent(sample, overBarrier);
    const ouUnder = overUnderPercent(sample, underBarrier);
    const rf = riseFallPercent(quotes.slice(-cfg.sampleSize));
    const match = firstMatch(cfg.rules, digits, quotes, {
        contractType: cfg.contractType,
        prediction: cfg.prediction,
    });
    return {
        symbol,
        displayName,
        sampleSize: sample.length,
        lastDigits: sample.slice(-12),
        even: eo.even,
        odd: eo.odd,
        over: ouOver.over,
        under: ouUnder.under,
        rise: rf.rise,
        fall: rf.fall,
        overBarrier,
        underBarrier,
        matchedRuleId: match?.rule.id,
        matchedContractType: match?.contractType,
        rationale: match?.rationale,
    };
};
