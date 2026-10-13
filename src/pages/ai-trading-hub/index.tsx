import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { transaction_elements } from '@/constants/transactions';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { computeRsi, useLivePrices } from './use-live-data';
import HubAccountSwitcher from './account-switcher';
import { HUB_STRATEGIES, deployHubStrategy, type HubStrategy } from './deploy-strategy';
import './ai-trading-hub.scss';

/**
 * Turn an engine rejection into something a user can act on. The bot skeleton
 * throws plain strings, Error instances and Deriv API error objects
 * (`{ error: { code, message } }`), and the hub is the only surface that shows
 * them, so normalise all three.
 */
const humaniseEngineError = (error: unknown, fallback: string): string => {
    if (!error) return fallback;
    if (typeof error === 'string' && error.trim()) return error;
    const err = error as { message?: unknown; error?: { message?: unknown; code?: unknown } };
    const nested = err?.error?.message;
    const code = err?.error?.code;
    if (typeof nested === 'string' && nested.trim()) {
        return code ? `${nested} (${code})` : nested;
    }
    if (typeof err?.message === 'string' && err.message.trim()) return err.message;
    return fallback;
};

interface MarketData {
    symbol: string;
    name: string;
    category: 'synthetic' | 'forex';
    price: number | null;
    change: number;
    changePercent: number;
    samples: number;
    high: number;
    low: number;
    rsi: number;
    signal: 'BUY' | 'SELL' | 'HOLD';
    /** Heuristic signal-strength score (0–97), not a probability or win-rate. */
    confidence: number;
    trend: 'up' | 'down' | 'sideways';
}

const RISK_ORDER: Record<HubStrategy['risk'], number> = { 'Very Low': 0, Low: 1, Medium: 2, High: 3 };

/** Minimum signal strength before Auto Trading will place a trade. */
const AUTO_TRADE_CONFIDENCE = 70;
/** Minimum gap between automated deployments, in ms. */
const AUTO_TRADE_COOLDOWN_MS = 60000;

interface Trade {
    id: string;
    time: string;
    symbol: string;
    type: 'BUY' | 'SELL';
    amount: number;
    price: number;
    profit: number;
    status: 'open' | 'closed';
}

/** Curated, de-duplicated market list — one entry per symbol. */
const MARKET_CATALOG: { symbol: string; name: string; category: 'synthetic' | 'forex' }[] = [
    { symbol: 'R_100', name: 'Volatility 100 Index', category: 'synthetic' },
    { symbol: 'R_75', name: 'Volatility 75 Index', category: 'synthetic' },
    { symbol: 'R_50', name: 'Volatility 50 Index', category: 'synthetic' },
    { symbol: 'R_25', name: 'Volatility 25 Index', category: 'synthetic' },
    { symbol: 'R_10', name: 'Volatility 10 Index', category: 'synthetic' },
    { symbol: '1HZ100V', name: 'Jump 100 Index', category: 'synthetic' },
    { symbol: '1HZ75V', name: 'Jump 75 Index', category: 'synthetic' },
    { symbol: '1HZ50V', name: 'Jump 50 Index', category: 'synthetic' },
    { symbol: '1HZ25V', name: 'Jump 25 Index', category: 'synthetic' },
    { symbol: '1HZ10V', name: 'Jump 10 Index', category: 'synthetic' },
    { symbol: 'BOOM300N', name: 'Boom 300 Index', category: 'synthetic' },
    { symbol: 'BOOM500', name: 'Boom 500 Index', category: 'synthetic' },
    { symbol: 'BOOM1000', name: 'Boom 1000 Index', category: 'synthetic' },
    { symbol: 'CRASH300N', name: 'Crash 300 Index', category: 'synthetic' },
    { symbol: 'CRASH500', name: 'Crash 500 Index', category: 'synthetic' },
    { symbol: 'CRASH1000', name: 'Crash 1000 Index', category: 'synthetic' },
    { symbol: 'stpRNG', name: 'Step Index', category: 'synthetic' },
    { symbol: 'frxEURUSD', name: 'EUR/USD', category: 'forex' },
    { symbol: 'frxGBPUSD', name: 'GBP/USD', category: 'forex' },
    { symbol: 'frxUSDJPY', name: 'USD/JPY', category: 'forex' },
    { symbol: 'frxAUDUSD', name: 'AUD/USD', category: 'forex' },
    { symbol: 'frxUSDCAD', name: 'USD/CAD', category: 'forex' },
    { symbol: 'frxEURGBP', name: 'EUR/GBP', category: 'forex' },
    { symbol: 'frxUSDCHF', name: 'USD/CHF', category: 'forex' },
    { symbol: 'frxNZDUSD', name: 'NZD/USD', category: 'forex' },
    { symbol: 'frxEURJPY', name: 'EUR/JPY', category: 'forex' },
    { symbol: 'frxGBPJPY', name: 'GBP/JPY', category: 'forex' },
    { symbol: 'frxAUDJPY', name: 'AUD/JPY', category: 'forex' },
];

type MarketFilter = 'all' | 'synthetic' | 'forex';

type TProps = {
    onOpenDashboard?: () => void;
};

const AITradingHub: React.FC<TProps> = observer(({ onOpenDashboard }) => {
    const store = useStore();
    const { is_dark_mode_on, setTheme } = useThemeSwitcher();

    const [selectedTab, setSelectedTab] = useState<'overview' | 'markets' | 'bots' | 'trades' | 'strategies'>('overview');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisLog, setAnalysisLog] = useState<string[]>([]);
    const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
    const [riskLevel, setRiskLevel] = useState<'low' | 'medium' | 'high'>('medium');
    const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
    const [marketQuery, setMarketQuery] = useState('');
    const [notice, setNotice] = useState<string>('');
    const [isDeploying, setIsDeploying] = useState(false);
    const autoTradeCooldownRef = useRef(0);

    const symbols = useMemo(() => MARKET_CATALOG.map(m => m.symbol), []);
    const { quotes, buffers } = useLivePrices(symbols);

    const runPanel = store?.run_panel;
    const transactions = store?.transactions;
    const client = store?.client;
    // `is_running` alone is misleading: the engine flips it back to false as
    // soon as the tick stream is ready (run-panel-store.ts onBotReadyEvent),
    // even though the bot keeps trading until an open contract closes.
    // `is_stop_button_visible` is the state the dashboard itself uses to mean
    // "a bot is live", so the hub must use the same one — otherwise Start
    // re-enables and Stop disables while a trade is genuinely running.
    const isEngineRunning = Boolean(runPanel?.is_stop_button_visible);
    const isLoggedIn = Boolean(client?.is_logged_in);

    const flashNotice = useCallback((message: string) => {
        setNotice(message);
        window.setTimeout(() => setNotice(current => (current === message ? '' : current)), 6000);
    }, []);

    const startEngine = useCallback(() => {
        if (!isLoggedIn) {
            flashNotice('Log in to start automated trading.');
            runPanel?.showLoginDialog?.();
            return;
        }
        // The engine rejects an incomplete workspace by returning silently from
        // onRunButtonClick, and it writes the reason into the Journal drawer,
        // which is hidden while the hub is showing. Pre-check here so the hub
        // can explain the rejection on its own surface.
        if (runPanel?.dbot && typeof runPanel.dbot.shouldRunBot === 'function' && !runPanel.dbot.shouldRunBot()) {
            flashNotice(
                'Strategy incomplete — open Bot Dashboard and set a market, trade type, duration and purchase block, then run again.'
            );
            return;
        }
        // Surface failures instead of swallowing them. The dashboard writes
        // errors into its Journal drawer, which is display:none while the hub
        // owns the screen, so a dropped rejection here was completely silent.
        try {
            const result = runPanel?.onRunButtonClick?.();
            Promise.resolve(result).catch((error: unknown) => {
                flashNotice(humaniseEngineError(error, 'The bot could not start.'));
            });
        } catch (error) {
            flashNotice(humaniseEngineError(error, 'The bot could not start.'));
        }
    }, [runPanel, isLoggedIn, flashNotice]);

    const stopEngine = useCallback(() => {
        try {
            const result = runPanel?.onStopButtonClick?.();
            Promise.resolve(result).catch((error: unknown) => {
                flashNotice(humaniseEngineError(error, 'The bot could not be stopped.'));
            });
        } catch (error) {
            flashNotice(humaniseEngineError(error, 'The bot could not be stopped.'));
        }
    }, [runPanel, flashNotice]);

    const markets: MarketData[] = useMemo(
        () =>
            MARKET_CATALOG.map(market => {
                const quote = quotes[market.symbol];
                const price = quote?.price ?? null;
                const changePercent = quote?.changePercent ?? 0;
                const rsi = computeRsi(buffers.current[market.symbol] || []);
                const isStreaming = price !== null;
                const isFlat = !isStreaming || Math.abs(changePercent) < 0.15;

                let signal: MarketData['signal'] = 'HOLD';
                if (!isFlat) signal = changePercent > 0 ? 'BUY' : 'SELL';
                else if (rsi >= 70) signal = 'SELL';
                else if (rsi <= 30) signal = 'BUY';

                const confidence = !isStreaming
                    ? 0
                    : Math.min(97, Math.round(Math.abs(changePercent) * 20 + Math.abs(rsi - 50) + 45));

                return {
                    symbol: market.symbol,
                    name: market.name,
                    category: market.category,
                    price,
                    change: quote?.change ?? 0,
                    changePercent,
                    samples: quote?.samples ?? 0,
                    high: quote?.high ?? 0,
                    low: quote?.low ?? 0,
                    rsi,
                    signal,
                    confidence,
                    trend: isFlat ? 'sideways' : changePercent > 0 ? 'up' : 'down',
                };
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [quotes, buffers.current]
    );

    const visibleMarkets = useMemo(() => {
        const query = marketQuery.trim().toLowerCase();
        return markets.filter(market => {
            if (marketFilter !== 'all' && market.category !== marketFilter) return false;
            if (!query) return true;
            return (
                market.symbol.toLowerCase().includes(query) || market.name.toLowerCase().includes(query)
            );
        });
    }, [markets, marketFilter, marketQuery]);

    const statistics = transactions?.statistics;
    const trades: Trade[] = useMemo(() => {
        const list: Trade[] = [];
        for (const entry of transactions?.transactions ?? []) {
            if (entry.type !== transaction_elements.CONTRACT) continue;
            const contract = entry.data;
            if (!contract || typeof contract !== 'object') continue;
            const contractType = String(contract.contract_type ?? '');
            list.push({
                id: String(contract.contract_id ?? list.length),
                time: String(contract.date_start ?? ''),
                symbol: String(contract.underlying_symbol ?? ''),
                type: contractType.includes('PUT') ? 'SELL' : 'BUY',
                amount: Number(contract.buy_price) || 0,
                price: Number(contract.entry_tick) || 0,
                profit: Number(contract.profit) || 0,
                status: contract.is_completed ? 'closed' : 'open',
            });
        }
        return list;
    }, [transactions?.transactions]);

    const totalProfit = Number(statistics?.total_profit) || 0;
    const totalRuns = Number(statistics?.number_of_runs) || 0;
    const winRate = totalRuns > 0 ? (Number(statistics?.won_contracts) / totalRuns) * 100 : 0;
    const streamingCount = markets.filter(m => m.price !== null).length;

    const runAnalysis = useCallback(() => {
        setIsAnalyzing(true);
        setAnalysisLog([]);

        // Real technical analysis over the live Deriv tick stream: the prices
        // come from use-live-data's WebSocket and the RSI is a genuine Wilder
        // RSI over the sampled buffer. There is no predictive model behind it,
        // so the log says what it actually did rather than implying otherwise.
        const lines: string[] = [];
        lines.push(`[scan] Subscribed to ${markets.length} live Deriv markets (${streamingCount} streaming).`);

        const actionable = markets
            .filter(m => m.price !== null)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 6);

        actionable.forEach(market => {
            const zone = market.rsi > 60 ? 'overbought' : market.rsi < 40 ? 'oversold' : 'neutral';
            lines.push(
                `[scan] ${market.symbol} @ ${market.price!.toFixed(market.price! < 10 ? 5 : 2)} | ` +
                    `${market.changePercent >= 0 ? '+' : ''}${market.changePercent.toFixed(2)}% | ` +
                    `RSI ${market.rsi.toFixed(1)} (${zone}) → ${market.signal} ${market.confidence}% strength`
            );
        });

        const setups = markets.filter(m => m.price !== null && m.signal !== 'HOLD');
        lines.push(`[scan] ${setups.length} actionable setup(s) across ${streamingCount} live markets.`);
        lines.push(
            `[scan] Risk profile set to ${riskLevel}. ` +
                (isLoggedIn
                    ? isEngineRunning
                        ? 'Engine is running.'
                        : 'Auto Trading will start the engine when a setup appears.'
                    : 'Log in to let the engine place trades.')
        );

        const top = actionable[0];

        const fetchRationale = async (): Promise<string | null> => {
            if (!top) return null;
            try {
                const res = await fetch('/api/ai-rationale', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: top.symbol,
                        direction: top.signal,
                        strength: top.confidence,
                        rsi: top.rsi,
                        changePercent: top.changePercent,
                    }),
                });
                if (!res.ok) return null;
                const data = await res.json();
                if (typeof data?.rationale === 'string' && data.rationale) {
                    return `[ai] ${data.rationale}`;
                }
                return null;
            } catch {
                return null;
            }
        };

        let index = 0;
        const timer = window.setInterval(() => {
            const line = lines[index];
            if (line !== undefined) {
                setAnalysisLog(prev => [...prev, line]);
                index += 1;
            } else {
                window.clearInterval(timer);
                // After the local scan log is revealed, optionally pull a genuine
                // LLM rationale for the top setup from the serverless function.
                // If it is unavailable we append nothing (no fabrication).
                void fetchRationale().then(rationale => {
                    if (rationale) setAnalysisLog(prev => [...prev, rationale]);
                    setIsAnalyzing(false);
                });
            }
        }, 220);
    }, [markets, streamingCount, riskLevel, isLoggedIn, isEngineRunning]);

    /**
     * Auto trading: when enabled, act on a genuine signal from the live feed.
     *
     * A setup is a streaming market whose RSI/direction heuristic produced a
     * BUY or SELL above the confidence floor. When one appears and the engine is
     * idle, the matching strategy is loaded into Blockly and the engine is
     * started — the same path a human pressing Deploy then Start would take.
     */
    useEffect(() => {
        if (!autoTradeEnabled || !isLoggedIn || isEngineRunning || isDeploying || isAnalyzing) return;
        const now = Date.now();
        if (now < autoTradeCooldownRef.current) return;

        const best = markets
            .filter(m => m.price !== null && m.signal !== 'HOLD' && m.confidence >= AUTO_TRADE_CONFIDENCE)
            .sort((a, b) => b.confidence - a.confidence)[0];
        if (!best) return;

        const wantsRise = best.signal === 'BUY';
        const strategy = HUB_STRATEGIES.find(s => s.symbol === best.symbol && (s.direction === 'CALL') === wantsRise);
        if (!strategy) return;

        // Space out automated deployments so a flat market cannot queue a
        // string of identical trades.
        autoTradeCooldownRef.current = now + AUTO_TRADE_COOLDOWN_MS;

        let cancelled = false;
        (async () => {
            try {
                await deployHubStrategy(strategy, window.Blockly?.derivWorkspace);
                if (cancelled) return;
                flashNotice(
                    `Auto Trading: ${best.symbol} ${best.signal} at ${best.confidence}% signal strength — running ${strategy.name}.`
                );
                const result = runPanel?.onRunButtonClick?.();
                Promise.resolve(result).catch((error: unknown) => {
                    if (!cancelled) flashNotice(humaniseEngineError(error, 'Auto Trading could not start the bot.'));
                });
            } catch (error) {
                if (!cancelled) {
                    flashNotice(humaniseEngineError(error, 'Auto Trading could not load a strategy.'));
                }
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoTradeEnabled, isLoggedIn, isEngineRunning, isDeploying, isAnalyzing, markets, runPanel]);

    const toggleAutoTrade = useCallback(() => {
        const next = !autoTradeEnabled;
        setAutoTradeEnabled(next);
        if (next && !isLoggedIn) {
            flashNotice('Log in to enable Auto Trading.');
            runPanel?.showLoginDialog?.();
            return;
        }
        if (next) {
            flashNotice('Auto Trading on — it will act when a setup appears on a live market.');
        } else {
            flashNotice('Auto Trading off.');
        }
    }, [autoTradeEnabled, isLoggedIn, runPanel, flashNotice]);

    const deployStrategy = useCallback(
        async (strategy: HubStrategy) => {
            const exceedsRisk =
                (riskLevel === 'low' && RISK_ORDER[strategy.risk] > 1) ||
                (riskLevel === 'medium' && RISK_ORDER[strategy.risk] > 3);
            if (exceedsRisk) {
                flashNotice(`${strategy.name} is ${strategy.risk} risk — raise the Risk setting to deploy it.`);
                return;
            }
            if (!isLoggedIn) {
                flashNotice('Log in first — then deploy a strategy and press Run on the Bot Dashboard.');
                runPanel?.showLoginDialog?.();
                return;
            }
            const workspace = window.Blockly?.derivWorkspace;
            if (!workspace) {
                flashNotice('The Bot Dashboard workspace is still loading. Try again in a moment.');
                return;
            }

            setIsDeploying(true);
            try {
                await deployHubStrategy(strategy, workspace);
                flashNotice(
                    `${strategy.name} loaded onto the Bot Dashboard (${strategy.symbol}, ${strategy.direction}, ${strategy.duration}${strategy.durationUnit}). Press Start to trade it.`
                );
                onOpenDashboard?.();
            } catch (error) {
                flashNotice(humaniseEngineError(error, `${strategy.name} could not be loaded onto the Bot Dashboard.`));
            } finally {
                setIsDeploying(false);
            }
        },
        [riskLevel, isLoggedIn, flashNotice, onOpenDashboard, runPanel]
    );

    const formatPrice = (value: number | null) => (value === null ? '—' : value.toFixed(value < 10 ? 5 : 2));
    const signPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

    return (
        <div className='ai-trading-hub'>
            <div className='hub-header'>
                <div className='hub-title'>
                    <h1>AI Trading Hub</h1>
                    <p>Live Deriv market data, RSI signals and automated strategy execution</p>
                </div>

                <div className='hub-controls'>
                    <div className='engine-status'>
                        <span className={`engine-dot ${isEngineRunning ? 'on' : 'off'}`} />
                        {isEngineRunning ? 'Engine running' : 'Engine idle'}
                        {!isLoggedIn && <span className='engine-login'>· log in to trade</span>}
                    </div>

                    <div className='auto-trade-toggle'>
                        <span>Auto Trading</span>
                        <button
                            type='button'
                            role='switch'
                            aria-checked={autoTradeEnabled}
                            aria-label='Toggle auto trading'
                            className={`toggle-btn ${autoTradeEnabled ? 'active' : ''}`}
                            onClick={toggleAutoTrade}
                        >
                            <span className='toggle-slider' />
                        </button>
                    </div>

                    <div className='risk-selector'>
                        <label htmlFor='hub-risk'>Risk</label>
                        <select
                            id='hub-risk'
                            value={riskLevel}
                            onChange={e => setRiskLevel(e.target.value as 'low' | 'medium' | 'high')}
                        >
                            <option value='low'>Low</option>
                            <option value='medium'>Medium</option>
                            <option value='high'>High</option>
                        </select>
                    </div>

                    <button className='analyze-btn' onClick={runAnalysis} disabled={isAnalyzing}>
                        {isAnalyzing ? 'Analyzing…' : 'Run AI Analysis'}
                    </button>

                    <HubAccountSwitcher />

                    <div className='theme-switcher' role='group' aria-label='Theme'>
                        <button
                            type='button'
                            className={`theme-option ${!is_dark_mode_on ? 'active' : ''}`}
                            onClick={() => setTheme('light')}
                        >
                            Light
                        </button>
                        <button
                            type='button'
                            className={`theme-option ${is_dark_mode_on ? 'active' : ''}`}
                            onClick={() => setTheme('dark')}
                        >
                            Dark
                        </button>
                    </div>
                </div>
            </div>

            {notice && <div className='hub-notice'>{notice}</div>}

            <div className='hub-stats'>
                <div className='stat-card'>
                    <div className='stat-label'>Total Profit</div>
                    <div className={`stat-value ${totalProfit >= 0 ? 'positive' : 'negative'}`}>
                        {totalProfit >= 0 ? '+' : ''}
                        {totalProfit.toFixed(2)}
                    </div>
                </div>
                <div className='stat-card'>
                    <div className='stat-label'>Active Bots</div>
                    <div className='stat-value'>{isEngineRunning ? 1 : 0}</div>
                </div>
                <div className='stat-card'>
                    <div className='stat-label'>Avg Win Rate</div>
                    <div className='stat-value'>{winRate.toFixed(1)}%</div>
                </div>
                <div className='stat-card'>
                    <div className='stat-label'>Markets Streaming</div>
                    <div className='stat-value'>
                        {streamingCount}/{markets.length}
                    </div>
                </div>
                <div className='stat-card'>
                    <div className='stat-label'>Open Trades</div>
                    <div className='stat-value'>{trades.filter(t => t.status === 'open').length}</div>
                </div>
            </div>

            <div className='hub-tabs' role='tablist' aria-label='Hub sections'>
                {(['overview', 'markets', 'bots', 'trades', 'strategies'] as const).map(tab => (
                    <button
                        key={tab}
                        role='tab'
                        aria-selected={selectedTab === tab}
                        className={`tab-btn ${selectedTab === tab ? 'active' : ''}`}
                        onClick={() => setSelectedTab(tab)}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            <div className='hub-content'>
                {selectedTab === 'overview' && (
                    <div className='overview-panel'>
                        <div className='panel-section'>
                            <h3>AI Analysis Log</h3>
                            <div className='analysis-log'>
                                {analysisLog.length === 0 ? (
                                    <p className='empty-state'>
                                        Press <strong>Run AI Analysis</strong> to scan every live market for setups.
                                    </p>
                                ) : (
                                    analysisLog.map((log, i) => <div key={i} className='log-entry'>{log}</div>)
                                )}
                                {isAnalyzing && <div className='log-entry loading'>Processing…</div>}
                            </div>
                        </div>
                        <div className='panel-section'>
                            <h3>Top Opportunities</h3>
                            <div className='opportunities-list'>
                                {(() => {
                                    const top = markets
                                        .filter(m => m.price !== null)
                                        .sort((a, b) => b.confidence - a.confidence)
                                        .slice(0, 5);
                                    if (!top.length) {
                                        return <p className='empty-state'>Waiting for live prices…</p>;
                                    }
                                    return top.map(market => (
                                        <div key={market.symbol} className='opportunity-card'>
                                            <div className='opp-header'>
                                                <span className='opp-symbol'>{market.symbol}</span>
                                                <span className={`opp-signal ${market.signal.toLowerCase()}`}>
                                                    {market.signal}
                                                </span>
                                            </div>
                                            <div className='opp-details'>
                                                <span>{market.name}</span>
                                                <span className='opp-confidence'>{market.confidence}% signal strength</span>
                                            </div>
                                            <div className='opp-price'>
                                                <span>{formatPrice(market.price)}</span>
                                                <span className={market.change >= 0 ? 'positive' : 'negative'}>
                                                    {signPercent(market.changePercent)}
                                                </span>
                                            </div>
                                        </div>
                                    ));
                                })()}
                            </div>
                        </div>
                    </div>
                )}

                {selectedTab === 'markets' && (
                    <div className='markets-panel'>
                        <div className='markets-toolbar'>
                            <input
                                type='search'
                                placeholder='Search markets…'
                                value={marketQuery}
                                onChange={e => setMarketQuery(e.target.value)}
                                aria-label='Search markets'
                            />
                            <div className='filter-chips' role='group' aria-label='Filter by category'>
                                {(['all', 'synthetic', 'forex'] as const).map(filter => (
                                    <button
                                        key={filter}
                                        className={`chip ${marketFilter === filter ? 'active' : ''}`}
                                        onClick={() => setMarketFilter(filter)}
                                    >
                                        {filter === 'all' ? 'All' : filter === 'synthetic' ? 'Synthetic' : 'Forex'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className='markets-table'>
                            <div className='table-header'>
                                <span>Symbol</span>
                                <span>Price</span>
                                <span>Change</span>
                                <span>RSI</span>
                                <span>Signal</span>
                                <span>Signal strength</span>
                            </div>
                            {visibleMarkets.length === 0 ? (
                                <p className='empty-state'>No markets match that search.</p>
                            ) : (
                                visibleMarkets.map(market => (
                                    <div key={market.symbol} className='table-row'>
                                        <span className='cell-symbol'>
                                            <strong>{market.symbol}</strong>
                                            <small>{market.name}</small>
                                        </span>
                                        <span className='cell-price'>{formatPrice(market.price)}</span>
                                        <span className={`cell-change ${market.change >= 0 ? 'positive' : 'negative'}`}>
                                            {market.price === null ? '—' : signPercent(market.changePercent)}
                                        </span>
                                        <span className='cell-rsi'>{market.price === null ? '—' : market.rsi.toFixed(0)}</span>
                                        <span className={`cell-signal ${market.signal.toLowerCase()}`}>
                                            {market.price === null ? '—' : market.signal}
                                        </span>
                                        <span className='cell-confidence'>
                                            {market.price === null ? '—' : `${market.confidence}%`}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {selectedTab === 'bots' && (
                    <div className='bots-panel'>
                        <div className='bots-grid'>
                            <div className='bot-card bot-card--live'>
                                <div className='bot-header'>
                                    <h4>Trading Engine</h4>
                                    <span className={`bot-status ${isEngineRunning ? 'running' : 'stopped'}`}>
                                        {isEngineRunning ? 'running' : 'stopped'}
                                    </span>
                                </div>
                                <p className='bot-desc'>
                                    The Deriv Bot engine runs the strategy loaded on the Bot Dashboard.
                                </p>
                                <div className='bot-stats'>
                                    <div className='bot-stat'>
                                        <span className='label'>Profit</span>
                                        <span className={`value ${totalProfit >= 0 ? 'positive' : 'negative'}`}>
                                            {totalProfit >= 0 ? '+' : ''}
                                            {totalProfit.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className='bot-stat'>
                                        <span className='label'>Runs</span>
                                        <span className='value'>{totalRuns}</span>
                                    </div>
                                    <div className='bot-stat'>
                                        <span className='label'>Win Rate</span>
                                        <span className='value'>{winRate.toFixed(1)}%</span>
                                    </div>
                                    <div className='bot-stat'>
                                        <span className='label'>Last Trade</span>
                                        <span className='value value--wide'>
                                            {trades.length ? trades[0].time || trades[0].id : 'None yet'}
                                        </span>
                                    </div>
                                </div>
                                <div className='bot-actions'>
                                    <button
                                        className={`action-btn ${isEngineRunning ? 'pause' : 'start'}`}
                                        onClick={startEngine}
                                        disabled={isEngineRunning}
                                    >
                                        {isEngineRunning ? 'Running' : 'Start'}
                                    </button>
                                    <button
                                        className='action-btn stop'
                                        onClick={stopEngine}
                                        disabled={!isEngineRunning}
                                    >
                                        Stop
                                    </button>
                                </div>
                            </div>

                            {HUB_STRATEGIES.map(strategy => (
                                <div key={strategy.id} className='bot-card'>
                                    <div className='bot-header'>
                                        <h4>{strategy.name}</h4>
                                        <span className={`risk-badge ${strategy.risk.toLowerCase().replace(/\s+/g, '-')}`}>
                                            {strategy.risk}
                                        </span>
                                    </div>
                                    <p className='bot-desc'>{strategy.description}</p>
                                    <div className='bot-stats'>
                                        <div className='bot-stat'>
                                            <span className='label'>Direction</span>
                                            <span className={`value ${strategy.direction === 'CALL' ? 'positive' : 'negative'}`}>
                                                {strategy.direction === 'CALL' ? 'Rise' : 'Fall'}
                                            </span>
                                        </div>
                                        <div className='bot-stat'>
                                            <span className='label'>Stake</span>
                                            <span className='value'>{strategy.amount.toFixed(2)}</span>
                                        </div>
                                    </div>
                                    <div className='bot-markets'>
                                        <span className='market-tag'>{strategy.symbol}</span>
                                        <span className='market-tag'>
                                            {strategy.duration}
                                            {strategy.durationUnit}
                                        </span>
                                    </div>
                                    <div className='bot-actions'>
                                        <button
                                            className='action-btn start'
                                            onClick={() => deployStrategy(strategy)}
                                            disabled={isDeploying}
                                        >
                                            {isDeploying ? 'Deploying…' : 'Deploy'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {selectedTab === 'trades' && (
                    <div className='trades-panel'>
                        <div className='trades-table'>
                            <div className='table-header'>
                                <span>Time</span>
                                <span>Symbol</span>
                                <span>Type</span>
                                <span>Amount</span>
                                <span>Price</span>
                                <span>Profit</span>
                                <span>Status</span>
                            </div>
                            {trades.length === 0 ? (
                                <p className='empty-state'>
                                    No trades yet. Log in, then start the engine to begin trading.
                                </p>
                            ) : (
                                trades.map(trade => (
                                    <div key={trade.id} className='table-row'>
                                        <span className='cell-time'>{trade.time || '—'}</span>
                                        <span className='cell-symbol'>{trade.symbol || '—'}</span>
                                        <span className={`cell-type ${trade.type.toLowerCase()}`}>{trade.type}</span>
                                        <span className='cell-amount'>{trade.amount}</span>
                                        <span className='cell-price'>{formatPrice(trade.price)}</span>
                                        <span className={`cell-profit ${trade.profit >= 0 ? 'positive' : 'negative'}`}>
                                            {trade.profit >= 0 ? '+' : ''}
                                            {trade.profit.toFixed(2)}
                                        </span>
                                        <span className={`cell-status ${trade.status}`}>{trade.status}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {selectedTab === 'strategies' && (
                    <div className='strategies-panel'>
                        <div className='strategies-grid'>
                            {HUB_STRATEGIES.map(strategy => (
                                <div key={strategy.id} className='strategy-card'>
                                    <div className='strategy-header'>
                                        <h4>{strategy.name}</h4>
                                        <span className={`risk-badge ${strategy.risk.toLowerCase().replace(/\s+/g, '-')}`}>
                                            {strategy.risk} risk
                                        </span>
                                    </div>
                                    <p className='strategy-desc'>{strategy.description}</p>
                                    <div className='strategy-metrics'>
                                        <div className='metric'>
                                            <span className='metric-label'>Market</span>
                                            <span className='metric-value'>{strategy.symbol}</span>
                                        </div>
                                        <div className='metric'>
                                            <span className='metric-label'>Direction</span>
                                            <span className='metric-value'>
                                                {strategy.direction === 'CALL' ? 'Rise' : 'Fall'}
                                            </span>
                                        </div>
                                        <div className='metric'>
                                            <span className='metric-label'>Duration</span>
                                            <span className='metric-value'>
                                                {strategy.duration}
                                                {strategy.durationUnit}
                                            </span>
                                        </div>
                                        <div className='metric'>
                                            <span className='metric-label'>Stake</span>
                                            <span className='metric-value'>{strategy.amount.toFixed(2)}</span>
                                        </div>
                                    </div>
                                    <button
                                        className='deploy-btn'
                                        onClick={() => deployStrategy(strategy)}
                                        disabled={isDeploying}
                                    >
                                        {isDeploying ? 'Deploying…' : 'Deploy Bot'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

export default AITradingHub;
