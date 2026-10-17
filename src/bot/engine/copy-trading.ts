import type { EngineLogEvent } from './bulk-trader';
import { WS_SERVERS, isProduction } from '@/components/shared/utils/config/config';
import { voiceService } from '@/services/voice-service';
import { soundService } from '@/services/sound-service';

export interface CopierConfig {
    id: string;
    token: string;
    label: string;
    enabled: boolean;
}

export interface CopySettings {
    replicationEnabled: boolean;
    stakeMultiplier: number;
    stakeCap: number | null;
    /** Opt-in: allow REAL-money copier accounts (default off — demo copiers only). */
    allowRealCopiers: boolean;
}

export interface CopierStatus {
    id: string;
    label: string;
    enabled: boolean;
    authorized: boolean;
    copied: number;
    failed: number;
    skipped: number;
    lastError: string | null;
    lastSeen: number | null;
}

export interface CopyTradingState {
    status: 'idle' | 'connecting' | 'running' | 'stopping' | 'error';
    message: string;
    master: { connected: boolean; loginid: string | null; balance: number | null; isVirtual: boolean | null };
    copiers: CopierStatus[];
    settings: CopySettings;
    events: EngineLogEvent[];
    stats: {
        observed: number;
        copied: number;
        failed: number;
        skipped: number;
        settled: number;
        won: number;
        lost: number;
        profit: number;
    };
}

const STORAGE_KEY = 'mwx_copy_trading_v1';
const EVENT_CAP = 240;
/** Deriv's minimum order stake — smaller replications are skipped, not rejected. */
const MIN_STAKE = 0.35;
const SOCKET_TIMEOUT_MS = 15000;
/** Deriv rate-limits order traffic — space buy attempts per copier account. */
const BUY_SPACING_MS = 300;
const RECONNECT_BASE_MS = 2500;
const RECONNECT_MAX_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 6;

/** Same semantics as execution.ts isRetryableBuyError — a stale proposal a fresh quote can fix. */
const RETRYABLE_BUY_RE =
    /price\s*moved|proposal\s*(expired|not\s*found|invalid)|proposal.*expired|unknown\s+contract\s+proposal|invalidcontractproposal|rate\s*limit/i;

/**
 * Wall-clock window to keep watching a copied contract, mirroring
 * execution.settlementTimeoutMs (duration + head-room). Unknown/invalid
 * durations fall back to 90s.
 */
const settlementWatchMs = (duration: number, durationUnit: string): number => {
    const d = Number.isFinite(duration) && duration >= 1 ? Math.floor(duration) : 1;
    const headRoom = 90000;
    switch (durationUnit) {
        case 's':
            return d * 1000 + headRoom;
        case 'm':
            return d * 60000 + headRoom;
        case 'h':
            return d * 3600000 + headRoom;
        case 'd':
            return d * 86400000 + headRoom;
        case 't':
        default:
            return d * 5000 + headRoom;
    }
};

const DEFAULT_SETTINGS: CopySettings = {
    replicationEnabled: true,
    stakeMultiplier: 1,
    stakeCap: null,
    allowRealCopiers: false,
};

const socketURL = (token: string): string => {
    const base = isProduction() ? WS_SERVERS.PRODUCTION : WS_SERVERS.STAGING;
    const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '1089';
    return `${base.replace(/^http/, 'ws')}?app_id=${appId}&token=${encodeURIComponent(token)}&l=EN`;
};

/**
 * Tokens are stored base64-encoded only — that is obfuscation, NOT encryption:
 * anyone with access to this browser's localStorage can decode them back.
 * Real protection would need a server-side secret a browser bundle cannot keep.
 */
const encodeToken = (token: string): string => {
    try {
        return btoa(token);
    } catch {
        return token;
    }
};

const decodeToken = (stored: string): string => {
    try {
        return atob(stored);
    } catch {
        return stored;
    }
};

const barrierFor = (contractType: string, raw: unknown): string | undefined => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (!/^(DIGITOVER|DIGITUNDER|DIGITMATCH|DIGITDIFF)/.test(contractType)) return undefined;
    return String(raw);
};

interface SocketHandlers {
    onOpen?: (ws: WebSocket) => void;
    onMessage?: (msg: any, ws: WebSocket) => void;
    onClose?: (ws: WebSocket) => void;
    onError?: (ws: WebSocket) => void;
    /** Close the socket automatically if it stays open this long (buy/validation sockets). */
    timeoutMs?: number;
}

interface CopierMeta {
    currency: string;
    isVirtual: boolean;
}

/**
 * Copy Trading — mirrors the master account's new contracts onto demo copier
 * accounts through separate per-token WebSockets.
 *
 * The master connection is its own socket (token in the URL): after
 * `authorize` it subscribes `portfolio`, detects NEW open contracts, fetches
 * their details via `proposal_open_contract` and replays the same
 * contract_type/barrier/symbol/duration on every enabled, authorized copier
 * with `stake = round(masterStake × stakeMultiplier)` capped by `stakeCap`.
 *
 * Safety: copiers must prove `is_virtual === 1` (demo) at authorize time —
 * anything else is skipped as "non-demo copier blocked" unless the explicit
 * `allowRealCopiers` opt-in is on (then real copiers authorize with a warning).
 * Replication can be switched off entirely; the master is then observed but
 * never copied.
 */
export class CopyTradingEngine {
    private listeners = new Set<(state: CopyTradingState) => void>();
    private state: CopyTradingState;
    private tokens = new Map<string, string>();
    private copierMeta = new Map<string, CopierMeta>();
    private validated = new Set<string>();
    private masterToken: string | null = null;
    private masterSocket: WebSocket | null = null;
    private running = false;
    private masterAuthorized = false;
    private seenContracts = new Set<number>();
    private replicatedContracts = new Set<number>();
    private eventSeq = 0;
    private copierSeq = 0;
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    /** Last buy-attempt timestamp per copier — enforces BUY_SPACING_MS pacing. */
    private lastBuyAttemptAt = new Map<string, number>();
    /** Buy sockets kept open after a fill to watch their contracts settle. */
    private watchSockets = new Set<WebSocket>();

    constructor() {
        this.state = {
            status: 'idle',
            message: 'Idle',
            master: { connected: false, loginid: null, balance: null, isVirtual: null },
            copiers: [],
            settings: { ...DEFAULT_SETTINGS },
            events: [],
            stats: { observed: 0, copied: 0, failed: 0, skipped: 0, settled: 0, won: 0, lost: 0, profit: 0 },
        };
        this.loadPersisted();
    }

    subscribe = (listener: (state: CopyTradingState) => void): (() => void) => {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    };

    getState = (): CopyTradingState => this.state;

    private update(patch: Partial<CopyTradingState>) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach(l => l(this.state));
    }

    private setStatus(status: CopyTradingState['status'], message: string) {
        this.update({ status, message });
    }

    logEvent(type: EngineLogEvent['type'], message: string, extra: Partial<EngineLogEvent> = {}) {
        const event: EngineLogEvent = {
            id: `copy-${++this.eventSeq}-${Date.now()}`,
            at: Date.now(),
            type,
            message,
            ...extra,
        };
        const events = [event, ...this.state.events].slice(0, EVENT_CAP);
        this.update({ events });
    }

    private loadPersisted() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const settings: CopySettings = { ...DEFAULT_SETTINGS, ...(parsed?.settings ?? {}) };
            const copiers: CopierStatus[] = [];
            for (const entry of Array.isArray(parsed?.copiers) ? parsed.copiers : []) {
                const id = String(entry?.id || `copier-${++this.copierSeq}`);
                const token = decodeToken(String(entry?.token ?? ''));
                if (!token) continue;
                this.tokens.set(id, token);
                copiers.push({
                    id,
                    label: String(entry?.label || 'Saved copier'),
                    enabled: entry?.enabled !== false,
                    authorized: false,
                    copied: 0,
                    failed: 0,
                    skipped: 0,
                    lastError: null,
                    lastSeen: null,
                });
            }
            this.state = { ...this.state, settings, copiers };
        } catch {
            // corrupt/unavailable storage — fall back to defaults
        }
    }

    private persist() {
        try {
            const payload = {
                settings: this.state.settings,
                copiers: this.state.copiers.map(c => ({
                    id: c.id,
                    token: encodeToken(this.tokens.get(c.id) || ''),
                    label: c.label,
                    enabled: c.enabled,
                })),
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch {
            // storage unavailable (private mode / quota) — settings stay in memory
        }
    }

    private patchCopier(id: string, patch: Partial<CopierStatus>) {
        this.update({ copiers: this.state.copiers.map(c => (c.id === id ? { ...c, ...patch } : c)) });
    }

    private bumpCopier(id: string, key: 'copied' | 'failed' | 'skipped', by = 1) {
        this.update({
            copiers: this.state.copiers.map(c => (c.id === id ? { ...c, [key]: c[key] + by } : c)),
        });
    }

    private bumpStat(key: keyof CopyTradingState['stats'], by = 1) {
        this.update({ stats: { ...this.state.stats, [key]: this.state.stats[key] + by } });
    }

    /** Add a copier account — validated against Deriv `authorize`, then persisted. */
    addCopier(token: string, label?: string): void {
        const trimmed = (token || '').trim();
        if (!trimmed) {
            this.logEvent('error', 'Paste a copy-trading token first.');
            return;
        }
        const duplicate = Array.from(this.tokens.values()).some(t => t === trimmed);
        if (duplicate) {
            this.logEvent('warn', 'That token is already added.');
            return;
        }
        const id = `copier-${++this.copierSeq}-${Date.now()}`;
        const copier: CopierStatus = {
            id,
            label: (label || '').trim() || `Copier ${this.state.copiers.length + 1}`,
            enabled: true,
            authorized: false,
            copied: 0,
            failed: 0,
            skipped: 0,
            lastError: null,
            lastSeen: null,
        };
        this.update({ copiers: [...this.state.copiers, copier] });
        this.tokens.set(id, trimmed);
        this.persist();
        this.logEvent('info', `Validating ${copier.label}…`);
        this.validateCopier(id, trimmed, copier.label);
    }

    removeCopier(id: string): void {
        const copier = this.state.copiers.find(c => c.id === id);
        if (!copier) return;
        this.update({ copiers: this.state.copiers.filter(c => c.id !== id) });
        this.tokens.delete(id);
        this.copierMeta.delete(id);
        this.validated.delete(id);
        this.persist();
        this.logEvent('info', `${copier.label} removed.`);
    }

    toggleCopier(id: string, enabled: boolean): void {
        const copier = this.state.copiers.find(c => c.id === id);
        if (!copier || copier.enabled === enabled) return;
        this.patchCopier(id, { enabled });
        this.persist();
        this.logEvent('info', `${copier.label} ${enabled ? 'enabled' : 'paused'}.`);
    }

    setSettings(patch: Partial<CopySettings>): void {
        const wasRealAllowed = this.state.settings.allowRealCopiers;
        const settings = { ...this.state.settings, ...patch };
        const multiplier = Number(settings.stakeMultiplier);
        settings.stakeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
        if (settings.stakeCap !== null) {
            const cap = Number(settings.stakeCap);
            settings.stakeCap = Number.isFinite(cap) && cap > 0 ? cap : null;
        }
        settings.allowRealCopiers = settings.allowRealCopiers === true;
        this.update({ settings });
        this.persist();
        // Turning the opt-in on re-authorizes copiers previously blocked as
        // non-demo (their tokens are still stored — just re-run authorize).
        if (!wasRealAllowed && settings.allowRealCopiers) {
            for (const copier of this.state.copiers) {
                if (copier.authorized || !copier.lastError?.includes('non-demo copier blocked')) continue;
                const token = this.tokens.get(copier.id);
                if (!token) continue;
                this.validateCopier(copier.id, token, copier.label);
            }
        }
    }

    /**
     * Start watching a master account. Resolves once the connection attempt is
     * issued — authorization and the portfolio subscription follow on the socket.
     */
    async start(masterToken: string): Promise<void> {
        if (this.state.status === 'connecting' || this.state.status === 'running') return;
        const token = (masterToken || '').trim();
        if (!token) {
            this.setStatus('error', 'Master token is required.');
            this.logEvent('error', 'Paste the master account token to start copy trading.');
            return;
        }
        this.masterToken = token;
        this.running = true;
        this.masterAuthorized = false;
        this.reconnectAttempts = 0;
        this.seenContracts.clear();
        this.replicatedContracts.clear();
        soundService.play('botStart');
        this.update({
            stats: { observed: 0, copied: 0, failed: 0, skipped: 0, settled: 0, won: 0, lost: 0, profit: 0 },
        });
        this.setStatus('connecting', 'Connecting to master account…');
        this.logEvent('info', 'Connecting to master account…');

        // Copiers restored from storage were never validated in this session.
        for (const copier of this.state.copiers) {
            if (this.validated.has(copier.id)) continue;
            const saved = this.tokens.get(copier.id);
            if (saved) this.validateCopier(copier.id, saved, copier.label);
        }

        this.connectMaster();
    }

    /** Stop watching the master. Copiers and settings are kept for the next run. */
    stop(): void {
        const wasActive =
            this.running || this.state.status === 'connecting' || this.state.status === 'running';
        this.running = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const ws = this.masterSocket;
        this.masterSocket = null;
        if (ws) {
            try {
                ws.close();
            } catch {
                /* already closed */
            }
        }
        // Close settlement-watch sockets so their timers cannot outlive stop().
        for (const socket of [...this.watchSockets]) {
            try {
                socket.close();
            } catch {
                /* already closed */
            }
        }
        this.watchSockets.clear();
        this.update({ master: { connected: false, loginid: null, balance: null, isVirtual: null } });
        // Settle to idle directly instead of waiting on the socket's async
        // onclose: browsers do not guarantee onclose fires promptly (or at all)
        // after a local close, which left the status stuck on 'stopping'.
        if (wasActive) {
            soundService.play('botStop');
            this.setStatus('idle', 'Stopped');
            this.logEvent('info', 'Copy trading stopped.');
        }
    }

    private openSocket(token: string, handlers: SocketHandlers): WebSocket {
        const ws = new WebSocket(socketURL(token));
        let timer: ReturnType<typeof setTimeout> | null = null;
        ws.onopen = () => {
            if (handlers.timeoutMs) {
                timer = setTimeout(() => {
                    try {
                        ws.close();
                    } catch {
                        /* already closed */
                    }
                }, handlers.timeoutMs);
            }
            handlers.onOpen?.(ws);
        };
        ws.onmessage = event => {
            let msg: any;
            try {
                msg = JSON.parse(event.data as string);
            } catch {
                return;
            }
            handlers.onMessage?.(msg, ws);
        };
        ws.onclose = () => {
            if (timer) clearTimeout(timer);
            handlers.onClose?.(ws);
        };
        ws.onerror = () => handlers.onError?.(ws);
        return ws;
    }

    private validateCopier(id: string, token: string, label: string): void {
        this.validated.add(id);
        let settled = false;
        let ws: WebSocket | null = null;
        const finish = (error?: string) => {
            if (settled) return;
            settled = true;
            if (error) {
                this.patchCopier(id, { authorized: false, lastError: error });
                this.logEvent('error', `${label}: ${error}`);
            }
            if (ws) {
                try {
                    ws.close();
                } catch {
                    /* already closed */
                }
            }
        };
        try {
            ws = this.openSocket(token, {
                timeoutMs: SOCKET_TIMEOUT_MS,
                onOpen: s => {
                    try {
                        s.send(JSON.stringify({ authorize: 1 }));
                    } catch {
                        finish('socket send failed');
                    }
                },
                onMessage: msg => {
                    if (msg?.error) {
                        finish(msg.error.message || msg.error.code || 'token rejected');
                        return;
                    }
                    const auth = msg?.authorize;
                    if (!auth) return;
                    const isVirtual = auth.is_virtual === 1 || auth.is_virtual === true;
                    this.copierMeta.set(id, { currency: String(auth.currency || ''), isVirtual });
                    if (isVirtual) {
                        this.patchCopier(id, { authorized: true, lastError: null, lastSeen: Date.now() });
                        this.logEvent('success', `${label} authorized (demo account ${auth.loginid || ''}).`);
                    } else if (this.state.settings.allowRealCopiers) {
                        this.patchCopier(id, { authorized: true, lastError: null, lastSeen: Date.now() });
                        this.logEvent(
                            'warn',
                            `${label} authorized on REAL account ${auth.loginid || ''} — real-money replication is enabled; every copied order spends real funds.`
                        );
                    } else {
                        this.patchCopier(id, {
                            authorized: false,
                            lastError: 'non-demo copier blocked — copiers must be demo (virtual) accounts (enable "Allow real copiers" to override)',
                        });
                        this.logEvent('warn', `${label}: non-demo copier blocked — replication only targets demo accounts.`);
                    }
                    finish();
                },
                onClose: () => finish('validation connection closed before a response arrived'),
            });
        } catch (e: any) {
            finish(e?.message || 'socket error');
        }
    }

    private connectMaster(): void {
        if (!this.running || !this.masterToken) return;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        try {
            this.masterSocket = this.openSocket(this.masterToken, {
                onOpen: ws => {
                    this.masterSocket = ws;
                    try {
                        ws.send(JSON.stringify({ authorize: 1 }));
                    } catch {
                        /* socket gone */
                    }
                },
                onMessage: (msg, ws) => {
                    if (ws !== this.masterSocket) return;
                    this.handleMasterMessage(msg);
                },
                onClose: ws => this.handleMasterClose(ws),
            });
        } catch (e: any) {
            this.running = false;
            this.setStatus('error', `Master connection failed: ${e?.message || 'socket error'}`);
            this.logEvent('error', `Master connection failed: ${e?.message || 'socket error'}`);
        }
    }

    private masterSend(payload: Record<string, unknown>) {
        const ws = this.masterSocket;
        if (!ws) return;
        try {
            ws.send(JSON.stringify(payload));
        } catch {
            /* socket gone */
        }
    }

    private handleMasterMessage(msg: any) {
        if (msg?.error) {
            if (!this.masterAuthorized) {
                this.running = false;
                this.setStatus('error', msg.error.message || 'Master authorization failed.');
                this.logEvent(
                    'error',
                    `Master authorize failed: ${msg.error.message || msg.error.code || 'unknown error'}`
                );
                const ws = this.masterSocket;
                this.masterSocket = null;
                if (ws) {
                    try {
                        ws.close();
                    } catch {
                        /* already closed */
                    }
                }
            } else {
                this.logEvent('error', `Master socket error: ${msg.error.message || msg.error.code}`);
            }
            return;
        }
        if (msg?.authorize) {
            const auth = msg.authorize;
            const isVirtual = auth.is_virtual === 1 || auth.is_virtual === true;
            this.masterAuthorized = true;
            this.reconnectAttempts = 0;
            this.update({
                master: {
                    connected: true,
                    loginid: auth.loginid ? String(auth.loginid) : null,
                    balance: Number.isFinite(Number(auth.balance)) ? Number(auth.balance) : null,
                    isVirtual,
                },
            });
            this.setStatus('running', 'Watching master account for new trades…');
            this.logEvent(
                'success',
                `Connected to master ${auth.loginid || ''} (${isVirtual ? 'DEMO' : 'REAL'}) — ${
                    this.state.settings.allowRealCopiers
                        ? 'replication may target demo and REAL copiers.'
                        : 'signals only; copiers must be demo accounts (or enable "Allow real copiers").'
                }`
            );
            this.masterSend({ portfolio: 1, subscribe: 1 });
            return;
        }
        if (msg?.portfolio !== undefined) {
            this.handlePortfolio(msg.portfolio);
            return;
        }
        if (msg?.proposal_open_contract) {
            this.handleMasterContract(msg.proposal_open_contract);
        }
    }

    private handleMasterClose(ws: WebSocket) {
        if (this.masterSocket && this.masterSocket !== ws) return;
        this.masterSocket = null;
        const wasAuthorized = this.masterAuthorized;
        this.masterAuthorized = false;
        this.update({ master: { connected: false, loginid: null, balance: null, isVirtual: null } });
        if (this.running) {
            if (wasAuthorized) this.logEvent('warn', 'Master connection lost — reconnecting…');
            this.scheduleReconnect();
        } else if (this.state.status === 'stopping') {
            this.setStatus('idle', 'Stopped');
        }
    }

    private scheduleReconnect() {
        if (!this.running) return;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
        this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, MAX_RECONNECT_ATTEMPTS);
        this.logEvent('info', `Reconnecting to master in ${Math.round(delay / 1000)}s…`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectMaster();
        }, delay);
    }

    private handlePortfolio(portfolio: any) {
        const open: any[] = Array.isArray(portfolio?.portfolio_open)
            ? portfolio.portfolio_open
            : Array.isArray(portfolio)
              ? portfolio
              : [];
        for (const entry of open) {
            const id = Number(entry?.contract_id);
            if (!Number.isFinite(id) || this.seenContracts.has(id)) continue;
            this.seenContracts.add(id);
            this.bumpStat('observed');
            this.logEvent(
                'info',
                `Master opened contract #${id}${entry?.contract_type ? ` — ${entry.contract_type}${entry.barrier ? `(${entry.barrier})` : ''} on ${entry.symbol || ''}` : ''}.`
            );
            this.masterSend({ proposal_open_contract: 1, contract_id: id, subscribe: 1 });
        }
    }

    private handleMasterContract(poc: any) {
        const id = Number(poc?.contract_id);
        if (!Number.isFinite(id)) return;
        if (poc.is_sold === 1 || poc.is_sold === true) return;
        if (!this.seenContracts.has(id)) {
            this.seenContracts.add(id);
            this.bumpStat('observed');
        }
        if (!this.running || this.replicatedContracts.has(id)) return;
        this.replicatedContracts.add(id);
        void this.replicate(poc);
    }

    private skipCopier(copier: CopierStatus, reason: string) {
        this.bumpCopier(copier.id, 'skipped');
        this.bumpStat('skipped');
        this.logEvent('warn', `${copier.label} skipped: ${reason}`);
    }

    private async replicate(poc: any) {
        const contractId = Number(poc.contract_id);
        const contractType = String(poc.contract_type || '');
        const symbol = String(poc.symbol || poc.underlying_symbol || '');
        const duration = Number(poc.duration) || 1;
        const durationUnit = String(poc.duration_unit || 't');
        const currency = String(poc.currency || '');
        const masterStake = Number(poc.buy_price ?? poc.purchase_price ?? 0);

        if (!contractType || !symbol) {
            this.bumpStat('skipped');
            this.logEvent('warn', `Master #${contractId} has no contract details — not copied.`);
            return;
        }
        if (!this.state.settings.replicationEnabled) {
            this.bumpStat('skipped');
            this.logEvent('info', `Replication is off — master #${contractId} observed but skipped.`);
            return;
        }
        if (!(masterStake > 0)) {
            this.bumpStat('skipped');
            this.logEvent('warn', `Master #${contractId} stake unknown — skipped.`);
            return;
        }

        for (const copier of [...this.state.copiers]) {
            if (!copier.enabled) continue;
            const token = this.tokens.get(copier.id);
            const meta = this.copierMeta.get(copier.id);
            const realAllowed = this.state.settings.allowRealCopiers;
            if (!token || !copier.authorized || (!meta?.isVirtual && !realAllowed)) {
                this.skipCopier(copier, copier.lastError || 'non-demo copier blocked');
                continue;
            }
            if (currency && meta.currency && meta.currency !== currency) {
                this.skipCopier(copier, `currency mismatch (master ${currency}, copier ${meta.currency})`);
                continue;
            }
            const { settings } = this.state;
            let stake = Math.round(masterStake * settings.stakeMultiplier);
            if (settings.stakeCap !== null && Number.isFinite(settings.stakeCap)) {
                stake = Math.min(stake, settings.stakeCap);
            }
            if (!(stake >= MIN_STAKE)) {
                this.skipCopier(copier, `stake ${stake} below the ${MIN_STAKE} minimum after multiplier/cap`);
                continue;
            }
            const boughtId = await this.buyOnCopier(copier, token, {
                symbol,
                contractType,
                barrier: barrierFor(contractType, poc.barrier),
                stake,
                duration,
                durationUnit,
                currency: meta.currency || currency,
            });
            if (boughtId !== null) {
                this.logEvent(
                    'purchase',
                    `${copier.label}: copied #${contractId} → ${contractType}${poc.barrier ? `(${poc.barrier})` : ''} ${symbol} @ ${stake}`,
                    { contractId }
                );
                voiceService.announceSignal({
                    bot: 'Copy Trading',
                    market: symbol,
                    signal: `${contractType}${poc.barrier ? ` ${poc.barrier}` : ''}`,
                    executed: true,
                });
            }
        }
    }

    private buyOnCopier(
        copier: CopierStatus,
        token: string,
        order: {
            symbol: string;
            contractType: string;
            barrier?: string;
            stake: number;
            duration: number;
            durationUnit: string;
            currency: string;
        }
    ): Promise<number | null> {
        return new Promise(resolve => {
            // Per-copier pacing: successive buy attempts on the same account are
            // spaced at least BUY_SPACING_MS apart (Deriv rate-limits order traffic).
            const now = Date.now();
            const last = this.lastBuyAttemptAt.get(copier.id) ?? 0;
            const wait = Math.max(0, BUY_SPACING_MS - (now - last));
            this.lastBuyAttemptAt.set(copier.id, now + wait);
            const begin = () => this.openBuySocket(copier, token, order, resolve);
            if (wait > 0) setTimeout(begin, wait);
            else begin();
        });
    }

    /**
     * Buy on the copier's own socket with the trading/v1-safe sequence:
     * SUBSCRIBED proposal (`subscribe: 1` keeps the id valid on the socket) →
     * `buy` against the streamed id → keep the socket open and watch the
     * contract via `proposal_open_contract` until it settles. A one-shot
     * proposal id is refused by the time buy lands ("Unknown contract
     * proposal" — see api.ts requestLive). A retryable buy rejection gets ONE
     * fresh proposal, mirroring executeBuyFresh.
     */
    private openBuySocket(
        copier: CopierStatus,
        token: string,
        order: {
            symbol: string;
            contractType: string;
            barrier?: string;
            stake: number;
            duration: number;
            durationUnit: string;
            currency: string;
        },
        resolve: (contractId: number | null) => void
    ): void {
        let resolved = false;
        let phase: 'proposal' | 'buy' | 'monitoring' | 'done' = 'proposal';
        let retried = false;
        let contractId: number | null = null;
        let ws: WebSocket | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const clearTimer = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        };
        const close = () => {
            const socket = ws;
            ws = null;
            if (socket) {
                this.watchSockets.delete(socket);
                try {
                    socket.close();
                } catch {
                    /* already closed */
                }
            }
        };
        const finishBuy = (id: number | null, error?: string) => {
            if (resolved) return;
            resolved = true;
            clearTimer();
            if (id === null) {
                const reason = error || 'copy failed';
                this.bumpCopier(copier.id, 'failed');
                this.bumpStat('failed');
                this.patchCopier(copier.id, { lastError: reason });
                this.logEvent('error', `${copier.label}: copy failed — ${reason}`);
                close();
            }
            resolve(id);
        };
        const sendProposal = (s: WebSocket) => {
            const params: Record<string, unknown> = {
                proposal: 1,
                // Subscribed proposals stay purchasable on this socket; a
                // one-shot id is dead by the time buy is issued.
                subscribe: 1,
                amount: order.stake,
                basis: 'stake',
                contract_type: order.contractType,
                duration: order.duration,
                duration_unit: order.durationUnit,
                symbol: order.symbol,
            };
            if (order.currency) params.currency = order.currency;
            if (order.barrier !== undefined) params.barrier = order.barrier;
            s.send(JSON.stringify(params));
        };
        const settleCopierContract = (poc: any) => {
            // Mirror execution.settleFrom: a sold contract with NO outcome data
            // becomes unknown — never fabricated into a win or loss.
            const hasWinFlag = poc.is_won !== undefined && poc.is_won !== null;
            const hasProfit = poc.profit !== undefined && poc.profit !== null;
            const hasSellPrice = poc.sell_price !== undefined || poc.bid_price !== undefined;
            const sellPrice = Number(poc.sell_price ?? poc.bid_price ?? 0);
            const buyPrice = Number(poc.buy_price ?? order.stake);
            const id = contractId as number;
            if (!hasWinFlag && !hasProfit && !hasSellPrice) {
                this.logEvent(
                    'warn',
                    `${copier.label}: #${id} sold but the server sent no outcome (is_won/profit/sell_price missing) — settlement not recorded.`
                );
                phase = 'done';
                clearTimer();
                close();
                return;
            }
            const profit = hasProfit ? Number(poc.profit) : sellPrice - buyPrice;
            if (!Number.isFinite(profit)) {
                this.logEvent('warn', `${copier.label}: #${id} settlement profit unreadable — settlement not recorded.`);
                phase = 'done';
                clearTimer();
                close();
                return;
            }
            const won = hasWinFlag ? poc.is_won === 1 || poc.is_won === true : profit > 0;
            phase = 'done';
            clearTimer();
            close();
            this.recordSettlement(copier, id, won, profit, order.symbol);
        };

        try {
            ws = this.openSocket(token, {
                onOpen: s => {
                    try {
                        sendProposal(s);
                    } catch {
                        finishBuy(null, 'socket send failed');
                        return;
                    }
                    timer = setTimeout(() => {
                        finishBuy(
                            null,
                            phase === 'proposal' ? 'no proposal response before the timeout' : 'buy timed out'
                        );
                    }, SOCKET_TIMEOUT_MS);
                },
                onMessage: (msg, s) => {
                    if (phase === 'monitoring') {
                        if (msg?.error) {
                            // Transient watch error — keep waiting for the
                            // settlement deadline instead of faking a result.
                            this.logEvent(
                                'warn',
                                `${copier.label}: contract watch error — ${msg.error.message || msg.error.code || 'request failed'}`
                            );
                            return;
                        }
                        const poc = msg?.proposal_open_contract;
                        if (!poc) return;
                        const sold = poc.is_sold === 1 || poc.is_sold === true || poc.is_expired === 1;
                        if (sold) settleCopierContract(poc);
                        return;
                    }
                    if (phase === 'done') return;
                    if (msg?.error) {
                        const detail = msg.error.message || msg.error.code || 'request failed';
                        if (phase === 'buy' && !retried && RETRYABLE_BUY_RE.test(detail)) {
                            // Stale proposal (price moved / expired): re-subscribe
                            // a fresh proposal once, like executeBuyFresh's retry.
                            retried = true;
                            phase = 'proposal';
                            try {
                                sendProposal(s);
                            } catch {
                                finishBuy(null, 'socket send failed');
                            }
                            return;
                        }
                        finishBuy(null, detail);
                        return;
                    }
                    if (msg?.proposal) {
                        if (phase !== 'proposal') return; // live stream refresh — already bought
                        const p = msg.proposal;
                        const ask = Number(p.ask_price);
                        const payout = Number(p.payout);
                        if (!Number.isFinite(ask) || !Number.isFinite(payout)) {
                            finishBuy(null, 'malformed proposal response');
                            return;
                        }
                        if (payout <= ask) {
                            finishBuy(null, `no return: payout ${payout} never exceeds the ${ask} stake`);
                            return;
                        }
                        phase = 'buy';
                        try {
                            s.send(JSON.stringify({ buy: p.id, price: ask }));
                        } catch {
                            finishBuy(null, 'socket send failed');
                        }
                        return;
                    }
                    if (msg?.buy) {
                        if (phase !== 'buy') return;
                        const boughtId = Number(msg.buy.contract_id);
                        if (!Number.isFinite(boughtId)) {
                            finishBuy(null, 'no contract_id in buy response');
                            return;
                        }
                        contractId = boughtId;
                        this.bumpCopier(copier.id, 'copied');
                        this.bumpStat('copied');
                        this.patchCopier(copier.id, { lastError: null, lastSeen: Date.now() });
                        phase = 'monitoring';
                        finishBuy(boughtId);
                        // Keep the socket open and follow the contract to settlement.
                        this.watchSockets.add(s);
                        try {
                            s.send(
                                JSON.stringify({
                                    proposal_open_contract: 1,
                                    contract_id: boughtId,
                                    subscribe: 1,
                                })
                            );
                            timer = setTimeout(() => {
                                this.logEvent(
                                    'warn',
                                    `${copier.label}: #${boughtId} did not settle within the tracking window — outcome unknown.`
                                );
                                phase = 'done';
                                clearTimer();
                                close();
                            }, settlementWatchMs(order.duration, order.durationUnit));
                        } catch {
                            this.logEvent(
                                'warn',
                                `${copier.label}: could not subscribe to contract #${boughtId} — settlement will not be tracked.`
                            );
                        }
                        return;
                    }
                },
                onClose: s => {
                    this.watchSockets.delete(s);
                    if (!resolved) {
                        finishBuy(null, 'connection closed before the buy completed');
                        return;
                    }
                    if (phase === 'monitoring' && contractId !== null) {
                        clearTimer();
                        this.logEvent(
                            'warn',
                            `${copier.label}: connection closed while monitoring #${contractId} — settlement unknown.`
                        );
                        phase = 'done';
                    }
                },
            });
        } catch (e: any) {
            finishBuy(null, e?.message || 'socket error');
        }
    }

    /** Record a settled copy: PnL counters, event log and voice announcement. */
    private recordSettlement(copier: CopierStatus, contractId: number, won: boolean, profit: number, symbol: string) {
        this.update({
            stats: {
                ...this.state.stats,
                settled: this.state.stats.settled + 1,
                won: this.state.stats.won + (won ? 1 : 0),
                lost: this.state.stats.lost + (won ? 0 : 1),
                profit: this.state.stats.profit + profit,
            },
        });
        this.patchCopier(copier.id, { lastSeen: Date.now() });
        this.logEvent(
            'settlement',
            `${copier.label}: ${won ? 'WIN' : 'LOSS'} #${contractId}${symbol ? ` ${symbol}` : ''} — ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`,
            { contractId, result: won ? 'win' : 'loss', profit }
        );
        voiceService.announceSettlement({ bot: 'Copy Trading', won, profit, market: symbol || undefined });
    }
}

export const copyTrading = new CopyTradingEngine();
