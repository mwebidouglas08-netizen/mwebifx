import { useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { HubContractType, HubTradeRow } from '@/bot/engine/hub-session';
import { useHubSession } from '@/bot/use-hub-session';
import { SymbolSeries } from '@/bot/deriv/ticks';
import { VOL_MARKETS } from '../hub/markets';
import '../hub/hub-shared.scss';
import './quick-bot.scss';

type TradeType = 'EVEN_ODD' | 'OVER_UNDER' | 'MATCHES_DIFFERS' | 'RISE_FALL';
type PatternMode = 'OFF' | 'EVERY_TRADE' | 'EVERY_N' | 'FIRST_ENTRY' | 'AFTER_LOSS';

interface PatternRule {
    mode: PatternMode;
    everyN: number;
    whenDigitAtMost: number;
    thenOver: number;
    whenDigitAtLeast: number;
    thenUnder: number;
}

interface PercentRule {
    enabled: boolean;
    trigger: 'ON_FIRST_ENTRY' | 'ON_EVERY_TRADE' | 'AFTER_EVERY_3' | 'AFTER_LOSS';
    window: number;
    evenAtLeast: number;
    oddAtLeast: number;
}

interface QuickPreset {
    name: string;
    stake: number;
    takeProfit: number;
    stopLoss: number;
    martingale: number;
    pattern: PatternRule;
    percent: PercentRule;
}

const VERTEX_DIGITS: QuickPreset = {
    name: 'Vertex Digits',
    stake: 1,
    takeProfit: 10,
    stopLoss: 30,
    martingale: 2,
    pattern: { mode: 'EVERY_N', everyN: 3, whenDigitAtMost: 2, thenOver: 2, whenDigitAtLeast: 7, thenUnder: 7 },
    percent: { enabled: true, trigger: 'ON_FIRST_ENTRY', window: 25, evenAtLeast: 55, oddAtLeast: 55 },
};

const QUANTUM_EDGE: QuickPreset = {
    name: 'Quantum Edge AI',
    stake: 0.8,
    takeProfit: 10,
    stopLoss: 30,
    martingale: 2,
    pattern: { mode: 'EVERY_TRADE', everyN: 0, whenDigitAtMost: 1, thenOver: 2, whenDigitAtLeast: 8, thenUnder: 7 },
    percent: { enabled: true, trigger: 'AFTER_EVERY_3', window: 25, evenAtLeast: 55, oddAtLeast: 55 },
};

export const readQuickPreset = (): QuickPreset | null => {
    try {
        const raw = window.sessionStorage.getItem('quick-bot-preset');
        return raw ? (JSON.parse(raw) as QuickPreset) : null;
    } catch {
        return null;
    }
};

const patternTriggered = (mode: PatternMode, n: number, everyN: number, afterLoss: boolean): boolean => {
    switch (mode) {
        case 'OFF':
            return false;
        case 'EVERY_TRADE':
            return true;
        case 'FIRST_ENTRY':
            return n === 0;
        case 'AFTER_LOSS':
            return afterLoss;
        default:
            return n > 0 && n % Math.max(1, everyN) === 0;
    }
};

const percentTriggered = (trigger: PercentRule['trigger'], n: number, afterLoss: boolean): boolean => {
    switch (trigger) {
        case 'ON_FIRST_ENTRY':
            return n === 0;
        case 'ON_EVERY_TRADE':
            return true;
        case 'AFTER_LOSS':
            return afterLoss;
        default:
            return n > 0 && n % 3 === 0;
    }
};

const fmt = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USD`;

export { VERTEX_DIGITS, QUANTUM_EDGE };

const QuickBotPage = observer(() => {
    const [preset] = useState<QuickPreset>(() => readQuickPreset() || VERTEX_DIGITS);
    const [symbol, setSymbol] = useState('R_100');
    const [tradeType, setTradeType] = useState<TradeType>('OVER_UNDER');
    const [prediction, setPrediction] = useState(2);
    const [durationTicks, setDurationTicks] = useState(1);
    const [stake, setStake] = useState(preset.stake);
    const [takeProfit, setTakeProfit] = useState(preset.takeProfit);
    const [stopLoss, setStopLoss] = useState(preset.stopLoss);
    const [martingale, setMartingale] = useState(preset.martingale);
    const [recovery, setRecovery] = useState(true);
    const [pattern, setPattern] = useState<PatternRule>(preset.pattern);
    const [percent, setPercent] = useState<PercentRule>(preset.percent);
    const [analysisOn, setAnalysisOn] = useState(true);

    const tradesRef = useRef(0);
    const lastLossRef = useRef(false);
    const symbolRef = useRef(symbol);
    symbolRef.current = symbol;

    const applyPreset = (p: QuickPreset) => {
        setStake(p.stake);
        setTakeProfit(p.takeProfit);
        setStopLoss(p.stopLoss);
        setMartingale(p.martingale);
        setPattern({ ...p.pattern });
        setPercent({ ...p.percent });
    };

    const cfgRef = useRef({ tradeType, prediction, pattern, percent, analysisOn });
    cfgRef.current = { tradeType, prediction, pattern, percent, analysisOn };

    const resolveIntent = (series: SymbolSeries) => {
        const cfg = cfgRef.current;
        const symbol = symbolRef.current;
        const digits = series.digits;
        if (!cfg.analysisOn || digits.length < 10) return null;
        const last = digits[digits.length - 1];
        const n = tradesRef.current;
        const afterLoss = lastLossRef.current;

        if (cfg.percent.enabled) {
            const window = digits.slice(-Math.max(2, cfg.percent.window));
            const evens = window.filter(d => d % 2 === 0).length;
            const pct = (evens * 100) / window.length;
            const triggerOk = percentTriggered(cfg.percent.trigger, n, afterLoss);
            if (triggerOk && pct >= cfg.percent.evenAtLeast) return { symbol, contractType: 'DIGITEVEN' as HubContractType };
            if (triggerOk && pct <= 100 - cfg.percent.oddAtLeast) return { symbol, contractType: 'DIGITODD' as HubContractType };
        }

        const patternOk = patternTriggered(cfg.pattern.mode, n, cfg.pattern.everyN, afterLoss);
        if (patternOk) {
            if (last <= cfg.pattern.whenDigitAtMost) {
                return { symbol, contractType: 'DIGITOVER' as HubContractType, barrier: cfg.pattern.thenOver };
            }
            if (last >= cfg.pattern.whenDigitAtLeast) {
                return { symbol, contractType: 'DIGITUNDER' as HubContractType, barrier: cfg.pattern.thenUnder };
            }
        }
        return null;
    };

    const { session, snap } = useHubSession(() => ({
        symbols: VOL_MARKETS.map(m => m.symbol),
        stake: preset.stake,
        martingale: preset.martingale,
        takeProfit: preset.takeProfit,
        stopLoss: preset.stopLoss,
        durationTicks: 1,
        nameOf: s => VOL_MARKETS.find(m => m.symbol === s)?.name || s,
        evaluate: (_symbol: string, series: SymbolSeries) => resolveIntent(series),
    }));

    const sync = (patch: { stake?: number; takeProfit?: number; stopLoss?: number; martingale?: number; durationTicks?: number }) => {
        if (patch.stake !== undefined) setStake(patch.stake);
        if (patch.takeProfit !== undefined) setTakeProfit(patch.takeProfit);
        if (patch.stopLoss !== undefined) setStopLoss(patch.stopLoss);
        if (patch.martingale !== undefined) setMartingale(patch.martingale);
        if (patch.durationTicks !== undefined) setDurationTicks(patch.durationTicks);
        session.updateOptions({
            stake: patch.stake ?? stake,
            takeProfit: patch.takeProfit ?? takeProfit,
            stopLoss: patch.stopLoss ?? stopLoss,
            martingale: recovery ? (patch.martingale ?? martingale) : 1,
            durationTicks: patch.durationTicks ?? durationTicks,
        });
    };

    const onBuy = (contractType: HubContractType, barrier?: number) => {
        const run = async () => {
            const row: HubTradeRow | null = await session.buyOnce({ symbol, contractType, barrier });
            if (row) {
                tradesRef.current += 1;
                lastLossRef.current = row.result === 'loss';
            }
        };
        void run();
    };

    const seriesDigits = useMemo(() => snap.digits[symbol] || [], [snap.digits, symbol]);

    return (
        <div className='hub-page quick-bot'>
            <div className='hub-page__hero'>
                <div>
                    <h1 className='hub-page__title'>Quick Bot</h1>
                    <p className='hub-page__subtitle'>
                        Deriv-style quick strategy. Pick a market and contract, tune the trade &amp; bot parameters,
                        and let Pattern or Percentage analysis trigger purchases automatically.
                    </p>
                </div>
                <div className='hub-page__actions'>
                    <span className={`hub-pill ${snap.running ? '' : 'hub-pill--grey'}`}>{snap.running ? 'Running' : 'Idle'}</span>
                    {snap.running ? (
                        <button type='button' className='hub-btn hub-btn--stop' onClick={() => session.stop()}>
                            Stop bot
                        </button>
                    ) : (
                        <button type='button' className='hub-btn' onClick={() => session.start()}>
                            ▶ Start bot
                        </button>
                    )}
                </div>
            </div>

            <section className='quick-bot__presets'>
                <article className={`quick-bot__preset ${preset.name === VERTEX_DIGITS.name ? 'is-active' : ''}`}>
                    <header>
                        <span className='hub-pill'>Quick</span>
                        <h3>Vertex Digits</h3>
                    </header>
                    <p>Over/Under bias after every 3 trades + Even/Odd percentage gate on first entry.</p>
                    <button type='button' className='hub-btn hub-btn--ghost' onClick={() => applyPreset(VERTEX_DIGITS)}>
                        Load preset
                    </button>
                </article>
                <article className={`quick-bot__preset ${preset.name === QUANTUM_EDGE.name ? 'is-active' : ''}`}>
                    <header>
                        <span className='hub-pill'>Quick</span>
                        <h3>Quantum Edge AI</h3>
                    </header>
                    <p>Extreme-digit Over/Under on every trade, percentage reversal after every 3 trades.</p>
                    <button type='button' className='hub-btn hub-btn--ghost' onClick={() => applyPreset(QUANTUM_EDGE)}>
                        Load preset
                    </button>
                </article>
            </section>

            <div className='quick-bot__cols'>
                <section className='hub-page__panel'>
                    <header>
                        <h2>Trade parameters</h2>
                    </header>
                    <div className='quick-bot__form'>
                        <label className='hub-field'>
                            <span>Market</span>
                            <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                                {VOL_MARKETS.map(m => (
                                    <option key={m.symbol} value={m.symbol}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className='hub-field'>
                            <span>Trade type</span>
                            <select value={tradeType} onChange={e => setTradeType(e.target.value as TradeType)}>
                                <option value='OVER_UNDER'>Over/Under</option>
                                <option value='EVEN_ODD'>Even/Odd</option>
                                <option value='MATCHES_DIFFERS'>Matches/Differs</option>
                                <option value='RISE_FALL'>Rise/Fall</option>
                            </select>
                        </label>
                        {(tradeType === 'OVER_UNDER' || tradeType === 'MATCHES_DIFFERS') && (
                            <label className='hub-field'>
                                <span>Prediction</span>
                                <input
                                    type='number'
                                    min='0'
                                    max='9'
                                    value={prediction}
                                    onChange={e => setPrediction(Math.min(9, Math.max(0, Number(e.target.value))))}
                                />
                            </label>
                        )}
                        <label className='hub-field'>
                            <span>Duration (ticks)</span>
                            <input type='number' min='1' max='10' value={durationTicks} onChange={e => sync({ durationTicks: Math.max(1, Number(e.target.value)) })} />
                        </label>
                        <div className='quick-bot__price'>
                            <span>Last digits</span>
                            <span className='hub-digits'>
                                {seriesDigits.length ? seriesDigits.slice(-8).map((d, i) => <i key={`${symbol}-${i}`}>{d}</i>) : '—'}
                            </span>
                        </div>
                    </div>
                </section>

                <section className='hub-page__panel'>
                    <header>
                        <h2>Bot parameters</h2>
                    </header>
                    <div className='quick-bot__form'>
                        <label className='hub-field'>
                            <span>Stake</span>
                            <input type='number' min='0.35' step='0.1' value={stake} onChange={e => sync({ stake: Number(e.target.value) })} />
                        </label>
                        <label className='hub-field'>
                            <span>Take profit</span>
                            <input type='number' min='0' step='1' value={takeProfit} onChange={e => sync({ takeProfit: Number(e.target.value) })} />
                        </label>
                        <label className='hub-field'>
                            <span>Stop loss</span>
                            <input type='number' min='0' step='1' value={stopLoss} onChange={e => sync({ stopLoss: Number(e.target.value) })} />
                        </label>
                        <label className='hub-field'>
                            <span>Martingale</span>
                            <select value={martingale} onChange={e => sync({ martingale: Number(e.target.value) })} disabled={!recovery}>
                                <option value={1}>OFF</option>
                                <option value={1.5}>×1.5</option>
                                <option value={2}>×2</option>
                                <option value={3}>×3</option>
                            </select>
                        </label>
                        <label className='quick-bot__toggle'>
                            <input type='checkbox' checked={recovery} onChange={e => { setRecovery(e.target.checked); sync({ martingale: e.target.checked ? martingale : 1 }); }} />
                            <span>Recovery system</span>
                        </label>
                    </div>
                </section>
            </div>

            <div className='quick-bot__cols'>
                <section className='hub-page__panel'>
                    <header>
                        <h2>Pattern analysis</h2>
                        <label className='quick-bot__mini'>
                            <input type='checkbox' checked={analysisOn} onChange={e => setAnalysisOn(e.target.checked)} />
                            Enable analysis
                        </label>
                    </header>
                    <div className='quick-bot__form'>
                        <label className='hub-field'>
                            <span>Trigger</span>
                            <select value={pattern.mode} onChange={e => setPattern({ ...pattern, mode: e.target.value as PatternMode })}>
                                <option value='OFF'>Disabled</option>
                                <option value='EVERY_TRADE'>On every trade</option>
                                <option value='EVERY_N'>After every N trades</option>
                                <option value='FIRST_ENTRY'>On first entry only</option>
                                <option value='AFTER_LOSS'>After loss only</option>
                            </select>
                        </label>
                        {pattern.mode === 'EVERY_N' && (
                            <label className='hub-field'>
                                <span>N</span>
                                <input type='number' min='1' value={pattern.everyN} onChange={e => setPattern({ ...pattern, everyN: Number(e.target.value) })} />
                            </label>
                        )}
                        <label className='hub-field'>
                            <span>If last digit ≤</span>
                            <input type='number' min='0' max='8' value={pattern.whenDigitAtMost} onChange={e => setPattern({ ...pattern, whenDigitAtMost: Number(e.target.value) })} />
                        </label>
                        <label className='hub-field'>
                            <span>Then Over</span>
                            <input type='number' min='1' max='9' value={pattern.thenOver} onChange={e => setPattern({ ...pattern, thenOver: Number(e.target.value) })} />
                        </label>
                        <label className='hub-field'>
                            <span>If last digit ≥</span>
                            <input type='number' min='1' max='9' value={pattern.whenDigitAtLeast} onChange={e => setPattern({ ...pattern, whenDigitAtLeast: Number(e.target.value) })} />
                        </label>
                        <label className='hub-field'>
                            <span>Then Under</span>
                            <input type='number' min='0' max='8' value={pattern.thenUnder} onChange={e => setPattern({ ...pattern, thenUnder: Number(e.target.value) })} />
                        </label>
                    </div>
                </section>

                <section className='hub-page__panel'>
                    <header>
                        <h2>Percentage analysis</h2>
                        <label className='quick-bot__mini'>
                            <input type='checkbox' checked={percent.enabled} onChange={e => setPercent({ ...percent, enabled: e.target.checked })} />
                            Enabled
                        </label>
                    </header>
                    <div className='quick-bot__form'>
                        <label className='hub-field'>
                            <span>Trigger</span>
                            <select value={percent.trigger} onChange={e => setPercent({ ...percent, trigger: e.target.value as PercentRule['trigger'] })}>
                                <option value='ON_FIRST_ENTRY'>On first entry only</option>
                                <option value='ON_EVERY_TRADE'>On every trade</option>
                                <option value='AFTER_EVERY_3'>After every 3 trades</option>
                                <option value='AFTER_LOSS'>After loss only</option>
                            </select>
                        </label>
                        <label className='hub-field'>
                            <span>Window</span>
                            <input type='number' min='5' max='100' value={percent.window} onChange={e => setPercent({ ...percent, window: Number(e.target.value) })} />
                        </label>
                        <label className='hub-field'>
                            <span>Even % ≥</span>
                            <input type='number' min='50' max='100' value={percent.evenAtLeast} onChange={e => setPercent({ ...percent, evenAtLeast: Number(e.target.value) })} />
                        </label>
                        <label className='hub-field'>
                            <span>Odd % ≥</span>
                            <input type='number' min='50' max='100' value={percent.oddAtLeast} onChange={e => setPercent({ ...percent, oddAtLeast: Number(e.target.value) })} />
                        </label>
                    </div>
                </section>
            </div>

            <section className='hub-page__panel quick-bot__purchase'>
                <header>
                    <h2>Purchase</h2>
                    <span className='quick-bot__pnl hub-page__mono'>
                        P/L {fmt(snap.profit)} · {snap.trades} trades ({snap.wins}W / {snap.losses}L)
                    </span>
                </header>
                <div className='quick-bot__purchase-row'>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => onBuy('DIGITEVEN')}>
                        Even
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => onBuy('DIGITODD')}>
                        Odd
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => onBuy('DIGITOVER', prediction)}>
                        Over {prediction}
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => onBuy('DIGITUNDER', prediction)}>
                        Under {prediction}
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => onBuy('DIGITMATCH', prediction)}>
                        Matches {prediction}
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => onBuy('DIGITDIFF', prediction)}>
                        Differs {prediction}
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => onBuy('CALL')}>
                        Rise
                    </button>
                    <button type='button' className='hub-btn' disabled={snap.busy} onClick={() => onBuy('PUT')}>
                        Fall
                    </button>
                </div>
                <table className='hub-table'>
                    <thead>
                        <tr>
                            <th>Market</th>
                            <th>Contract</th>
                            <th>Stake</th>
                            <th>P/L</th>
                        </tr>
                    </thead>
                    <tbody>
                        {snap.rows.length ? (
                            snap.rows.map(r => (
                                <tr key={r.id}>
                                    <td>{r.name}</td>
                                    <td>{r.contract}</td>
                                    <td className='hub-page__mono'>{r.stake.toFixed(2)}</td>
                                    <td className={`hub-page__mono ${r.result === 'win' ? 'is-win' : 'is-loss'}`}>{fmt(r.profit)}</td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={4} className='hub-page__empty'>
                                    Manual purchases appear here.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </section>
        </div>
    );
});

export default QuickBotPage;
