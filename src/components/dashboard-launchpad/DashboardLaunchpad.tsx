import { useEffect, useState } from 'react';
import { navigateToHubView } from '@/services/hub-navigation';
import type { HubViewId } from '@/components/hub-sidebar';
import './dashboard-launchpad.scss';

/** Rotating reference-style dashboard hero + the four numbered launcher cards. */
const HEADLINES = [
    'Load a strategy and paper-trade it first.',
    'Scan 13 volatility markets with the AI scanner.',
    'Run your bots on demo before risking real funds.',
];

interface LaunchCard {
    number: string;
    title: string;
    hint: string;
    view: HubViewId;
}

const CARDS: LaunchCard[] = [
    { number: '01', title: 'Load Bot', hint: 'Bot catalog — load it into the builder', view: 'trading-bots' },
    { number: '02', title: 'Premium Bots', hint: 'Ranked AI digit-entry scanners', view: 'pro-ai' },
    { number: '03', title: 'Speed Bot', hint: 'Fast digit engine — Over/Under', view: 'ou-bot' },
    { number: '04', title: 'Manual Trading', hint: 'Digits, RSI, MACD and chart tools', view: 'analysis-tool' },
];

const DashboardLaunchpad = () => {
    const [line, setLine] = useState(0);

    useEffect(() => {
        const t = setInterval(() => setLine(prev => (prev + 1) % HEADLINES.length), 3600);
        return () => clearInterval(t);
    }, []);

    return (
        <section className='launchpad' aria-label='Dashboard shortcuts'>
            <div className='launchpad__hero'>
                <div className='launchpad__hero-copy'>
                    <span className='launchpad__kicker'>Dollarvault Workspace</span>
                    <h1>Trade smarter with automated AI bots.</h1>
                    <p key={line} className='launchpad__rotating' aria-live='polite'>
                        {HEADLINES[line]}
                    </p>
                </div>
                <div className='launchpad__hero-art' aria-hidden='true'>
                    <span className='launchpad__orb launchpad__orb--a' />
                    <span className='launchpad__orb launchpad__orb--b' />
                    <span className='launchpad__orb launchpad__orb--c' />
                </div>
            </div>

            <div className='launchpad__cards'>
                {CARDS.map(card => (
                    <button key={card.number} type='button' className='launchpad__card' onClick={() => navigateToHubView(card.view)}>
                        <span className='launchpad__card-num'>{card.number}</span>
                        <span className='launchpad__card-body'>
                            <strong>{card.title}</strong>
                            <small>{card.hint}</small>
                        </span>
                        <svg className='launchpad__card-arrow' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                            <path d='M5 12h14M13 6l6 6-6 6' />
                        </svg>
                    </button>
                ))}
            </div>
        </section>
    );
};

export default DashboardLaunchpad;
