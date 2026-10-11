import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import AITradingHub from '@/pages/ai-trading-hub';
import AppWrapper from './main';
import './main.scss';

type HubView = 'dashboard' | 'ai-hub';

const Main = observer(() => {
    const { ui } = useStore() ?? {};
    const [activeView, setActiveView] = useState<HubView>('ai-hub');

    // Publish the active view so dashboard-only chrome (the onboarding tour)
    // knows to stay quiet while the hub is showing. Both views stay mounted —
    // hiding the dashboard keeps the bot engine alive for the hub's controls.
    //
    // The body class unlocks the page scroll. `.layout` is `height: 100vh` and
    // `.bot-dashboard` is `height: calc(100vh - 4.4rem); overflow: hidden` — a
    // fixed-height app shell the bot builder scrolls *inside*. The hub is a
    // normal document, so it needs that shell relaxed (see main.scss).
    useEffect(() => {
        ui?.setActiveHubView?.(activeView);
        const isHub = activeView === 'ai-hub';
        document.body.classList.toggle('hub-view', isHub);
        return () => document.body.classList.remove('hub-view');
    }, [activeView, ui]);

    return (
        <div className='main-dashboard'>
            <main className='main-content'>
                <div className='view-toggle' role='tablist' aria-label='Choose workspace'>
                    <button
                        role='tab'
                        aria-selected={activeView === 'ai-hub'}
                        className={`view-btn ${activeView === 'ai-hub' ? 'active' : ''}`}
                        onClick={() => setActiveView('ai-hub')}
                    >
                        AI Trading Hub
                    </button>
                    <button
                        role='tab'
                        aria-selected={activeView === 'dashboard'}
                        className={`view-btn ${activeView === 'dashboard' ? 'active' : ''}`}
                        onClick={() => setActiveView('dashboard')}
                    >
                        Bot Dashboard
                    </button>
                </div>
                {/* Both views stay mounted. Unmounting the hub on switch would
                    drop its market WebSocket and wipe the RSI buffers, so the
                    user would stare at empty prices for several seconds. */}
                <div
                    className='main-hub'
                    style={{ display: activeView === 'ai-hub' ? 'block' : 'none' }}
                    aria-hidden={activeView !== 'ai-hub'}
                >
                    <AITradingHub onOpenDashboard={() => setActiveView('dashboard')} />
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
    );
});

export default Main;
