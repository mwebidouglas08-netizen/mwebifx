// Vercel serverless function: generates a short trading-signal rationale with
// Gemini (free tier). The API key is read from the environment and never sent
// to the browser. Falls back to an honest "reasoning unavailable" response if
// the key is missing or the upstream call fails, so the UI never fabricates an
// LLM explanation that did not happen.
//
// Set GEMINI_API_KEY in your Vercel project (Settings → Environment Variables).
// Free tier needs no credit card: https://aistudio.google.com/app/apikey

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

    try {
        const upstream = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input) }] }],
                generationConfig: { maxOutputTokens: 200, temperature: 0.3 },
            }),
        });

        if (!upstream.ok) {
            const detail = await upstream.text().catch(() => '');
            return res.status(200).json({
                rationale: null,
                source: 'unavailable',
                note: `Gemini request failed (${upstream.status}). ${detail.slice(0, 200)}`,
            });
        }

        const data = await upstream.json();
        const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
        if (!text) {
            return res.status(200).json({
                rationale: null,
                source: 'unavailable',
                note: 'Gemini returned no text for this signal.',
            });
        }
        return res.status(200).json({ rationale: text.trim(), source: 'gemini' });
    } catch (e) {
        return res.status(200).json({
            rationale: null,
            source: 'unavailable',
            note: `AI rationale unavailable: ${e?.message || 'network error'}`,
        });
    }
}

function safeParse(s) {
    try { return JSON.parse(s); } catch { return {}; }
}
