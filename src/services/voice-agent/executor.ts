import { HUB_VIEW_LABELS, type HubViewId } from '@/components/hub-sidebar';
import { ouBotEngine } from '@/bot/engine/engine';
import { signalScanner } from '@/bot/engine/signal-scanner';
import { aiBot } from '@/bot/engine/ai-bot';
import { algoProEngine } from '@/bot/engine/algo-pro-ai';
import { bulkTrader } from '@/bot/engine/bulk-trader';
import { copyTrading } from '@/bot/engine/copy-trading';
import { accountBalance, currentLoginId, isAuthorized } from '@/bot/deriv/api';
import { isDemoAccount } from '@/utils/account-helpers';
import { voiceService } from '@/services/voice-service';
import { soundService } from '@/services/sound-service';
import { navigateToHubView } from '@/services/hub-navigation';
import type { VoiceActionResult, VoiceBotId, VoiceIntent } from './types';

/**
 * Executes a parsed voice intent against the app's engine singletons and
 * returns a human reply. The executor never throws (an engine failure becomes
 * a spoken apology) and never invents results — every confirmation is read back
 * from live engine state after the call.
 */

const BOT_LABELS: Record<VoiceBotId, string> = {
    'ou-bot': 'Over Under Bot',
    'ai-bot': 'AI Bot',
    scanner: 'AI Signal Scanner',
    'algo-pro': 'Algo Pro AI',
    'bulk-trader': 'Bulk Trader',
    'copy-trading': 'Copy Trading',
};

const formatNum = (n: number): string => String(Math.round(n * 100) / 100);

/** Statuses that mean the engine is alive (including a suspended session). */
const isActiveStatus = (status?: string): boolean =>
    !!status && status !== 'idle' && status !== 'stopped' && status !== 'error';

const runningBots = (): VoiceBotId[] => {
    const running: VoiceBotId[] = [];
    if (isActiveStatus(ouBotEngine.getState().status)) running.push('ou-bot');
    if (isActiveStatus(signalScanner.getState().status)) running.push('scanner');
    if (isActiveStatus(aiBot.getState().status)) running.push('ai-bot');
    if (algoProEngine.getState().running) running.push('algo-pro');
    const bulk = bulkTrader.getState().status;
    if (bulk === 'starting' || bulk === 'running') running.push('bulk-trader');
    const copy = copyTrading.getState().status;
    if (copy === 'connecting' || copy === 'running') running.push('copy-trading');
    return running;
};

const startBot = async (bot: VoiceBotId): Promise<VoiceActionResult> => {
    const label = BOT_LABELS[bot];
    try {
        switch (bot) {
            case 'ou-bot': {
                if (isActiveStatus(ouBotEngine.getState().status)) return { ok: true, reply: `${label} is already running.` };
                await ouBotEngine.start();
                const s = ouBotEngine.getState();
                if (s.status === 'error') return { ok: false, reply: `${label} could not start. ${s.message}` };
                return { ok: true, reply: `${label} started.` };
            }
            case 'scanner': {
                if (isActiveStatus(signalScanner.getState().status)) return { ok: true, reply: `${label} is already running.` };
                await signalScanner.start();
                const s = signalScanner.getState();
                if (s.status === 'error') return { ok: false, reply: `${label} could not start. ${s.message}` };
                return { ok: true, reply: `${label} started.` };
            }
            case 'ai-bot': {
                if (isActiveStatus(aiBot.getState().status)) return { ok: true, reply: `${label} is already running.` };
                await aiBot.start();
                const s = aiBot.getState();
                if (s.status === 'error') return { ok: false, reply: `${label} could not start. ${s.message}` };
                return { ok: true, reply: `${label} started.` };
            }
            case 'algo-pro': {
                if (algoProEngine.getState().running) return { ok: true, reply: `${label} is already running.` };
                await algoProEngine.start();
                const s = algoProEngine.getState();
                if (!s.running) return { ok: false, reply: `${label} could not start. ${s.error || s.status}` };
                return { ok: true, reply: `${label} started.` };
            }
            case 'bulk-trader': {
                const before = bulkTrader.getState().status;
                if (before === 'starting' || before === 'running') return { ok: true, reply: `${label} is already running.` };
                await bulkTrader.start();
                const s = bulkTrader.getState();
                if (s.status === 'error') return { ok: false, reply: `${label} could not start. ${s.message}` };
                return { ok: true, reply: `${label} started.` };
            }
            case 'copy-trading':
                return { ok: false, reply: 'Copy Trading needs your master account token — open Copy Trading to connect.' };
        }
    } catch (e) {
        return { ok: false, reply: `${label} could not start. ${(e as Error)?.message || 'Try again.'}` };
    }
};

const stopBot = (bot: VoiceBotId): VoiceActionResult => {
    const label = BOT_LABELS[bot];
    try {
        switch (bot) {
            case 'ou-bot':
                if (!isActiveStatus(ouBotEngine.getState().status)) return { ok: true, reply: `${label} is not running.` };
                ouBotEngine.stop();
                return { ok: true, reply: `${label} stopped.` };
            case 'scanner':
                if (!isActiveStatus(signalScanner.getState().status)) return { ok: true, reply: `${label} is not running.` };
                signalScanner.stop();
                return { ok: true, reply: `${label} stopped.` };
            case 'ai-bot':
                if (!isActiveStatus(aiBot.getState().status)) return { ok: true, reply: `${label} is not running.` };
                aiBot.stop();
                return { ok: true, reply: `${label} stopped.` };
            case 'algo-pro':
                if (!algoProEngine.getState().running) return { ok: true, reply: `${label} is not running.` };
                algoProEngine.stop();
                return { ok: true, reply: `${label} stopped.` };
            case 'bulk-trader': {
                const s = bulkTrader.getState().status;
                if (s !== 'starting' && s !== 'running') return { ok: true, reply: `${label} is not running.` };
                bulkTrader.stop();
                return { ok: true, reply: `${label} stopped.` };
            }
            case 'copy-trading': {
                const s = copyTrading.getState().status;
                if (s !== 'connecting' && s !== 'running') return { ok: true, reply: `${label} is not running.` };
                copyTrading.stop();
                return { ok: true, reply: `${label} stopped.` };
            }
        }
    } catch (e) {
        return { ok: false, reply: `${label} could not be stopped. ${(e as Error)?.message || 'Try again.'}` };
    }
};

const stopAll = (emergency: boolean): VoiceActionResult => {
    try {
        const running = runningBots();
        if (!running.length) return { ok: true, reply: 'No bots are running.' };
        for (const bot of running) {
            if (bot === 'ou-bot') {
                if (emergency) ouBotEngine.emergencyStop();
                else ouBotEngine.stop();
            } else if (bot === 'scanner') {
                if (emergency) signalScanner.emergencyStop();
                else signalScanner.stop();
            } else if (bot === 'ai-bot') {
                if (emergency) aiBot.emergencyStop();
                else aiBot.stop();
            } else if (bot === 'algo-pro') {
                algoProEngine.stop(emergency ? 'Voice emergency stop' : undefined);
            } else if (bot === 'bulk-trader') {
                if (emergency) bulkTrader.emergencyStop();
                else bulkTrader.stop();
            } else if (bot === 'copy-trading') {
                copyTrading.stop();
            }
        }
        return {
            ok: true,
            reply: emergency ? 'Emergency stop engaged. All bots halted.' : 'All bots stopped.',
        };
    } catch (e) {
        return { ok: false, reply: `Could not stop everything. ${(e as Error)?.message || 'Try again.'}` };
    }
};

const startAll = async (): Promise<VoiceActionResult> => {
    const candidates: VoiceBotId[] = ['ou-bot', 'scanner', 'ai-bot', 'algo-pro', 'bulk-trader'];
    const started: string[] = [];
    const failed: string[] = [];
    for (const bot of candidates) {
        const result = await startBot(bot);
        if (result.ok) started.push(BOT_LABELS[bot]);
        else failed.push(BOT_LABELS[bot]);
    }
    if (!started.length) return { ok: false, reply: `No bots could be started. ${failed.join(', ')} reported an error.` };
    const reply = failed.length
        ? `Started ${started.join(', ')}. Could not start ${failed.join(', ')}.`
        : `Started ${started.join(', ')}.`;
    return { ok: !failed.length, reply };
};

/** Stake targets: copy trading configures it on its own page. */
const STAKE_BOTS: VoiceBotId[] = ['ou-bot', 'scanner', 'ai-bot', 'algo-pro', 'bulk-trader'];

const setStake = (value: number, scope?: VoiceBotId): VoiceActionResult => {
    if (scope === 'copy-trading') {
        return { ok: false, reply: 'Copy Trading stake is configured on its own page.' };
    }
    const targets = scope ? [scope] : STAKE_BOTS;
    try {
        for (const bot of targets) {
            if (bot === 'ou-bot') ouBotEngine.configure({ stake: value });
            else if (bot === 'scanner') {
                const cfg = signalScanner.getState().config;
                signalScanner.configure({ stake: value, ...(value > cfg.maxStake ? { maxStake: value } : {}) });
            } else if (bot === 'ai-bot') {
                const cfg = aiBot.getState().config;
                aiBot.configure({ stake: value, ...(value > cfg.maxStake ? { maxStake: value } : {}) });
            } else if (bot === 'algo-pro') algoProEngine.configure({ stake: value });
            else if (bot === 'bulk-trader') bulkTrader.configure({ stake: value });
        }
        const labels = targets.map(b => BOT_LABELS[b]);
        return {
            ok: true,
            reply: `Stake set to ${formatNum(value)} on ${labels.join(', ')}.`,
        };
    } catch (e) {
        return { ok: false, reply: `Could not set the stake. ${(e as Error)?.message || 'Try again.'}` };
    }
};

const setDuration = (value: number, unit: 't' | 's' | 'm', scope?: VoiceBotId): VoiceActionResult => {
    if (scope === 'copy-trading') {
        return { ok: false, reply: 'Copy Trading duration follows the master account trades.' };
    }
    const all: VoiceBotId[] = ['ou-bot', 'scanner', 'ai-bot', 'algo-pro', 'bulk-trader'];
    const targets = scope ? [scope] : all;
    // Algo Pro trades in ticks only — seconds/minutes cannot be expressed there.
    const unsupportedAlgo = unit !== 't' && targets.includes('algo-pro');
    try {
        for (const bot of targets) {
            if (bot === 'algo-pro') {
                if (unit !== 't') continue;
                algoProEngine.configure({ ticks: value });
            } else if (bot === 'ou-bot') ouBotEngine.configure({ duration: value, durationUnit: unit });
            else if (bot === 'scanner') signalScanner.configure({ duration: value, durationUnit: unit });
            else if (bot === 'ai-bot') aiBot.configure({ duration: value, durationUnit: unit });
            else if (bot === 'bulk-trader') bulkTrader.configure({ duration: value, durationUnit: unit });
        }
        const labels = targets
            .filter(b => !(b === 'algo-pro' && unit !== 't'))
            .map(b => BOT_LABELS[b]);
        const unitWord = unit === 't' ? 'tick' : unit === 's' ? 'second' : 'minute';
        const plural = value === 1 ? unitWord : `${unitWord}s`;
        const suffix = unsupportedAlgo ? ' Algo Pro AI takes tick durations only.' : '';
        return { ok: true, reply: `Duration set to ${value} ${plural} on ${labels.join(', ')}.${suffix}` };
    } catch (e) {
        return { ok: false, reply: `Could not set the duration. ${(e as Error)?.message || 'Try again.'}` };
    }
};

const AUTO_TRADE_BOTS: VoiceBotId[] = ['scanner', 'ai-bot'];
const PAPER_BOTS: VoiceBotId[] = ['scanner', 'algo-pro', 'bulk-trader'];

const setAutoTrade = (value: boolean, scope?: VoiceBotId): VoiceActionResult => {
    if (scope && !AUTO_TRADE_BOTS.includes(scope)) {
        return {
            ok: false,
            reply: `${BOT_LABELS[scope]} has no auto-trade switch. Auto trade applies to the AI Signal Scanner and AI Bot.`,
        };
    }
    try {
        const targets = scope ? [scope] : AUTO_TRADE_BOTS;
        for (const bot of targets) {
            if (bot === 'scanner') signalScanner.configure({ autoTrade: value });
            else if (bot === 'ai-bot') aiBot.configure({ autoTrade: value });
        }
        const labels = targets.map(b => BOT_LABELS[b]);
        return { ok: true, reply: `Auto trade ${value ? 'enabled' : 'disabled'} on ${labels.join(' and ')}.` };
    } catch (e) {
        return { ok: false, reply: `Could not change auto trade. ${(e as Error)?.message || 'Try again.'}` };
    }
};

const setLiveTrading = (value: boolean, scope?: VoiceBotId): VoiceActionResult => {
    if (scope === 'copy-trading') {
        return { ok: false, reply: 'Copy Trading has its own live switch on its page.' };
    }
    try {
        const targets: VoiceBotId[] = scope ? [scope] : ['ou-bot', 'scanner', 'ai-bot', 'algo-pro', 'bulk-trader'];
        for (const bot of targets) {
            if (bot === 'ou-bot') ouBotEngine.setLiveTrading(value);
            else if (bot === 'scanner') signalScanner.setLiveTrading(value);
            else if (bot === 'ai-bot') aiBot.setLiveTrading(value);
            else if (bot === 'algo-pro') algoProEngine.configure({ allowLiveTrading: value });
            else if (bot === 'bulk-trader') bulkTrader.configure({ allowLiveTrading: value });
        }
        const labels = scope ? BOT_LABELS[scope] : 'all bots';
        let reply = `Live trading ${value ? 'enabled' : 'disabled'} on ${labels}.`;
        if (value) {
            if (!isAuthorized()) reply += ' Log in first to place orders.';
            else if (isDemoAccount(currentLoginId())) reply += ' Demo account — orders stay virtual.';
            else reply += ' Real money orders can now be placed.';
        }
        return { ok: true, reply };
    } catch (e) {
        return { ok: false, reply: `Could not change live trading. ${(e as Error)?.message || 'Try again.'}` };
    }
};

const setPaperMode = (value: boolean, scope?: VoiceBotId): VoiceActionResult => {
    if (scope && !PAPER_BOTS.includes(scope)) {
        return { ok: false, reply: `${BOT_LABELS[scope]} has no paper mode switch.` };
    }
    try {
        const targets = scope ? [scope] : PAPER_BOTS;
        for (const bot of targets) {
            if (bot === 'scanner') signalScanner.configure({ paperTrading: value });
            else if (bot === 'algo-pro') algoProEngine.configure({ paperTrading: value });
            else if (bot === 'bulk-trader') bulkTrader.configure({ paperTrading: value });
        }
        const labels = targets.map(b => BOT_LABELS[b]);
        return { ok: true, reply: `Paper mode ${value ? 'enabled' : 'disabled'} on ${labels.join(', ')}.` };
    } catch (e) {
        return { ok: false, reply: `Could not change paper mode. ${(e as Error)?.message || 'Try again.'}` };
    }
};

const statusReply = (what: 'balance' | 'bots' | 'help'): VoiceActionResult => {
    if (what === 'help') {
        return {
            ok: true,
            reply: 'You can say things like: open the dashboard, start the signal scanner, stop all bots, set stake to two, enable auto trade, what is my balance, or stop listening.',
        };
    }
    if (what === 'balance') {
        if (!isAuthorized()) return { ok: false, reply: 'You are not logged in — log in to see your balance.' };
        const balance = accountBalance();
        if (!(balance > 0)) return { ok: false, reply: 'Balance is not available yet — make sure you are logged in.' };
        return { ok: true, reply: `Your balance is ${formatNum(balance)}.` };
    }
    const running = runningBots();
    if (!running.length) return { ok: true, reply: 'No bots are running.' };
    const labels = running.map(b => BOT_LABELS[b]);
    const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
    return { ok: true, reply: `Running: ${list}.` };
};

const navigate = (view: HubViewId, requested?: 'start' | 'stop'): VoiceActionResult => {
    navigateToHubView(view);
    const label = HUB_VIEW_LABELS[view];
    if (requested === 'start') return { ok: true, reply: `Opening ${label}. Start it from its page.` };
    if (requested === 'stop') return { ok: true, reply: `Opening ${label}. Stop it from its page.` };
    return { ok: true, reply: `Opening ${label}.` };
};

export const executeVoiceIntent = async (intent: VoiceIntent): Promise<VoiceActionResult> => {
    try {
        switch (intent.kind) {
            case 'stop-listening':
                return { ok: true, reply: 'Voice agent off.' };
            case 'stop-all':
                return stopAll(intent.emergency);
            case 'start-all':
                return await startAll();
            case 'navigate':
                return navigate(intent.view, intent.requested);
            case 'bot':
                return intent.action === 'start' ? await startBot(intent.bot) : stopBot(intent.bot);
            case 'set':
                return intent.key === 'stake'
                    ? setStake(intent.value, intent.bot)
                    : setDuration(intent.value, intent.unit, intent.bot);
            case 'toggle':
                switch (intent.key) {
                    case 'auto-trade':
                        return setAutoTrade(intent.value, intent.bot);
                    case 'live-trading':
                        return setLiveTrading(intent.value, intent.bot);
                    case 'paper-mode':
                        return setPaperMode(intent.value, intent.bot);
                    case 'voice': {
                        voiceService.setEnabled(intent.value);
                        return { ok: true, reply: `Voice announcements ${intent.value ? 'on' : 'off'}.` };
                    }
                    case 'sound': {
                        soundService.setEnabled(intent.value);
                        return { ok: true, reply: `Sound effects ${intent.value ? 'on' : 'off'}.` };
                    }
                }
                break;
            case 'status':
                return statusReply(intent.what);
        }
        return { ok: false, reply: "Sorry, I couldn't run that." };
    } catch (e) {
        return { ok: false, reply: `Something went wrong running that command. ${(e as Error)?.message || ''}`.trim() };
    }
};
