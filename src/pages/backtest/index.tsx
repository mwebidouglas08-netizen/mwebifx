import { useState } from 'react';
import { fetchHistoricalTicks, type HistoricalTicks } from '@/bot/deriv/history';
import {
    simulateOverUnder,
    validateOutOfSample,
    type BacktestResult,
    type ValidatedBacktest,
} from '@/bot/core/backtest';
import { Direction } from '@/bot/core/types';
import './backtest.scss';

const SYMBOLS = [
    { symbol: 'R_10', name: 'Volatility 10' },
    { symbol: 'R_25', name: 'Volatility 25' },
    { symbol: 'R_50', name: 'Volatility 50' },
    { symbol: 'R_75', name: 'Volatility 75' },
    { symbol: 'R_100', name: 'Volatility 100' },
    { symbol: '1HZ10V', name: 'Volatility 10 (1s)' },
];

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const money = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

const ResultCard = ({ title, r }: { title: string; r: BacktestResult }) => (
    <div className='bt-result-card'>
        <h4>{title}</h4>
        {r.trades === 0 ? (
            <p className='bt-empty'>No trades met the entry criteria on this data.</p>
        ) : (
            <div className='bt-grid'>
                <div><span>Trades</span><strong>{r.trades}</strong></div>
                <div><span>Win rate</span><strong>{pct(r.winRate)}</strong></div>
                <div><span>Net profit</span><strong className={r.netProfit >= 0 ? 'pos' : 'neg'}>{money(r.netProfit)}</strong></div>
                <div><span>Profit factor</span><strong>{Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞'}</strong></div>
                <div><span>Max drawdown</span><strong className='neg'>{r.maxDrawdown.toFixed(2)}</strong></div>
                <div><span>Max consec. losses</span><strong>{r.maxConsecutiveLosses}</strong></div>
                <div><span>EV / trade</span><strong>{r.expectedValuePerTrade.toFixed(3)}</strong></div>
                <div><span>Take rate</span><strong>{pct(r.takeRate)}</strong></div>
            </div>
        )}
    </div>
);

const BacktestPage = () => {
    const [symbol, setSymbol] = useState('R_50');
    const [count, setCount] = useState(2000);
    const [direction, setDirection] = useState<Direction>('under');
    const [barrier, setBarrier] = useState(4);
    const [payoutRatio, setPayoutRatio] = useState(1.95);
    const [stake, setStake] = useState(1);
    const [lookback, setLookback] = useState(100);
    const [minSample, setMinSample] = useState(50);
    const [minEvPct, setMinEvPct] = useState(0);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ticks, setTicks] = useState<HistoricalTicks | null>(null);
    const [validated, setValidated] = useState<ValidatedBacktest | null>(null);

    const run = async () => {
        setLoading(true);
        setError(null);
        setValidated(null);
        setTicks(null);
        try {
            const history = await fetchHistoricalTicks(symbol, Math.max(count, lookback + 50));
            setTicks(history);
            const params = { direction, barrier, payoutRatio, stake, lookback, minSample, minEvPct };
            const result = validateOutOfSample(history.digits, params);
            setValidated(result);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Backtest failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className='bt-page'>
            <div className='bt-header'>
                <h2>Backtest</h2>
                <p className='bt-sub'>
                    Replays real Deriv tick history through the Over/Under signal rules. Past
                    performance on historical data is not a guarantee of future results.
                </p>
            </div>

            <div className='bt-controls'>
                <label>
                    Symbol
                    <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                        {SYMBOLS.map(s => (
                            <option key={s.symbol} value={s.symbol}>{s.name}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Ticks to load
                    <input type='number' min={100} max={10000} value={count}
                        onChange={e => setCount(Number(e.target.value) || 2000)} />
                </label>
                <label>
                    Direction
                    <select value={direction} onChange={e => setDirection(e.target.value as Direction)}>
                        <option value='under'>Under</option>
                        <option value='over'>Over</option>
                    </select>
                </label>
                <label>
                    Barrier
                    <input type='number' min={0} max={9} value={barrier}
                        onChange={e => setBarrier(Number(e.target.value) || 0)} />
                </label>
                <label>
                    Payout ratio
                    <input type='number' step={0.01} min={1.01} max={10} value={payoutRatio}
                        onChange={e => setPayoutRatio(Number(e.target.value) || 1.95)} />
                </label>
                <label>
                    Stake
                    <input type='number' step={0.5} min={0.35} value={stake}
                        onChange={e => setStake(Number(e.target.value) || 1)} />
                </label>
                <label>
                    Lookback
                    <input type='number' min={10} max={1000} value={lookback}
                        onChange={e => setLookback(Number(e.target.value) || 100)} />
                </label>
                <label>
                    Min sample
                    <input type='number' min={5} max={500} value={minSample}
                        onChange={e => setMinSample(Number(e.target.value) || 50)} />
                </label>
                <label>
                    Min EV %
                    <input type='number' step={0.1} min={0} value={minEvPct}
                        onChange={e => setMinEvPct(Number(e.target.value) || 0)} />
                </label>
                <button className='bt-run' onClick={run} disabled={loading}>
                    {loading ? 'Running…' : 'Run backtest'}
                </button>
            </div>

            {error && <div className='bt-error'>{error}</div>}

            {ticks && (
                <div className='bt-data-note'>
                    Loaded {ticks.digits.length} real ticks for {symbol} (pip size {ticks.pipSize}).
                </div>
            )}

            {validated && (
                <div className='bt-results'>
                    <ResultCard title='In-sample (train 70%)' r={validated.train} />
                    <ResultCard title='Out-of-sample (test 30%)' r={validated.test} />
                    <div className={`bt-verdict ${validated.isRobust ? 'robust' : 'weak'}`}>
                        <strong>{validated.isRobust ? 'Robust on this split' : 'Not robust on this split'}</strong>
                        <span>
                            Degradation {pct(validated.degradation)}. A robust strategy keeps a
                            positive edge out-of-sample. This is one split of one symbol — not proof.
                        </span>
                    </div>
                </div>
            )}

            {!ticks && !error && !loading && (
                <p className='bt-empty'>Pick a symbol and run a backtest on real tick history.</p>
            )}
        </div>
    );
};

export default BacktestPage;
