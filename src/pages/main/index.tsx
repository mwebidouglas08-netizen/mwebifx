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
    useEffect(() => {
        ui?.setActiveHubView?.(activeView);
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
                {activeView === 'ai-hub' ? <AITradingHub onOpenDashboard={() => setActiveView('dashboard')} /> : null}
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
