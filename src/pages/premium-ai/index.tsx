import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { HubSessionSnapshot, HubTradeIntent } from '@/bot/engine/hub-session';
import { useHubSession } from '@/bot/use-hub-session';
import { SymbolSeries } from '@/bot/deriv/ticks';
import { VOL_MARKETS } from '../hub/markets';
import '../hub/hub-shared.scss';
import './premium-ai.scss';

type Family = 'even-odd' | 'over-under' | 'rise-fall';

interface StrategyMeta {
    id: string;
    index: string;
    name: string;
    family: Family;
    desc: string;
    rule: string;
}

const STRATEGIES: StrategyMeta[] = [
    {
        id: 'parity',
        index: '01',
        name: 'Parity Reversal — Even / Odd AI',
        family: 'even-odd',
        desc: 'Watches every volatility market for parity streaks and trades the opposite side the moment a run confirms.',
        rule: 'Trade Even when the last digits are Odd, trade Odd when the last digits are Even',
    },
    {
        id: 'range',
        index: '02',
        name: 'Digit Range Reversal — Over 4 / Under 5 AI',
        family: 'over-under',
        desc: 'Hunts digit-range extremes: crowded highs flip to Under 5, crowded lows flip to Over 4.',
        rule: 'Trade Under 5 when the last digits crowd the highs, trade Over 4 when they crowd the lows',
    },
    {
        id: 'direction',
        index: '03',
        name: 'Direction Reversal — Rise / Fall AI',
        family: 'rise-fall',
        desc: 'Measures short-term tick direction and fades extended runs with 1-tick Rise/Fall contracts.',
        rule: 'Trade Fall when ticks keep rising, trade Rise when ticks keep falling',
    },
];

const fmt = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USD`;

const resolve = (family: Family, n: number, digits: number[], quotes: number[], symbol: string): HubTradeIntent | null => {
    if (digits.length < n) return null;
    const tail = digits.slice(-n);
    if (family === 'even-odd') {
        const evens = tail.filter(d => d % 2 === 0).length;
        if (evens === n) return { symbol, contractType: 'DIGITODD' };
        if (evens === 0) return { symbol, contractType: 'DIGITEVEN' };
        return null;
    }
    if (family === 'over-under') {
        const highs = tail.filter(d => d > 4).length;
        const lows = tail.filter(d => d < 5).length;
        if (highs === n) return { symbol, contractType: 'DIGITUNDER', barrier: 5 };
        if (lows === n) return { symbol, contractType: 'DIGITOVER', barrier: 4 };
        return null;
    }
    if (quotes.length < n + 1) return null;
    const window = quotes.slice(-(n + 1));
    let rising = true;
    let falling = true;
    for (let i = 1; i < window.length; i += 1) {
        if (window[i] <= window[i - 1]) rising = false;
        if (window[i] >= window[i - 1]) falling = false;
    }
    if (rising) return { symbol, contractType: 'PUT' };
    if (falling) return { symbol, contractType: 'CALL' };
    return null;
};

const PremiumAIPage = observer(() => {
    const [openId, setOpenId] = useState<string | null>(null);
    const strategy = STRATEGIES.find(s => s.id === openId) || null;

    const [n, setN] = useState(3);
    const [scanAll, setScanAll] = useState(true);
    const [stake, setStake] = useState(0.35);
    const [ticks, setTicks] = useState(1);
    const [takeProfit, setTakeProfit] = useState(10);
    const [stopLoss, setStopLoss] = useState(50);
    const [martingale, setMartingale] = useState(2);

    const cfgRef = useRef({ family: strategy?.family as Family, n });
    cfgRef.current = { family: (strategy?.family || 'even-odd') as Family, n };

    const { session, snap } = useHubSession(() => ({
        symbols: VOL_MARKETS.map(m => m.symbol),
        stake: 0.35,
        martingale: 2,
        takeProfit: 10,
        stopLoss: 50,
        durationTicks: 1,
        nameOf: s => VOL_MARKETS.find(m => m.symbol === s)?.name || s,
        evaluate: (symbol: string, series: SymbolSeries, _state: HubSessionSnapshot): HubTradeIntent | null =>
            resolve(cfgRef.current.family, cfgRef.current.n, series.digits, series.quotes, symbol),
    }));

    const sync = (patch: { stake?: number; ticks?: number; takeProfit?: number; stopLoss?: number; martingale?: number }) => {
        if (patch.stake !== undefined) setStake(patch.stake);
        if (patch.ticks !== undefined) setTicks(patch.ticks);
        if (patch.takeProfit !== undefined) setTakeProfit(patch.takeProfit);
        if (patch.stopLoss !== undefined) setStopLoss(patch.stopLoss);
        if (patch.martingale !== undefined) setMartingale(patch.martingale);
        session.updateOptions({
            stake: patch.stake ?? stake,
            durationTicks: patch.ticks ?? ticks,
            takeProfit: patch.takeProfit ?? takeProfit,
            stopLoss: patch.stopLoss ?? stopLoss,
            martingale: patch.martingale ?? martingale,
        });
    };

    if (!strategy) {
        return (
            <div className='hub-page premium-ai'>
                <div className='hub-page__hero'>
                    <div>
                        <h1 className='hub-page__title'>Premium AI Bots</h1>
                        <p className='hub-page__subtitle'>
                            Three live scanner workspaces. Each one streams real ticks from 13 volatility markets,
                            highlights the exact market to trade, and runs the session with stake, martingale and
                            risk controls.
                        </p>
                    </div>
                </div>
                <div className='premium-ai__list'>
                    {STRATEGIES.map(s => (
                        <article key={s.id} className='premium-ai__card'>
                            <header>
                                <span className='premium-ai__index'>{s.index}</span>
                                <span className='hub-pill hub-pill--teal'>Premium</span>
                            </header>
                            <h2>{s.name}</h2>
                            <p>{s.desc}</p>
                            <div className='premium-ai__rule'>{s.rule}</div>
                            <button type='button' className='hub-btn' onClick={() => setOpenId(s.id)}>
                                Open scanner workspace →
                            </button>
                        </article>
                    ))}
                </div>
            </div>
        );
    }

    const winRate = snap.trades ? (snap.wins * 100) / snap.trades : 0;

    return (
        <div className='hub-page premium-ai'>
            <div className='hub-page__hero'>
                <div>
                    <button type='button' className='premium-ai__back' onClick={() => setOpenId(null)}>
                        ← Strategies
                    </button>
                    <h1 className='hub-page__title'>{strategy.name}</h1>
                    <p className='hub-page__subtitle'>{strategy.desc}</p>
                </div>
                <div className='hub-page__actions'>
                    <span className={`hub-pill ${snap.running ? '' : 'hub-pill--grey'}`}>
                        <i className='premium-ai__dot' /> {snap.running ? 'SCANNER LIVE' : 'SCANNER IDLE'}
                    </span>
                    {snap.running ? (
                        <button type='button' className='hub-btn hub-btn--stop' onClick={() => session.stop()}>
                            Stop scanner
                        </button>
                    ) : (
                        <button type='button' className='hub-btn hub-btn--gold' onClick={() => session.start()}>
                            ▶ Start AI scanner
                        </button>
                    )}
                </div>
            </div>

            <div className='premium-ai__setup'>
                <div className='premium-ai__setup-rule'>
                    <span>Trading rule</span>
                    <p>
                        Check the last{' '}
                        <select value={n} onChange={e => setN(Number(e.target.value))}>
                            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => (
                                <option key={v} value={v}>
                                    {v}
                                </option>
                            ))}
                        </select>{' '}
                        digits. {strategy.rule}.
                    </p>
                    <label className='premium-ai__toggle'>
                        <input type='checkbox' checked={scanAll} onChange={e => setScanAll(e.target.checked)} />
                        <span>Scan all markets</span>
                    </label>
                </div>
                <div className='premium-ai__setup-fields'>
                    <label className='hub-field'>
                        <span>Stake</span>
                        <input type='number' min='0.35' step='0.1' value={stake} onChange={e => sync({ stake: Number(e.target.value) })} />
                    </label>
                    <label className='hub-field'>
                        <span>Ticks</span>
                        <input type='number' min='1' max='10' value={ticks} onChange={e => sync({ ticks: Number(e.target.value) })} />
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
            </div>

            <div className='premium-ai__body'>
                <section className='hub-page__panel'>
                    <header>
                        <h2>Live market scan</h2>
                        <span className='premium-ai__sub'>
                            {snap.tickCount.toLocaleString()} ticks · {VOL_MARKETS.length}/{VOL_MARKETS.length} markets
                        </span>
                    </header>
                    <table className='hub-table'>
                        <thead>
                            <tr>
                                <th>Market</th>
                                <th>Price</th>
                                <th>Digits</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {VOL_MARKETS.map((m, idx) => {
                                const digits = snap.digits[m.symbol] || [];
                                const call = resolve(strategy.family, n, digits, [], m.symbol);
                                const scanning = snap.marketTicks[m.symbol] || 0;
                                return (
                                    <tr key={m.symbol} className={call ? 'premium-ai__row--hit' : ''}>
                                        <td>{m.name}</td>
                                        <td className='hub-page__mono'>{snap.quotes[m.symbol] ? snap.quotes[m.symbol].toFixed(3) : '—'}</td>
                                        <td>
                                            <span className='hub-digits'>
                                                {digits.length ? digits.slice(-5).map((d, i) => <i key={`${m.symbol}-${digits.length - 5 + i}`}>{d}</i>) : '—'}
                                            </span>
                                        </td>
                                        <td>
                                            {call ? (
                                                <span className='hub-pill'>
                                                    Trade {call.contractType === 'DIGITODD' ? 'Odd' : call.contractType === 'DIGITEVEN' ? 'Even' : call.contractType === 'DIGITUNDER' ? 'Under 5' : call.contractType === 'DIGITOVER' ? 'Over 4' : call.contractType === 'CALL' ? 'Rise' : 'Fall'}
                                                </span>
                                            ) : (
                                                <span className='premium-ai__wait'>Scanning {scanning || idx % 5}/5</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <footer className='premium-ai__footer'>
                        <span>
                            {snap.trades ? `${VOL_MARKETS.length} market${snap.trades === 1 ? '' : 's'} selected. Configure and start scanning.` : 'No market selected. Configure and start scanning.'}
                        </span>
                        <span className='hub-page__mono'>
                            Total P/L <strong className={snap.profit >= 0 ? 'is-win' : 'is-loss'}>{fmt(snap.profit)}</strong>
                            {' · '}Win rate {winRate.toFixed(1)}%
                        </span>
                    </footer>
                </section>

                <section className='hub-page__panel'>
                    <header>
                        <h2>Session trades</h2>
                        <span className='premium-ai__sub'>{snap.trades} closed</span>
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
                                        Start the scanner to fill this session log.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    <div className='hub-page__console' aria-live='polite'>
                        {snap.journal.slice(-8).map((line, i) => (
                            <p key={`${i}-${line.slice(0, 10)}`}>{line}</p>
                        ))}
                        {!snap.journal.length && <p>Scanner ready.</p>}
                    </div>
                </section>
            </div>
        </div>
    );
});

export default PremiumAIPage;
export type { Family as PremiumAIFamily };
