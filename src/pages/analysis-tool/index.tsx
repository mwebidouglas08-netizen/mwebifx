import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { fetchHistoricalTicks, type HistoricalTicks } from '@/bot/deriv/history';
import {
    chiSquareUniformity,
    computeDigitCounts,
    computeRsi,
    empiricalProbability,
    theoreticalProbability,
    wilsonInterval,
} from '@/bot/core/digit-stats';
import { bollinger, latest, macd, type BollingerResult, type MacdResult } from '@/bot/core/indicators';
import './analysis-tool.scss';

const SYMBOLS = [
    { symbol: 'R_10', name: 'Volatility 10' },
    { symbol: 'R_25', name: 'Volatility 25' },
    { symbol: 'R_50', name: 'Volatility 50' },
    { symbol: 'R_75', name: 'Volatility 75' },
    { symbol: 'R_100', name: 'Volatility 100' },
    { symbol: '1HZ10V', name: 'Volatility 10 (1s)' },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s)' },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s)' },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s)' },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s)' },
];

const RANGES = [100, 500, 1000];
const BARRIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const signedPct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)} pp`;

const extent = (...series: Array<Array<number | null>>): [number, number] => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const s of series) {
        for (const v of s) {
            if (v == null || !Number.isFinite(v)) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
    if (lo === hi) return [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
};

const linePoints = (
    values: Array<number | null>,
    x: (i: number) => number,
    y: (v: number) => number
): string => {
    const parts: string[] = [];
    for (let i = 0; i < values.length; i += 1) {
        const v = values[i];
        if (v == null || !Number.isFinite(v)) continue;
        parts.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
    return parts.join(' ');
};

interface BarrierRow {
    barrier: number;
    overEmp: number;
    overTheo: number;
    underEmp: number;
    underTheo: number;
}

interface Analysis {
    digits: number[];
    quotes: number[];
    pipSize: number;
    n: number;
    counts: number[];
    freqs: number[];
    cis: Array<[number, number]>;
    chiSquare: number;
    chiDf: number;
    chiP: number;
    rows: BarrierRow[];
    strongest: { label: string; gap: number; emp: number; theo: number };
    rsiSeries: number[];
    macdData: MacdResult | null;
    bands: BollingerResult | null;
}

const DigitChart = ({ counts, n }: { counts: number[]; n: number }) => {
    const W = 560;
    const H = 232;
    const padL = 38;
    const padR = 12;
    const padT = 18;
    const padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const freqs = counts.map(c => (n > 0 ? c / n : 0));
    const cis = counts.map(c => wilsonInterval(c, n));
    const yMax = Math.max(0.16, ...cis.map(ci => ci[1]));
    const yOf = (v: number) => padT + plotH * (1 - Math.min(v, yMax) / yMax);
    const band = plotW / counts.length;
    const barW = band * 0.55;
    const gridValues = [0, 0.05, 0.1, 0.15].filter(t => t <= yMax);

    return (
        <svg
            className='analysis-tool__chart'
            viewBox={`0 0 ${W} ${H}`}
            role='img'
            aria-label='Digit frequency bars with Wilson 95% confidence intervals against a fair 10% line'
        >
            {gridValues.map(t => (
                <g key={t}>
                    <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} className='analysis-tool__grid' />
                    <text x={padL - 6} y={yOf(t) + 3} textAnchor='end' className='analysis-tool__axis'>
                        {(t * 100).toFixed(0)}%
                    </text>
                </g>
            ))}
            <line x1={padL} x2={W - padR} y1={yOf(0.1)} y2={yOf(0.1)} className='analysis-tool__ref' />
            <text x={W - padR} y={yOf(0.1) - 5} textAnchor='end' className='analysis-tool__ref-label'>
                fair 10%
            </text>
            {counts.map((_, d) => {
                const cx = padL + band * d + band / 2;
                const top = yOf(freqs[d]);
                const base = padT + plotH;
                const [lo, hi] = cis[d];
                return (
                    <g key={d}>
                        <rect
                            x={cx - barW / 2}
                            y={top}
                            width={barW}
                            height={Math.max(0, base - top)}
                            className='analysis-tool__bar'
                        />
                        <line x1={cx} x2={cx} y1={yOf(hi)} y2={yOf(lo)} className='analysis-tool__ci' />
                        <line x1={cx - 4} x2={cx + 4} y1={yOf(hi)} y2={yOf(hi)} className='analysis-tool__ci' />
                        <line x1={cx - 4} x2={cx + 4} y1={yOf(lo)} y2={yOf(lo)} className='analysis-tool__ci' />
                        <text x={cx} y={top - 5} textAnchor='middle' className='analysis-tool__bar-label'>
                            {(freqs[d] * 100).toFixed(1)}
                        </text>
                        <text x={cx} y={H - 8} textAnchor='middle' className='analysis-tool__axis'>
                            {d}
                        </text>
                    </g>
                );
            })}
            <line
                x1={padL}
                x2={W - padR}
                y1={padT + plotH}
                y2={padT + plotH}
                className='analysis-tool__axis-line'
            />
        </svg>
    );
};

const RsiChart = ({ values }: { values: number[] }) => {
    const W = 560;
    const H = 180;
    const padL = 34;
    const padR = 12;
    const padT = 14;
    const padB = 24;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const xOf = (i: number) => padL + (values.length > 1 ? (i / (values.length - 1)) * plotW : plotW / 2);
    const yOf = (v: number) => padT + plotH * (1 - Math.max(0, Math.min(100, v)) / 100);
    const points = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');

    return (
        <svg
            className='analysis-tool__chart'
            viewBox={`0 0 ${W} ${H}`}
            role='img'
            aria-label='RSI line over the loaded ticks'
        >
            {[30, 50, 70].map(v => (
                <g key={v}>
                    <line
                        x1={padL}
                        x2={W - padR}
                        y1={yOf(v)}
                        y2={yOf(v)}
                        className={v === 50 ? 'analysis-tool__grid' : 'analysis-tool__ref'}
                    />
                    <text x={padL - 6} y={yOf(v) + 3} textAnchor='end' className='analysis-tool__axis'>
                        {v}
                    </text>
                </g>
            ))}
            <polyline points={points} fill='none' className='analysis-tool__line' />
            <text x={padL} y={H - 6} className='analysis-tool__axis'>
                oldest
            </text>
            <text x={W - padR} y={H - 6} textAnchor='end' className='analysis-tool__axis'>
                latest
            </text>
        </svg>
    );
};

const MacdChart = ({ data, count }: { data: MacdResult; count: number }) => {
    const W = 560;
    const H = 190;
    const padL = 48;
    const padR = 12;
    const padT = 14;
    const padB = 24;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const [lo, hi] = extent(data.macd, data.signal, data.histogram, [0]);
    const yOf = (v: number) => padT + plotH * (1 - (v - lo) / (hi - lo));
    const xOf = (i: number) => padL + (count > 1 ? (i / (count - 1)) * plotW : plotW / 2);
    const barW = Math.max(1, plotW / Math.max(count, 1) - 1);
    const zero = yOf(0);

    return (
        <svg
            className='analysis-tool__chart'
            viewBox={`0 0 ${W} ${H}`}
            role='img'
            aria-label='MACD line, signal line and histogram'
        >
            <text x={padL - 6} y={yOf(hi) + 3} textAnchor='end' className='analysis-tool__axis'>
                {hi.toFixed(3)}
            </text>
            <text x={padL - 6} y={yOf(lo) + 3} textAnchor='end' className='analysis-tool__axis'>
                {lo.toFixed(3)}
            </text>
            <line x1={padL} x2={W - padR} y1={zero} y2={zero} className='analysis-tool__ref' />
            {data.histogram.map((h, i) => {
                if (h == null || !Number.isFinite(h)) return null;
                const yv = yOf(h);
                return (
                    <rect
                        key={i}
                        x={xOf(i) - barW / 2}
                        y={Math.min(zero, yv)}
                        width={barW}
                        height={Math.max(1, Math.abs(yv - zero))}
                        className={h >= 0 ? 'analysis-tool__hist-pos' : 'analysis-tool__hist-neg'}
                    />
                );
            })}
            <polyline points={linePoints(data.macd, xOf, yOf)} fill='none' className='analysis-tool__line' />
            <polyline points={linePoints(data.signal, xOf, yOf)} fill='none' className='analysis-tool__line-signal' />
            <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} className='analysis-tool__axis-line' />
        </svg>
    );
};

const BollingerChart = ({ quotes, bands }: { quotes: number[]; bands: BollingerResult }) => {
    const W = 560;
    const H = 190;
    const padL = 58;
    const padR = 12;
    const padT = 14;
    const padB = 24;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const count = quotes.length;
    const [lo, hi] = extent(quotes, bands.upper, bands.middle, bands.lower);
    const yOf = (v: number) => padT + plotH * (1 - (v - lo) / (hi - lo));
    const xOf = (i: number) => padL + (count > 1 ? (i / (count - 1)) * plotW : plotW / 2);
    const fmt = (v: number) => v.toFixed(Math.abs(hi - lo) < 1 ? 4 : 2);

    return (
        <svg
            className='analysis-tool__chart'
            viewBox={`0 0 ${W} ${H}`}
            role='img'
            aria-label='Bollinger bands over tick quotes'
        >
            <text x={padL - 6} y={yOf(hi) + 3} textAnchor='end' className='analysis-tool__axis'>
                {fmt(hi)}
            </text>
            <text x={padL - 6} y={yOf(lo) + 3} textAnchor='end' className='analysis-tool__axis'>
                {fmt(lo)}
            </text>
            <polyline points={linePoints(bands.upper, xOf, yOf)} fill='none' className='analysis-tool__band' />
            <polyline points={linePoints(bands.lower, xOf, yOf)} fill='none' className='analysis-tool__band' />
            <polyline points={linePoints(bands.middle, xOf, yOf)} fill='none' className='analysis-tool__band-mid' />
            <polyline points={linePoints(quotes, xOf, yOf)} fill='none' className='analysis-tool__line' />
            <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} className='analysis-tool__axis-line' />
            <text x={padL} y={H - 6} className='analysis-tool__axis'>
                oldest
            </text>
            <text x={W - padR} y={H - 6} textAnchor='end' className='analysis-tool__axis'>
                latest
            </text>
        </svg>
    );
};

const AnalysisToolPage = observer(() => {
    const { client } = useStore() ?? {};
    const isLoggedIn = Boolean(client?.is_logged_in);
    const activeLoginid = client?.loginid || '';
    const isDemo = isDemoAccount(activeLoginid);

    const [symbol, setSymbol] = useState('R_50');
    const [range, setRange] = useState(500);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ticks, setTicks] = useState<HistoricalTicks | null>(null);

    const run = async () => {
        setLoading(true);
        setError(null);
        setTicks(null);
        try {
            const history = await fetchHistoricalTicks(symbol, range);
            setTicks(history);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load ticks');
        } finally {
            setLoading(false);
        }
    };

    const analysis = useMemo<Analysis | null>(() => {
        if (!ticks) return null;
        const digits = ticks.digits;
        const quotes = ticks.quotes;
        const n = digits.length;
        const counts = computeDigitCounts(digits);
        const freqs = counts.map(c => (n > 0 ? c / n : 0));
        const cis = counts.map(c => wilsonInterval(c, n)) as Array<[number, number]>;
        const uniformity = chiSquareUniformity(counts);

        const rows: BarrierRow[] = BARRIERS.map(b => ({
            barrier: b,
            overEmp: empiricalProbability(digits, 'over', b),
            overTheo: theoreticalProbability('over', b),
            underEmp: empiricalProbability(digits, 'under', b),
            underTheo: theoreticalProbability('under', b),
        }));

        let strongest = { label: '—', gap: -Infinity, emp: 0, theo: 0 };
        for (const r of rows) {
            const overGap = r.overEmp - r.overTheo;
            if (overGap > strongest.gap) {
                strongest = { label: `Over ${r.barrier}`, gap: overGap, emp: r.overEmp, theo: r.overTheo };
            }
            const underGap = r.underEmp - r.underTheo;
            if (underGap > strongest.gap) {
                strongest = { label: `Under ${r.barrier}`, gap: underGap, emp: r.underEmp, theo: r.underTheo };
            }
        }
        if (!Number.isFinite(strongest.gap)) strongest = { label: '—', gap: 0, emp: 0, theo: 0 };

        const rsiSeries = quotes.length ? quotes.map((_, i) => computeRsi(quotes.slice(0, i + 1))) : [];

        return {
            digits,
            quotes,
            pipSize: ticks.pipSize,
            n,
            counts,
            freqs,
            cis,
            chiSquare: uniformity.chiSquare,
            chiDf: uniformity.df,
            chiP: uniformity.pValue,
            rows,
            strongest,
            rsiSeries,
            macdData: quotes.length >= 30 ? macd(quotes) : null,
            bands: quotes.length >= 20 ? bollinger(quotes) : null,
        };
    }, [ticks]);

    const uniformOk = analysis ? analysis.chiP > 0.05 : true;
    const rsiLatest = analysis && analysis.rsiSeries.length ? analysis.rsiSeries[analysis.rsiSeries.length - 1] : null;
    const macdLatest = analysis?.macdData ? latest(analysis.macdData.macd) : null;
    const signalLatest = analysis?.macdData ? latest(analysis.macdData.signal) : null;
    const histLatest = analysis?.macdData ? latest(analysis.macdData.histogram) : null;
    const percentBLatest = analysis?.bands ? latest(analysis.bands.percentB) : null;

    return (
        <div className='analysis-tool'>
            <header className='analysis-tool__head'>
                <div>
                    <h2>Analysis Tool</h2>
                    <p className='analysis-tool__sub'>
                        Digit distribution, over/under deviations and chart indicators (RSI, MACD, Bollinger) over real
                        Deriv tick history — drawn with plain SVG, no chart library.
                    </p>
                </div>
                <div className='analysis-tool__status'>
                    <span
                        className={`analysis-tool__badge ${
                            loading ? 'analysis-tool__badge--load' : analysis ? 'analysis-tool__badge--ready' : 'analysis-tool__badge--idle'
                        }`}
                    >
                        {loading ? 'loading' : analysis ? 'ready' : 'idle'}
                    </span>
                    <span className={`analysis-tool__acct ${isDemo ? 'analysis-tool__acct--demo' : ''}`}>
                        {!isLoggedIn ? 'Guest · analysis only' : `${isDemo ? 'Demo' : 'Real'} · ${activeLoginid}`}
                    </span>
                </div>
            </header>

            <div className='analysis-tool__notice' role='note'>
                <strong>Honest note:</strong> everything here is measured on PAST ticks. Digit frequencies and
                indicators describe history — they do not predict the next tick, and no panel is a trade signal.
            </div>

            <section className='analysis-tool__controls'>
                <label>
                    Symbol
                    <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                        {SYMBOLS.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Range
                    <select value={range} onChange={e => setRange(Number(e.target.value))}>
                        {RANGES.map(r => (
                            <option key={r} value={r}>
                                Last {r} ticks
                            </option>
                        ))}
                    </select>
                </label>
                <button className='analysis-tool__run' onClick={run} disabled={loading}>
                    {loading ? 'Loading…' : 'Run analysis'}
                </button>
            </section>

            {error && <div className='analysis-tool__error' role='alert'>{error}</div>}

            {analysis && (
                <div className='analysis-tool__data-note'>
                    Loaded {analysis.n} real ticks for {symbol} (pip size {analysis.pipSize}) — {analysis.quotes.length}{' '}
                    quotes available for the indicator panels.
                </div>
            )}

            {!analysis && !error && !loading && (
                <p className='analysis-tool__empty'>
                    Pick a symbol and a range, then run the analysis to see digit statistics and indicators.
                </p>
            )}

            {loading && <p className='analysis-tool__empty'>Loading real tick history…</p>}

            {analysis && (
                <>
                    <div className='analysis-tool__grid analysis-tool__grid--verdicts'>
                        <div className='analysis-tool__verdict'>
                            <span className='analysis-tool__verdict-label'>Strongest over / under deviation</span>
                            <strong>
                                {analysis.strongest.label} {signedPct(analysis.strongest.gap)}
                            </strong>
                            <span>
                                Empirical {pct(analysis.strongest.emp)} vs fair {pct(analysis.strongest.theo)} across{' '}
                                {analysis.n} ticks — a sample deviation, not a tradeable edge.
                            </span>
                        </div>
                        <div
                            className={`analysis-tool__verdict ${
                                uniformOk ? 'analysis-tool__verdict--ok' : 'analysis-tool__verdict--warn'
                            }`}
                        >
                            <span className='analysis-tool__verdict-label'>Digit uniformity (chi-square)</span>
                            <strong>{uniformOk ? 'Consistent with uniform' : 'Deviates from uniform'}</strong>
                            <span>
                                χ² = {analysis.chiSquare.toFixed(2)} on {analysis.chiDf} df, p ={' '}
                                {analysis.chiP.toFixed(3)} —{' '}
                                {uniformOk
                                    ? 'equal digit frequencies are not rejected at the 5% level on this sample.'
                                    : 'digit frequencies differ from equal at the 5% level on this sample.'}
                            </span>
                        </div>
                    </div>

                    <div className='analysis-tool__panels'>
                        <section className='analysis-tool__panel'>
                            <h3>Digit frequency (0–9)</h3>
                            <p className='analysis-tool__panel-note'>
                                Bars are the empirical share of each last digit; whiskers are the Wilson 95% confidence
                                interval; the dashed line is the fair 10%.
                            </p>
                            <DigitChart counts={analysis.counts} n={analysis.n} />
                        </section>

                        <section className='analysis-tool__panel'>
                            <h3>RSI (14)</h3>
                            <p className='analysis-tool__panel-note'>
                                Wilder RSI recomputed at each tick of the loaded quotes. Current reading:{' '}
                                <strong>{rsiLatest != null ? rsiLatest.toFixed(1) : '—'}</strong> — 30/70 guide lines
                                shown dashed.
                            </p>
                            {analysis.rsiSeries.length > 1 ? (
                                <RsiChart values={analysis.rsiSeries} />
                            ) : (
                                <p className='analysis-tool__empty'>Not enough quotes for an RSI line.</p>
                            )}
                        </section>

                        <section className='analysis-tool__panel'>
                            <h3>MACD (12 / 26 / 9)</h3>
                            <p className='analysis-tool__panel-note'>
                                Histogram plus MACD and signal lines over quotes. Latest: MACD{' '}
                                <strong>{macdLatest != null ? macdLatest.toFixed(4) : 'warming up'}</strong>, signal{' '}
                                <strong>{signalLatest != null ? signalLatest.toFixed(4) : 'warming up'}</strong>,
                                histogram <strong>{histLatest != null ? histLatest.toFixed(4) : 'warming up'}</strong>.
                            </p>
                            {analysis.macdData ? (
                                <MacdChart data={analysis.macdData} count={analysis.quotes.length} />
                            ) : (
                                <p className='analysis-tool__empty'>Need at least 30 quotes for MACD.</p>
                            )}
                        </section>

                        <section className='analysis-tool__panel'>
                            <h3>Bollinger bands (20, 2σ)</h3>
                            <p className='analysis-tool__panel-note'>
                                Upper / lower bands (dashed), middle SMA and the quote line over the loaded ticks.
                                Latest %B <strong>{percentBLatest != null ? percentBLatest.toFixed(2) : '—'}</strong>.
                            </p>
                            {analysis.bands ? (
                                <BollingerChart quotes={analysis.quotes} bands={analysis.bands} />
                            ) : (
                                <p className='analysis-tool__empty'>Need at least 20 quotes for Bollinger bands.</p>
                            )}
                        </section>
                    </div>

                    <section className='analysis-tool__panel analysis-tool__panel--wide'>
                        <h3>Over / Under by barrier</h3>
                        <p className='analysis-tool__panel-note'>
                            Empirical share vs fair probability for every barrier. Chi-square uniformity verdict on
                            digits 0–9:{' '}
                            <strong className={uniformOk ? 'pos' : 'neg'}>
                                {uniformOk
                                    ? `not rejected (p = ${analysis.chiP.toFixed(3)})`
                                    : `skewed (p = ${analysis.chiP.toFixed(3)})`}
                            </strong>
                        </p>
                        <div className='analysis-tool__table-wrap'>
                            <table className='analysis-tool__table'>
                                <thead>
                                    <tr>
                                        <th>Barrier</th>
                                        <th>Over empirical</th>
                                        <th>Over fair</th>
                                        <th>Over gap</th>
                                        <th>Under empirical</th>
                                        <th>Under fair</th>
                                        <th>Under gap</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {analysis.rows.map(r => {
                                        const overGap = r.overEmp - r.overTheo;
                                        const underGap = r.underEmp - r.underTheo;
                                        return (
                                            <tr key={r.barrier}>
                                                <td>{r.barrier}</td>
                                                <td>{pct(r.overEmp)}</td>
                                                <td>{pct(r.overTheo)}</td>
                                                <td className={overGap > 0 ? 'pos' : overGap < 0 ? 'neg' : ''}>
                                                    {signedPct(overGap)}
                                                </td>
                                                <td>{pct(r.underEmp)}</td>
                                                <td>{pct(r.underTheo)}</td>
                                                <td className={underGap > 0 ? 'pos' : underGap < 0 ? 'neg' : ''}>
                                                    {signedPct(underGap)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
});

export default AnalysisToolPage;
