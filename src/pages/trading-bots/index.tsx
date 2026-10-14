import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { STRATEGIES } from '@/pages/bot-builder/quick-strategy/config';
import type { TDescriptionItem } from '@/pages/bot-builder/quick-strategy/types';
import {
    HUB_STRATEGIES,
    deployHubStrategy,
    type HubStrategy,
} from '@/pages/ai-trading-hub/deploy-strategy';
import dalembertExampleXml from '../../xml/dalembert.xml';
import martingaleExampleXml from '../../xml/martingale.xml';
import oscarsGrindExampleXml from '../../xml/oscars_grind.xml';
import './trading-bots.scss';

type LoadKind = 'quick' | 'hub' | 'xml' | 'manual';

interface BotCard {
    id: string;
    name: string;
    description: string;
    kind: LoadKind;
    quickKey?: string;
    hub?: HubStrategy;
    xml?: string;
    automated: boolean;
    popular?: boolean;
}

const CHIPS = ['All', 'Popular', 'Automated', 'Manual'] as const;
type Chip = (typeof CHIPS)[number];

/** Strip HTML from constant copy so cards stay plain text. */
const stripTags = (text: string) => text.replace(/<[^>]+>/g, '').trim();

const firstParagraph = (items?: TDescriptionItem[]): string => {
    const item = (items ?? []).find(entry => entry.type === 'text' && Boolean(entry.content?.[0]));
    return item?.content?.[0] ? stripTags(item.content[0]) : '';
};

const ACCUMULATOR_VARIANT: Record<string, string> = {
    MARTINGALE: 'Martingale',
    DALEMBERT: "D'Alembert",
    REVERSE_MARTINGALE: 'Reverse Martingale',
    REVERSE_DALEMBERT: "Reverse D'Alembert",
};

const accumulatorDescription = (key: string): string => {
    const variant = ACCUMULATOR_VARIANT[key.replace('ACCUMULATORS_', '').replace('_ON_STAT_RESET', '')] ?? 'stake';
    const reset = key.endsWith('_ON_STAT_RESET')
        ? ' The progression resets whenever the strategy statistics reset.'
        : '';
    return `Accumulator contracts stepped with a ${variant} stake progression — the stake steps between trades while the growth rate compounds per tick inside the range.${reset}`;
};

const POPULAR_QUICK = new Set(['MARTINGALE', 'D_ALEMBERT', 'OSCARS_GRIND']);
const POPULAR_HUB = new Set(['digit_nexus', 'volt_scalper', 'apex_ai']);

const buildCatalog = (): BotCard[] => {
    const quickCards: BotCard[] = Object.entries(STRATEGIES()).map(([key, strategy]) => {
        const isAccumulator = key.startsWith('ACCUMULATORS_');
        const isReset = key.endsWith('_ON_STAT_RESET');
        const capped = ['MARTINGALE', 'D_ALEMBERT', 'OSCARS_GRIND'].includes(key);
        const name = isAccumulator
            ? `Accumulators ${strategy.label}${isReset ? ' (stat reset)' : ''}`
            : capped
              ? `${strategy.label} (max stake)`
              : strategy.label;
        return {
            id: `quick_${key}`,
            name,
            description: firstParagraph(strategy.description) || accumulatorDescription(key),
            kind: 'quick',
            quickKey: key,
            automated: true,
            popular: POPULAR_QUICK.has(key),
        };
    });

    const hubCards: BotCard[] = HUB_STRATEGIES.map(strategy => ({
        id: `hub_${strategy.id}`,
        name: strategy.name,
        description: strategy.description,
        kind: 'hub',
        hub: strategy,
        automated: true,
        popular: POPULAR_HUB.has(strategy.id),
    }));

    const exampleCards: BotCard[] = [
        {
            id: 'xml_martingale',
            name: 'Martingale (classic)',
            description:
                'Example XML: doubles the stake after each loss on Rise/Fall contracts, with no maximum-stake cap. Load it and set your own cap before running.',
            kind: 'xml',
            xml: martingaleExampleXml,
            automated: true,
        },
        {
            id: 'xml_dalembert',
            name: "D'Alembert (classic)",
            description:
                'Example XML: adds one unit to the stake after a loss and steps it back down after a win, on Rise/Fall contracts.',
            kind: 'xml',
            xml: dalembertExampleXml,
            automated: true,
        },
        {
            id: 'xml_oscars_grind',
            name: "Oscar's Grind (classic)",
            description:
                'Example XML: grinds the stake up by one unit after a win and holds it after a loss, on Rise/Fall contracts.',
            kind: 'xml',
            xml: oscarsGrindExampleXml,
            automated: true,
        },
    ];

    const manualCards: BotCard[] = [
        {
            id: 'manual_builder',
            name: 'Build from scratch',
            description:
                'Open an empty Blockly workspace and wire the market, purchase and risk blocks together yourself.',
            kind: 'manual',
            automated: false,
        },
        {
            id: 'manual_quick_form',
            name: 'Quick Strategy form',
            description:
                'Fill in symbol, stake, duration and profit/loss thresholds yourself — the form writes the blocks for you.',
            kind: 'manual',
            automated: false,
        },
    ];

    return [...hubCards, ...quickCards, ...exampleCards, ...manualCards];
};

type EventsApi = {
    BlockCreate?: new (block: unknown) => unknown;
    fire?: (event: unknown) => void;
};

/**
 * The market block blanks dropdown values it does not recognise when it runs its
 * onchange handler during load. Firing a create event on every market block
 * repopulates them — the same trick deploy-strategy.ts uses.
 */
const replayMarketBlocks = (workspace: { getAllBlocks: () => { type: string }[] }) => {
    try {
        const events = (window.Blockly as unknown as { Events?: EventsApi }).Events;
        if (!events?.BlockCreate || !events.fire) return;
        workspace
            .getAllBlocks()
            .filter(block => block.type === 'trade_definition_market')
            .forEach(block => events.fire!(new events.BlockCreate!(block)));
    } catch {
        // Non-fatal: the fields are already baked into the XML.
    }
};

type Props = {
    /** Provided by the shell so Load can jump straight to the Bot Dashboard. */
    onOpenDashboard?: () => void;
};

const TradingBotsPage = observer(({ onOpenDashboard }: Props) => {
    const { dashboard, quick_strategy } = useStore() ?? {};
    const [query, setQuery] = useState('');
    const [chip, setChip] = useState<Chip>('All');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const cards = useMemo(buildCatalog, []);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return cards.filter(card => {
            const matchesChip =
                chip === 'All' ||
                (chip === 'Popular' && card.popular) ||
                (chip === 'Automated' && card.automated) ||
                (chip === 'Manual' && !card.automated);
            return matchesChip && (!needle || card.name.toLowerCase().includes(needle));
        });
    }, [cards, chip, query]);

    const openBuilderTab = () => {
        dashboard?.setActiveTab(DBOT_TABS.BOT_BUILDER);
        onOpenDashboard?.();
    };

    const loadXmlExample = async (xml: string, fileName: string) => {
        const workspace = window.Blockly?.derivWorkspace;
        if (!workspace) throw new Error('The Bot Dashboard workspace is still loading — try again in a moment.');
        const result = await load({
            block_string: xml,
            workspace,
            file_name: fileName,
            from: save_types.UNSAVED,
            drop_event: null,
            strategy_id: null,
            showIncompatibleStrategyDialog: null,
            show_snackbar: false,
        });
        if (result?.error) throw new Error(result.error);
        replayMarketBlocks(workspace);
    };

    const onLoad = async (card: BotCard) => {
        setError(null);
        setNotice(null);

        if (card.kind === 'manual') {
            if (card.id === 'manual_quick_form') quick_strategy?.setFormVisibility(true);
            openBuilderTab();
            setNotice(`${card.name} opened in the Bot Builder.`);
            return;
        }

        const workspace = window.Blockly?.derivWorkspace;
        if (!workspace) {
            setError('The Bot Dashboard workspace is still loading — try again in a moment.');
            return;
        }
        if (!quick_strategy && card.kind === 'quick') {
            setError('The Quick Strategy store is not ready yet — try again in a moment.');
            return;
        }

        setBusyId(card.id);
        try {
            if (card.kind === 'hub' && card.hub) {
                await deployHubStrategy(card.hub, workspace);
            } else if (card.kind === 'quick' && card.quickKey && quick_strategy) {
                quick_strategy.setSelectedStrategy(card.quickKey);
                // action 'EDIT' is the app's load-without-running path — the same
                // call the Quick Strategy form makes, minus the auto-start.
                await quick_strategy.onSubmit({ ...quick_strategy.form_data, action: 'EDIT' });
            } else if (card.kind === 'xml' && card.xml) {
                await loadXmlExample(card.xml, card.name);
            }

            if (workspace.getAllBlocks().length === 0) {
                throw new Error('Nothing landed in the workspace — check your connection and try again.');
            }

            openBuilderTab();
            setNotice(
                `${card.name} loaded into the Bot Builder. Press Run to start it — try it on a demo account first.`
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load this strategy into the builder.');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className='bots-page'>
            <header className='bots-head'>
                <div>
                    <h2>Trading Bots</h2>
                    <p className='bots-sub'>
                        A catalog of every strategy this app can load into the Bot Builder — quick-strategy
                        progressions, hub strategies and ready-made example XML.
                    </p>
                </div>
                <input
                    type='search'
                    className='bots-search'
                    placeholder='Search bots by name…'
                    aria-label='Search bots by name'
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                />
            </header>

            <div className='bots-chips' role='tablist' aria-label='Filter bots'>
                {CHIPS.map(option => (
                    <button
                        key={option}
                        type='button'
                        role='tab'
                        aria-selected={chip === option}
                        className={`bots-chip ${chip === option ? 'bots-chip--on' : ''}`}
                        onClick={() => setChip(option)}
                    >
                        {option}
                    </button>
                ))}
                <span className='bots-count'>
                    {visible.length} of {cards.length} bots
                </span>
            </div>

            <div className='bots-note' role='note'>
                These entries are strategies and stake progressions — they change how your stake moves between
                trades, they do not predict the market. Nothing here guarantees profit. Loading a bot only fills
                the workspace: nothing trades until you press Run, and paper (demo) orders are the safe first step.
            </div>

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
                    <strong>No bots match &ldquo;{query.trim() || chip}&rdquo;.</strong>
                    <span>Try a shorter search, or switch the category back to All.</span>
                    <button
                        type='button'
                        className='bots-btn'
                        onClick={() => {
                            setQuery('');
                            setChip('All');
                        }}
                    >
                        Reset filters
                    </button>
                </div>
            ) : (
                <div className='bots-grid'>
                    {visible.map(card => (
                        <article key={card.id} className='bots-card'>
                            <div className='bots-card__top'>
                                <h3>{card.name}</h3>
                                <div className='bots-card__tags'>
                                    {card.popular && <span className='bots-tag bots-tag--hot'>Popular</span>}
                                    <span className='bots-tag'>{card.automated ? 'Automated' : 'Manual'}</span>
                                </div>
                            </div>
                            <p className='bots-card__desc'>{card.description}</p>
                            <div className='bots-card__foot'>
                                <button
                                    type='button'
                                    className='bots-load'
                                    disabled={busyId !== null}
                                    onClick={() => onLoad(card)}
                                >
                                    {busyId === card.id
                                        ? 'Loading…'
                                        : card.kind === 'manual'
                                          ? 'Open builder'
                                          : 'Load'}
                                </button>
                                <span
                                    className='bots-paper'
                                    title='Practise on a demo account before risking real funds.'
                                >
                                    Try paper
                                </span>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
});

export default TradingBotsPage;
