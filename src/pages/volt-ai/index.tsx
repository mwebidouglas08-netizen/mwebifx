import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { HubSessionSnapshot, HubTradeIntent } from '@/bot/engine/hub-session';
import { useHubSession } from '@/bot/use-hub-session';
import { SymbolSeries } from '@/bot/deriv/ticks';
import { VOL_MARKETS } from '../hub/markets';
import './volt-ai.scss';

type VoltPair = 'over-under' | 'even-odd';

const RECOVERY_WAIT = 6;

const fmtMoney = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USD`;
const fmtPct = (n: number): string => `${n.toFixed(1)}%`;

const voltEvaluate =
    (pairRef: { current: VoltPair }) =>
    (symbol: string, series: SymbolSeries, state: HubSessionSnapshot): HubTradeIntent | null => {
        const digits = series.digits;
        if (digits.length < 10) return null;
        const last = state.rows[0];
        const recovering = !!last && last.result === 'loss' && last.symbol !== undefined;
        if (recovering) {
            const tail = digits.slice(-RECOVERY_WAIT);
            if (tail.length < RECOVERY_WAIT) return null;
            const allEven = tail.every(d => d % 2 === 0);
            const allOdd = tail.every(d => d % 2 === 1);
            if (!allEven && !allOdd) return null;
            if (pairRef.current === 'even-odd') {
                return { symbol, contractType: allEven ? 'DIGITEVEN' : 'DIGITODD' };
            }
            return { symbol, contractType: allEven ? 'DIGITUNDER' : 'DIGITOVER', barrier: allEven ? 5 : 4 };
        }
        const tail = digits.slice(-8);
        if (pairRef.current === 'even-odd') {
            const evens = tail.filter(d => d % 2 === 0).length;
            if (evens >= 6) return { symbol, contractType: 'DIGITEVEN' };
            if (tail.length - evens >= 6) return { symbol, contractType: 'DIGITODD' };
            return null;
        }
        const lows = tail.filter(d => d < 5).length;
        const highs = tail.filter(d => d > 4).length;
        if (lows >= 6) return { symbol, contractType: 'DIGITUNDER', barrier: 5 };
        if (highs >= 6) return { symbol, contractType: 'DIGITOVER', barrier: 4 };
        return null;
    };

const VoltAIPage = observer(() => {
    const pairRef = useRef<VoltPair>('over-under');
    const [pair, setPair] = useState<VoltPair>('over-under');
    const [stake, setStake] = useState(1);
    const [takeProfit, setTakeProfit] = useState(10);
    const [stopLoss, setStopLoss] = useState(50);
    const [martingale, setMartingale] = useState(2);

    const { session, snap } = useHubSession(() => ({
        symbols: VOL_MARKETS.map(m => m.symbol),
        stake: 1,
        martingale: 2,
        takeProfit: 10,
        stopLoss: 50,
        durationTicks: 1,
        nameOf: s => VOL_MARKETS.find(m => m.symbol === s)?.name || s,
        evaluate: voltEvaluate(pairRef),
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

    const selectPair = (p: VoltPair) => {
        pairRef.current = p;
        setPair(p);
    };

    const running = snap.running;
    const winRate = snap.trades ? (snap.wins * 100) / snap.trades : 0;

    return (
        <div className='volt-ai'>
            <div className='volt-ai__hero'>
                <div className='volt-ai__hero-text'>
                    <h1 className='volt-ai__title'>
                        Volt <em>AI</em>
                    </h1>
                    <p className='volt-ai__subtitle'>
                        Multi-market digit scanner. Hunts extreme digit streaks across 13 volatility markets, rides
                        Under&nbsp;5 / Over&nbsp;4 and recovers with a stake multiplier.
                    </p>
                </div>
                <div className='volt-ai__hero-actions'>
                    <span className={`volt-ai__status ${running ? 'volt-ai__status--live' : ''}`}>
                        <i /> {running ? 'SCANNER LIVE' : 'IDLE'}
                    </span>
                    {running ? (
                        <button type='button' className='volt-ai__btn volt-ai__btn--stop' onClick={() => session.stop()}>
                            Stop AI
                        </button>
                    ) : (
                        <button type='button' className='volt-ai__btn' onClick={() => session.start()}>
                            ▶ Start AI
                        </button>
                    )}
                </div>
            </div>

            <div className='volt-ai__config'>
                <label className='volt-ai__field'>
                    <span>Stake</span>
                    <div className='volt-ai__input'>
                      USD <input type='number' min='0.35' step='0.5' value={stake} onChange={e => sync({ stake: Number(e.target.value) })} />
                    </div>
                </label>
                <label className='volt-ai__field'>
                    <span>Take Profit</span>
                    <div className='volt-ai__input'>
                      USD <input type='number' min='0' step='1' value={takeProfit} onChange={e => sync({ takeProfit: Number(e.target.value) })} />
                    </div>
                </label>
                <label className='volt-ai__field'>
                    <span>Stop Loss</span>
                    <div className='volt-ai__input'>
                      USD <input type='number' min='0' step='1' value={stopLoss} onChange={e => sync({ stopLoss: Number(e.target.value) })} />
                    </div>
                </label>
                <label className='volt-ai__field'>
                    <span>Martingale</span>
                    <select value={martingale} onChange={e => sync({ martingale: Number(e.target.value) })}>
                        <option value={1}>OFF</option>
                        <option value={1.5}>×1.5</option>
                        <option value={2}>×2</option>
                        <option value={3}>×3</option>
                    </select>
                </label>
                <div className='volt-ai__field'>
                    <span>Recovery pair</span>
                    <div className='volt-ai__pair'>
                        <button type='button' className={pair === 'over-under' ? 'is-active' : ''} onClick={() => selectPair('over-under')}>
                            Over 4 / Under 5
                        </button>
                        <button type='button' className={pair === 'even-odd' ? 'is-active' : ''} onClick={() => selectPair('even-odd')}>
                            Even / Odd
                        </button>
                    </div>
                </div>
            </div>

            <p className='volt-ai__rule'>
                Recovery rule: after a loss, multiply the stake and wait for six matching digits before the next
                trade. Digit-extreme bias (six of the last eight digits on one side) opens every session.
            </p>

            <div className='volt-ai__stats'>
                <div className='volt-ai__stat'>
                    <span>Markets scanned</span>
                    <strong>
                        {VOL_MARKETS.length} / {VOL_MARKETS.length}
                    </strong>
                </div>
                <div className='volt-ai__stat'>
                    <span>Ticks processed</span>
                    <strong>{snap.tickCount.toLocaleString()}</strong>
                </div>
                <div className='volt-ai__stat'>
                    <span>Trades</span>
                    <strong>
                        {snap.wins}W / {snap.losses}L
                    </strong>
                </div>
                <div className='volt-ai__stat'>
                    <span>Win rate</span>
                    <strong>{fmtPct(winRate)}</strong>
                </div>
                <div className={`volt-ai__stat ${snap.profit > 0 ? 'is-win' : snap.profit < 0 ? 'is-loss' : ''}`}>
                    <span>Total P/L</span>
                    <strong>{fmtMoney(snap.profit)}</strong>
                </div>
            </div>

            <div className='volt-ai__tables'>
                <section className='volt-ai__panel'>
                    <header>
                        <h2>Live market scan</h2>
                        <span className='volt-ai__panel-sub'>{running ? `${VOL_MARKETS.length} markets · live ticks` : 'Scanner idle'}</span>
                    </header>
                    <table className='volt-ai__table'>
                        <thead>
                            <tr>
                                <th>Market</th>
                                <th>Price</th>
                                <th>Last digits</th>
                                <th>Ticks</th>
                            </tr>
                        </thead>
                        <tbody>
                            {VOL_MARKETS.map(m => {
                                const digits = snap.digits[m.symbol] || [];
                                return (
                                    <tr key={m.symbol}>
                                        <td>{m.name}</td>
                                        <td className='volt-ai__mono'>{snap.quotes[m.symbol] ? snap.quotes[m.symbol].toFixed(3) : '—'}</td>
                                        <td>
                                            <span className='volt-ai__digits'>
                                                {digits.length
                                                    ? digits
                                                          .slice(-5)
                                                          .map((d, i) => <i key={`${m.symbol}-${digits.length - 5 + i}`}>{d}</i>)
                                                    : '—'}
                                            </span>
                                        </td>
                                        <td className='volt-ai__mono'>{snap.marketTicks[m.symbol] || 0}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </section>

                <section className='volt-ai__panel'>
                    <header>
                        <h2>Session trades</h2>
                        <span className='volt-ai__panel-sub'>{snap.trades} closed</span>
                    </header>
                    <table className='volt-ai__table'>
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
                                snap.rows.map(row => (
                                    <tr key={row.id}>
                                        <td>{row.name}</td>
                                        <td>{row.contract}</td>
                                        <td className='volt-ai__mono'>{row.stake.toFixed(2)}</td>
                                        <td className={`volt-ai__mono ${row.result === 'win' ? 'is-win' : 'is-loss'}`}>{fmtMoney(row.profit)}</td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={4} className='volt-ai__empty'>
                                        No trades yet — start the scanner to begin.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    <div className='volt-ai__console' aria-live='polite'>
                        {snap.journal.slice(-8).map((line, i) => (
                            <p key={`${i}-${line.slice(0, 12)}`}>{line}</p>
                        ))}
                        {!snap.journal.length && <p>Scanner ready. Press Start AI to activate 13 markets.</p>}
                    </div>
                </section>
            </div>
        </div>
    );
});

export default VoltAIPage;
export { VoltAIPage };
