import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { useBulkTrader } from '@/bot/use-engine';
import { bulkTrader, DEFAULT_BULK_CONFIG, type BulkTradeConfig } from '@/bot/engine/bulk-trader';
import type { TradeRecord } from '@/bot/core/types';
import { HubNote, HubPage, HubPageHeader } from '@/components/hub-page';
import './bulk-trader.scss';

const SYMBOLS = [
    { symbol: 'R_10', name: 'Volatility 10' },
    { symbol: 'R_25', name: 'Volatility 25' },
    { symbol: 'R_50', name: 'Volatility 50' },
    { symbol: 'R_75', name: 'Volatility 75' },
    { symbol: 'R_100', name: 'Volatility 100' },
    { symbol: '1HZ10V', name: 'Volatility 10 (1s)' },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s)' },
    { symbol: 'stpRNG', name: 'Step Index' },
];

const CONTRACT_TYPES: BulkTradeConfig['contractType'][] = ['DIGITOVER', 'DIGITUNDER', 'CALL', 'PUT'];
const DURATION_UNITS: BulkTradeConfig['durationUnit'][] = ['t', 's', 'm'];

const money = (n: number) => n.toFixed(2);
const timeAt = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const EVENT_TONE: Record<string, string> = {
    info: 'info',
    success: 'ok',
    warn: 'warn',
    error: 'err',
    quote: 'info',
    purchase: 'buy',
    settlement: 'settle',
    risk: 'warn',
};

const EVENT_LABEL: Record<string, string> = {
    info: 'Info',
    success: 'Done',
    warn: 'Warn',
    error: 'Error',
    quote: 'Quote',
    purchase: 'Bought',
    settlement: 'Settled',
    risk: 'Risk',
};

const STATUS_TONE: Record<string, string> = {
    idle: 'hub-badge--idle',
    starting: 'hub-badge--running',
    running: 'hub-badge--running',
    stopping: 'hub-badge--idle',
    error: 'hub-badge--error',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const TradeRow = ({ trade }: { trade: TradeRecord }) => (
    <tr>
        <td>{trade.contractId ?? trade.id}</td>
        <td>{trade.displayName}</td>
        <td>
            {trade.contractType}
            {trade.contractType.startsWith('DIGIT') ? ` ${trade.barrier}` : ''}
        </td>
        <td>
            {trade.duration}
            {trade.durationUnit}
        </td>
        <td>{money(trade.stake)}</td>
        <td>{money(trade.payout)}</td>
        <td>{trade.stage}</td>
        <td className={trade.result === 'win' ? 'hub-pos' : trade.result === 'loss' ? 'hub-neg' : ''}>
            {trade.result || '—'}
        </td>
        <td className={(trade.profit ?? 0) >= 0 ? 'hub-pos' : 'hub-neg'}>
            {trade.profit !== undefined ? money(trade.profit) : '—'}
        </td>
        <td>{trade.simulated ? 'paper' : 'live'}</td>
    </tr>
);

const BulkTraderPage = observer(() => {
    const state = useBulkTrader();
    const { client, run_panel } = useStore() ?? {};

    const [form, setForm] = useState<BulkTradeConfig>(() => ({ ...DEFAULT_BULK_CONFIG }));
    const [formError, setFormError] = useState<string | null>(null);
    const feedRef = useRef<HTMLDivElement | null>(null);

    const isLoggedIn = Boolean(client?.is_logged_in);
    const activeLoginid = client?.loginid || '';
    const isDemo = activeLoginid ? isDemoAccount(activeLoginid) : state.accountIsDemo;
    const paperLocked = !isLoggedIn;
    const isRunning = state.status === 'starting' || state.status === 'running' || state.status === 'stopping';

    const patch = <K extends keyof BulkTradeConfig>(key: K, value: BulkTradeConfig[K]) =>
        setForm(prev => ({ ...prev, [key]: value }));

    // Keep the feed pinned to the newest event as the engine streams.
    useEffect(() => {
        const el = feedRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [state.events.length]);

    const validate = (): string | null => {
        if (form.contractType.startsWith('DIGIT') && !/^[0-9]$/.test(form.barrier)) {
            return 'Barrier must be a single digit from 0 to 9 for Over/Under contracts.';
        }
        if (!(Number(form.stake) > 0)) return 'Stake must be greater than 0.';
        if (form.count < 1 || form.count > 50) return 'Count must be between 1 and 50.';
        if (form.duration < 1) return 'Duration must be at least 1.';
        if (form.maxConcurrent < 1) return 'Max concurrent must be at least 1.';
        return null;
    };

    const onStart = () => {
        const problem = validate();
        if (problem) {
            setFormError(problem);
            return;
        }
        setFormError(null);
        const config: BulkTradeConfig = {
            ...form,
            barrier: form.barrier.trim(),
            paperTrading: paperLocked ? true : form.paperTrading,
            allowLiveTrading: paperLocked ? false : form.allowLiveTrading,
        };
        if (!config.paperTrading && !isDemo) {
            const ok = window.confirm(
                'Paper trading is off and this is a REAL-money account. Every buy spends real funds. Continue?'
            );
            if (!ok) return;
        }
        bulkTrader.start(config);
    };

    const onEmergencyStop = () => {
        const ok = window.confirm(
            'Emergency stop cancels the run immediately. Open positions still settle at the broker. Continue?'
        );
        if (!ok) return;
        bulkTrader.emergencyStop();
    };

    const onToggleLive = (enabled: boolean) => {
        if (enabled) {
            const ok = window.confirm(
                'Allow LIVE orders on this account? Buys will spend real money unless paper trading stays on. Continue?'
            );
            if (!ok) return;
        }
        patch('allowLiveTrading', enabled);
    };

    const progress = state.progress;
    const settledPct =
        progress.requested > 0 ? Math.min(100, Math.round((progress.settled / progress.requested) * 100)) : 0;
    const totalExposure = (Number(form.stake) || 0) * form.count;

    return (
        <HubPage className='bulk-page'>
            <HubPageHeader
                title='Bulk Trader'
                subtitle="Fires one identical contract N times in a burst, with a concurrency cap and live progress. Buys use Deriv's public data for pricing and require an authorized session for orders."
                badge={
                    <>
                        <span className={`hub-badge ${STATUS_TONE[state.status] ?? 'hub-badge--idle'}`}>
                            {state.status}
                        </span>
                        <span
                            className={[
                                'hub-badge',
                                !isLoggedIn ? 'hub-badge--guest' : isDemo ? 'hub-badge--demo' : 'hub-badge--real',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                        >
                            {!isLoggedIn ? 'Guest · signals only' : `${isDemo ? 'Demo' : 'Real'} · ${activeLoginid}`}
                        </span>
                    </>
                }
            />

            <HubNote tone='risk'>
                N parallel buys multiply your exposure by N. At {money(Number(form.stake) || 0)} × {form.count}{' '}
                contracts, a full run commits up to{' '}
                <strong>{money(totalExposure)} in total stake</strong> before any settlement — and every losing
                contract loses its stake. Size the count like you would size leverage, not like a loop counter.
            </HubNote>

            {paperLocked && (
                <HubNote tone='info'>
                    Not logged in — paper trading is locked on so nothing can place an order. Log in to switch
                    between paper and live.{' '}
                    <button type='button' className='hub-btn hub-btn--primary hub-btn--sm' onClick={() => run_panel?.showLoginDialog?.()}>
                        Log in
                    </button>
                </HubNote>
            )}

            <section className='bulk-controls' aria-label='Bulk trade parameters'>
                <label className='hub-field'>
                    Symbol
                    <select value={form.symbol} onChange={e => patch('symbol', e.target.value)}>
                        {SYMBOLS.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='hub-field'>
                    Contract type
                    <select
                        value={form.contractType}
                        onChange={e => patch('contractType', e.target.value as BulkTradeConfig['contractType'])}
                    >
                        {CONTRACT_TYPES.map(type => (
                            <option key={type} value={type}>
                                {type}
                            </option>
                        ))}
                    </select>
                </label>
                {form.contractType.startsWith('DIGIT') && (
                    <label className='hub-field'>
                        Barrier (0-9)
                        <input
                            type='number'
                            min={0}
                            max={9}
                            value={form.barrier}
                            onChange={e => patch('barrier', e.target.value)}
                        />
                    </label>
                )}
                <label className='hub-field'>
                    Stake
                    <input
                        type='number'
                        step={0.35}
                        min={0.35}
                        value={form.stake}
                        onChange={e => patch('stake', Number(e.target.value) || 0)}
                    />
                </label>
                <label className='hub-field'>
                    Count (1-50)
                    <input
                        type='number'
                        min={1}
                        max={50}
                        value={form.count}
                        onChange={e => patch('count', clamp(Number(e.target.value) || 1, 1, 50))}
                    />
                </label>
                <label className='hub-field'>
                    Duration
                    <input
                        type='number'
                        min={1}
                        value={form.duration}
                        onChange={e => patch('duration', Math.max(1, Number(e.target.value) || 1))}
                    />
                </label>
                <label className='hub-field'>
                    Unit
                    <select
                        value={form.durationUnit}
                        onChange={e => patch('durationUnit', e.target.value as BulkTradeConfig['durationUnit'])}
                    >
                        {DURATION_UNITS.map(unit => (
                            <option key={unit} value={unit}>
                                {unit === 't' ? 'ticks (t)' : unit === 's' ? 'seconds (s)' : 'minutes (m)'}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='hub-field'>
                    Max concurrent
                    <input
                        type='number'
                        min={1}
                        max={form.count}
                        value={form.maxConcurrent}
                        onChange={e => patch('maxConcurrent', Math.max(1, Number(e.target.value) || 1))}
                    />
                </label>
            </section>

            <section className='bulk-toggles'>
                <label className='bulk-toggle'>
                    <input
                        type='checkbox'
                        checked={paperLocked ? true : form.paperTrading}
                        disabled={paperLocked}
                        onChange={e => patch('paperTrading', e.target.checked)}
                    />
                    <span>
                        Paper trading {paperLocked ? '(locked while logged out)' : '(simulated fills)'}
                    </span>
                </label>
                <label className='bulk-toggle'>
                    <input
                        type='checkbox'
                        checked={form.allowLiveTrading && isLoggedIn}
                        disabled={!isLoggedIn}
                        onChange={e => onToggleLive(e.target.checked)}
                    />
                    <span>
                        Allow live trading{' '}
                        {!isLoggedIn ? '(log in first)' : isDemo ? '(demo orders)' : '(REAL funds)'}
                    </span>
                </label>
                <div className='hub-actions'>
                    <button
                        type='button'
                        className='hub-btn hub-btn--primary'
                        disabled={state.status === 'starting' || state.status === 'running' || state.status === 'stopping'}
                        onClick={onStart}
                    >
                        {state.status === 'starting' ? 'Starting…' : 'Start'}
                    </button>
                    <button
                        type='button'
                        className='hub-btn hub-btn--danger'
                        disabled={!isRunning || state.status === 'stopping'}
                        onClick={() => bulkTrader.stop()}
                    >
                        Stop
                    </button>
                    <button type='button' className='hub-btn hub-btn--danger' onClick={onEmergencyStop}>
                        Emergency stop
                    </button>
                </div>
            </section>

            <p className='bulk-msg' aria-live='polite'>
                {formError || state.message}
            </p>

            <section className='hub-section' aria-live='polite'>
                <h3>
                    Progress <em>({progress.bought} bought · {progress.settled} settled of {progress.requested})</em>
                </h3>
                <div className='bulk-progress' role='progressbar' aria-valuenow={settledPct} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${settledPct}%` }} />
                </div>
                <div className='hub-stats'>
                    <div className='hub-stat'>
                        <span>Requested</span>
                        <strong>{progress.requested}</strong>
                    </div>
                    <div className='hub-stat'>
                        <span>Bought</span>
                        <strong>{progress.bought}</strong>
                    </div>
                    <div className='hub-stat'>
                        <span>Settled</span>
                        <strong>{progress.settled}</strong>
                    </div>
                    <div className='hub-stat'>
                        <span>Won</span>
                        <strong className='hub-pos'>{progress.won}</strong>
                    </div>
                    <div className='hub-stat'>
                        <span>Lost</span>
                        <strong className='hub-neg'>{progress.lost}</strong>
                    </div>
                    <div className='hub-stat'>
                        <span>Failed</span>
                        <strong className='hub-neg'>{progress.failed}</strong>
                    </div>
                </div>
            </section>

            <section className='hub-section'>
                <h3>Trades ({state.trades.length})</h3>
                {state.trades.length === 0 ? (
                    <p className='hub-empty'>No trades yet — start a run to see contracts land here.</p>
                ) : (
                    <div className='hub-table-wrap'>
                        <table className='hub-table'>
                            <thead>
                                <tr>
                                    <th>Contract</th>
                                    <th>Market</th>
                                    <th>Type</th>
                                    <th>Duration</th>
                                    <th>Stake</th>
                                    <th>Payout</th>
                                    <th>Stage</th>
                                    <th>Result</th>
                                    <th>P/L</th>
                                    <th>Mode</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.trades.slice(0, 50).map(trade => (
                                    <TradeRow key={trade.id} trade={trade} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className='hub-section' aria-live='polite'>
                <h3>Events ({state.events.length})</h3>
                {state.events.length === 0 ? (
                    <p className='hub-empty'>Engine events will stream here once a run starts.</p>
                ) : (
                    <div className='hub-log' ref={feedRef}>
                        {state.events.map(event => (
                            <div key={event.id} className='hub-log__row' data-tone={EVENT_TONE[event.type] ?? 'info'}>
                                <span className='hub-log__time'>{timeAt(event.at)}</span>
                                <span className='hub-log__type'>{EVENT_LABEL[event.type] ?? event.type}</span>
                                <span className='hub-log__msg'>{event.message}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <HubNote tone='risk'>
                Honest note: a bulk run is N separate contracts, not one diversified position — losing streaks cost
                the stake on every leg. Paper trading simulates fills and settlements; it never spends real funds.
            </HubNote>
        </HubPage>
    );
});

export default BulkTraderPage;
