// Vercel serverless function: generates a short trading-signal rationale with
// Gemini (free tier). The API key is read from the environment and never sent
// to the browser. Falls back to an honest "reasoning unavailable" response if
// the key is missing or every upstream call fails, so the UI never fabricates an
// LLM explanation that did not happen.
//
// Set GEMINI_API_KEY in your Vercel project (Settings → Environment Variables).
// Free tier needs no credit card: https://aistudio.google.com/app/apikey
//
// Reliability notes (verified against the live API):
//  - gemini-2.5-* models are retired for new keys; the current flash models are
//    gemini-3.5-flash / gemini-flash-latest (gemini-3.8-flash is intermittently
//    503 under load). We try them in order and fall through on failure.
//  - Newer flash models spend output tokens on internal "thinking", which was
//    truncating answers to ~30 chars. thinkingConfig.thinkingBudget = 0 disables
//    that so maxOutputTokens is spent on the visible answer.
//  - Free-tier 503 "high demand" spikes are transient, so we retry with backoff.

const MODELS = (process.env.GEMINI_MODELS || 'gemini-3.5-flash,gemini-flash-latest,gemini-3.8-flash')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);

const GEMINI_URL = model => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const SYSTEM_PROMPT = [
    'You are a concise trading-signal explainer for binary-options (Over/Under digit) contracts.',
    'Given the numeric signal inputs, write 2-3 sentences of plain-language rationale for why the',
    'signal fired, and one sentence on the main risk. Do not invent numbers. Do not promise outcomes.',
    'Never give financial advice or guarantees. Keep it factual and short.',
].join(' ');

const buildUserPrompt = p => {
    const parts = [
        `Symbol: ${p.symbol ?? 'unknown'}`,
        `Direction: ${p.direction ?? 'n/a'}`,
        `Barrier: ${p.barrier ?? 'n/a'}`,
        `Signal strength (heuristic, 0-100): ${p.strength ?? 'n/a'}`,
    ];
    if (typeof p.rsi === 'number') parts.push(`RSI: ${p.rsi.toFixed(1)}`);
    if (typeof p.changePercent === 'number') parts.push(`Change: ${p.changePercent.toFixed(2)}%`);
    if (typeof p.empiricalProb === 'number') parts.push(`Empirical digit probability: ${(p.empiricalProb * 100).toFixed(1)}%`);
    if (typeof p.theoreticalProb === 'number') parts.push(`Theoretical probability: ${(p.theoreticalProb * 100).toFixed(1)}%`);
    if (typeof p.payoutRatio === 'number') parts.push(`Payout ratio: ${p.payoutRatio}`);
    return parts.join('\n');
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Try one model, retrying transient 429/503 a couple of times.
const callModel = async (apiKey, model, payload, attempts = 3) => {
    let lastErr = 'unknown';
    for (let i = 0; i < attempts; i += 1) {
        try {
            const upstream = await fetch(`${GEMINI_URL(model)}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (upstream.ok) {
                const data = await upstream.json();
                const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
                return { text: text.trim() };
            }
            lastErr = `HTTP ${upstream.status}`;
            // Retry only on transient errors; stop on permanent ones (404, 400…).
            if (upstream.status !== 429 && upstream.status !== 503) {
                return { error: `${model}: ${lastErr}` };
            }
        } catch (e) {
            lastErr = e?.message || 'network error';
        }
        if (i < attempts - 1) await sleep(400 * (i + 1));
    }
    return { error: `${model}: ${lastErr}` };
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const input = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};

    if (!apiKey) {
        return res.status(200).json({
            rationale: null,
            source: 'unavailable',
            note: 'AI rationale is not configured on this deployment (GEMINI_API_KEY is not set).',
        });
    }

    const payload = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input) }] }],
        generationConfig: {
            maxOutputTokens: 400,
            temperature: 0.3,
            thinkingConfig: { thinkingBudget: 0 },
        },
    };

    const failures = [];
    for (const model of MODELS) {
        const result = await callModel(apiKey, model, payload);
        if (result.text) {
            return res.status(200).json({ rationale: result.text, source: 'gemini', model });
        }
        failures.push(result.error || `${model}: empty`);
    }

    return res.status(200).json({
        rationale: null,
        source: 'unavailable',
        note: `AI rationale unavailable after trying ${MODELS.length} model(s): ${failures.join('; ')}`,
    });
}

function safeParse(s) {
    try { return JSON.parse(s); } catch { return {}; }
}
