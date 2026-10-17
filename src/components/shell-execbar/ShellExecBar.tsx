import { useEffect, useState } from 'react';
import { algoProEngine, AlgoProSettings, AlgoProState } from '@/bot/engine/algo-pro-ai';
import './shell-execbar.scss';

interface ShellExecBarProps {
    isDarkMode: boolean;
    onToggleTheme: () => void;
}

const useUtcClock = () => {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(t);
    }, []);
    return now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false });
};

/**
 * Reference-style bottom execution bar: Run/Stop for the Algo Pro auto-trader
 * (paper by default), the Execution FAST toggle (drops the anti-thrash cooldown
 * to 0), the UTC clock, theme switch and fullscreen. Always dark like the
 * reference workspace bar.
 */
const ShellExecBar = ({ isDarkMode, onToggleTheme }: ShellExecBarProps) => {
    const clock = useUtcClock();
    const [engine, setEngine] = useState<AlgoProState>(() => algoProEngine.getState());
    const [fast, setFast] = useState(() => algoProEngine.getState().settings.cooldownMs === 0);
    const [fullscreen, setFullscreen] = useState(false);

    useEffect(() => algoProEngine.subscribe(setEngine), []);

    useEffect(() => {
        const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const running = engine.running;
    const status = engine.error || engine.status;

    const toggleRun = () => {
        if (running) {
            algoProEngine.stop();
            return;
        }
        void algoProEngine.start();
    };

    const toggleFast = () => {
        const next = !fast;
        setFast(next);
        const patch: Partial<AlgoProSettings> = { cooldownMs: next ? 0 : 1500 };
        algoProEngine.configure(patch);
    };

    const toggleFullscreen = () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => undefined);
    };

    return (
        <div className='shell-execbar' role='toolbar' aria-label='Execution bar'>
            <button
                type='button'
                className={`shell-execbar__run ${running ? 'shell-execbar__run--stop' : ''}`}
                onClick={toggleRun}
                disabled={engine.loading}
                title={running ? 'Stop the auto-trader' : 'Start the auto-trader (paper by default)'}
            >
                {running ? (
                    <svg width='13' height='13' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                        <rect x='5' y='5' width='14' height='14' rx='2' />
                    </svg>
                ) : (
                    <svg width='13' height='13' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                        <path d='M7 4.5l13 7.5-13 7.5z' />
                    </svg>
                )}
                {running ? 'Stop' : 'Run'}
            </button>

            <button
                type='button'
                className={`shell-execbar__fast ${fast ? 'shell-execbar__fast--on' : ''}`}
                onClick={toggleFast}
                aria-pressed={fast}
                title='Execution FAST — trade the instant a signal fires (no cooldown)'
            >
                Execution <strong>FAST</strong>
                <span className='shell-execbar__fast-dot' aria-hidden='true' />
            </button>

            <span className='shell-execbar__status' title='Auto-trader status'>
                <span className={`shell-execbar__status-dot ${running ? 'shell-execbar__status-dot--on' : ''}`} aria-hidden='true' />
                {status}
            </span>

            <span className='shell-execbar__spacer' />

            <span className='shell-execbar__clock' title='Server time (UTC)'>
                <span className='shell-execbar__clock-dot' aria-hidden='true' />
                {clock} UTC
            </span>

            <button
                type='button'
                className='shell-execbar__icon'
                onClick={onToggleTheme}
                aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                title={isDarkMode ? 'Light theme' : 'Dark theme'}
            >
                {isDarkMode ? (
                    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.9' strokeLinecap='round' aria-hidden='true'>
                        <circle cx='12' cy='12' r='4.2' />
                        <path d='M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6' />
                    </svg>
                ) : (
                    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                        <path d='M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z' />
                    </svg>
                )}
            </button>

            <button
                type='button'
                className='shell-execbar__icon'
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
                {fullscreen ? (
                    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                        <path d='M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' />
                    </svg>
                ) : (
                    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                        <path d='M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' />
                    </svg>
                )}
            </button>
        </div>
    );
};

export default ShellExecBar;
