import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { HubContractType, HubSessionSnapshot, HubTradeIntent } from '@/bot/engine/hub-session';
import { useHubSession } from '@/bot/use-hub-session';
import { SymbolSeries } from '@/bot/deriv/ticks';
import { EXTENDED_MARKETS, VOL_MARKETS } from '../hub/markets';
import '../hub/hub-shared.scss';
import './speedbot.scss';

type ContractKind = 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'MATCHES' | 'DIFFERS' | 'RISE' | 'FALL';

const fmt = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USD`;

const SPEED_MARKETS = EXTENDED_MARKETS.slice(0, 40);

const toIntent = (kind: ContractKind, symbol: string, prediction: number): HubTradeIntent => {
    switch (kind) {
        case 'EVEN':
            return { symbol, contractType: 'DIGITEVEN' };
        case 'ODD':
            return { symbol, contractType: 'DIGITODD' };
        case 'OVER':
            return { symbol, contractType: 'DIGITOVER', barrier: prediction };
        case 'UNDER':
            return { symbol, contractType: 'DIGITUNDER', barrier: prediction };
        case 'MATCHES':
            return { symbol, contractType: 'DIGITMATCH', barrier: prediction };
        case 'DIFFERS':
            return { symbol, contractType: 'DIGITDIFF', barrier: prediction };
        case 'RISE':
            return { symbol, contractType: 'CALL' };
        case 'FALL':
            return { symbol, contractType: 'PUT' };
    }
};

const SpeedbotPage = observer(() => {
    const [symbol, setSymbol] = useState('R_100');
    const [kind, setKind] = useState<ContractKind>('EVEN');
    const [prediction, setPrediction] = useState(5);
    const [ticks, setTicks] = useState(1);
    const [stake, setStake] = useState(0.5);
    const [alternate, setAlternate] = useState(false);
    const [alternateOnLoss, setAlternateOnLoss] = useState(false);
    const [useMartingale, setUseMartingale] = useState(true);
    const [martingale, setMartingale] = useState(2);

    const sideRef = useRef<'EVEN' | 'ODD'>('EVEN');
    const lastLossRef = useRef(false);

    const cfgRef = useRef({ kind, alternate, alternateOnLoss, symbol, prediction });
    cfgRef.current = { kind, alternate, alternateOnLoss, symbol, prediction };

    const { session, snap } = useHubSession(() => ({
        symbols: VOL_MARKETS.map(m => m.symbol),
        stake: 0.5,
        martingale: 2,
        takeProfit: 0,
        stopLoss: 0,
        durationTicks: 1,
        nameOf: s => SPEED_MARKETS.find(m => m.symbol === s)?.name || s,
        evaluate: (_symbol: string, _series: SymbolSeries, state: HubSessionSnapshot): HubTradeIntent | null => {
            const cfg = cfgRef.current;
            if (!cfg.alternate && !cfg.alternateOnLoss) return null;
            if (cfg.alternateOnLoss && !state.rows[0]?.result) return null;
            if (cfg.alternateOnLoss && state.rows[0]?.result !== 'loss') return null;
            let side = sideRef.current;
            if (cfg.alternate) {
                const last = state.rows[0];
                if (!last) side = 'EVEN';
                else if (last.contract === 'Even') side = 'ODD';
                else if (last.contract === 'Odd') side = 'EVEN';
                sideRef.current = side;
            }
            return toIntent(side, cfg.symbol, cfg.prediction);
        },
    }));

    const sync = (patch: { stake?: number; ticks?: number; martingale?: number }) => {
        if (patch.stake !== undefined) setStake(patch.stake);
        if (patch.ticks !== undefined) setTicks(patch.ticks);
        if (patch.martingale !== undefined) setMartingale(patch.martingale);
        session.updateOptions({
            stake: patch.stake ?? stake,
            durationTicks: patch.ticks ?? ticks,
            martingale: useMartingale ? (patch.martingale ?? martingale) : 1,
        });
    };

    const digits = snap.digits[symbol] || [];
    const last20 = digits.slice(-20);
    const evenPct = last20.length ? (last20.filter(d => d % 2 === 0).length * 100) / last20.length : 0;

    const tradeOnce = () => {
        void session.buyOnce(toIntent(kind, symbol, prediction));
    };

    const startTrading = () => {
        if (snap.running) session.stop();
        else session.start();
    };

    const kindLabel = (k: ContractKind): string => {
        switch (k) {
            case 'OVER':
                return `Over ${prediction}`;
            case 'UNDER':
                return `Under ${prediction}`;
            case 'MATCHES':
                return `Matches ${prediction}`;
            case 'DIFFERS':
                return `Differs ${prediction}`;
            case 'RISE':
                return 'Rise';
            case 'FALL':
                return 'Fall';
            default:
                return k === 'EVEN' ? 'Even' : 'Odd';
        }
    };

    return (
        <div className='hub-page speedbot'>
            <div className='hub-page__hero'>
                <div>
                    <h1 className='hub-page__title'>Speedbot</h1>
                    <p className='hub-page__subtitle'>
                        Fast one-click digit trader. Pick a market, watch the Even/Odd pattern, and fire single
                        contracts or run the alternate-streak auto trader.
                    </p>
                </div>
                <div className='hub-page__actions'>
                    <span className={`hub-pill ${snap.running ? '' : 'hub-pill--grey'}`}>{snap.running ? 'Trading' : 'Idle'}</span>
                    <button type='button' className={`hub-btn ${snap.running ? 'hub-btn--stop' : ''}`} onClick={startTrading}>
                        {snap.running ? 'Stop trading' : 'Start trading'}
                    </button>
                </div>
            </div>

            <div className='speedbot__body'>
                <section className='hub-page__panel'>
                    <header>
                        <h2>Contract</h2>
                        <span className='speedbot__last'>
                            Last digit: <strong>{digits.length ? digits[digits.length - 1] : '—'}</strong>
                        </span>
                    </header>
                    <div className='speedbot__form'>
                        <label className='hub-field'>
                            <span>Market</span>
                            <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                                {SPEED_MARKETS.map(m => (
                                    <option key={m.symbol} value={m.symbol}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className='speedbot__kinds'>
                            {(['EVEN', 'ODD', 'OVER', 'UNDER', 'MATCHES', 'DIFFERS', 'RISE', 'FALL'] as ContractKind[]).map(k => (
                                <button
                                    key={k}
                                    type='button'
                                    className={`speedbot__kind ${kind === k ? 'is-active' : ''}`}
                                    onClick={() => setKind(k)}
                                >
                                    {kindLabel(k)}
                                </button>
                            ))}
                        </div>
                        {(kind === 'OVER' || kind === 'UNDER' || kind === 'MATCHES' || kind === 'DIFFERS') && (
                            <label className='hub-field'>
                                <span>Prediction</span>
                                <input type='number' min='0' max='9' value={prediction} onChange={e => setPrediction(Math.min(9, Math.max(0, Number(e.target.value))))} />
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
                    </div>
                    <div className='speedbot__pattern'>
                        <span>Even/Odd pattern (last 20)</span>
                        <span className='hub-digits'>
                            {last20.map((d, i) => (
                                <i key={`${symbol}-p-${digits.length - last20.length + i}`}>{d}</i>
                            ))}
                        </span>
                        <span className='speedbot__pcts'>
                            <em className='is-even'>Even {evenPct.toFixed(0)}%</em>
                            <em className='is-odd'>Odd {(100 - evenPct).toFixed(0)}%</em>
                        </span>
                    </div>
                    <div className='speedbot__actions'>
                        <button type='button' className='hub-btn' disabled={snap.busy} onClick={tradeOnce}>
                            Trade once
                        </button>
                        <button type='button' className={`hub-btn ${snap.running ? 'hub-btn--stop' : ''}`} onClick={startTrading}>
                            {snap.running ? 'Stop' : 'Start trading'}
                        </button>
                    </div>
                </section>

                <section className='hub-page__panel'>
                    <header>
                        <h2>Recovery</h2>
                    </header>
                    <div className='speedbot__toggles'>
                        <label>
                            <input type='checkbox' checked={alternate} onChange={e => setAlternate(e.target.checked)} />
                            <span>Alternate Even/Odd</span>
                        </label>
                        <label>
                            <input type='checkbox' checked={alternateOnLoss} onChange={e => setAlternateOnLoss(e.target.checked)} />
                            <span>Alternate on loss</span>
                        </label>
                        <label>
                            <input type='checkbox' checked={useMartingale} onChange={e => { setUseMartingale(e.target.checked); sync({ martingale: e.target.checked ? martingale : 1 }); }} />
                            <span>Use Martingale</span>
                        </label>
                        <label className='hub-field'>
                            <span>Multiplier</span>
                            <select value={martingale} onChange={e => sync({ martingale: Number(e.target.value) })} disabled={!useMartingale}>
                                <option value={1.5}>×1.5</option>
                                <option value={2}>×2</option>
                                <option value={3}>×3</option>
                            </select>
                        </label>
                    </div>
                    <p className='speedbot__status'>
                        Ticks processed: <strong>{snap.tickCount}</strong> · Last digit: <strong>{digits.length ? digits[digits.length - 1] : '—'}</strong> · P/L{' '}
                        <strong className={snap.profit >= 0 ? 'is-win' : 'is-loss'}>{fmt(snap.profit)}</strong>
                    </p>
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
                                        Trades appear here.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    <div className='hub-page__console' aria-live='polite'>
                        {snap.journal.slice(-6).map((line, i) => (
                            <p key={`${i}-${line.slice(0, 10)}`}>{line}</p>
                        ))}
                        {!snap.journal.length && <p>Speedbot ready.</p>}
                    </div>
                </section>
            </div>
        </div>
    );
});

export default SpeedbotPage;
