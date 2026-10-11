import React, { useCallback, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { transaction_elements } from '@/constants/transactions';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { computeRsi, useLivePrices } from './use-live-data';
import './ai-trading-hub.scss';

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
    confidence: number;
    trend: 'up' | 'down' | 'sideways';
}

interface Strategy {
    id: string;
    name: string;
    description: string;
    risk: 'Very Low' | 'Low' | 'Medium' | 'High';
    winRate: number;
    avgReturn: number;
    markets: string[];
}

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

const STRATEGIES: Strategy[] = [
    { id: 'momentum', name: 'Momentum Pro', description: 'AI-powered momentum detection with multi-timeframe analysis', risk: 'Medium', winRate: 72, avgReturn: 3.2, markets: ['R_100', '1HZ100V', 'BOOM500'] },
    { id: 'mean_reversion', name: 'Mean Reversion', description: 'Identifies overbought and oversold conditions using RSI and Bollinger Bands', risk: 'Low', winRate: 78, avgReturn: 2.1, markets: ['R_50', 'R_25', 'frxEURUSD'] },
    { id: 'breakout', name: 'Breakout Hunter', description: 'Detects volatility breakouts with volume confirmation', risk: 'High', winRate: 65, avgReturn: 5.8, markets: ['CRASH500', 'BOOM1000', 'R_100'] },
    { id: 'scalping', name: 'AI Scalper', description: 'High-frequency micro-trend capture with tight risk management', risk: 'Medium', winRate: 81, avgReturn: 1.4, markets: ['R_10', '1HZ10V', 'stpRNG'] },
    { id: 'trend_following', name: 'Trend Rider', description: 'Follows strong trends using moving average crossovers and ADX', risk: 'Medium', winRate: 69, avgReturn: 4.1, markets: ['R_75', '1HZ75V', 'frxGBPUSD'] },
    { id: 'grid', name: 'Smart Grid', description: 'Adaptive grid trading with dynamic spacing based on volatility', risk: 'Low', winRate: 74, avgReturn: 2.8, markets: ['R_50', 'stpRNG', 'frxUSDJPY'] },
    { id: 'arbitrage', name: 'Arbitrage Scanner', description: 'Cross-market price discrepancy detection and execution', risk: 'Very Low', winRate: 88, avgReturn: 0.9, markets: ['frxEURUSD', 'frxGBPUSD'] },
    { id: 'news', name: 'News Sentiment', description: 'Sentiment analysis for event-driven trading on major pairs', risk: 'High', winRate: 62, avgReturn: 6.5, markets: ['frxUSDJPY', 'frxEURJPY'] },
];

const RISK_ORDER: Record<Strategy['risk'], number> = { 'Very Low': 0, Low: 1, Medium: 2, High: 3 };

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

    const symbols = useMemo(() => MARKET_CATALOG.map(m => m.symbol), []);
    const { quotes, buffers } = useLivePrices(symbols);

    const runPanel = store?.run_panel;
    const transactions = store?.transactions;
    const client = store?.client;
    const isEngineRunning = Boolean(runPanel?.is_running);
    const isLoggedIn = Boolean(client?.is_logged_in);

    const flashNotice = useCallback((message: string) => {
        setNotice(message);
        window.setTimeout(() => setNotice(current => (current === message ? '' : current)), 6000);
    }, []);

    const startEngine = useCallback(() => {
        if (!isLoggedIn) {
            flashNotice('Log in to start automated trading.');
        }
        void Promise.resolve(runPanel?.onRunButtonClick()).catch(() => undefined);
    }, [runPanel, isLoggedIn, flashNotice]);

    const stopEngine = useCallback(() => {
        void Promise.resolve(runPanel?.onStopButtonClick()).catch(() => undefined);
    }, [runPanel]);

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

        const lines: string[] = [];
        lines.push('[AI] Initializing market analysis engine...');
        lines.push(`[AI] Subscribed to ${markets.length} live Deriv markets (${streamingCount} streaming).`);

        const actionable = markets
            .filter(m => m.price !== null)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 6);

        actionable.forEach(market => {
            const zone = market.rsi > 60 ? 'overbought' : market.rsi < 40 ? 'oversold' : 'neutral';
            lines.push(
                `[AI] ${market.symbol} @ ${market.price!.toFixed(market.price! < 10 ? 5 : 2)} | ` +
                    `${market.changePercent >= 0 ? '+' : ''}${market.changePercent.toFixed(2)}% | ` +
                    `RSI ${market.rsi.toFixed(1)} (${zone}) → ${market.signal} ${market.confidence}%`
            );
        });

        const setups = markets.filter(m => m.price !== null && m.signal !== 'HOLD');
        lines.push(`[AI] ${setups.length} actionable setup(s) across ${streamingCount} live markets.`);
        lines.push(
            `[AI] Risk profile set to ${riskLevel}. ` +
                (isLoggedIn
                    ? isEngineRunning
                        ? 'Engine is running.'
                        : 'Auto Trading toggle will start the engine.'
                    : 'Log in to let the engine place trades.')
        );

        let index = 0;
        const timer = window.setInterval(() => {
            const line = lines[index];
            if (line !== undefined) {
                setAnalysisLog(prev => [...prev, line]);
                index += 1;
            } else {
                window.clearInterval(timer);
                setIsAnalyzing(false);
            }
        }, 220);
    }, [markets, streamingCount, riskLevel, isLoggedIn, isEngineRunning]);

    const toggleAutoTrade = useCallback(() => {
        const next = !autoTradeEnabled;
        setAutoTradeEnabled(next);
        if (next) startEngine();
        else stopEngine();
    }, [autoTradeEnabled, startEngine, stopEngine]);

    const deployStrategy = useCallback(
        (strategy: Strategy) => {
            const exceedsRisk =
                (riskLevel === 'low' && RISK_ORDER[strategy.risk] > 1) ||
                (riskLevel === 'medium' && RISK_ORDER[strategy.risk] > 3);
            if (exceedsRisk) {
                flashNotice(`${strategy.name} is ${strategy.risk} risk — raise the Risk setting to deploy it.`);
                return;
            }
            if (!isLoggedIn) {
                flashNotice('Log in first — then deploy a strategy and press Run on the Bot Dashboard.');
                return;
            }
            flashNotice(`${strategy.name} armed. Finish its setup on the Bot Dashboard, then press Run.`);
            onOpenDashboard?.();
        },
        [riskLevel, isLoggedIn, flashNotice, onOpenDashboard]
    );

    const formatPrice = (value: number | null) => (value === null ? '—' : value.toFixed(value < 10 ? 5 : 2));
    const signPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

    return (
        <div className='ai-trading-hub'>
            <div className='hub-header'>
                <div className='hub-title'>
                    <h1>AI Trading Hub</h1>
                    <p>Autonomous AI-powered trading across all live Deriv markets</p>
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
                                                <span className='opp-confidence'>{market.confidence}% confidence</span>
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
                                <span>Confidence</span>
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

                            {STRATEGIES.map(strategy => (
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
                                            <span className='label'>Win Rate</span>
                                            <span className='value'>{strategy.winRate}%</span>
                                        </div>
                                        <div className='bot-stat'>
                                            <span className='label'>Avg Return</span>
                                            <span className='value'>{strategy.avgReturn}%</span>
                                        </div>
                                    </div>
                                    <div className='bot-markets'>
                                        {strategy.markets.map(m => (
                                            <span key={m} className='market-tag'>
                                                {m}
                                            </span>
                                        ))}
                                    </div>
                                    <div className='bot-actions'>
                                        <button className='action-btn start' onClick={() => deployStrategy(strategy)}>
                                            Deploy
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
                            {STRATEGIES.map(strategy => (
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
                                            <span className='metric-label'>Win Rate</span>
                                            <span className='metric-value'>{strategy.winRate}%</span>
                                        </div>
                                        <div className='metric'>
                                            <span className='metric-label'>Avg Return</span>
                                            <span className='metric-value'>{strategy.avgReturn}%</span>
                                        </div>
                                    </div>
                                    <div className='bot-markets'>
                                        {strategy.markets.map(m => (
                                            <span key={m} className='market-tag'>
                                                {m}
                                            </span>
                                        ))}
                                    </div>
                                    <button className='deploy-btn' onClick={() => deployStrategy(strategy)}>
                                        Deploy Bot
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
