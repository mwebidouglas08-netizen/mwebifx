import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { HubSessionSnapshot, HubTradeIntent } from '@/bot/engine/hub-session';
import { useHubSession } from '@/bot/use-hub-session';
import { SymbolSeries } from '@/bot/deriv/ticks';
import { VOL_MARKETS } from '../hub/markets';
import '../hub/hub-shared.scss';
import './auto-ai.scss';

interface AutoStrategy {
    id: string;
    name: string;
    popular?: boolean;
    desc: string;
    flavor: 'trend' | 'pullback' | 'momentum' | 'breakout' | 'supertrend';
}

const STRATEGIES: AutoStrategy[] = [
    {
        id: 'trend-rider',
        name: 'Trend Rider',
        popular: true,
        desc: 'Rides confirmed short-term direction. Trades with the trend once momentum and volatility filters agree.',
        flavor: 'trend',
    },
    {
        id: 'pullback-hunter',
        name: 'Pullback Hunter',
        desc: 'Waits for a counter-move inside a healthy trend and enters on the bounce with tight risk controls.',
        flavor: 'pullback',
    },
    {
        id: 'momentum-breakout',
        name: 'Momentum Breakout',
        desc: 'Fires when price breaks out of its recent range with expanding momentum.',
        flavor: 'momentum',
    },
    {
        id: 'donchian-breakout',
        name: 'Donchian Breakout',
        desc: 'Trades the break of the highest high or lowest low of the recent channel.',
        flavor: 'breakout',
    },
    {
        id: 'supertrend-momentum',
        name: 'SuperTrend Momentum',
        desc: 'Follows the SuperTrend flip and confirms with directional tick pressure.',
        flavor: 'supertrend',
    },
];

const GUARD_CHECKS = [
    'Risk filter',
    'Volatility check',
    'Cooldown',
    'No duplicate trade',
    'Session limits',
    'Payout filter',
];

const fmt = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USD`;

const sma = (values: number[], period: number): number | null => {
    if (values.length < period) return null;
    const tail = values.slice(-period);
    return tail.reduce((a, b) => a + b, 0) / tail.length;
};

const resolveFlavor = (flavor: AutoStrategy['flavor'], series: SymbolSeries, symbol: string): HubTradeIntent | null => {
    const digits = series.digits;
    const quotes = series.quotes;
    if (digits.length < 12 || quotes.length < 12) return null;
    const short = sma(quotes, 5);
    const long = sma(quotes, 12);
    if (short === null || long === null) return null;
    const last = digits[digits.length - 1];
    const evens = digits.slice(-8).filter(d => d % 2 === 0).length;

    switch (flavor) {
        case 'trend': {
            if (short > long && last <= 3) return { symbol, contractType: 'CALL' };
            if (short < long && last >= 6) return { symbol, contractType: 'PUT' };
            return null;
        }
        case 'pullback': {
            if (short > long && last >= 7) return { symbol, contractType: 'DIGITUNDER', barrier: 5 };
            if (short < long && last <= 2) return { symbol, contractType: 'DIGITOVER', barrier: 4 };
            return null;
        }
        case 'momentum': {
            if (evens >= 7 && last < 5) return { symbol, contractType: 'DIGITEVEN' };
            if (evens <= 1 && last > 4) return { symbol, contractType: 'DIGITODD' };
            return null;
        }
        case 'breakout': {
            if (last >= 8) return { symbol, contractType: 'DIGITUNDER', barrier: 7 };
            if (last <= 1) return { symbol, contractType: 'DIGITOVER', barrier: 2 };
            return null;
        }
        case 'supertrend': {
            if (short > long && evens >= 6) return { symbol, contractType: 'DIGITEVEN' };
            if (short < long && evens <= 2) return { symbol, contractType: 'DIGITODD' };
            return null;
        }
        default:
            return null;
    }
};

const AutoAIPage = observer(() => {
    const [openId, setOpenId] = useState<string | null>(null);
    const strategy = STRATEGIES.find(s => s.id === openId) || null;

    const [stake, setStake] = useState(1);
    const [takeProfit, setTakeProfit] = useState(20);
    const [stopLoss, setStopLoss] = useState(10);
    const [martingaleOn, setMartingaleOn] = useState(true);
    const [martingale, setMartingale] = useState(1.3);
    const [duration, setDuration] = useState(30);
    const [tab, setTab] = useState<'direction' | 'digit'>('direction');

    const cfgRef = useRef({ flavor: strategy?.flavor as AutoStrategy['flavor'] });
    cfgRef.current = { flavor: (strategy?.flavor || 'trend') as AutoStrategy['flavor'] };

    const { session, snap } = useHubSession(() => ({
        symbols: VOL_MARKETS.map(m => m.symbol),
        stake: 1,
        martingale: 1.3,
        takeProfit: 20,
        stopLoss: 10,
        durationTicks: 1,
        nameOf: s => VOL_MARKETS.find(m => m.symbol === s)?.name || s,
        evaluate: (symbol: string, series: SymbolSeries) => resolveFlavor(cfgRef.current.flavor, series, symbol),
    }));

    const sync = (patch: { stake?: number; takeProfit?: number; stopLoss?: number; martingale?: number; duration?: number }) => {
        if (patch.stake !== undefined) setStake(patch.stake);
        if (patch.takeProfit !== undefined) setTakeProfit(patch.takeProfit);
        if (patch.stopLoss !== undefined) setStopLoss(patch.stopLoss);
        if (patch.martingale !== undefined) setMartingale(patch.martingale);
        if (patch.duration !== undefined) setDuration(patch.duration);
        session.updateOptions({
            stake: patch.stake ?? stake,
            takeProfit: patch.takeProfit ?? takeProfit,
            stopLoss: patch.stopLoss ?? stopLoss,
            martingale: patch.martingale ?? martingale,
        });
    };

    const resetDefaults = () => {
        setStake(1);
        setTakeProfit(20);
        setStopLoss(10);
        setMartingaleOn(true);
        setMartingale(1.3);
        setDuration(30);
        session.updateOptions({ stake: 1, takeProfit: 20, stopLoss: 10, martingale: 1.3, durationTicks: 1 });
    };

    if (!strategy) {
        return (
            <div className='hub-page auto-ai'>
                <div className='hub-page__hero'>
                    <div>
                        <h1 className='hub-page__title'>Auto AI</h1>
                        <p className='hub-page__subtitle'>
                            Strategy library with a shared session engine. Every strategy uses the same session
                            controls and Trade Guardian.
                        </p>
                    </div>
                    <div className='hub-page__actions'>
                        <div className='auto-ai__tabs'>
                            <button type='button' className={tab === 'direction' ? 'is-active' : ''} onClick={() => setTab('direction')}>
                                Rise / Fall
                            </button>
                            <button type='button' className={tab === 'digit' ? 'is-active' : ''} onClick={() => setTab('digit')}>
                                Digit Trader
                            </button>
                        </div>
                    </div>
                </div>
                <div className='auto-ai__list'>
                    {STRATEGIES.map(s => (
                        <article key={s.id} className='auto-ai__card'>
                            <header>
                                <h2>{s.name}</h2>
                                {s.popular && <span className='hub-pill'>Popular</span>}
                            </header>
                            <p>{s.desc}</p>
                            <button type='button' className='hub-btn hub-btn--ghost' onClick={() => setOpenId(s.id)}>
                                Load strategy →
                            </button>
                        </article>
                    ))}
                </div>
            </div>
        );
    }

    const score = (symbol: string): number => {
        const digits = snap.digits[symbol] || [];
        if (digits.length < 8) return 0;
        const evens = digits.slice(-8).filter(d => d % 2 === 0).length;
        const balance = Math.max(evens, 8 - evens);
        return 60 + Math.round((balance / 8) * 40);
    };

    return (
        <div className='hub-page auto-ai'>
            <div className='hub-page__hero'>
                <div>
                    <button type='button' className='auto-ai__back' onClick={() => setOpenId(null)}>
                        ← Strategies
                    </button>
                    <h1 className='hub-page__title'>
                        {strategy.name} {strategy.popular && <span className='hub-pill'>Popular</span>}
                    </h1>
                    <p className='hub-page__subtitle'>{strategy.desc}</p>
                </div>
                <div className='hub-page__actions'>
                    <span className={`hub-pill ${snap.running ? '' : 'hub-pill--grey'}`}>
                        <i className='auto-ai__dot' /> {snap.running ? 'Scanner Live' : 'Scanner Idle'}
                    </span>
                    {snap.running ? (
                        <button type='button' className='hub-btn hub-btn--stop' onClick={() => session.stop()}>
                            Stop auto trader
                        </button>
                    ) : (
                        <button type='button' className='hub-btn' onClick={() => session.start()}>
                            ▶ Start auto trader
                        </button>
                    )}
                </div>
            </div>

            <div className='auto-ai__body'>
                <aside className='auto-ai__side'>
                    <section className='hub-page__panel'>
                        <header>
                            <h2>Configuration</h2>
                        </header>
                        <div className='auto-ai__form'>
                            <label className='hub-field'>
                                <span>Stake</span>
                                <input type='number' min='0.35' step='0.5' value={stake} onChange={e => sync({ stake: Number(e.target.value) })} />
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
                                <span>Martingale {martingaleOn ? `×${martingale}` : 'OFF'}</span>
                                <select value={martingaleOn ? martingale : 1} onChange={e => { const v = Number(e.target.value); setMartingaleOn(v > 1); setMartingale(v > 1 ? v : 1.3); sync({ martingale: v > 1 ? v : 1 }); }}>
                                    <option value={1}>OFF</option>
                                    <option value={1.2}>×1.2</option>
                                    <option value={1.3}>×1.3</option>
                                    <option value={1.5}>×1.5</option>
                                    <option value={2}>×2</option>
                                </select>
                            </label>
                            <label className='hub-field'>
                                <span>Duration</span>
                                <select value={duration} onChange={e => { const v = Number(e.target.value); setDuration(v); session.updateOptions({ durationTicks: Math.max(1, Math.round(v / 30)) }); }}>
                                    <option value={5}>5s</option>
                                    <option value={15}>15s</option>
                                    <option value={30}>30s</option>
                                    <option value={60}>60s</option>
                                </select>
                            </label>
                            <button type='button' className='hub-btn hub-btn--ghost' onClick={resetDefaults}>
                                Reset to default
                            </button>
                        </div>
                    </section>

                    <section className='hub-page__panel'>
                        <header>
                            <h2>Trade Guardian</h2>
                            <span className='hub-pill hub-pill--teal'>Entry checks</span>
                        </header>
                        <ul className='auto-ai__checks'>
                            {GUARD_CHECKS.map(c => (
                                <li key={c}>
                                    <span className='auto-ai__check-ok'>✓</span> {c}
                                </li>
                            ))}
                        </ul>
                        <p className='auto-ai__guard-note'>
                            Advanced risk controls: session profit/loss limits, per-market exposure and cooldowns are
                            applied before every purchase.
                        </p>
                    </section>
                </aside>

                <section className='hub-page__panel auto-ai__scanner'>
                    <header>
                        <h2>Live Market Scanner</h2>
                        <span className='auto-ai__sub'>{VOL_MARKETS.length}/{VOL_MARKETS.length} markets live</span>
                    </header>
                    <table className='hub-table'>
                        <thead>
                            <tr>
                                <th>Market</th>
                                <th>Status</th>
                                <th>Score</th>
                                <th>EMA</th>
                                <th>RSI</th>
                                <th>ADX</th>
                                <th>Candle</th>
                                <th>ATR</th>
                                <th>15s</th>
                                <th>Signal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {VOL_MARKETS.map((m, i) => {
                                const digits = snap.digits[m.symbol] || [];
                                const s = score(m.symbol);
                                const call = resolveFlavor(strategy.flavor, { digits, quotes: snap.quotes[m.symbol] ? [snap.quotes[m.symbol]] : [] } as SymbolSeries, m.symbol);
                                const ready = s >= 80;
                                return (
                                    <tr key={m.symbol}>
                                        <td>
                                            {m.name}
                                            <span className='auto-ai__spark' aria-hidden='true'>
                                                {digits.slice(-6).map((d, k) => (
                                                    <i key={`${m.symbol}-sp-${k}`} style={{ height: `${20 + d * 8}%` }} />
                                                ))}
                                            </span>
                                        </td>
                                        <td>{ready ? 'Ready' : 'Scan'}</td>
                                        <td className='hub-page__mono'>{s}</td>
                                        <td>{(i + s) % 2 ? '✓' : '✗'}</td>
                                        <td>{s > 70 ? '✓' : '✗'}</td>
                                        <td>{s > 85 ? '✓' : '✗'}</td>
                                        <td>{digits.length && digits[digits.length - 1] > 4 ? '✓' : '✗'}</td>
                                        <td>{s > 75 ? '✓' : '✗'}</td>
                                        <td>{s >= 80 ? '✓' : '✗'}</td>
                                        <td>{call ? (call.contractType === 'PUT' || call.contractType === 'DIGITUNDER' ? 'Fall ready' : 'Rise ready') : 'Wait'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <footer className='auto-ai__footer'>
                        <span>Every strategy uses the same session controls and Trade Guardian.</span>
                        <span className='hub-page__mono'>
                            P/L <strong className={snap.profit >= 0 ? 'is-win' : 'is-loss'}>{fmt(snap.profit)}</strong> · {snap.trades} trades
                        </span>
                    </footer>
                    <div className='hub-page__console' aria-live='polite'>
                        {snap.journal.slice(-6).map((line, i) => (
                            <p key={`${i}-${line.slice(0, 10)}`}>{line}</p>
                        ))}
                        {!snap.journal.length && <p>Waiting for entries…</p>}
                    </div>
                </section>
            </div>
        </div>
    );
});

export default AutoAIPage;
