import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useHubSession } from '@/bot/use-hub-session';
import { VOL_MARKETS } from '../hub/markets';
import '../hub/hub-shared.scss';
import './hedging-tool.scss';

type HedgeStrategy = 'OVER_UNDER' | 'ONLY_UPS' | 'ONLY_DOWNS' | 'HIGHER_LOWER' | 'TOUCH' | 'NO_TOUCH' | 'ENDS_BETWEEN' | 'ENDS_OUTSIDE' | 'STAYS_BETWEEN' | 'GOES_OUTSIDE';

const STRATEGIES: Array<{ id: HedgeStrategy; label: string; legA: string; legB: string }> = [
    { id: 'OVER_UNDER', label: 'Over 5 / Under 4', legA: 'Over 5', legB: 'Under 4' },
    { id: 'ONLY_UPS', label: 'Only Ups', legA: 'Rise', legB: 'Fall' },
    { id: 'ONLY_DOWNS', label: 'Only Downs', legA: 'Fall', legB: 'Rise' },
    { id: 'HIGHER_LOWER', label: 'Higher / Lower', legA: 'Higher', legB: 'Lower' },
    { id: 'TOUCH', label: 'Touch', legA: 'Touch', legB: 'No Touch' },
    { id: 'NO_TOUCH', label: 'No Touch', legA: 'No Touch', legB: 'Touch' },
    { id: 'ENDS_BETWEEN', label: 'Ends Between', legA: 'Ends Between', legB: 'Ends Outside' },
    { id: 'ENDS_OUTSIDE', label: 'Ends Outside', legA: 'Ends Outside', legB: 'Ends Between' },
    { id: 'STAYS_BETWEEN', label: 'Stays Between', legA: 'Stays Between', legB: 'Goes Outside' },
    { id: 'GOES_OUTSIDE', label: 'Goes Outside', legA: 'Goes Outside', legB: 'Stays Between' },
];

const fmt = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USD`;

const HedgingToolPage = observer(() => {
    const [symbol, setSymbol] = useState('R_100');
    const [strategyId, setStrategyId] = useState<HedgeStrategy>('OVER_UNDER');
    const [stakePerLeg, setStakePerLeg] = useState(0.5);
    const [durationTicks, setDurationTicks] = useState(5);
    const [autoDuration, setAutoDuration] = useState(true);

    const { session, snap } = useHubSession(() => ({
        symbols: VOL_MARKETS.map(m => m.symbol),
        stake: 0.5,
        martingale: 1,
        takeProfit: 0,
        stopLoss: 0,
        durationTicks: 5,
        nameOf: s => VOL_MARKETS.find(m => m.symbol === s)?.name || s,
        evaluate: () => null,
    }));

    const strategy = STRATEGIES.find(s => s.id === strategyId) || STRATEGIES[0];
    const price = snap.quotes[symbol] || 0;
    const digits = snap.digits[symbol] || [];
    const last = digits[digits.length - 1];
    const payoutA = 1.95;
    const payoutB = 1.95;

    const executeHedge = () => {
        session.updateOptions({ durationTicks: autoDuration ? Math.max(1, durationTicks) : durationTicks, stake: stakePerLeg });
        const run = async () => {
            const legA =
                strategyId === 'ONLY_UPS' || strategyId === 'HIGHER_LOWER'
                    ? { symbol, contractType: 'CALL' as const }
                    : strategyId === 'ONLY_DOWNS'
                      ? { symbol, contractType: 'PUT' as const }
                      : strategyId === 'OVER_UNDER'
                        ? { symbol, contractType: 'DIGITOVER' as const, barrier: 5 }
                        : strategyId === 'TOUCH' || strategyId === 'ENDS_BETWEEN' || strategyId === 'STAYS_BETWEEN'
                          ? { symbol, contractType: 'DIGITEVEN' as const }
                          : { symbol, contractType: 'DIGITODD' as const };
            const legB =
                strategyId === 'ONLY_UPS' || strategyId === 'HIGHER_LOWER'
                    ? { symbol, contractType: 'PUT' as const }
                    : strategyId === 'ONLY_DOWNS'
                      ? { symbol, contractType: 'CALL' as const }
                      : strategyId === 'OVER_UNDER'
                        ? { symbol, contractType: 'DIGITUNDER' as const, barrier: 4 }
                        : strategyId === 'TOUCH' || strategyId === 'ENDS_BETWEEN' || strategyId === 'STAYS_BETWEEN'
                          ? { symbol, contractType: 'DIGITODD' as const }
                          : { symbol, contractType: 'DIGITEVEN' as const };
            await session.buyOnce(legA, stakePerLeg);
            await session.buyOnce(legB, stakePerLeg);
        };
        void run();
    };

    return (
        <div className='hub-page hedging-tool'>
            <div className='hub-page__hero'>
                <div>
                    <h1 className='hub-page__title'>Hedging Tool</h1>
                    <p className='hub-page__subtitle'>
                        Fire two opposing contracts at once so one leg always covers the other. Pick the market and
                        hedge strategy, set the stake per leg, and execute.
                    </p>
                </div>
                <div className='hub-page__actions'>
                    <span className={`hub-pill ${snap.busy ? '' : 'hub-pill--grey'}`}>{snap.busy ? 'Executing…' : 'Ready'}</span>
                </div>
            </div>

            <div className='hedging-tool__price'>
                <span>Market price</span>
                <strong>{price ? price.toFixed(3) : '—'}</strong>
                <span className='hub-digits'>
                    {digits.length ? digits.slice(-5).map((d, i) => <i key={`${symbol}-h-${digits.length - 5 + i}`}>{d}</i>) : '—'}
                </span>
                {last !== undefined && <em>Last digit {last}</em>}
            </div>

            <div className='hedging-tool__controls'>
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
                <label className='hub-field'>
                    <span>Strategy</span>
                    <select value={strategyId} onChange={e => setStrategyId(e.target.value as HedgeStrategy)}>
                        {STRATEGIES.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='hub-field'>
                    <span>Stake per leg</span>
                    <input type='number' min='0.35' step='0.1' value={stakePerLeg} onChange={e => setStakePerLeg(Number(e.target.value))} />
                </label>
                <label className='hedging-tool__auto'>
                    <input type='checkbox' checked={autoDuration} onChange={e => setAutoDuration(e.target.checked)} />
                    <span>Auto duration</span>
                </label>
                <label className='hub-field'>
                    <span>Duration (ticks)</span>
                    <input type='number' min='1' max='10' value={durationTicks} onChange={e => setDurationTicks(Number(e.target.value))} disabled={autoDuration} />
                </label>
                <button type='button' className='hub-btn' disabled={snap.busy} onClick={executeHedge}>
                    Execute hedge
                </button>
            </div>

            <div className='hedging-tool__legs'>
                <article className='hedging-tool__leg'>
                    <header>
                        <span>Leg A</span>
                        <strong>{strategy.legA}</strong>
                    </header>
                    <p>
                        Stake {stakePerLeg.toFixed(2)} USD · Payout ≈ {(stakePerLeg * payoutA).toFixed(2)} USD
                    </p>
                </article>
                <article className='hedging-tool__leg'>
                    <header>
                        <span>Leg B</span>
                        <strong>{strategy.legB}</strong>
                    </header>
                    <p>
                        Stake {stakePerLeg.toFixed(2)} USD · Payout ≈ {(stakePerLeg * payoutB).toFixed(2)} USD
                    </p>
                </article>
            </div>

            <section className='hub-page__panel'>
                <header>
                    <h2>Hedge history</h2>
                    <span className='hedging-tool__sub'>
                        Session P/L <strong className={snap.profit >= 0 ? 'is-win' : 'is-loss'}>{fmt(snap.profit)}</strong>
                    </span>
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
                                    Execute a hedge to see both legs settle here.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <div className='hub-page__console' aria-live='polite'>
                    {snap.journal.slice(-6).map((line, i) => (
                        <p key={`${i}-${line.slice(0, 10)}`}>{line}</p>
                    ))}
                    {!snap.journal.length && <p>Hedging tool ready.</p>}
                </div>
            </section>
        </div>
    );
});

export default HedgingToolPage;
