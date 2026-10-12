import { WS_SERVERS, isProduction } from '@/components/shared/utils/config/config';
import { TickPoint } from '../core/types';

export interface SymbolSeries {
    symbol: string;
    pipSize: number;
    digits: number[];
    quotes: number[];
    lastEpoch: number;
    lastTickAt: number;
    tickCount: number;
    stale: boolean;
}

export interface TickFeedEvents {
    onTick?: (symbol: string, point: TickPoint, series: SymbolSeries) => void;
    onStatus?: (connected: boolean, error?: string) => void;
}

const MAX_DIGITS = 2000;
const MAX_QUOTES = 500;
const STALE_MS = 8000;
const RECONNECT_MS = 2500;

const socketURL = (): string => {
    const base = isProduction() ? WS_SERVERS.PRODUCTION : WS_SERVERS.STAGING;
    const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '1089';
    return `${base.replace(/^http/, 'ws')}?app_id=${appId}&l=EN&brand=deriv`;
};

const lastDigitOf = (quote: number, pipSize: number): number => {
    const fixed = quote.toFixed(pipSize);
    return Number(fixed[fixed.length - 1]);
};

export class TickFeed {
    private socket: WebSocket | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private staleTimer: ReturnType<typeof setInterval> | null = null;
    private symbols: string[] = [];
    private series = new Map<string, SymbolSeries>();
    private disposed = false;
    private events: TickFeedEvents;

    constructor(events: TickFeedEvents = {}) {
        this.events = events;
    }

    setSymbols(symbols: string[]) {
        this.symbols = symbols.filter(Boolean);
        for (const s of this.symbols) {
            if (!this.series.has(s)) {
                this.series.set(s, {
                    symbol: s,
                    pipSize: 2,
                    digits: [],
                    quotes: [],
                    lastEpoch: 0,
                    lastTickAt: 0,
                    tickCount: 0,
                    stale: false,
                });
            }
        }
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.resubscribe();
        }
    }

    getSeries(symbol: string): SymbolSeries | undefined {
        return this.series.get(symbol);
    }

    seed(symbol: string, pipSize: number, quotes: number[]) {
        let series = this.series.get(symbol);
        if (!series) {
            series = {
                symbol,
                pipSize: pipSize || 2,
                digits: [],
                quotes: [],
                lastEpoch: 0,
                lastTickAt: 0,
                tickCount: 0,
                stale: false,
            };
            this.series.set(symbol, series);
        }
        if (typeof pipSize === 'number' && pipSize >= 0) series.pipSize = pipSize;
        for (const q of quotes) {
            if (!Number.isFinite(q)) continue;
            series.digits.push(lastDigitOf(q, series.pipSize));
            series.quotes.push(q);
        }
        if (series.digits.length > MAX_DIGITS) series.digits = series.digits.slice(-MAX_DIGITS);
        if (series.quotes.length > MAX_QUOTES) series.quotes = series.quotes.slice(-MAX_QUOTES);
        if (!series.lastTickAt) series.lastTickAt = Date.now();
    }

    getAll(): SymbolSeries[] {
        return Array.from(this.series.values());
    }

    start() {
        this.disposed = false;
        this.open();
    }

    stop() {
        this.disposed = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.staleTimer) clearInterval(this.staleTimer);
        this.reconnectTimer = null;
        this.staleTimer = null;
        this.teardown();
    }

    private open() {
        if (this.disposed) return;
        try {
            this.socket = new WebSocket(socketURL());
        } catch {
            this.scheduleReconnect();
            return;
        }
        const ws = this.socket;
        ws.onopen = () => {
            this.events.onStatus?.(true);
            this.resubscribe();
            if (!this.staleTimer) {
                this.staleTimer = setInterval(() => this.markStale(), 2000);
            }
        };
        ws.onmessage = event => {
            try {
                const msg = JSON.parse(event.data as string);
                this.handleMessage(msg);
            } catch {
                // ignore malformed frames
            }
        };
        ws.onclose = () => {
            this.socket = null;
            this.events.onStatus?.(false, 'closed');
            this.scheduleReconnect();
        };
        ws.onerror = () => {
            // onclose fires next
        };
    }

    private handleMessage(msg: any) {
        if (msg?.error) {
            const code = msg.error.code;
            if (code && code !== 'AlreadySubscribed') {
                this.events.onStatus?.(false, msg.error.message || code);
            }
            return;
        }
        if (!msg?.tick) return;
        const t = msg.tick;
        const symbol = t.symbol;
        if (!symbol) return;
        let series = this.series.get(symbol);
        if (!series) {
            series = {
                symbol,
                pipSize: 2,
                digits: [],
                quotes: [],
                lastEpoch: 0,
                lastTickAt: 0,
                tickCount: 0,
                stale: false,
            };
            this.series.set(symbol, series);
        }
        const quote = Number(t.quote);
        if (!Number.isFinite(quote)) return;
        if (typeof t.pip_size === 'number' && t.pip_size >= 0) series.pipSize = t.pip_size;
        const epoch = Number(t.epoch) || Math.floor(Date.now() / 1000);
        if (epoch <= series.lastEpoch) return;
        series.lastEpoch = epoch;
        series.lastTickAt = Date.now();
        series.stale = false;
        series.tickCount += 1;
        const digit = lastDigitOf(quote, series.pipSize);
        series.digits.push(digit);
        if (series.digits.length > MAX_DIGITS) series.digits.shift();
        series.quotes.push(quote);
        if (series.quotes.length > MAX_QUOTES) series.quotes.shift();
        this.events.onTick?.(symbol, { epoch, quote, digit }, series);
    }

    private resubscribe() {
        const ws = this.socket;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        for (const s of this.symbols) {
            ws.send(JSON.stringify({ ticks: s, subscribe: 1 }));
        }
    }

    private markStale() {
        const now = Date.now();
        for (const series of this.series.values()) {
            if (!series.lastTickAt) continue;
            const wasStale = series.stale;
            series.stale = now - series.lastTickAt > STALE_MS;
            if (!wasStale && series.stale) {
                this.events.onStatus?.(this.socket?.readyState === WebSocket.OPEN, `No ticks for ${series.symbol}`);
            }
        }
    }

    private scheduleReconnect() {
        if (this.disposed) return;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.open(), RECONNECT_MS);
    }

    private teardown() {
        const ws = this.socket;
        this.socket = null;
        if (ws) {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onclose = null;
            ws.onerror = null;
            try {
                ws.close();
            } catch {
                // already closed
            }
        }
    }
}
