import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { fetchHistoricalTicks } from '@/bot/deriv/history';
import { executeBuyFresh, monitorUntilSettled, requestQuote, settlementTimeoutMs } from '@/bot/deriv/execution';
import {
    DEFAULT_PRO_AI_OPTIONS,
    PRO_AI_BOTS,
    SCOPE_LABEL,
    evaluateProAiEntry,
    scanProAiMarkets,
    scopeMatches,
    type ProAiCandidate,
    type ProAiEvaluation,
    type ProAiScope,
} from '@/bot/core/pro-ai';
import { winsFor } from '@/bot/core/digit-stats';
import { HubNote, HubPage, HubPageHeader } from '@/components/hub-page';
import './pro-ai.scss';

const SYMBOLS = [
    { symbol: 'R_10', name: 'Volatility 10' },
    { symbol: 'R_25', name: 'Volatility 25' },
    { symbol: 'R_50', name: 'Volatility 50' },
    { symbol: 'R_75', name: 'Volatility 75' },
    { symbol: 'R_100', name: 'Volatility 100' },
    { symbol: '1HZ10V', name: 'Volatility 10 (1s)' },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s)' },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s)' },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s)' },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s)' },
];

const SCOPE_ORDER: ProAiScope[] = ['standard', 'one-second', 'all'];

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const money = (n: number) => `${n.toFixed(2)}`;

const botName = (botId: string): string => PRO_AI_BOTS.find(b => b.id === botId)?.name ?? botId;

const contractLabel = (direction: 'over' | 'under', barrier: number): string =>
    `${direction === 'over' ? 'DIGITOVER' : 'DIGITUNDER'} ${barrier}`;

const newId = (prefix: string): string =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

interface MarketScan {
    symbol: string;
    displayName: string;
    digits: number[];
    pipSize: number;
}

interface BlockedRow {
    symbol: string;
    displayName: string;
    botName: string;
    evaluation: ProAiEvaluation;
}

interface EntryRecord {
    id: string;
    mode: 'paper' | 'demo';
    symbol: string;
    displayName: string;
    contract: string;
    barrier: number;
    stake: number;
    contractId?: number;
    status: 'pending' | 'settled' | 'rejected' | 'unknown';
    result?: 'win' | 'loss';
    note: string;
}

const ProAiPage = observer(() => {
    const { client, run_panel } = useStore() ?? {};
    const isLoggedIn = Boolean(client?.is_logged_in);
    const activeLoginid = client?.loginid || '';
    const isDemo = isDemoAccount(activeLoginid);

    const [scope, setScope] = useState<ProAiScope>('all');
    const [sampleSize, setSampleSize] = useState(DEFAULT_PRO_AI_OPTIONS.sampleSize);
    const [minAiScore, setMinAiScore] = useState(DEFAULT_PRO_AI_OPTIONS.minAiScore);
    const [minRecentWinRate, setMinRecentWinRate] = useState(DEFAULT_PRO_AI_OPTIONS.minRecentWinRate);
    const [stake, setStake] = useState(1);
    const [selected, setSelected] = useState<string[]>(SYMBOLS.map(s => s.symbol));

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warning, setWarning] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [scanned, setScanned] = useState<MarketScan[]>([]);
    const [candidates, setCandidates] = useState<ProAiCandidate[]>([]);
    const [blocked, setBlocked] = useState<BlockedRow[]>([]);
    const [entries, setEntries] = useState<EntryRecord[]>([]);

    const toggleSymbol = (symbol: string) =>
        setSelected(prev => (prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]));

    const pushEntry = (record: EntryRecord) => setEntries(prev => [record, ...prev]);

    const patchEntry = (id: string, patch: Partial<EntryRecord>) =>
        setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));

    const run = async () => {
        const targets = SYMBOLS.filter(s => selected.includes(s.symbol) && scopeMatches(scope, s.symbol));
        if (targets.length === 0) {
            setError('Select at least one market that matches the chosen scope.');
            return;
        }
        setLoading(true);
        setError(null);
        setWarning(null);
        setNotice(null);
        setScanned([]);
        setCandidates([]);
        setBlocked([]);

        const fetchCount =
            Math.max(Number(sampleSize) || DEFAULT_PRO_AI_OPTIONS.sampleSize, DEFAULT_PRO_AI_OPTIONS.minSample) + 20;
        const evalOpts = {
            sampleSize: Number(sampleSize) || DEFAULT_PRO_AI_OPTIONS.sampleSize,
            minAiScore: Number(minAiScore) || DEFAULT_PRO_AI_OPTIONS.minAiScore,
            minRecentWinRate: Number(minRecentWinRate) || DEFAULT_PRO_AI_OPTIONS.minRecentWinRate,
        };
        const markets: MarketScan[] = [];
        const failures: string[] = [];

        try {
            const CONCURRENCY = 4;
            for (let i = 0; i < targets.length; i += CONCURRENCY) {
                const batch = targets.slice(i, i + CONCURRENCY);
                const results = await Promise.allSettled(batch.map(s => fetchHistoricalTicks(s.symbol, fetchCount)));
                results.forEach((r, j) => {
                    const target = batch[j];
                    if (r.status === 'fulfilled') {
                        markets.push({
                            symbol: target.symbol,
                            displayName: target.name,
                            digits: r.value.digits,
                            pipSize: r.value.pipSize,
                        });
                    } else {
                        failures.push(
                            `${target.name}: ${r.reason instanceof Error ? r.reason.message : 'ticks fetch failed'}`
                        );
                    }
                });
            }

            if (markets.length === 0) {
                setError(failures.length ? failures.join(' · ') : 'No ticks returned for the selected markets.');
                return;
            }
            if (failures.length) {
                setWarning(`Could not load ${failures.length} market(s) — ${failures.join(' · ')}`);
            }

            const buys = scanProAiMarkets(
                markets.map(m => ({ symbol: m.symbol, displayName: m.displayName, digits: m.digits })),
                { ...evalOpts, scope }
            );

            const blockedRows: BlockedRow[] = [];
            for (const m of markets) {
                for (const bot of PRO_AI_BOTS) {
                    const evaluation = evaluateProAiEntry(m.digits, bot, evalOpts);
                    if (evaluation.signal === 'BLOCK') {
                        blockedRows.push({
                            symbol: m.symbol,
                            displayName: m.displayName,
                            botName: bot.name,
                            evaluation,
                        });
                    }
                }
            }

            setScanned(markets);
            setCandidates(buys);
            setBlocked(blockedRows);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Pro AI scan failed');
        } finally {
            setLoading(false);
        }
    };

    // Paper entry: no session or order needed — settles honestly on a fresh
    // tick fetched after the decision, so nothing is invented.
    const paperBuy = async (c: ProAiCandidate) => {
        const id = newId('paper');
        const amount = Number(stake) || 1;
        pushEntry({
            id,
            mode: 'paper',
            symbol: c.symbol,
            displayName: c.displayName,
            contract: contractLabel(c.direction, c.barrier),
            barrier: c.barrier,
            stake: amount,
            status: 'pending',
            note: 'Paper entry — waiting for a fresh tick…',
        });
        try {
            const tick = await fetchHistoricalTicks(c.symbol, 3);
            const digit = tick.digits[tick.digits.length - 1];
            const won = winsFor(c.direction, c.barrier, digit);
            patchEntry(id, {
                status: 'settled',
                result: won ? 'win' : 'loss',
                note: `Paper — settled on the latest tick (digit ${digit}), no real order placed`,
            });
        } catch (e) {
            patchEntry(id, {
                status: 'rejected',
                note: `Paper settle failed: ${e instanceof Error ? e.message : 'unknown error'}`,
            });
        }
    };

    // Demo entry: requires a logged-in DEMO account plus an explicit confirm.
    // Guests are sent to the login dialog; real-money accounts are refused.
    const demoBuy = async (c: ProAiCandidate) => {
        if (!isLoggedIn) {
            run_panel?.showLoginDialog?.();
            return;
        }
        if (!isDemo) {
            setNotice('Real-money entries are disabled on Pro AI — switch to a demo account to place orders here.');
            return;
        }
        const amount = Number(stake) || 1;
        const ok = window.confirm(
            `Place a DEMO order: ${contractLabel(c.direction, c.barrier)} on ${c.displayName} for ${money(
                amount
            )}? Pro AI is a ranked heuristic, not a guaranteed edge.`
        );
        if (!ok) return;

        const id = newId('demo');
        pushEntry({
            id,
            mode: 'demo',
            symbol: c.symbol,
            displayName: c.displayName,
            contract: contractLabel(c.direction, c.barrier),
            barrier: c.barrier,
            stake: amount,
            status: 'pending',
            note: 'Requesting quote…',
        });

        const req = {
            symbol: c.symbol,
            direction: c.direction,
            barrier: c.barrier,
            amount,
            duration: 1,
            durationUnit: 't',
        };

        try {
            const { quote, error: quoteError } = await requestQuote(req);
            if (!quote) {
                patchEntry(id, { status: 'rejected', note: `Quote failed: ${quoteError || 'no quote returned'}` });
                return;
            }
            const buy = await executeBuyFresh(quote, amount, () => requestQuote(req));
            if (buy.error || buy.contractId === undefined) {
                patchEntry(id, {
                    status: 'rejected',
                    note: `Order rejected: ${buy.error || 'no contract id returned'}`,
                });
                return;
            }
            patchEntry(id, { contractId: buy.contractId, note: `Contract #${buy.contractId} open — monitoring…` });

            const scan = scanned.find(s => s.symbol === c.symbol);
            const settlement = await monitorUntilSettled(
                buy.contractId,
                scan?.pipSize ?? 2,
                undefined,
                settlementTimeoutMs(1, 't')
            );
            if ('error' in settlement) {
                // Outcome unknown past the duration-aware window — never record
                // a win or loss the market didn't produce.
                patchEntry(id, {
                    status: 'unknown',
                    note: `${settlement.error} — outcome not recorded; check contract #${buy.contractId} in your account`,
                });
                return;
            }
            patchEntry(id, {
                status: 'settled',
                result: settlement.isWon ? 'win' : 'loss',
                note: `Contract #${buy.contractId} settled — exit digit ${
                    settlement.exitDigit ?? '—'
                }, P/L ${settlement.profit >= 0 ? '+' : ''}${money(settlement.profit)}`,
            });
        } catch (e) {
            patchEntry(id, { status: 'rejected', note: e instanceof Error ? e.message : 'Order failed' });
        }
    };

    return (
        <HubPage className='pro-ai'>
            {!isLoggedIn && (
                <HubNote tone='info'>
                    Not logged in — scanning Deriv&apos;s public markets in guest mode. Paper entries work without an
                    account; demo orders need a session.{' '}
                    <button
                        type='button'
                        className='hub-btn hub-btn--primary hub-btn--sm'
                        onClick={() => run_panel?.showLoginDialog?.()}
                    >
                        Log in for demo orders
                    </button>
                </HubNote>
            )}

            <HubPageHeader
                title='Pro AI'
                subtitle="Ranked digit-entry scanner across volatility markets — ranks Over / Under bots per market with SmartFlip's scoring heuristic (AI score, recent win rate, Wilson quality) and blocks no-trade conditions before anything is shown as BUY."
                badge={
                    <>
                        <span className={`hub-badge ${loading ? 'hub-badge--running' : 'hub-badge--idle'}`}>
                            {loading ? 'scanning' : 'idle'}
                        </span>
                        <span
                            className={[
                                'hub-badge',
                                !isLoggedIn ? 'hub-badge--guest' : isDemo ? 'hub-badge--demo' : 'hub-badge--real',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                        >
                            {!isLoggedIn ? 'Guest · analysis only' : `${isDemo ? 'Demo' : 'Real'} · ${activeLoginid}`}
                        </span>
                    </>
                }
            />

            <HubNote tone='risk'>
                <strong>Honest disclaimer:</strong> Pro AI is a ranked heuristic on historical digits, not a guaranteed
                edge. The gates (AI score, recent win rate) measure the recent distribution — they do not predict the
                next digit. Trade demo first and risk only what you can afford to lose.
            </HubNote>

            <section className='pro-ai__controls'>
                <label className='hub-field'>
                    Scope
                    <select value={scope} onChange={e => setScope(e.target.value as ProAiScope)}>
                        {SCOPE_ORDER.map(s => (
                            <option key={s} value={s}>
                                {SCOPE_LABEL[s]}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='hub-field'>
                    Sample size
                    <input
                        type='number'
                        min={40}
                        max={500}
                        value={sampleSize}
                        onChange={e => setSampleSize(Number(e.target.value) || DEFAULT_PRO_AI_OPTIONS.sampleSize)}
                    />
                </label>
                <label className='hub-field'>
                    Min AI score
                    <input
                        type='number'
                        step={0.01}
                        min={0}
                        max={1}
                        value={minAiScore}
                        onChange={e => setMinAiScore(Number(e.target.value) || DEFAULT_PRO_AI_OPTIONS.minAiScore)}
                    />
                </label>
                <label className='hub-field'>
                    Min recent win rate
                    <input
                        type='number'
                        step={0.01}
                        min={0}
                        max={1}
                        value={minRecentWinRate}
                        onChange={e =>
                            setMinRecentWinRate(Number(e.target.value) || DEFAULT_PRO_AI_OPTIONS.minRecentWinRate)
                        }
                    />
                </label>
                <label className='hub-field'>
                    Entry stake
                    <input
                        type='number'
                        step={0.5}
                        min={0.35}
                        value={stake}
                        onChange={e => setStake(Number(e.target.value) || 1)}
                    />
                </label>
                <button className='hub-btn hub-btn--primary' onClick={run} disabled={loading}>
                    {loading ? 'Scanning…' : 'Run Pro AI scan'}
                </button>
            </section>

            <div className='pro-ai__symbols'>
                <span className='pro-ai__symbols-label'>Markets</span>
                <div className='pro-ai__chips'>
                    {SYMBOLS.map(s => (
                        <label
                            key={s.symbol}
                            className={[
                                'pro-ai__chip',
                                selected.includes(s.symbol) ? 'pro-ai__chip--on' : '',
                                scopeMatches(scope, s.symbol) ? '' : 'pro-ai__chip--muted',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            title={scopeMatches(scope, s.symbol) ? s.symbol : `${s.symbol} — outside the chosen scope`}
                        >
                            <input
                                type='checkbox'
                                checked={selected.includes(s.symbol)}
                                onChange={() => toggleSymbol(s.symbol)}
                            />
                            <span>{s.name}</span>
                        </label>
                    ))}
                </div>
            </div>

            {error && <div className='pro-ai__error' role='alert'>{error}</div>}
            {warning && <div className='pro-ai__warn' role='status'>{warning}</div>}
            {notice && <div className='pro-ai__warn' role='status'>{notice}</div>}

            {scanned.length > 0 && !loading && (
                <p className='hub-empty'>
                    Scanned {scanned.length} market{scanned.length === 1 ? '' : 's'} ·{' '}
                    {scanned[0].digits.length} ticks each · {PRO_AI_BOTS.length} bots per market · gates: AI ≥{' '}
                    {pct(Number(minAiScore) || DEFAULT_PRO_AI_OPTIONS.minAiScore)}, recent ≥{' '}
                    {pct(Number(minRecentWinRate) || DEFAULT_PRO_AI_OPTIONS.minRecentWinRate)}
                </p>
            )}

            <section className='hub-section'>
                <h3>BUY candidates ({candidates.length})</h3>
                {candidates.length === 0 ? (
                    <p className='hub-empty'>
                        {loading
                            ? 'Scanning markets…'
                            : scanned.length
                              ? 'No bot cleared the gates at these thresholds — lower the AI-score gate or scan more markets.'
                              : 'Run a scan to rank BUY candidates across the selected markets.'}
                    </p>
                ) : (
                    <div className='hub-table-wrap'>
                        <table className='hub-table'>
                            <thead>
                                <tr>
                                    <th>Market</th>
                                    <th>Bot</th>
                                    <th>AI score</th>
                                    <th>Win rate</th>
                                    <th>Recent</th>
                                    <th>Validation</th>
                                    <th>Quality</th>
                                    <th>Sample</th>
                                    <th>Theoretical</th>
                                    <th>Entry</th>
                                </tr>
                            </thead>
                            <tbody>
                                {candidates.map(c => (
                                    <tr key={`${c.symbol}-${c.botId}`}>
                                        <td>{c.displayName}</td>
                                        <td>{botName(c.botId)}</td>
                                        <td className='hub-pos'>{pct(c.aiScore)}</td>
                                        <td>{pct(c.winRate)}</td>
                                        <td>{pct(c.recentWinRate)}</td>
                                        <td>{pct(c.validationWinRate)}</td>
                                        <td>{pct(c.qualityScore)}</td>
                                        <td>{c.sampleSize}</td>
                                        <td>{pct(c.theoretical)}</td>
                                        <td className='pro-ai__actions'>
                                            <button
                                                type='button'
                                                className='hub-btn hub-btn--ghost hub-btn--sm'
                                                onClick={() => paperBuy(c)}
                                            >
                                                Paper buy
                                            </button>
                                            <button
                                                type='button'
                                                className='hub-btn hub-btn--primary hub-btn--sm'
                                                title={
                                                    isLoggedIn
                                                        ? isDemo
                                                            ? 'Place a demo order (you confirm first)'
                                                            : 'Real-money entries are disabled on this page'
                                                        : 'Log in to place demo orders'
                                                }
                                                onClick={() => demoBuy(c)}
                                            >
                                                {isLoggedIn ? (isDemo ? 'Demo buy' : 'Real acct — blocked') : 'Log in to trade'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <details className='hub-panel pro-ai__blocked'>
                <summary>Blocked evaluations ({blocked.length})</summary>
                {blocked.length === 0 ? (
                    <p className='hub-empty'>Nothing was blocked — every market × bot pair cleared the gates.</p>
                ) : (
                    <div className='hub-table-wrap'>
                        <table className='hub-table'>
                            <thead>
                                <tr>
                                    <th>Market</th>
                                    <th>Bot</th>
                                    <th>AI score</th>
                                    <th>Recent</th>
                                    <th>Block reason</th>
                                </tr>
                            </thead>
                            <tbody>
                                {blocked.map(b => (
                                    <tr key={`${b.symbol}-${b.botName}`}>
                                        <td>{b.displayName}</td>
                                        <td>{b.botName}</td>
                                        <td>{pct(b.evaluation.aiScore)}</td>
                                        <td>{pct(b.evaluation.recentWinRate)}</td>
                                        <td className='pro-ai__reason'>{b.evaluation.blockReason ?? '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </details>

            <section className='hub-section'>
                <h3>Entries ({entries.length})</h3>
                {entries.length === 0 ? (
                    <p className='hub-empty'>
                        No entries yet — use Paper buy (works as a guest) or Demo buy on a candidate row.
                    </p>
                ) : (
                    <div className='hub-table-wrap'>
                        <table className='hub-table'>
                            <thead>
                                <tr>
                                    <th>Mode</th>
                                    <th>Market</th>
                                    <th>Contract</th>
                                    <th>Stake</th>
                                    <th>Contract #</th>
                                    <th>Status</th>
                                    <th>Result</th>
                                    <th>Note</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map(e => (
                                    <tr key={e.id}>
                                        <td>{e.mode === 'paper' ? 'paper' : 'demo'}</td>
                                        <td>{e.displayName}</td>
                                        <td>{e.contract}</td>
                                        <td>{money(e.stake)}</td>
                                        <td>{e.contractId ?? '—'}</td>
                                        <td>
                                            <span
                                                className={[
                                                    'hub-badge',
                                                    'hub-badge--sm',
                                                    e.status === 'settled'
                                                        ? 'hub-badge--ready'
                                                        : e.status === 'rejected'
                                                          ? 'hub-badge--error'
                                                          : e.status === 'unknown'
                                                            ? 'hub-badge--warn'
                                                            : 'hub-badge--running',
                                                ].join(' ')}
                                            >
                                                {e.status}
                                            </span>
                                        </td>
                                        <td className={e.result === 'win' ? 'hub-pos' : e.result === 'loss' ? 'hub-neg' : ''}>
                                            {e.result || '—'}
                                        </td>
                                        <td className='pro-ai__reason'>{e.note}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </HubPage>
    );
});

export default ProAiPage;
