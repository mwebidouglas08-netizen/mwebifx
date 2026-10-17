import { voiceService } from '@/services/voice-service';
import { looksLikeCommand, normalizeTranscript, parseVoiceCommand } from './parser';
import { executeVoiceIntent } from './executor';

export interface VoiceHistoryEntry {
    id: number;
    heard: string;
    reply: string;
    ok: boolean;
    at: number;
}

export interface VoiceAgentState {
    supported: boolean;
    listening: boolean;
    interim: string;
    lastHeard: string | null;
    lastReply: string | null;
    error: string | null;
    history: VoiceHistoryEntry[];
}

/**
 * Minimal structural types for the Web Speech API — TypeScript's lib.dom does
 * not define SpeechRecognition, so the shapes the agent relies on are declared
 * here and installed from window at call time (jsdom and Firefox have none).
 */
interface SpeechRecognitionResultLike {
    isFinal: boolean;
    0: { transcript: string };
}

interface SpeechRecognitionEventLike {
    resultIndex: number;
    results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: { error?: string }) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const recognitionCtor = (): SpeechRecognitionCtor | null => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Mic-permission / transport errors that must end the session, not retry. */
const FATAL_RECOGNITION_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network']);

const HISTORY_CAP = 8;
const RESTART_DELAY_MS = 250;

const listeners = new Set<(state: VoiceAgentState) => void>();
let state: VoiceAgentState = {
    supported: false,
    listening: false,
    interim: '',
    lastHeard: null,
    lastReply: null,
    error: null,
    history: [],
};

let rec: SpeechRecognitionLike | null = null;
let wantListening = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
/** Wall-clock window in which incoming speech is treated as our own TTS echo. */
let ignoreUntil = 0;
let lastSpokenReply = '';
let historySeq = 0;
/** Serializes utterance handling so two finals from one event cannot interleave. */
let queue: Promise<void> = Promise.resolve();

const notify = (): void => {
    const snapshot = voiceAgent.getState();
    listeners.forEach(listener => listener(snapshot));
};

const setState = (patch: Partial<VoiceAgentState>): void => {
    state = { ...state, ...patch };
    notify();
};

/** Roughly how long a reply takes to say — during it, mic input is ignored. */
const speakWindowMs = (reply: string): number =>
    Math.min(20000, 400 + reply.split(/\s+/).filter(Boolean).length * 320);

/** Run a text command through the same parse → execute → speak pipeline. */
const submitText = (raw: string): Promise<void> => {
    const heard = raw.trim();
    if (!heard) return Promise.resolve();
    const run = async () => {
        if (Date.now() < ignoreUntil) return;
        const normalized = normalizeTranscript(heard);
        if (normalized && lastSpokenReply && normalized === normalizeTranscript(lastSpokenReply)) return;
        setState({ interim: '', lastHeard: heard });

        const intent = parseVoiceCommand(heard);
        let reply = '';
        let ok = false;
        if (intent) {
            const result = await executeVoiceIntent(intent);
            reply = result.reply;
            ok = result.ok;
        } else if (looksLikeCommand(heard)) {
            reply = "Sorry, I didn't catch that. Say 'help' for what I can do.";
        }

        if (reply) {
            const spoke = voiceService.speak(reply, { force: true });
            if (spoke) {
                lastSpokenReply = reply;
                ignoreUntil = Date.now() + speakWindowMs(reply);
            }
        }

        setState({
            lastReply: reply || null,
            history: [{ id: ++historySeq, heard, reply, ok, at: Date.now() }, ...state.history].slice(0, HISTORY_CAP),
        });

        if (intent?.kind === 'stop-listening') stopListening();
    };
    // A rejection anywhere in one utterance must never poison the queue.
    queue = queue.catch(() => undefined).then(run).catch(() => undefined);
    return queue;
};

const handleRecognitionResult = (event: SpeechRecognitionEventLike): void => {
    if (Date.now() < ignoreUntil) return;
    let interim = '';
    const finals: string[] = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finals.push(result[0].transcript);
        else interim += result[0].transcript;
    }
    setState({ interim });
    for (const text of finals) submitText(text);
};

const scheduleRestart = (): void => {
    if (!wantListening || restartTimer) return;
    restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!wantListening || rec) return;
        const Ctor = recognitionCtor();
        if (!Ctor) return;
        rec = new Ctor();
        wireRecognition(rec);
        try {
            rec.start();
        } catch {
            rec = null;
        }
    }, RESTART_DELAY_MS);
};

const wireRecognition = (r: SpeechRecognitionLike): void => {
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = handleRecognitionResult;
    r.onend = () => {
        rec = null;
        scheduleRestart();
    };
    r.onerror = event => {
        const error = event?.error || '';
        if (FATAL_RECOGNITION_ERRORS.has(error)) {
            wantListening = false;
            if (restartTimer) {
                clearTimeout(restartTimer);
                restartTimer = null;
            }
            rec = null;
            const message =
                error === 'not-allowed' || error === 'service-not-allowed'
                    ? 'Microphone access blocked — allow the mic in your browser settings.'
                    : error === 'audio-capture'
                      ? 'No microphone found.'
                      : 'Speech service unavailable — check your connection.';
            setState({ listening: false, interim: '', error: message });
        }
        // 'no-speech' / 'aborted' fall through to onend, which restarts.
    };
};

const stopListening = (): void => {
    wantListening = false;
    // A fresh session drops the TTS-echo guard — the next utterance deserves
    // to be heard even if the previous reply window is still open.
    ignoreUntil = 0;
    lastSpokenReply = '';
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
    const active = rec;
    rec = null;
    try {
        active?.abort();
    } catch {
        // ignore
    }
    setState({ listening: false, interim: '' });
};

const startListening = (): boolean => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
        setState({
            error: 'Voice input is not supported in this browser. You can still type commands below.',
        });
        return false;
    }
    if (rec) return true;
    wantListening = true;
    const r = new Ctor();
    rec = r;
    wireRecognition(r);
    try {
        r.start();
    } catch {
        rec = null;
        wantListening = false;
        setState({ error: 'Could not start the microphone. Click the mic again to retry.' });
        return false;
    }
    setState({ listening: true, error: null, interim: '' });
    return true;
};

export const voiceAgent = {
    isSupported(): boolean {
        return recognitionCtor() !== null;
    },
    getState(): VoiceAgentState {
        return { ...state, supported: recognitionCtor() !== null };
    },
    subscribe(listener: (state: VoiceAgentState) => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
    startListening,
    stopListening,
    toggleListening(): boolean {
        if (wantListening) {
            stopListening();
            return false;
        }
        return startListening();
    },
    /** Run a text command through the same parse → execute → speak pipeline. */
    submitText,
};
