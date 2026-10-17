import type { HubViewId } from '@/components/hub-sidebar';
import type { VoiceBotId, VoiceDurationUnit, VoiceIntent } from './types';

/**
 * Pure speech → intent parser. No engine imports, no side effects: given the
 * same transcript it always yields the same intent, which is what makes voice
 * commands unit-testable and dependable.
 *
 * Rule order matters. Safety commands (stop everything), toggles and status
 * queries claim their phrases before generic bot control, so "stop auto trade"
 * can never fall through to "stop every bot".
 */

export const normalizeTranscript = (raw: string): string =>
    raw
        .toLowerCase()
        .replace(/'/g, '')
        .replace(/[^a-z0-9./\-\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

/** Leading chatter users naturally prefix commands with. */
const FILLER_PREFIX =
    /^(?:\b(?:hey|hi|ok|okay|please|pls|could you|can you|would you|i want to|id like to|i would like to|just|now)\b\s*)+/;
const FILLER_SUFFIX = /\b(?:please|thanks|thank you)\b\s*$/;

const BOT_PATTERNS: Array<[VoiceBotId, RegExp]> = [
    ['ou-bot', /\bover[\s/&-]*under(?:\s*bot)?\b|\bou bot\b/],
    ['algo-pro', /\balgo[\s-]*pro(?:\s*ai)?\b/],
    ['scanner', /\b(?:signal|ai)\s*scanner\b|\bscanner\b/],
    ['ai-bot', /\bai(?:\s*trading)?\s*bot\b/],
    ['bulk-trader', /\bbulk(?:\s*-?\s*trader|\s*trading)?\b/],
    ['copy-trading', /\bcopy\s*(?:trading|bot)\b/],
];

const VIEW_PATTERNS: Array<[HubViewId, RegExp]> = [
    ['dashboard', /\b(?:dashboard|home(?:\s*page)?)\b/],
    ['algo-pro-ai', /\balgo[\s-]*pro(?:\s*ai)?\b/],
    ['pro-ai', /\bpro[\s-]*ai\b/],
    ['ai-hub', /\b(?:ai\s*)?(?:trading\s*hub|hub)\b/],
    ['ou-bot', /\bover[\s/&-]*under(?:\s*bot)?\b|\bou bot\b/],
    ['bulk-trader', /\bbulk(?:\s*-?\s*trader|\s*trading)?\b/],
    ['copy-trading', /\bcopy\s*(?:trading|bot)\b/],
    ['trading-bots', /\btrading\s*bots\b|\bbots\s*page\b/],
    ['ai-scanner', /\b(?:signal|ai)\s*scanner\b|\bscanner\b/],
    ['dual-edge', /\bdual[\s-]*edge\b/],
    ['backtest', /\bback[\s-]*test(?:ing)?\b/],
    ['analysis-tool', /\banalysis(?:\s*tool)?\b|\banalyzer\b/],
    ['tradingview', /\btrading[\s-]*view\b/],
];

/** Whole-phrase matches for bare commands like "dashboard" or "backtest page". */
const BARE_VIEW_PATTERNS: Array<[HubViewId, RegExp]> = [
    ['dashboard', /^(?:the\s+)?(?:dashboard|home)(?:\s+page)?$/],
    ['algo-pro-ai', /^(?:the\s+)?algo[\s-]*pro(?:\s*ai)?(?:\s+page)?$/],
    ['pro-ai', /^(?:the\s+)?pro[\s-]*ai(?:\s+page)?$/],
    ['ai-hub', /^(?:the\s+)?(?:ai\s+)?(?:trading\s+hub|hub)(?:\s+page)?$/],
    ['ou-bot', /^(?:the\s+)?over[\s/&-]*under(?:\s+bot)?(?:\s+page)?$/],
    ['bulk-trader', /^(?:the\s+)?bulk(?:\s*-?\s*trader|\s+trading)?(?:\s+page)?$/],
    ['copy-trading', /^(?:the\s+)?copy\s+(?:trading|bot)(?:\s+page)?$/],
    ['trading-bots', /^(?:the\s+)?trading\s+bots(?:\s+page)?$/],
    ['ai-scanner', /^(?:the\s+)?(?:signal|ai)\s+scanner(?:\s+page)?$/],
    ['dual-edge', /^(?:the\s+)?dual[\s-]*edge(?:\s+page)?$/],
    ['backtest', /^(?:the\s+)?back[\s-]*test(?:ing)?(?:\s+page)?$/],
    ['analysis-tool', /^(?:the\s+)?analysis(?:\s+tool)?(?:\s+page)?$/],
    ['tradingview', /^(?:the\s+)?trading[\s-]*view(?:\s+page)?$/],
];

/** Views whose start/stop lives on their own page, not on an engine singleton. */
const PAGE_LOCAL_VIEWS: HubViewId[] = ['dual-edge', 'pro-ai'];

const START_VERBS = ['start', 'begin', 'launch', 'run', 'resume', 'activate', 'turn on', 'switch on'];
const STOP_VERBS = ['stop', 'halt', 'pause', 'turn off', 'switch off', 'shut down', 'deactivate', 'kill'];

const NAV_VERB =
    /\b(?:open|go to|goto|show(?:\s+me)?|take me to|switch to|navigate to|view|load|head to|jump to)\b/;

const ON_VERB = /\b(?:enable|enabling|turn on|switch on|arm|activate|start|allow|on)\b/;
const OFF_VERB = /\b(?:disable|disabling|turn off|switch off|disarm|deactivate|stop|off|mute|cancel)\b/;

const SET_VERB = /\b(?:set|change|adjust|make|put|bump|raise|lower|update)\b/;

const STAKE_TARGET = /\b(?:stake|bet amount|bet size|trade size|amount|size)\b/;
const DURATION_TARGET = /\b(?:duration|ticks?|period|seconds?|minutes?)\b/;

const WORD_NUMBERS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    hundred: 100,
};

const NUMBER_TOKEN =
    String.raw`(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred)`;

/** Digit-string form of a number token, whether written as digits or words. */
const digitsOf = (token: string): string => (/^\d+$/.test(token) ? token : String(WORD_NUMBERS[token] ?? 0));

const extractNumber = (t: string): number | null => {
    // "2.5", "2 point 5" and "two point five" all mean the same amount.
    const point = t.match(new RegExp(`\\b(${NUMBER_TOKEN})\\s+point\\s+(${NUMBER_TOKEN})\\b`));
    if (point) return Number(`${digitsOf(point[1])}.${digitsOf(point[2])}`);
    const digits = t.match(/\b\d+(?:\.\d+)?\b/);
    if (digits) return Number(digits[0]);
    const word = t.match(new RegExp(`\\b(${NUMBER_TOKEN})\\b`));
    if (word) return WORD_NUMBERS[word[1]] ?? null;
    return null;
};

const findBot = (t: string): VoiceBotId | undefined => {
    for (const [bot, re] of BOT_PATTERNS) if (re.test(t)) return bot;
    return undefined;
};

const findView = (t: string): HubViewId | undefined => {
    for (const [view, re] of VIEW_PATTERNS) if (re.test(t)) return view;
    return undefined;
};

const firstVerbIndex = (t: string, verbs: string[]): number => {
    let first = -1;
    for (const verb of verbs) {
        const idx = t.indexOf(verb);
        if (idx >= 0 && (first === -1 || idx < first)) first = idx;
    }
    return first;
};

const BOT_NOUN = /\b(?:bots?|trader|trading|scanner|engine|everything|all)\b/;

/** Anchored so only a bare halt command stops the fleet — never chit-chat. */
const SHORT_HALT = /^(?:please\s+)?(?:stop|halt|pause|kill|freeze|turn off|shut down)(?:\s+(?:it|now))?$/;

/**
 * True when the transcript contains a word a user would only say while trying
 * to drive the app — used to decide whether silence or a "didn't catch that"
 * nudge is the right response to speech we failed to parse.
 */
export const looksLikeCommand = (raw: string): boolean =>
    /\b(?:open|go to|show|start|stop|halt|pause|enable|disable|turn on|turn off|set|change|balance|status|help|navigate|launch|resume|mute|arm|run|switch)\b/.test(
        normalizeTranscript(raw),
    );

const durationUnitOf = (t: string): VoiceDurationUnit => {
    if (/\bseconds?\b/.test(t)) return 's';
    if (/\bminutes?\b/.test(t)) return 'm';
    return 't';
};

export const parseVoiceCommand = (raw: string): VoiceIntent | null => {
    const t = normalizeTranscript(raw).replace(FILLER_PREFIX, '').replace(FILLER_SUFFIX, '');
    if (!t) return null;

    // 1. Session control.
    if (/\b(?:stop listening|thats all|that will be all|end session|go to sleep|you can stop)\b/.test(t)) {
        return { kind: 'stop-listening' };
    }

    // 2. Whole-fleet commands — claimed before anything else can misread them.
    if (/\b(?:emergency stop|kill switch)\b/.test(t)) return { kind: 'stop-all', emergency: true };
    if (/\b(?:stop|halt|kill|freeze|pause)\s+(?:everything|all|every\s+bot|bots|trading|activity)\b/.test(t)) {
        return { kind: 'stop-all', emergency: false };
    }
    if (/\b(?:start|launch|run|begin)\s+(?:everything|all|every\s+bot|bots)\b/.test(t)) {
        return { kind: 'start-all' };
    }

    // 3. Toggles — checked before generic control so "stop auto trade" never
    //    becomes "stop every bot".
    const botScope = findBot(t);
    if (ON_VERB.test(t) || OFF_VERB.test(t)) {
        const value = OFF_VERB.test(t) ? false : true;
        if (/\b(?:auto[\s-]*trading|auto[\s-]*trade|autotrade)\b/.test(t)) {
            return { kind: 'toggle', key: 'auto-trade', value, bot: botScope };
        }
        if (/\b(?:live\s+trading|go\s+live)\b/.test(t)) {
            return { kind: 'toggle', key: 'live-trading', value, bot: botScope };
        }
        if (/\bpaper(?:\s*(?:mode|trading|trades?))?\b/.test(t)) {
            return { kind: 'toggle', key: 'paper-mode', value, bot: botScope };
        }
        if (/\b(?:voice(?:\s+announcements?)?|speech)\b/.test(t)) {
            return { kind: 'toggle', key: 'voice', value, bot: botScope };
        }
        if (/\bsounds?(?:\s*(?:effects?|fx))?\b/.test(t)) {
            return { kind: 'toggle', key: 'sound', value, bot: botScope };
        }
    }

    // 4. Status queries.
    if (/\b(?:what can you do|what do you do|help|commands?|list (?:the )?commands|instructions)\b/.test(t)) {
        return { kind: 'status', what: 'help' };
    }
    if (/\b(?:balance|equity|how much (?:money|do i have)|my money|account funds)\b/.test(t)) {
        return { kind: 'status', what: 'balance' };
    }
    if (/\b(?:status|whats running|what is running|running bots?|bot status|which bots? (?:are|is) running|any (?:bots? )?running)\b/.test(t)) {
        return { kind: 'status', what: 'bots' };
    }

    // 5. Value changes: "set stake to two point five", "change ticks to 5".
    const number = extractNumber(t);
    if (number !== null && (SET_VERB.test(t) || /\bto\b/.test(t))) {
        if (STAKE_TARGET.test(t)) {
            const value = Math.round(Math.max(0.35, number) * 100) / 100;
            return { kind: 'set', key: 'stake', value, unit: 't', bot: botScope };
        }
        if (DURATION_TARGET.test(t)) {
            const value = Math.min(3600, Math.max(1, Math.round(number)));
            return { kind: 'set', key: 'duration', value, unit: durationUnitOf(t), bot: botScope };
        }
    }

    // 6. Bot control — only real engine bots land here; page-local bots fall
    //    through to navigation so the user ends up where the button lives.
    const startIdx = firstVerbIndex(t, START_VERBS);
    const stopIdx = firstVerbIndex(t, STOP_VERBS);
    const hasStart = startIdx !== -1 && (stopIdx === -1 || startIdx <= stopIdx);
    const hasStop = stopIdx !== -1 && (startIdx === -1 || stopIdx < startIdx);
    if (hasStart || hasStop) {
        const action = hasStop ? 'stop' : 'start';
        if (botScope) return { kind: 'bot', action, bot: botScope };
        const view = findView(t);
        if (view) {
            if (PAGE_LOCAL_VIEWS.includes(view)) return { kind: 'navigate', view, requested: action };
            return { kind: 'navigate', view };
        }
        // Bare "stop the bots" / "start everything"-style fleet phrasing.
        if (BOT_NOUN.test(t)) {
            return action === 'stop' ? { kind: 'stop-all', emergency: false } : { kind: 'start-all' };
        }
        // A bare "stop" on its own is a halt; any other unscoped start is not
        // something we can guess at — report it as unparsed.
        if (action === 'stop' && SHORT_HALT.test(t)) return { kind: 'stop-all', emergency: false };
        return null;
    }

    // 7. Navigation with an explicit verb: "open the dashboard".
    if (NAV_VERB.test(t)) {
        const view = findView(t);
        if (view) return { kind: 'navigate', view };
    }

    // 8. Bare view name: "dashboard", "backtest page".
    const bare = t.replace(/\b(?:view)\b/g, '').trim();
    for (const [view, re] of BARE_VIEW_PATTERNS) if (re.test(bare)) return { kind: 'navigate', view };

    return null;
};
