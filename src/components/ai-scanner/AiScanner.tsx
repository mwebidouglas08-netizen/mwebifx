import { useEffect, useState } from 'react';
import { PAIR_PROFILES, type PairProfileId } from '@/bot/core/algo-pro-ai';
import { algoProEngine, type AlgoProSettings } from '@/bot/engine/algo-pro-ai';
import { navigateToHubView } from '@/services/hub-navigation';
import './ai-scanner.scss';

const TICK_OPTIONS = [1, 2, 3, 5, 10];

const num = (v: string, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** 01 Entry Scanner + 02 Pro AI — the reference floating AI icon's modal. */
const AiScannerModal = ({ onClose }: { onClose: () => void }) => {
    const initial = algoProEngine.getState().settings;
    const [profileId, setProfileId] = useState<PairProfileId>(initial.profileId);
    const [ticks, setTicks] = useState(initial.ticks);
    const [stake, setStake] = useState(String(initial.stake));
    const [martingale, setMartingale] = useState(String(initial.martingale));
    const [takeProfit, setTakeProfit] = useState(String(initial.takeProfit));
    const [stopLoss, setStopLoss] = useState(String(initial.stopLoss));
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const profile = PAIR_PROFILES.find(p => p.id === profileId) ?? PAIR_PROFILES[0];

    const scan = async (settings: Partial<AlgoProSettings>) => {
        setBusy(true);
        try {
            if (algoProEngine.getState().running) algoProEngine.stop();
            await algoProEngine.start(settings);
            navigateToHubView('algo-pro-ai');
            onClose();
        } finally {
            setBusy(false);
        }
    };

    const scanMarkets = () =>
        void scan({
            usePairScanner: true,
            profileId,
            ticks,
        });

    const loadScannerBot = () => {
        navigateToHubView('algo-pro-ai');
        onClose();
    };

    const scanAndStart = () =>
        void scan({
            usePairScanner: true,
            profileId,
            ticks,
            stake: num(stake, initial.stake),
            martingale: num(martingale, initial.martingale),
            takeProfit: num(takeProfit, initial.takeProfit),
            stopLoss: num(stopLoss, initial.stopLoss),
        });

    return (
        <div className='ai-scan-modal__backdrop' onClick={e => e.target === e.currentTarget && onClose()}>
            <div className='ai-scan-modal' role='dialog' aria-modal='true' aria-label='AI Scanner'>
                <header className='ai-scan-modal__head'>
                    <span className='ai-scan-modal__pulse' aria-hidden='true' />
                    <div>
                        <h2>AI Scanner</h2>
                        <p>Multi-market digit scanner — pick a pair, scan, trade.</p>
                    </div>
                    <button type='button' className='ai-scan-modal__close' onClick={onClose} aria-label='Close'>
                        ×
                    </button>
                </header>

                <section className='ai-scan-modal__panel'>
                    <div className='ai-scan-modal__panel-head'>
                        <span className='ai-scan-modal__index'>01</span>
                        <div>
                            <h3>Entry Scanner</h3>
                            <p>RECOVERY ENGINE — {profile.label} Scanner</p>
                        </div>
                    </div>

                    <div className='ai-scan-modal__seg' role='tablist' aria-label='Digit pair profile'>
                        {PAIR_PROFILES.map(p => (
                            <button
                                key={p.id}
                                type='button'
                                role='tab'
                                aria-selected={p.id === profileId}
                                className={`ai-scan-modal__seg-btn ${p.id === profileId ? 'ai-scan-modal__seg-btn--on' : ''}`}
                                onClick={() => setProfileId(p.id)}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    <dl className='ai-scan-modal__meta'>
                        <div>
                            <dt>Scan depth</dt>
                            <dd>3000</dd>
                        </div>
                        <div>
                            <dt>Mode</dt>
                            <dd>Auto</dd>
                        </div>
                        <div>
                            <dt>Ticks</dt>
                            <dd>
                                <select value={ticks} onChange={e => setTicks(Number(e.target.value))} aria-label='Ticks'>
                                    {TICK_OPTIONS.map(t => (
                                        <option key={t} value={t}>
                                            {t}
                                        </option>
                                    ))}
                                </select>
                            </dd>
                        </div>
                        <div>
                            <dt>Selected market</dt>
                            <dd>All volatility</dd>
                        </div>
                        <div>
                            <dt>Trade type</dt>
                            <dd>
                                Over {profile.over} / Under {profile.under}
                            </dd>
                        </div>
                    </dl>

                    <div className='ai-scan-modal__actions'>
                        <button type='button' className='ai-scan-btn ai-scan-btn--primary' disabled={busy} onClick={scanMarkets}>
                            {busy ? 'Scanning…' : 'Scan Markets'}
                        </button>
                        <button type='button' className='ai-scan-btn' disabled={busy} onClick={loadScannerBot}>
                            Load Scanner Bot
                        </button>
                    </div>
                </section>

                <section className='ai-scan-modal__panel'>
                    <div className='ai-scan-modal__panel-head'>
                        <span className='ai-scan-modal__index'>02</span>
                        <div>
                            <h3>Pro AI</h3>
                            <p>Volatility &amp; Jump indices — Over {profile.over} / Under {profile.under}</p>
                        </div>
                    </div>

                    <div className='ai-scan-modal__settings'>
                        <label>
                            <span>Stake</span>
                            <input type='number' min='0.35' step='0.01' value={stake} onChange={e => setStake(e.target.value)} />
                        </label>
                        <label>
                            <span>Martingale</span>
                            <input type='number' min='1' step='0.1' value={martingale} onChange={e => setMartingale(e.target.value)} />
                        </label>
                        <label>
                            <span>Take Profit</span>
                            <input type='number' min='0' step='1' value={takeProfit} onChange={e => setTakeProfit(e.target.value)} />
                        </label>
                        <label>
                            <span>Stop Loss</span>
                            <input type='number' min='0' step='1' value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
                        </label>
                    </div>

                    <div className='ai-scan-modal__actions'>
                        <button type='button' className='ai-scan-btn ai-scan-btn--primary' disabled={busy} onClick={scanAndStart}>
                            {busy ? 'Starting…' : 'Scan & start'}
                        </button>
                    </div>
                </section>

                <footer className='ai-scan-modal__foot'>
                    Starts in paper mode unless Live trading is armed on the Algo Pro AI page. Nothing here predicts
                    the market — trade responsibly.
                </footer>
            </div>
        </div>
    );
};

/** Floating pulsing scanner button (bottom-right) + its modal. */
const AiScanner = () => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type='button' className='ai-scanner-fab' onClick={() => setOpen(true)} aria-haspopup='dialog'>
                <span className='ai-scanner-fab__icon' aria-hidden='true'>
                    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.9' strokeLinecap='round'>
                        <circle cx='12' cy='12' r='8.5' />
                        <circle cx='12' cy='12' r='3.6' />
                        <path d='M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3' />
                    </svg>
                </span>
                <span className='ai-scanner-fab__text'>
                    <strong>AI Scanner</strong>
                    <small>Click to analyze</small>
                </span>
                <span className='ai-scanner-fab__ring' aria-hidden='true' />
            </button>
            {open && <AiScannerModal onClose={() => setOpen(false)} />}
        </>
    );
};

export default AiScanner;
