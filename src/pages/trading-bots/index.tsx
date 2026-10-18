import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
    HUB_STRATEGIES,
    deployHubStrategy,
    type HubStrategy,
} from '@/pages/ai-trading-hub/deploy-strategy';
import { VERTEX_DIGITS, QUANTUM_EDGE } from '@/pages/quick-bot';
import { navigateToHubView } from '@/services/hub-navigation';
import { HubNote, HubPage, HubPageHeader } from '@/components/hub-page';
import './trading-bots.scss';

type CardBadge = 'QUICK' | 'PREMIUM' | 'FREE';

interface BotCard {
    id: string;
    name: string;
    description: string;
    kind: 'quick' | 'hub';
    badge: CardBadge;
    hubId?: string;
    preset?: 'vertex' | 'quantum';
}

/** Exact Free Bots grid from the reference app — 13 cards, this order. */
const REFERENCE_CARDS: BotCard[] = [
    { id: 'vertex', name: 'Vertex Digits', description: 'Quick Over/Under + Even/Odd analysis bot. Stake 1.0, recovery ×2, pattern gate after every 3 trades and a first-entry percentage check.', kind: 'quick', badge: 'QUICK', preset: 'vertex' },
    { id: 'digit_nexus', name: 'Digit Nexus AI', description: 'Premium digit-trend rider on Volatility 75. Three-tick Rise contracts with stake recovery.', kind: 'hub', badge: 'PREMIUM', hubId: 'digit_nexus' },
    { id: 'volt_scalper', name: '💥 Volt Scalper', description: 'Premium ultra-fast scalper. One-tick Rise contracts on Volatility 100 with aggressive recovery.', kind: 'hub', badge: 'PREMIUM', hubId: 'volt_scalper' },
    { id: 'apex_ai', name: 'Apex AI', description: 'Premium trend-following apex bot. Two-tick Rise contracts on Volatility 25.', kind: 'hub', badge: 'PREMIUM', hubId: 'apex_ai' },
    { id: 'neutrade', name: 'NEUTRADE AI', description: 'Premium neutral mean-reversion bot. One-minute Fall contracts on Volatility 50.', kind: 'hub', badge: 'PREMIUM', hubId: 'neutrade' },
    { id: 'straddle', name: 'STRADDLE EDGE', description: 'Premium breakout straddle. Two-tick Fall contracts on Boom 1000 Index.', kind: 'hub', badge: 'PREMIUM', hubId: 'straddle_edge' },
    { id: 'aurora', name: 'Aurora Parity Premium', description: 'Free parity momentum rider. One-tick Rise contracts on Volatility 100 (1s) Index.', kind: 'hub', badge: 'FREE', hubId: 'aurora' },
    { id: 'obsidian', name: 'Obsidian Parity Premium', description: 'Free dark-parity streak hunter. One-tick Fall contracts on Volatility 75 (1s) Index.', kind: 'hub', badge: 'FREE', hubId: 'obsidian' },
    { id: 'prism', name: 'Prism Extremes', description: 'Free extreme-digit prism. One-tick Rise contracts on Volatility 100 Index.', kind: 'hub', badge: 'FREE', hubId: 'prism' },
    { id: 'pulsetrader', name: 'Pulsetrader AI', description: 'Free pulse-riding momentum bot. Five-tick Rise contracts on Jump 100 Index.', kind: 'hub', badge: 'FREE', hubId: 'pulsetrader' },
    { id: 'titan', name: 'Titan Range', description: 'Free range-capping titan. One-tick Fall contracts on Volatility 50 Index.', kind: 'hub', badge: 'FREE', hubId: 'titan' },
    { id: 'zenith', name: 'Zenith Flow Premium', description: 'Free zenith flow rider. Two-tick Rise contracts on Volatility 25 (1s) Index.', kind: 'hub', badge: 'FREE', hubId: 'zenith' },
    { id: 'quantum', name: '🥉 Quantum Edge AI', description: 'Quick extreme-digit bot. Stake 0.8, recovery ×2, Over/Under on every trade plus a percentage reversal after every 3 trades.', kind: 'quick', badge: 'QUICK', preset: 'quantum' },
];

const TradingBotsPage = observer(() => {
    const [query, setQuery] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const cards = useMemo(() => REFERENCE_CARDS, []);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return cards;
        return cards.filter(card => card.name.toLowerCase().includes(needle));
    }, [cards, query]);

    const onLoad = async (card: BotCard) => {
        setError(null);
        setNotice(null);

        if (card.kind === 'quick') {
            const preset = card.preset === 'quantum' ? QUANTUM_EDGE : VERTEX_DIGITS;
            window.sessionStorage.setItem('quick-bot-preset', JSON.stringify(preset));
            navigateToHubView('quick-bot');
            setNotice(`${card.name} loaded into the Quick Bot form.`);
            return;
        }

        const strategy: HubStrategy | undefined = HUB_STRATEGIES.find(s => s.id === card.hubId);
        const workspace = window.Blockly?.derivWorkspace;
        if (!strategy || !workspace) {
            setError('The Bot Builder workspace is still loading — try again in a moment.');
            return;
        }

        setBusyId(card.id);
        try {
            await deployHubStrategy(strategy, workspace);
            if (workspace.getAllBlocks().length === 0) {
                throw new Error('Nothing landed in the workspace — check your connection and try again.');
            }
            navigateToHubView('bot-builder');
            setNotice(`${card.name} loaded into the Bot Builder. Press Run to start it — try it on a demo account first.`);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load this strategy into the builder.');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <HubPage className='bots-page'>
            <HubPageHeader
                title='Free Bots'
                subtitle='Load a ready-made strategy into the Bot Builder or open a Quick Bot preset. Nothing trades until you press Run.'
                actions={
                    <input
                        type='search'
                        className='hub-input bots-search'
                        placeholder='Search bots by name…'
                        aria-label='Search bots by name'
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                }
            />

            <div className='bots-toolbar'>
                <span className='bots-count'>
                    {visible.length} of {cards.length} bots
                </span>
            </div>

            <HubNote tone='info'>
                These entries are strategies and stake progressions — they change how your stake moves between
                trades, they do not predict the market. Nothing here guarantees profit. Loading a bot only fills
                the workspace: nothing trades until you press Run, and paper (demo) orders are the safe first step.
            </HubNote>

            {error && (
                <div className='bots-error' role='alert'>
                    {error}
                </div>
            )}
            {notice && (
                <div className='bots-notice' role='status'>
                    {notice}
                </div>
            )}

            {visible.length === 0 ? (
                <div className='bots-empty'>
                    <strong>No bots match &ldquo;{query.trim()}&rdquo;.</strong>
                    <span>Try a shorter search.</span>
                    <button type='button' className='hub-btn hub-btn--ghost' onClick={() => setQuery('')}>
                        Reset search
                    </button>
                </div>
            ) : (
                <div className='bots-grid'>
                    {visible.map(card => (
                        <article key={card.id} className='hub-panel hub-lift bots-card'>
                            <div className='bots-card__top'>
                                <h3>{card.name}</h3>
                                <div className='bots-card__tags'>
                                    <span className={`bots-card__badge bots-card__badge--${card.badge.toLowerCase()}`}>
                                        {card.badge}
                                    </span>
                                </div>
                            </div>
                            <p className='bots-card__desc'>{card.description}</p>
                            <div className='bots-card__foot'>
                                <button
                                    type='button'
                                    className='hub-btn hub-btn--primary bots-card__load'
                                    disabled={busyId !== null}
                                    onClick={() => onLoad(card)}
                                >
                                    {busyId === card.id ? 'Loading…' : 'LOAD BOT'}
                                </button>
                                <span className='bots-paper' title='Practise on a demo account before risking real funds.'>
                                    Try paper
                                </span>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </HubPage>
    );
});

export default TradingBotsPage;
