/**
 * Dollarvault voice module — welcome line, detection throttling, strong phrasing.
 *
 * `voiceService` is a module-level singleton built from `window.speechSynthesis`,
 * so each test installs a fake synthesis engine and re-requires the module to get
 * a fresh instance. Time is driven with fake timers so the per-market (8s) and
 * global (6s) detection windows can be exercised deterministically.
 */

import type { SignalAnnouncement, VoiceSettings } from '@/services/voice-service';

type VoiceModule = typeof import('@/services/voice-service');

type FakeUtterance = {
    text: string;
    voice: SpeechSynthesisVoice | null;
    lang: string;
    rate: number;
    pitch: number;
    volume: number;
    onstart: (() => void) | null;
    onerror: (() => void) | null;
};

let spoken: string[] = [];
let lastSpokenVoice: SpeechSynthesisVoice | null = null;

const DEFAULT_VOICES = [
    { name: 'Test Voice', lang: 'en-US', localService: true, default: true, voiceURI: 'test' },
];

const installSpeech = (autoStart = false, voices: SpeechSynthesisVoice[] = DEFAULT_VOICES): void => {
    spoken = [];
    lastSpokenVoice = null;
    class FakeUtteranceImpl {
        text: string;
        voice: SpeechSynthesisVoice | null = null;
        lang = 'en-US';
        rate = 1;
        pitch = 1;
        volume = 1;
        onstart: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text = '') {
            this.text = text;
        }
    }
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtteranceImpl;
    const fake = {
        speak: (u: FakeUtterance) => {
            spoken.push(u.text);
            lastSpokenVoice = u.voice;
            if (autoStart) u.onstart?.();
        },
        cancel: jest.fn(),
        getVoices: () => voices,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true, writable: true });
};

const loadVoice = (autoStart = false, voices?: SpeechSynthesisVoice[]): VoiceModule => {
    jest.resetModules();
    installSpeech(autoStart, voices);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/services/voice-service') as VoiceModule;
};

const signal = (over: Partial<SignalAnnouncement> = {}): SignalAnnouncement => ({
    bot: 'Algo Pro AI',
    market: 'Volatility 75 Index',
    signal: 'Trade over 3',
    strong: true,
    executed: false,
    ...over,
});

const muted = (settings: VoiceSettings): VoiceSettings => ({ ...settings, enabled: false });
const unmuted = (settings: VoiceSettings): VoiceSettings => ({ ...settings, enabled: true });

const T0 = 1_700_000_000_000;

beforeEach(() => {
    localStorage.clear();
    spoken = [];
    jest.useFakeTimers();
    jest.setSystemTime(T0);
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('welcome announcement', () => {
    it('speaks once per load and again on the first gesture when the engine never started', () => {
        const { voiceService } = loadVoice();

        expect(voiceService.announceWelcome()).toBe(true);
        expect(spoken).toHaveLength(1);
        expect(spoken[0]).toContain('Welcome to Dollarvault');

        expect(voiceService.announceWelcome()).toBe(false);
        expect(spoken).toHaveLength(1);

        jest.advanceTimersByTime(3000);
        expect(spoken).toHaveLength(1);

        document.dispatchEvent(new Event('pointerdown'));
        expect(spoken).toHaveLength(2);
        expect(spoken[1]).toContain('Welcome to Dollarvault');
    });

    it('delivers without a gesture retry once the engine reports the line started', () => {
        const { voiceService } = loadVoice(true);

        expect(voiceService.announceWelcome()).toBe(true);
        expect(spoken).toHaveLength(1);

        jest.advanceTimersByTime(3000);
        document.dispatchEvent(new Event('keydown'));
        expect(spoken).toHaveLength(1);
    });

    it('stays silent when voice is muted', () => {
        const { voiceService } = loadVoice();
        voiceService.applySettings(muted(voiceService.getSettings()));

        expect(voiceService.announceWelcome()).toBe(false);
        expect(spoken).toHaveLength(0);
    });
});

describe('signal detection announcements', () => {
    it('uses strong phrasing and throttles repeats per market and globally', () => {
        const { voiceService } = loadVoice();

        expect(voiceService.announceSignal(signal({ confidence: 0.91 }))).toBe(true);
        expect(spoken[0]).toMatch(/^Strong signal detected/);
        expect(spoken[0]).toContain('91 percent confidence');

        jest.setSystemTime(T0 + 2000);
        expect(voiceService.announceSignal(signal({ confidence: 0.91 }))).toBe(false);

        jest.setSystemTime(T0 + 4000);
        expect(
            voiceService.announceSignal(signal({ market: 'Jump 100 Index', signal: 'Trade under 4' }))
        ).toBe(false);

        jest.setSystemTime(T0 + 6500);
        expect(
            voiceService.announceSignal(
                signal({ market: 'Jump 100 Index', signal: 'Trade under 4', strong: undefined, strength: 50 })
            )
        ).toBe(true);
        expect(spoken[1]).toMatch(/^Favourable signal detected/);
        expect(spoken[1]).toContain('50 percent strength');
    });

    it('lets executed trades through immediately after a detection line', () => {
        const { voiceService } = loadVoice();

        expect(voiceService.announceSignal(signal())).toBe(true);

        jest.setSystemTime(T0 + 1500);
        expect(voiceService.announceSignal(signal({ executed: true, strong: undefined, confidence: 0.88 }))).toBe(
            true
        );
        expect(spoken[1]).toContain('Trade placed on Volatility 75 Index');
    });

    it('does not consume the throttle when the line could not be spoken', () => {
        const { voiceService } = loadVoice();
        voiceService.applySettings(muted(voiceService.getSettings()));

        expect(voiceService.announceSignal(signal())).toBe(false);
        expect(spoken).toHaveLength(0);

        voiceService.applySettings(unmuted(voiceService.getSettings()));
        jest.setSystemTime(T0 + 1000);
        expect(voiceService.announceSignal(signal())).toBe(true);
        expect(spoken).toHaveLength(1);
    });

    it('never speaks when the browser has no speech synthesis', () => {
        jest.resetModules();
        installSpeech();
        Reflect.deleteProperty(window, 'speechSynthesis');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { voiceService } = require('@/services/voice-service') as VoiceModule;

        expect(voiceService.isSupported()).toBe(false);
        expect(voiceService.announceSignal(signal())).toBe(false);
        expect(voiceService.announceWelcome()).toBe(false);
        expect(spoken).toHaveLength(0);
    });
});

describe('voice selection', () => {
    it('prefers a sweet natural voice over plainer English ones', () => {
        const { voiceService } = loadVoice(false, [
            { name: 'Daniel', lang: 'en-US', localService: true, default: true, voiceURI: 'daniel' },
            { name: 'Google UK English Male', lang: 'en-GB', localService: false, default: false, voiceURI: 'guk' },
            { name: 'Samantha', lang: 'en-US', localService: true, default: false, voiceURI: 'sam' },
        ] as SpeechSynthesisVoice[]);

        expect(voiceService.announceStatus('Voice selection check.')).toBe(true);
        expect(lastSpokenVoice?.name).toBe('Samantha');
    });

    it('prefers a neural voice when one is available', () => {
        const { voiceService } = loadVoice(false, [
            { name: 'Samantha', lang: 'en-US', localService: true, default: false, voiceURI: 'sam' },
            { name: 'Microsoft Jenny Neural', lang: 'en-US', localService: false, default: false, voiceURI: 'jenny' },
        ] as SpeechSynthesisVoice[]);

        expect(voiceService.announceStatus('Voice selection check.')).toBe(true);
        expect(lastSpokenVoice?.name).toBe('Microsoft Jenny Neural');
    });

    it('speaks with the warmer default pitch and rate', () => {
        const { voiceService } = loadVoice();
        expect(voiceService.getSettings().pitch).toBeCloseTo(1.1, 5);
        expect(voiceService.getSettings().rate).toBeCloseTo(1.04, 5);
    });
});

describe('announceSettlement', () => {
    it('speaks win and loss lines', () => {
        const { voiceService } = loadVoice();

        expect(
            voiceService.announceSettlement({ bot: 'AI Bot', won: true, profit: 1.45, market: 'Boom 1000 Index' })
        ).toBe(true);
        expect(spoken[0]).toBe('Win on Boom 1000 Index. Profit 1.45 dollars. AI Bot.');

        jest.setSystemTime(T0 + 1500);
        expect(voiceService.announceSettlement({ bot: 'AI Bot', won: false, profit: -0.5 })).toBe(true);
        expect(spoken[1]).toBe('Loss. Down 0.50 dollars. AI Bot.');
    });
});

describe('contractSpokenLabel', () => {
    it('maps contract types to spoken phrases', () => {
        const { contractSpokenLabel } = loadVoice();
        expect(contractSpokenLabel('DIGITOVER', 3)).toBe('Trade over 3');
        expect(contractSpokenLabel('DIGITUNDER', 4)).toBe('Trade under 4');
        expect(contractSpokenLabel('DIGITEVEN')).toBe('Trade even');
        expect(contractSpokenLabel('DIGITODD')).toBe('Trade odd');
        expect(contractSpokenLabel('CALL')).toBe('Trade rise');
        expect(contractSpokenLabel('PUT')).toBe('Trade fall');
        expect(contractSpokenLabel('ASIAN')).toBe('Trade');
        expect(contractSpokenLabel()).toBe('Trade');
    });
});
