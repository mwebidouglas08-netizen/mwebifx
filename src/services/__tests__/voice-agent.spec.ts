/**
 * Voice agent singleton — Web Speech recognition lifecycle and the shared
 * parse → execute → speak pipeline.
 *
 * A fake SpeechRecognition is installed on window (jsdom has none), the voice
 * service is mocked so replies can be asserted and so the TTS-echo window is
 * controllable (speak returning false skips the window entirely).
 */

type VoiceAgentModule = typeof import('@/services/voice-agent');
type VoiceServiceModule = typeof import('@/services/voice-service');
type HubNavModule = typeof import('@/services/hub-navigation');

jest.mock('@/services/voice-service', () => ({
    voiceService: {
        speak: jest.fn(() => false),
        setEnabled: jest.fn(),
        isEnabled: jest.fn(() => true),
        cancel: jest.fn(),
        announceStatus: jest.fn(() => true),
        announceSignal: jest.fn(() => false),
        announceSettlement: jest.fn(() => false),
        announceGuard: jest.fn(() => false),
        prime: jest.fn(),
        announceWelcome: jest.fn(() => false),
        isSupported: jest.fn(() => true),
        getSettings: jest.fn(() => ({ enabled: true, rate: 1, pitch: 1, volume: 1, minIntervalMs: 900 })),
        applySettings: jest.fn(),
    },
}));

class FakeRecognition {
    static last: FakeRecognition | null = null;
    continuous = false;
    interimResults = false;
    lang = '';
    onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
    onerror: ((event: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    started = false;
    abortCalled = false;

    constructor() {
        FakeRecognition.last = this;
    }

    start() {
        this.started = true;
    }

    stop() {
        this.started = false;
    }

    abort() {
        this.abortCalled = true;
        this.started = false;
    }

    emitFinal(text: string) {
        this.started = false;
        this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
    }

    emitInterim(text: string) {
        this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: text } }] });
    }

    emitEnd() {
        this.started = false;
        this.onend?.();
    }

    emitError(error: string) {
        this.onerror?.({ error });
    }
}

const installRecognition = (): void => {
    Object.defineProperty(window, 'webkitSpeechRecognition', {
        value: FakeRecognition,
        configurable: true,
        writable: true,
    });
};

const removeRecognition = (): void => {
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
};

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

let agent: VoiceAgentModule['voiceAgent'];
let voice: VoiceServiceModule['voiceService'];
let hub: HubNavModule;

beforeEach(() => {
    installRecognition();
    // A rejected (falsy) speak never opens the echo window, so every test
    // except the dedicated echo one starts and stays outside any guard.
    jest.mocked(voice.speak).mockReturnValue(false);
    agent.stopListening();
});

afterEach(() => {
    agent.stopListening();
    removeRecognition();
});

beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    agent = require('@/services/voice-agent').voiceAgent;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    voice = require('@/services/voice-service').voiceService;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hub = require('@/services/hub-navigation');
});

describe('support detection', () => {
    it('reports unsupported and refuses to listen without the API', () => {
        removeRecognition();
        expect(agent.isSupported()).toBe(false);
        expect(agent.getState().supported).toBe(false);
        expect(agent.startListening()).toBe(false);
        expect(agent.getState().error).toContain('type commands');
    });

    it('arms continuous English recognition when supported', () => {
        expect(agent.startListening()).toBe(true);
        const rec = FakeRecognition.last!;
        expect(rec.started).toBe(true);
        expect(rec.continuous).toBe(true);
        expect(rec.interimResults).toBe(true);
        expect(rec.lang).toBe('en-US');
        expect(agent.getState().listening).toBe(true);
        expect(agent.getState().error).toBeNull();
    });

    it('toggles back off', () => {
        agent.startListening();
        expect(agent.toggleListening()).toBe(false);
        expect(agent.getState().listening).toBe(false);
        expect(FakeRecognition.last!.abortCalled).toBe(true);
    });
});

describe('hearing transcripts', () => {
    it('streams interim results to the UI without parsing them', async () => {
        agent.startListening();
        FakeRecognition.last!.emitInterim('open the dash');
        expect(agent.getState().interim).toBe('open the dash');
        expect(voice.speak).not.toHaveBeenCalled();
        await flush();
    });

    it('runs a final result through parse, execute and speak', async () => {
        const seen: string[] = [];
        const off = hub.subscribeHubNavigation(view => seen.push(view));
        agent.startListening();
        FakeRecognition.last!.emitFinal('open the dashboard');
        await flush();
        off();
        expect(seen).toEqual(['dashboard']);
        expect(agent.getState().lastHeard).toBe('open the dashboard');
        expect(agent.getState().history[0]).toMatchObject({
            heard: 'open the dashboard',
            reply: 'Opening Dashboard.',
            ok: true,
        });
        expect(voice.speak).toHaveBeenCalledWith('Opening Dashboard.', { force: true });
    });

    it('asks a text submission and hears its reply', async () => {
        await agent.submitText('what is my balance');
        expect(agent.getState().history[0]).toMatchObject({ heard: 'what is my balance', ok: false });
        expect(voice.speak).toHaveBeenCalledWith(expect.stringContaining('not logged in'), { force: true });
    });
});

describe('feedback and silence rules', () => {
    it('nudges on command-shaped speech it could not parse', async () => {
        await agent.submitText('start the thingy');
        expect(agent.getState().history[0].reply).toContain("didn't catch that");
        expect(voice.speak).toHaveBeenCalledWith(expect.stringContaining("didn't catch that"), { force: true });
    });

    it('stays silent on ambient conversation but still logs it', async () => {
        await agent.submitText('the weather is lovely today');
        expect(voice.speak).not.toHaveBeenCalled();
        expect(agent.getState().history[0]).toMatchObject({ heard: 'the weather is lovely today', reply: '' });
        expect(agent.getState().lastReply).toBeNull();
    });

    it('never parses its own spoken reply back (echo guard)', async () => {
        jest.mocked(voice.speak).mockReturnValue(true);
        const base = agent.getState().history.length;
        await agent.submitText('help');
        const reply = jest.mocked(voice.speak).mock.calls[0][0] as string;
        expect(reply).toContain('You can say things like');
        expect(agent.getState().history).toHaveLength(base + 1);

        // The very same words coming back through the mic during the TTS
        // window are treated as echo, not as a new command.
        await agent.submitText(reply);
        // A different command inside the window is held back too.
        await agent.submitText('stop everything');
        expect(agent.getState().history).toHaveLength(base + 1);
        expect(agent.getState().lastHeard).toBe('help');
    });

    it('speaks through the voice service with force and records history', async () => {
        jest.mocked(voice.speak).mockReturnValue(true);
        await agent.submitText('help');
        expect(voice.speak).toHaveBeenCalledWith(expect.stringContaining('stop all bots'), { force: true });
        expect(agent.getState().history[0]).toMatchObject({ heard: 'help', ok: true });
        expect(agent.getState().lastReply).toContain('stop all bots');
    });
});

describe('session control', () => {
    it('stops listening when told to', async () => {
        agent.startListening();
        await agent.submitText('stop listening');
        expect(agent.getState().listening).toBe(false);
        expect(FakeRecognition.last!.abortCalled).toBe(true);
        expect(voice.speak).toHaveBeenCalledWith('Voice agent off.', { force: true });
    });

    it('restarts when the browser ends the session on its own', async () => {
        agent.startListening();
        const first = FakeRecognition.last!;
        first.emitEnd();
        expect(agent.getState().listening).toBe(true);
        await sleep(300);
        expect(FakeRecognition.last).not.toBe(first);
        expect(FakeRecognition.last!.started).toBe(true);
    });

    it('does not restart after a deliberate stop', async () => {
        agent.startListening();
        const first = FakeRecognition.last!;
        agent.stopListening();
        first.emitEnd();
        await sleep(300);
        expect(FakeRecognition.last).toBe(first);
        expect(FakeRecognition.last!.started).toBe(false);
    });

    it('keeps listening through a no-speech hiccup', async () => {
        agent.startListening();
        const first = FakeRecognition.last!;
        first.emitError('no-speech');
        expect(agent.getState().listening).toBe(true);
        expect(agent.getState().error).toBeNull();
        first.emitEnd();
        await sleep(300);
        expect(FakeRecognition.last).not.toBe(first);
    });

    it('ends the session with a clear message when the mic is blocked', async () => {
        agent.startListening();
        FakeRecognition.last!.emitError('not-allowed');
        expect(agent.getState().listening).toBe(false);
        expect(agent.getState().error).toContain('Microphone access blocked');
        const blocked = FakeRecognition.last!;
        blocked.emitEnd();
        await sleep(300);
        expect(FakeRecognition.last).toBe(blocked);
    });
});

describe('subscriptions', () => {
    it('notifies listeners of state changes and stops after unsubscribe', async () => {
        const snapshots: boolean[] = [];
        const off = agent.subscribe(s => snapshots.push(s.listening));
        agent.startListening();
        expect(snapshots[snapshots.length - 1]).toBe(true);
        off();
        const count = snapshots.length;
        agent.stopListening();
        expect(snapshots).toHaveLength(count);
    });
});

