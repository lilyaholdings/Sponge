# Chemical X

An original, monochrome market-research terminal and paper-trading bot for short-duration Kalshi contracts. Built from scratch with Node.js and browser-native JavaScript. No runtime packages, external fonts, or build pipeline.

## Run

Requires **Node.js 24.5+**.

```sh
cd /workspace/Sponge
npm start
```

The server defaults to dedicated port **4317**. This port was checked as unused before startup. If it is occupied on a later run, Chemical X exits with a clear error and leaves the existing service untouched. `PORT` and `HOST` override the defaults; `npm run dev` restarts on source changes. The start scripts honor standard environment proxy configuration using Node's `--use-env-proxy` flag.

```sh
npm run check
npm test
```

Tests cover directional symmetry, trade windows, stale/incomplete/crossed books, entry limits, fees, depth-aware sizing, capital limits, duplicate entries, settlement, mode isolation, configuration validation, Kalshi payload normalization, automatic paper entries, and persistence across server restarts. They use isolated temporary ledgers.

## Workflow

1. **Market radar:** inspect synthetic BTC, ETH, SOL, and illustrative financial fixtures; filter or search markets and select one to examine its book and flow.
2. **Signal feed:** rank setups by estimated net edge and inspect every rejected entry gate.
3. **Paper positions:** buy an eligible signal manually, or **Start paper bot** for automatic scans every 10 seconds. The bot ranks eligible contracts and respects position limits, total exposure, available capital, displayed size, and one position per contract per mode.
4. **Paper portfolio:** follow positions, export CSV, and advance the synthetic clock by 15 minutes to exercise settlement. This changes simulation time only. Live-data paper positions settle only after the API reports an official settled YES/NO result.
5. **Performance:** inspect realized win rate, average acquisition price, estimated fees, net P&L, and a 95% Wilson interval. Metrics begin empty, with no invented track record.
6. **Configuration:** adjust signal and risk parameters; optionally add up to six exact financial or other Kalshi market tickers.

The bot starts **disarmed after every server restart**. Display pause stops UI refresh and manual entry, but does not stop the automatic paper bot; use **Stop paper bot** for that. Closing the browser also does not stop an armed server. The running bot displays its last scan: markets scanned, qualified signals, positions opened, and specific entry blockers. A healthy feed with zero qualifying signals is distinct from a disconnected feed. Settings and positions persist in `.data/state.json`, ignored by Git. `DATA_DIR` can select another storage directory. This is a single-operator application; do not share a writable data directory between server processes.

## Open it on your own computer

A port on the cloud workspace is internal to that machine. The onboarding interface does not provide an exposed website URL, and server processes must restart when the cloud environment is restored.

For local use, extract the portable Chemical X archive and install Node.js 24.5 or newer. Open `Start Chemical X.command` on macOS, or `Start Chemical X.bat` on Windows. Alternatively, run `npm run launch` from the extracted project folder on macOS, Windows, or Linux. The launcher starts the app on this computer and opens its browser automatically. Keep its terminal open while using the app.

The local launcher binds to loopback and defaults to port 4317. It opens the browser only after its own server starts successfully. If the port is occupied, it leaves that service alone and exits; choose a free `PORT` to retry. The portable archive excludes Git metadata and existing paper positions, settings, and credentials. Public hosting is a separate deployment step; no public URL has been created.

## Signal model

The engine estimates a YES-side score from:

- Weighted book imbalance: `(YES depth − NO depth) / total depth`, with level weights `1 / (1 + 0.4 × level)`.
- Aggressive trade delta over the most recent 60 seconds: `(YES taker quantity − NO taker quantity) / total`.
- Price drift: the latest YES price minus the tenth-most-recent observation, divided by 12¢ and clamped to `[-1, 1]`.

`YES score = clamp(50 + 26 × imbalance + 19 × delta + 7 × drift, 8, 92)`.

The higher-scoring side is evaluated for entry. This is a transparent **uncalibrated research heuristic**, not a validated probability model. “Estimated edge” treats that score as a probability for exploratory screening; it is not a measured expected return. The live connector observes Kalshi's own book and trade flow, not underlying exchange order flow or an official settlement-reference price stream.

Defaults: maximum entry 63¢, preferred entry 53¢, minimum score 68, minimum estimated net edge 5¢, maximum spread 8¢, weighted depth 100 per side, at least five trades in 60 seconds, feed age at most 15 seconds, and at least 30 seconds before close. Paper positions are capped at $25 each and $150 total exposure from a $1,000 paper bankroll.

Estimated taker fees: `ceil(0.07 × contracts × p × (1 − p) × 100)` cents. Entry screening uses a conservative one-contract fee; position cost uses the batch fee. Market-specific fee schedules are not implemented. Paper fills assume the observed ask, capped to the opposite best bid's displayed size; latency, queue position, and additional slippage are not modeled.

The 68% baseline / 72%+ stretch win rate and sub-63¢ / ideally 53¢ average entry are **user targets, not demonstrated results**. Average entry excludes fees, while cost and P&L include them. No historical backtest, calibration, or held-out evaluation has been performed. A real predictive model needs time-aligned order books, prints, underlying reference data, final settlement outcomes, and chronological out-of-sample testing for each market type.

## Data modes

**Simulation** is fully synthetic, clearly labeled, and usable offline. Six fixtures roll every 15 minutes. Outcomes are deterministic synthetic values independent of the score; they validate mechanics and never establish predictive performance. Financial fixtures do not imply that matching 15-minute Kalshi products exist.

**Kalshi live** uses the public HTTPS API at `api.elections.kalshi.com/trade-api/v2` to discover `KXBTC15M`, `KXETH15M`, and `KXSOL15M`, read order books, and retrieve recent trades. It supports fixed-point and legacy order-book payloads. Exact additional tickers can be configured, and their real closing times and settlement rules apply. Custom markets are not assumed to have a 15-minute horizon. Public data access requires no credentials in this connector.

Live connection failures are displayed explicitly. No synthetic prices are substituted into live mode, and live/demo paper ledgers never mix. Initial cloud validation was blocked by the network proxy. A subsequent check successfully retrieved real BTC, ETH, and SOL contracts, order books, and recent trades. Connectivity on another computer must still be verified locally. One failed series, invalid custom ticker, or failed book request now produces a visible warning while healthy markets remain available. A total connection failure shows the endpoint, error code, and a retry control. No simulated quotes are substituted.

## Troubleshooting startup

From the fully extracted project folder, run `npm run diagnose`. This checks the installed runtime, the app files, port availability, server startup, and the dashboard API. It stops only the diagnostic server it starts. Copy its output when reporting a failure; it does not print settings, positions, credentials, or environment-variable values.

Node.js 24.0–24.4 cannot use the required proxy startup flag. Install Node.js 24.5 or newer. The launcher now checks this before starting and keeps errors visible. Extract the entire ZIP before launching; running a launcher from inside an archive leaves its supporting files unavailable.

## HTTP endpoints

All market and ledger endpoints accept `?mode=demo` (default) or `?mode=live`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Server readiness and paper-only execution status |
| `GET /api/snapshot` | Markets, derived signals, settings, positions, realized metrics, bot status |
| `POST /api/positions` | Open a gated paper position with `{ "ticker": "…" }` |
| `POST /api/automation` | Start/stop automatic paper scanning with `{ "enabled": true }` |
| `POST /api/settings` | Save validated `settings` and `customTickers` |
| `POST /api/demo/advance` | Advance the synthetic clock by 15 minutes |
| `POST /api/reset` | Stop that mode's bot and delete its paper ledger |

Mutation routes require JSON and reject mismatched browser origins. The server has no user authentication and is intended for an isolated personal workspace. No credentials, real orders, account API, or real-money execution are implemented.

## Project layout

- `lib/engine.js`: signal math, entry gates, settings validation, fees, metrics.
- `lib/feeds.js`: synthetic fixtures and public Kalshi adapter.
- `lib/ledger.js`: paper sizing and settlement accounting.
- `server.js`: HTTP API, local persistence, and automatic paper scanning.
- `public/`: responsive monochrome UI, native SVG charts, and CSV export.
- `test/`: Node's built-in unit and HTTP integration tests.
