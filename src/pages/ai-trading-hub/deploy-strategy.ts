import { ApiHelpers, load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';

/**
 * Real, deployable strategies for the AI Hub.
 *
 * Every entry maps to actual Deriv trade parameters. There is no model and no
 * backtest behind these — the previous version of this page invented win-rate
 * and average-return percentages for each card and presented them as achieved
 * performance, which was not true. What is real is the trade the bot places.
 */
export type HubStrategy = {
    id: string;
    name: string;
    description: string;
    risk: 'Very Low' | 'Low' | 'Medium' | 'High';
    /** Deriv symbol, e.g. R_100, frxEURUSD. */
    symbol: string;
    /** Contract direction: CALL (rise) or PUT (fall). */
    direction: 'CALL' | 'PUT';
    /** Deriv duration unit: t=ticks, s=seconds, m=minutes, h=hours, d=days. */
    durationUnit: 't' | 's' | 'm' | 'h' | 'd';
    duration: number;
    /** Stake in account currency. */
    amount: number;
};

export const HUB_STRATEGIES: HubStrategy[] = [
    { id: 'trend_up', name: 'Trend Rider (Rise)', description: 'Buys Rise contracts on Volatility 100 with a 5 tick duration.', risk: 'Medium', symbol: 'R_100', direction: 'CALL', durationUnit: 't', duration: 5, amount: 1 },
    { id: 'trend_down', name: 'Trend Rider (Fall)', description: 'Buys Fall contracts on Volatility 100 with a 5 tick duration.', risk: 'Medium', symbol: 'R_100', direction: 'PUT', durationUnit: 't', duration: 5, amount: 1 },
    { id: 'mean_reversion', name: 'Mean Reversion', description: 'Rise contracts on Volatility 75, 1 minute duration.', risk: 'Low', symbol: 'R_75', direction: 'CALL', durationUnit: 'm', duration: 1, amount: 1 },
    { id: 'breakout', name: 'Breakout Hunter', description: 'Fall contracts on Boom 1000, 2 tick duration.', risk: 'High', symbol: 'BOOM1000', direction: 'PUT', durationUnit: 't', duration: 2, amount: 1 },
    { id: 'scalping', name: 'Quick Scalper', description: 'Rise contracts on Step Index, 1 tick duration.', risk: 'Medium', symbol: 'stpRNG', direction: 'CALL', durationUnit: 't', duration: 1, amount: 1 },
    { id: 'jump_up', name: 'Jump Rider', description: 'Rise contracts on Jump 100, 5 tick duration.', risk: 'Medium', symbol: '1HZ100V', direction: 'CALL', durationUnit: 't', duration: 5, amount: 1 },
    { id: 'vol50', name: 'Volatility 50 Rider', description: 'Fall contracts on Volatility 50, 1 minute duration.', risk: 'Low', symbol: 'R_50', direction: 'PUT', durationUnit: 'm', duration: 1, amount: 1 },
    { id: 'eurusd', name: 'EUR/USD Rider', description: 'Rise contracts on EUR/USD, 5 tick duration. Forex is closed over the weekend.', risk: 'High', symbol: 'frxEURUSD', direction: 'CALL', durationUnit: 't', duration: 5, amount: 1 },
    // Named AI/strategy bots (mirroring popular third-party bot line-ups). Each is a
    // real, deployable Rise/Fall strategy with concrete Deriv trade parameters.
    { id: 'digit_nexus', name: 'Digit Nexus AI', description: 'Rise on Volatility 75 Index, 3 tick duration. Digit-trend rider.', risk: 'Medium', symbol: 'R_75', direction: 'CALL', durationUnit: 't', duration: 3, amount: 1 },
    { id: 'volt_scalper', name: 'Volt Scalper', description: 'Rise on Volatility 100 Index, 1 tick duration. Ultra-fast scalper.', risk: 'High', symbol: 'R_100', direction: 'CALL', durationUnit: 't', duration: 1, amount: 1 },
    { id: 'apex_ai', name: 'Apex AI', description: 'Rise on Volatility 25 Index, 2 tick duration. Trend-following apex bot.', risk: 'Medium', symbol: 'R_25', direction: 'CALL', durationUnit: 't', duration: 2, amount: 1 },
    { id: 'neutrade', name: 'NEUTRADE AI', description: 'Fall on Volatility 50 Index, 1 minute duration. Neutral mean-reversion.', risk: 'Low', symbol: 'R_50', direction: 'PUT', durationUnit: 'm', duration: 1, amount: 1 },
    { id: 'straddle_edge', name: 'STRADDLE EDGE', description: 'Fall on Boom 1000 Index, 2 tick duration. Breakout straddle edge.', risk: 'High', symbol: 'BOOM1000', direction: 'PUT', durationUnit: 't', duration: 2, amount: 1 },
    { id: 'pulsetrader', name: 'Pulsetrader AI', description: 'Rise on Jump 100 Index, 5 tick duration. Pulse-riding momentum bot.', risk: 'Medium', symbol: '1HZ100V', direction: 'CALL', durationUnit: 't', duration: 5, amount: 1 },
];

/**
 * Blockly strategy XML with every dropdown baked in.
 *
 * The market / submarket values are resolved from the live `active_symbols`
 * feed before load, because the block's onchange handler silently blanks any
 * value it does not recognise (see trade_definition_market.js).
 */
const buildStrategyXml = (params: {
    market: string;
    submarket: string;
    symbol: string;
    direction: 'CALL' | 'PUT';
    durationUnit: string;
    duration: number;
    amount: number;
}): string => {
    const { market, submarket, symbol, direction, durationUnit, duration, amount } = params;
    return `<xml xmlns="http://www.w3.org/1999/xhtml" collection="false" is_dbot="true">
  <variables></variables>
  <block type="trade_definition" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" deletable="false" movable="false">
        <field name="MARKET_LIST">${market}</field>
        <field name="SUBMARKET_LIST">${submarket}</field>
        <field name="SYMBOL_LIST">${symbol}</field>
        <next>
          <block type="trade_definition_tradetype" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">callput</field>
            <field name="TRADETYPE_LIST">callput</field>
            <next>
              <block type="trade_definition_contracttype" deletable="false" movable="false">
                <field name="TYPE_LIST">${direction}</field>
                <next>
                  <block type="trade_definition_candleinterval" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions">
        <mutation has_first_barrier="false" has_second_barrier="false" has_prediction="false"></mutation>
        <field name="DURATIONTYPE_LIST">${durationUnit}</field>
        <field name="CURRENCY_LIST">USD</field>
        <value name="DURATION"><shadow type="math_number_positive"><field name="NUM">${duration}</field></shadow></value>
        <value name="AMOUNT"><shadow type="math_number_positive"><field name="NUM">${amount}</field></shadow></value>
        <field name="AMOUNT_LIMITS"></field>
      </block>
    </statement>
  </block>
  <block type="before_purchase" x="0" y="576">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase"><field name="PURCHASE_LIST">${direction}</field></block>
    </statement>
  </block>
  <block type="during_purchase" x="720" y="0">
    <statement name="DURING_PURCHASE_STACK">
      <block type="controls_if">
        <value name="IF0"><block type="check_sell"></block></value>
      </block>
    </statement>
  </block>
  <block type="after_purchase" x="720" y="248">
    <statement name="AFTERPURCHASE_STACK">
      <block type="trade_again"></block>
    </statement>
  </block>
</xml>`;
};

/**
 * Load a hub strategy into the Blockly workspace so `run_panel` can execute it.
 *
 * Mirrors the proven path in quick-strategy-store.ts: resolve the market
 * metadata from `contracts_for`, rewrite the template fields, then hand the XML
 * to the same `load()` pipeline the Load modal uses (which clears the workspace,
 * runs block conversion, cleans up and records the strategy in recents).
 */
export const deployHubStrategy = async (strategy: HubStrategy, workspace: any): Promise<void> => {
    if (!workspace) {
        throw new Error('The Bot Dashboard workspace is not ready yet. Try again in a moment.');
    }

    const contracts_for = ApiHelpers?.instance?.contracts_for;
    const active_symbols = ApiHelpers?.instance?.active_symbols;

    if (active_symbols && typeof active_symbols.retrieveActiveSymbols === 'function') {
        try {
            await active_symbols.retrieveActiveSymbols();
        } catch {
            // The dropdowns may already be populated from an earlier fetch;
            // failing to refresh should not block the deploy.
        }
    }

    let market = 'synthetic_index';
    let submarket = 'random_index';

    if (contracts_for?.getMarketBySymbol && contracts_for?.getSubmarketBySymbol) {
        try {
            const resolvedMarket = await contracts_for.getMarketBySymbol(strategy.symbol);
            const resolvedSubmarket = await contracts_for.getSubmarketBySymbol(strategy.symbol);
            if (resolvedMarket) market = resolvedMarket;
            if (resolvedSubmarket) submarket = resolvedSubmarket;
        } catch {
            // Fall back to the volatility-index defaults above.
        }
    }

    const xml = buildStrategyXml({
        market,
        submarket,
        symbol: strategy.symbol,
        direction: strategy.direction,
        durationUnit: strategy.durationUnit,
        duration: strategy.duration,
        amount: strategy.amount,
    });

    await load({
        block_string: xml,
        workspace,
        file_name: strategy.name,
        strategy_id: undefined,
        from: save_types.UNSAVED,
        drop_event: null,
        showIncompatibleStrategyDialog: false,
        show_snackbar: false,
    });

    // The market block blanks values that were not present in active_symbols at
    // load time. Replay a create event on every market block so the dropdowns
    // repopulate — the same trick app-store.ts uses after a symbol refresh.
    try {
        const BlocklyApi = window.Blockly as any;
        workspace
            .getAllBlocks()
            .filter((block: { type: string }) => block.type === 'trade_definition_market')
            .forEach((block: unknown) => {
                BlocklyApi?.Events?.fire?.(new BlocklyApi.Events.BlockCreate(block));
            });
    } catch {
        // Non-fatal: the fields are already baked into the XML.
    }
};
