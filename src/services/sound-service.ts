/**
 * Dollarvault Sound FX — Web Audio API sound effects for critical interactions
 * (bot start/stop, welcome fanfare, strong-signal blips, wins).
 *
 * Design goals:
 *  - Zero-dependency: every sound is synthesised (oscillators + envelopes), so
 *    no binary assets are shipped and nothing can 404.
 *  - Autoplay-safe: browsers only allow audio after a user gesture, so a
 *    suspended AudioContext queues the requested sound and flushes it on the
 *    first pointer/key event.
 *  - Persisted: on/off + volume live in the dbot_settings KV store, and the
 *    change is published so React toggles re-render.
 */

import { getSetting, storeSetting } from '@/utils/settings';

export type SoundName = 'welcome' | 'click' | 'botStart' | 'botStop' | 'signal' | 'win' | 'error';

export interface SoundSettings {
    enabled: boolean;
    /** Master volume 0–1. */
    volume: number;
}

const SETTING_KEY = 'sound_settings';

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
    enabled: true,
    volume: 0.7,
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------------------
// Change notification (React toggles)
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

export const subscribeSoundSettings = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const notify = (): void => listeners.forEach(l => l());

export const loadSoundSettings = (): SoundSettings => {
    try {
        const raw = getSetting(SETTING_KEY);
        if (!raw || typeof raw !== 'object') return { ...DEFAULT_SOUND_SETTINGS };
        return {
            enabled: raw.enabled !== false,
            volume: Number.isFinite(Number(raw.volume)) ? clamp(Number(raw.volume), 0, 1) : DEFAULT_SOUND_SETTINGS.volume,
        };
    } catch {
        return { ...DEFAULT_SOUND_SETTINGS };
    }
};

export const saveSoundSettings = (patch: Partial<SoundSettings>): SoundSettings => {
    const next = { ...loadSoundSettings(), ...patch };
    try {
        storeSetting(SETTING_KEY, next);
    } catch {
        // storage full / private mode — keep in-memory only
    }
    notify();
    return next;
};

// ---------------------------------------------------------------------------
// Sound design — a note = { frequency, start offset, duration, envelope gain }
// ---------------------------------------------------------------------------

interface Note {
    freq: number;
    at: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
}

const PATTERNS: Record<SoundName, Note[]> = {
    // Cinematic rising fanfare under the welcome voice.
    welcome: [
        { freq: 523.25, at: 0, dur: 0.5 },
        { freq: 659.25, at: 0.14, dur: 0.5 },
        { freq: 783.99, at: 0.28, dur: 0.6 },
        { freq: 1046.5, at: 0.44, dur: 1.1 },
    ],
    click: [{ freq: 920, at: 0, dur: 0.05, gain: 0.35 }],
    // Arms-up arpeggio for "bot started".
    botStart: [
        { freq: 523.25, at: 0, dur: 0.13 },
        { freq: 659.25, at: 0.09, dur: 0.13 },
        { freq: 783.99, at: 0.18, dur: 0.3 },
    ],
    // Powers-down arpeggio for "bot stopped".
    botStop: [
        { freq: 783.99, at: 0, dur: 0.13 },
        { freq: 659.25, at: 0.09, dur: 0.13 },
        { freq: 523.25, at: 0.18, dur: 0.32 },
    ],
    // Bright two-tone ping for a strong signal.
    signal: [
        { freq: 1174.66, at: 0, dur: 0.1 },
        { freq: 1567.98, at: 0.11, dur: 0.24 },
    ],
    // Coin-shimmer for a win.
    win: [
        { freq: 784, at: 0, dur: 0.12 },
        { freq: 987.77, at: 0.1, dur: 0.12 },
        { freq: 1318.51, at: 0.2, dur: 0.35 },
    ],
    error: [
        { freq: 233.08, at: 0, dur: 0.22, type: 'sawtooth', gain: 0.5 },
        { freq: 174.61, at: 0.16, dur: 0.3, type: 'sawtooth', gain: 0.5 },
    ],
};

// ---------------------------------------------------------------------------
// AudioContext lifecycle (autoplay policy)
// ---------------------------------------------------------------------------

type AudioContextCtor = typeof AudioContext;

const contextCtor = (): AudioContextCtor | null => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
};

let ctx: AudioContext | null = null;
const pending: SoundName[] = [];
let gestureHooked = false;

const flushPending = () => {
    if (!pending.length) return;
    const queued = pending.splice(0, pending.length);
    queued.forEach(playNow);
};

const hookGestureFlush = () => {
    if (gestureHooked || typeof document === 'undefined') return;
    gestureHooked = true;
    const flush = () => {
        document.removeEventListener('pointerdown', flush);
        document.removeEventListener('keydown', flush);
        document.removeEventListener('touchend', flush);
        flushPending();
    };
    document.addEventListener('pointerdown', flush);
    document.addEventListener('keydown', flush);
    document.addEventListener('touchend', flush);
};

const ensureContext = (): AudioContext | null => {
    const Ctor = contextCtor();
    if (!Ctor) return null;
    if (!ctx) {
        try {
            ctx = new Ctor();
        } catch {
            return null;
        }
    }
    if (ctx.state === 'suspended') {
        // Best effort: works immediately after a gesture, silently no-ops otherwise
        // (the pending queue flushes on the next gesture).
        void ctx.resume().catch(() => undefined);
    }
    return ctx;
};

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

const playNow = (name: SoundName) => {
    const notes = PATTERNS[name];
    if (!notes?.length) return;
    const c = ensureContext();
    if (!c || c.state !== 'running') {
        if (!pending.includes(name)) pending.push(name);
        hookGestureFlush();
        return;
    }

    const settings = loadSoundSettings();
    const master = c.createGain();
    master.gain.value = settings.volume;
    master.connect(c.destination);

    const t0 = c.currentTime + 0.01;
    for (const note of notes) {
        const osc = c.createOscillator();
        const env = c.createGain();
        osc.type = note.type ?? 'sine';
        osc.frequency.setValueAtTime(note.freq, t0 + note.at);
        const peak = note.gain ?? 0.6;
        env.gain.setValueAtTime(0.0001, t0 + note.at);
        env.gain.exponentialRampToValueAtTime(peak, t0 + note.at + 0.015);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + note.at + note.dur);
        osc.connect(env);
        env.connect(master);
        osc.start(t0 + note.at);
        osc.stop(t0 + note.at + note.dur + 0.05);
        osc.onended = () => {
            try {
                osc.disconnect();
                env.disconnect();
            } catch {
                /* already torn down */
            }
        };
    }
    // Release the master gain shortly after the last note so nodes are collected.
    const total = Math.max(...notes.map(n => n.at + n.dur)) + 0.3;
    setTimeout(() => {
        try {
            master.disconnect();
        } catch {
            /* context closed */
        }
    }, total * 1000);
};

// ---------------------------------------------------------------------------
// Public service
// ---------------------------------------------------------------------------

export const soundService = {
    isSupported(): boolean {
        return contextCtor() !== null;
    },
    isEnabled(): boolean {
        return loadSoundSettings().enabled;
    },
    getSettings(): SoundSettings {
        return loadSoundSettings();
    },
    setEnabled(enabled: boolean): SoundSettings {
        return saveSoundSettings({ enabled });
    },
    update(patch: Partial<SoundSettings>): SoundSettings {
        return saveSoundSettings(patch);
    },
    /** Play a named sound. No-ops when disabled or unsupported. */
    play(name: SoundName): boolean {
        try {
            if (!loadSoundSettings().enabled) return false;
            if (!contextCtor()) return false;
            playNow(name);
            return true;
        } catch {
            return false;
        }
    },
    /** Resume a suspended context (call from a user gesture). */
    resume(): void {
        ensureContext();
    },
};
