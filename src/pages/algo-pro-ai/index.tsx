import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { useAlgoProAi } from '@/bot/use-engine';
import { algoProEngine, DEFAULT_ALGO_PRO_SETTINGS, type AlgoProSettings } from '@/bot/engine/algo-pro-ai';
import {
    ALGO_PRO_STRATEGIES,
    PAIR_PROFILES,
    type AlgoProScope,
    type AlgoProStrategyId,
    type PairProfileId,
} from '@/bot/core/algo-pro-ai';
import { HubNote, HubPage, HubPageHeader } from '@/components/hub-page';
import './algo-pro-ai.scss';

const timeAt = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const money = (n: number) => n.toFixed(2);

const EVENT_TONE: Record<string, string> = {
    status: 'info',
    discover: 'info',
    signal: 'buy',
    purchase: 'buy',
    settlement: 'settle',
    error: 'err',
    risk: 'warn',
};

const EVENT_LABEL: Record<string, string> = {
    status: 'Status',
    discover: 'Scan',
    signal: 'Signal',
    purchase: 'Bought',
    settlement: 'Settle',
    error: 'Error',
    risk: 'Risk',
};

const SCOPES: { id: AlgoProScope; label: string }[] = [
    { id: 'all', label: 'All 10 markets' },
    { id: 'standard', label: 'Standard (R_*)' },
    { id: 'one-second', label: '1-second (1HZ*)' },
];

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const AlgoProAiPage = observer(() => {
    const state = useAlgoProAi();
    const { client, run_panel } = useStore() ?? {};
    const [form, setForm] = useState<AlgoProSettings>(() => ({ ...DEFAULT_ALGO_PRO_SETTINGS }));
    const logRef = useRef<HTMLDivElement | null>(null);

    const isLoggedIn = Boolean(client?.is_logged_in);
    const activeLoginid = client?.loginid || '';
    const isDemo = state.accountIsDemo || isDemoAccount(activeLoginid);
    const paperLocked = !isLoggedIn;
    const isRunning = state.running || state.loading;

    const patch = <K extends keyof AlgoProSettings>(key: K, value: AlgoProSettings[K]) =>
        setForm(prev => ({ ...prev, [key]: value }));

    useEffect(() => {
        const el = logRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [state.events.length]);

    const strategy = ALGO_PRO_STRATEGIES.find(s => s.id === form.strategyId) ?? ALGO_PRO_STRATEGIES[0];

    const onStart = () => {
        if (!form.paperTrading && !isDemo) {
            const ok = window.confirm('Paper trading is off and this is a REAL-money account. Every buy spends real funds. Continue?');
            if (!ok) return;
        }
        void algoProEngine.start({
            ...form,
            paperTrading: paperLocked ? true : form.paperTrading,
            allowLiveTrading: paperLocked ? false : form.allowLiveTrading,
        });
    };

    const onToggleLive = (enabled: boolean) => {
        if (enabled) {
            const ok = window.confirm('Allow LIVE orders on this account? Buys will spend real money unless paper trading stays on. Continue?');
            if (!ok) return;
        }
        patch('allowLiveTrading', enabled);
    };

    const perf = algoProEngine.getPerformance();
    const best = state.markets.length
        ? [...state.markets].sort((a, b) => b.pairConfidence - a.pairConfidence)[0]
        : null;

    return (
        <HubPage className='algo-pro-page'>
            <HubPageHeader
                title='Algo Pro AI'
                subtitle='Continuous AI scanner across all 10 volatility indices (R_10 … R_100 + 1s). Pattern strategies, martingale recovery, take-profit/stop-loss — one contract at a time, with honest settlement handling.'
                badge={
                    <>
                        <span className={`hub-badge ${state.running ? 'hub-badge--running' : state.error ? 'hub-badge--error' : 'hub-badge--idle'}`}>
                            {state.running ? 'Scanning' : state.loading ? 'Loading' : 'Idle'}
                        </span>
                        <span
                            className={['hub-badge', !isLoggedIn ? 'hub-badge--guest' : isDemo ? 'hub-badge--demo' : 'hub-badge--real'].filter(Boolean).join(' ')}
                        >
                            {!isLoggedIn ? 'Guest · paper only' : `${isDemo ? 'Demo' : 'Real'} · ${activeLoginid}`}
                        </span>
                    </>
                }
            />

            <HubNote tone='info'>
                <strong>Status:</strong> {state.status}
                {state.executionBlock ? ` — holding: ${state.executionBlock}` : ''}
            </HubNote>

            {paperLocked && (
                <HubNote tone='risk'>
                    Not logged in — paper trading is locked on so nothing can place a real order. Log in to trade on a demo or real account.{' '}
                    <button type='button' className='hub-btn hub-btn--primary hub-btn--sm' onClick={() => run_panel?.showLoginDialog?.()}>
                        Log in
                    </button>
                </HubNote>
            )}

            <section className='algo-pro-controls' aria-label='Algo Pro AI parameters'>
                <label className='hub-field'>
                    Strategy
                    <select
                        value={form.strategyId}
                        onChange={e => patch('strategyId', e.target.value as AlgoProStrategyId)}
                    >
                        {ALGO_PRO_STRATEGIES.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.number} · {s.title}
                            </option>
                        ))}
                    </select>
                </label>
                <div className='algo-pro-strategy-desc' aria-live='polite'>
                    <strong>{strategy.shortTitle}</strong> — {strategy.description}
                </div>
                <div className='algo-pro-fieldset'>
                    <span className='algo-pro-label'>Markets</span>
                    <div className='hub-seg' role='group' aria-label='Market scope'>
                        {SCOPES.map(sc => (
                            <button
                                key={sc.id}
                                type='button'
                                className={`hub-seg__btn ${form.scope === sc.id ? 'hub-seg__btn--on' : ''}`}
                                onClick={() => patch('scope', sc.id)}
                            >
                                {sc.label}
                            </button>
                        ))}
                    </div>
                </div>
                <label className='hub-field'>
                    Stake
                    <input type='number' step={0.35} min={0.35} value={form.stake} onChange={e => patch('stake', Number(e.target.value) || 0)} />
                </label>
                <label className='hub-field'>
                    Duration (ticks 1-10)
                    <input type='number' min={1} max={10} value={form.ticks} onChange={e => patch('ticks', Math.min(10, Math.max(1, Number(e.target.value) || 1)))} />
                </label>
                <label className='hub-field'>
                    Martingale factor
                    <input type='number' step={0.5} min={1} value={form.martingale} onChange={e => patch('martingale', Math.max(1, Number(e.target.value) || 1))} />
                </label>
                <label className='hub-field'>
                    Take profit
                    <input type='number' min={0} value={form.takeProfit} onChange={e => patch('takeProfit', Math.max(0, Number(e.target.value) || 0))} />
                </label>
                <label className='hub-field'>
                    Stop loss
                    <input type='number' min={0} value={form.stopLoss} onChange={e => patch('stopLoss', Math.max(0, Number(e.target.value) || 0))} />
                </label>
                <label className='hub-field'>
                    Win target (0 = off)
                    <input type='number' min={0} value={form.winTarget} onChange={e => patch('winTarget', Math.max(0, Number(e.target.value) || 0))} />
                </label>
                <label className='hub-field'>
                    Pair-scan profile
                    <select value={form.profileId} onChange={e => patch('profileId', e.target.value as PairProfileId)}>
                        {PAIR_PROFILES.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='hub-field'>
                    Pair confidence gate (0-1)
                    <input type='number' step={0.05} min={0} max={1} value={form.pairConfidenceGate} onChange={e => patch('pairConfidenceGate', Math.min(1, Math.max(0, Number(e.target.value) || 0)))} />
                </label>
            </section>

            <section className='algo-pro-toggles'>
                <label className='algo-pro-toggle'>
                    <input type='checkbox' checked={form.usePairScanner} onChange={e => patch('usePairScanner', e.target.checked)} />
                    <span>Use pair scanner (confidence-gated Over/Under) instead of pattern strategy</span>
                </label>
                <label className='algo-pro-toggle'>
                    <input type='checkbox' checked={paperLocked ? true : form.paperTrading} disabled={paperLocked} onChange={e => patch('paperTrading', e.target.checked)} />
                    <span>Paper trading {paperLocked ? '(locked while logged out)' : '(simulated fills on real ticks)'}</span>
                </label>
                <label className='algo-pro-toggle'>
                    <input type='checkbox' checked={form.allowLiveTrading && isDemo && isLoggedIn} disabled={!isLoggedIn || !isDemo} onChange={e => onToggleLive(e.target.checked)} />
                    <span>
                        Allow live trading {!isLoggedIn ? '(log in first)' : isDemo ? '(demo orders)' : '(unavailable on a real account)'}
                    </span>
                </label>
                <div className='hub-actions'>
                    <button type='button' className='hub-btn hub-btn--primary' disabled={isRunning} onClick={onStart}>
                        {state.loading ? 'Starting…' : state.running ? 'Running…' : 'Start scanner'}
                    </button>
                    <button type='button' className='hub-btn hub-btn--danger' disabled={!isRunning} onClick={() => algoProEngine.stop()}>
                        Stop
                    </button>
                </div>
            </section>

            <section className='algo-pro-stats hub-stats' aria-live='polite'>
                <div className='hub-stat'>
                    <span>Total P/L</span>
                    <strong className={state.totalProfit >= 0 ? 'hub-pos' : 'hub-neg'}>{money(state.totalProfit)}</strong>
                </div>
                <div className='hub-stat'>
                    <span>Wins</span>
                    <strong className='hub-pos'>{perf.wins}</strong>
                </div>
                <div className='hub-stat'>
                    <span>Losses</span>
                    <strong className='hub-neg'>{perf.losses}</strong>
                </div>
                <div className='hub-stat'>
                    <span>Loss depth</span>
                    <strong>{state.lossDepth}</strong>
                </div>
                <div className='hub-stat'>
                    <span>Recovery mode</span>
                    <strong>{state.recoveryMode ? 'ON' : 'off'}</strong>
                </div>
                <div className='hub-stat'>
                    <span>Ready signals</span>
                    <strong>{state.readySignals}</strong>
                </div>
            </section>

            {best && (
                <HubNote tone='info' role='status'>
                    <strong>Best pair signal right now:</strong> {best.displayName} — {best.signal ? best.signal.label : best.lastDigit >= 0 ? `digit ${best.lastDigit}` : 'warming up'}{' '}
                    (pair confidence {fmtPct(best.pairConfidence)})
                </HubNote>
            )}

            <section className='hub-section'>
                <h3>
                    Markets <em>({state.markets.length} watched · strategy {strategy.shortTitle})</em>
                </h3>
                {state.markets.length === 0 ? (
                    <p className='hub-empty'>Start the scanner to warm up the volatility markets.</p>
                ) : (
                    <div className='hub-table-wrap'>
                        <table className='hub-table algo-pro-markets'>
                            <thead>
                                <tr>
                                    <th>Market</th>
                                    <th>Last quote</th>
                                    <th>Last digits</th>
                                    <th>Signal</th>
                                    <th>Pair conf.</th>
                                    <th>Checked</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.markets.map(m => (
                                    <tr key={m.symbol} className={m.trading ? 'algo-pro-row--trading' : ''}>
                                        <td>
                                            <span className={`algo-pro-dot ${m.trading ? 'algo-pro-dot--on' : ''}`} aria-hidden='true' />
                                            {m.displayName}
                                        </td>
                                        <td>{m.lastQuote ? m.lastQuote.toFixed(m.oneSecond ? 2 : 3) : '—'}</td>
                                        <td className='algo-pro-digits'>
                                            {m.digits.slice(-12).map((d, i) => (
                                                <span key={`${m.symbol}-${i}-${d}`}>{d}</span>
                                            ))}
                                        </td>
                                        <td className={m.signal ? 'algo-pro-signal' : ''}>{m.signal?.label ?? '—'}</td>
                                        <td>{fmtPct(m.pairConfidence)}</td>
                                        <td>{m.checked}</td>
                                        <td>{m.status}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className='hub-section'>
                <h3>Trades ({state.trades.length})</h3>
                {state.trades.length === 0 ? (
                    <p className='hub-empty'>No trades yet — trades land here once a signal fires.</p>
                ) : (
                    <div className='hub-table-wrap'>
                        <table className='hub-table'>
                            <thead>
                                <tr>
                                    <th>Contract</th>
                                    <th>Market</th>
                                    <th>Type</th>
                                    <th>Stake</th>
                                    <th>Stage</th>
                                    <th>Result</th>
                                    <th>P/L</th>
                                    <th>Mode</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.trades.slice(0, 50).map(t => (
                                    <tr key={t.id}>
                                        <td>{t.contractId ?? t.id}</td>
                                        <td>{t.displayName}</td>
                                        <td>
                                            {t.contractType}
                                            {t.barrier !== undefined ? ` ${t.barrier}` : ''}
                                        </td>
                                        <td>{money(t.stake)}</td>
                                        <td>{t.stage}</td>
                                        <td className={t.result === 'win' ? 'hub-pos' : t.result === 'loss' ? 'hub-neg' : ''}>
                                            {t.result ?? '—'}
                                        </td>
                                        <td className={(t.profit ?? 0) >= 0 ? 'hub-pos' : 'hub-neg'}>
                                            {t.profit !== undefined ? money(t.profit) : '—'}
                                        </td>
                                        <td>{t.simulated ? 'paper' : 'live'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className='hub-section' aria-live='polite'>
                <h3>Events ({state.events.length})</h3>
                {state.events.length === 0 ? (
                    <p className='hub-empty'>Engine events stream here once the scanner starts.</p>
                ) : (
                    <div className='hub-log' ref={logRef}>
                        {state.events.map(ev => (
                            <div key={ev.id} className='hub-log__row' data-tone={EVENT_TONE[ev.type] ?? 'info'}>
                                <span className='hub-log__time'>{timeAt(ev.at)}</span>
                                <span className='hub-log__type'>{EVENT_LABEL[ev.type] ?? ev.type}</span>
                                <span className='hub-log__msg'>{ev.message}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <HubNote tone='risk'>
                Honest note: pattern scanners cannot beat a fair wheel — they react to streak patterns and digit
                runs, not to predictive edges. Martingale recovery multiplies stake after every loss and can hit the
                stop loss quickly. Paper mode simulates fills on real ticks and never spends real funds; unknown
                settlements are recorded as unknown, never as wins or losses.
            </HubNote>
        </HubPage>
    );
});

export default AlgoProAiPage;
