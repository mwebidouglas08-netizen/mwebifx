import { useEffect, useRef, useState } from 'react';
import './boot-splash.scss';

interface BootSplashProps {
    onDone?: () => void;
    minDurationMs?: number;
}

/** Status lines cycled under the card while steps complete. */
const STATUS = [
    'Initializing secure session…',
    'Connecting to trading server…',
    'Streaming live market data…',
    'Warming up the bot engine…',
    'Preparing your dashboard…',
];

/** Horizontal step pills (SmartFlip-class): done → check, active → number. */
const STEPS = ['Connect', 'Sync', 'Engine', 'Bots', 'Ready'];

/** Capability tiles shown inside the card. */
const TILES = [
    { label: 'AI Bots', icon: '🤖' },
    { label: 'Signals', icon: '🧠' },
    { label: 'Analysis', icon: '📊' },
    { label: 'Backtest', icon: '🧪' },
];

const BRAND = 'Mwebifx';
/** Typewriter cadence: type fast, hold, (loader hides before delete). */
const TYPE_MS = 70;

/**
 * Cinematic boot loader. Typed wordmark, ringed badge, staged progress pills,
 * capability tiles, live status line and a pulsing progress bar — the app
 * content stays mounted underneath and is revealed when this leaves.
 */
const BootSplash = ({ onDone, minDurationMs = 6000 }: BootSplashProps) => {
    const [typed, setTyped] = useState('');
    const [step, setStep] = useState(0);
    const [progress, setProgress] = useState(0);
    const [leaving, setLeaving] = useState(false);
    const doneRef = useRef(false);

    // Typewriter: types the brand letter by letter, then holds.
    useEffect(() => {
        let i = 0;
        const t = setInterval(() => {
            i += 1;
            setTyped(BRAND.slice(0, i));
            if (i >= BRAND.length) clearInterval(t);
        }, TYPE_MS);
        return () => clearInterval(t);
    }, []);

    // Progress + steps + status: advance every 1/5th of the duration, then leave.
    useEffect(() => {
        const duration = Math.max(2200, minDurationMs);
        const tickMs = Math.max(40, Math.floor(duration / 100));
        const stepMs = Math.max(200, Math.floor(duration / STEPS.length));
        const started = Date.now();
        const p = setInterval(() => {
            const pct = Math.min(100, Math.round(((Date.now() - started) / duration) * 100));
            setProgress(pct);
            if (pct >= 100) {
                clearInterval(p);
                if (!doneRef.current) {
                    doneRef.current = true;
                    setLeaving(true);
                    setTimeout(() => onDone?.(), 560);
                }
            }
        }, tickMs);
        const s = setInterval(() => {
            setStep(v => Math.min(STEPS.length - 1, v + 1));
        }, stepMs);
        return () => {
            clearInterval(p);
            clearInterval(s);
        };
    }, [minDurationMs, onDone]);

    const status = STATUS[Math.min(STATUS.length - 1, step)];

    return (
        <div className={`boot-splash sf-cinematic ${leaving ? 'sf-cinematic--leave' : ''}`} role='status' aria-label='Loading Mwebifx'>
            <div className='sf-cinematic__grid' aria-hidden='true' />
            <div className='sf-cinematic__glow' aria-hidden='true' />
            <div className='sf-cinematic__wrap'>
                <div className='sf-cinematic__card'>
                    <div className='sf-cinematic__badge' aria-hidden='true'>
                        <span className='sf-cinematic__badge-ring' />
                        <span className='sf-cinematic__badge-ring sf-cinematic__badge-ring--2' />
                        <span className='sf-cinematic__badge-mono'>M</span>
                    </div>
                    <div className='sf-cinematic__brand'>
                        <span className='sf-cinematic__brand-title' aria-label={BRAND}>
                            <span className='sf-cinematic__typewriter'>{typed}</span>
                            <span className='sf-cinematic__caret' aria-hidden='true' />
                        </span>
                        <span className='sf-cinematic__brand-subtitle'>AI TRADING TERMINAL</span>
                    </div>
                    <div className='sf-cinematic__welcome'>
                        Welcome to <span className='sf-cinematic__welcome-accent'>{BRAND}</span> — building traders, not just trades.
                    </div>
                    <div className='sf-cinematic__steps'>
                        {STEPS.map((label, i) => {
                            const cls = [
                                'sf-cinematic__step',
                                i < step ? 'sf-cinematic__step--done' : '',
                                i === step ? 'sf-cinematic__step--active' : '',
                            ].filter(Boolean).join(' ');
                            return (
                                <div key={label} className={cls}>
                                    <span className='sf-cinematic__step-dot'>{i < step ? '✓' : i + 1}</span>
                                    <span className='sf-cinematic__step-label'>{label}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className='sf-cinematic__tiles'>
                        {TILES.map(tile => (
                            <div key={tile.label} className='sf-cinematic__tile' aria-hidden='true'>
                                <span className='sf-cinematic__tile-icon'>{tile.icon}</span>
                                <span className='sf-cinematic__tile-label'>{tile.label}</span>
                            </div>
                        ))}
                    </div>
                    <div className='sf-cinematic__status'>{status}</div>
                    <div
                        className='sf-cinematic__progress'
                        role='progressbar'
                        aria-valuenow={progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    >
                        <div className='sf-cinematic__progress-track'>
                            <div className='sf-cinematic__progress-fill' style={{ width: `${progress}%` }} />
                            <div className='sf-cinematic__progress-pulse' />
                        </div>
                        <div className='sf-cinematic__progress-counter'>{progress}%</div>
                    </div>
                    <div className='sf-cinematic__footer'>© 2026 Mwebifx · Powered by Deriv</div>
                </div>
            </div>
        </div>
    );
};

export default BootSplash;
