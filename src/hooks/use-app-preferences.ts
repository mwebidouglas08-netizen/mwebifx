import { useCallback, useEffect, useState } from 'react';
import {
    DisplayCurrency,
    convertAmount,
    getConvertedBalance,
    getDisplayCurrency,
    getUsdToKesRate,
    setDisplayCurrency,
    setUsdToKesRate,
    subscribeCurrencyPreferences,
    toggleDisplayCurrency,
} from '@/utils/currency-conversion';
import {
    VoiceSettings,
    loadVoiceSettings,
    saveVoiceSettings,
    subscribeVoiceSettings,
    voiceService,
} from '@/services/voice-service';
import {
    SoundSettings,
    loadSoundSettings,
    saveSoundSettings,
    subscribeSoundSettings,
    soundService,
} from '@/services/sound-service';

/**
 * Subscribes to the KSH/USD display-currency preference and returns a stable
 * API for rendering and toggling converted balances.
 */
export interface CurrencyConversionApi {
    displayCurrency: DisplayCurrency;
    rate: number;
    toggle: () => DisplayCurrency;
    set: (c: DisplayCurrency) => void;
    setRate: (r: number) => void;
    convert: (amount: number, accountCurrency: string) => ReturnType<typeof getConvertedBalance>;
    /** Convenience: formatted string for the given amount/account currency. */
    format: (amount: number, accountCurrency: string) => string;
}

export const useCurrencyConversion = (): CurrencyConversionApi => {
    const [displayCurrency, setDisplay] = useState<DisplayCurrency>(() => getDisplayCurrency());
    const [rate, setRateState] = useState<number>(() => getUsdToKesRate());

    useEffect(() => subscribeCurrencyPreferences(() => {
        setDisplay(getDisplayCurrency());
        setRateState(getUsdToKesRate());
    }), []);

    const toggle = useCallback(() => toggleDisplayCurrency(), []);
    const set = useCallback((c: DisplayCurrency) => setDisplayCurrency(c), []);
    const setRate = useCallback((r: number) => setUsdToKesRate(r), []);
    const convert = useCallback(
        (amount: number, accountCurrency: string) => getConvertedBalance(amount, accountCurrency, displayCurrency),
        [displayCurrency]
    );
    const format = useCallback(
        (amount: number, accountCurrency: string) =>
            getConvertedBalance(amount, accountCurrency, displayCurrency).formatted,
        [displayCurrency]
    );

    return { displayCurrency, rate, toggle, set, setRate, convert, format };
};

/**
 * Subscribes to the AI voice module settings and exposes the enable/disable
 * toggle plus the service itself.
 */
export interface VoiceApi {
    settings: VoiceSettings;
    supported: boolean;
    enabled: boolean;
    setEnabled: (v: boolean) => void;
    update: (patch: Partial<VoiceSettings>) => void;
    prime: () => void;
    /** Announce a plain line (used by bots for status changes). */
    say: (text: string) => void;
}

export const useVoice = (): VoiceApi => {
    const [settings, setSettings] = useState<VoiceSettings>(() => loadVoiceSettings());

    useEffect(() => subscribeVoiceSettings(() => setSettings(loadVoiceSettings())), []);

    const setEnabled = useCallback((v: boolean) => saveVoiceSettings({ enabled: v }), []);
    const update = useCallback((patch: Partial<VoiceSettings>) => saveVoiceSettings(patch), []);
    const prime = useCallback(() => voiceService.prime(), []);
    const say = useCallback((text: string) => voiceService.announceStatus(text), []);

    return {
        settings,
        supported: voiceService.isSupported(),
        enabled: voiceService.isEnabled(),
        setEnabled,
        update,
        prime,
        say,
    };
};

/** Non-hook helper for one-off conversions inside render. */
export const convertOnce = convertAmount;

/**
 * Subscribes to the sound-effects settings (critical click sounds: bot
 * start/stop, welcome fanfare, signal blips).
 */
export interface SoundApi {
    settings: SoundSettings;
    supported: boolean;
    enabled: boolean;
    setEnabled: (v: boolean) => void;
    update: (patch: Partial<SoundSettings>) => void;
    play: (name: Parameters<typeof soundService.play>[0]) => void;
}

export const useSound = (): SoundApi => {
    const [settings, setSettings] = useState<SoundSettings>(() => loadSoundSettings());

    useEffect(() => subscribeSoundSettings(() => setSettings(loadSoundSettings())), []);

    const setEnabled = useCallback((v: boolean) => saveSoundSettings({ enabled: v }), []);
    const update = useCallback((patch: Partial<SoundSettings>) => saveSoundSettings(patch), []);
    const play = useCallback((name: Parameters<typeof soundService.play>[0]) => soundService.play(name), []);

    return {
        settings,
        supported: soundService.isSupported(),
        enabled: soundService.isEnabled(),
        setEnabled,
        update,
        play,
    };
};
