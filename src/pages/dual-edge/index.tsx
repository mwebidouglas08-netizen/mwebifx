import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { fetchHistoricalTicks } from '@/bot/deriv/history';
import { TickFeed } from '@/bot/deriv/ticks';
import { currentLoginId, isAuthorized, refreshBalance } from '@/bot/deriv/api';
import { executeBuyFresh, monitorUntilSettled, requestContractQuote, settlementTimeoutMs } from '@/bot/deriv/execution';
import { winsFor } from '@/bot/core/digit-stats';
import {
    DEFAULT_DUAL_CONFIG,
    DUAL_PROFILES,
    applySideResult,
    dualStopReason,
    dualTotals,
    getDualProfile,
    initialSideState,
    nextStakePreview,
    type DualConfig,
    type DualMode,
    type DualProfile,
    type DualSideState,
} from '@/bot/core/dual-edge';
import type { EventType, TickPoint } from '@/bot/core/types';
import type { SignalAction } from '@/bot/core/signal-types';
import { voiceService } from '@/services/voice-service';
import { soundService } from '@/services/sound-service';
import { HubNote, HubPage, HubPageHeader } from '@/components/hub-page';
import './dual-edge.scss';

const SYMBOLS = [
    { symbol: 'R_10', name: 'Volatility 10' },
    { symbol: 'R_25', name: 'Volatility 25' },
    { symbol: 'R_50', name: 'Volatility 50' },
    { symbol: 'R_75', name: 'Volatility 75' },
    { symbol: 'R_100', name: 'Volatility 100' },
    { symbol: '1HZ10V', name: 'Volatility 10 (1s)' },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s)' },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s)' },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s)' },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s)' },
];

type DualStatus = 'idle' | 'warming' | 'running' | 'stopped' | 'error';

/** Minimum spacing between rounds — protects the proposal budget on 1s markets. */
const ROUNDS_MIN_INTERVAL_MS = 1200;

interface LogEvent {
    id: string;
    at: number;
    type: EventType;
    message: string;
}

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

const STATUS_TONE: Record<DualStatus, string> = {
    idle: 'hub-badge--idle',
    warming: 'hub-badge--running',
    running: 'hub-badge--running',
    stopped: 'hub-badge--idle',
    error: 'hub-badge--error',
};

const timeAt = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const MODE_HINT: Record<DualMode, string> = {
    RECOVERY:
        'After a loss the side switches to its recovery barrier (over→4 / under→5) and multiplies the stake by the factor, capped by the stake cap and max recovery steps. A win resets the side.',
    MKULIMA:
        "Barrier never changes — the stake follows a d'Alembert ladder: +step per loss, −step per win, floored at the base stake and capped.",
};

const initialSides = (profile: DualProfile, config: DualConfig): DualSideState[] => [
    initialSideState('over', profile, config),
    initialSideState('under', profile, config),
];

const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: 'pos' | 'neg' }) => (
    <div className='hub-stat'>
        <span>{label}</span>
        <strong className={tone ? `hub-${tone}` : ''}>{value}</strong>
    </div>
);

const Field = ({
    label,
    value,
    onChange,
    step,
    disabled,
}: {
    label: string;
    value: string | number;
    onChange: (v: string) => void;
    step?: number;
    disabled?: boolean;
}) => (
    <label className='hub-field'>
        <span>{label}</span>
        <input
            type='text'
            inputMode='decimal'
            value={value}
            step={step}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
        />
    </label>
);

const SideCard = ({ state, config }: { state: DualSideState; config: DualConfig }) => (
    <article className='hub-panel hub-lift dual-edge__side'>
        <header className='dual-edge__side-head'>
            <h4>{state.side === 'over' ? 'Over side' : 'Under side'}</h4>
            <span className='hub-badge hub-badge--info'>
                {state.side === 'over' ? 'DIGITOVER' : 'DIGITUNDER'} {state.barrier}
            </span>
        </header>
        <div className='hub-stats dual-edge__side-grid'>
            <div className='hub-stat'>
                <span>Barrier</span>
                <strong>{state.barrier}</strong>
            </div>
            <div className='hub-stat'>
                <span>Stake</span>
                <strong>{state.stake.toFixed(2)}</strong>
            </div>
            <div className='hub-stat'>
                <span>Next stake</span>
                <strong>{nextStakePreview(state, config).toFixed(2)}</strong>
            </div>
            <div className='hub-stat'>
                <span>Step</span>
                <strong>{state.step}</strong>
            </div>
            <div className='hub-stat'>
                <span>Consec. losses</span>
                <strong className={state.consecutiveLosses > 0 ? 'hub-neg' : ''}>{state.consecutiveLosses}</strong>
            </div>
            <div className='hub-stat'>
                <span>Wins</span>
                <strong className='hub-pos'>{state.wins}</strong>
            </div>
            <div className='hub-stat'>
                <span>Losses</span>
                <strong className='hub-neg'>{state.losses}</strong>
            </div>
            <div className='hub-stat'>
                <span>Profit</span>
                <strong className={state.profit >= 0 ? 'hub-pos' : 'hub-neg'}>{state.profit.toFixed(2)}</strong>
            </div>
        </div>
        <div className='dual-edge__chips'>
            {state.history.length === 0 ? (
                <span className='dual-edge__chips-empty'>No results yet</span>
            ) : (
                state.history
                    .slice(-12)
                    .map((h, i) => (
                        <span
                            key={`${i}-${h.barrier}`}
                            className={`dual-edge__chip ${h.won ? 'dual-edge__chip--win' : 'dual-edge__chip--loss'}`}
                            title={`${h.won ? 'Win' : 'Loss'} — barrier ${h.barrier}, stake ${h.stake.toFixed(2)}`}
                        >
                            {h.won ? 'W' : 'L'} {h.barrier}
                        </span>
                    ))
            )}
        </div>
    </article>
);

const DualEdgePage = observer(() => {
    const { client, run_panel } = useStore() ?? {};

    const [profileId, setProfileId] = useState(DUAL_PROFILES[0].id);
    const [mode, setMode] = useState<DualMode>(DEFAULT_DUAL_CONFIG.mode);
    const [baseStake, setBaseStake] = useState(String(DEFAULT_DUAL_CONFIG.baseStake));
    const [stakeCap, setStakeCap] = useState(String(DEFAULT_DUAL_CONFIG.stakeCap));
    const [stakeFactor, setStakeFactor] = useState(String(DEFAULT_DUAL_CONFIG.stakeFactor));
    const [stakeStep, setStakeStep] = useState(String(DEFAULT_DUAL_CONFIG.stakeStep));
    const [maxRecoverySteps, setMaxRecoverySteps] = useState(String(DEFAULT_DUAL_CONFIG.maxRecoverySteps));
    const [takeProfit, setTakeProfit] = useState(String(DEFAULT_DUAL_CONFIG.takeProfit));
    const [stopLoss, setStopLoss] = useState(String(DEFAULT_DUAL_CONFIG.stopLoss));
    const [symbol, setSymbol] = useState('R_50');
    const [allowLive, setAllowLive] = useState(false);

    const [status, setStatusState] = useState<DualStatus>('idle');
    const [message, setMessage] = useState('Idle — pick a profile and press Start.');
    const [liveArmed, setLiveArmed] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [stopReason, setStopReason] = useState<string | null>(null);
    const [events, setEvents] = useState<LogEvent[]>([]);
    const [sides, setSides] = useState<DualSideState[]>(() =>
        initialSides(getDualProfile(DUAL_PROFILES[0].id), DEFAULT_DUAL_CONFIG)
    );

    const feedRef = useRef<TickFeed | null>(null);
    const runningRef = useRef(false);
    const busyRef = useRef(false);
    const ticksRef = useRef(0);
    const eventSeqRef = useRef(0);
    const pipSizeRef = useRef(2);
    const liveRef = useRef(false);
    const lastRoundAtRef = useRef(0);
    const liveLoginRef = useRef('');
    const allowLiveRef = useRef(allowLive);
    allowLiveRef.current = allowLive;
    const symbolRef = useRef('R_50');
    const profileRef = useRef<DualProfile | null>(null);
    const configRef = useRef<DualConfig | null>(null);
    const sidesRef = useRef<DualSideState[]>(sides);

    const isLoggedIn = Boolean(client?.is_logged_in);
    const activeLoginid = client?.loginid || '';
    const isDemo = isDemoAccount(activeLoginid);
    const isRunning = status === 'warming' || status === 'running';

    const formConfig: DualConfig = {
        mode,
        baseStake: Number(baseStake) || DEFAULT_DUAL_CONFIG.baseStake,
        stakeCap: Number(stakeCap) || DEFAULT_DUAL_CONFIG.stakeCap,
        stakeFactor: Number(stakeFactor) || DEFAULT_DUAL_CONFIG.stakeFactor,
        stakeStep: Number(stakeStep) || DEFAULT_DUAL_CONFIG.stakeStep,
        maxRecoverySteps: Number(maxRecoverySteps) || DEFAULT_DUAL_CONFIG.maxRecoverySteps,
        takeProfit: Number(takeProfit) || 0,
        stopLoss: Number(stopLoss) || 0,
    };

    const totals = dualTotals(sides);
    const profile = getDualProfile(profileId);
    const worstStake =
        mode === 'RECOVERY'
            ? Math.min(
                  formConfig.baseStake * Math.pow(formConfig.stakeFactor, formConfig.maxRecoverySteps),
                  formConfig.stakeCap
              )
            : Math.min(
                  formConfig.baseStake + formConfig.stakeStep * formConfig.maxRecoverySteps,
                  formConfig.stakeCap
              );

    const applyStatus = (next: DualStatus, text: string) => {
        setStatusState(next);
        setMessage(text);
    };

    const log = (type: EventType, text: string) => {
        eventSeqRef.current += 1;
        const event: LogEvent = { id: `d${eventSeqRef.current}-${Date.now()}`, at: Date.now(), type, message: text };
        setEvents(prev => [event, ...prev].slice(0, 200));
    };

    const commit = (next: DualSideState[]) => {
        sidesRef.current = next;
        setSides(next);
    };

    const stopEngine = (text: string, reason: string | null) => {
        const wasRunning = runningRef.current;
        runningRef.current = false;
        busyRef.current = false;
        if (wasRunning) soundService.play('botStop');
        const feed = feedRef.current;
        feedRef.current = null;
        feed?.stop();
        if (reason) setStopReason(reason);
        applyStatus('stopped', text);
    };

    // Commit a round, then run the global stop check (take profit / stop loss /
    // recovery-ladder exhaustion) — a hit halts the engine immediately.
    const commitAndCheck = (next: DualSideState[]): boolean => {
        commit(next);
        const config = configRef.current;
        if (!config) return false;
        const reason = dualStopReason(next, config);
        if (reason) {
            log('risk', `Auto-stop: ${reason}`);
            stopEngine(reason, reason);
            return true;
        }
        return false;
    };

    // The Start-time liveOK snapshot goes stale: the session can be dropped or
    // switched mid-run. Re-evaluate the gate every round — a lost session pauses
    // live orders (paper continues) and a re-authorized session resumes them.
    const liveGate = (): boolean => {
        const authorized = isAuthorized();
        const loginid = authorized ? currentLoginId() : '';
        const demo = authorized ? isDemoAccount(loginid) : false;
        if (!allowLiveRef.current || !authorized) {
            if (liveRef.current) {
                liveRef.current = false;
                setLiveArmed(false);
                setNotice(
                    'Live orders paused — the Deriv session is no longer authorized. Paper mode continues; live resumes automatically once the session is authorized again.'
                );
                log('risk', 'Live gate: session no longer authorized — live orders paused; continuing in paper mode.');
            }
            return false;
        }
        if (!liveRef.current) {
            liveRef.current = true;
            setLiveArmed(true);
            setNotice(null);
            log('status', `Live gate: orders resumed on ${demo ? 'DEMO' : 'REAL'} account (${loginid}).`);
        } else if (loginid && loginid !== liveLoginRef.current) {
            log('status', `Live gate: active account is now ${demo ? 'DEMO' : 'REAL'} (${loginid}).`);
        }
        liveLoginRef.current = loginid;
        return true;
    };

    const runLiveRound = async (activeProfile: DualProfile, config: DualConfig): Promise<void> => {
        const activeSymbol = symbolRef.current;
        // Enter both sides back-to-back on this round's signal, THEN resolve
        // them. Serialising (buy Over → wait for settlement → buy Under) pushed
        // the second entry a full tick late and doubled every round's duration;
        // paper mode has always settled both sides on the same tick digit.
        const opened: {
            side: 'over' | 'under';
            contractId: number;
            stake: number;
            barrier: number;
            askPrice: number;
            payout: number;
        }[] = [];
        for (const side of ['over', 'under'] as const) {
            if (!runningRef.current) break;
            const state = sidesRef.current.find(s => s.side === side);
            if (!state) continue;
            const action: SignalAction = side === 'over' ? 'OVER' : 'UNDER';
            const req = {
                symbol: activeSymbol,
                family: 'over_under' as const,
                action,
                barrier: state.barrier,
                amount: state.stake,
                duration: 1,
                durationUnit: 't',
            };
            log('quote', `Quote: ${side} ${state.barrier} @ ${state.stake.toFixed(2)} on ${activeSymbol}`);
            const { quote, error } = await requestContractQuote(req);
            if (!quote) {
                log('error', `Quote failed (${side} ${state.barrier}): ${error || 'no quote returned'}`);
                continue;
            }
            const buy = await executeBuyFresh(quote, state.stake, () => requestContractQuote(req));
            if (buy.error || buy.contractId === undefined) {
                log('error', `Order rejected (${side} ${state.barrier}): ${buy.error || 'no contract id'}`);
                continue;
            }
            log(
                'purchase',
                `Contract #${buy.contractId}: ${side} ${state.barrier} — stake ${(buy.buyPrice ?? state.stake).toFixed(2)}`
            );
            opened.push({
                side,
                contractId: buy.contractId,
                stake: state.stake,
                barrier: state.barrier,
                askPrice: quote.askPrice,
                payout: quote.payout,
            });
        }
        for (const rec of opened) {
            const settlement = await monitorUntilSettled(
                rec.contractId,
                pipSizeRef.current,
                undefined,
                settlementTimeoutMs(1, 't')
            );
            if ('error' in settlement) {
                // Outcome unknown — the recovery ladder must not advance on a
                // result the market never delivered, so pause honestly.
                log('error', `Settlement unknown for #${rec.contractId}: ${settlement.error} — outcome not recorded`);
                stopEngine(
                    'Settlement unknown',
                    `Contract #${rec.contractId} outcome unknown — paused so the recovery ladder stays honest. Check your open contracts, then restart.`
                );
                return;
            }
            const won = settlement.isWon;
            log(
                'settlement',
                `${won ? 'WIN' : 'LOSS'}: #${rec.contractId} ${rec.side} ${rec.barrier} — exit digit ${
                    settlement.exitDigit ?? '—'
                }, ${settlement.profit >= 0 ? '+' : ''}${settlement.profit.toFixed(2)}`
            );
            void refreshBalance?.();
            voiceService.announceSettlement({
                bot: 'Dual Edge',
                won,
                profit: settlement.profit,
                market: activeSymbol,
            });
            const next = sidesRef.current.map(s =>
                s.side === rec.side
                    ? applySideResult(s, activeProfile, config, {
                          won,
                          profit: settlement.profit,
                          payoutRatio: rec.askPrice > 0 ? rec.payout / rec.askPrice : undefined,
                      })
                    : s
            );
            // Commit each side's ladder result as it lands; the stop check
            // (TP/SL/ladder exhaustion) runs once the whole round has resolved
            // so an already-opened contract is never left unmonitored.
            commit(next);
        }
        if (opened.length) commitAndCheck(sidesRef.current);
    };

    // Paper: settle both sides on the tick digit. No payoutRatio is passed, so
    // wins credit nothing — the counter tracks stake flow, not profit.
    const runPaperRound = (digit: number, activeProfile: DualProfile, config: DualConfig): void => {
        const next = sidesRef.current.map(s => {
            const won = winsFor(s.side, s.barrier, digit);
            log(
                'settlement',
                `Paper ${s.side} ${s.barrier} @ ${s.stake.toFixed(2)} — ${won ? 'WIN' : 'LOSS'} (tick digit ${digit})`
            );
            return applySideResult(s, activeProfile, config, { won });
        });
        commitAndCheck(next);
    };

    const runRound = async (digit: number) => {
        const activeProfile = profileRef.current;
        const config = configRef.current;
        if (!activeProfile || !config) return;
        // The live gate is re-evaluated every round — a dropped session pauses
        // live orders (paper continues) instead of trusting the Start snapshot.
        if (liveGate()) await runLiveRound(activeProfile, config);
        else runPaperRound(digit, activeProfile, config);
    };

    const handleTick = (_symbol: string, point: TickPoint) => {
        if (!runningRef.current) return;
        ticksRef.current += 1;
        const activeProfile = profileRef.current;
        if (!activeProfile) return;
        if (ticksRef.current <= activeProfile.lookback) {
            applyStatus(
                'warming',
                `Warming — ${ticksRef.current}/${activeProfile.lookback} ticks before the first entry…`
            );
            return;
        }
        if (busyRef.current) return;
        // Minimum cadence between rounds — skip eligible ticks that arrive too
        // soon so the proposal budget is not drained on 1s markets.
        if (Date.now() - lastRoundAtRef.current < ROUNDS_MIN_INTERVAL_MS) return;
        lastRoundAtRef.current = Date.now();
        busyRef.current = true;
        runRound(point.digit).finally(() => {
            busyRef.current = false;
        });
    };

    const onStart = async () => {
        if (runningRef.current) return;
        const activeProfile = getDualProfile(profileId);
        const config: DualConfig = { ...formConfig };
        const wantsLive = allowLive;
        const liveOK = wantsLive && isLoggedIn && isAuthorized();

        setNotice(null);
        profileRef.current = activeProfile;
        configRef.current = config;
        liveRef.current = liveOK;
        liveLoginRef.current = liveOK ? currentLoginId() : '';
        lastRoundAtRef.current = 0;
        symbolRef.current = symbol;
        pipSizeRef.current = 2;
        commit(initialSides(activeProfile, config));
        setStopReason(null);
        setLiveArmed(liveOK);
        ticksRef.current = 0;
        busyRef.current = false;
        runningRef.current = true;
        soundService.play('botStart');
        applyStatus('warming', `Connecting to ${symbol}…`);
        log(
            'status',
            `Engine starting — ${activeProfile.label} · ${config.mode} · ${
                liveOK ? 'LIVE orders' : 'paper (no orders)'
            } on ${symbol}`
        );
        if (wantsLive && !liveOK) {
            log('risk', 'Live mode unavailable (needs a logged-in account) — falling back to paper.');
        }

        try {
            const history = await fetchHistoricalTicks(symbol, Math.max(20, activeProfile.lookback + 10));
            pipSizeRef.current = history.pipSize;
        } catch (e) {
            log(
                'error',
                `History warm-up failed: ${e instanceof Error ? e.message : 'unknown error'} — relying on live ticks.`
            );
        }
        if (!runningRef.current) return;

        const feed = new TickFeed({
            onTick: handleTick,
            onStatus: (connected, error) => {
                if (!connected && runningRef.current) {
                    log('status', `Market data reconnecting…${error ? ` ${error}` : ''}`);
                }
            },
        });
        feedRef.current = feed;
        feed.setSymbols([symbol]);
        feed.start();
        applyStatus(
            'running',
            liveRef.current
                ? 'Live — a pair of contracts per eligible tick'
                : 'Paper — settling both sides on each tick (no real orders)'
        );
        log('status', `Subscribed to ${symbol} — first entry after ${activeProfile.lookback} warm-up tick(s).`);
    };

    const onStop = () => {
        if (!runningRef.current) return;
        stopEngine('Stopped', null);
        log('status', 'Engine stopped.');
    };

    const onEmergency = () => {
        const wasRunning = runningRef.current;
        stopEngine('Emergency stop engaged', null);
        log(
            'risk',
            wasRunning
                ? 'Emergency stop engaged — feed closed and all activity halted.'
                : 'Emergency stop engaged (engine was idle).'
        );
    };

    const onToggleLive = (checked: boolean) => {
        if (!checked) {
            setAllowLive(false);
            return;
        }
        if (!isLoggedIn) {
            run_panel?.showLoginDialog?.();
            return;
        }
        const ok = isDemo
            ? window.confirm(
                  'Enable LIVE demo orders? Every round places real demo-money contracts on BOTH sides and monitors them to settlement.'
              )
            : window.confirm(
                  'Enable LIVE orders on a REAL-money account? Every round places two real-money contracts on BOTH sides and monitors them to settlement — both sides spend funds. Continue?'
              );
        if (!ok) return;
        setAllowLive(true);
    };

    useEffect(
        () => () => {
            runningRef.current = false;
            const feed = feedRef.current;
            feedRef.current = null;
            feed?.stop();
        },
        []
    );

    return (
        <HubPage className='dual-edge'>
            {!isLoggedIn && (
                <HubNote tone='info'>
                    Not logged in — Dual Edge runs in paper mode on Deriv&apos;s public ticks. Log in to
                    arm live orders (demo or real).{' '}
                    <button
                        type='button'
                        className='hub-btn hub-btn--primary hub-btn--sm'
                        onClick={() => run_panel?.showLoginDialog?.()}
                    >
                        Log in to arm live orders
                    </button>
                </HubNote>
            )}

            <HubPageHeader
                title='Dual Edge'
                subtitle="Runs both sides of a complementary barrier pair (e.g. Over 1 / Under 8) through a documented stake progression — RECOVERY barrier switching or MKULIMA d'Alembert ladder — with hard stop gates."
                badge={
                    <>
                        <span className={`hub-badge ${STATUS_TONE[status]}`}>{status}</span>
                        <span
                            className={[
                                'hub-badge',
                                !isLoggedIn ? 'hub-badge--guest' : isDemo ? 'hub-badge--demo' : 'hub-badge--real',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                        >
                            {!isLoggedIn ? 'Guest · analysis only' : `${isDemo ? 'Demo' : 'Real'} · ${activeLoginid}`}
                        </span>
                    </>
                }
            />

            <HubNote tone='risk'>
                <strong>Recovery risk:</strong> recovery / martingale-style progressions lose heavily during losing
                streaks — stakes grow while losses accumulate, and the worst-case stake here is{' '}
                <strong>{worstStake.toFixed(2)}</strong> (capped at {formConfig.stakeCap.toFixed(2)}) after{' '}
                {formConfig.maxRecoverySteps} recovery step(s). A side that burns through{' '}
                {formConfig.maxRecoverySteps + 1} consecutive losses auto-stops (cap exhaustion). Paper mode models
                stake flow only — no P/L.
            </HubNote>

            {notice && <div className='dual-edge__warn' role='status'>{notice}</div>}

            <section className='dual-edge__controls'>
                <label className='hub-field'>
                    <span>Profile</span>
                    <select value={profileId} onChange={e => setProfileId(e.target.value)} disabled={isRunning}>
                        {DUAL_PROFILES.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='hub-field'>
                    <span>Symbol</span>
                    <select value={symbol} onChange={e => setSymbol(e.target.value)} disabled={isRunning}>
                        {SYMBOLS.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                </label>
                <div className='dual-edge__mode'>
                    <span className='dual-edge__mode-label'>Mode</span>
                    <div className='hub-seg'>
                        <button
                            type='button'
                            className={`hub-seg__btn ${mode === 'RECOVERY' ? 'hub-seg__btn--on' : ''}`}
                            onClick={() => setMode('RECOVERY')}
                        >
                            RECOVERY
                        </button>
                        <button
                            type='button'
                            className={`hub-seg__btn ${mode === 'MKULIMA' ? 'hub-seg__btn--on' : ''}`}
                            onClick={() => setMode('MKULIMA')}
                        >
                            MKULIMA
                        </button>
                    </div>
                    <span className='dual-edge__mode-hint'>{MODE_HINT[mode]}</span>
                </div>
            </section>

            <div className='dual-edge__grid dual-edge__grid--config'>
                <Field label='Base stake' value={baseStake} onChange={setBaseStake} disabled={isRunning} />
                <Field label='Stake cap' value={stakeCap} onChange={setStakeCap} disabled={isRunning} />
                {mode === 'RECOVERY' ? (
                    <Field label='Stake factor (×)' value={stakeFactor} onChange={setStakeFactor} disabled={isRunning} />
                ) : (
                    <Field label='Stake step' value={stakeStep} onChange={setStakeStep} disabled={isRunning} />
                )}
                <Field
                    label='Max recovery steps'
                    value={maxRecoverySteps}
                    onChange={setMaxRecoverySteps}
                    disabled={isRunning}
                />
                <Field label='Take profit' value={takeProfit} onChange={setTakeProfit} disabled={isRunning} />
                <Field label='Stop loss' value={stopLoss} onChange={setStopLoss} disabled={isRunning} />
            </div>

            <section className='dual-edge__controls dual-edge__controls--actions'>
                <div className='hub-actions'>
                    <button
                        type='button'
                        className='hub-btn hub-btn--primary'
                        disabled={isRunning}
                        onClick={onStart}
                    >
                        Start engine
                    </button>
                    <button type='button' className='hub-btn hub-btn--danger' disabled={!isRunning} onClick={onStop}>
                        Stop
                    </button>
                    <button type='button' className='hub-btn hub-btn--danger' onClick={onEmergency}>
                        Emergency stop
                    </button>
                </div>
                <label
                    className='dual-edge__toggle'
                    onClick={e => {
                        if (!isLoggedIn) {
                            e.preventDefault();
                            run_panel?.showLoginDialog?.();
                        }
                    }}
                >
                    <input
                        type='checkbox'
                        disabled={!isLoggedIn || isRunning}
                        checked={allowLive && isLoggedIn}
                        onChange={e => onToggleLive(e.target.checked)}
                    />
                    <span>
                        Live orders {!isLoggedIn ? '(log in first)' : isDemo ? (allowLive ? '(armed — demo)' : '(off — paper)') : allowLive ? '(armed — REAL funds)' : '(off — paper)'}
                    </span>
                </label>
                <span className='dual-edge__hint'>
                    {isRunning ? 'Settings are locked while running — apply them on the next start.' : 'Settings apply when you press Start.'}
                </span>
            </section>

            <p className='dual-edge__msg' aria-live='polite'>{message}</p>

            {stopReason && (
                <div className='dual-edge__banner' role='alert'>
                    <strong>Stopped:</strong> {stopReason}
                </div>
            )}

            <div className='hub-stats'>
                <Stat
                    label={liveArmed ? 'Net P/L' : 'Stake flow (paper)'}
                    value={totals.profit.toFixed(2)}
                    tone={totals.profit >= 0 ? 'pos' : 'neg'}
                />
                <Stat label='Wins' value={totals.wins} tone='pos' />
                <Stat label='Losses' value={totals.losses} tone='neg' />
                <Stat label='Max consec. losses' value={totals.maxConsecutiveLosses} />
                <Stat label='Rounds' value={sides[0]?.history.length ?? 0} />
            </div>

            <HubNote tone='info'>
                {liveArmed
                    ? 'Live run: profit is the server\u2019s settlement P/L (actual fill — includes any price-move retry).'
                    : 'stake flow — no P/L modelled in paper: wins credit nothing without a real payout, losses deduct the stake from the flow counter.'}
            </HubNote>

            <section className='dual-edge__sides'>
                {sides.map(s => (
                    <SideCard key={s.side} state={s} config={formConfig} />
                ))}
            </section>

            <section className='hub-section dual-edge__activity' aria-live='polite'>
                <h3>
                    Event log <em>({events.length} events)</em>
                </h3>
                {events.length === 0 ? (
                    <p className='hub-empty'>No activity yet — start the engine to see ticks, quotes and settlements.</p>
                ) : (
                    <div className='hub-log'>
                        {events.map(ev => (
                            <div key={ev.id} className='hub-log__row' data-tone={EVENT_TONE[ev.type]}>
                                <span className='hub-log__time'>{timeAt(ev.at)}</span>
                                <span className='hub-log__type'>{EVENT_LABEL[ev.type]}</span>
                                <span className='hub-log__msg'>{ev.message}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </HubPage>
    );
});

export default DualEdgePage;
