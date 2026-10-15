import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { signalScanner } from '@/bot/engine/signal-scanner';
import { useAIBot, useScannerPerformance, useSignalScanner } from '@/bot/use-engine';
import {
    ACTION_LABEL,
    ContractFamily,
    FAMILY_LABEL,
} from '@/bot/core/signal-types';
import './ai-signal-scanner.scss';

const pct = (n: number) => `${n.toFixed(1)}%`;
const money = (n: number) => `${n.toFixed(2)}`;

const ALL_FAMILIES: ContractFamily[] = ['rise_fall', 'even_odd', 'over_under', 'match_differ', 'mean_reversion'];

const EVENT_LABEL: Record<string, string> = {
    status: 'Status',
    discover: 'Discover',
    scan: 'Scan',
    signal: 'Signal',
    quote: 'Quote',
    purchase: 'Bought',
    settlement: 'Settled',
    risk: 'Risk',
    error: 'Error',
};

const timeAt = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const INIT_STEPS = ['Discover markets', 'Warm tick buffers', 'Scan & trade'];

const initStepState = (status: string, i: number): 'done' | 'active' | 'pending' => {
    const stage = ['discovering', 'warming', 'scanning'].indexOf(status);
    if (stage === -1) return 'done';
    if (i < stage) return 'done';
    if (i === stage) return 'active';
    return 'pending';
};

const AISignalScannerPage = observer(() => {
    const state = useSignalScanner();
    const perf = useScannerPerformance();
    const { client, run_panel } = useStore() ?? {};

    const [families, setFamilies] = useState<ContractFamily[]>(state.config.families);
    const [sampleSize, setSampleSize] = useState(state.config.sampleSize);
    const [threshold, setThreshold] = useState(state.config.threshold);
    const [overBarrier, setOverBarrier] = useState(state.config.overBarrier);
    const [underBarrier, setUnderBarrier] = useState(state.config.underBarrier);
    const [matchDigit, setMatchDigit] = useState(state.config.matchDigit);
    const [stake, setStake] = useState(state.config.stake);
    const [maxStake, setMaxStake] = useState(state.config.maxStake);
    const [maxDailyLoss, setMaxDailyLoss] = useState(state.config.maxDailyLoss);
    const [maxConsec, setMaxConsec] = useState(state.config.maxConsecutiveLosses);
    const [martingale, setMartingale] = useState(state.config.martingale);
    const aiBot = useAIBot();
    const autoTrade = state.config.autoTrade;
    const paperTrading = state.config.paperTrading;

    const isRunning = !['idle', 'stopped', 'error'].includes(state.status);
    const isLoggedIn = Boolean(client?.is_logged_in);
    const activeLoginid = client?.loginid || '';
    const isDemo = activeLoginid ? isDemoAccount(activeLoginid) : state.accountIsDemo;

    const applyConfig = () => {
        signalScanner.configure({
            families,
            sampleSize: Number(sampleSize) || 100,
            threshold: Number(threshold) || 58,
            overBarrier: Number(overBarrier) || 2,
            underBarrier: Number(underBarrier) || 7,
            matchDigit: Number(matchDigit) || 7,
            stake: Number(stake) || 1,
            maxStake: Number(maxStake) || 5,
            maxDailyLoss: Number(maxDailyLoss) || 20,
            maxConsecutiveLosses: Number(maxConsec) || 4,
            martingale,
        });
    };

    // Keep the engine in sync as settings change so toggling auto-trade (or any
    // option) takes effect immediately — even while the scanner is running.
    useEffect(() => {
        applyConfig();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        families,
        sampleSize,
        threshold,
        overBarrier,
        underBarrier,
        matchDigit,
        stake,
        maxStake,
        maxDailyLoss,
        maxConsec,
        martingale,
    ]);

    // The session can drop (expired token, forced logout) after the user armed
    // auto-trade with live or paper mode. On that transition only, fall back to
    // paper so their intent survives — never real orders without a login, and
    // never a guest's deliberate paper-off being undone.
    const prevLoggedIn = useRef(isLoggedIn);
    useEffect(() => {
        const dropped = prevLoggedIn.current && !isLoggedIn;
        prevLoggedIn.current = isLoggedIn;
        if (dropped && autoTrade && !paperTrading) {
            signalScanner.configure({ paperTrading: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoggedIn]);

    const onStart = async () => {
        applyConfig();
        await signalScanner.start();
    };

    const onToggleLive = (enabled: boolean) => {
        if (enabled && !isDemo) {
            const ok = window.confirm('Enable LIVE trading on a real-money account? Orders will use real funds. Continue?');
            if (!ok) return;
        }
        signalScanner.setLiveTrading(enabled);
    };

    const toggleFamily = (f: ContractFamily) => {
        setFamilies(prev => (prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]));
    };

    const markets = useMemo(() => state.markets, [state.markets]);

    // Signals run on Deriv public market data and need no session, so the scanner
    // is always available. Only auto-trade / live orders require an authorized login,
    // which the engine enforces — we surface that as a notice instead of a wall.
    return (
        <div className='ai-scanner'>
            {!isLoggedIn && (
                <div className='ai-scanner__notice ai-scanner__notice--login' role='note'>
                    Not logged in — scanning Deriv&apos;s public markets for signals only, so auto-trade
                    cannot place orders yet. Enable paper mode to run it risk-free on real ticks, or log
                    in for demo/real orders.{' '}
                    <button
                        type='button'
                        className='ai-scanner__btn ai-scanner__btn--primary'
                        onClick={() => signalScanner.configure({ paperTrading: true, autoTrade: true })}
                    >
                        Enable paper auto-trade
                    </button>{' '}
                    <button type='button' className='ai-scanner__btn' onClick={() => run_panel?.showLoginDialog?.()}>
                        Log in for demo/real orders
                    </button>
                </div>
            )}
            <header className='ai-scanner__head'>
                <div>
                    <h2 className='ai-scanner__title'>AI Signal Scanner</h2>
                    <p className='ai-scanner__sub'>
                        Continuously scans multiple synthetic markets, measures digit and price statistics
                        (even/odd, over/under, rise/fall, match/differ, RSI, trend), and auto-trades the
                        strongest signal that clears your threshold and risk limits.
                    </p>
                </div>
                <div className='ai-scanner__status'>
                    {isRunning && <span className='ai-scanner__radar' aria-hidden='true' />}
                    <span className={`ai-scanner__badge ai-scanner__badge--${state.status}`}>{state.status}</span>
                    <span className={`ai-scanner__acct ${isDemo ? 'ai-scanner__acct--demo' : ''}`}>
                        {!isLoggedIn ? 'Guest · signals only' : `${isDemo ? 'Demo' : 'Real'} · ${activeLoginid}`}
                    </span>
                    <span className='ai-scanner__equity'>Equity {money(state.equity)}</span>
                </div>
            </header>

            {isRunning && state.status !== 'suspended' && (
                <div className='ai-scanner__pipeline' role='status' aria-label='Scanner startup sequence'>
                    {INIT_STEPS.map((label, i) => (
                        <span key={label} className={`ai-scanner__step ai-scanner__step--${initStepState(state.status, i)}`}>
                            <span className='ai-scanner__step-dot' aria-hidden='true' />
                            {label}
                        </span>
                    ))}
                </div>
            )}

            <div className='ai-scanner__notice' role='note'>
                Signals are statistical measurements of the recent distribution, not predictions. Digit and
                rise/fall outcomes are near-random; most strategies carry a negative expected value against the
                broker payout. Trade demo first and risk only what you can lose.
            </div>

            <section className='ai-scanner__controls'>
                <div className='ai-scanner__ctrl-group'>
                    <button type='button' className='ai-scanner__btn ai-scanner__btn--primary' disabled={isRunning || state.risk.suspended} onClick={onStart}>
                        Start scanner
                    </button>
                    <button type='button' className='ai-scanner__btn' disabled={!isRunning} onClick={() => signalScanner.stop()}>
                        Stop
                    </button>
                    <button type='button' className='ai-scanner__btn ai-scanner__btn--danger' onClick={() => signalScanner.emergencyStop()}>
                        Emergency stop
                    </button>
                    {state.risk.suspended && (
                        <button type='button' className='ai-scanner__btn' onClick={() => signalScanner.resumeAfterSuspend()}>
                            Resume (reset risk)
                        </button>
                    )}
                </div>
                <label
                    className='ai-scanner__toggle'
                    onClick={e => {
                        if (!isLoggedIn) {
                            e.preventDefault();
                            run_panel?.showLoginDialog?.();
                        }
                    }}
                >
                    <input
                        type='checkbox'
                        disabled={!isLoggedIn}
                        checked={state.liveTrading}
                        onChange={e => onToggleLive(e.target.checked)}
                    />
                    <span>
                        Live trading {!isLoggedIn ? '(log in first)' : isDemo ? '(demo orders)' : '(REAL funds)'}
                    </span>
                </label>
                <label className='ai-scanner__toggle'>
                    <input
                        type='checkbox'
                        checked={paperTrading}
                        onChange={e => signalScanner.configure({ paperTrading: e.target.checked })}
                    />
                    <span>Paper trading (simulated fills on real ticks — no real orders)</span>
                </label>
                <label
                    className='ai-scanner__toggle'
                    onClick={e => {
                        if (!isLoggedIn && !paperTrading) {
                            e.preventDefault();
                            signalScanner.configure({ paperTrading: true, autoTrade: true });
                        }
                    }}
                >
                    <input
                        type='checkbox'
                        disabled={!isLoggedIn && !paperTrading}
                        checked={autoTrade && (isLoggedIn || paperTrading)}
                        onChange={e => signalScanner.configure({ autoTrade: e.target.checked })}
                    />
                    <span>
                        Auto-trade signals{' '}
                        {!isLoggedIn && !paperTrading && '(click to enable paper + auto-trade, or log in)'}
                    </span>
                </label>
            </section>

            {autoTrade && (
                <div
                    className={`ai-scanner__at-state ${state.autoTradeBlock ? 'ai-scanner__at-state--blocked' : ''}`}
                    role='status'
                    data-testid='auto-trade-state'
                >
                    {state.autoTradeBlock
                        ? `Auto-trade paused — ${state.autoTradeBlock}`
                        : isRunning
                            ? 'Auto-trade active — waiting for signals above threshold'
                            : 'Auto-trade armed — start the scanner'}
                </div>
            )}

            <p className='ai-scanner__msg' aria-live='polite'>{state.message}</p>
            {state.risk.suspended && (
                <div className='ai-scanner__suspend' role='alert'>
                    Trading suspended: {state.risk.suspensionReason}
                </div>
            )}

            <div className='ai-scanner__grid ai-scanner__grid--stats'>
                <Stat label='Signals seen' value={state.signalsGenerated} />
                <Stat label='Signals executed' value={state.signalsExecuted} />
                <Stat label='Trades' value={perf.totalTrades} />
                <Stat label='Win rate' value={pct(perf.winRate)} />
                <Stat label='Net P/L' value={money(perf.netProfit)} tone={perf.netProfit >= 0 ? 'pos' : 'neg'} />
                <Stat label='Profit factor' value={Number.isFinite(perf.profitFactor) ? perf.profitFactor.toFixed(2) : '∞'} />
                <Stat label='Drawdown' value={money(perf.maxDrawdown)} tone='neg' />
                <Stat label='Consec. losses' value={`${state.risk.consecutiveLosses} / ${state.config.maxConsecutiveLosses}`} />
            </div>

            <section className='ai-scanner__section'>
                <h3>Configuration</h3>
                <div className='ai-scanner__families'>
                    {ALL_FAMILIES.map(f => (
                        <label key={f} className='ai-scanner__family'>
                            <input type='checkbox' checked={families.includes(f)} onChange={() => toggleFamily(f)} />
                            <span>{FAMILY_LABEL[f]}</span>
                        </label>
                    ))}
                </div>
                <div className='ai-scanner__grid ai-scanner__grid--config'>
                    <Field label='Sample size (ticks)' value={sampleSize} onChange={v => setSampleSize(Number(v))} />
                    <Field label='Signal threshold %' value={threshold} onChange={v => setThreshold(Number(v))} />
                    <Field label='Over barrier' value={overBarrier} onChange={v => setOverBarrier(Number(v))} />
                    <Field label='Under barrier' value={underBarrier} onChange={v => setUnderBarrier(Number(v))} />
                    <Field label='Match digit' value={matchDigit} onChange={v => setMatchDigit(Number(v))} />
                    <Field label='Base stake' value={stake} onChange={v => setStake(Number(v))} />
                    <Field label='Max stake' value={maxStake} onChange={v => setMaxStake(Number(v))} />
                    <Field label='Max daily loss' value={maxDailyLoss} onChange={v => setMaxDailyLoss(Number(v))} />
                    <Field label='Max consec. losses' value={maxConsec} onChange={v => setMaxConsec(Number(v))} />
                </div>
                <label className='ai-scanner__toggle'>
                    <input type='checkbox' checked={martingale} onChange={e => setMartingale(e.target.checked)} />
                    <span>Martingale stake recovery (2× after a loss, capped at 3 steps, reset on win) — risky</span>
                </label>
            </section>

            <section className='ai-scanner__section'>
                <h3>Live signals {state.signals.length === 0 && <em>(none above threshold yet)</em>}</h3>
                {state.signals.length > 0 && (
                    <div className='ai-scanner__table-wrap'>
                        <table className='ai-scanner__table'>
                            <thead>
                                <tr>
                                    <th>Market</th><th>Family</th><th>Action</th><th>Strength</th>
                                    <th>Confidence</th><th>Sample</th><th>Why</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.signals.slice(0, 12).map(s => (
                                    <tr key={s.id}>
                                        <td>{s.displayName}</td>
                                        <td>{FAMILY_LABEL[s.family]}</td>
                                        <td><strong>{ACTION_LABEL[s.action]}</strong>{s.barrier !== undefined ? ` ${s.barrier}` : ''}</td>
                                        <td>{pct(s.strength)}</td>
                                        <td className={s.confidence > 0 ? 'pos' : ''}>{pct(s.confidence * 100)}</td>
                                        <td>{s.sampleSize}</td>
                                        <td className='ai-scanner__why'>{s.rationale}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className='ai-scanner__section'>
                <h3>Multi-market scan ({markets.length} markets)</h3>
                {markets.length === 0
                    ? isRunning ? (
                        <div className='ai-scanner__table-wrap ai-scanner__skeleton' aria-hidden='true'>
                            <table className='ai-scanner__table'>
                                <tbody>
                                    {[0, 1, 2, 3, 4].map(i => (
                                        <tr key={i}>
                                            {Array.from({ length: 13 }, (_, j) => (
                                                <td key={j}><span className='ai-scanner__shimmer' /></td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className='ai-scanner__empty-row'>No markets warmed up yet — start the scanner.</p>
                    )
                : (
                    <div className='ai-scanner__table-wrap'>
                        <table className='ai-scanner__table'>
                            <thead>
                                <tr>
                                    <th>Market</th><th>Quote</th><th>Even</th><th>Odd</th>
                                    <th>Over {state.config.overBarrier}</th><th>Under {state.config.underBarrier}</th>
                                    <th>Rise</th><th>Fall</th><th>Match {state.config.matchDigit}</th>
                                    <th>MR pick</th>
                                    <th>Top digit</th><th>RSI</th><th>Trend</th>
                                </tr>
                            </thead>
                            <tbody>
                                {markets.map(m => (
                                    <tr key={m.symbol}>
                                        <td>{m.displayName}</td>
                                        <td>{m.lastQuote || '—'}</td>
                                        <td className={m.even >= m.odd ? 'pos' : ''}>{pct(m.even)}</td>
                                        <td className={m.odd > m.even ? 'pos' : ''}>{pct(m.odd)}</td>
                                        <td className={m.over >= 50 ? 'pos' : ''}>{pct(m.over)}</td>
                                        <td className={m.under >= 50 ? 'pos' : ''}>{pct(m.under)}</td>
                                        <td className={m.rise >= m.fall ? 'pos' : ''}>{pct(m.rise)}</td>
                                        <td className={m.fall > m.rise ? 'pos' : ''}>{pct(m.fall)}</td>
                                        <td>{pct(m.match)}</td>
                                        <td className={m.meanReversion ? 'pos' : ''}>
                                            {m.meanReversion
                                                ? `${m.meanReversion.kind} ${m.meanReversion.barrier} · ${m.meanReversion.strength}%${m.meanReversion.cluster ? ' (cluster)' : ''}`
                                                : '—'}
                                        </td>
                                        <td>{m.mostFreqDigit}</td>
                                        <td>{m.rsi.toFixed(0)}</td>
                                        <td>{m.trend}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className='ai-scanner__section'>
                <h3>Trade history</h3>
                {state.trades.length === 0 ? (
                    <>
                        <p className='ai-scanner__empty-row' data-testid='empty-history'>
                            {!autoTrade
                                ? 'No trades yet — Auto-trade is off. Turn on "Auto-trade signals" (enable Paper trading first, or log in) and start the scanner.'
                                : state.autoTradeBlock
                                  ? `No trades yet — auto-trade paused: ${state.autoTradeBlock}.`
                                  : !isRunning
                                    ? 'No trades yet — start the scanner to begin trading.'
                                    : `No trades yet — waiting for a signal above ${state.config.threshold}% that clears risk limits. Every attempt is listed in Live activity.`}
                        </p>
                        {!autoTrade && aiBot.config.autoTrade && (
                            <p className='ai-scanner__empty-row ai-scanner__empty-xref' role='note'>
                                The AI Bot has its own separate Auto-trade switch (currently ON) — its trades
                                appear in the AI Bot dock → Activity, not in this scanner&apos;s history. To trade
                                here, turn on &quot;Auto-trade signals&quot; above.
                            </p>
                        )}
                    </>
                ) : (
                    <div className='ai-scanner__table-wrap'>
                        <table className='ai-scanner__table'>
                            <thead>
                                <tr>
                                    <th>Market</th><th>Action</th><th>Stake</th><th>Payout</th>
                                    <th>Stage</th><th>Result</th><th>P/L</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.trades.slice(0, 50).map(t => (
                                    <tr key={t.id}>
                                        <td>{t.displayName}</td>
                                        <td>{t.contractType}{t.barrier ? ` ${t.barrier}` : ''}</td>
                                        <td>{money(t.stake)}</td>
                                        <td>{t.payoutRatio.toFixed(2)}×</td>
                                        <td><span className={`ai-scanner__stage ai-scanner__stage--${t.stage}`}>{t.stage}</span></td>
                                        <td className={t.result === 'win' ? 'pos' : t.result === 'loss' ? 'neg' : ''}>{t.result || '—'}</td>
                                        <td className={(t.profit ?? 0) >= 0 ? 'pos' : 'neg'}>{t.profit !== undefined ? money(t.profit) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className='ai-scanner__section ai-scanner__activity' aria-live='polite'>
                <h3>Live activity <em>({state.events.length} events)</em></h3>
                {state.events.length === 0 ? (
                    <p className='ai-scanner__empty-row'>No activity yet — start the scanner.</p>
                ) : (
                    <div className='ai-scanner__feed'>
                        {state.events.map(ev => (
                            <div key={ev.id} className={`ai-scanner__event ai-scanner__event--${ev.type}`}>
                                <span className='ai-scanner__event-time'>{timeAt(ev.at)}</span>
                                <span className='ai-scanner__event-type'>{EVENT_LABEL[ev.type]}</span>
                                <span className='ai-scanner__event-msg'>{ev.message}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
});

const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: 'pos' | 'neg' }) => (
    <div className='ai-scanner__stat'>
        <span className='ai-scanner__stat-label'>{label}</span>
        <span key={String(value)} className={`ai-scanner__stat-value ${tone || ''}`}>{value}</span>
    </div>
);

const Field = ({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string | number;
    onChange: (v: string) => void;
}) => (
    <label className='ai-scanner__field'>
        <span>{label}</span>
        <input type='text' value={value} onChange={e => onChange(e.target.value)} />
    </label>
);

export default AISignalScannerPage;
