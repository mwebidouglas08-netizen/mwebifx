import { useEffect, useRef, useState } from 'react';
import { WS_SERVERS, isProduction } from '@/components/shared/utils/config/config';

export interface LiveQuote {
    price: number | null;
    change: number;
    changePercent: number;
    high: number;
    low: number;
    samples: number;
}

export interface LiveData {
    quotes: Record<string, LiveQuote>;
    buffers: React.MutableRefObject<Record<string, number[]>>;
}

const MAX_SAMPLES = 120;
const RECONNECT_MS = 2000;
const FLUSH_MS = 500;

/** Wilder RSI over a price buffer; 50 when there is not enough data yet. */
export const computeRsi = (values: number[], period = 14): number => {
    if (!values || values.length <= period) return 50;
    const slice = values.slice(-(period + 1));
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < slice.length; i++) {
        const delta = slice[i] - slice[i - 1];
        if (delta >= 0) gains += delta;
        else losses -= delta;
    }
    if (gains === 0 && losses === 0) return 50;
    const rs = losses === 0 ? 100 : gains / losses;
    return 100 - 100 / (1 + rs);
};

/**
 * Public market-data socket for the hub display.
 *
 * Deliberately NOT the app's own `api_base` socket: that one is owned by the
 * trade engine, and its `onMessage` subscribers (e.g. `ticks_service`) assume
 * every `msg_type: 'tick'` frame carries a `tick` payload. Spraying 20 extra
 * tick subscriptions through it tripped an unguarded destructure that the
 * shell's global error handler turned into a full-page crash. A separate
 * read-only socket keeps the two concerns apart.
 */
const publicSocketURL = (): string => {
    const base = isProduction() ? WS_SERVERS.PRODUCTION : WS_SERVERS.STAGING;
    const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '1089';
    return `${base.replace(/^http/, 'ws')}?app_id=${appId}&l=EN&brand=deriv`;
};

/**
 * Streams live Deriv ticks for `symbols`, so the hub shows real prices instead
 * of `Math.random()` values. Symbols that are closed (forex over a weekend)
 * simply never fill in.
 */
export const useLivePrices = (symbols: string[]): LiveData => {
    const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
    const buffers = useRef<Record<string, number[]>>({});
    const symbolKey = symbols.join('|');

    useEffect(() => {
        const list = symbolKey ? symbolKey.split('|') : [];
        if (!list.length) return;

        let disposed = false;
        let socket: WebSocket | null = null;
        let reconnect: ReturnType<typeof setTimeout> | null = null;
        let flush: ReturnType<typeof setInterval> | null = null;
        const dirty = new Set<string>();

        const recordTick = (symbol: unknown, rawQuote: unknown) => {
            if (typeof symbol !== 'string' || !symbol) return;
            const price = Number(rawQuote);
            if (!Number.isFinite(price)) return;
            const buf = (buffers.current[symbol] = buffers.current[symbol] || []);
            buf.push(price);
            if (buf.length > MAX_SAMPLES) buf.shift();
            dirty.add(symbol);
        };

        const flushQuotes = () => {
            if (!dirty.size) return;
            const pending = Array.from(dirty);
            dirty.clear();
            setQuotes(prev => {
                const next = { ...prev };
                for (const symbol of pending) {
                    const buf = buffers.current[symbol];
                    if (!buf || !buf.length) continue;
                    const price = buf[buf.length - 1];
                    const base = buf[0];
                    const change = price - base;
                    next[symbol] = {
                        price,
                        change,
                        changePercent: base ? (change / base) * 100 : 0,
                        high: Math.max(...buf),
                        low: Math.min(...buf),
                        samples: buf.length,
                    };
                }
                return next;
            });
        };

        const open = () => {
            if (disposed) return;
            try {
                socket = new WebSocket(publicSocketURL());
            } catch {
                reconnect = setTimeout(open, RECONNECT_MS);
                return;
            }

            const ws = socket;

            ws.onopen = () => {
                list.forEach(symbol => {
                    if (symbol && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
                    }
                });
            };

            ws.onmessage = event => {
                try {
                    const message = JSON.parse(event.data as string) as {
                        tick?: { symbol?: unknown; quote?: unknown };
                    };
                    if (message?.tick) recordTick(message.tick.symbol, message.tick.quote);
                } catch {
                    // ignore frames that are not valid JSON
                }
            };

            ws.onclose = () => {
                socket = null;
                if (!disposed) reconnect = setTimeout(open, RECONNECT_MS);
            };

            ws.onerror = () => {
                // onclose fires next and drives the reconnect
            };

            if (!flush) flush = setInterval(flushQuotes, FLUSH_MS);
        };

        open();

        return () => {
            disposed = true;
            if (reconnect) clearTimeout(reconnect);
            if (flush) clearInterval(flush);
            flushQuotes();
            if (socket) {
                socket.onopen = null;
                socket.onmessage = null;
                socket.onclose = null;
                socket.onerror = null;
                try {
                    socket.close();
                } catch {
                    // already torn down
                }
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbolKey]);

    return { quotes, buffers };
};
