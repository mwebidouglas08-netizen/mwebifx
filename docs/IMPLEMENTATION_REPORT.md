# Dollarvault — Production-Readiness Implementation Report

Date: 2026-10-13
Commits in this effort: `b819a90`, `6f3257e`, `14fd264` (on top of `36c50e0`)
Production: https://mwebifx-6upl-roan.vercel.app/ — live bundle `index.4eeef4e0.js`

## 1. What the audit found

A three-part audit (trading/broker, frontend/AI/config/security, free-AI research)
concluded that the platform is **already substantially real**:

- Order execution is genuine: `proposal → buy → proposal_open_contract` against the
  live Deriv WebSocket. There is **no paper engine masquerading as live** — the only
  simulated records are explicit `simulated=true` paper trades (new, see below).
- Authentication is real OAuth 2.0 + PKCE against Deriv.
- Market data, digit statistics, RSI, chi-square, Wilson intervals, Kelly-capped EV,
  mean-reversion signals and the risk engine all operate on real data. No `Math.random`
  market data, no fabricated win-rates (an earlier revision had them; they were removed
  before this effort).

The genuine defects this report addresses were a **specific, fixable set** — not a
wholesale fake. They are listed below with file references.

## 2. Correctness & safety fixes

| Defect | Fix | File |
|---|---|---|
| Settlement poll timeout recorded an **open** contract as a settled LOSS, feeding the risk engine a phantom loss | `monitorUntilSettled` now returns an explicit error unless the contract is actually sold/expired | `src/bot/deriv/execution.ts` |
| Signal Scanner `autoTrade` defaulted to **true** — a logged-in user pressing Start placed orders with no switch flipped | Default set to `false` | `src/bot/engine/signal-scanner.ts` |
| Reconnect give-up path cleared some storage keys but left `auth_info` (OAuth tokens) in localStorage | Path now clears `auth_info` + `deriv_accounts` | `src/external/bot-skeleton/services/api/api-base.ts` |
| Tick feed retried every fixed 2.5s forever (reconnect storm) | Exponential backoff capped at 30s | `src/bot/deriv/ticks.ts` |
| Hard-coded API token in a test util | Reads `DERIV_TEST_API_TOKEN` env var | `src/components/shared/test_utils/test_common.ts` |

Live-trading confirmation is enforced **in the engine**, not only the UI: the scanner
refuses to start real-account orders unless Live trading is enabled
(`signal-scanner.ts`), and all engines expose `emergencyStop()`.

## 3. Honesty / transparency fixes

- `index.html` meta description no longer claims "AI-powered autonomous trading"; it now
  describes signal analysis + optional automated trading with a risk-of-loss notice.
- AI-hub "confidence %" relabelled **"signal strength"** (a heuristic score, not a
  probability or win-rate), with a clarifying doc comment. Log lines and the auto-trade
  notice updated to match.
- The AI-hub "Run AI Analysis" log already documented that it performs real technical
  analysis with no predictive model; that honesty is preserved and now optionally
  supplemented by a genuine LLM rationale (below).

## 4. New features

### Backtester wired to the UI (real data)
New **Backtest** view replays **real Deriv tick history** (public `ticks_history`
WebSocket) through the Over/Under rules, with a chronological 70/30 train/test split
and an honest robustness verdict. Nothing is fabricated — it is a pure replay of
historical ticks.
- `src/bot/deriv/history.ts` (fetches real ticks)
- `src/bot/core/backtest.ts` (existing engine, now surfaced)
- `src/pages/backtest/` (UI), wired into `src/pages/main/index.tsx`

### Paper-trading mode (live prices, simulated fills)
The signal scanner can run in **Paper trading**: it requests a **real live quote**
(real payout from Deriv) and settles on the **next real tick**, but places **no real
order**. Records are flagged `simulated=true` and every log line says "PAPER (no real
order)". Works without a Deriv login. Toggle in the scanner UI.

### Genuine AI integration (Gemini free tier)
`api/ai-rationale.js` is a Vercel serverless function that asks Gemini (free tier — no
credit card) for a short, factual rationale of a signal. The API key stays server-side
(`GEMINI_API_KEY` env var; never sent to the browser). If the key is absent or the call
fails, it returns an honest `source: "unavailable"` note — it **never fabricates** an
explanation. The AI hub appends the rationale to the analysis log when available.

**Action required to activate:** set `GEMINI_API_KEY` in the Vercel project
(Settings → Environment Variables). Get a free key at https://aistudio.google.com/app/apikey.
Until then the endpoint honestly reports "not configured".

## 5. Security hardening

- `vercel.json`: added **HSTS** (`max-age=63072000; includeSubDomains; preload`) and a
  **Content-Security-Policy**. The CSP was tuned against the live app to allow the
  CDNs it actually uses (Google Fonts, jsdelivr, Deriv hosts) while enforcing
  `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` and https-only
  image/font/connect sources.
- SPA rewrites now exclude `/api` so the serverless function is reachable.
- Disabled the vendored DBot **third-party ad/analytics trackers** (GTM container →
  match2one/taboola/doubleclick) in `src/utils/gtm.ts`. They were unrelated to trading,
  blocked by CSP, and produced console noise. The dataLayer API remains a safe no-op.

**Known limitation:** the OAuth access token is still held in `localStorage` (an
inherent SPA constraint). The partial-logout leak that left tokens behind is fixed;
fully removing the token from `localStorage` would require a backend/BFF and is out of
scope here. Treat the app's own XSS surface as the boundary (mitigated by CSP).

## 6. Testing & verification (all executed)

| Suite | Result |
|---|---|
| `e2e/test-production-fixes.js` (new — defaults, settlement fix, paper rules, backtest) | **20/20** |
| `e2e/test-buy-flow.js` (mocked Deriv transport) | **31/31** |
| `e2e/test-mean-reversion.js` | **24/24** |
| `test-ai-rules.js` | **19/19** |
| Production probe `probe-bots-run-prod.js` (AI Bot, O/U Bot, Scanner) | **16/16** |
| Production `errors-prod.js` | **0 JS errors, 0 console errors** |
| Typecheck of changed files (`src/bot/**`, new pages) | **0 errors** |
| Build | exit 0 |

Production markers verified live in `index.4eeef4e0.js`: Backtest, Paper trading,
`/api/ai-rationale`, settlement error text; HSTS + CSP headers served; AI endpoint
returns an honest non-fabricating response when unconfigured.

## 7. Acceptance against the directive

1. Audit before architectural change — done (three-part audit).
2. Replace fake/simulated functionality — settlement phantom-loss removed; theatrical
   "confidence" relabelled; trackers removed; paper trading is explicitly labelled.
3. Genuine AI agent — Gemini rationale layer integrated (free tier); deterministic core
   remains the decision-maker, LLM provides rationale only.
4. Real trade execution — already real; hardened (fresh-proposal buys, settlement fix).
5. Risk management — daily-loss / consecutive-loss / max-stake / drawdown / suspension
   / emergency-stop all present and enforced in-engine.
6. Testing — see §6.
7. Security — HSTS + CSP, token-leak fix, no hard-coded secrets, trackers disabled.
8. Deployment — pushed and verified live.
9. Honesty — meta description, signal-strength labelling, paper labels, honest AI
   fallback, honest backtest verdict.
10. This report.

## 8. Known limitations / next steps

- Set `GEMINI_API_KEY` to activate the AI rationale (free, no card).
- OAuth token still in `localStorage` (SPA constraint) — a backend/BFF would be needed
  to move it server-side.
- No persistent trade-journal database was provisioned; the app persists trades in
  browser storage. A real backend DB would require infrastructure/credentials.
- `strict` TypeScript is not enabled (hundreds of pre-existing errors in vendored code);
  `src/bot/**` typechecks clean. Enabling strict app-wide is a separate refactor.
- Live-order execution still requires the user's own Deriv credentials (correctly — no
  dev funds are used).
