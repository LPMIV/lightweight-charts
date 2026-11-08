# OANDA market data in Octane

The Octane example supports historical candles, backward paging and live updates
through a private backend. The chart fork contains only a credential-free browser
adapter. Do not place API tokens, account identifiers or broker transport code here.

## Run locally

1. Build the library from the repository root: `npm ci && npm run build:prod`.
2. Install and build examples: `cd plugin-examples && npm ci && npm run build`.
3. Start the private OANDA backend separately on `127.0.0.1:8765`. Configure the
   token and account identifier only in that backend's environment. Its default
   is practice; enabling a real connection requires the account owner's approval.
4. Run `npm run dev` in `plugin-examples`, then open
   `http://127.0.0.1:5173/src/octane-supercharts/index.html`.
5. Choose OANDA, instrument, interval and Mid/Bid/Ask, then Connect / Reload.
   Load older requests another 500 candles. Disconnect stops further updates.

The Vite development server binds to loopback, uses port 5173 with `strictPort`,
and proxies `/api/oanda` to the local backend. No credentials go through Vite.
This configuration is a local development seam, not a production deployment.
Production needs authenticated same-origin routing, TLS and a protected backend.
Do not expose this local service to a network.

## Data contract

The adapter connects to `GET /api/oanda/stream` with `instrument`, `granularity`,
`price` and `count=500`. Server-sent events:

- `snapshot`: `{instrument, granularity, price, source: "oanda", volumeKind:
  "tick-count", candles: [...]}`.
- `candle`: one canonical candle with integer UTC epoch `time`, numeric OHLC,
  integer nonnegative `volume` and boolean `complete`.
- `status`: `{state, message}`. States are connecting, live, reconnecting,
  closed or error. Closed/error are terminal; the user can reconnect.
- `heartbeat`: liveness only, never a candle.

History uses `GET /api/oanda/candles` with the same selection and `before` equal
to the oldest displayed UTC timestamp. The boundary is exclusive. History
responses cannot overwrite concurrently updated recent bars.

The backend opens the upstream pricing stream before the initial REST snapshot.
Live chart values are **canonical REST candles refreshed every five seconds**,
not locally reconstructed quote ticks. OANDA's pricing stream is sampled and
cannot reproduce every market price/high/low or broker candle tick count. The
private backend uses REST for H3/H4 and daily/weekly session alignment, including
New York daylight-saving changes. It does not invent UTC calendar buckets.

Completed candles are protected from late provisional responses. Reconnect
snapshots repair recent bars and preserve older loaded history when they overlap.
If a reconnect snapshot has no overlap, the adapter resets to the recent segment
and displays a history-reset notice. Load older then fills backward from that
segment, rather than leaving an unreachable interior gap. Market-closed gaps are not filled with synthetic bars.
OANDA volume is a price/tick count, not traded exchange volume. No order or trade
execution is included. TradingView indicator parity is not claimed.

## Validation

From the repository root:

```sh
npm run build:prod
npm --prefix plugin-examples run build
npm --prefix plugin-examples run test:oanda
npm run test
npm run lint:eslint
```

The adapter tests cover duplicate/out-of-order revisions, completed bars,
malformed input, reconnect snapshots, rapid selection changes, cancellation,
terminal configuration/auth errors and racing historical requests.

An optional offline browser flow uses a synthetic loopback service, never OANDA:

```sh
CHROMIUM_PATH=/path/to/chromium node plugin-examples/tests/oanda-browser.mjs
```

It exercises demo mode, historical load, live revisions, paging, reconnect,
selection changes, disconnect, errors and demo recovery. It needs local ports
5173 and 8765 and a browser runtime capable of creating its process sockets.
