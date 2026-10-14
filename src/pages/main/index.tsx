import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import AITradingHub from '@/pages/ai-trading-hub';
import OUBotPage from '@/pages/ou-bot';
import AISignalScannerPage from '@/pages/ai-signal-scanner';
import BacktestPage from '@/pages/backtest';
import Landing from '@/pages/landing';
import BotDock from '@/components/bot-dock';
import AIBotDock from '@/components/ai-bot';
import VersionBanner from '@/components/version-banner';
import AppWrapper from './main';
import './main.scss';

type HubView = 'dashboard' | 'ai-hub' | 'ai-scanner' | 'ou-bot' | 'backtest';

/** Compact stroke icons for the workspace nav (1.6 rem box, currentColor). */
const HubIcon = ({ name }: { name: HubView }) => {
    const common = {
        width: '16',
        height: '16',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.8',
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        'aria-hidden': true,
    };
    switch (name) {
        case 'ai-hub':
            return (
                <svg {...common}>
                    <path d="M3 17l5-6 4 4 6-8 3 4" />
                    <path d="M3 21h18" opacity='0.45' />
                </svg>
            );
        case 'ou-bot':
            return (
                <svg {...common}>
                    <rect x='3' y='3' width='7' height='7' rx='1.6' />
                    <rect x='14' y='3' width='7' height='7' rx='1.6' />
                    <rect x='3' y='14' width='7' height='7' rx='1.6' />
                    <rect x='14' y='14' width='7' height='7' rx='1.6' opacity='0.45' />
                </svg>
            );
        case 'ai-scanner':
            return (
                <svg {...common}>
                    <circle cx='12' cy='12' r='8.5' />
                    <circle cx='12' cy='12' r='4' opacity='0.55' />
                    <path d='M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3' />
                </svg>
            );
        case 'backtest':
            return (
                <svg {...common}>
                    <path d='M9 3h6M10 3v6l-5.5 9.5A2 2 0 006.2 21h11.6a2 2 0 001.7-2.5L14 9V3' />
                    <path d='M8.2 14h7.6' opacity='0.55' />
                </svg>
            );
        default:
            return (
                <svg {...common}>
                    <rect x='3' y='12' width='4' height='9' rx='1' />
                    <rect x='10' y='7' width='4' height='14' rx='1' />
                    <rect x='17' y='3' width='4' height='18' rx='1' opacity='0.55' />
                </svg>
            );
    }
};

const VIEWS: { id: HubView; label: string; hint: string }[] = [
    { id: 'ai-hub', label: 'AI Trading Hub', hint: 'Live markets & strategies' },
    { id: 'ou-bot', label: 'Over / Under Bot', hint: 'Digit edge engine' },
    { id: 'ai-scanner', label: 'AI Signal Scanner', hint: 'Multi-family signals' },
    { id: 'backtest', label: 'Backtest', hint: 'Validate on history' },
    { id: 'dashboard', label: 'Bot Dashboard', hint: 'Blockly workspace' },
];

const useUtcClock = () => {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(t);
    }, []);
    return now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false });
};

const Main = observer(() => {
    const { ui } = useStore() ?? {};
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const [activeView, setActiveView] = useState<HubView>('ai-hub');
    const [landingDone, setLandingDone] = useState(() => {
        try { return localStorage.getItem('mwx_landing_seen') === '1'; } catch { return true; }
    });
    const clock = useUtcClock();

    // Publish the active view so dashboard-only chrome (the onboarding tour)
    // knows to stay quiet while the hub is showing. Both views stay mounted —
    // hiding the dashboard keeps the bot engine alive for the hub's controls.
    //
    // The body class unlocks the page scroll. `.layout` is `height: 100vh` and
    // `.bot-dashboard` is `height: calc(100vh - 4.4rem); overflow: hidden` — a
    // fixed-height app shell the bot builder scrolls *inside*. The hub is a
    // normal document, so it needs that shell relaxed (see main.scss).
    useEffect(() => {
        ui?.setActiveHubView?.(activeView === 'dashboard' ? 'dashboard' : 'ai-hub');
        const isHub = activeView !== 'dashboard';
        document.body.classList.toggle('hub-view', isHub);
        return () => document.body.classList.remove('hub-view');
    }, [activeView, ui]);

    // Re-applies the entrance animation whenever a view becomes visible —
    // wrappers stay mounted (display toggles), so the CSS animation alone would
    // only ever play once, hidden, at first paint.
    const enterAnim = (view: HubView): { animation?: string } =>
        activeView === view
            ? { animation: 'hubEnter 0.45s cubic-bezier(0.22, 1, 0.36, 1) both' }
            : {};

    return (
        <div className='main-dashboard'>
            <VersionBanner />
            <header className='hub-hero'>
                <div className='hub-hero__brand'>
                    <span className='hub-hero__mark' aria-hidden>M</span>
                    <div className='hub-hero__titles'>
                        <h1 className='hub-hero__name'>Mwebifx</h1>
                        <p className='hub-hero__tagline'>AI Trading Terminal — signals, bots &amp; edge, in one place</p>
                    </div>
                </div>
                <div className='hub-hero__status'>
                    <span className='hub-hero__clock' title='Server time (UTC)'>
                        <span className='hub-hero__clock-dot' aria-hidden />
                        {clock} UTC
                    </span>
                    <button
                        type='button'
                        className='hub-hero__theme'
                        onClick={toggleTheme}
                        aria-label={is_dark_mode_on ? 'Switch to light theme' : 'Switch to dark theme'}
                    >
                        {is_dark_mode_on ? (
                            <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.9' strokeLinecap='round' aria-hidden>
                                <circle cx='12' cy='12' r='4.2' />
                                <path d='M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6' />
                            </svg>
                        ) : (
                            <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
                                <path d='M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z' />
                            </svg>
                        )}
                        <span>{is_dark_mode_on ? 'Light' : 'Dark'}</span>
                    </button>
                </div>
            </header>
            <main className='main-content'>
                <div className='view-toggle' role='tablist' aria-label='Choose workspace'>
                    {VIEWS.map(view => (
                        <button
                            key={view.id}
                            role='tab'
                            aria-selected={activeView === view.id}
                            title={view.hint}
                            className={`view-btn ${activeView === view.id ? 'active' : ''}`}
                            onClick={() => setActiveView(view.id)}
                        >
                            <HubIcon name={view.id} />
                            <span>{view.label}</span>
                        </button>
                    ))}
                </div>
                {/* Both views stay mounted. Unmounting the hub on switch would
                    drop its market WebSocket and wipe the RSI buffers, so the
                    user would stare at empty prices for several seconds. */}
                <div
                    className='main-hub'
                    style={{ display: activeView === 'ai-hub' ? 'block' : 'none', ...enterAnim('ai-hub') }}
                    aria-hidden={activeView !== 'ai-hub'}
                >
                    <AITradingHub onOpenDashboard={() => setActiveView('dashboard')} />
                </div>
                <div
                    className='main-hub'
                    style={{ display: activeView === 'ou-bot' ? 'block' : 'none', ...enterAnim('ou-bot') }}
                    aria-hidden={activeView !== 'ou-bot'}
                >
                    <OUBotPage />
                </div>
                <div
                    className='main-hub'
                    style={{ display: activeView === 'ai-scanner' ? 'block' : 'none', ...enterAnim('ai-scanner') }}
                    aria-hidden={activeView !== 'ai-scanner'}
                >
                    <AISignalScannerPage />
                </div>
                <div
                    className='main-hub'
                    style={{ display: activeView === 'backtest' ? 'block' : 'none', ...enterAnim('backtest') }}
                    aria-hidden={activeView !== 'backtest'}
                >
                    <BacktestPage />
                </div>
                <div
                    className='main-dashboard__engine'
                    style={{ display: activeView === 'dashboard' ? 'block' : 'none' }}
                    aria-hidden={activeView !== 'dashboard'}
                >
                    <AppWrapper />
                </div>
            </main>
            <BotDock onNavigate={(view) => setActiveView(view)} />
            <AIBotDock />
            {!landingDone && (
                <Landing
                    onEnter={() => {
                        try { localStorage.setItem('mwx_landing_seen', '1'); } catch { /* private mode */ }
                        setLandingDone(true);
                    }}
                />
            )}
        </div>
    );
});

export default Main;
