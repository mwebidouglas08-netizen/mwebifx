/**
 * Dollarvault AI Voice Module — Web Speech API (speechSynthesis) announcements
 * for favourable signals and trade settlements across every bot engine.
 *
 * Design goals:
 *  - Zero-dependency, browser-native TTS (no network, no API key).
 *  - Robust: safe no-ops when speechSynthesis is unavailable (SSR / old browsers).
 *  - Non-spamming: cancels overlapping speech, enforces a min interval, and
 *    coalesces rapid announcements into the most recent one.
 *  - Persisted: enabled state, rate, pitch and volume live in localStorage via
 *    the existing dbot_settings KV store.
 */

import { getSetting, storeSetting } from '@/utils/settings';

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

export interface VoiceSettings {
    enabled: boolean;
    /** Speech rate 0.1–2 (1 = normal). */
    rate: number;
    /** Pitch 0–2 (1 = normal). */
    pitch: number;
    /** Volume 0–1. */
    volume: number;
    /** Minimum ms between announcements — newer ones cancel older speech. */
    minIntervalMs: number;
}

const SETTING_KEY = 'voice_settings';

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
    enabled: true,
    rate: 1.05,
    pitch: 1.0,
    volume: 1.0,
    minIntervalMs: 900,
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------------------
// Change notification (so React toggles re-render)
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to voice-setting changes. Returns an unsubscribe fn. */
export const subscribeVoiceSettings = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const notify = (): void => listeners.forEach(l => l());

export const loadVoiceSettings = (): VoiceSettings => {
    try {
        const raw = getSetting(SETTING_KEY);
        if (!raw || typeof raw !== 'object') return { ...DEFAULT_VOICE_SETTINGS };
        return {
            enabled: raw.enabled !== false,
            rate: clamp(Number(raw.rate) || DEFAULT_VOICE_SETTINGS.rate, 0.1, 2),
            pitch: clamp(Number(raw.pitch) || DEFAULT_VOICE_SETTINGS.pitch, 0, 2),
            volume: Number.isFinite(Number(raw.volume)) ? clamp(Number(raw.volume), 0, 1) : 1,
            minIntervalMs: clamp(Number(raw.minIntervalMs) || DEFAULT_VOICE_SETTINGS.minIntervalMs, 200, 10000),
        };
    } catch {
        return { ...DEFAULT_VOICE_SETTINGS };
    }
};

export const saveVoiceSettings = (patch: Partial<VoiceSettings>): VoiceSettings => {
    const next = { ...loadVoiceSettings(), ...patch };
    try {
        storeSetting(SETTING_KEY, next);
    } catch {
        // storage full / private mode — keep in-memory only
    }
    voiceService.applySettings(next);
    notify();
    return next;
};

// ---------------------------------------------------------------------------
// Announcement kinds
// ---------------------------------------------------------------------------

export interface SignalAnnouncement {
    /** Bot display name, e.g. "Algo Pro AI". */
    bot: string;
    /** Market display name, e.g. "Volatility 75 Index". */
    market: string;
    /** Signal label, e.g. "Trade Over 2". */
    signal: string;
    /** 0–1 confidence, optional. */
    confidence?: number;
    /** 0–100 strength, optional (signal-scanner scale). */
    strength?: number;
    /** True when the signal cleared the bot's strongest gate. */
    strong?: boolean;
    /** Contract type, optional — used for a slightly richer sentence. */
    contractType?: string;
    /** Whether the trade was actually placed or just detected. */
    executed?: boolean;
}

export interface SettlementAnnouncement {
    bot: string;
    won: boolean;
    profit: number;
    contractType?: string;
    market?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Minimum ms between two detection announcements for the same bot+market. */
const DETECTION_THROTTLE_MS = 8000;
/** Minimum ms between ANY two detection announcements (across all bots) so a
 *  crowded board can never turn into a wall of speech. */
const DETECTION_GLOBAL_MS = 6000;

/** Spoken once when the app opens (or refreshes) — intense, inviting, short. */
const WELCOME_TEXT =
    'Welcome to Dollarvault — your AI trading terminal is live. ' +
    'The markets are moving, the engines are armed, and the next strong signal is already forming. ' +
    'Let\u2019s trade.';

const synth = (): SpeechSynthesis | null =>
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

class VoiceService {
    private settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };
    private voices: SpeechSynthesisVoice[] = [];
    private lastSpokeAt = 0;
    private supported: boolean;
    private cachedBest: SpeechSynthesisVoice | null = null;
    /** Per bot+market throttle for detection (non-executed) announcements. */
    private detectionAt = new Map<string, number>();
    /** Global detection throttle — at most one detected-signal line per window. */
    private lastDetectionAtAny = 0;
    /** The welcome line fires at most once per page load. */
    private welcomed = false;

    constructor() {
        this.supported = synth() !== null;
        if (this.supported) {
            this.settings = loadVoiceSettings();
            this.refreshVoices();
            // Chrome loads voices asynchronously.
            const s = synth();
            s?.addEventListener?.('voiceschanged', () => this.refreshVoices());
        }
    }

    isSupported(): boolean {
        return this.supported;
    }

    isEnabled(): boolean {
        return this.supported && this.settings.enabled;
    }

    getSettings(): VoiceSettings {
        return { ...this.settings };
    }

    applySettings(next: VoiceSettings) {
        this.settings = { ...next };
        if (!this.settings.enabled) this.cancel();
    }

    setEnabled(enabled: boolean): VoiceSettings {
        return saveVoiceSettings({ enabled });
    }

    private refreshVoices() {
        const s = synth();
        if (!s) return;
        this.voices = s.getVoices() || [];
        this.cachedBest = null;
    }

    /** Prefer a natural English voice (Google/Sapi/local), falling back to the first English one. */
    private pickVoice(): SpeechSynthesisVoice | null {
        if (this.cachedBest) return this.cachedBest;
        if (!this.voices.length) this.refreshVoices();
        if (!this.voices.length) return null;

        const english = this.voices.filter(v => /^en(-|_|$)/i.test(v.lang || ''));
        const pool = english.length ? english : this.voices;

        const score = (v: SpeechSynthesisVoice): number => {
            let s = 0;
            const name = (v.name || '').toLowerCase();
            if (/google/i.test(name)) s += 6;
            if (/natural|enhanced|neural/i.test(name)) s += 5;
            if (/samantha|karen|daniel|serena|alex/i.test(name)) s += 3;
            if (/microsoft|zira|david|aria/i.test(name)) s += 2;
            if (v.localService) s += 1;
            if (v.default) s += 1;
            return s;
        };

        this.cachedBest = [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
        return this.cachedBest;
    }

    cancel() {
        const s = synth();
        if (!s) return;
        try {
            s.cancel();
        } catch {
            // ignore
        }
    }

    /**
     * Speak a plain string. Cancels any in-flight speech so rapid announcements
     * coalesce to the most recent (avoids a growing TTS queue during fast scans).
     * `force` bypasses the minimum-interval throttle (e.g. take-profit / stop-loss
     * guards) — it never bypasses the user's enabled switch.
     * `onStarted` reports whether the utterance actually began speaking, which is
     * how callers detect browsers that silently block speech before a gesture.
     */
    speak(text: string, opts: { force?: boolean; onStarted?: (started: boolean) => void } = {}): boolean {
        if (!this.supported) return false;
        if (!this.settings.enabled) return false;
        const trimmed = (text || '').trim();
        if (!trimmed) return false;

        const s = synth();
        if (!s) return false;

        const now = Date.now();
        const sinceLast = now - this.lastSpokeAt;
        // Always cancel prior speech; enforce min spacing unless forced.
        if (sinceLast < this.settings.minIntervalMs && !opts.force) {
            // Too soon — drop this announcement rather than interrupting a
            // longer one that just started.
            return false;
        }

        try {
            s.cancel();
        } catch {
            // ignore
        }

        const u = new SpeechSynthesisUtterance(trimmed);
        const voice = this.pickVoice();
        if (voice) {
            u.voice = voice;
            u.lang = voice.lang;
        } else {
            u.lang = 'en-US';
        }
        u.rate = this.settings.rate;
        u.pitch = this.settings.pitch;
        u.volume = this.settings.volume;
        if (opts.onStarted) {
            let reported = false;
            const report = (started: boolean) => {
                if (reported) return;
                reported = true;
                opts.onStarted?.(started);
            };
            u.onstart = () => report(true);
            u.onerror = () => report(false);
            // Some engines never fire onstart when speech is blocked — don't
            // leave the caller waiting forever.
            setTimeout(() => report(false), 2500);
        }
        this.lastSpokeAt = now;
        try {
            s.speak(u);
            return true;
        } catch {
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // Structured announcements
    // -----------------------------------------------------------------------

    /** Announce a detected (and optionally executed) favourable signal. */
    announceSignal(a: SignalAnnouncement): boolean {
        if (!this.isEnabled()) return false;
        const pct =
            a.confidence !== undefined
                ? ` at ${Math.round(a.confidence * 100)} percent confidence`
                : a.strength !== undefined
                  ? ` at ${Math.round(a.strength)} percent strength`
                  : '';
        if (a.executed) {
            return this.speak(`Trade placed on ${a.market}. ${a.signal}${pct}. ${a.bot}.`);
        }
        // Detection announcements are throttled per bot+market so a market that
        // stays favourable (or several markets flashing at once) cannot turn
        // into a wall of speech — the newest strong signal still gets through.
        const key = `${a.bot}|${a.market}`;
        const now = Date.now();
        const last = this.detectionAt.get(key) ?? 0;
        const strong = a.strong ?? (a.strength !== undefined && a.strength >= 75);
        if (now - last < DETECTION_THROTTLE_MS) return false;
        if (now - this.lastDetectionAtAny < DETECTION_GLOBAL_MS) return false;
        const text = strong
            ? `Strong signal detected. ${a.signal} on ${a.market}${pct}. ${a.bot}.`
            : `Favourable signal detected on ${a.market}. ${a.signal}${pct}. ${a.bot}.`;
        const ok = this.speak(text);
        // Only consume the throttle when the line actually went out — a drop
        // (recent speech / muted) lets the next scan cycle retry.
        if (ok) {
            this.detectionAt.set(key, now);
            this.lastDetectionAtAny = now;
        }
        return ok;
    }

    /** Announce a trade settlement (win/loss). */
    announceSettlement(a: SettlementAnnouncement): boolean {
        if (!this.isEnabled()) return false;
        const where = a.market ? ` on ${a.market}` : '';
        const amount = `${Math.abs(a.profit).toFixed(2)}`;
        const text = a.won
            ? `Win${where}. Profit ${amount} dollars. ${a.bot}.`
            : `Loss${where}. Down ${amount} dollars. ${a.bot}.`;
        return this.speak(text);
    }

    /** Announce a session guard (take-profit / stop-loss / win target). */
    announceGuard(message: string, bot: string): boolean {
        if (!this.isEnabled()) return false;
        return this.speak(`${bot}. ${message}.`);
    }

    /** Announce a generic status line (bot started / stopped). */
    announceStatus(message: string): boolean {
        if (!this.isEnabled()) return false;
        return this.speak(message);
    }

    /** Warm up speech on the first user gesture (some browsers block autoplay TTS). */
    prime() {
        if (!this.supported) return;
        this.speak('Voice assistant ready.', { force: true });
    }

    /**
     * Cinematic welcome — fired once per page load when the app opens (or is
     * refreshed). Some browsers refuse to speak before a user gesture, so when
     * the utterance doesn't start we wait for the first pointer/key event and
     * deliver it then instead of losing it.
     */
    announceWelcome(): boolean {
        if (!this.supported || !this.settings.enabled) return false;
        if (this.welcomed) return false;
        this.welcomed = true;
        return this.speakWelcome();
    }

    private speakWelcome(): boolean {
        let delivered = false;
        const ok = this.speak(WELCOME_TEXT, {
            force: true,
            onStarted: started => {
                if (started) delivered = true;
            },
        });
        if (!ok) return false;
        if (typeof document === 'undefined') return true;
        const timer = setTimeout(() => {
            if (delivered) return;
            const retry = () => {
                clearTimeout(timer);
                document.removeEventListener('pointerdown', retry);
                document.removeEventListener('keydown', retry);
                document.removeEventListener('touchend', retry);
                if (delivered) return;
                this.speak(WELCOME_TEXT, { force: true, onStarted: started => { if (started) delivered = true; } });
            };
            document.addEventListener('pointerdown', retry);
            document.addEventListener('keydown', retry);
            document.addEventListener('touchend', retry);
        }, 3000);
        return true;
    }
}

export const voiceService = new VoiceService();

// ---------------------------------------------------------------------------
// Convenience re-exports for engines
// ---------------------------------------------------------------------------

/** Human-friendly contract type for announcements. */
export const contractSpokenLabel = (contractType?: string, barrier?: number): string => {
    switch (contractType) {
        case 'DIGITOVER':
            return `Trade over ${barrier ?? ''}`.trim();
        case 'DIGITUNDER':
            return `Trade under ${barrier ?? ''}`.trim();
        case 'DIGITEVEN':
            return 'Trade even';
        case 'DIGITODD':
            return 'Trade odd';
        case 'CALL':
            return 'Trade rise';
        case 'PUT':
            return 'Trade fall';
        default:
            return 'Trade';
    }
};
