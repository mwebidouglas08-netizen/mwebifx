import { useEffect, useState } from 'react';
import { navigateToHubView } from '@/services/hub-navigation';
import type { HubViewId } from '@/components/hub-sidebar';
import './dashboard-launchpad.scss';

/** Rotating reference-style dashboard hero + the four numbered launcher cards. */
const HEADLINES = [
    'Plan your trade, then trade your plan.',
    'Protect your capital — risk management comes first.',
    'A missed opportunity is better than an unplanned trade.',
    'The trend is your friend until it ends.',
];

const WELCOME = 'Welcome to your trading workspace.';

interface LaunchCard {
    number: string;
    title: string;
    hint: string;
    view: HubViewId;
}

const CARDS: LaunchCard[] = [
    { number: '01', title: 'Load Bot', hint: 'Free Bots — load a strategy', view: 'free-bots' },
    { number: '02', title: 'Premium Bots', hint: 'AI scanner workspaces', view: 'premium-ai' },
    { number: '03', title: 'Speed Bot', hint: 'Fast digit trader', view: 'speedbot' },
    { number: '04', title: 'Manual Trading', hint: 'One-tick terminal', view: 'manual-trader' },
];

const DashboardLaunchpad = () => {
    const [line, setLine] = useState(0);
    const [typed, setTyped] = useState(0);

    useEffect(() => {
        const t = setInterval(() => setLine(prev => (prev + 1) % HEADLINES.length), 3600);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        if (typed >= WELCOME.length) return;
        const t = setTimeout(() => setTyped(n => n + 1), 38);
        return () => clearTimeout(t);
    }, [typed]);

    return (
        <section className='launchpad' aria-label='Dashboard shortcuts'>
            <div className='launchpad__hero'>
                <div className='launchpad__hero-copy'>
                    <span className='launchpad__kicker'>Dollarvault Workspace</span>
                    <h1 aria-live='polite'>
                        {WELCOME.slice(0, typed)}
                        <span className='launchpad__caret' aria-hidden='true' />
                    </h1>
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
