export type HubViewId =
    | 'dashboard'
    | 'bot-builder'
    | 'volt-ai'
    | 'free-bots'
    | 'premium-ai'
    | 'quick-bot'
    | 'analysis-tools'
    | 'hedging-tool'
    | 'auto-ai'
    | 'signal-ai'
    | 'manual-trader'
    | 'bulk-trader'
    | 'apex-bot'
    | 'copy-trader'
    | 'speedbot'
    | 'automated'
    | 'chart'
    | 'ai-hub'
    | 'ou-bot'
    | 'ai-scanner'
    | 'pro-ai'
    | 'dual-edge'
    | 'algo-pro-ai'
    | 'backtest'
    | 'trading-bots'
    | 'analysis-tool'
    | 'copy-trading'
    | 'tradingview';

export const HUB_VIEW_LABELS: Record<HubViewId, string> = {
    dashboard: 'Dashboard',
    'bot-builder': 'Bot Builder',
    'volt-ai': 'Volt AI',
    'free-bots': 'Free Bots',
    'premium-ai': 'Premium AI Bots',
    'quick-bot': 'Quick Bot',
    'analysis-tools': 'Analysis Tools',
    'hedging-tool': 'Hedging Tool',
    'auto-ai': 'Auto AI',
    'signal-ai': 'Signal AI',
    'manual-trader': 'Manual Trader',
    'bulk-trader': 'Bulk Trader',
    'apex-bot': 'Apex Bot',
    'copy-trader': 'Copy Trader',
    speedbot: 'Speedbot',
    automated: 'Automated',
    chart: 'Chart',
    'ai-hub': 'AI Trading Hub',
    'ou-bot': 'Over / Under Bot',
    'ai-scanner': 'AI Signal Scanner',
    'pro-ai': 'Pro AI',
    'dual-edge': 'Dual Edge',
    'algo-pro-ai': 'Algo Pro AI',
    backtest: 'Backtest',
    'trading-bots': 'Trading Bots',
    'analysis-tool': 'Analysis Tool',
    'copy-trading': 'Copy Trading',
    tradingview: 'TradingView',
};

/** Visible tab strip in the reference order. */
export const HUB_TAB_ORDER: HubViewId[] = [
    'dashboard',
    'bot-builder',
    'volt-ai',
    'free-bots',
    'premium-ai',
    'quick-bot',
    'analysis-tools',
    'hedging-tool',
    'auto-ai',
    'signal-ai',
    'manual-trader',
    'bulk-trader',
    'apex-bot',
    'copy-trader',
    'speedbot',
    'automated',
    'chart',
];
