import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import AITradingHub from '@/pages/ai-trading-hub';
import AppWrapper from './main';
import './main.scss';

const Main = observer(() => {
    const [activeView, setActiveView] = useState<'dashboard' | 'ai-hub'>('ai-hub');

    return (
        <div className='main-dashboard'>
            <main className='main-content'>
                <div className='view-toggle'>
                    <button
                        className={`view-btn ${activeView === 'ai-hub' ? 'active' : ''}`}
                        onClick={() => setActiveView('ai-hub')}
                    >
                        AI Trading Hub
                    </button>
                    <button
                        className={`view-btn ${activeView === 'dashboard' ? 'active' : ''}`}
                        onClick={() => setActiveView('dashboard')}
                    >
                        Dashboard
                    </button>
                </div>
                {activeView === 'ai-hub' ? <AITradingHub /> : null}
                {/* The bot engine stays mounted (hidden on the hub) so the
                    Blockly workspace and run-panel store are live — the hub's
                    Start/Stop buttons drive the same engine as the dashboard. */}
                <div
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
