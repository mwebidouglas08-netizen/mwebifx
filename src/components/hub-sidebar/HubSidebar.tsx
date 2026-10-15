import { useEffect, useState } from 'react';
import './hub-sidebar.scss';

export type HubViewId =
    | 'ai-hub'
    | 'dashboard'
    | 'ou-bot'
    | 'bulk-trader'
    | 'copy-trading'
    | 'trading-bots'
    | 'ai-scanner'
    | 'pro-ai'
    | 'dual-edge'
    | 'algo-pro-ai'
    | 'backtest'
    | 'analysis-tool'
    | 'tradingview';

export const HUB_VIEW_LABELS: Record<HubViewId, string> = {
    'ai-hub': 'AI Trading Hub',
    dashboard: 'Bot Dashboard',
    'ou-bot': 'Over / Under Bot',
    'bulk-trader': 'Bulk Trader',
    'copy-trading': 'Copy Trading',
    'trading-bots': 'Trading Bots',
    'ai-scanner': 'AI Signal Scanner',
    'pro-ai': 'Pro AI',
    'dual-edge': 'Dual Edge',
    'algo-pro-ai': 'Algo Pro AI',
    backtest: 'Backtest',
    'analysis-tool': 'Analysis Tool',
    tradingview: 'TradingView',
};

/** Compact stroke icons for the sidebar nav (currentColor, 1.8 stroke). */
const HubIcon = ({ name }: { name: HubViewId }) => {
    const common = {
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
    switch (name) {
        case 'ai-hub':
            return (
                <svg {...common}>
                    <path d='M3 17l5-6 4 4 6-8 3 4' />
                    <path d='M3 21h18' opacity='0.45' />
                </svg>
            );
        case 'dashboard':
            return (
                <svg {...common}>
                    <rect x='3' y='12' width='4' height='9' rx='1' />
                    <rect x='10' y='7' width='4' height='14' rx='1' />
                    <rect x='17' y='3' width='4' height='18' rx='1' opacity='0.55' />
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
        case 'trading-bots':
            return (
                <svg {...common}>
                    <rect x='4' y='4' width='16' height='12' rx='2' />
                    <path d='M8 20h8M12 16v4' />
                    <path d='M8.5 10.5l2 2 4-4.5' opacity='0.55' />
                </svg>
            );
        case 'pro-ai':
            return (
                <svg {...common}>
                    <path d='M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z' />
                    <path d='M18.5 15.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z' opacity='0.55' />
                </svg>
            );
        case 'dual-edge':
            return (
                <svg {...common}>
                    <path d='M4 8h13l-3-3M20 16H7l3 3' />
                    <circle cx='12' cy='12' r='9' opacity='0.4' />
                </svg>
            );
        case 'algo-pro-ai':
            return (
                <svg {...common}>
                    <path d='M12 2.5l7.5 4.3v8.4L12 19.5 4.5 15.2V6.8z' />
                    <path d='M12 8.5l3.5 2v4L12 16.5 8.5 14.5v-4z' opacity='0.55' />
                </svg>
            );
        case 'bulk-trader':
            return (
                <svg {...common}>
                    <rect x='3' y='3' width='7' height='7' rx='1.4' />
                    <rect x='14' y='3' width='7' height='7' rx='1.4' opacity='0.55' />
                    <rect x='3' y='14' width='7' height='7' rx='1.4' opacity='0.55' />
                    <rect x='14' y='14' width='7' height='7' rx='1.4' />
                </svg>
            );
        case 'copy-trading':
            return (
                <svg {...common}>
                    <circle cx='9' cy='8' r='3.2' />
                    <path d='M3.5 19c.6-3 2.8-4.5 5.5-4.5S13.9 16 14.5 19' />
                    <path d='M16 6.5h5M18.5 4v5' opacity='0.55' />
                </svg>
            );
        case 'analysis-tool':
            return (
                <svg {...common}>
                    <circle cx='11' cy='11' r='6.5' />
                    <path d='M16 16l4.5 4.5' />
                    <path d='M8 12l2-2.5 2 1.5 2-3' opacity='0.55' />
                </svg>
            );
        case 'tradingview':
            return (
                <svg {...common}>
                    <path d='M4 20V10M9 20V6M14 20v-8M19 20V4' />
                    <path d='M3 20h18' opacity='0.45' />
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

interface NavSection {
    caption: string;
    items: { id: HubViewId; hint: string }[];
}

/** Grouped navigation IA — workspace, trading engines, AI tools, analytics. */
export const HUB_NAV_SECTIONS: NavSection[] = [
    {
        caption: 'Workspace',
        items: [
            { id: 'ai-hub', hint: 'Live markets & strategies' },
            { id: 'dashboard', hint: 'Blockly workspace' },
        ],
    },
    {
        caption: 'Trading',
        items: [
            { id: 'ou-bot', hint: 'Digit edge engine' },
            { id: 'bulk-trader', hint: 'N parallel contracts' },
            { id: 'copy-trading', hint: 'Mirror a master account' },
            { id: 'trading-bots', hint: 'Bot catalog — load into builder' },
        ],
    },
    {
        caption: 'AI Tools',
        items: [
            { id: 'ai-scanner', hint: 'Multi-family signals' },
            { id: 'pro-ai', hint: 'Ranked digit-entry scanner' },
            { id: 'dual-edge', hint: 'Two-sided recovery engine' },
            { id: 'algo-pro-ai', hint: 'All-market AI scanner + auto-trade' },
        ],
    },
    {
        caption: 'Analytics',
        items: [
            { id: 'backtest', hint: 'Validate on history' },
            { id: 'analysis-tool', hint: 'Digits, RSI, MACD, bands' },
            { id: 'tradingview', hint: 'External chart embed' },
        ],
    },
];

const COLLAPSED_KEY = 'mwx_nav_collapsed';

const readCollapsed = (): boolean => {
    try {
        return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
};

interface HubSidebarProps {
    activeView: HubViewId;
    onSelect: (view: HubViewId) => void;
    isDarkMode: boolean;
    onToggleTheme: () => void;
    isMobileOpen: boolean;
    onRequestClose: () => void;
}

const HubSidebar = ({
    activeView,
    onSelect,
    isDarkMode,
    onToggleTheme,
    isMobileOpen,
    onRequestClose,
}: HubSidebarProps) => {
    const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

    // Esc closes the mobile drawer (desktop rail has no overlay to dismiss).
    useEffect(() => {
        if (!isMobileOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onRequestClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isMobileOpen, onRequestClose]);

    const toggleCollapsed = () => {
        setCollapsed(prev => {
            const next = !prev;
            try {
                localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
            } catch {
                /* private mode */
            }
            return next;
        });
    };

    const handleSelect = (view: HubViewId) => {
        onSelect(view);
        onRequestClose();
    };

    return (
        <>
            <div
                className={`hub-sidebar__backdrop ${isMobileOpen ? 'hub-sidebar__backdrop--visible' : ''}`}
                onClick={onRequestClose}
                aria-hidden='true'
            />
            <nav
                className={[
                    'hub-sidebar',
                    collapsed ? 'hub-sidebar--collapsed' : '',
                    isMobileOpen ? 'hub-sidebar--open' : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
                role='navigation'
                aria-label='Workspace navigation'
            >
                <div className='hub-sidebar__brand'>
                    <span className='hub-sidebar__mark' aria-hidden='true'>
                        M
                    </span>
                    <span className='hub-sidebar__wordmark'>Mwebifx</span>
                    <button
                        type='button'
                        className='hub-sidebar__collapse'
                        onClick={toggleCollapsed}
                        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        <svg
                            width='14'
                            height='14'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            aria-hidden='true'
                        >
                            <path d='M15 6l-6 6 6 6' />
                        </svg>
                    </button>
                </div>

                <div className='hub-sidebar__scroll'>
                    {HUB_NAV_SECTIONS.map(section => (
                        <div className='hub-sidebar__section' key={section.caption}>
                            <p className='hub-sidebar__caption'>{section.caption}</p>
                            {section.items.map(item => {
                                const active = activeView === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        type='button'
                                        className={`hub-sidebar__item ${active ? 'hub-sidebar__item--active' : ''}`}
                                        onClick={() => handleSelect(item.id)}
                                        aria-current={active ? 'page' : undefined}
                                        title={collapsed ? HUB_VIEW_LABELS[item.id] : item.hint}
                                    >
                                        <span className='hub-sidebar__item-icon'>
                                            <HubIcon name={item.id} />
                                        </span>
                                        <span className='hub-sidebar__item-label'>{HUB_VIEW_LABELS[item.id]}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>

                <div className='hub-sidebar__footer'>
                    <button
                        type='button'
                        className='hub-sidebar__theme'
                        onClick={onToggleTheme}
                        aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                        title={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                    >
                        {isDarkMode ? (
                            <svg
                                width='15'
                                height='15'
                                viewBox='0 0 24 24'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth='1.9'
                                strokeLinecap='round'
                                aria-hidden='true'
                            >
                                <circle cx='12' cy='12' r='4.2' />
                                <path d='M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6' />
                            </svg>
                        ) : (
                            <svg
                                width='15'
                                height='15'
                                viewBox='0 0 24 24'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth='1.9'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                aria-hidden='true'
                            >
                                <path d='M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z' />
                            </svg>
                        )}
                        <span className='hub-sidebar__theme-label'>{isDarkMode ? 'Light' : 'Dark'}</span>
                    </button>
                    <p className='hub-sidebar__note'>Trade responsibly · demo first</p>
                </div>
            </nav>
        </>
    );
};

export default HubSidebar;
