import { useEffect, useMemo, useRef, useState } from 'react';
import './landing.scss';

/**
 * First-visit cinematic landing (SmartFlip-class): hero with typewriter titles,
 * live-style stats, feature grid, rotating benefits, review marquee, trust
 * badges and a final CTA — all dismissing into the trading hub via onEnter.
 */

const BRAND = 'Dollarvault';

const HERO_TITLES = [
    'Automate Your Trades',
    'Scan Live Market Signals',
    'Deploy AI-Powered Bots',
    'Backtest Before You Risk',
    `Trade Smarter with ${BRAND}`,
];

const STATS = [
    { value: '28+', label: 'Live Markets' },
    { value: '5', label: 'Signal Families' },
    { value: '24/7', label: 'Bot Automation' },
    { value: '2', label: 'Paper & Live Modes' },
];

const FEATURES = [
    {
        icon: '🤖',
        img: 'https://picsum.photos/seed/dollarvault-bot/800/520',
        title: 'AI-Powered Trading Bots',
        tagline: 'Automate your success',
        details: 'Deploy the Over/Under engine, the AI bot and the multi-family signal scanner. Configure risk, arm auto-trade, and let them work tick by tick.',
    },
    {
        icon: '📊',
        img: 'https://picsum.photos/seed/dollarvault-charts/800/520',
        title: 'Real-Time Market Analysis',
        tagline: 'Data-driven decisions',
        details: 'Live synthetic and forex streams, RSI, digit distributions and confidence scores — every setup ranked before a single order is placed.',
    },
    {
        icon: '🧠',
        img: 'https://picsum.photos/seed/dollarvault-scanner/800/520',
        title: 'Signal Scanner Engine',
        tagline: 'Five families, one loop',
        details: 'Rise/Fall, Even/Odd, Over/Under, Match/Differ and mean-reversion signals scored continuously, with paper trades to prove the flow first.',
    },
    {
        icon: '🛡️',
        img: 'https://picsum.photos/seed/dollarvault-shield/800/520',
        title: 'Risk Management Tools',
        tagline: 'Protect your capital',
        details: 'Stake limits, max open positions, cooldowns, session stop-loss and martingale controls. Live trading stays behind an explicit confirm.',
    },
];

const MOMENTS = [
    { seed: 'moment-1', src: 'https://picsum.photos/seed/dollarvault-moment-1/900/600' },
    { seed: 'moment-2', src: 'https://picsum.photos/seed/dollarvault-moment-2/900/600' },
    { seed: 'moment-3', src: 'https://picsum.photos/seed/dollarvault-moment-3/900/600' },
];

const BENEFITS = [
    'Paper-trade every signal before risking real funds',
    'Confidence and expected-value gated entries',
    'Risk limits, cooldowns and stop-loss built in',
    'Backtest strategies on real historical ticks',
    'Responsive workspace on desktop and mobile',
    'Secured Deriv OAuth sessions — you hold the keys',
];

const REVIEWS = [
    {
        name: 'Amina R.',
        role: 'Synthetics day trader',
        quote: 'The scanner surface finally made digit distributions readable. Paper mode proved the flow before I went live.',
    },
    {
        name: 'Brian K.',
        role: 'Bot strategy builder',
        quote: 'I wired my Blockly strategy in minutes. The dashboard runs it while the AI pages handle my digit setups.',
    },
    {
        name: 'Chloe M.',
        role: 'Risk-first trader',
        quote: 'Cooldowns and session stop-loss are the reason I stayed. The bots refuse to revenge-trade my account.',
    },
    {
        name: 'Daniel O.',
        role: 'Over/Under specialist',
        quote: 'Confidence-gated entries changed everything — fewer trades, cleaner setups, and the hold reasons tell me why.',
    },
    {
        name: 'Elena V.',
        role: 'Backtest devotee',
        quote: 'I validate on history first, every time. Seeing out-of-sample splits before deploying is the real edge.',
    },
    {
        name: 'Frank T.',
        role: 'Part-time trader',
        quote: 'I check the hub on my phone between work. Signals, bots and equity in one glance — nothing else comes close.',
    },
];

const TRUST = [
    { icon: '✓', text: 'Paper & live modes' },
    { icon: '✓', text: 'Risk controls built-in' },
    { icon: '✓', text: 'Backtestable strategies' },
];

/** Remote image that removes itself on load failure so the CSS gradient fallback shows. */
const SmartImage = ({
    src,
    width,
    height,
    alt = '',
    eager = false,
    className,
}: {
    src: string;
    width: number;
    height: number;
    alt?: string;
    eager?: boolean;
    className?: string;
}) => {
    const [failed, setFailed] = useState(false);
    if (failed) return null;
    return (
        <img
            className={className}
            src={src}
            alt={alt}
            width={width}
            height={height}
            loading={eager ? 'eager' : 'lazy'}
            decoding='async'
            aria-hidden={alt ? undefined : 'true'}
            onError={() => setFailed(true)}
        />
    );
};

/** Animated count-up for numeric stats (e.g. "28+", "24/7"). */
const CountUp = ({ value, duration = 1400 }: { value: string; duration?: number }) => {
    const ref = useRef<HTMLSpanElement | null>(null);
    const [shown, setShown] = useState(() => value.replace(/^\d+/, '0'));

    useEffect(() => {
        const match = value.match(/^(\d+)/);
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!match || reduced) {
            setShown(value);
            return;
        }
        const target = parseInt(match[1], 10);
        const tail = value.slice(match[1].length);
        const el = ref.current;
        if (!el) return;
        let raf = 0;
        let start = 0;
        const io = new IntersectionObserver(
            entries => {
                if (!entries[0]?.isIntersecting) return;
                io.disconnect();
                const step = ts => {
                    if (!start) start = ts;
                    const p = Math.min(1, (ts - start) / duration);
                    const eased = 1 - Math.pow(1 - p, 3);
                    setShown(`${Math.round(target * eased)}${tail}`);
                    if (p < 1) raf = requestAnimationFrame(step);
                };
                raf = requestAnimationFrame(step);
            },
            { threshold: 0.4 }
        );
        io.observe(el);
        return () => {
            io.disconnect();
            cancelAnimationFrame(raf);
        };
    }, [value, duration]);

    return <span ref={ref}>{shown}</span>;
};

/** 3D tilt feature card that follows the pointer (skips until revealed). */
const TiltCard = ({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    return (
        <div
            ref={ref}
            className='landing__feature-card animated-element'
            style={{ transitionDelay: `${delay}ms` }}
            onPointerMove={e => {
                const el = ref.current;
                if (!el || !el.classList.contains('in')) return;
                const r = el.getBoundingClientRect();
                const px = (e.clientX - r.left) / r.width - 0.5;
                const py = (e.clientY - r.top) / r.height - 0.5;
                el.style.transform = `perspective(900px) rotateX(${(-py * 7).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg) translateY(-4px)`;
            }}
            onPointerLeave={() => {
                if (ref.current) ref.current.style.transform = '';
            }}
        >
            {children}
        </div>
    );
};

/** Reveal-on-scroll: adds `.in` when the element enters the viewport. */
const useReveal = () => {
    const ref = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const targets = el.querySelectorAll('.animated-text, .animated-element');
        const io = new IntersectionObserver(
            entries => {
                entries.forEach(e => {
                    if (e.isIntersecting) {
                        e.target.classList.add('in');
                        io.unobserve(e.target);
                    }
                });
            },
            { threshold: 0.15 }
        );
        targets.forEach(t => io.observe(t));
        return () => io.disconnect();
    }, []);
    return ref;
};

/** Rotating typewriter headline. */
const TypewriterTitle = () => {
    const [index, setIndex] = useState(0);
    const [text, setText] = useState('');
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        const full = HERO_TITLES[index];
        if (!deleting && text === full) {
            const hold = setTimeout(() => setDeleting(true), 1800);
            return () => clearTimeout(hold);
        }
        if (deleting && text === '') {
            setDeleting(false);
            setIndex(i => (i + 1) % HERO_TITLES.length);
            return;
        }
        const tick = setTimeout(
            () => {
                setText(t => (deleting ? full.slice(0, t.length - 1) : full.slice(0, t.length + 1)));
            },
            deleting ? 34 : 62
        );
        return () => clearTimeout(tick);
    }, [text, deleting, index]);

    return (
        <span className='landing__tw'>
            {text}
            <span className='landing__tw-caret' aria-hidden />
        </span>
    );
};

/** Endless review marquee (content duplicated for a seamless loop). */
const ReviewMarquee = ({ compact = false }: { compact?: boolean }) => {
    const cards = useMemo(() => [...REVIEWS, ...REVIEWS], []);
    return (
        <div className={`landing__marquee ${compact ? 'landing__marquee--compact' : ''}`} aria-hidden='true'>
            <div className='landing__marquee-track'>
                {cards.map((r, i) => (
                    <div key={`${r.name}-${i}`} className='landing__review'>
                        <div className='landing__review-stars'>★★★★★</div>
                        <p className='landing__review-quote'>“{r.quote}”</p>
                        <div className='landing__review-meta'>
                            <span className='landing__review-name'>{r.name}</span>
                            <span className='landing__review-role'>{r.role}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

interface LandingProps {
    onEnter: () => void;
}

const Landing = ({ onEnter }: LandingProps) => {
    const rootRef = useReveal();
    const spotRef = useRef<HTMLDivElement | null>(null);
    const progressRef = useRef<HTMLElement | null>(null);
    const [benefit, setBenefit] = useState(0);

    useEffect(() => {
        const t = setInterval(() => setBenefit(v => (v + 1) % BENEFITS.length), 2600);
        return () => clearInterval(t);
    }, []);

    // Enter / Space dismisses into the hub.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') onEnter();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onEnter]);

    // Scroll progress bar reflects the landing's own scroll.
    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const onScroll = () => {
            const bar = progressRef.current;
            if (!bar) return;
            const max = el.scrollHeight - el.clientHeight;
            bar.style.width = `${max > 0 ? (el.scrollTop / max) * 100 : 0}%`;
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => el.removeEventListener('scroll', onScroll);
    }, [rootRef]);

    // Lock the page scroll while the landing overlay owns the viewport, and
    // hide the layout's fixed footer — it lives outside .main-dashboard's
    // isolation stacking context, so it would otherwise paint over the overlay.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.body.classList.add('landing-open');
        return () => {
            document.body.style.overflow = prev;
            document.body.classList.remove('landing-open');
        };
    }, []);

    return (
        <div
            className='landing'
            ref={rootRef}
            role='dialog'
            aria-label={`${BRAND} introduction`}
            onPointerMove={e => {
                const spot = spotRef.current;
                if (spot) {
                    spot.style.left = `${e.clientX}px`;
                    spot.style.top = `${e.clientY}px`;
                    spot.style.opacity = '1';
                }
            }}
        >
            <div className='landing__bg' aria-hidden='true' />
            <div className='landing__orb landing__orb--a' aria-hidden='true' />
            <div className='landing__orb landing__orb--b' aria-hidden='true' />
            <div className='landing__spotlight' ref={spotRef} aria-hidden='true' />
            <div className='landing__scroll' aria-hidden='true'>
                <i ref={progressRef} />
            </div>

            <header className='landing__header'>
                <div className='landing__logo'>
                    <img className='landing__logo-icon' src='/favicon.svg' alt='' aria-hidden='true' />
                    <span className='landing__logo-word'>{BRAND}</span>
                </div>
                <button type='button' className='landing__login-btn' onClick={onEnter}>
                    Login Now
                    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
                        <path d='M5 12h14M13 6l6 6-6 6' />
                    </svg>
                </button>
            </header>

            <section className='landing__hero'>
                <div className='landing__hero-media' aria-hidden='true'>
                    <SmartImage
                        className='landing__hero-img'
                        src='https://picsum.photos/seed/dollarvault-hero/2400/1400'
                        width={2400}
                        height={1400}
                        eager
                    />
                    <div className='landing__hero-scrim' />
                </div>
                <div className='landing__hero-inner'>
                    <div className='landing__badge animated-text'>
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
                            <path d='M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z' />
                        </svg>
                        Built for serious Deriv traders
                    </div>
                    <h1 className='landing__sr-only'>
                        {BRAND} — AI trading bots, live signals and backtesting
                    </h1>
                    <p className='landing__title animated-text' aria-hidden='true'>
                        <TypewriterTitle />
                    </p>
                    <p className='landing__subtitle animated-text'>
                        Your all-in-one workspace for automated trading, smart bots and real-time market insights —
                        paper-trade first, go live when the edge is proven.
                    </p>
                    <div className='landing__cta animated-element'>
                        <button type='button' className='landing__cta-primary' onClick={onEnter}>
                            <span>Start Trading Now</span>
                            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
                                <path d='M5 12h14M13 6l6 6-6 6' />
                            </svg>
                        </button>
                        <button type='button' className='landing__cta-ghost' onClick={onEnter}>
                            No account yet? <span>Explore the demo</span>
                        </button>
                    </div>
                    <div className='landing__quick animated-element'>
                        <span>✓ No credit card required</span>
                        <span>✓ $10,000 virtual account on Deriv demo</span>
                        <span>✓ Paper mode built in</span>
                    </div>
                    <div className='landing__stats animated-element'>
                        {STATS.map(s => (
                            <div key={s.label} className='landing__stat'>
                                <div className='landing__stat-value'>
                                    <CountUp value={s.value} />
                                </div>
                                <div className='landing__stat-label'>{s.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
                <ReviewMarquee compact />
            </section>

            <section className='landing__section landing__features'>
                <div className='landing__section-head'>
                    <span className='landing__eyebrow animated-text'>Platform</span>
                    <h2 className='landing__section-title animated-text'>
                        Everything you need for today's fast-paced synthetic markets
                    </h2>
                    <p className='landing__section-sub animated-text'>
                        Manual analysis, automated bot execution and continuous scanning — {BRAND} keeps the whole
                        workflow in one place, with risk controls everywhere.
                    </p>
                </div>
                <div className='landing__features-grid'>
                    {FEATURES.map((f, i) => (
                        <TiltCard key={f.title} delay={i * 70}>
                            <div className='landing__feature-media'>
                                <SmartImage src={f.img} width={800} height={520} />
                                <span className='landing__feature-icon' aria-hidden>{f.icon}</span>
                            </div>
                            <div className='landing__feature-body'>
                                <h3 className='landing__feature-title'>{f.title}</h3>
                                <p className='landing__feature-tag'>{f.tagline}</p>
                                <p className='landing__feature-details'>{f.details}</p>
                            </div>
                        </TiltCard>
                    ))}
                </div>
            </section>

            <section className='landing__moments' aria-hidden='true'>
                <div className='landing__moments-row'>
                    {MOMENTS.map((m, i) => (
                        <div key={m.seed} className='landing__moment animated-element' style={{ transitionDelay: `${i * 90}ms` }}>
                            <SmartImage src={m.src} width={900} height={600} />
                        </div>
                    ))}
                </div>
            </section>

            <section className='landing__section landing__benefits'>
                <div className='landing__benefits-copy'>
                    <span className='landing__eyebrow animated-text'>Why traders switch</span>
                    <h2 className='landing__section-title animated-text'>Built to keep you disciplined</h2>
                    <ul className='landing__benefits-list animated-element'>
                        {BENEFITS.map((b, i) => (
                            <li key={b} className={`landing__benefit ${i === benefit ? 'is-active' : ''}`}>
                                {b}
                            </li>
                        ))}
                    </ul>
                </div>
                <div className='landing__benefits-panel animated-element' aria-hidden='true'>
                    <div className='landing__benefits-frame'>
                        <SmartImage
                            className='landing__benefits-img'
                            src='https://picsum.photos/seed/dollarvault-terminal/1200/1400'
                            width={1200}
                            height={1400}
                        />
                        <div className='landing__benefits-scrim' />
                        <div className='landing__mini-stack'>
                            <div className='landing__mini-card'>
                                <div className='landing__mini-row'>
                                    <span>Scanner</span>
                                    <span className='landing__mini-live'>● auto-trade armed</span>
                                </div>
                                <div className='landing__mini-bar'><i style={{ width: '78%' }} /></div>
                                <div className='landing__mini-row landing__mini-row--muted'>
                                    <span>Confidence 0.82</span>
                                    <span>EV +4.1%</span>
                                </div>
                            </div>
                            <div className='landing__mini-card'>
                                <div className='landing__mini-row'>
                                    <span>Risk gate</span>
                                    <span className='landing__mini-ok'>passed</span>
                                </div>
                                <div className='landing__mini-chips'>
                                    <span>max 1 open</span>
                                    <span>cooldown 2s</span>
                                    <span>stop-loss armed</span>
                                </div>
                            </div>
                            <div className='landing__mini-card'>
                                <div className='landing__mini-row'>
                                    <span>Backtest</span>
                                    <span className='landing__mini-ok'>out-of-sample ✓</span>
                                </div>
                                <div className='landing__mini-row landing__mini-row--muted'>
                                    <span>Train 70% · Test 30%</span>
                                    <span>Deterministic</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className='landing__section landing__testimonials'>
                <div className='landing__section-head'>
                    <span className='landing__eyebrow animated-text'>Community</span>
                    <h2 className='landing__section-title animated-text'>Traders who run the terminal daily</h2>
                    <div className='landing__trust animated-element'>
                        {TRUST.map(t => (
                            <span key={t.text} className='landing__trust-badge'>
                                <span className='landing__trust-icon' aria-hidden>{t.icon}</span>
                                {t.text}
                            </span>
                        ))}
                    </div>
                </div>
                <ReviewMarquee />
            </section>

            <section className='landing__final'>
                <div className='landing__final-media' aria-hidden='true'>
                    <SmartImage
                        className='landing__final-img'
                        src='https://picsum.photos/seed/dollarvault-cta/2000/900'
                        width={2000}
                        height={900}
                    />
                    <div className='landing__final-scrim' />
                </div>
                <div className='landing__final-inner'>
                    <span className='landing__eyebrow animated-text'>Get started</span>
                    <h2 className='landing__section-title animated-text'>Ready to transform your trading?</h2>
                    <p className='landing__final-text animated-text'>
                        Open the terminal, paper-trade the signals, and arm the bots when the numbers agree.
                    </p>
                    <button type='button' className='landing__cta-primary animated-element' onClick={onEnter}>
                        <span>Start Trading Now</span>
                        <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
                            <path d='M5 12h14M13 6l6 6-6 6' />
                        </svg>
                    </button>
                </div>
                <footer className='landing__footer'>
                    © 2026 {BRAND} · Powered by Deriv · Trading involves risk of loss
                </footer>
            </section>
        </div>
    );
};

export default Landing;
