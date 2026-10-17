import {
    DEFAULT_SOUND_SETTINGS,
    loadSoundSettings,
    saveSoundSettings,
    soundService,
    subscribeSoundSettings,
} from '@/services/sound-service';

beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
});

describe('sound-service settings', () => {
    it('defaults to enabled with master volume 0.7', () => {
        expect(loadSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
        expect(soundService.isEnabled()).toBe(true);
        expect(soundService.getSettings()).toEqual({ enabled: true, volume: 0.7 });
    });

    it('persists enable/disable and volume, and notifies subscribers', () => {
        const listener = jest.fn();
        const unsubscribe = subscribeSoundSettings(listener);

        soundService.setEnabled(false);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(loadSoundSettings().enabled).toBe(false);
        expect(localStorage.getItem('dbot_settings')).toContain('sound_settings');

        soundService.update({ volume: 0.35 });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(loadSoundSettings().volume).toBeCloseTo(0.35);

        soundService.setEnabled(true);
        expect(listener).toHaveBeenCalledTimes(3);
        expect(soundService.getSettings()).toEqual({ enabled: true, volume: 0.35 });

        unsubscribe();
        soundService.setEnabled(false);
        expect(listener).toHaveBeenCalledTimes(3);
    });

    it('clamps out-of-range volume and reads back cleanly', () => {
        soundService.update({ volume: 9 });
        expect(soundService.getSettings().volume).toBe(1);
        soundService.update({ volume: -3 });
        expect(soundService.getSettings().volume).toBe(0);
    });

    it('survives corrupt stored settings', () => {
        localStorage.setItem('dbot_settings', '{not json');
        expect(loadSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
        expect(() => saveSoundSettings({ volume: 0.2 })).not.toThrow();
    });
});

describe('sound-service playback', () => {
    it('is unsupported in jsdom and never throws while playing', () => {
        expect(soundService.isSupported()).toBe(false);
        expect(soundService.play('welcome')).toBe(false);
        expect(soundService.play('botStart')).toBe(false);
        expect(soundService.play('botStop')).toBe(false);
        expect(() => soundService.resume()).not.toThrow();
    });

    it('honours the disabled switch before anything else', () => {
        soundService.setEnabled(false);
        expect(soundService.play('click')).toBe(false);
    });

    it('synthesises a sound when an AudioContext is available', () => {
        const oscillator = {
            type: 'sine',
            frequency: { setValueAtTime: jest.fn() },
            connect: jest.fn(),
            start: jest.fn(),
            stop: jest.fn(),
            disconnect: jest.fn(),
            onended: null as (() => void) | null,
        };
        const gain = {
            gain: { value: 0, setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
            connect: jest.fn(),
            disconnect: jest.fn(),
        };
        const context = {
            state: 'running',
            currentTime: 0,
            destination: {},
            createGain: jest.fn(() => gain),
            createOscillator: jest.fn(() => oscillator),
            resume: jest.fn(() => Promise.resolve()),
        };

        Object.defineProperty(window, 'AudioContext', {
            value: jest.fn(() => context),
            configurable: true,
            writable: true,
        });

        try {
            expect(soundService.isSupported()).toBe(true);
            expect(soundService.play('botStart')).toBe(true);
            expect(context.createOscillator).toHaveBeenCalled();
            expect(oscillator.start).toHaveBeenCalled();
            expect(oscillator.stop).toHaveBeenCalled();
        } finally {
            Reflect.deleteProperty(window, 'AudioContext');
        }
    });
});
