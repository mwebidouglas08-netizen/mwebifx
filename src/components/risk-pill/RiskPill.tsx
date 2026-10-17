import { useEffect, useRef, useState } from 'react';
import './risk-pill.scss';

/**
 * Reference-style fixed "Risk Disclaimer" pill (bottom-left) with a short
 * expandable disclaimer above it.
 */
const RiskPill = () => {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        const onClick = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onClick);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onClick);
        };
    }, [open]);

    return (
        <div className='risk-pill' ref={wrapRef}>
            {open && (
                <div className='risk-pill__card' role='note'>
                    <strong>Risk Disclaimer</strong>
                    <p>
                        Trading binary and synthetic-digits contracts carries risk of loss. Bots, scanners and
                        signals here are tools — they do not guarantee profit. Start on demo/paper, never trade
                        money you cannot afford to lose, and set a stop loss before you run any strategy.
                    </p>
                </div>
            )}
            <button
                type='button'
                className={`risk-pill__btn ${open ? 'risk-pill__btn--on' : ''}`}
                onClick={() => setOpen(v => !v)}
                aria-expanded={open}
            >
                <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                    <path d='M12 3l9 16H3z' />
                    <path d='M12 10v4M12 17.2v.1' />
                </svg>
                Risk Disclaimer
            </button>
        </div>
    );
};

export default RiskPill;
