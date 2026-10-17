import { useEffect, useState, type FormEvent } from 'react';
import { voiceAgent, type VoiceAgentState } from '@/services/voice-agent';
import './voice-agent.scss';

const useVoiceAgentState = (): VoiceAgentState => {
    const [snapshot, setSnapshot] = useState<VoiceAgentState>(() => voiceAgent.getState());
    useEffect(() => voiceAgent.subscribe(setSnapshot), []);
    return snapshot;
};

const MicIcon = () => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
        <rect x='9' y='2.5' width='6' height='11' rx='3' />
        <path d='M5 11a7 7 0 0 0 14 0' />
        <path d='M12 18v3.5' />
        <path d='M8.5 21.5h7' />
    </svg>
);

/**
 * Header mic for the voice agent. The button arms/disarms listening; the panel
 * shows what was heard, what the agent did, and offers a typed-command field
 * for browsers without speech recognition (or a quiet room).
 */
const VoiceAgentControl = () => {
    const snapshot = useVoiceAgentState();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');

    const onMicClick = () => {
        setOpen(true);
        if (snapshot.supported) voiceAgent.toggleListening();
    };

    const onSend = (event: FormEvent) => {
        event.preventDefault();
        const text = draft.trim();
        if (!text) return;
        voiceAgent.submitText(text);
        setDraft('');
    };

    const statusLine = snapshot.error
        ? snapshot.error
        : snapshot.listening
          ? 'Listening… say a command'
          : snapshot.supported
            ? 'Mic is off — click it to talk'
            : 'Voice input unavailable — type a command below';

    return (
        <div className='voice-agent'>
            <button
                type='button'
                data-testid='dt_voice_agent'
                className={`voice-agent__btn ${snapshot.listening ? 'is-listening' : ''}`}
                aria-pressed={snapshot.listening}
                aria-expanded={open}
                aria-label={snapshot.listening ? 'Stop listening' : 'Start the voice agent'}
                title={snapshot.listening ? 'Listening — click to stop' : 'Talk to the voice agent'}
                onClick={onMicClick}
            >
                <MicIcon />
                <span className='voice-agent__pulse' aria-hidden />
            </button>
            {open && (
                <div className='voice-agent__panel' role='dialog' aria-label='Voice agent'>
                    <div className='voice-agent__head'>
                        <span className={`voice-agent__status ${snapshot.error ? 'is-error' : ''}`}>{statusLine}</span>
                        <button
                            type='button'
                            className='voice-agent__close'
                            aria-label='Close voice agent'
                            onClick={() => setOpen(false)}
                        >
                            ✕
                        </button>
                    </div>
                    {snapshot.interim && <div className='voice-agent__interim'>“{snapshot.interim}”</div>}
                    {snapshot.history.length > 0 && (
                        <ul className='voice-agent__history'>
                            {snapshot.history.map(entry => (
                                <li key={entry.id} className='voice-agent__item'>
                                    <span className='voice-agent__heard'>{entry.heard}</span>
                                    <span className={`voice-agent__reply ${entry.reply ? (entry.ok ? 'is-ok' : 'is-fail') : 'is-silent'}`}>
                                        {entry.reply || (entry.ok ? 'Done' : 'Not understood')}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <form className='voice-agent__form' onSubmit={onSend}>
                        <input
                            type='text'
                            className='voice-agent__input'
                            value={draft}
                            placeholder='Type a command, e.g. start the scanner'
                            aria-label='Voice agent command'
                            onChange={e => setDraft(e.target.value)}
                        />
                        <button type='submit' className='voice-agent__send' aria-label='Run command'>
                            Send
                        </button>
                    </form>
                    <div className='voice-agent__hints' aria-hidden>
                        <span>open dashboard</span>
                        <span>stop all bots</span>
                        <span>set stake to 2</span>
                        <span>what is my balance</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VoiceAgentControl;
