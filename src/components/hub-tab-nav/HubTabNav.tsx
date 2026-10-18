import { useEffect, useRef } from 'react';
import { HUB_TAB_ORDER, HUB_VIEW_LABELS, type HubViewId } from '@/components/hub-sidebar';
import './hub-tab-nav.scss';

interface HubTabNavProps {
    activeView: HubViewId;
    onSelect: (view: HubViewId) => void;
}

const ico = {
    width: '17',
    height: '17',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
};

const TabIcon = ({ view }: { view: HubViewId }) => {
    switch (view) {
        case 'dashboard':
            return (
                <svg {...ico}>
                    <path d='M3 10.5 12 3l9 7.5' />
                    <path d='M5.5 9.5V21h13V9.5' />
                </svg>
            );
        case 'bot-builder':
            return (
                <svg {...ico}>
                    <path d='M12 2.5l7.5 4.3v8.4L12 19.5 4.5 15.2V6.8z' />
                    <path d='M12 8.5l3.5 2v4L12 16.5 8.5 14.5v-4z' opacity='0.55' />
                </svg>
            );
        case 'volt-ai':
        case 'auto-ai':
            return (
                <svg {...ico}>
                    <rect x='5' y='7' width='14' height='11' rx='3' />
                    <path d='M12 3v4M9 12h.01M15 12h.01M9.5 15.5h5' />
                </svg>
            );
        case 'free-bots':
            return (
                <svg {...ico}>
                    <rect x='4' y='4' width='16' height='12' rx='2' />
                    <path d='M8 20h8M12 16v4M8.5 10.5l2 2 4-4.5' opacity='0.6' />
                </svg>
            );
        case 'premium-ai':
            return (
                <svg {...ico}>
                    <path d='M6 3h12l4 6-10 12L2 9z' />
                    <path d='M2 9h20M12 21 8 9l4-6 4 6-4 12' opacity='0.55' />
                </svg>
            );
        case 'quick-bot':
            return (
                <svg {...ico}>
                    <path d='M13 2 4 14h6l-1 8 9-12h-6z' />
                </svg>
            );
        case 'analysis-tools':
            return (
                <svg {...ico}>
                    <circle cx='11' cy='11' r='7' />
                    <path d='M20 20l-3.5-3.5' />
                </svg>
            );
        case 'hedging-tool':
            return (
                <svg {...ico}>
                    <path d='M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z' />
                    <path d='M9 12l2 2 4-4' />
                </svg>
            );
        case 'signal-ai':
            return (
                <svg {...ico}>
                    <circle cx='12' cy='12' r='8.5' />
                    <circle cx='12' cy='12' r='4' opacity='0.55' />
                    <path d='M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3' />
                </svg>
            );
        case 'manual-trader':
            return (
                <svg {...ico}>
                    <path d='M4 4l7 16 2-7 7-2z' />
                </svg>
            );
        case 'bulk-trader':
            return (
                <svg {...ico}>
                    <path d='M12 3 3 7.5 12 12l9-4.5z' />
                    <path d='M3 12.5 12 17l9-4.5M3 17.5 12 22l9-4.5' opacity='0.6' />
                </svg>
            );
        case 'apex-bot':
            return (
                <svg {...ico}>
                    <path d='M3 20h18L14.5 6 11 13l-2.5-4z' />
                </svg>
            );
        case 'copy-trader':
            return (
                <svg {...ico}>
                    <circle cx='9' cy='8' r='3.5' />
                    <circle cx='17' cy='9.5' r='2.5' opacity='0.6' />
                    <path d='M3.5 19c.8-3 3-4.5 5.5-4.5S13.7 16 14.5 19M15 14.5c2 .3 3.7 1.6 4.5 4' />
                </svg>
            );
        case 'speedbot':
            return (
                <svg {...ico}>
                    <path d='M4 15a8 8 0 1116 0' />
                    <path d='M12 15l4-5' />
                    <circle cx='12' cy='15' r='1.4' />
                </svg>
            );
        case 'automated':
            return (
                <svg {...ico}>
                    <circle cx='12' cy='12' r='3' />
                    <path d='M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' />
                </svg>
            );
        case 'chart':
            return (
                <svg {...ico}>
                    <rect x='3' y='4' width='18' height='13' rx='2' />
                    <path d='M7 13l3-4 3 2.5 4-5.5' />
                    <path d='M9 21h6' />
                </svg>
            );
        default:
            return (
                <svg {...ico}>
                    <circle cx='12' cy='12' r='8' />
                </svg>
            );
    }
};

const HubTabNav = ({ activeView, onSelect }: HubTabNavProps) => {
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
        node?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }, [activeView]);

    return (
        <nav className='hub-tabnav' role='tablist' aria-label='Sections'>
            <button type='button' className='hub-tabnav__filter' aria-label='Filters' title='Filters'>
                <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#ff5a5a' strokeWidth='2' strokeLinecap='round'>
                    <path d='M4 6h16M7 12h10M10 18h4' />
                </svg>
            </button>
            <div className='hub-tabnav__list' ref={listRef}>
                {HUB_TAB_ORDER.map(view => {
                    const active = activeView === view;
                    return (
                        <button
                            key={view}
                            type='button'
                            role='tab'
                            aria-selected={active}
                            data-active={active}
                            className={`hub-tabnav__item ${active ? 'hub-tabnav__item--active' : ''}`}
                            onClick={() => onSelect(view)}
                            title={HUB_VIEW_LABELS[view]}
                        >
                            <TabIcon view={view} />
                            <span className='hub-tabnav__label'>
                                {HUB_VIEW_LABELS[view]}
                                {(view === 'volt-ai' || view === 'auto-ai') && (
                                    <em className='hub-tabnav__ai' aria-hidden='true'>
                                        AI
                                    </em>
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
};

export default HubTabNav;
