import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import AITradingHub from '@/pages/ai-trading-hub';
import OUBotPage from '@/pages/ou-bot';
import AISignalScannerPage from '@/pages/ai-signal-scanner';
import BacktestPage from '@/pages/backtest';
import TradingBotsPage from '@/pages/trading-bots';
import ProAiPage from '@/pages/pro-ai';
import DualEdgePage from '@/pages/dual-edge';

import AlgoProAiPage from '@/pages/algo-pro-ai';
import BulkTraderPage from '@/pages/bulk-trader';
import CopyTradingPage from '@/pages/copy-trading';
import AnalysisToolPage from '@/pages/analysis-tool';
import TradingViewPage from '@/pages/tradingview';
import Landing from '@/pages/landing';
import BotDock from '@/components/bot-dock';
import AIBotDock from '@/components/ai-bot';
import VersionBanner from '@/components/version-banner';
import HubSidebar, { HUB_VIEW_LABELS, type HubViewId } from '@/components/hub-sidebar';
import { voiceService } from '@/services/voice-service';
import { soundService } from '@/services/sound-service';
import AppWrapper from './main';
import './main.scss';

const useUtcClock = () => {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(t);
    }, []);
    return now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false });
};

/** True once the welcome fanfare/voice has fired for this page load. */
let welcomedThisLoad = false;

const Main = observer(() => {
    const { ui } = useStore() ?? {};
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const [activeView, setActiveView] = useState<HubViewId>('ai-hub');
    const [navOpen, setNavOpen] = useState(false);
    // The landing page greets every app open (fresh load or refresh) — the
    // welcome fanfare below plays over it, and Enter/any CTA dismisses it.
    const [landingDone, setLandingDone] = useState(false);
    const clock = useUtcClock();

    // Welcome voice + chime when the app opens (or is refreshed). Both services
    // no-op when muted/unsupported; the voice retries on the first gesture when
    // the browser blocks speech before interaction. The module-level flag keeps
    // StrictMode's double-invoke (and any remount) from repeating it.
    useEffect(() => {
        if (welcomedThisLoad) return;
        welcomedThisLoad = true;
        soundService.play('welcome');
        voiceService.announceWelcome();
    }, []);

    // Publish the active view so dashboard-only chrome (the onboarding tour)
    // knows to stay quiet while the hub is showing. Both views stay mounted —
    // hiding the dashboard keeps the bot engine alive for the hub's controls.
    //
    // The shell is now a fixed-height grid: `.main-content` is the scroll
    // container (see main.scss), so the body class no longer unlocks page
    // scroll — it remains the signal dashboard-only chrome keys off of.
    useEffect(() => {
        ui?.setActiveHubView?.(activeView === 'dashboard' ? 'dashboard' : 'ai-hub');
        const isHub = activeView !== 'dashboard';
        document.body.classList.toggle('hub-view', isHub);
        return () => document.body.classList.remove('hub-view');
    }, [activeView, ui]);

    // Re-applies the entrance animation whenever a view becomes visible —
    // wrappers stay mounted (display toggles), so the CSS animation alone would
    // only ever play once, hidden, at first paint.
    const enterAnim = (view: HubViewId): { animation?: string } =>
        activeView === view
            ? { animation: 'hubEnter 0.45s cubic-bezier(0.22, 1, 0.36, 1) both' }
            : {};

    return (
        <div className='main-dashboard'>
            <VersionBanner />
            <HubSidebar
                activeView={activeView}
                onSelect={setActiveView}
                isDarkMode={!!is_dark_mode_on}
                onToggleTheme={toggleTheme}
                isMobileOpen={navOpen}
                onRequestClose={() => setNavOpen(false)}
            />
            <div className='main-shell'>
                <header className='main-topbar'>
                    <button
                        type='button'
                        className='main-topbar__menu'
                        onClick={() => setNavOpen(true)}
                        aria-label='Open navigation'
                        aria-expanded={navOpen}
                    >
                        <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' aria-hidden>
                            <path d='M4 7h16M4 12h16M4 17h16' />
                        </svg>
                    </button>
                    <h1 className='main-topbar__title'>{HUB_VIEW_LABELS[activeView]}</h1>
                    <span className='main-topbar__clock' title='Server time (UTC)'>
                        <span className='main-topbar__clock-dot' aria-hidden />
                        {clock} UTC
                    </span>
                </header>
                <main className='main-content'>
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
                        className='main-hub'
                        style={{ display: activeView === 'trading-bots' ? 'block' : 'none', ...enterAnim('trading-bots') }}
                        aria-hidden={activeView !== 'trading-bots'}
                    >
                        <TradingBotsPage onOpenDashboard={() => setActiveView('dashboard')} />
                    </div>
                    <div
                        className='main-hub'
                        style={{ display: activeView === 'pro-ai' ? 'block' : 'none', ...enterAnim('pro-ai') }}
                        aria-hidden={activeView !== 'pro-ai'}
                    >
                        <ProAiPage />
                    </div>
                    <div
                        className='main-hub'
                        style={{ display: activeView === 'dual-edge' ? 'block' : 'none', ...enterAnim('dual-edge') }}
                        aria-hidden={activeView !== 'dual-edge'}
                    >
                        <DualEdgePage />
                    </div>
                    <div
                        className='main-hub'
                        style={{ display: activeView === 'algo-pro-ai' ? 'block' : 'none', ...enterAnim('algo-pro-ai') }}
                        aria-hidden={activeView !== 'algo-pro-ai'}
                    >
                        <AlgoProAiPage />
                    </div>
                    <div
                        className='main-hub'
                        style={{ display: activeView === 'bulk-trader' ? 'block' : 'none', ...enterAnim('bulk-trader') }}
                        aria-hidden={activeView !== 'bulk-trader'}
                    >
                        <BulkTraderPage />
                    </div>
                    <div
                        className='main-hub'
                        style={{ display: activeView === 'copy-trading' ? 'block' : 'none', ...enterAnim('copy-trading') }}
                        aria-hidden={activeView !== 'copy-trading'}
                    >
                        <CopyTradingPage />
                    </div>
                    <div
                        className='main-hub'
                        style={{ display: activeView === 'analysis-tool' ? 'block' : 'none', ...enterAnim('analysis-tool') }}
                        aria-hidden={activeView !== 'analysis-tool'}
                    >
                        <AnalysisToolPage />
                    </div>
                    <div
                        className='main-hub'
                        style={{ display: activeView === 'tradingview' ? 'block' : 'none', ...enterAnim('tradingview') }}
                        aria-hidden={activeView !== 'tradingview'}
                    >
                        <TradingViewPage />
                    </div>
                    <div
                        className='main-dashboard__engine'
                        style={{ display: activeView === 'dashboard' ? 'block' : 'none' }}
                        aria-hidden={activeView !== 'dashboard'}
                    >
                        <AppWrapper />
                    </div>
                </main>
            </div>
            <BotDock onNavigate={(view) => setActiveView(view)} />
            <AIBotDock />
            {!landingDone && (
                <Landing
                    onEnter={() => {
                        setLandingDone(true);
                    }}
                />
            )}
        </div>
    );
});

export default Main;
