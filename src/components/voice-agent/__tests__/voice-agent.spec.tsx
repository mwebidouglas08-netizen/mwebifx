/**
 * Voice agent header control — mic button, transcript panel and the typed
 * command fallback (jsdom ships no SpeechRecognition, which is exactly the
 * unsupported-browser path the panel must handle gracefully).
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceAgentControl from '@/components/voice-agent';
import { voiceAgent } from '@/services/voice-agent';
import { voiceService } from '@/services/voice-service';

jest.mock('@/services/voice-service', () => ({
    voiceService: {
        speak: jest.fn(() => false),
        setEnabled: jest.fn(),
        isEnabled: jest.fn(() => true),
        cancel: jest.fn(),
        announceStatus: jest.fn(() => true),
        prime: jest.fn(),
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
    onresult: unknown = null;
    onerror: unknown = null;
    onend: unknown = null;
    started = false;
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
        this.started = false;
    }
}

const installRecognition = () => {
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
};

const removeRecognition = () => {
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
};

afterEach(() => {
    voiceAgent.stopListening();
    removeRecognition();
});

describe('VoiceAgentControl', () => {
    it('shows the mic button and opens the panel', async () => {
        render(<VoiceAgentControl />);
        const mic = screen.getByTestId('dt_voice_agent');
        expect(mic).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        await userEvent.click(mic);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/voice input unavailable/i)).toBeInTheDocument();
    });

    it('runs a typed command and shows what was heard and said', async () => {
        render(<VoiceAgentControl />);
        await userEvent.click(screen.getByTestId('dt_voice_agent'));

        const input = screen.getByLabelText('Voice agent command');
        await userEvent.type(input, 'help{Enter}');

        await waitFor(() => expect(screen.getByText('help')).toBeInTheDocument());
        expect(voiceService.speak).toHaveBeenCalledWith(expect.stringContaining('You can say things like'), {
            force: true,
        });
        expect(screen.getByText(/You can say things like/i)).toBeInTheDocument();
    });

    it('leaves the input untouched for an empty submission', async () => {
        render(<VoiceAgentControl />);
        await userEvent.click(screen.getByTestId('dt_voice_agent'));
        await userEvent.click(screen.getByRole('button', { name: 'Run command' }));
        expect(screen.queryByText(/didn't catch that/i)).not.toBeInTheDocument();
        expect(voiceService.speak).not.toHaveBeenCalled();
    });

    it('arms listening from the mic button when recognition exists', async () => {
        installRecognition();
        render(<VoiceAgentControl />);
        const mic = screen.getByTestId('dt_voice_agent');

        await userEvent.click(mic);
        expect(voiceAgent.getState().listening).toBe(true);
        expect(mic.classList.contains('is-listening')).toBe(true);
        expect(screen.getByText(/Listening…/i)).toBeInTheDocument();

        await userEvent.click(mic);
        expect(voiceAgent.getState().listening).toBe(false);
        expect(mic.classList.contains('is-listening')).toBe(false);
    });
});
