# Over / Under Bot

A multi-market, risk-aware trading system for Deriv synthetic-index **Digit Over/Under**
contracts. It scans available synthetic markets, measures the empirical last-digit
distribution against the broker's quoted payout, and executes a trade **only** when the
measured edge is statistically defensible and passes every risk gate.

Everything runs against the live Deriv WebSocket API using the app's existing, already
authenticated connection (`api_base`). Nothing here is simulated except when you
explicitly leave **Live trading** off, in which case the engine analyses and logs
opportunities without placing orders.

---

## What it actually does

1. **Discovery** — pulls `active_symbols`, keeps synthetic indices (Volatility, Crash,
   Boom, Jump, Step, Range Break, and any other `synthetic_index` submarket the broker
   exposes), then pulls `contracts_for` per symbol to read the real available
   `DIGITOVER` / `DIGITUNDER` barriers. No symbol list is hardcoded.
2. **Data** — a dedicated public WebSocket streams live ticks per symbol. The last digit
   is extracted from `quote` + the tick's `pip_size`. Historical ticks (`ticks_history`)
   bootstrap each symbol so analysis is warm immediately.
3. **Statistical analysis** — for each symbol it maintains a rolling digit histogram and
   computes:
   - digit frequencies and a **chi-square uniformity test** (are digits skewed at all?),
   - a **Wilson confidence interval** on `P(digit > b)` / `P(digit < b)`,
   - a **Markov/conditional-dependence** check (does the next digit depend on the
     previous one beyond ordinary fluctuation?),
   - volatility (expansion/contraction) and momentum (RSI, SMA trend).
4. **Expected value** — for each candidate contract it requests a real `proposal` from the
   broker (quoted payout), then computes
   `EV = P(win) × payout − stake` and `EV% = P(win) × payoutRatio − 1` using the
   **empirical** win probability. Confidence is the fraction of the Wilson interval that
   lies above the breakeven probability `1/payoutRatio`.
5. **Trade selection** — opportunities are ranked by `EV% × confidence`; only the best
   candidate that clears every risk gate is considered.
6. **Execution** — `proposal` → re-validate the final payout against the EV threshold →
   `buy` → monitor via `proposal_open_contract` until settlement → record the real result.
7. **Risk management** — a dedicated gate in front of every order (see below). When a
   limit is hit, trading suspends and the reason is surfaced.

### Honesty guarantees
- The bot **defaults to analysis-only**. Live execution requires toggling **Live
  trading**, and on a real-money account it additionally requires an explicit confirmation
  dialog. On a demo (VRT) account, live orders are ordinary demo trades (Stage 3).
- Digit history alone is **not** treated as a prediction. A trade is only taken when the
  empirical skew is large enough, statistically significant (CI excludes breakeven), and
  the broker's own payout still yields positive EV. On uniform digits (most Volatility
  indices) EV is negative and the bot correctly **stays out**.
- Stage, simulated/live, and every metric shown in the dashboard come from real broker
  responses or real local computation — no fabricated win rates or confidence scores.

## Operating modes

The bot has two selectable modes (strategy selector on the dashboard):

- **Edge (disciplined)** — the default and the honest strategy. It only places a trade when
  the measured edge clears every gate: confidence, sample size, EV, payout ratio, and all
  risk limits. On uniform digits it correctly **does nothing**, which can mean long periods
  of inactivity. This is correct behaviour, not a bug.
- **Active (demo practice)** — places a trade on a configurable cadence (default every 12s),
  ranked by confidence, **regardless of expected value**, so you can watch the full live
  pipeline (quote → buy → settlement → win/loss) stream in real time. **Risk safety gates
  still apply** (suspension, open positions, daily-loss, drawdown, consecutive losses,
  cooldown, stake cap). This mode is intended for a **demo account** to demonstrate the
  execution path; on a real account it requires an explicit confirmation dialog and uses
  real funds at a negative long-run EV.

Both modes stream a timestamped **live activity feed** (quotes, purchases, settlements with
win/loss and payout) so you can see exactly what the engine is doing.

## Implemented strategies

The single strategy is **Empirical Over/Under EV**:

> Measure the true last-digit distribution for a symbol over a rolling window. For each
> legal Over/Under barrier, compare the empirical win probability (with a Wilson CI) to
> the broker's breakeven probability implied by the live quoted payout. Enter only when
> the lower CI bound still beats breakeven and EV% clears the configured minimum.

**Assumptions / limitations**
- Digit distributions on most synthetic indices are engineered to be near-uniform, so
  genuine skew is rare. Expect long periods of inactivity — this is correct behaviour,
  not a bug.
- Real skew is more plausible on path-dependent indices (Crash/Boom/Jump) where spikes
  bias the final digit. The engine surfaces which markets are currently skewed.
- The engine does **not** use Martingale or any stake escalation after losses. Sizing is
  fixed-stake, capped by equity % and Kelly (capped at 5%).
- Backtesting/validation (`core/backtest.ts`) is provided and leakage-free
  (chronological train/test split) but must be run on a representative digit history
  before trusting a parameter set; it is not wired to auto-tune live parameters.

## Risk management

Configurable limits (defaults in `core/risk.ts`): max stake, max % equity per trade, max
daily loss, max total drawdown, max consecutive losses, max open positions, max trades
per session, min EV, min payout ratio, min confidence, min sample size, plus a cooldown
after N consecutive losses. Breaching any limit **suspends** trading with a stated
reason; you can resume (which resets the session counters) deliberately from the UI.

## Code layout

| Path | Responsibility |
|---|---|
| `core/types.ts` | Shared types |
| `core/digit-stats.ts` | Digit distribution, chi-square, Wilson CI, Markov, volatility, momentum |
| `core/ev.ts` | Expected value, payout ratio, Kelly sizing, barrier validation |
| `core/risk.ts` | Risk limits, gates, settlement effects, suspension |
| `core/performance.ts` | Real trade statistics (win rate, PF, drawdown, per-category) |
| `core/backtest.ts` | Historical simulation + out-of-sample validation |
| `deriv/api.ts` | Authenticated Deriv request wrappers |
| `deriv/discovery.ts` | `active_symbols` + `contracts_for` market/contract discovery |
| `deriv/ticks.ts` | Dedicated multi-symbol tick feed with digit extraction + staleness |
| `deriv/execution.ts` | `proposal` → `buy` → `proposal_open_contract` settlement |
| `engine/engine.ts` | Orchestrator: discover → warm → scan → rank → risk → execute |
| `use-engine.ts` | React bindings |
| `src/pages/ou-bot` | Dashboard UI |

## Testing

- **Core math** is unit-tested (Wilson, chi-square, EV, Kelly, risk gates, leakage-free
  backtest) — 30 assertions, all passing.
- **Historical backtest / out-of-sample** — `core/backtest.ts` (`simulateOverUnder`,
  `validateOutOfSample`).
- **Demo (Stage 3)** — log into a Deriv demo account, leave Live trading on (demo orders),
  Start engine. Verify analysis, execution, settlement, and risk suspension end-to-end.
- **Live (Stage 5)** — only after demo passes: enable Live trading on a real account
  (explicit confirm), with conservative stake and strict loss limits.

## Known constraints
- Requires a logged-in Deriv session; the OAuth app must include this deployment's URL as
  a redirect URI.
- Deriv rate limits apply; proposal quotes are cached ~12s per contract to limit chatter.
- Settlement is polled (1s) rather than streamed, which is simpler and isolated from the
  app's global streams.

No strategy can guarantee profit. The system's job is to preserve capital and act only
when a real, measured edge exists — including doing nothing.
