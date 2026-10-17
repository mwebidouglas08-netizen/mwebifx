import { useState } from 'react';
import { useSound, useVoice } from '@/hooks/use-app-preferences';
import { voiceService } from '@/services/voice-service';
import './voice-toggle.scss';

/**
 * Header control for the AI voice module: arms/disarms favourable-signal and
 * settlement announcements across every bot. Also usable inside bot panels.
 */
const VoiceToggle = ({ className = '' }: { className?: string }) => {
    const { supported, enabled, setEnabled, settings, update, prime } = useVoice();
    const { enabled: soundEnabled, setEnabled: setSoundEnabled } = useSound();
    const [showDetail, setShowDetail] = useState(false);

    if (!supported) {
        return (
            <span
                className={`voice-toggle voice-toggle--unsupported ${className}`}
                title='Speech is not supported in this browser'
            >
                <span aria-hidden='true'>🔇</span>
            </span>
        );
    }

    const onToggle = () => {
        if (!enabled) {
            // Browsers require a user gesture before the first utterance.
            prime();
            setEnabled(true);
        } else {
            setEnabled(false);
        }
    };

    return (
        <div className={`voice-toggle ${className}`}>
            <button
                type='button'
                data-testid='dt_voice_toggle'
                className={`voice-toggle__btn ${enabled ? 'is-on' : ''}`}
                aria-pressed={enabled}
                aria-label={enabled ? 'Disable voice announcements' : 'Enable voice announcements'}
                title={enabled ? 'Voice announcements on — click to mute' : 'Voice announcements off — click to unmute'}
                onClick={onToggle}
            >
                <span aria-hidden='true'>{enabled ? '🔊' : '🔇'}</span>
                <span className='voice-toggle__label'>{enabled ? 'Voice' : 'Muted'}</span>
            </button>
            <button
                type='button'
                className='voice-toggle__gear'
                aria-label='Voice settings'
                aria-expanded={showDetail}
                title='Voice settings'
                onClick={() => setShowDetail(v => !v)}
            >
                ⚙
            </button>
            {showDetail && (
                <div className='voice-toggle__panel' role='dialog' aria-label='Voice settings'>
                    <label className='voice-toggle__row voice-toggle__row--check'>
                        <span>Sound FX</span>
                        <input
                            type='checkbox'
                            checked={soundEnabled}
                            onChange={e => setSoundEnabled(e.target.checked)}
                        />
                        <output>{soundEnabled ? 'On' : 'Off'}</output>
                    </label>
                    <label className='voice-toggle__row'>
                        <span>Rate</span>
                        <input
                            type='range'
                            min={0.5}
                            max={2}
                            step={0.05}
                            value={settings.rate}
                            onChange={e => update({ rate: Number(e.target.value) })}
                        />
                        <output>{settings.rate.toFixed(2)}×</output>
                    </label>
                    <label className='voice-toggle__row'>
                        <span>Pitch</span>
                        <input
                            type='range'
                            min={0.5}
                            max={2}
                            step={0.05}
                            value={settings.pitch}
                            onChange={e => update({ pitch: Number(e.target.value) })}
                        />
                        <output>{settings.pitch.toFixed(2)}</output>
                    </label>
                    <label className='voice-toggle__row'>
                        <span>Volume</span>
                        <input
                            type='range'
                            min={0}
                            max={1}
                            step={0.05}
                            value={settings.volume}
                            onChange={e => update({ volume: Number(e.target.value) })}
                        />
                        <output>{Math.round(settings.volume * 100)}%</output>
                    </label>
                    <button
                        type='button'
                        className='voice-toggle__test'
                        onClick={() =>
                            voiceService.announceStatus('Voice assistant ready. Favourable signals will be announced.')
                        }
                    >
                        Test voice
                    </button>
                </div>
            )}
        </div>
    );
};

export default VoiceToggle;
