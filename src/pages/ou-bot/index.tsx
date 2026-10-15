import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { ouBotEngine } from '@/bot/engine/engine';
import { useOUBotEngine, useOUPerformance } from '@/bot/use-engine';
import { DEFAULT_RISK_LIMITS } from '@/bot/core/risk';
import type { BotMode, EventType } from '@/bot/core/types';
import './ou-bot.scss';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const money = (n: number) => `${n.toFixed(2)}`;

const STAGE_LABEL: Record<string, string> = {
    detected: 'Detected',
    proposed: 'Quote requested',
    submitted: 'Order submitted',
    confirmed: 'Confirmed by broker',
    settled: 'Settled',
    rejected: 'Rejected',
};

const EVENT_LABEL: Record<EventType, string> = {
    status: 'Status',
    discover: 'Discover',
    scan: 'Scan',
    opportunity: 'Edge',
    quote: 'Quote',
    purchase: 'Bought',
    settlement: 'Settled',
    risk: 'Risk',
    error: 'Error',
};

const EVENT_TONE: Record<EventType, string> = {
    status: 'info',
    discover: 'info',
    scan: 'muted',
    opportunity: 'info',
    quote: 'info',
    purchase: 'buy',
    settlement: 'settle',
    risk: 'warn',
    error: 'err',
};

const timeAt = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const OUBotPage = observer(() => {
    const state = useOUBotEngine();
    const perf = useOUPerformance();
    const { client, run_panel } = useStore() ?? {};

    const [stake, setStake] = useState(state.config.stake);
    const [maxStake, setMaxStake] = useState(state.config.limits.maxStake);
    const [minEv, setMinEv] = useState(state.config.limits.minExpectedValue);
    const [minConf, setMinConf] = useState(state.config.limits.minConfidence);
    const [minSample, setMinSample] = useState(state.config.limits.minSampleSize);
    const [maxDailyLoss, setMaxDailyLoss] = useState(state.config.limits.maxDailyLoss);
    const [maxConsec, setMaxConsec] = useState(state.config.limits.maxConsecutiveLosses);
    const [barriersOver, setBarriersOver] = useState(state.config.barriersOver.join(','));
    const [barriersUnder, setBarriersUnder] = useState(state.config.barriersUnder.join(','));
    const [mode, setMode] = useState<BotMode>(state.config.mode);
    const [activeEvery, setActiveEvery] = useState(state.config.activeIntervalMs / 1000);

    const isRunning = state.status !== 'idle' && state.status !== 'stopped' && state.status !== 'error';
    const isLoggedIn = Boolean(client?.is_logged_in);
    const activeLoginid = client?.loginid || '';
    const isDemo = activeLoginid ? isDemoAccount(activeLoginid) : state.accountIsDemo;

    const applyConfig = () => {
        ouBotEngine.configure({
            stake: Number(stake) || 1,
            mode,
            activeIntervalMs: Math.max(5, Number(activeEvery) || 12) * 1000,
            barriersOver: barriersOver.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n >= 0 && n <= 8),
            barriersUnder: barriersUnder.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n >= 1 && n <= 9),
            limits: {
                ...DEFAULT_RISK_LIMITS,
                maxStake: Number(maxStake) || 1,
                minExpectedValue: Number(minEv) || 0.01,
                minConfidence: Number(minConf) || 0.6,
                minSampleSize: Number(minSample) || 500,
                maxDailyLoss: Number(maxDailyLoss) || 20,
                maxConsecutiveLosses: Number(maxConsec) || 3,
            },
        });
    };

    const onModeChange = (m: BotMode) => {
        if (m === 'active' && !isDemo) {
            const ok = window.confirm(
                'Active mode places trades on a cadence regardless of edge. On a REAL account this means real money is used. Continue?'
            );
            if (!ok) return;
        }
        setMode(m);
        applyConfig();
        ouBotEngine.setMode(m);
    };

    const onStart = async () => {
        applyConfig();
        await ouBotEngine.start();
    };

    const onToggleLive = (enabled: boolean) => {
        if (enabled && !isDemo) {
            const ok = window.confirm(
                'Enable LIVE trading on a real-money account? Orders will use real funds. Continue?'
            );
            if (!ok) return;
        }
        ouBotEngine.setLiveTrading(enabled);
        ouBotEngine.configure({ allowLiveTrading: enabled });
    };

    const markets = useMemo(() => ouBotEngine.getMarketsAnalysis(), [state.series, state.symbols, state.status]);

    // Analysis, digit statistics and quotes run on Deriv public data, so the bot is
    // usable before login. Order placement requires an authorized session, which the
    // engine enforces — surfaced here as a notice rather than blocking the page.
    return (
        <div className='ou-bot'>
            {!isLoggedIn && (
                <div className='ou-bot__notice ou-bot__notice--login' role='note'>
                    Not logged in — running analysis on Deriv&apos;s public markets. Orders are disabled until you log in.{' '}
                    <button type='button' className='ou-bot__btn' onClick={() => run_panel?.showLoginDialog?.()}>
                        Log in to enable trading
                    </button>
                </div>
            )}
            <header className='ou-bot__head'>
                <div>
                    <h2>Over / Under Bot</h2>
                    <p className='ou-bot__sub'>
                        Scans synthetic digit markets, measures last-digit skew against broker payouts, and only acts
                        when a statistically defensible edge exists.
                    </p>
                </div>
                <div className='ou-bot__status'>
                    <span className={`ou-bot__badge ou-bot__badge--${state.status}`}>{state.status}</span>
                    <span className={`ou-bot__acct ${isDemo ? 'ou-bot__acct--demo' : ''}`}>
                        {!isLoggedIn ? 'Guest · analysis only' : `${isDemo ? 'Demo' : 'Real'} · ${activeLoginid}`}
                    </span>
                    <span className='ou-bot__equity'>Equity {money(state.equity)}</span>
                </div>
            </header>

            <div className='ou-bot__notice' role='note'>
                No strategy guarantees profit. This bot stays inactive when no sufficiently attractive, statistically
                supported opportunity is found. Digit history alone is not a reliable predictor of the next digit.
            </div>

            <section className='ou-bot__controls'>
                <div className='ou-bot__mode'>
                    <span className='ou-bot__mode-label'>Strategy</span>
                    <div className='ou-bot__mode-seg'>
                        <button
                            type='button'
                            className={`ou-bot__mode-btn ${mode === 'edge' ? 'ou-bot__mode-btn--on' : ''}`}
                            onClick={() => onModeChange('edge')}
                        >
                            Edge (disciplined)
                        </button>
                        <button
                            type='button'
                            className={`ou-bot__mode-btn ${mode === 'active' ? 'ou-bot__mode-btn--on' : ''}`}
                            onClick={() => onModeChange('active')}
                        >
                            Active (demo practice)
                        </button>
                    </div>
                    <span className='ou-bot__mode-hint'>
                        {mode === 'edge'
                            ? 'Trades only when a positive expected-value edge clears every gate.'
                            : 'Places a trade on a cadence regardless of edge so you can watch the live pipeline. Risk gates still apply.'}
                    </span>
                </div>
                <div className='ou-bot__ctrl-group'>
                    <button
                        type='button'
                        className='ou-bot__btn ou-bot__btn--primary'
                        disabled={isRunning || state.risk.suspended}
                        onClick={onStart}
                    >
                        Start engine
                    </button>
                    <button type='button' className='ou-bot__btn' disabled={!isRunning} onClick={() => ouBotEngine.stop()}>
                        Stop
                    </button>
                    <button type='button' className='ou-bot__btn ou-bot__btn--danger' onClick={() => ouBotEngine.emergencyStop()}>
                        Emergency stop
                    </button>
                    {state.risk.suspended && (
                        <button type='button' className='ou-bot__btn' onClick={() => ouBotEngine.resumeAfterSuspend()}>
                            Resume (reset risk)
                        </button>
                    )}
                </div>
                <label className='ou-bot__toggle'>
                    <input
                        type='checkbox'
                        disabled={!isLoggedIn}
                        checked={state.liveTrading && isLoggedIn}
                        onChange={e => onToggleLive(e.target.checked)}
                    />
                    <span>
                        Live trading {!isLoggedIn ? '(log in first)' : isDemo ? '(demo orders)' : '(REAL funds)'}
                    </span>
                </label>
            </section>

            <p className='ou-bot__msg' aria-live='polite'>{state.message}</p>
            {state.risk.suspended && (
                <div className='ou-bot__suspend' role='alert'>
                    Trading suspended: {state.risk.suspensionReason}
                </div>
            )}

            <section className='ou-bot__section ou-bot__activity' aria-live='polite'>
                <h3>
                    Live activity <em>({state.events.length} events)</em>
                </h3>
                {state.events.length === 0 ? (
                    <p className='ou-bot__empty-row'>No activity yet — start the engine to see quotes, purchases, and settlements stream in.</p>
                ) : (
                    <div className='ou-bot__feed'>
                        {state.events.map(ev => (
                            <div key={ev.id} className={`ou-bot__event ou-bot__event--${EVENT_TONE[ev.type]}`}>
                                <span className='ou-bot__event-time'>{timeAt(ev.at)}</span>
                                <span className='ou-bot__event-type'>{EVENT_LABEL[ev.type]}</span>
                                <span className='ou-bot__event-msg'>{ev.message}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <div className='ou-bot__grid ou-bot__grid--stats'>
                <Stat label='Trades' value={perf.totalTrades} />
                <Stat label='Win rate' value={pct(perf.winRate)} />
                <Stat label='Net P/L' value={money(perf.netProfit)} tone={perf.netProfit >= 0 ? 'pos' : 'neg'} />
                <Stat label='Profit factor' value={Number.isFinite(perf.profitFactor) ? perf.profitFactor.toFixed(2) : '∞'} />
                <Stat label='Max drawdown' value={money(perf.maxDrawdown)} tone='neg' />
                <Stat label='Consec. losses' value={`${state.risk.consecutiveLosses} / ${state.config.limits.maxConsecutiveLosses}`} />
                <Stat label='Daily P/L' value={money(state.risk.dailyPnl)} tone={state.risk.dailyPnl >= 0 ? 'pos' : 'neg'} />
                <Stat label='Open positions' value={`${state.risk.openPositions} / ${state.config.limits.maxOpenPositions}`} />
            </div>

            <div className='ou-bot__grid ou-bot__grid--config'>
                <Field label='Base stake' value={stake} onChange={v => setStake(Number(v))} />
                <Field label='Max stake' value={maxStake} onChange={v => setMaxStake(Number(v))} />
                <Field label='Min EV %' value={minEv} onChange={v => setMinEv(Number(v))} step={0.005} />
                <Field label='Min confidence' value={minConf} onChange={v => setMinConf(Number(v))} step={0.05} />
                <Field label='Min sample size' value={minSample} onChange={v => setMinSample(Number(v))} />
                <Field label='Max daily loss' value={maxDailyLoss} onChange={v => setMaxDailyLoss(Number(v))} />
                <Field label='Max consec. losses' value={maxConsec} onChange={v => setMaxConsec(Number(v))} />
                {mode === 'active' && (
                    <Field label='Active trade every (s)' value={activeEvery} onChange={v => setActiveEvery(Number(v))} />
                )}
                <Field label='Over barriers' value={barriersOver} onChange={setBarriersOver} />
                <Field label='Under barriers' value={barriersUnder} onChange={setBarriersUnder} />
            </div>

            <section className='ou-bot__section'>
                <h3>Ranked opportunities {state.dryRun && <em>(analysis only — no orders)</em>}</h3>
                {state.opportunities.length === 0 ? (
                    <p className='ou-bot__empty-row'>No opportunity currently clears the EV + confidence thresholds.</p>
                ) : (
                    <div className='ou-bot__table-wrap'>
                        <table className='ou-bot__table'>
                            <thead>
                                <tr>
                                    <th>Market</th><th>Contract</th><th>Empirical</th><th>Theoretical</th>
                                    <th>Payout</th><th>EV %</th><th>Confidence</th><th>Sample</th><th>Chi² p</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.opportunities.map(o => (
                                    <tr key={`${o.symbol}-${o.direction}-${o.barrier}`}>
                                        <td>{o.displayName}</td>
                                        <td>{o.direction} {o.barrier}</td>
                                        <td>{pct(o.empiricalProb)}</td>
                                        <td>{pct(o.theoreticalProb)}</td>
                                        <td>{o.payoutRatio.toFixed(3)}×</td>
                                        <td className={o.expectedValuePct > 0 ? 'pos' : 'neg'}>{pct(o.expectedValuePct)}</td>
                                        <td>{pct(o.confidence)}</td>
                                        <td>{o.sampleSize}</td>
                                        <td>{o.digitStats.pValue.toFixed(3)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className='ou-bot__section'>
                <h3>Trade history</h3>
                {state.trades.length === 0 ? (
                    <p className='ou-bot__empty-row'>No trades yet.</p>
                ) : (
                    <div className='ou-bot__table-wrap'>
                        <table className='ou-bot__table'>
                            <thead>
                                <tr>
                                    <th>Market</th><th>Contract</th><th>Barrier</th><th>Stake</th><th>Payout</th>
                                    <th>EV</th><th>Conf</th><th>Stage</th><th>Result</th><th>P/L</th><th>Data</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.trades.slice(0, 50).map(t => (
                                    <tr key={t.id}>
                                        <td>{t.displayName}</td>
                                        <td>{t.direction}</td>
                                        <td>{t.barrier}</td>
                                        <td>{money(t.stake)}</td>
                                        <td>{t.payoutRatio.toFixed(2)}×</td>
                                        <td>{t.expectedValue.toFixed(3)}</td>
                                        <td>{pct(t.confidence)}</td>
                                        <td><span className={`ou-bot__stage ou-bot__stage--${t.stage}`}>{STAGE_LABEL[t.stage] || t.stage}</span></td>
                                        <td className={t.result === 'win' ? 'pos' : t.result === 'loss' ? 'neg' : ''}>{t.result || '—'}</td>
                                        <td className={(t.profit ?? 0) >= 0 ? 'pos' : 'neg'}>{t.profit !== undefined ? money(t.profit) : '—'}</td>
                                        <td>{t.simulated ? 'simulated' : 'live'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className='ou-bot__section'>
                <h3>Market analysis ({markets.length} markets)</h3>
                <div className='ou-bot__table-wrap'>
                    <table className='ou-bot__table'>
                        <thead>
                            <tr>
                                <th>Market</th><th>Category</th><th>Quote</th><th>Digits</th><th>Chi² p</th>
                                <th>Uniform?</th><th>RSI</th><th>Trend</th><th>Vol</th><th>State</th>
                            </tr>
                        </thead>
                        <tbody>
                            {markets.map(m => (
                                <tr key={m.symbol.symbol}>
                                    <td>{m.symbol.displayName}</td>
                                    <td>{m.symbol.category}</td>
                                    <td>{m.quote || '—'}</td>
                                    <td>{m.stats.sampleSize}</td>
                                    <td>{m.stats.pValue.toFixed(3)}</td>
                                    <td>{m.stats.isUniform ? 'yes' : <strong className='neg'>skewed</strong>}</td>
                                    <td>{m.momentum.rsi.toFixed(0)}</td>
                                    <td>{m.momentum.trend}</td>
                                    <td>{m.volatility.expansion ? 'expanding' : m.volatility.contraction ? 'contracting' : 'stable'}</td>
                                    <td>{m.stale ? 'stale' : 'live'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
});

const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: 'pos' | 'neg' }) => (
    <div className='ou-bot__stat'>
        <span className='ou-bot__stat-label'>{label}</span>
        <span className={`ou-bot__stat-value ${tone || ''}`}>{value}</span>
    </div>
);

const Field = ({
    label,
    value,
    onChange,
    step,
}: {
    label: string;
    value: string | number;
    onChange: (v: string) => void;
    step?: number;
}) => (
    <label className='ou-bot__field'>
        <span>{label}</span>
        <input type='text' value={value} step={step} onChange={e => onChange(e.target.value)} />
    </label>
);

export default OUBotPage;
