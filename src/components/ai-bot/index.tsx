import { useMemo, useState } from 'react';
import { useAIBot } from '@/bot/use-engine';
import { aiBot } from '@/bot/engine/ai-bot';
import {
    AIBotEvent,
    PURCHASE_LABEL,
    PurchaseRule,
    PurchaseType,
} from '@/bot/core/ai-bot-types';
import './ai-bot.scss';

const CURATED_SYMBOLS = [
    { symbol: 'R_10', name: 'Volatility 10' },
    { symbol: 'R_25', name: 'Volatility 25' },
    { symbol: 'R_50', name: 'Volatility 50' },
    { symbol: 'R_75', name: 'Volatility 75' },
    { symbol: 'R_100', name: 'Volatility 100' },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s)' },
    { symbol: 'BOOM1000', name: 'Boom 1000' },
    { symbol: 'stpRNG', name: 'Step Index' },
];

const PURCHASE_TYPES: PurchaseType[] = [
    'DIGITOVER',
    'DIGITUNDER',
    'DIGITEVEN',
    'DIGITODD',
    'DIGITMATCH',
    'DIGITDIFF',
    'CALL',
    'PUT',
];

const statusTone = (s: string): string => {
    if (s === 'error' || s === 'suspended') return 'danger';
    if (s === 'scanning' || s === 'monitoring' || s === 'buying' || s === 'proposing') return 'live';
    if (s === 'starting') return 'warn';
    return 'idle';
};

const EVENT_TONE: Record<AIBotEvent['type'], string> = {
    status: 'muted',
    scan: 'muted',
    decision: 'info',
    quote: 'info',
    purchase: 'buy',
    settlement: 'settle',
    risk: 'warn',
    error: 'danger',
};

interface FieldProps {
    label: string;
    children: React.ReactNode;
}
const Field = ({ label, children }: FieldProps) => (
    <label className='ai-field'>
        <span className='ai-field__label'>{label}</span>
        {children}
    </label>
);

const NumberField = ({ label, value, onChange, step, min, max }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number }) => (
    <Field label={label}>
        <input
            type='number'
            value={value}
            step={step}
            min={min}
            max={max}
            onChange={e => onChange(Number(e.target.value))}
        />
    </Field>
);

const AIBotPanel = ({ onClose }: { onClose: () => void }) => {
    const state = useAIBot();
    const cfg = state.config;
    const [section, setSection] = useState<'strategy' | 'risk' | 'markets' | 'activity'>('markets');
    const [pendingLive, setPendingLive] = useState(false);

    const running = ['starting', 'scanning', 'proposing', 'buying', 'monitoring'].includes(state.status);
    const winRate = state.stats.trades > 0 ? Math.round((state.stats.wins / state.stats.trades) * 100) : 0;

    const watched = useMemo(() => {
        const selected = new Set(cfg.symbols);
        return CURATED_SYMBOLS.map(s => ({ ...s, on: selected.has(s.symbol) }));
    }, [cfg.symbols]);

    const toggleSymbol = (symbol: string) => {
        const set = new Set(cfg.symbols);
        if (set.has(symbol)) set.delete(symbol);
        else set.add(symbol);
        aiBot.configure({ symbols: [...set] });
    };

    const updateRule = (list: PurchaseRule[], id: string, patch: Partial<PurchaseRule>): PurchaseRule[] =>
        list.map(r => (r.id === id ? { ...r, ...patch } : r));

    const start = () => {
        const payload: Record<string, unknown> = {};
        if (cfg.symbols.length) payload.symbols = cfg.symbols;
        aiBot.start(payload as any);
    };

    const toggleLive = () => {
        if (!state.liveTrading && !state.accountIsDemo) {
            setPendingLive(true);
            return;
        }
        aiBot.setLiveTrading(!state.liveTrading);
    };

    const renderRule = (rule: PurchaseRule, listName: 'rules' | 'recoveryRules') => (
        <div className='ai-rule' key={rule.id}>
            <span className={`ai-rule__logic ${rule.logic === 'if' ? 'ai-rule__logic--if' : ''}`}>{rule.logic === 'if' ? 'IF' : 'ELSE IF'}</span>
            <div className='ai-rule__body'>
                {rule.analysisType === 'percentage' ? (
                    <span>
                        {rule.percentageType} {rule.comparison === 'less_or_equal' ? '≤' : '≥'} {rule.percentageThreshold}% over {rule.sampleSize}
                    </span>
                ) : rule.analysisType === 'all_even' || rule.analysisType === 'all_odd' ? (
                    <span>last {rule.count} are {rule.analysisType === 'all_even' ? 'even' : 'odd'}</span>
                ) : (
                    <span>last digit {rule.operator === 'less_or_equal' ? '≤' : '≥'} {rule.digit}</span>
                )}
                <span className='ai-rule__arrow'>→</span>
                <select
                    value={rule.purchase}
                    onChange={e => aiBot.configure({ [listName]: updateRule(cfg[listName], rule.id, { purchase: e.target.value as PurchaseType }) } as any)}
                >
                    {PURCHASE_TYPES.map(p => <option key={p} value={p}>{PURCHASE_LABEL[p]}</option>)}
                </select>
                {(rule.purchase === 'DIGITOVER' || rule.purchase === 'DIGITUNDER' || rule.purchase === 'DIGITMATCH' || rule.purchase === 'DIGITDIFF') && (
                    <input
                        className='ai-rule__pred'
                        type='number'
                        min={0}
                        max={9}
                        value={rule.prediction ?? cfg.prediction}
                        onChange={e => aiBot.configure({ [listName]: updateRule(cfg[listName], rule.id, { prediction: Number(e.target.value) }) } as any)}
                    />
                )}
            </div>
            <label className='ai-rule__toggle' title={rule.enabled ? 'Enabled' : 'Disabled'}>
                <input
                    type='checkbox'
                    checked={rule.enabled}
                    onChange={e => aiBot.configure({ [listName]: updateRule(cfg[listName], rule.id, { enabled: e.target.checked }) } as any)}
                />
            </label>
        </div>
    );

    const eventLabel: Record<AIBotEvent['type'], string> = {
        status: 'Status', scan: 'Scan', decision: 'Decision', quote: 'Quote',
        purchase: 'Buy', settlement: 'Settle', risk: 'Risk', error: 'Error',
    };

    return (
        <div className='ai-panel' role='dialog' aria-label='AI Bot'>
            <header className='ai-panel__head'>
                <div className='ai-panel__title'>
                    <span className='ai-panel__badge'>AI</span>
                    <div>
                        <strong>AI Bot</strong>
                        <span className={`ai-panel__status ai-panel__status--${statusTone(state.status)}`}>
                            {state.status}
                        </span>
                    </div>
                </div>
                <button type='button' className='ai-panel__min' onClick={onClose} aria-label='Minimize AI Bot'>–</button>
            </header>

            <div className='ai-panel__message'>{state.message}</div>

            <div className='ai-panel__controls'>
                {!running ? (
                    <button type='button' className='ai-btn ai-btn--start' onClick={start}>▶ Start</button>
                ) : (
                    <button type='button' className='ai-btn ai-btn--stop' onClick={() => aiBot.stop()}>■ Stop</button>
                )}
                <button type='button' className='ai-btn ai-btn--ghost' onClick={() => aiBot.emergencyStop()}>E-Stop</button>
                <label className={`ai-switch ${cfg.autoTrade ? 'ai-switch--on' : ''}`}>
                    <input type='checkbox' checked={cfg.autoTrade} onChange={e => aiBot.configure({ autoTrade: e.target.checked })} />
                    Auto-trade
                </label>
                <label className={`ai-switch ${state.liveTrading ? 'ai-switch--on ai-switch--live' : ''}`} onClick={e => { if (state.liveTrading) { e.preventDefault(); aiBot.setLiveTrading(false); } }}>
                    <input type='checkbox' checked={state.liveTrading} readOnly onClick={toggleLive} onChange={() => undefined} />
                    Live
                </label>
            </div>

            {pendingLive && (
                <div className='ai-confirm'>
                    <span>Enable real-money trading? Orders will use your real balance.</span>
                    <div>
                        <button type='button' className='ai-btn ai-btn--danger' onClick={() => { aiBot.setLiveTrading(true); setPendingLive(false); }}>Confirm live</button>
                        <button type='button' className='ai-btn ai-btn--ghost' onClick={() => setPendingLive(false)}>Cancel</button>
                    </div>
                </div>
            )}

            <nav className='ai-tabs'>
                {(['markets', 'strategy', 'risk', 'activity'] as const).map(t => (
                    <button key={t} type='button' className={`ai-tab ${section === t ? 'active' : ''}`} onClick={() => setSection(t)}>
                        {t === 'markets' ? 'Markets' : t === 'strategy' ? 'Strategy' : t === 'risk' ? 'Risk' : 'Activity'}
                    </button>
                ))}
            </nav>

            <div className='ai-panel__body'>
                {section === 'markets' && (
                    <>
                        <div className='ai-stats'>
                            <div><span>Scans</span><strong>{state.stats.scans}</strong></div>
                            <div><span>Decisions</span><strong>{state.stats.decisions}</strong></div>
                            <div><span>Trades</span><strong>{state.stats.trades}</strong></div>
                            <div><span>Win rate</span><strong>{winRate}%</strong></div>
                            <div><span>Net P/L</span><strong className={state.stats.netPnl >= 0 ? 'pos' : 'neg'}>{state.stats.netPnl >= 0 ? '+' : ''}{state.stats.netPnl.toFixed(2)}</strong></div>
                        </div>

                        {state.decision && (
                            <div className='ai-decision'>
                                <span className='ai-decision__tag'>Signal</span>
                                <strong>{state.decision.displayName} · {PURCHASE_LABEL[state.decision.contractType]}{state.decision.prediction !== undefined ? ` ${state.decision.prediction}` : ''}</strong>
                                <span className='ai-decision__why'>{state.decision.rationale}</span>
                            </div>
                        )}

                        <div className='ai-markets'>
                            {state.analyses.length === 0 && <p className='ai-empty'>{running ? 'Collecting ticks…' : 'Start the bot to scan markets.'}</p>}
                            {state.analyses.map(a => (
                                <div className={`ai-market ${a.matchedRuleId ? 'ai-market--match' : ''}`} key={a.symbol}>
                                    <div className='ai-market__top'>
                                        <strong>{a.displayName}</strong>
                                        <span className='ai-market__digits' title='Last digits'>{a.lastDigits.join(' ')}</span>
                                    </div>
                                    <div className='ai-market__pcts'>
                                        <span>Even {a.even}%</span>
                                        <span>Odd {a.odd}%</span>
                                        <span>Over {a.over}%</span>
                                        <span>Under {a.under}%</span>
                                    </div>
                                    {a.rationale && <div className='ai-market__why'>{a.rationale}</div>}
                                </div>
                            ))}
                        </div>

                        <div className='ai-watchlist'>
                            <p className='ai-sub'>Markets to scan</p>
                            <div className='ai-chips'>
                                {watched.map(w => (
                                    <button key={w.symbol} type='button' className={`ai-chip ${w.on ? 'ai-chip--on' : ''}`} onClick={() => toggleSymbol(w.symbol)}>
                                        {w.name}
                                    </button>
                                ))}
                            </div>
                            {cfg.symbols.length === 0 && <p className='ai-hint'>None selected — auto-scans top markets.</p>}
                        </div>
                    </>
                )}

                {section === 'strategy' && (
                    <div className='ai-section'>
                        <p className='ai-sub'>Purchase rules (first match wins)</p>
                        {cfg.rules.map(r => renderRule(r, 'rules'))}

                        <div className='ai-toggle-row'>
                            <label className={`ai-switch ${cfg.recoveryEnabled ? 'ai-switch--on' : ''}`}>
                                <input type='checkbox' checked={cfg.recoveryEnabled} onChange={e => aiBot.configure({ recoveryEnabled: e.target.checked })} />
                                Recovery after loss
                            </label>
                            <label className={`ai-switch ${cfg.martingaleEnabled ? 'ai-switch--on' : ''}`}>
                                <input type='checkbox' checked={cfg.martingaleEnabled} onChange={e => aiBot.configure({ martingaleEnabled: e.target.checked })} />
                                Martingale ×{cfg.martingaleMultiplier}
                            </label>
                        </div>

                        {cfg.recoveryEnabled && (
                            <>
                                <p className='ai-sub'>Recovery rules</p>
                                {cfg.recoveryRules.map(r => renderRule(r, 'recoveryRules'))}
                            </>
                        )}

                        <div className='ai-grid'>
                            <NumberField label='Stake' value={cfg.stake} min={0.35} step={0.35} onChange={v => aiBot.configure({ stake: v })} />
                            <NumberField label='Max stake' value={cfg.maxStake} min={0.35} onChange={v => aiBot.configure({ maxStake: v })} />
                            <NumberField label='Duration (ticks)' value={cfg.duration} min={1} onChange={v => aiBot.configure({ duration: v })} />
                            <NumberField label='Sample size' value={cfg.sampleSize} min={10} onChange={v => aiBot.configure({ sampleSize: v })} />
                            <label className='ai-field'>
                                <span className='ai-field__label'>Scan mode</span>
                                <select value={cfg.scanMode} onChange={e => aiBot.configure({ scanMode: e.target.value as any })}>
                                    <option value='always'>Always</option>
                                    <option value='every_n'>Every N decisions</option>
                                    <option value='on_entry'>On entry only</option>
                                </select>
                            </label>
                            <NumberField label='Scan every N' value={cfg.scanTradeCount} min={1} onChange={v => aiBot.configure({ scanTradeCount: v })} />
                            <NumberField label='Confirm scans' value={cfg.confirmScans} min={1} onChange={v => aiBot.configure({ confirmScans: v })} />
                            <NumberField label='Interval (ms)' value={cfg.scanIntervalMs} min={1000} step={500} onChange={v => aiBot.configure({ scanIntervalMs: v })} />
                        </div>
                    </div>
                )}

                {section === 'risk' && (
                    <div className='ai-section'>
                        <p className='ai-sub'>Session limits</p>
                        <div className='ai-grid'>
                            <NumberField label='Stop loss' value={cfg.stopLoss} min={0} onChange={v => aiBot.configure({ stopLoss: v })} />
                            <NumberField label='Take profit' value={cfg.takeProfit} min={0} onChange={v => aiBot.configure({ takeProfit: v })} />
                            <NumberField label='Max trades (0 = ∞)' value={cfg.maxTrades} min={0} onChange={v => aiBot.configure({ maxTrades: v })} />
                        </div>
                        <div className='ai-riskstate'>
                            <div><span>Status</span><strong className={state.risk.suspended ? 'neg' : 'pos'}>{state.risk.suspended ? state.risk.suspensionReason : 'Active'}</strong></div>
                            <div><span>Consec. losses</span><strong>{state.risk.consecutiveLosses}</strong></div>
                            <div><span>Equity</span><strong>{state.equity.toFixed(2)}</strong></div>
                            <div><span>Using</span><strong>{state.usingRecovery ? 'Recovery rules' : 'Primary rules'}</strong></div>
                        </div>
                        <button type='button' className='ai-btn ai-btn--ghost' onClick={() => aiBot.resetLimits()}>Reset limits</button>
                    </div>
                )}

                {section === 'activity' && (
                    <div className='ai-section'>
                        <p className='ai-sub'>Activity</p>
                        <div className='ai-feed'>
                            {state.events.length === 0 && <p className='ai-empty'>No activity yet.</p>}
                            {state.events.map(ev => (
                                <div className={`ai-feed__row ai-feed__row--${EVENT_TONE[ev.type] || EVENT_TONE[ev.type]}`} key={ev.id}>
                                    <span className={`ai-feed__type ai-feed__type--${EVENT_TONE[ev.type]}`}>{eventLabel[ev.type]}</span>
                                    <span className='ai-feed__msg'>{ev.message}</span>
                                    <span className='ai-feed__time'>{new Date(ev.at).toLocaleTimeString()}</span>
                                </div>
                            ))}
                        </div>

                        <p className='ai-sub'>Recent trades</p>
                        <div className='ai-trades'>
                            {state.trades.length === 0 && <p className='ai-empty'>No trades yet.</p>}
                            {state.trades.slice(0, 20).map(t => (
                                <div className='ai-trade' key={t.id}>
                                    <span className='ai-trade__ct'>{t.contractType}</span>
                                    <span className='ai-trade__sym'>{t.displayName}</span>
                                    <span className='ai-trade__stake'>{t.stake.toFixed(2)}</span>
                                    <span className={`ai-trade__res ${t.result === 'win' ? 'pos' : t.result === 'loss' ? 'neg' : ''}`}>
                                        {t.result === 'win' ? 'WIN' : t.result === 'loss' ? 'LOSS' : t.stage}
                                    </span>
                                    <span className={`ai-trade__pnl ${t.profit >= 0 ? 'pos' : 'neg'}`}>{t.profit >= 0 ? '+' : ''}{(t.profit ?? 0).toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const AIBotDock = () => {
    const state = useAIBot();
    const [open, setOpen] = useState(false);
    const running = ['starting', 'scanning', 'proposing', 'buying', 'monitoring'].includes(state.status);

    return (
        <div className={`ai-dock ${open ? 'ai-dock--open' : ''}`}>
            {open && <AIBotPanel onClose={() => setOpen(false)} />}
            <button
                type='button'
                className={`ai-fab ${running ? 'ai-fab--running' : ''}`}
                onClick={() => setOpen(o => !o)}
                aria-label={open ? 'Minimize AI Bot' : 'Open AI Bot'}
                aria-expanded={open}
            >
                <svg viewBox='0 0 48 48' width='30' height='30' aria-hidden='true'>
                    <rect x='10' y='14' width='28' height='22' rx='6' fill='none' stroke='currentColor' strokeWidth='2.5' />
                    <circle cx='19' cy='25' r='3' fill='currentColor' />
                    <circle cx='29' cy='25' r='3' fill='currentColor' />
                    <path d='M24 8v6M16 36l-3 4M32 36l3 4' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' />
                    <circle cx='24' cy='7' r='2.5' fill='currentColor' />
                </svg>
                <span className='ai-fab__label'>AI</span>
                {running && <span className='ai-fab__ping' />}
            </button>
        </div>
    );
};

export default AIBotDock;
