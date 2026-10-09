import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import Header from '@/components/layout/header/header';
import Footer from '@/components/layout/footer';
import RunPanel from '@/components/run-panel/run-panel';
import AITradingHub from '@/pages/ai-trading-hub';
import './main.scss';

const Main = observer(() => {
    const [activeView, setActiveView] = useState<'dashboard' | 'ai-hub'>('ai-hub');

    return (
        <div className='main-dashboard'>
            <Header />
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
                {activeView === 'ai-hub' ? <AITradingHub /> : <RunPanel />}
            </main>
            <Footer />
        </div>
    );
});

export default Main;
