import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { fetchHistoricalTicks, type HistoricalTicks } from '@/bot/deriv/history';
import { HubNote, HubPage, HubPageHeader } from '@/components/hub-page';
import './tradingview.scss';

interface TvSymbol {
    /** Deriv symbol used by the local tick chart. */
    deriv: string;
    /** Symbol string handed to the TradingView widget. */
    tv: string;
    label: string;
    /** False when TradingView does not carry the instrument at all. */
    onTradingView: boolean;
}

const SYMBOLS: TvSymbol[] = [
    { deriv: 'R_75', tv: 'R_75', label: 'Volatility 75 Index', onTradingView: false },
    { deriv: 'R_100', tv: 'R_100', label: 'Volatility 100 Index', onTradingView: false },
    { deriv: 'frxEURUSD', tv: 'FX:EURUSD', label: 'EUR/USD', onTradingView: true },
    { deriv: 'frxGBPUSD', tv: 'FX:GBPUSD', label: 'GBP/USD', onTradingView: true },
    { deriv: 'frxXAUUSD', tv: 'TVC:GOLD', label: 'Gold', onTradingView: true },
    { deriv: 'cryBTCUSD', tv: 'BINANCE:BTCUSDT', label: 'Bitcoin / USDT', onTradingView: true },
];

const EMBED_TIMEOUT_MS = 6000;

type Mode = 'tradingview' | 'local';

const TickChart = ({ ticks }: { ticks: HistoricalTicks }) => {
    const { quotes, pipSize } = ticks;
    const path = useMemo(() => {
        if (quotes.length < 2) return '';
        const min = Math.min(...quotes);
        const max = Math.max(...quotes);
        const span = max - min || 1;
        return quotes
            .map((quote, index) => {
                const x = (index / (quotes.length - 1)) * 300;
                const y = 96 - ((quote - min) / span) * 92;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
    }, [quotes]);

    if (!path) return <p className='hub-empty'>No ticks to draw yet.</p>;

    const min = Math.min(...quotes);
    const max = Math.max(...quotes);

    return (
        <div className='tv-chart'>
            <div className='tv-chart__meta'>
                <span>{quotes.length} ticks</span>
                <span>pip size {pipSize}</span>
                <span>low {min.toFixed(pipSize)}</span>
                <span>high {max.toFixed(pipSize)}</span>
            </div>
            <svg
                className='tv-chart__svg'
                viewBox='0 0 300 100'
                preserveAspectRatio='none'
                role='img'
                aria-label='Last 100 ticks'
            >
                <polyline points={path} fill='none' stroke='currentColor' strokeWidth='1.2' vectorEffect='non-scaling-stroke' />
            </svg>
        </div>
    );
};

const TradingViewPage = observer(() => {
    const { ui } = useStore() ?? {};
    const [symbolKey, setSymbolKey] = useState(SYMBOLS[0].deriv);
    const [mode, setMode] = useState<Mode>('tradingview');
    const [embedState, setEmbedState] = useState<'loading' | 'ready' | 'failed'>('loading');
    const [ticks, setTicks] = useState<HistoricalTicks | null>(null);
    const [tickError, setTickError] = useState<string | null>(null);
    const [tickLoading, setTickLoading] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const selected = SYMBOLS.find(s => s.deriv === symbolKey) ?? SYMBOLS[0];
    const dark = Boolean(ui?.is_dark_mode_on);
    // The local chart doubles as the offline fallback once the embed gives up.
    const showLocal = mode === 'local' || embedState === 'failed';

    // Inject the official advanced-chart widget. The script swaps itself for an
    // iframe once it runs; if it never loads (offline / blocked) we fall back.
    useEffect(() => {
        if (mode !== 'tradingview') return;
        const container = containerRef.current;
        if (!container) return;

        setEmbedState('loading');
        container.innerHTML = '';

        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
        script.async = true;
        script.type = 'text/javascript';
        script.innerHTML = JSON.stringify({
            autosize: true,
            symbol: selected.tv,
            interval: '15',
            timezone: 'Etc/UTC',
            theme: dark ? '0' : '1',
            style: '1',
            locale: 'en',
            allow_symbol_change: true,
            save_image: false,
            calendar: false,
            support_host: 'https://www.tradingview.com',
        });

        const timer = window.setTimeout(() => {
            setEmbedState(prev => (prev === 'loading' ? 'failed' : prev));
        }, EMBED_TIMEOUT_MS);
        script.onload = () => {
            window.clearTimeout(timer);
            setEmbedState('ready');
        };
        script.onerror = () => {
            window.clearTimeout(timer);
            setEmbedState('failed');
        };

        container.appendChild(script);
        return () => {
            window.clearTimeout(timer);
            script.onload = null;
            script.onerror = null;
            script.remove();
            container.innerHTML = '';
        };
    }, [mode, selected.tv, dark, attempt]);

    // Local tick chart — works from Deriv's public feed with no third-party script.
    useEffect(() => {
        if (!showLocal) return;
        let cancelled = false;
        setTickLoading(true);
        setTickError(null);
        setTicks(null);
        fetchHistoricalTicks(selected.deriv, 100)
            .then(history => {
                if (!cancelled) setTicks(history);
            })
            .catch(e => {
                if (!cancelled) setTickError(e instanceof Error ? e.message : 'Could not load ticks');
            })
            .finally(() => {
                if (!cancelled) setTickLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [showLocal, selected.deriv]);

    return (
        <HubPage className='tv-page'>
            <HubPageHeader
                title='TradingView Chart'
                subtitle='The TradingView advanced chart embedded in the workspace, plus a local tick chart that runs when the embed cannot load.'
                actions={
                    <div className='tv-controls'>
                        <label className='hub-field'>
                            Symbol
                            <select value={symbolKey} onChange={e => setSymbolKey(e.target.value)}>
                                {SYMBOLS.map(s => (
                                    <option key={s.deriv} value={s.deriv}>
                                        {s.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className='hub-seg' role='tablist' aria-label='Chart source'>
                            <button
                                type='button'
                                role='tab'
                                aria-selected={mode === 'tradingview'}
                                className={`hub-seg__btn ${mode === 'tradingview' ? 'hub-seg__btn--on' : ''}`}
                                onClick={() => {
                                    setMode('tradingview');
                                    setEmbedState('loading');
                                    setAttempt(value => value + 1);
                                }}
                            >
                                TradingView
                            </button>
                            <button
                                type='button'
                                role='tab'
                                aria-selected={mode === 'local'}
                                className={`hub-seg__btn ${mode === 'local' ? 'hub-seg__btn--on' : ''}`}
                                onClick={() => setMode('local')}
                            >
                                Local ticks
                            </button>
                        </div>
                    </div>
                }
            />

            {!selected.onTradingView && (
                <HubNote tone='risk'>
                    TradingView does not carry Deriv synthetic indices — the widget will likely report this
                    symbol as unavailable. The local tick chart below reads the same instrument straight from
                    Deriv&apos;s public feed.
                </HubNote>
            )}

            {mode === 'tradingview' && embedState === 'failed' && (
                <div className='tv-fallback' role='alert'>
                    <strong>TradingView embed unavailable.</strong>
                    <p>
                        The chart script did not load within {EMBED_TIMEOUT_MS / 1000} seconds — you are probably
                        offline or a content blocker is stopping s3.tradingview.com. The embed needs a working
                        connection to TradingView&apos;s servers. Until then, the local tick chart below reads the
                        same instrument straight from Deriv&apos;s public feed.
                    </p>
                    <div className='tv-fallback__actions'>
                        <button
                            type='button'
                            className='hub-btn hub-btn--primary'
                            onClick={() => {
                                setEmbedState('loading');
                                setAttempt(value => value + 1);
                            }}
                        >
                            Retry the embed
                        </button>
                        <button type='button' className='hub-btn' onClick={() => setMode('local')}>
                            Use local ticks only
                        </button>
                    </div>
                </div>
            )}

            {mode === 'tradingview' && embedState !== 'failed' && (
                <div className='tv-embed'>
                    <div className='tv-embed__widget' ref={containerRef} />
                    {embedState === 'loading' && <div className='tv-embed__loading'>Loading TradingView…</div>}
                </div>
            )}

            {showLocal && (
                <section className='hub-section' aria-label='Local tick chart'>
                    <h3>
                        Local tick chart — {selected.label} <em>(last 100 ticks from Deriv)</em>
                    </h3>
                    {tickLoading && <p className='hub-empty'>Loading ticks…</p>}
                    {tickError && <div className='tv-error'>{tickError}</div>}
                    {!tickLoading && !tickError && ticks && <TickChart ticks={ticks} />}
                </section>
            )}

            <HubNote tone='info'>
                Honest note: the embedded chart is provided by TradingView — its data, symbols and uptime are
                subject to TradingView&apos;s feed and terms, not this app. The local chart uses Deriv&apos;s
                public <code>ticks_history</code> feed and is a plain price line, not a TradingView product.
            </HubNote>
        </HubPage>
    );
});

export default TradingViewPage;
