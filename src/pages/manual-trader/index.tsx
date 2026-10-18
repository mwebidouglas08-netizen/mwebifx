import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { HubContractType } from '@/bot/engine/hub-session';
import { useHubSession } from '@/bot/use-hub-session';
import { VOL_MARKETS } from '../hub/markets';
import '../hub/hub-shared.scss';
import './manual-trader.scss';

const fmt = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USD`;

const ManualTraderPage = observer(() => {
    const [symbol, setSymbol] = useState('R_100');
    const [prediction, setPrediction] = useState(5);
    const [stake, setStake] = useState(1);
    const [durationTicks, setDurationTicks] = useState(1);

    const { session, snap } = useHubSession(() => ({
        symbols: VOL_MARKETS.map(m => m.symbol),
        stake: 1,
        martingale: 1,
        takeProfit: 0,
        stopLoss: 0,
        durationTicks: 1,
        nameOf: s => VOL_MARKETS.find(m => m.symbol === s)?.name || s,
        evaluate: () => null,
    }));

    const digits = snap.digits[symbol] || [];
    const price = snap.quotes[symbol] || 0;

    const buy = (contractType: HubContractType, barrier?: number) => {
        session.updateOptions({ stake, durationTicks });
        void session.buyOnce({ symbol, contractType, barrier }, stake);
    };

    return (
        <div className='hub-page manual-trader'>
            <div className='hub-page__hero'>
                <div>
                    <h1 className='hub-page__title'>Manual Trader</h1>
                    <p className='hub-page__subtitle'>
                        One-tick manual trading terminal. Watch the live price and last digits, then buy Even/Odd,
                        Over/Under, Matches/Differs or Rise/Fall directly.
                    </p>
                </div>
                <div className='hub-page__actions'>
                    <span className={`hub-pill ${snap.busy ? '' : 'hub-pill--grey'}`}>{snap.busy ? 'Contract open…' : 'Ready'}</span>
                </div>
            </div>

            <div className='manual-trader__ticket'>
                <div className='manual-trader__quote'>
                    <label className='hub-field'>
                        <span>Market</span>
                        <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                            {VOL_MARKETS.map(m => (
                                <option key={m.symbol} value={m.symbol}>
                                    {m.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className='manual-trader__price'>
                        <span>Price</span>
                        <strong>{price ? price.toFixed(3) : '—'}</strong>
                    </div>
                    <div className='manual-trader__price'>
                        <span>Last digits</span>
                        <span className='hub-digits'>
                            {digits.length ? digits.slice(-8).map((d, i) => <i key={`${symbol}-m-${digits.length - 8 + i}`}>{d}</i>) : '—'}
                        </span>
                    </div>
                </div>

                <div className='manual-trader__fields'>
                    <label className='hub-field'>
                        <span>Stake</span>
                        <input type='number' min='0.35' step='0.5' value={stake} onChange={e => setStake(Number(e.target.value))} />
                    </label>
                    <label className='hub-field'>
                        <span>Duration (ticks)</span>
                        <input type='number' min='1' max='10' value={durationTicks} onChange={e => setDurationTicks(Number(e.target.value))} />
                    </label>
                    <label className='hub-field'>
                        <span>Prediction</span>
                        <input type='number' min='0' max='9' value={prediction} onChange={e => setPrediction(Math.min(9, Math.max(0, Number(e.target.value))))} />
                    </label>
                </div>

                <div className='manual-trader__buttons'>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => buy('DIGITEVEN')}>
                        Even
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => buy('DIGITODD')}>
                        Odd
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => buy('DIGITOVER', prediction)}>
                        Over {prediction}
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => buy('DIGITUNDER', prediction)}>
                        Under {prediction}
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => buy('DIGITMATCH', prediction)}>
                        Matches {prediction}
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => buy('DIGITDIFF', prediction)}>
                        Differs {prediction}
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => buy('CALL')}>
                        Rise
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => buy('PUT')}>
                        Fall
                    </button>
                </div>
            </div>

            <section className='hub-page__panel'>
                <header>
                    <h2>Recent contracts</h2>
                    <span className='manual-trader__sub'>
                        P/L <strong className={snap.profit >= 0 ? 'is-win' : 'is-loss'}>{fmt(snap.profit)}</strong>
                    </span>
                </header>
                <table className='hub-table'>
                    <thead>
                        <tr>
                            <th>Market</th>
                            <th>Contract</th>
                            <th>Stake</th>
                            <th>Result</th>
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
                                    <td>{r.result === 'win' ? 'Won' : 'Lost'}</td>
                                    <td className={`hub-page__mono ${r.result === 'win' ? 'is-win' : 'is-loss'}`}>{fmt(r.profit)}</td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={5} className='hub-page__empty'>
                                    Your manual contracts appear here.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <div className='hub-page__console' aria-live='polite'>
                    {snap.journal.slice(-6).map((line, i) => (
                        <p key={`${i}-${line.slice(0, 10)}`}>{line}</p>
                    ))}
                    {!snap.journal.length && <p>Manual trader ready.</p>}
                </div>
            </section>
        </div>
    );
});

export default ManualTraderPage;
