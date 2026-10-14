import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { useCopyTrading } from '@/bot/use-engine';
import { copyTrading } from '@/bot/engine/copy-trading';
import './copy-trading.scss';

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

const money = (n: number) => n.toFixed(2);

const CopyTradingPage = observer(() => {
    const state = useCopyTrading();
    const { client, run_panel } = useStore() ?? {};

    const [masterToken, setMasterToken] = useState('');
    const [copierToken, setCopierToken] = useState('');
    const [copierLabel, setCopierLabel] = useState('');
    const [multiplierDraft, setMultiplierDraft] = useState(() => String(state.settings.stakeMultiplier));
    const [capDraft, setCapDraft] = useState(() =>
        state.settings.stakeCap === null ? '' : String(state.settings.stakeCap)
    );
    const feedRef = useRef<HTMLDivElement | null>(null);

    const isLoggedIn = Boolean(client?.is_logged_in);
    const activeLoginid = client?.loginid || '';
    const localIsDemo = isDemoAccount(activeLoginid);
    const isRunning = state.status === 'connecting' || state.status === 'running' || state.status === 'stopping';

    useEffect(() => {
        const el = feedRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [state.events.length]);

    const connect = () => {
        const token = masterToken.trim();
        if (!isLoggedIn) {
            run_panel?.showLoginDialog?.();
            return;
        }
        if (!token) return;
        // The token is handed to the engine once and cleared from the field —
        // it is never rendered back or stored anywhere in this page.
        copyTrading.start(token);
        setMasterToken('');
    };

    const stop = () => copyTrading.stop();

    const addCopier = () => {
        const token = copierToken.trim();
        if (!token) return;
        copyTrading.addCopier(token, copierLabel.trim() || `Copier ${state.copiers.length + 1}`);
        setCopierToken('');
        setCopierLabel('');
    };

    const removeCopier = (id: string, label: string) => {
        const ok = window.confirm(`Remove copier "${label}"? Its copied trades stop here immediately.`);
        if (!ok) return;
        copyTrading.removeCopier(id);
    };

    const commitMultiplier = (raw: string, commitOnType = false): number | null => {
        const value = Number(raw);
        if (raw.trim() === '' || !Number.isFinite(value)) return null;
        const clamped = Math.min(10, Math.max(0.1, value));
        // While typing, ignore values outside the allowed band so the field does
        // not jump mid-edit; blur applies the clamp.
        if (commitOnType && (value < 0.1 || value > 10)) return null;
        if (clamped !== state.settings.stakeMultiplier) copyTrading.setSettings({ stakeMultiplier: clamped });
        return clamped;
    };

    const commitCap = () => {
        const raw = capDraft.trim();
        if (raw === '') {
            if (state.settings.stakeCap !== null) copyTrading.setSettings({ stakeCap: null });
            return;
        }
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
            setCapDraft(state.settings.stakeCap === null ? '' : String(state.settings.stakeCap));
            return;
        }
        if (value !== state.settings.stakeCap) copyTrading.setSettings({ stakeCap: value });
    };

    const exampleMasterStake = 10;
    const exampleCopied = exampleMasterStake * state.settings.stakeMultiplier;

    return (
        <div className='copy-page'>
            <header className='copy-head'>
                <div>
                    <h2>Copy Trading</h2>
                    <p className='copy-sub'>
                        Mirror a master account&apos;s trades into one or more copier accounts with a stake
                        multiplier and cap. The engine watches the master and replays each proposal downstream.
                    </p>
                </div>
                <div className='copy-status'>
                    <span className={`copy-badge copy-badge--${state.status}`}>{state.status}</span>
                    <span className={`copy-acct ${localIsDemo ? 'copy-acct--demo' : ''}`}>
                        {!isLoggedIn ? 'Guest · signals only' : `${localIsDemo ? 'Demo' : 'Real'} · ${activeLoginid}`}
                    </span>
                </div>
            </header>

            <div className='copy-note' role='note'>
                Only demo (virtual) copier accounts are accepted by the engine — real-money copiers are rejected on
                purpose. The stake multiplier scales losses as well as wins: a master staking 10 USD at ×1.5
                becomes {money(exampleCopied)} per trade here, losing streaks included.
            </div>

            {!isLoggedIn && (
                <div className='copy-notice copy-notice--login' role='note'>
                    You can configure copiers and settings while logged out, but connecting a master requires a
                    session.{' '}
                    <button type='button' className='copy-btn' onClick={() => run_panel?.showLoginDialog?.()}>
                        Log in to connect
                    </button>
                </div>
            )}

            <section className='copy-section'>
                <h3>Master account</h3>
                <div className='copy-master'>
                    <label className='copy-field'>
                        <span>Master API token</span>
                        <input
                            type='password'
                            autoComplete='off'
                            placeholder='Paste the master token (never shown again)'
                            value={masterToken}
                            onChange={e => setMasterToken(e.target.value)}
                        />
                    </label>
                    <button
                        type='button'
                        className='copy-btn copy-btn--primary'
                        disabled={state.status === 'connecting' || state.status === 'stopping'}
                        onClick={connect}
                    >
                        {state.status === 'connecting' ? 'Connecting…' : state.master.connected ? 'Reconnect' : 'Connect & start'}
                    </button>
                    <button
                        type='button'
                        className='copy-btn'
                        disabled={!isRunning}
                        onClick={stop}
                    >
                        Stop
                    </button>
                </div>

                <div className='copy-master-state'>
                    <span className={`copy-dot ${state.master.connected ? 'copy-dot--on' : ''}`} aria-hidden />
                    {state.master.connected ? (
                        <>
                            <strong>{state.master.loginid || 'connected'}</strong>
                            <span className={`copy-pill ${state.master.isVirtual ? 'copy-pill--demo' : ''}`}>
                                {state.master.isVirtual ? 'Demo' : 'Real'}
                            </span>
                            <span className='copy-balance'>
                                {state.master.balance !== null ? `${money(state.master.balance)} balance` : 'balance —'}
                            </span>
                        </>
                    ) : (
                        <span className='copy-balance'>Not connected</span>
                    )}
                </div>
            </section>

            <section className='copy-section'>
                <h3>Copiers ({state.copiers.length})</h3>
                <div className='copy-add'>
                    <label className='copy-field'>
                        <span>Copier token</span>
                        <input
                            type='password'
                            autoComplete='off'
                            placeholder='Demo account token'
                            value={copierToken}
                            onChange={e => setCopierToken(e.target.value)}
                        />
                    </label>
                    <label className='copy-field'>
                        <span>Label</span>
                        <input
                            type='text'
                            placeholder='e.g. Demo A'
                            value={copierLabel}
                            onChange={e => setCopierLabel(e.target.value)}
                        />
                    </label>
                    <button
                        type='button'
                        className='copy-btn copy-btn--primary'
                        disabled={!copierToken.trim()}
                        onClick={addCopier}
                    >
                        Add copier
                    </button>
                </div>

                {state.copiers.length === 0 ? (
                    <p className='copy-empty'>No copiers yet — add a demo account token to start mirroring.</p>
                ) : (
                    <div className='copy-copiers'>
                        {state.copiers.map(copier => (
                            <article key={copier.id} className={`copy-card ${copier.enabled ? '' : 'copy-card--off'}`}>
                                <div className='copy-card__top'>
                                    <span className='copy-card__name'>{copier.label}</span>
                                    <span
                                        className={`copy-dot ${copier.authorized ? 'copy-dot--on' : ''}`}
                                        title={copier.authorized ? 'Authorized' : 'Not authorized'}
                                        aria-hidden
                                    />
                                    <label className='copy-switch'>
                                        <input
                                            type='checkbox'
                                            checked={copier.enabled}
                                            onChange={e => copyTrading.toggleCopier(copier.id, e.target.checked)}
                                        />
                                        <span>{copier.enabled ? 'On' : 'Off'}</span>
                                    </label>
                                    <button
                                        type='button'
                                        className='copy-btn copy-btn--danger'
                                        onClick={() => removeCopier(copier.id, copier.label)}
                                    >
                                        Remove
                                    </button>
                                </div>
                                <div className='copy-card__stats'>
                                    <span>
                                        <strong>{copier.copied}</strong> copied
                                    </span>
                                    <span>
                                        <strong>{copier.failed}</strong> failed
                                    </span>
                                    <span>
                                        <strong>{copier.skipped}</strong> skipped
                                    </span>
                                </div>
                                {copier.lastError && <p className='copy-card__error'>Last error: {copier.lastError}</p>}
                                <p className='copy-card__seen'>
                                    {copier.lastSeen
                                        ? `Last seen ${timeAt(copier.lastSeen)}`
                                        : 'No proposal seen yet'}
                                </p>
                            </article>
                        ))}
                    </div>
                )}
            </section>

            <section className='copy-section'>
                <h3>Replication settings</h3>
                <div className='copy-settings'>
                    <label className='copy-toggle'>
                        <input
                            type='checkbox'
                            checked={state.settings.replicationEnabled}
                            onChange={e => copyTrading.setSettings({ replicationEnabled: e.target.checked })}
                        />
                        <span>Replication enabled</span>
                    </label>
                    <label className='copy-field'>
                        <span>Stake multiplier (0.1 – 10)</span>
                        <input
                            type='number'
                            step={0.1}
                            min={0.1}
                            max={10}
                            value={multiplierDraft}
                            onChange={e => {
                                setMultiplierDraft(e.target.value);
                                commitMultiplier(e.target.value, true);
                            }}
                            onBlur={() => {
                                const committed = commitMultiplier(multiplierDraft);
                                if (committed !== null) setMultiplierDraft(String(committed));
                            }}
                        />
                    </label>
                    <label className='copy-field'>
                        <span>Stake cap (empty = no cap)</span>
                        <input
                            type='number'
                            step={0.5}
                            min={0}
                            placeholder='No cap'
                            value={capDraft}
                            onChange={e => setCapDraft(e.target.value)}
                            onBlur={commitCap}
                        />
                    </label>
                </div>
                <p className='copy-example'>
                    Example: master 10 USD × {state.settings.stakeMultiplier} ={' '}
                    <strong>{money(exampleCopied)} USD</strong> per copied trade
                    {state.settings.stakeCap !== null
                        ? `, capped at ${money(state.settings.stakeCap)} USD.`
                        : ' (no cap applied).'}{' '}
                    The same multiplier applies when the master loses.
                </p>
            </section>

            <p className='copy-msg' aria-live='polite'>
                {state.message}
            </p>

            <div className='copy-grid copy-grid--stats'>
                <div className='copy-stat'>
                    <span>Observed</span>
                    <strong>{state.stats.observed}</strong>
                </div>
                <div className='copy-stat'>
                    <span>Copied</span>
                    <strong>{state.stats.copied}</strong>
                </div>
                <div className='copy-stat'>
                    <span>Failed</span>
                    <strong className='neg'>{state.stats.failed}</strong>
                </div>
                <div className='copy-stat'>
                    <span>Skipped</span>
                    <strong>{state.stats.skipped}</strong>
                </div>
            </div>

            <section className='copy-section' aria-live='polite'>
                <h3>Events ({state.events.length})</h3>
                {state.events.length === 0 ? (
                    <p className='copy-empty'>
                        No events yet — connect a master account to watch proposals stream in.
                    </p>
                ) : (
                    <div className='copy-feed' ref={feedRef}>
                        {state.events.map(event => (
                            <div
                                key={event.id}
                                className={`copy-event copy-event--${EVENT_TONE[event.type] ?? 'info'}`}
                            >
                                <span className='copy-event-time'>{timeAt(event.at)}</span>
                                <span className='copy-event-type'>{EVENT_LABEL[event.type] ?? event.type}</span>
                                <span className='copy-event-msg'>{event.message}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <p className='copy-footnote'>
                Honest note: copying replicates the master&apos;s decisions, not their results — the master may be
                on a demo account, may change strategy at any time, and a multiplier raises the cost of every loss
                it mirrors. Start with a multiplier of 1 and a tight stake cap.
            </p>
        </div>
    );
});

export default CopyTradingPage;
