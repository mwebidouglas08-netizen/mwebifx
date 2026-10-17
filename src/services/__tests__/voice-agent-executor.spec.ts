/**
 * Voice agent executor — intent → engine calls + spoken reply.
 *
 * Every engine singleton, the Deriv API facade and both preference services
 * are mocked so each case pins exactly which method must run and what the
 * agent says back. Navigation is observed through the real emitter.
 */

import { ouBotEngine } from '@/bot/engine/engine';
import { signalScanner } from '@/bot/engine/signal-scanner';
import { aiBot } from '@/bot/engine/ai-bot';
import { algoProEngine } from '@/bot/engine/algo-pro-ai';
import { bulkTrader } from '@/bot/engine/bulk-trader';
import { copyTrading } from '@/bot/engine/copy-trading';
import { accountBalance, currentLoginId, isAuthorized } from '@/bot/deriv/api';
import { voiceService } from '@/services/voice-service';
import { soundService } from '@/services/sound-service';
import { subscribeHubNavigation } from '@/services/hub-navigation';
import { executeVoiceIntent } from '@/services/voice-agent/executor';
import type { HubViewId } from '@/components/hub-sidebar';

jest.mock('@/bot/engine/engine', () => ({
    ouBotEngine: {
        getState: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        emergencyStop: jest.fn(),
        configure: jest.fn(),
        setLiveTrading: jest.fn(),
    },
}));
jest.mock('@/bot/engine/signal-scanner', () => ({
    signalScanner: {
        getState: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        emergencyStop: jest.fn(),
        configure: jest.fn(),
        setLiveTrading: jest.fn(),
    },
}));
jest.mock('@/bot/engine/ai-bot', () => ({
    aiBot: {
        getState: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        emergencyStop: jest.fn(),
        configure: jest.fn(),
        setLiveTrading: jest.fn(),
    },
}));
jest.mock('@/bot/engine/algo-pro-ai', () => ({
    algoProEngine: { getState: jest.fn(), start: jest.fn(), stop: jest.fn(), configure: jest.fn() },
}));
jest.mock('@/bot/engine/bulk-trader', () => ({
    bulkTrader: {
        getState: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        emergencyStop: jest.fn(),
        configure: jest.fn(),
    },
}));
jest.mock('@/bot/engine/copy-trading', () => ({
    copyTrading: { getState: jest.fn(), start: jest.fn(), stop: jest.fn() },
}));
jest.mock('@/bot/deriv/api', () => ({
    accountBalance: jest.fn(),
    isAuthorized: jest.fn(),
    currentLoginId: jest.fn(),
}));
jest.mock('@/services/voice-service', () => ({ voiceService: { setEnabled: jest.fn() } }));
jest.mock('@/services/sound-service', () => ({ soundService: { setEnabled: jest.fn() } }));

const ou = jest.mocked(ouBotEngine);
const scanner = jest.mocked(signalScanner);
const ai = jest.mocked(aiBot);
const algo = jest.mocked(algoProEngine);
const bulk = jest.mocked(bulkTrader);
const copy = jest.mocked(copyTrading);

/** Idle engines, ready to be overridden per test. */
const idle = () => {
    ou.getState.mockReturnValue({ status: 'idle', message: 'Idle' } as never);
    scanner.getState.mockReturnValue({ status: 'idle', message: 'Idle', config: { maxStake: 5 } } as never);
    ai.getState.mockReturnValue({ status: 'idle', message: 'Idle', config: { maxStake: 50 } } as never);
    algo.getState.mockReturnValue({ running: false, error: '', status: 'Idle', accountIsDemo: true } as never);
    bulk.getState.mockReturnValue({ status: 'idle', config: {} } as never);
    copy.getState.mockReturnValue({ status: 'idle' } as never);
};

beforeEach(() => {
    idle();
    jest.mocked(accountBalance).mockReturnValue(0);
    jest.mocked(isAuthorized).mockReturnValue(false);
    jest.mocked(currentLoginId).mockReturnValue('CR123');
});

describe('navigation', () => {
    it('emits the requested view and confirms with its label', async () => {
        const seen: HubViewId[] = [];
        const off = subscribeHubNavigation(view => seen.push(view));
        const result = await executeVoiceIntent({ kind: 'navigate', view: 'dashboard' });
        off();
        expect(seen).toEqual(['dashboard']);
        expect(result).toEqual({ ok: true, reply: 'Opening Bot Dashboard.' });
    });

    it('tells the user where start/stop lives for page-local views', async () => {
        const start = await executeVoiceIntent({ kind: 'navigate', view: 'dual-edge', requested: 'start' });
        expect(start.ok).toBe(true);
        expect(start.reply).toBe('Opening Dual Edge. Start it from its page.');
        const stop = await executeVoiceIntent({ kind: 'navigate', view: 'pro-ai', requested: 'stop' });
        expect(stop.reply).toBe('Opening Pro AI. Stop it from its page.');
    });
});

describe('bot start / stop', () => {
    it('starts a bot and confirms from post-start state', async () => {
        scanner.getState
            .mockReturnValueOnce({ status: 'idle' } as never)
            .mockReturnValue({ status: 'scanning' } as never);
        const result = await executeVoiceIntent({ kind: 'bot', action: 'start', bot: 'scanner' });
        expect(scanner.start).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ ok: true, reply: 'AI Signal Scanner started.' });
    });

    it('does not restart a bot that is already running', async () => {
        scanner.getState.mockReturnValue({ status: 'scanning' } as never);
        const result = await executeVoiceIntent({ kind: 'bot', action: 'start', bot: 'scanner' });
        expect(scanner.start).not.toHaveBeenCalled();
        expect(result).toEqual({ ok: true, reply: 'AI Signal Scanner is already running.' });
    });

    it('surfaces the engine error when start fails', async () => {
        ou.getState
            .mockReturnValueOnce({ status: 'idle' } as never)
            .mockReturnValue({ status: 'error', message: 'Not connected to Deriv yet.' } as never);
        const result = await executeVoiceIntent({ kind: 'bot', action: 'start', bot: 'ou-bot' });
        expect(result.ok).toBe(false);
        expect(result.reply).toContain('Not connected to Deriv yet.');
    });

    it('turns a rejected start into a spoken failure', async () => {
        algo.getState.mockReturnValue({ running: false, error: '' } as never);
        algo.start.mockRejectedValueOnce(new Error('gateway down') as never);
        const result = await executeVoiceIntent({ kind: 'bot', action: 'start', bot: 'algo-pro' });
        expect(result.ok).toBe(false);
        expect(result.reply).toContain('gateway down');
    });

    it('reports copy trading honestly instead of guessing a token', async () => {
        const result = await executeVoiceIntent({ kind: 'bot', action: 'start', bot: 'copy-trading' });
        expect(copy.start).not.toHaveBeenCalled();
        expect(result.ok).toBe(false);
        expect(result.reply).toContain('master account token');
    });

    it('stops a running bot and confirms', async () => {
        ou.getState.mockReturnValue({ status: 'scanning' } as never);
        const result = await executeVoiceIntent({ kind: 'bot', action: 'stop', bot: 'ou-bot' });
        expect(ou.stop).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ ok: true, reply: 'Over Under Bot stopped.' });
    });

    it('reports a bot that was not running without stopping anything', async () => {
        bulk.getState.mockReturnValue({ status: 'idle' } as never);
        const result = await executeVoiceIntent({ kind: 'bot', action: 'stop', bot: 'bulk-trader' });
        expect(bulk.stop).not.toHaveBeenCalled();
        expect(result).toEqual({ ok: true, reply: 'Bulk Trader is not running.' });
    });
});

describe('fleet commands', () => {
    it('stops every running bot, using emergencyStop when asked', async () => {
        ou.getState.mockReturnValue({ status: 'scanning' } as never);
        scanner.getState.mockReturnValue({ status: 'monitoring' } as never);
        ai.getState.mockReturnValue({ status: 'scanning' } as never);
        algo.getState.mockReturnValue({ running: true } as never);
        bulk.getState.mockReturnValue({ status: 'running' } as never);
        copy.getState.mockReturnValue({ status: 'running' } as never);

        const result = await executeVoiceIntent({ kind: 'stop-all', emergency: true });
        expect(ou.emergencyStop).toHaveBeenCalled();
        expect(scanner.emergencyStop).toHaveBeenCalled();
        expect(ai.emergencyStop).toHaveBeenCalled();
        expect(algo.stop).toHaveBeenCalledWith('Voice emergency stop');
        expect(bulk.emergencyStop).toHaveBeenCalled();
        expect(copy.stop).toHaveBeenCalled();
        expect(result).toEqual({ ok: true, reply: 'Emergency stop engaged. All bots halted.' });
    });

    it('uses a plain stop for a normal stop-all', async () => {
        scanner.getState.mockReturnValue({ status: 'scanning' } as never);
        const result = await executeVoiceIntent({ kind: 'stop-all', emergency: false });
        expect(scanner.stop).toHaveBeenCalledTimes(1);
        expect(scanner.emergencyStop).not.toHaveBeenCalled();
        expect(result).toEqual({ ok: true, reply: 'All bots stopped.' });
    });

    it('says so when nothing was running', async () => {
        const result = await executeVoiceIntent({ kind: 'stop-all', emergency: false });
        expect(result).toEqual({ ok: true, reply: 'No bots are running.' });
    });

    it('starts every startable bot but never copy trading', async () => {
        ou.start.mockResolvedValue(undefined);
        scanner.start.mockResolvedValue(undefined);
        ai.start.mockResolvedValue(undefined);
        bulk.start.mockResolvedValue(undefined);
        // Algo Pro confirms success by flipping its running flag itself.
        algo.start.mockImplementation(async () => {
            algo.getState.mockReturnValue({ running: true, error: '' } as never);
        });
        const result = await executeVoiceIntent({ kind: 'start-all' });
        expect(ou.start).toHaveBeenCalled();
        expect(scanner.start).toHaveBeenCalled();
        expect(ai.start).toHaveBeenCalled();
        expect(algo.start).toHaveBeenCalled();
        expect(bulk.start).toHaveBeenCalled();
        expect(copy.start).not.toHaveBeenCalled();
        expect(result.ok).toBe(true);
        expect(result.reply).toContain('Over Under Bot');
        expect(result.reply).toContain('Bulk Trader');
    });
});

describe('set value', () => {
    it('sets stake across every stake-aware bot', async () => {
        const result = await executeVoiceIntent({ kind: 'set', key: 'stake', value: 2, unit: 't' });
        expect(ou.configure).toHaveBeenCalledWith({ stake: 2 });
        expect(scanner.configure).toHaveBeenCalledWith({ stake: 2 });
        expect(ai.configure).toHaveBeenCalledWith({ stake: 2 });
        expect(algo.configure).toHaveBeenCalledWith({ stake: 2 });
        expect(bulk.configure).toHaveBeenCalledWith({ stake: 2 });
        expect(result.reply).toBe('Stake set to 2 on Over Under Bot, AI Signal Scanner, AI Bot, Algo Pro AI, Bulk Trader.');
    });

    it('raises maxStake when the new stake exceeds it', async () => {
        await executeVoiceIntent({ kind: 'set', key: 'stake', value: 8, unit: 't', bot: 'scanner' });
        expect(scanner.configure).toHaveBeenCalledWith({ stake: 8, maxStake: 8 });
        // 8 is under AI Bot's default cap of 50 — no cap rewrite there.
        await executeVoiceIntent({ kind: 'set', key: 'stake', value: 8, unit: 't', bot: 'ai-bot' });
        expect(ai.configure).toHaveBeenCalledWith({ stake: 8 });
    });

    it('scopes the change to the named bot', async () => {
        const result = await executeVoiceIntent({ kind: 'set', key: 'stake', value: 5, unit: 't', bot: 'algo-pro' });
        expect(algo.configure).toHaveBeenCalledWith({ stake: 5 });
        expect(ou.configure).not.toHaveBeenCalled();
        expect(scanner.configure).not.toHaveBeenCalled();
        expect(result.reply).toBe('Stake set to 5 on Algo Pro AI.');
    });

    it('keeps copy trading stake on its own page', async () => {
        const result = await executeVoiceIntent({ kind: 'set', key: 'stake', value: 2, unit: 't', bot: 'copy-trading' });
        expect(result.ok).toBe(false);
        expect(result.reply).toContain('its own page');
    });

    it('applies tick durations everywhere including Algo Pro', async () => {
        const result = await executeVoiceIntent({ kind: 'set', key: 'duration', value: 5, unit: 't' });
        expect(ou.configure).toHaveBeenCalledWith({ duration: 5, durationUnit: 't' });
        expect(scanner.configure).toHaveBeenCalledWith({ duration: 5, durationUnit: 't' });
        expect(ai.configure).toHaveBeenCalledWith({ duration: 5, durationUnit: 't' });
        expect(algo.configure).toHaveBeenCalledWith({ ticks: 5 });
        expect(bulk.configure).toHaveBeenCalledWith({ duration: 5, durationUnit: 't' });
        expect(result.ok).toBe(true);
    });

    it('keeps Algo Pro out of second durations and says why', async () => {
        const result = await executeVoiceIntent({ kind: 'set', key: 'duration', value: 30, unit: 's' });
        expect(ou.configure).toHaveBeenCalledWith({ duration: 30, durationUnit: 's' });
        expect(algo.configure).not.toHaveBeenCalled();
        expect(result.reply).toContain('Algo Pro AI takes tick durations only');
    });
});

describe('toggles', () => {
    it('arms auto trade only on the bots that have the switch', async () => {
        const on = await executeVoiceIntent({ kind: 'toggle', key: 'auto-trade', value: true });
        expect(scanner.configure).toHaveBeenCalledWith({ autoTrade: true });
        expect(ai.configure).toHaveBeenCalledWith({ autoTrade: true });
        expect(ou.configure).not.toHaveBeenCalled();
        expect(on.reply).toBe('Auto trade enabled on AI Signal Scanner and AI Bot.');

        scanner.configure.mockClear();
        ai.configure.mockClear();
        const off = await executeVoiceIntent({ kind: 'toggle', key: 'auto-trade', value: false, bot: 'scanner' });
        expect(scanner.configure).toHaveBeenCalledWith({ autoTrade: false });
        expect(ai.configure).not.toHaveBeenCalled();
        expect(off.reply).toBe('Auto trade disabled on AI Signal Scanner.');
    });

    it('explains when a bot has no auto-trade switch', async () => {
        const result = await executeVoiceIntent({ kind: 'toggle', key: 'auto-trade', value: true, bot: 'ou-bot' });
        expect(ou.configure).not.toHaveBeenCalled();
        expect(result.ok).toBe(false);
        expect(result.reply).toContain('no auto-trade switch');
    });

    it('flips live trading on every engine and warns about the account', async () => {
        jest.mocked(isAuthorized).mockReturnValue(true);
        jest.mocked(currentLoginId).mockReturnValue('CR123');
        const real = await executeVoiceIntent({ kind: 'toggle', key: 'live-trading', value: true });
        expect(ou.setLiveTrading).toHaveBeenCalledWith(true);
        expect(scanner.setLiveTrading).toHaveBeenCalledWith(true);
        expect(ai.setLiveTrading).toHaveBeenCalledWith(true);
        expect(algo.configure).toHaveBeenCalledWith({ allowLiveTrading: true });
        expect(bulk.configure).toHaveBeenCalledWith({ allowLiveTrading: true });
        expect(real.reply).toContain('Real money orders can now be placed');

        jest.mocked(currentLoginId).mockReturnValue('VRTC123');
        const demo = await executeVoiceIntent({ kind: 'toggle', key: 'live-trading', value: true, bot: 'ou-bot' });
        expect(demo.reply).toContain('Demo account');
        expect(ou.setLiveTrading).toHaveBeenCalledTimes(2);
        expect(scanner.setLiveTrading).toHaveBeenCalledTimes(1);
    });

    it('tells a logged-out user to log in before going live', async () => {
        const result = await executeVoiceIntent({ kind: 'toggle', key: 'live-trading', value: true });
        expect(result.reply).toContain('Log in first');
    });

    it('turns live trading off without account warnings', async () => {
        const result = await executeVoiceIntent({ kind: 'toggle', key: 'live-trading', value: false });
        expect(result).toEqual({ ok: true, reply: 'Live trading disabled on all bots.' });
        expect(ou.setLiveTrading).toHaveBeenCalledWith(false);
    });

    it('switches paper mode on the three bots that support it', async () => {
        const result = await executeVoiceIntent({ kind: 'toggle', key: 'paper-mode', value: true });
        expect(scanner.configure).toHaveBeenCalledWith({ paperTrading: true });
        expect(algo.configure).toHaveBeenCalledWith({ paperTrading: true });
        expect(bulk.configure).toHaveBeenCalledWith({ paperTrading: true });
        expect(ou.configure).not.toHaveBeenCalled();
        expect(result.reply).toContain('AI Signal Scanner, Algo Pro AI, Bulk Trader');
    });

    it('declines paper mode for bots without the switch', async () => {
        const result = await executeVoiceIntent({ kind: 'toggle', key: 'paper-mode', value: true, bot: 'ou-bot' });
        expect(result.ok).toBe(false);
        expect(result.reply).toContain('no paper mode switch');
    });

    it('drives the voice and sound preferences', async () => {
        const voice = await executeVoiceIntent({ kind: 'toggle', key: 'voice', value: false });
        expect(voiceService.setEnabled).toHaveBeenCalledWith(false);
        expect(voice).toEqual({ ok: true, reply: 'Voice announcements off.' });

        const sound = await executeVoiceIntent({ kind: 'toggle', key: 'sound', value: true });
        expect(soundService.setEnabled).toHaveBeenCalledWith(true);
        expect(sound).toEqual({ ok: true, reply: 'Sound effects on.' });
    });
});

describe('status queries', () => {
    it('explains what it can do', async () => {
        const result = await executeVoiceIntent({ kind: 'status', what: 'help' });
        expect(result.ok).toBe(true);
        expect(result.reply).toContain('stop all bots');
        expect(result.reply).toContain('stop listening');
    });

    it('refuses to guess a balance when logged out', async () => {
        const result = await executeVoiceIntent({ kind: 'status', what: 'balance' });
        expect(result.ok).toBe(false);
        expect(result.reply).toContain('not logged in');
    });

    it('reads the live balance for a logged-in account', async () => {
        jest.mocked(isAuthorized).mockReturnValue(true);
        jest.mocked(accountBalance).mockReturnValue(1234.5);
        const result = await executeVoiceIntent({ kind: 'status', what: 'balance' });
        expect(result).toEqual({ ok: true, reply: 'Your balance is 1234.5.' });
    });

    it('flags a balance that has not loaded yet', async () => {
        jest.mocked(isAuthorized).mockReturnValue(true);
        jest.mocked(accountBalance).mockReturnValue(0);
        const result = await executeVoiceIntent({ kind: 'status', what: 'balance' });
        expect(result.ok).toBe(false);
    });

    it('lists the running bots', async () => {
        ou.getState.mockReturnValue({ status: 'scanning' } as never);
        algo.getState.mockReturnValue({ running: true } as never);
        const result = await executeVoiceIntent({ kind: 'status', what: 'bots' });
        expect(result).toEqual({ ok: true, reply: 'Running: Over Under Bot and Algo Pro AI.' });
    });

    it('reports an idle fleet', async () => {
        const result = await executeVoiceIntent({ kind: 'status', what: 'bots' });
        expect(result).toEqual({ ok: true, reply: 'No bots are running.' });
    });
});

describe('resilience', () => {
    it('never throws — engine explosions become spoken apologies', async () => {
        ou.getState.mockImplementation(() => {
            throw new Error('engine on fire');
        });
        const result = await executeVoiceIntent({ kind: 'status', what: 'bots' });
        expect(result.ok).toBe(false);
        expect(result.reply).toContain('Something went wrong');
    });

    it('confirms stop-listening with a farewell line', async () => {
        const result = await executeVoiceIntent({ kind: 'stop-listening' });
        expect(result).toEqual({ ok: true, reply: 'Voice agent off.' });
    });
});
