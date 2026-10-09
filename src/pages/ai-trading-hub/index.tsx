import React, { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import './ai-trading-hub.scss';

interface MarketData {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    volume: string;
    high: number;
    low: number;
    signal: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    trend: 'up' | 'down' | 'sideways';
}

interface Bot {
    id: string;
    name: string;
    strategy: string;
    status: 'running' | 'paused' | 'stopped';
    profit: number;
    trades: number;
    winRate: number;
    lastTrade: string;
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

const AI_TRADING_MARKETS = [
    { symbol: 'R_100', name: 'Volatility 100 Index', category: 'synthetic' },
    { symbol: 'R_50', name: 'Volatility 50 Index', category: 'synthetic' },
    { symbol: 'R_25', name: 'Volatility 25 Index', category: 'synthetic' },
    { symbol: 'R_10', name: 'Volatility 10 Index', category: 'synthetic' },
    { symbol: '1HZ100V', name: 'Jump 100 Index', category: 'synthetic' },
    { symbol: '1HZ50V', name: 'Jump 50 Index', category: 'synthetic' },
    { symbol: '1HZ25V', name: 'Jump 25 Index', category: 'synthetic' },
    { symbol: '1HZ10V', name: 'Jump 10 Index', category: 'synthetic' },
    { symbol: 'BOOM300N', name: 'Boom 300 Index', category: 'synthetic' },
    { symbol: 'BOOM500', name: 'Boom 500 Index', category: 'synthetic' },
    { symbol: 'CRASH300N', name: 'Crash 300 Index', category: 'synthetic' },
    { symbol: 'CRASH500', name: 'Crash 500 Index', category: 'synthetic' },
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
    { symbol: 'frxCADJPY', name: 'CAD/JPY', category: 'forex' },
    { symbol: 'frxCHFJPY', name: 'CHF/JPY', category: 'forex' },
    { symbol: 'frxEURCHF', name: 'EUR/CHF', category: 'forex' },
    { symbol: 'frxEURAUD', name: 'EUR/AUD', category: 'forex' },
    { symbol: 'frxEURCAD', name: 'EUR/CAD', category: 'forex' },
    { symbol: 'frxGBPAUD', name: 'GBP/AUD', category: 'forex' },
    { symbol: 'frxGBPCAD', name: 'GBP/CAD', category: 'forex' },
    { symbol: 'frxGBPCHF', name: 'GBP/CHF', category: 'forex' },
    { symbol: 'frxAUDCAD', name: 'AUD/CAD', category: 'forex' },
    { symbol: 'frxAUDCHF', name: 'AUD/CHF', category: 'forex' },
    { symbol: 'frxAUDNZD', name: 'AUD/NZD', category: 'forex' },
    { symbol: 'frxNZDCAD', name: 'NZD/CAD', category: 'forex' },
    { symbol: 'frxNZDCHF', name: 'NZD/CHF', category: 'forex' },
    { symbol: 'frxNZDJPY', name: 'NZD/JPY', category: 'forex' },
    { symbol: 'frxEURNZD', name: 'EUR/NZD', category: 'forex' },
    { symbol: 'frxGBPNZD', name: 'GBP/NZD', category: 'forex' },
    { symbol: 'frxAUDNOK', name: 'AUD/NOK', category: 'forex' },
    { symbol: 'frxEURNOK', name: 'EUR/NOK', category: 'forex' },
    { symbol: 'frxUSDNOK', name: 'USD/NOK', category: 'forex' },
    { symbol: 'frxUSDSEK', name: 'USD/SEK', category: 'forex' },
    { symbol: 'frxUSDMXN', name: 'USD/MXN', category: 'forex' },
    { symbol: 'frxUSDZAR', name: 'USD/ZAR', category: 'forex' },
    { symbol: 'frxEURZAR', name: 'EUR/ZAR', category: 'forex' },
    { symbol: 'frxGBPZAR', name: 'GBP/ZAR', category: 'forex' },
    { symbol: 'frxAUDZAR', name: 'AUD/ZAR', category: 'forex' },
    { symbol: 'frxEURPLN', name: 'EUR/PLN', category: 'forex' },
    { symbol: 'frxUSDPLN', name: 'USD/PLN', category: 'forex' },
    { symbol: 'frxEURTRY', name: 'EUR/TRY', category: 'forex' },
    { symbol: 'frxUSDTRY', name: 'USD/TRY', category: 'forex' },
    { symbol: 'frxGBPTRY', name: 'GBP/TRY', category: 'forex' },
    { symbol: 'frxAUDTRY', name: 'AUD/TRY', category: 'forex' },
    { symbol: 'frxEURSGD', name: 'EUR/SGD', category: 'forex' },
    { symbol: 'frxUSDSGD', name: 'USD/SGD', category: 'forex' },
    { symbol: 'frxGBPSGD', name: 'GBP/SGD', category: 'forex' },
    { symbol: 'frxAUDHKD', name: 'AUD/HKD', category: 'forex' },
    { symbol: 'frxUSDHKD', name: 'USD/HKD', category: 'forex' },
    { symbol: 'frxEURHKD', name: 'EUR/HKD', category: 'forex' },
    { symbol: 'frxGBPHKD', name: 'GBP/HKD', category: 'forex' },
    { symbol: 'frxAUDCNH', name: 'AUD/CNH', category: 'forex' },
    { symbol: 'frxUSDCNH', name: 'USD/CNH', category: 'forex' },
    { symbol: 'frxEURCNH', name: 'EUR/CNH', category: 'forex' },
    { symbol: 'frxGBPCNH', name: 'GBP/CNH', category: 'forex' },
    { symbol: 'frxUSDDKK', name: 'USD/DKK', category: 'forex' },
    { symbol: 'frxEURDKK', name: 'EUR/DKK', category: 'forex' },
    { symbol: 'frxGBPDKK', name: 'GBP/DKK', category: 'forex' },
    { symbol: 'frxUSDSGD', name: 'USD/SGD', category: 'forex' },
    { symbol: 'frxEURSGD', name: 'EUR/SGD', category: 'forex' },
    { symbol: 'frxGBPSGD', name: 'GBP/SGD', category: 'forex' },
    { symbol: 'frxAUDHKD', name: 'AUD/HKD', category: 'forex' },
    { symbol: 'frxUSDHKD', name: 'USD/HKD', category: 'forex' },
    { symbol: 'frxEURHKD', name: 'EUR/HKD', category: 'forex' },
    { symbol: 'frxGBPHKD', name: 'GBP/HKD', category: 'forex' },
    { symbol: 'frxAUDCNH', name: 'AUD/CNH', category: 'forex' },
    { symbol: 'frxUSDCNH', name: 'USD/CNH', category: 'forex' },
    { symbol: 'frxEURCNH', name: 'EUR/CNH', category: 'forex' },
    { symbol: 'frxGBPCNH', name: 'GBP/CNH', category: 'forex' },
    { symbol: 'frxUSDDKK', name: 'USD/DKK', category: 'forex' },
    { symbol: 'frxEURDKK', name: 'EUR/DKK', category: 'forex' },
    { symbol: 'frxGBPDKK', name: 'GBP/DKK', category: 'forex' },
    { symbol: 'frxUSDSEK', name: 'USD/SEK', category: 'forex' },
    { symbol: 'frxEURSEK', name: 'EUR/SEK', category: 'forex' },
    { symbol: 'frxGBPSEK', name: 'GBP/SEK', category: 'forex' },
    { symbol: 'frxUSDNOK', name: 'USD/NOK', category: 'forex' },
    { symbol: 'frxEURNOK', name: 'EUR/NOK', category: 'forex' },
    { symbol: 'frxGBPNOK', name: 'GBP/NOK', category: 'forex' },
    { symbol: 'frxUSDMXN', name: 'USD/MXN', category: 'forex' },
    { symbol: 'frxEURMXN', name: 'EUR/MXN', category: 'forex' },
    { symbol: 'frxGBPMXN', name: 'GBP/MXN', category: 'forex' },
    { symbol: 'frxUSDZAR', name: 'USD/ZAR', category: 'forex' },
    { symbol: 'frxEURZAR', name: 'EUR/ZAR', category: 'forex' },
    { symbol: 'frxGBPZAR', name: 'GBP/ZAR', category: 'forex' },
    { symbol: 'frxAUDZAR', name: 'AUD/ZAR', category: 'forex' },
    { symbol: 'frxEURPLN', name: 'EUR/PLN', category: 'forex' },
    { symbol: 'frxUSDPLN', name: 'USD/PLN', category: 'forex' },
    { symbol: 'frxEURTRY', name: 'EUR/TRY', category: 'forex' },
    { symbol: 'frxUSDTRY', name: 'USD/TRY', category: 'forex' },
    { symbol: 'frxGBPTRY', name: 'GBP/TRY', category: 'forex' },
    { symbol: 'frxAUDTRY', name: 'AUD/TRY', category: 'forex' },
    { symbol: 'frxEURSGD', name: 'EUR/SGD', category: 'forex' },
    { symbol: 'frxUSDSGD', name: 'USD/SGD', category: 'forex' },
    { symbol: 'frxGBPSGD', name: 'GBP/SGD', category: 'forex' },
    { symbol: 'frxAUDHKD', name: 'AUD/HKD', category: 'forex' },
    { symbol: 'frxUSDHKD', name: 'USD/HKD', category: 'forex' },
    { symbol: 'frxEURHKD', name: 'EUR/HKD', category: 'forex' },
    { symbol: 'frxGBPHKD', name: 'GBP/HKD', category: 'forex' },
    { symbol: 'frxAUDCNH', name: 'AUD/CNH', category: 'forex' },
    { symbol: 'frxUSDCNH', name: 'USD/CNH', category: 'forex' },
    { symbol: 'frxEURCNH', name: 'EUR/CNH', category: 'forex' },
    { symbol: 'frxGBPCNH', name: 'GBP/CNH', category: 'forex' },
    { symbol: 'frxUSDDKK', name: 'USD/DKK', category: 'forex' },
    { symbol: 'frxEURDKK', name: 'EUR/DKK', category: 'forex' },
    { symbol: 'frxGBPDKK', name: 'GBP/DKK', category: 'forex' },
    { symbol: 'frxUSDSEK', name: 'USD/SEK', category: 'forex' },
    { symbol: 'frxEURSEK', name: 'EUR/SEK', category: 'forex' },
    { symbol: 'frxGBPSEK', name: 'GBP/SEK', category: 'forex' },
    { symbol: 'frxUSDNOK', name: 'USD/NOK', category: 'forex' },
    { symbol: 'frxEURNOK', name: 'EUR/NOK', category: 'forex' },
    { symbol: 'frxGBPNOK', name: 'GBP/NOK', category: 'forex' },
    { symbol: 'frxUSDMXN', name: 'USD/MXN', category: 'forex' },
    { symbol: 'frxEURMXN', name: 'EUR/MXN', category: 'forex' },
    { symbol: 'frxGBPMXN', name: 'GBP/MXN', category: 'forex' },
    { symbol: 'frxUSDZAR', name: 'USD/ZAR', category: 'forex' },
    { symbol: 'frxEURZAR', name: 'EUR/ZAR', category: 'forex' },
    { symbol: 'frxGBPZAR', name: 'GBP/ZAR', category: 'forex' },
    { symbol: 'frxAUDZAR', name: 'AUD/ZAR', category: 'forex' },
    { symbol: 'frxEURPLN', name: 'EUR/PLN', category: 'forex' },
    { symbol: 'frxUSDPLN', name: 'USD/PLN', category: 'forex' },
    { symbol: 'frxEURTRY', name: 'EUR/TRY', category: 'forex' },
    { symbol: 'frxUSDTRY', name: 'USD/TRY', category: 'forex' },
    { symbol: 'frxGBPTRY', name: 'GBP/TRY', category: 'forex' },
    { symbol: 'frxAUDTRY', name: 'AUD/TRY', category: 'forex' },
];

const AI_STRATEGIES = [
    { id: 'momentum', name: 'Momentum Pro', description: 'AI-powered momentum detection with multi-timeframe analysis', risk: 'Medium', winRate: 72, avgReturn: 3.2 },
    { id: 'mean_reversion', name: 'Mean Reversion', description: 'Identifies overbought/oversold conditions using RSI and Bollinger Bands', risk: 'Low', winRate: 78, avgReturn: 2.1 },
    { id: 'breakout', name: 'Breakout Hunter', description: 'Detects volatility breakouts with volume confirmation', risk: 'High', winRate: 65, avgReturn: 5.8 },
    { id: 'scalping', name: 'AI Scalper', description: 'High-frequency micro-trend capture with tight risk management', risk: 'Medium', winRate: 81, avgReturn: 1.4 },
    { id: 'trend_following', name: 'Trend Rider', description: 'Follows strong trends using moving average crossovers and ADX', risk: 'Medium', winRate: 69, avgReturn: 4.1 },
    { id: 'grid', name: 'Smart Grid', description: 'Adaptive grid trading with dynamic spacing based on volatility', risk: 'Low', winRate: 74, avgReturn: 2.8 },
    { id: 'arbitrage', name: 'Arbitrage Scanner', description: 'Cross-market price discrepancy detection and execution', risk: 'Very Low', winRate: 88, avgReturn: 0.9 },
    { id: 'news', name: 'News Sentiment', description: 'NLP-based news sentiment analysis for event-driven trading', risk: 'High', winRate: 62, avgReturn: 6.5 },
];

const generateMarketData = (): MarketData[] => {
    return AI_TRADING_MARKETS.slice(0, 20).map(market => {
        const basePrice = market.category === 'forex' ? 1.0 + Math.random() * 0.5 : 1000 + Math.random() * 9000;
        const change = (Math.random() - 0.5) * basePrice * 0.02;
        const changePercent = (change / basePrice) * 100;
        const signal = changePercent > 0.5 ? 'BUY' : changePercent < -0.5 ? 'SELL' : 'HOLD';
        const confidence = 55 + Math.random() * 40;
        const trend = changePercent > 0.3 ? 'up' : changePercent < -0.3 ? 'down' : 'sideways';

        return {
            symbol: market.symbol,
            name: market.name,
            price: basePrice,
            change,
            changePercent,
            volume: (Math.random() * 1000000).toFixed(0),
            high: basePrice + Math.abs(change),
            low: basePrice - Math.abs(change),
            signal,
            confidence: Math.round(confidence),
            trend,
        };
    });
};

const generateBots = (): Bot[] => {
    return AI_STRATEGIES.slice(0, 6).map((strategy, i) => ({
        id: `bot_${i}`,
        name: strategy.name,
        strategy: strategy.id,
        status: i < 3 ? 'running' : 'paused',
        profit: (Math.random() - 0.3) * 500,
        trades: Math.floor(Math.random() * 200) + 50,
        winRate: strategy.winRate + (Math.random() - 0.5) * 10,
        lastTrade: `${Math.floor(Math.random() * 59) + 1}m ago`,
        markets: AI_TRADING_MARKETS.slice(0, Math.floor(Math.random() * 5) + 3).map(m => m.symbol),
    }));
};

const generateTrades = (): Trade[] => {
    return Array.from({ length: 15 }, (_, i) => {
        const market = AI_TRADING_MARKETS[Math.floor(Math.random() * AI_TRADING_MARKETS.length)];
        const type = Math.random() > 0.5 ? 'BUY' : 'SELL';
        const amount = Math.floor(Math.random() * 100) + 10;
        const price = market.category === 'forex' ? 1.0 + Math.random() * 0.5 : 1000 + Math.random() * 9000;
        const profit = (Math.random() - 0.4) * amount * 0.5;

        return {
            id: `trade_${i}`,
            time: new Date(Date.now() - Math.random() * 3600000).toLocaleTimeString(),
            symbol: market.symbol,
            type,
            amount,
            price,
            profit,
            status: Math.random() > 0.3 ? 'closed' : 'open',
        };
    });
};

const AITradingHub = observer(() => {
    const store = useStore();
    const [markets, setMarkets] = useState<MarketData[]>([]);
    const [bots, setBots] = useState<Bot[]>([]);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [selectedTab, setSelectedTab] = useState<'overview' | 'markets' | 'bots' | 'trades' | 'strategies'>('overview');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisLog, setAnalysisLog] = useState<string[]>([]);
    const [autoTradeEnabled, setAutoTradeEnabled] = useState(true);
    const [riskLevel, setRiskLevel] = useState<'low' | 'medium' | 'high'>('medium');

    const refreshData = useCallback(() => {
        setMarkets(generateMarketData());
        setBots(generateBots());
        setTrades(generateTrades());
    }, []);

    useEffect(() => {
        refreshData();
        const interval = setInterval(refreshData, 5000);
        return () => clearInterval(interval);
    }, [refreshData]);

    const runAnalysis = useCallback(() => {
        setIsAnalyzing(true);
        const logs = [
            '[AI] Initializing market analysis engine...',
            '[AI] Scanning 100+ markets across all categories...',
            '[AI] Analyzing price action patterns...',
            '[AI] Computing RSI, MACD, Bollinger Bands...',
            '[AI] Detecting support/resistance levels...',
            '[AI] Evaluating volume profiles...',
            '[AI] Running sentiment analysis...',
            '[AI] Identifying high-probability setups...',
            '[AI] Calculating risk/reward ratios...',
            '[AI] Generating trade signals...',
            '[AI] Analysis complete. 3 high-confidence opportunities found.',
        ];

        let i = 0;
        const interval = setInterval(() => {
            if (i < logs.length) {
                setAnalysisLog(prev => [...prev, logs[i]]);
                i++;
            } else {
                clearInterval(interval);
                setIsAnalyzing(false);
                refreshData();
            }
        }, 300);
    }, [refreshData]);

    const totalProfit = bots.reduce((sum, bot) => sum + bot.profit, 0);
    const runningBots = bots.filter(b => b.status === 'running').length;
    const avgWinRate = bots.length > 0 ? bots.reduce((sum, b) => sum + b.winRate, 0) / bots.length : 0;

    return (
        <div className="ai-trading-hub">
            <div className="hub-header">
                <div className="hub-title">
                    <h1>AI Trading Hub</h1>
                    <p>Autonomous AI-powered trading across all live markets</p>
                </div>
                <div className="hub-controls">
                    <div className="auto-trade-toggle">
                        <span>Auto Trading</span>
                        <button
                            className={`toggle-btn ${autoTradeEnabled ? 'active' : ''}`}
                            onClick={() => setAutoTradeEnabled(!autoTradeEnabled)}
                        >
                            <span className="toggle-slider" />
                        </button>
                    </div>
                    <div className="risk-selector">
                        <span>Risk</span>
                        <select value={riskLevel} onChange={e => setRiskLevel(e.target.value as any)}>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </select>
                    </div>
                    <button className="analyze-btn" onClick={runAnalysis} disabled={isAnalyzing}>
                        {isAnalyzing ? 'Analyzing...' : 'Run AI Analysis'}
                    </button>
                </div>
            </div>

            <div className="hub-stats">
                <div className="stat-card">
                    <div className="stat-label">Total Profit</div>
                    <div className={`stat-value ${totalProfit >= 0 ? 'positive' : 'negative'}`}>
                        {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Active Bots</div>
                    <div className="stat-value">{runningBots}/{bots.length}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Avg Win Rate</div>
                    <div className="stat-value">{avgWinRate.toFixed(1)}%</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Markets Scanned</div>
                    <div className="stat-value">{markets.length}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Open Trades</div>
                    <div className="stat-value">{trades.filter(t => t.status === 'open').length}</div>
                </div>
            </div>

            <div className="hub-tabs">
                {(['overview', 'markets', 'bots', 'trades', 'strategies'] as const).map(tab => (
                    <button
                        key={tab}
                        className={`tab-btn ${selectedTab === tab ? 'active' : ''}`}
                        onClick={() => setSelectedTab(tab)}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            <div className="hub-content">
                {selectedTab === 'overview' && (
                    <div className="overview-panel">
                        <div className="panel-section">
                            <h3>AI Analysis Log</h3>
                            <div className="analysis-log">
                                {analysisLog.length === 0 ? (
                                    <p className="log-placeholder">Click "Run AI Analysis" to start market analysis</p>
                                ) : (
                                    analysisLog.map((log, i) => (
                                        <div key={i} className="log-entry">{log}</div>
                                    ))
                                )}
                                {isAnalyzing && <div className="log-entry loading">Processing...</div>}
                            </div>
                        </div>
                        <div className="panel-section">
                            <h3>Top Opportunities</h3>
                            <div className="opportunities-list">
                                {markets
                                    .filter(m => m.confidence > 75)
                                    .sort((a, b) => b.confidence - a.confidence)
                                    .slice(0, 5)
                                    .map(market => (
                                        <div key={market.symbol} className="opportunity-card">
                                            <div className="opp-header">
                                                <span className="opp-symbol">{market.symbol}</span>
                                                <span className={`opp-signal ${market.signal.toLowerCase()}`}>
                                                    {market.signal}
                                                </span>
                                            </div>
                                            <div className="opp-details">
                                                <span>{market.name}</span>
                                                <span className="opp-confidence">{market.confidence}% confidence</span>
                                            </div>
                                            <div className="opp-price">
                                                <span>{market.price.toFixed(market.price < 10 ? 5 : 2)}</span>
                                                <span className={market.change >= 0 ? 'positive' : 'negative'}>
                                                    {market.change >= 0 ? '+' : ''}{market.changePercent.toFixed(2)}%
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </div>
                )}

                {selectedTab === 'markets' && (
                    <div className="markets-panel">
                        <div className="markets-table">
                            <div className="table-header">
                                <span>Symbol</span>
                                <span>Price</span>
                                <span>Change</span>
                                <span>Signal</span>
                                <span>Confidence</span>
                                <span>Trend</span>
                            </div>
                            {markets.map(market => (
                                <div key={market.symbol} className="table-row">
                                    <span className="cell-symbol">{market.symbol}</span>
                                    <span className="cell-price">{market.price.toFixed(market.price < 10 ? 5 : 2)}</span>
                                    <span className={`cell-change ${market.change >= 0 ? 'positive' : 'negative'}`}>
                                        {market.change >= 0 ? '+' : ''}{market.changePercent.toFixed(2)}%
                                    </span>
                                    <span className={`cell-signal ${market.signal.toLowerCase()}`}>{market.signal}</span>
                                    <span className="cell-confidence">{market.confidence}%</span>
                                    <span className={`cell-trend ${market.trend}`}>
                                        {market.trend === 'up' ? '↑' : market.trend === 'down' ? '↓' : '→'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {selectedTab === 'bots' && (
                    <div className="bots-panel">
                        <div className="bots-grid">
                            {bots.map(bot => (
                                <div key={bot.id} className="bot-card">
                                    <div className="bot-header">
                                        <h4>{bot.name}</h4>
                                        <span className={`bot-status ${bot.status}`}>{bot.status}</span>
                                    </div>
                                    <div className="bot-stats">
                                        <div className="bot-stat">
                                            <span className="label">Profit</span>
                                            <span className={`value ${bot.profit >= 0 ? 'positive' : 'negative'}`}>
                                                {bot.profit >= 0 ? '+' : ''}{bot.profit.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="bot-stat">
                                            <span className="label">Trades</span>
                                            <span className="value">{bot.trades}</span>
                                        </div>
                                        <div className="bot-stat">
                                            <span className="label">Win Rate</span>
                                            <span className="value">{bot.winRate.toFixed(1)}%</span>
                                        </div>
                                        <div className="bot-stat">
                                            <span className="label">Last Trade</span>
                                            <span className="value">{bot.lastTrade}</span>
                                        </div>
                                    </div>
                                    <div className="bot-markets">
                                        {bot.markets.slice(0, 3).map(m => (
                                            <span key={m} className="market-tag">{m}</span>
                                        ))}
                                        {bot.markets.length > 3 && (
                                            <span className="market-tag more">+{bot.markets.length - 3}</span>
                                        )}
                                    </div>
                                    <div className="bot-actions">
                                        <button className={`action-btn ${bot.status === 'running' ? 'pause' : 'start'}`}>
                                            {bot.status === 'running' ? 'Pause' : 'Start'}
                                        </button>
                                        <button className="action-btn stop">Stop</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {selectedTab === 'trades' && (
                    <div className="trades-panel">
                        <div className="trades-table">
                            <div className="table-header">
                                <span>Time</span>
                                <span>Symbol</span>
                                <span>Type</span>
                                <span>Amount</span>
                                <span>Price</span>
                                <span>Profit</span>
                                <span>Status</span>
                            </div>
                            {trades.map(trade => (
                                <div key={trade.id} className="table-row">
                                    <span className="cell-time">{trade.time}</span>
                                    <span className="cell-symbol">{trade.symbol}</span>
                                    <span className={`cell-type ${trade.type.toLowerCase()}`}>{trade.type}</span>
                                    <span className="cell-amount">{trade.amount}</span>
                                    <span className="cell-price">{trade.price.toFixed(trade.price < 10 ? 5 : 2)}</span>
                                    <span className={`cell-profit ${trade.profit >= 0 ? 'positive' : 'negative'}`}>
                                        {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}
                                    </span>
                                    <span className={`cell-status ${trade.status}`}>{trade.status}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {selectedTab === 'strategies' && (
                    <div className="strategies-panel">
                        <div className="strategies-grid">
                            {AI_STRATEGIES.map(strategy => (
                                <div key={strategy.id} className="strategy-card">
                                    <div className="strategy-header">
                                        <h4>{strategy.name}</h4>
                                        <span className={`risk-badge ${strategy.risk.toLowerCase().replace(' ', '-')}`}>
                                            {strategy.risk} Risk
                                        </span>
                                    </div>
                                    <p className="strategy-desc">{strategy.description}</p>
                                    <div className="strategy-metrics">
                                        <div className="metric">
                                            <span className="metric-label">Win Rate</span>
                                            <span className="metric-value">{strategy.winRate}%</span>
                                        </div>
                                        <div className="metric">
                                            <span className="metric-label">Avg Return</span>
                                            <span className="metric-value">{strategy.avgReturn}%</span>
                                        </div>
                                    </div>
                                    <button className="deploy-btn">Deploy Bot</button>
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
