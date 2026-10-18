import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import AITradingHub from '@/pages/ai-trading-hub';
import HubAccountSwitcher from '@/pages/ai-trading-hub/account-switcher';
import OUBotPage from '@/pages/ou-bot';
import AISignalScannerPage from '@/pages/ai-signal-scanner';
import BacktestPage from '@/pages/backtest';
import ProAiPage from '@/pages/pro-ai';
import DualEdgePage from '@/pages/dual-edge';
import AlgoProAiPage from '@/pages/algo-pro-ai';
import BulkTraderPage from '@/pages/bulk-trader';
import CopyTradingPage from '@/pages/copy-trading';
import AnalysisToolPage from '@/pages/analysis-tool';
import TradingViewPage from '@/pages/tradingview';
import VoltAIPage from '@/pages/volt-ai';
import PremiumAIPage from '@/pages/premium-ai';
import QuickBotPage from '@/pages/quick-bot';
import AutoAIPage from '@/pages/auto-ai';
import ApexBotPage from '@/pages/apex-bot';
import SpeedbotPage from '@/pages/speedbot';
import AutomatedPage from '@/pages/automated';
import HedgingToolPage from '@/pages/hedging-tool';
import ManualTraderPage from '@/pages/manual-trader';
import BotDock from '@/components/bot-dock';
import AIBotDock from '@/components/ai-bot';
import VersionBanner from '@/components/version-banner';
import { HUB_VIEW_LABELS, type HubViewId } from '@/components/hub-sidebar';
import HubTabNav from '@/components/hub-tab-nav';
import ShellExecBar from '@/components/shell-execbar';
import AiScanner from '@/components/ai-scanner';
import RiskPill from '@/components/risk-pill';
import { voiceService } from '@/services/voice-service';
import { soundService } from '@/services/sound-service';
import { subscribeHubNavigation } from '@/services/hub-navigation';
import VoiceAgentControl from '@/components/voice-agent';
import AppWrapper from './main';
import './main.scss';

const BotBuilderPage = lazy(() => import('@/pages/bot-builder'));
const ChartPage = lazy(() => import('@/pages/chart/chart-wrapper'));
const TradingBotsPage = lazy(() => import('@/pages/trading-bots'));

/** True once the welcome fanfare/voice has fired for this page load. */
let welcomedThisLoad = false;

const Main = observer(() => {
    const { ui } = useStore() ?? {};
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const [activeView, setActiveView] = useState<HubViewId>('dashboard');

    useEffect(() => {
        if (welcomedThisLoad) return;
        welcomedThisLoad = true;
        soundService.play('welcome');
        voiceService.announceWelcome();
    }, []);

    useEffect(() => {
        ui?.setActiveHubView?.(activeView === 'dashboard' ? 'dashboard' : 'ai-hub');
        const isHub = activeView !== 'dashboard';
        document.body.classList.toggle('hub-view', isHub);
        return () => document.body.classList.remove('hub-view');
    }, [activeView, ui]);

    useEffect(() => subscribeHubNavigation(setActiveView), []);

    const enterAnim = (view: HubViewId): { animation?: string } =>
        activeView === view
            ? { animation: 'hubEnter 0.45s cubic-bezier(0.22, 1, 0.36, 1) both' }
            : {};

    const mount = (view: HubViewId, node: ReactNode, id?: string) => (
        <div
            key={id || view}
            className='main-hub'
            style={{ display: activeView === view ? 'block' : 'none', ...enterAnim(view) }}
            aria-hidden={activeView !== view}
        >
            {node}
        </div>
    );

    return (
        <div className='main-dashboard'>
            <VersionBanner />
            <div className='main-shell'>
                <header className='main-topbar'>
                    <span className='main-topbar__brand'>
                        <span className='main-topbar__mark' aria-hidden='true'>
                            D
                        </span>
                        <span className='main-topbar__wordmark'>Dollarvault</span>
                    </span>
                    <h1 className='main-topbar__title'>{HUB_VIEW_LABELS[activeView]}</h1>
                    <div className='main-topbar__account'>
                        <HubAccountSwitcher />
                    </div>
                    <VoiceAgentControl />
                </header>
                <HubTabNav activeView={activeView} onSelect={setActiveView} />
                <main className='main-content'>
                    {/* Reference tabs */}
                    <div
                        className='main-hub main-hub--dashboard'
                        style={{ display: activeView === 'dashboard' ? 'block' : 'none' }}
                        aria-hidden={activeView !== 'dashboard'}
                    >
                        <AppWrapper />
                    </div>
                    {mount(
                        'bot-builder',
                        <Suspense fallback={<div className='main-hub__fallback'>Loading bot builder…</div>}>
                            <BotBuilderPage />
                        </Suspense>
                    )}
                    {mount('volt-ai', <VoltAIPage />)}
                    {mount(
                        'free-bots',
                        <Suspense fallback={<div className='main-hub__fallback'>Loading bots…</div>}>
                            <TradingBotsPage />
                        </Suspense>
                    )}
                    {mount('premium-ai', <PremiumAIPage />)}
                    {mount('quick-bot', <QuickBotPage />)}
                    {mount('analysis-tools', <AnalysisToolPage />)}
                    {mount('hedging-tool', <HedgingToolPage />)}
                    {mount('auto-ai', <AutoAIPage />)}
                    {mount('signal-ai', <AISignalScannerPage />)}
                    {mount('manual-trader', <ManualTraderPage />)}
                    {mount('bulk-trader', <BulkTraderPage />)}
                    {mount('apex-bot', <ApexBotPage />)}
                    {mount('copy-trader', <CopyTradingPage />)}
                    {mount('speedbot', <SpeedbotPage />)}
                    {mount('automated', <AutomatedPage />)}
                    {mount(
                        'chart',
                        <Suspense fallback={<div className='main-hub__fallback'>Loading chart…</div>}>
                            <ChartPage show_digits_stats={false} />
                        </Suspense>
                    )}

                    {/* Legacy views reachable via voice / deep links */}
                    {mount('ai-hub', <AITradingHub onOpenDashboard={() => setActiveView('dashboard')} />)}
                    {mount('ou-bot', <OUBotPage />)}
                    {mount('ai-scanner', <AISignalScannerPage />)}
                    {mount('backtest', <BacktestPage />)}
                    {mount('pro-ai', <ProAiPage />)}
                    {mount('dual-edge', <DualEdgePage />)}
                    {mount('algo-pro-ai', <AlgoProAiPage />)}
                    {mount('tradingview', <TradingViewPage />)}
                </main>
            </div>
            <BotDock onNavigate={view => setActiveView(view)} />
            <AIBotDock />
            <AiScanner />
            <RiskPill />
            <ShellExecBar isDarkMode={!!is_dark_mode_on} onToggleTheme={toggleTheme} />
        </div>
    );
});

export default Main;
