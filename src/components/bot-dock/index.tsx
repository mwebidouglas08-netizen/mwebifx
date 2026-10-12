import { useState } from 'react';
import { HUB_STRATEGIES, deployHubStrategy, type HubStrategy } from '@/pages/ai-trading-hub/deploy-strategy';
import './bot-dock.scss';

export type DockView = 'dashboard' | 'ai-hub' | 'ai-scanner' | 'ou-bot';

interface BotDockProps {
    onNavigate: (view: DockView) => void;
}

// Real multi-market / EV engines built in-app.
const AI_BOTS: { id: string; name: string; blurb: string; view: DockView; icon: string }[] = [
    { id: 'ai_scanner', name: 'AI Signal Scanner', blurb: 'Multi-market statistical scanner', view: 'ai-scanner', icon: '📈' },
    { id: 'ou_bot', name: 'Over / Under Bot', blurb: 'Expected-value digit bot', view: 'ou-bot', icon: '🎯' },
];

// Named strategy bots (deploy real Blockly strategies into the Bot Dashboard).
const STRATEGY_IDS = ['digit_nexus', 'volt_scalper', 'apex_ai', 'neutrade', 'straddle_edge', 'pulsetrader'];
const STRATEGY_ICONS: Record<string, string> = {
    digit_nexus: '🧬',
    volt_scalper: '⚡',
    apex_ai: '🔺',
    neutrade: '⚖️',
    straddle_edge: '📊',
    pulsetrader: '💹',
};

const BotDock = ({ onNavigate }: BotDockProps) => {
    const [open, setOpen] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);

    const strategyBots = HUB_STRATEGIES.filter(s => STRATEGY_IDS.includes(s.id));

    const launchAi = (view: DockView) => {
        onNavigate(view);
        setOpen(false);
    };

    const launchStrategy = async (strategy: HubStrategy) => {
        const workspace = (window as any).Blockly?.derivWorkspace;
        if (!workspace) {
            setFlash('Bot Dashboard is still loading — try again in a second.');
            setTimeout(() => setFlash(null), 2600);
            return;
        }
        try {
            await deployHubStrategy(strategy, workspace);
            onNavigate('dashboard');
            setOpen(false);
            setFlash(`${strategy.name} deployed to the Bot Dashboard.`);
        } catch (e: any) {
            setFlash(e?.message || 'Could not deploy strategy.');
        }
        setTimeout(() => setFlash(null), 2600);
    };

    return (
        <div className={`bot-dock ${open ? 'bot-dock--open' : ''}`}>
            {flash && <div className='bot-dock__flash' role='status'>{flash}</div>}

            {open && (
                <>
                    <div className='bot-dock__scrim' onClick={() => setOpen(false)} />
                    <div className='bot-dock__panel' role='menu' aria-label='Trading bots'>
                        <div className='bot-dock__header'>
                            <span>Trading Bots</span>
                            <button type='button' className='bot-dock__close' onClick={() => setOpen(false)} aria-label='Close'>×</button>
                        </div>

                        <p className='bot-dock__section'>AI engines</p>
                        <div className='bot-dock__grid'>
                            {AI_BOTS.map(bot => (
                                <button
                                    key={bot.id}
                                    type='button'
                                    className='bot-dock__card bot-dock__card--ai'
                                    onClick={() => launchAi(bot.view)}
                                >
                                    <span className='bot-dock__card-icon'>{bot.icon}</span>
                                    <span className='bot-dock__card-name'>{bot.name}</span>
                                    <span className='bot-dock__card-blurb'>{bot.blurb}</span>
                                </button>
                            ))}
                        </div>

                        <p className='bot-dock__section'>Strategy bots</p>
                        <div className='bot-dock__grid'>
                            {strategyBots.map(bot => (
                                <button
                                    key={bot.id}
                                    type='button'
                                    className='bot-dock__card'
                                    onClick={() => launchStrategy(bot)}
                                >
                                    <span className='bot-dock__card-icon'>{STRATEGY_ICONS[bot.id] || '🤖'}</span>
                                    <span className='bot-dock__card-name'>{bot.name}</span>
                                    <span className='bot-dock__card-blurb'>{bot.description}</span>
                                    <span className={`bot-dock__risk bot-dock__risk--${bot.risk.toLowerCase().replace(' ', '')}`}>{bot.risk}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}

            <button
                type='button'
                className='bot-dock__fab'
                onClick={() => setOpen(o => !o)}
                aria-label={open ? 'Close bot launcher' : 'Open bot launcher'}
                aria-expanded={open}
            >
                <span className='bot-dock__fab-icon'>{open ? '×' : '🤖'}</span>
                {!open && <span className='bot-dock__fab-ping' />}
            </button>
        </div>
    );
};

export default BotDock;
