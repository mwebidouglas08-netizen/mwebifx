import { useEffect, useState } from 'react';
import './boot-splash.scss';

interface BootSplashProps {
    onDone?: () => void;
    minDurationMs?: number;
}

const STAGES = [
    'Connecting to Deriv…',
    'Warming market data…',
    'Loading trading engines…',
    'Ready',
];

const BootSplash = ({ onDone, minDurationMs = 2200 }: BootSplashProps) => {
    const [stage, setStage] = useState(0);
    const [leaving, setLeaving] = useState(false);

    useEffect(() => {
        const stageStep = Math.max(350, Math.floor(minDurationMs / STAGES.length));
        const timers: ReturnType<typeof setTimeout>[] = [];
        STAGES.forEach((_, i) => {
            if (i === 0) return;
            timers.push(setTimeout(() => setStage(i), stageStep * i));
        });
        timers.push(
            setTimeout(() => setLeaving(true), minDurationMs),
            setTimeout(() => onDone?.(), minDurationMs + 550)
        );
        return () => timers.forEach(clearTimeout);
    }, [minDurationMs, onDone]);

    const progress = Math.round(((stage + 1) / STAGES.length) * 100);

    return (
        <div className={`boot-splash ${leaving ? 'boot-splash--leave' : ''}`} aria-hidden={leaving}>
            <div className='boot-splash__glow' />
            <div className='boot-splash__inner'>
                <div className='boot-splash__logo'>
                    <svg viewBox='0 0 64 64' width='72' height='72' aria-hidden='true'>
                        <rect width='64' height='64' rx='16' fill='#0b1220' />
                        <path d='M12 44 L24 22 L32 35 L39 25 L52 44 Z' fill='url(#g)' />
                        <defs>
                            <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
                                <stop offset='0' stopColor='#6366f1' />
                                <stop offset='1' stopColor='#22d3ee' />
                            </linearGradient>
                        </defs>
                    </svg>
                </div>
                <h1 className='boot-splash__title'>
                    Mwebifx<span className='boot-splash__dot'>.</span>
                </h1>
                <p className='boot-splash__tag'>AI Trading Hub</p>

                <div className='boot-splash__bar' role='progressbar' aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className='boot-splash__bar-fill' style={{ width: `${progress}%` }} />
                </div>
                <p className='boot-splash__stage'>{STAGES[stage]}</p>
            </div>
        </div>
    );
};

export default BootSplash;
