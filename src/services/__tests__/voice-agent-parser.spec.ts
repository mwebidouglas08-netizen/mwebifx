/**
 * Voice agent parser — speech → intent. Pure function tests: every phrase a
 * user might say is pinned here so accuracy regressions fail loudly.
 */

import { looksLikeCommand, normalizeTranscript, parseVoiceCommand } from '@/services/voice-agent/parser';

describe('normalizeTranscript', () => {
    it('lowercases, drops punctuation and collapses whitespace', () => {
        expect(normalizeTranscript('  Set   the STAKE, to 2.5!! ')).toBe('set the stake to 2.5');
    });

    it('keeps slashes, dashes and dots that phrasings rely on', () => {
        expect(normalizeTranscript('Over/Under + Pro-AI v2.5')).toBe('over/under pro-ai v2.5');
    });
});

describe('parseVoiceCommand — navigation', () => {
    it.each([
        ['Open the dashboard', 'dashboard'],
        ['take me to the signal scanner', 'ai-scanner'],
        ['show me algo pro ai', 'algo-pro-ai'],
        ['go to dual edge', 'dual-edge'],
        ['switch to tradingview', 'tradingview'],
        ['navigate to the bulk trader', 'bulk-trader'],
        ['load copy trading', 'copy-trading'],
        ['head to backtest', 'backtest'],
        ['jump to the analysis tool', 'analysis-tool'],
        ['view the trading bots', 'trading-bots'],
        ['open pro ai', 'pro-ai'],
        ['show me algo pro', 'algo-pro-ai'],
        ['hey please open the ai hub', 'ai-hub'],
        ['show me the over under bot', 'ou-bot'],
    ])('maps %j to the %s view', (phrase, view) => {
        expect(parseVoiceCommand(phrase)).toEqual({ kind: 'navigate', view });
    });

    it.each(['dashboard', 'backtest page', 'the dual edge', 'tradingview', 'AI Hub'])(
        'accepts bare view name %j',
        phrase => {
            expect(parseVoiceCommand(phrase)).toEqual({ kind: 'navigate', view: expect.any(String) });
        },
    );

    it('routes status queries before navigation verbs', () => {
        expect(parseVoiceCommand('show me my balance')).toEqual({ kind: 'status', what: 'balance' });
    });
});

describe('parseVoiceCommand — fleet commands', () => {
    it('stops everything', () => {
        expect(parseVoiceCommand('stop everything')).toEqual({ kind: 'stop-all', emergency: false });
        expect(parseVoiceCommand('stop all bots')).toEqual({ kind: 'stop-all', emergency: false });
        expect(parseVoiceCommand('stop all')).toEqual({ kind: 'stop-all', emergency: false });
        expect(parseVoiceCommand('halt all bots')).toEqual({ kind: 'stop-all', emergency: false });
        expect(parseVoiceCommand('stop trading')).toEqual({ kind: 'stop-all', emergency: false });
    });

    it('marks emergency phrasing as an emergency stop', () => {
        expect(parseVoiceCommand('emergency stop')).toEqual({ kind: 'stop-all', emergency: true });
        expect(parseVoiceCommand('kill switch')).toEqual({ kind: 'stop-all', emergency: true });
    });

    it('accepts a bare halt but only when it really is one', () => {
        expect(parseVoiceCommand('stop')).toEqual({ kind: 'stop-all', emergency: false });
        expect(parseVoiceCommand('please stop now')).toEqual({ kind: 'stop-all', emergency: false });
        expect(parseVoiceCommand('pause')).toEqual({ kind: 'stop-all', emergency: false });
        expect(parseVoiceCommand('stop the bots')).toEqual({ kind: 'stop-all', emergency: false });
        expect(parseVoiceCommand('stop talking to me')).toBeNull();
        expect(parseVoiceCommand('I need to stop the car')).toBeNull();
    });

    it('starts every startable bot when asked', () => {
        expect(parseVoiceCommand('start everything')).toEqual({ kind: 'start-all' });
        expect(parseVoiceCommand('start all bots')).toEqual({ kind: 'start-all' });
        expect(parseVoiceCommand('start the bots')).toEqual({ kind: 'start-all' });
        expect(parseVoiceCommand('run everything')).toEqual({ kind: 'start-all' });
    });
});

describe('parseVoiceCommand — bot control', () => {
    it.each([
        ['start the signal scanner', 'start', 'scanner'],
        ['stop the over under bot', 'stop', 'ou-bot'],
        ['start the over/under bot', 'start', 'ou-bot'],
        ['pause algo pro ai', 'stop', 'algo-pro'],
        ['launch bulk trader', 'start', 'bulk-trader'],
        ['start copy trading', 'start', 'copy-trading'],
        ['stop the ai bot', 'stop', 'ai-bot'],
        ['resume the scanner', 'start', 'scanner'],
        ['turn on the over under bot', 'start', 'ou-bot'],
        ['turn off bulk trading', 'stop', 'bulk-trader'],
        ['kill the algo pro', 'stop', 'algo-pro'],
        ['okay can you start the scanner', 'start', 'scanner'],
    ])('maps %j to %s %s', (phrase, action, bot) => {
        expect(parseVoiceCommand(phrase)).toEqual({ kind: 'bot', action, bot });
    });

    it('sends page-local bots to their page instead of an engine', () => {
        expect(parseVoiceCommand('start dual edge')).toEqual({
            kind: 'navigate',
            view: 'dual-edge',
            requested: 'start',
        });
        expect(parseVoiceCommand('stop pro ai')).toEqual({ kind: 'navigate', view: 'pro-ai', requested: 'stop' });
    });

    it('does not guess what to start when the target is unknown', () => {
        expect(parseVoiceCommand('start the thingy')).toBeNull();
    });
});

describe('parseVoiceCommand — set values', () => {
    it('parses stakes from digits, words and decimals', () => {
        expect(parseVoiceCommand('set stake to 2')).toEqual({ kind: 'set', key: 'stake', value: 2, unit: 't', bot: undefined });
        expect(parseVoiceCommand('set the stake to two')).toEqual({ kind: 'set', key: 'stake', value: 2, unit: 't', bot: undefined });
        expect(parseVoiceCommand('change stake to 2.5')).toEqual({ kind: 'set', key: 'stake', value: 2.5, unit: 't', bot: undefined });
        expect(parseVoiceCommand('set stake to two point five')).toEqual({ kind: 'set', key: 'stake', value: 2.5, unit: 't', bot: undefined });
        expect(parseVoiceCommand('stake to 3')).toEqual({ kind: 'set', key: 'stake', value: 3, unit: 't', bot: undefined });
    });

    it('clamps the stake to Deriv’s 0.35 minimum', () => {
        expect(parseVoiceCommand('set stake to 0.1')).toEqual({ kind: 'set', key: 'stake', value: 0.35, unit: 't', bot: undefined });
    });

    it('scopes a stake change to the named bot', () => {
        expect(parseVoiceCommand('set the scanner stake to 5')).toEqual({ kind: 'set', key: 'stake', value: 5, unit: 't', bot: 'scanner' });
        expect(parseVoiceCommand('change over under stake to five')).toEqual({ kind: 'set', key: 'stake', value: 5, unit: 't', bot: 'ou-bot' });
    });

    it('parses durations with their unit', () => {
        expect(parseVoiceCommand('set duration to 5 ticks')).toEqual({ kind: 'set', key: 'duration', value: 5, unit: 't', bot: undefined });
        expect(parseVoiceCommand('set duration to 30 seconds')).toEqual({ kind: 'set', key: 'duration', value: 30, unit: 's', bot: undefined });
        expect(parseVoiceCommand('change ticks to 7')).toEqual({ kind: 'set', key: 'duration', value: 7, unit: 't', bot: undefined });
        expect(parseVoiceCommand('set duration to 2 minutes')).toEqual({ kind: 'set', key: 'duration', value: 2, unit: 'm', bot: undefined });
    });

    it('clamps nonsense durations into range', () => {
        expect(parseVoiceCommand('set duration to 4000 seconds')).toEqual({ kind: 'set', key: 'duration', value: 3600, unit: 's', bot: undefined });
        expect(parseVoiceCommand('set ticks to 0')).toEqual({ kind: 'set', key: 'duration', value: 1, unit: 't', bot: undefined });
    });
});

describe('parseVoiceCommand — toggles', () => {
    it('parses auto trade on and off', () => {
        expect(parseVoiceCommand('enable auto trade')).toEqual({ kind: 'toggle', key: 'auto-trade', value: true, bot: undefined });
        expect(parseVoiceCommand('turn off auto trading')).toEqual({ kind: 'toggle', key: 'auto-trade', value: false, bot: undefined });
        expect(parseVoiceCommand('disable auto trade on the scanner')).toEqual({ kind: 'toggle', key: 'auto-trade', value: false, bot: 'scanner' });
        expect(parseVoiceCommand('arm auto trade')).toEqual({ kind: 'toggle', key: 'auto-trade', value: true, bot: undefined });
    });

    it('parses live trading', () => {
        expect(parseVoiceCommand('enable live trading')).toEqual({ kind: 'toggle', key: 'live-trading', value: true, bot: undefined });
        expect(parseVoiceCommand('turn off live trading')).toEqual({ kind: 'toggle', key: 'live-trading', value: false, bot: undefined });
        expect(parseVoiceCommand('disable live trading on algo pro')).toEqual({ kind: 'toggle', key: 'live-trading', value: false, bot: 'algo-pro' });
    });

    it('parses paper mode', () => {
        expect(parseVoiceCommand('enable paper mode')).toEqual({ kind: 'toggle', key: 'paper-mode', value: true, bot: undefined });
        expect(parseVoiceCommand('turn off paper')).toEqual({ kind: 'toggle', key: 'paper-mode', value: false, bot: undefined });
    });

    it('parses voice and sound preferences', () => {
        expect(parseVoiceCommand('enable voice')).toEqual({ kind: 'toggle', key: 'voice', value: true, bot: undefined });
        expect(parseVoiceCommand('mute voice')).toEqual({ kind: 'toggle', key: 'voice', value: false, bot: undefined });
        expect(parseVoiceCommand('stop the voice announcements')).toEqual({ kind: 'toggle', key: 'voice', value: false, bot: undefined });
        expect(parseVoiceCommand('turn on sound effects')).toEqual({ kind: 'toggle', key: 'sound', value: true, bot: undefined });
        expect(parseVoiceCommand('disable sounds')).toEqual({ kind: 'toggle', key: 'sound', value: false, bot: undefined });
    });

    it('never lets a stop-shaped toggle fall through to a fleet stop', () => {
        const intent = parseVoiceCommand('stop auto trade');
        expect(intent).toEqual({ kind: 'toggle', key: 'auto-trade', value: false, bot: undefined });
        expect(intent).not.toEqual({ kind: 'stop-all', emergency: false });
    });
});

describe('parseVoiceCommand — status and session', () => {
    it('answers help and balance queries', () => {
        expect(parseVoiceCommand('help')).toEqual({ kind: 'status', what: 'help' });
        expect(parseVoiceCommand('what can you do')).toEqual({ kind: 'status', what: 'help' });
        expect(parseVoiceCommand('what is my balance')).toEqual({ kind: 'status', what: 'balance' });
        expect(parseVoiceCommand('check my balance')).toEqual({ kind: 'status', what: 'balance' });
        expect(parseVoiceCommand('how much do i have')).toEqual({ kind: 'status', what: 'balance' });
    });

    it('answers running-bot queries', () => {
        expect(parseVoiceCommand('status')).toEqual({ kind: 'status', what: 'bots' });
        expect(parseVoiceCommand("what's running")).toEqual({ kind: 'status', what: 'bots' });
        expect(parseVoiceCommand('which bots are running')).toEqual({ kind: 'status', what: 'bots' });
        expect(parseVoiceCommand('any bots running')).toEqual({ kind: 'status', what: 'bots' });
    });

    it('ends the session on goodbye phrases', () => {
        expect(parseVoiceCommand('stop listening')).toEqual({ kind: 'stop-listening' });
        expect(parseVoiceCommand("that's all")).toEqual({ kind: 'stop-listening' });
        expect(parseVoiceCommand('go to sleep')).toEqual({ kind: 'stop-listening' });
        expect(parseVoiceCommand('end session')).toEqual({ kind: 'stop-listening' });
    });
});

describe('parseVoiceCommand — noise resilience', () => {
    it.each([
        'the weather is lovely today',
        'tell me a joke',
        'I think the market might go up soon',
        '',
        '   ',
        'twenty one',
    ])('returns null for ambient speech %j', phrase => {
        expect(parseVoiceCommand(phrase)).toBeNull();
    });

    it('ignores leading fillers and trailing politeness', () => {
        expect(parseVoiceCommand('hey please open the dashboard')).toEqual({ kind: 'navigate', view: 'dashboard' });
        expect(parseVoiceCommand('okay can you start the scanner')).toEqual({ kind: 'bot', action: 'start', bot: 'scanner' });
        expect(parseVoiceCommand('dashboard please')).toEqual({ kind: 'navigate', view: 'dashboard' });
        expect(parseVoiceCommand('stop everything thanks')).toEqual({ kind: 'stop-all', emergency: false });
    });
});

describe('looksLikeCommand', () => {
    it('flags command-shaped speech and leaves conversation alone', () => {
        expect(looksLikeCommand('please frobnicate the scanner')).toBe(false);
        expect(looksLikeCommand('start the thingy')).toBe(true);
        expect(looksLikeCommand('the weather is nice')).toBe(false);
        expect(looksLikeCommand('open the dashboard')).toBe(true);
    });
});
