import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { HubContractType, HubSessionSnapshot, HubTradeIntent } from '@/bot/engine/hub-session';
import { useHubSession } from '@/bot/use-hub-session';
import { SymbolSeries } from '@/bot/deriv/ticks';
import { VOL_MARKETS } from '../hub/markets';
import '../hub/hub-shared.scss';
import './automated.scss';

type Mode = 'DIGITS' | 'PERCENTAGES';
type ReAnalyze = 'EVERY_TRADE' | 'AFTER_N' | 'FIRST_ENTRY' | 'AFTER_LOSS';

interface RulePanel {
    id: string;
    title: string;
    mode: Mode;
    enabled: boolean;
    n: number;
    digit: number;
    thenType: HubContractType;
    thenBarrier: number;
    percentAtLeast: number;
    percentSide: 'EVEN' | 'OVER';
}

const fmt = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USD`;

const INITIAL: RulePanel[] = [
    { id: 'eo-digits', title: 'Even / Odd (Digits)', mode: 'DIGITS', enabled: true, n: 4, digit: 0, thenType: 'DIGITEVEN', thenBarrier: 0, percentAtLeast: 60, percentSide: 'EVEN' },
    { id: 'eo-pct', title: 'Even / Odd (Percentages)', mode: 'PERCENTAGES', enabled: false, n: 20, digit: 0, thenType: 'DIGITODD', thenBarrier: 0, percentAtLeast: 65, percentSide: 'EVEN' },
    { id: 'ou-digits', title: 'Over / Under (Digits)', mode: 'DIGITS', enabled: false, n: 3, digit: 8, thenType: 'DIGITUNDER', thenBarrier: 7, percentAtLeast: 60, percentSide: 'OVER' },
    { id: 'ou-pct', title: 'Over / Under (Percentages)', mode: 'PERCENTAGES', enabled: false, n: 20, digit: 0, thenType: 'DIGITOVER', thenBarrier: 2, percentAtLeast: 62, percentSide: 'OVER' },
    { id: 'rf', title: 'Rise / Fall', mode: 'DIGITS', enabled: false, n: 5, digit: 9, thenType: 'PUT', thenBarrier: 0, percentAtLeast: 60, percentSide: 'EVEN' },
    { id: 'md', title: 'Matches / Differs', mode: 'DIGITS', enabled: false, n: 2, digit: 0, thenType: 'DIGITDIFF', thenBarrier: 5, percentAtLeast: 60, percentSide: 'EVEN' },
];

const evaluatePanels = (
    panels: RulePanel[],
    trades: number,
    afterLoss: boolean,
    series: SymbolSeries,
    symbol: string
): HubTradeIntent | null => {
    const digits = series.digits;
    const quotes = series.quotes;
    if (digits.length < 10) return null;
    for (const p of panels) {
        if (!p.enabled) continue;
        if (p.mode === 'PERCENTAGES') {
            const window = digits.slice(-Math.max(2, p.n));
            const pct = p.percentSide === 'EVEN' ? (window.filter(d => d % 2 === 0).length * 100) / window.length : (window.filter(d => d > 4).length * 100) / window.length;
            if (pct >= p.percentAtLeast) {
                return { symbol, contractType: p.thenType, barrier: p.thenType.startsWith('DIGIT') && p.thenType !== 'DIGITEVEN' && p.thenType !== 'DIGITODD' ? p.thenBarrier : undefined };
            }
            continue;
        }
        const tail = digits.slice(-p.n);
        if (tail.length < p.n) continue;
        if (p.id === 'rf') {
            let rising = true;
            let falling = true;
            for (let i = 1; i < quotes.length; i += 1) {
                if (quotes[i] <= quotes[i - 1]) rising = false;
                if (quotes[i] >= quotes[i - 1]) falling = false;
            }
            if (rising) return { symbol, contractType: 'PUT' };
            if (falling) return { symbol, contractType: 'CALL' };
            continue;
        }
        if (p.id.startsWith('eo')) {
            const allEven = tail.every(d => d % 2 === 0);
            const allOdd = tail.every(d => d % 2 === 1);
            if (allEven) return { symbol, contractType: 'DIGITEVEN' };
            if (allOdd) return { symbol, contractType: 'DIGITODD' };
            continue;
        }
        if (p.id.startsWith('ou')) {
            const allHigh = tail.every(d => d > 4);
            const allLow = tail.every(d => d < 5);
            if (allHigh) return { symbol, contractType: 'DIGITUNDER', barrier: p.thenBarrier || 7 };
            if (allLow) return { symbol, contractType: 'DIGITOVER', barrier: p.thenBarrier || 2 };
            continue;
        }
        if (p.id === 'md') {
            const last = digits[digits.length - 1];
            if (last === p.digit) return { symbol, contractType: 'DIGITDIFF', barrier: p.digit };
            continue;
        }
    }
    void trades;
    void afterLoss;
    return null;
};

const AutomatedPage = observer(() => {
    const [panels, setPanels] = useState<RulePanel[]>(INITIAL);
    const [reAnalyze, setReAnalyze] = useState<ReAnalyze>('EVERY_TRADE');
    const [everyN, setEveryN] = useState(3);
    const [ticks, setTicks] = useState(1);
    const [stake, setStake] = useState(0.5);
    const [martingale, setMartingale] = useState(2);

    const cfgRef = useRef({ panels, reAnalyze, everyN });
    cfgRef.current = { panels, reAnalyze, everyN };

    const { session, snap } = useHubSession(() => ({
        symbols: VOL_MARKETS.map(m => m.symbol),
        stake: 0.5,
        martingale: 2,
        takeProfit: 0,
        stopLoss: 0,
        durationTicks: 1,
        nameOf: s => VOL_MARKETS.find(m => m.symbol === s)?.name || s,
        evaluate: (symbol: string, series: SymbolSeries, state: HubSessionSnapshot): HubTradeIntent | null => {
            const cfg = cfgRef.current;
            const n = state.trades;
            const lastLoss = state.rows[0]?.result === 'loss';
            const ok =
                cfg.reAnalyze === 'EVERY_TRADE'
                    ? true
                    : cfg.reAnalyze === 'FIRST_ENTRY'
                      ? n === 0
                      : cfg.reAnalyze === 'AFTER_LOSS'
                        ? lastLoss
                        : n > 0 && n % Math.max(1, cfg.everyN) === 0;
            if (!ok) return null;
            return evaluatePanels(cfg.panels, n, lastLoss, series, symbol);
        },
    }));

    const updatePanel = (id: string, patch: Partial<RulePanel>) => {
        setPanels(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
    };

    const sync = (patch: { stake?: number; ticks?: number; martingale?: number }) => {
        if (patch.stake !== undefined) setStake(patch.stake);
        if (patch.ticks !== undefined) setTicks(patch.ticks);
        if (patch.martingale !== undefined) setMartingale(patch.martingale);
        session.updateOptions({
            stake: patch.stake ?? stake,
            durationTicks: patch.ticks ?? ticks,
            martingale: patch.martingale ?? martingale,
        });
    };

    const enabledCount = panels.filter(p => p.enabled).length;

    return (
        <div className='hub-page automated'>
            <div className='hub-page__hero'>
                <div>
                    <h1 className='hub-page__title'>Automated</h1>
                    <p className='hub-page__subtitle'>
                        Rule-based automation. Build “Check if last N digits are X → Then trade Y” statements across
                        Even/Odd, Over/Under, Rise/Fall and Matches/Differs, then let the engine re-analyze on its
                        schedule.
                    </p>
                </div>
                <div className='hub-page__actions'>
                    <span className={`hub-pill ${snap.running ? '' : 'hub-pill--grey'}`}>
                        {snap.running ? '◌ Scanning' : '◌ Waiting'}
                    </span>
                    {snap.running ? (
                        <button type='button' className='hub-btn hub-btn--stop' onClick={() => session.stop()}>
                            Stop
                        </button>
                    ) : (
                        <button type='button' className='hub-btn' disabled={!enabledCount} onClick={() => session.start()}>
                            Start
                        </button>
                    )}
                </div>
            </div>

            <div className='automated__controls'>
                <label className='hub-field'>
                    <span>Re-analyze</span>
                    <select value={reAnalyze} onChange={e => setReAnalyze(e.target.value as ReAnalyze)}>
                        <option value='EVERY_TRADE'>On every trade</option>
                        <option value='AFTER_N'>After every N trades</option>
                        <option value='FIRST_ENTRY'>On first entry only</option>
                        <option value='AFTER_LOSS'>After loss only</option>
                    </select>
                </label>
                {reAnalyze === 'AFTER_N' && (
                    <label className='hub-field'>
                        <span>N</span>
                        <input type='number' min='1' value={everyN} onChange={e => setEveryN(Number(e.target.value))} />
                    </label>
                )}
                <label className='hub-field'>
                    <span>Ticks</span>
                    <input type='number' min='1' max='10' value={ticks} onChange={e => sync({ ticks: Number(e.target.value) })} />
                </label>
                <label className='hub-field'>
                    <span>Stake</span>
                    <input type='number' min='0.35' step='0.1' value={stake} onChange={e => sync({ stake: Number(e.target.value) })} />
                </label>
                <label className='hub-field'>
                    <span>Martingale</span>
                    <select value={martingale} onChange={e => sync({ martingale: Number(e.target.value) })}>
                        <option value={1}>OFF</option>
                        <option value={1.5}>×1.5</option>
                        <option value={2}>×2</option>
                        <option value={3}>×3</option>
                    </select>
                </label>
                <span className='automated__pnl hub-page__mono'>
                    P/L {fmt(snap.profit)} · {snap.trades} trades
                </span>
            </div>

            <div className='automated__panels'>
                {panels.map(p => (
                    <section key={p.id} className={`automated__panel ${p.enabled ? 'is-on' : ''}`}>
                        <header>
                            <h2>{p.title}</h2>
                            <label className='automated__toggle'>
                                <input type='checkbox' checked={p.enabled} onChange={e => updatePanel(p.id, { enabled: e.target.checked })} />
                                <span>{p.enabled ? 'Enabled' : 'Disabled'}</span>
                            </label>
                        </header>
                        <div className='automated__mode'>
                            {(['DIGITS', 'PERCENTAGES'] as Mode[]).map(m => (
                                <button key={m} type='button' className={p.mode === m ? 'is-active' : ''} onClick={() => updatePanel(p.id, { mode: m })}>
                                    {m === 'DIGITS' ? 'Digits' : 'Percentages'}
                                </button>
                            ))}
                        </div>
                        {p.mode === 'DIGITS' ? (
                            <p className='automated__sentence'>
                                Check if last{' '}
                                <input type='number' min='1' max='10' value={p.n} onChange={e => updatePanel(p.id, { n: Number(e.target.value) })} />{' '}
                                digits are{' '}
                                <input type='number' min='0' max='9' value={p.digit} onChange={e => updatePanel(p.id, { digit: Number(e.target.value) })} /> →
                                Then trade{' '}
                                <select value={p.thenType} onChange={e => updatePanel(p.id, { thenType: e.target.value as HubContractType })}>
                                    <option value='DIGITEVEN'>Even</option>
                                    <option value='DIGITODD'>Odd</option>
                                    <option value='DIGITOVER'>Over</option>
                                    <option value='DIGITUNDER'>Under</option>
                                    <option value='DIGITMATCH'>Matches</option>
                                    <option value='DIGITDIFF'>Differs</option>
                                    <option value='CALL'>Rise</option>
                                    <option value='PUT'>Fall</option>
                                </select>{' '}
                                {p.thenType === 'DIGITOVER' || p.thenType === 'DIGITUNDER' || p.thenType === 'DIGITMATCH' || p.thenType === 'DIGITDIFF' ? (
                                    <>
                                        <input type='number' min='0' max='9' value={p.thenBarrier} onChange={e => updatePanel(p.id, { thenBarrier: Number(e.target.value) })} />
                                    </>
                                ) : null}
                            </p>
                        ) : (
                            <p className='automated__sentence'>
                                If {p.percentSide === 'EVEN' ? 'Even%' : 'Over%'}{' '}
                                <select value={p.percentSide} onChange={e => updatePanel(p.id, { percentSide: e.target.value as 'EVEN' | 'OVER' })}>
                                    <option value='EVEN'>Even%</option>
                                    <option value='OVER'>Over%</option>
                                </select>{' '}
                                ≥ <input type='number' min='50' max='100' value={p.percentAtLeast} onChange={e => updatePanel(p.id, { percentAtLeast: Number(e.target.value) })} /> over the
                                last <input type='number' min='5' max='100' value={p.n} onChange={e => updatePanel(p.id, { n: Number(e.target.value) })} /> ticks → Then trade{' '}
                                <strong>{p.thenType === 'DIGITEVEN' ? 'Even' : p.thenType === 'DIGITODD' ? 'Odd' : p.thenType === 'DIGITOVER' ? `Over ${p.thenBarrier}` : p.thenType === 'DIGITUNDER' ? `Under ${p.thenBarrier}` : p.thenType}</strong>
                            </p>
                        )}
                    </section>
                ))}
            </div>

            <section className='hub-page__panel'>
                <header>
                    <h2>Session log</h2>
                    <span className='automated__sub'>{enabledCount} rule{enabledCount === 1 ? '' : 's'} active</span>
                </header>
                <table className='hub-table'>
                    <thead>
                        <tr>
                            <th>Market</th>
                            <th>Contract</th>
                            <th>Stake</th>
                            <th>P/L</th>
                        </tr>
                    </thead>
                    <tbody>
                        {snap.rows.length ? (
                            snap.rows.map(r => (
                                <tr key={r.id}>
                                    <td>{r.name}</td>
                                    <td>{r.contract}</td>
                                    <td className='hub-page__mono'>{r.stake.toFixed(2)}</td>
                                    <td className={`hub-page__mono ${r.result === 'win' ? 'is-win' : 'is-loss'}`}>{fmt(r.profit)}</td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={4} className='hub-page__empty'>
                                    Enable at least one rule and press Start.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <div className='hub-page__console' aria-live='polite'>
                    {snap.journal.slice(-6).map((line, i) => (
                        <p key={`${i}-${line.slice(0, 10)}`}>{line}</p>
                    ))}
                    {!snap.journal.length && <p>Waiting for entries…</p>}
                </div>
            </section>
        </div>
    );
});

export default AutomatedPage;
