# Python snapshot viewer

The existing Octane chart now offers **Offline Python replay** in its data
selector. Choose a supported Python chart export with the local file
picker. Candles, Python VWAP and weighted price bands appear on the same chart;
separate checkboxes control the indicator lines. Import another cutoff snapshot
to replace a provisional candle with its final version. This is a snapshot
viewer, not a timed playback engine or a verified live indicator integration.

The label identifies imports as synthetic or recorded replay. No broker or
upload request is made, no file is stored in localStorage, and Python performs
all indicator calculations. Switching to Demo or OANDA clears the indicator
series. The existing `oanda-feed.ts` transport is retained.

## Supported formats

Schema 1 from the private Python `indicators.chart_cli` adapter
`synthetic-offline-chart/1` is supported. The separate
`oanda-juno-recorded-chart/1` adapter supports private Python exports from an
inspected Juno M1 practice capture. Both `close` and `hlc3` source settings are
accepted. Raw OANDA responses and Juno result JSON are deliberately rejected;
use the private `indicators.juno_cli` converter. Do not relabel real data as
synthetic, embed uploaded captures in public source, or upload them to a host.

Recorded imports display RECORDED OANDA and REPLAY. Receipt times and revisions
remain explicitly unknown; capture start is not an as-of cutoff. The default
reference calculation starts at the partial capture window, with optional
rolling bars. It is not daily-session VWAP, Analyzer ROC or TradingView parity.
The current recorded contract is practice M1 only, with tick-count volume.

The browser validates finite OHLC, sorted unique UTC seconds, line alignment,
availability policy, confirmation policy, band masks and declared provenance.
Missing indicator values remain whitespace. Limits are 5 MiB and 5,000 candles;
chart times range from Unix epoch through year 3000. Metadata text is projected
onto bounded labels; raw file content and errors are never echoed. The metadata
is a caller assertion, not authenticated proof of data origin.

From the private core checkout containing HLC3 support:

```sh
python -m indicators.chart_cli tests/fixtures/replay_synthetic.jsonl \
  --source hlc3 --as-of 2026-11-07T00:01:30Z \
  --policy include_provisional --output preview.json
```

Choose that file after selecting Offline Python replay. This example contains
synthetic prices. It supplies no evidence about TradingView or OANDA connectivity.

## Validation

After building the root library and installing plugin-example dependencies:

```sh
npm run build
npm run test:replay
npm run test:oanda
```

From the chart repository root, an optional real-browser integration script
generates preview/final fixtures directly using the private Python checkout:

```sh
OCTANE_CORE_PATH=/absolute/path/to/trading-core-logic \
  node plugin-examples/tests/replay-browser.mjs
```

It covers imports, preview/final replacement, indicator controls, error recovery
and 1440/430-pixel Chromium viewports, asserting zero API requests. Set
`CHROMIUM_PATH` for a different local Chromium executable. Chromium viewports do
not establish iPhone Safari compatibility. The script was attempted in the
2026-11-09 cloud environment but Chromium could not start because its singleton
socket creation was denied. No rendered-browser pass or screenshot is claimed.

An additional recorded-data boundary check can run without a browser:

```sh
node --import tsx tests/recorded-path-check.mjs \
  /private/path/sanitized-capture.json /private/path/recorded-finalized.json
```

It checks local recorded candles through the unchanged OandaFeed and the Python
snapshot parser, without a broker request or rendering. To add that private
snapshot to the browser script, set OCTANE_RECORDED_SNAPSHOT to its absolute
local path. Actual capture values and files are never committed by these tests.
