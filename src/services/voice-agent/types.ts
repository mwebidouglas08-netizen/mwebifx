import type { HubViewId } from '@/components/hub-sidebar';

/** Bots the voice agent can drive directly through their engine singletons. */
export type VoiceBotId = 'ou-bot' | 'ai-bot' | 'scanner' | 'algo-pro' | 'bulk-trader' | 'copy-trading';

export type VoiceToggleKey = 'auto-trade' | 'live-trading' | 'paper-mode' | 'voice' | 'sound';

export type VoiceStatusQuery = 'balance' | 'bots' | 'help';

export type VoiceDurationUnit = 't' | 's' | 'm';

/**
 * A normalized instruction parsed from speech or typed text. The parser is a
 * pure function of the transcript, so every intent here is unit-testable
 * without touching an engine.
 */
export type VoiceIntent =
    | { kind: 'stop-listening' }
    | { kind: 'stop-all'; emergency: boolean }
    | { kind: 'start-all' }
    | { kind: 'navigate'; view: HubViewId; requested?: 'start' | 'stop' }
    | { kind: 'bot'; action: 'start' | 'stop'; bot: VoiceBotId }
    | { kind: 'set'; key: 'stake' | 'duration'; value: number; unit: VoiceDurationUnit; bot?: VoiceBotId }
    | { kind: 'toggle'; key: VoiceToggleKey; value: boolean; bot?: VoiceBotId }
    | { kind: 'status'; what: VoiceStatusQuery };

/** What an executed intent reports back — the reply is always safe to speak. */
export interface VoiceActionResult {
    ok: boolean;
    reply: string;
}
