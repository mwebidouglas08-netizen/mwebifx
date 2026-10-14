import {
    PRO_AI_BOTS,
    ProAiBot,
    evaluateProAiEntry,
    scanProAiMarkets,
} from '../pro-ai';

const over1: ProAiBot = PRO_AI_BOTS.find(b => b.id === 'over-1') as ProAiBot;

// 5 early losses then 95 wins (digits 2..9 all clear Over 1) — a genuinely
// strong over-1 streak: winRate 0.95, recent window 100% wins.
const strongOver1: number[] = [
    0, 1, 0, 1, 0,
    ...Array.from({ length: 95 }, (_, i) => 2 + (i % 8)),
];

// One loss at the very front, 99 wins after it.
const nearPerfect: number[] = [
    0,
    ...Array.from({ length: 99 }, (_, i) => 2 + (i % 8)),
];

// Every digit wins — the ceiling case for the score blend.
const perfect: number[] = Array.from({ length: 100 }, (_, i) => 2 + (i % 8));

// Last three digits all lose → SmartFlip's "opposite extreme" lookback block.
const oppositeExtreme: number[] = [
    ...Array.from({ length: 97 }, (_, i) => 3 + (i % 7)),
    0, 1, 0,
];

// Recent window is 10 wins / 30 (33%) against a 80% fair rate → no-trade zone.
const noTradeZone: number[] = [
    ...Array.from({ length: 70 }, (_, i) => 4 + (i % 6)),
    ...Array.from({ length: 10 }, () => [0, 1, 5]).flat(),
];

const tinySample: number[] = Array.from({ length: 20 }, (_, i) => 2 + (i % 8));

describe('evaluateProAiEntry', () => {
    it('passes a strong over-1 streak through the 0.72 score and 0.55 recent gates', () => {
        const ev = evaluateProAiEntry(strongOver1, over1);

        expect(ev.sampleSize).toBe(100);
        expect(ev.winRate).toBeCloseTo(0.95, 5);
        expect(ev.recentWinRate).toBeGreaterThanOrEqual(0.55);
        expect(ev.aiScore).toBeGreaterThanOrEqual(0.72);
        expect(ev.signal).toBe('BUY');
        expect(ev.blockReason).toBeNull();
    });

    it('blocks when every digit in the lookback window lost (opposite extreme)', () => {
        const ev = evaluateProAiEntry(oppositeExtreme, over1);

        expect(ev.signal).toBe('BLOCK');
        expect(ev.blockReason).toContain('Opposite extreme');
        expect(ev.blockReason).toContain('all losses');
    });

    it('blocks when the recent window sits below the theoretical rate (no-trade zone)', () => {
        const ev = evaluateProAiEntry(noTradeZone, over1);

        expect(ev.signal).toBe('BLOCK');
        expect(ev.blockReason).toContain('No-trade zone');
        expect(ev.recentWinRate).toBeLessThan(ev.theoretical);
    });

    it('blocks when the sample is smaller than minSample', () => {
        const ev = evaluateProAiEntry(tinySample, over1);

        expect(ev.signal).toBe('BLOCK');
        expect(ev.sampleSize).toBe(20);
        expect(ev.blockReason).toContain('Insufficient sample');
        expect(ev.blockReason).toContain('20/40');
    });

    it('blocks a mediocre stretch that clears the hard blocks but not the score gate', () => {
        // Recent window is 24/30 = 80% (at fair value, so no hard block) but the
        // full sample is weak, pulling the blended aiScore under 0.72.
        const mediocre: number[] = [
            ...Array.from({ length: 70 }, (_, i) => (i % 7 < 3 ? 2 + (i % 8) : i % 2)),
            ...Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? 0 : 5)),
        ];
        const ev = evaluateProAiEntry(mediocre, over1);

        expect(ev.signal).toBe('BLOCK');
        expect(ev.recentWinRate).toBeCloseTo(0.8, 10);
        expect(ev.recentWinRate).toBeGreaterThanOrEqual(ev.theoretical);
        expect(ev.aiScore).toBeLessThan(0.72);
        expect(ev.blockReason).toContain('gate');
    });
});

describe('scanProAiMarkets', () => {
    const markets = [
        { symbol: '1HZ10V', digits: perfect },
        { symbol: 'R_75', digits: strongOver1 },
        { symbol: 'R_100', digits: nearPerfect },
        { symbol: 'R_25', digits: oppositeExtreme },
    ];

    it('ranks BUY candidates by aiScore descending', () => {
        const all = scanProAiMarkets(markets, { scope: 'all', bots: [over1] });

        expect(all.map(m => m.symbol)).toEqual(['1HZ10V', 'R_100', 'R_75']);
        expect(all.every(m => m.signal === 'BUY')).toBe(true);
        expect(all[0].aiScore).toBeGreaterThanOrEqual(all[1].aiScore);
        expect(all[1].aiScore).toBeGreaterThanOrEqual(all[2].aiScore);
    });

    it('filters non-matching symbols out of the standard scope', () => {
        const standard = scanProAiMarkets(markets, { scope: 'standard', bots: [over1] });

        expect(standard.map(m => m.symbol)).toEqual(['R_100', 'R_75']);
        expect(standard.some(m => m.symbol === '1HZ10V')).toBe(false);
    });

    it('keeps only 1-second symbols in the one-second scope', () => {
        const oneSecond = scanProAiMarkets(markets, { scope: 'one-second', bots: [over1] });

        expect(oneSecond.map(m => m.symbol)).toEqual(['1HZ10V']);
    });

    it('excludes blocked evaluations from every scope', () => {
        const all = scanProAiMarkets(markets, { scope: 'all', bots: [over1] });

        expect(all.some(m => m.symbol === 'R_25')).toBe(false);
    });
});
