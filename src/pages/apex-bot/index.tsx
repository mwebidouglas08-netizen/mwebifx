import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { HubSessionSnapshot, HubTradeIntent } from '@/bot/engine/hub-session';
import { useHubSession } from '@/bot/use-hub-session';
import { SymbolSeries } from '@/bot/deriv/ticks';
import { VOL_MARKETS } from '../hub/markets';
import '../hub/hub-shared.scss';
import './apex-bot.scss';

const fmt = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USD`;

const resolveApex = (series: SymbolSeries, symbol: string): HubTradeIntent | null => {
    const digits = series.digits;
    if (digits.length < 15) return null;
    const last = digits[digits.length - 1];
    const prev = digits[digits.length - 2];
    if (last >= 8 && prev >= 7) return { symbol, contractType: 'DIGITUNDER', barrier: 7 };
    if (last <= 1 && prev <= 2) return { symbol, contractType: 'DIGITOVER', barrier: 2 };
    return null;
};

const patternStats = (digits: number[]): string => {
    if (digits.length < 6) return 'Top — | Last — | O>4 —% | U<5 —%';
    const tail = digits.slice(-10);
    const top = tail.reduce((a, b) => (tail.filter(v => v === b).length > tail.filter(v => v === a).length ? b : a), tail[0]);
    const last = tail[tail.length - 1];
    const over = (tail.filter(d => d > 4).length * 100) / tail.length;
    return `Top ${tail.filter(d => d === top).length} | Last ${last} | O>4 ${over.toFixed(0)}% | U<5 ${(100 - over).toFixed(0)}%`;
};

const ApexBotPage = observer(() => {
    const [stake, setStake] = useState(0.5);
    const [takeProfit, setTakeProfit] = useState(10);
    const [stopLoss, setStopLoss] = useState(25);
    const [martingale, setMartingale] = useState(2);

    const { session, snap } = useHubSession(() => ({
        symbols: VOL_MARKETS.map(m => m.symbol),
        stake: 0.5,
        martingale: 2,
        takeProfit: 10,
        stopLoss: 25,
        durationTicks: 1,
        nameOf: s => VOL_MARKETS.find(m => m.symbol === s)?.name || s,
        evaluate: (symbol: string, series: SymbolSeries, _state: HubSessionSnapshot): HubTradeIntent | null => resolveApex(series, symbol),
    }));

    const sync = (patch: { stake?: number; takeProfit?: number; stopLoss?: number; martingale?: number }) => {
        if (patch.stake !== undefined) setStake(patch.stake);
        if (patch.takeProfit !== undefined) setTakeProfit(patch.takeProfit);
        if (patch.stopLoss !== undefined) setStopLoss(patch.stopLoss);
        if (patch.martingale !== undefined) setMartingale(patch.martingale);
        session.updateOptions({
            stake: patch.stake ?? stake,
            takeProfit: patch.takeProfit ?? takeProfit,
            stopLoss: patch.stopLoss ?? stopLoss,
            martingale: patch.martingale ?? martingale,
        });
    };

    const winRate = snap.trades ? (snap.wins * 100) / snap.trades : 0;

    return (
        <div className='hub-page apex-bot'>
            <div className='hub-page__hero'>
                <div>
                    <h1 className='hub-page__title'>Apex Bot</h1>
                    <p className='hub-page__subtitle'>
                        Neutrade-style extreme-digit recovery bot. Sells Over 2 after ≤1 clusters and Under 7 after
                        ≥8 clusters across 13 subscribed markets.
                    </p>
                </div>
                <div className='hub-page__actions'>
                    <span className={`hub-pill ${snap.running ? '' : 'hub-pill--grey'}`}>{snap.running ? '● Running' : '○ Stopped'}</span>
                    {snap.running ? (
                        <button type='button' className='hub-btn hub-btn--stop' onClick={() => session.stop()}>
                            Stop bot
                        </button>
                    ) : (
                        <button type='button' className='hub-btn' onClick={() => session.start()}>
                            ▶ Start bot
                        </button>
                    )}
                </div>
            </div>

            <div className='apex-bot__stats'>
                <div className='apex-bot__stat'>
                    <span>Total P/L</span>
                    <strong className={snap.profit > 0 ? 'is-win' : snap.profit < 0 ? 'is-loss' : ''}>{fmt(snap.profit)}</strong>
                </div>
                <div className='apex-bot__stat'>
                    <span>Won</span>
                    <strong className='is-win'>{snap.wins}</strong>
                </div>
                <div className='apex-bot__stat'>
                    <span>Lost</span>
                    <strong className='is-loss'>{snap.losses}</strong>
                </div>
                <div className='apex-bot__stat'>
                    <span>Win rate</span>
                    <strong>{winRate.toFixed(1)}%</strong>
                </div>
            </div>

            <div className='apex-bot__body'>
                <section className='hub-page__panel'>
                    <header>
                        <h2>Risk controls</h2>
                    </header>
                    <div className='apex-bot__form'>
                        <label className='hub-field'>
                            <span>Stake</span>
                            <input type='number' min='0.35' step='0.1' value={stake} onChange={e => sync({ stake: Number(e.target.value) })} />
                        </label>
                        <label className='hub-field'>
                            <span>Take profit</span>
                            <input type='number' min='0' value={takeProfit} onChange={e => sync({ takeProfit: Number(e.target.value) })} />
                        </label>
                        <label className='hub-field'>
                            <span>Stop loss</span>
                            <input type='number' min='0' value={stopLoss} onChange={e => sync({ stopLoss: Number(e.target.value) })} />
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
                    </div>
                    <header className='apex-bot__subhead'>
                        <h3>Trade history</h3>
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
                                        No trades yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </section>

                <section className='hub-page__panel'>
                    <header>
                        <h2>Active Markets</h2>
                        <span className='apex-bot__sub'>{VOL_MARKETS.length}/{VOL_MARKETS.length} Subscribed · Live</span>
                    </header>
                    <table className='hub-table'>
                        <thead>
                            <tr>
                                <th>Market</th>
                                <th>Price</th>
                                <th>Digits</th>
                                <th>Pattern stats</th>
                                <th>Over 2</th>
                                <th>Under 7</th>
                            </tr>
                        </thead>
                        <tbody>
                            {VOL_MARKETS.map(m => {
                                const digits = snap.digits[m.symbol] || [];
                                const last = digits[digits.length - 1];
                                const over2 = digits.length && last <= 1;
                                const under7 = digits.length && last >= 8;
                                return (
                                    <tr key={m.symbol}>
                                        <td>{m.name}</td>
                                        <td className='hub-page__mono'>{snap.quotes[m.symbol] ? snap.quotes[m.symbol].toFixed(3) : '—'}</td>
                                        <td>
                                            <span className='hub-digits'>
                                                {digits.length ? digits.slice(-3).map((d, i) => <i key={`${m.symbol}-${digits.length - 3 + i}`}>{d}</i>) : '—'}
                                            </span>
                                        </td>
                                        <td className='apex-bot__pattern'>{patternStats(digits)}</td>
                                        <td>{over2 ? <span className='hub-pill hub-pill--teal'>Yes</span> : 'No'}</td>
                                        <td>{under7 ? <span className='hub-pill'>Yes</span> : 'No'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className='hub-page__console' aria-live='polite'>
                        {snap.journal.slice(-6).map((line, i) => (
                            <p key={`${i}-${line.slice(0, 10)}`}>{line}</p>
                        ))}
                        {!snap.journal.length && <p>Markets subscribed. Bot stopped.</p>}
                    </div>
                </section>
            </div>
        </div>
    );
});

export default ApexBotPage;
