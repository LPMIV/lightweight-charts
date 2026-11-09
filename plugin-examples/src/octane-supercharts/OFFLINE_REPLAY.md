# Python snapshot viewer

The existing Octane chart now offers **Offline Python replay** in its data
selector. Choose an existing synthetic Python chart export with the local file
picker. Candles, Python VWAP and weighted price bands appear on the same chart;
separate checkboxes control the indicator lines. Import another cutoff snapshot
to replace a provisional candle with its final version. This is a snapshot
viewer, not a timed playback engine or a verified live indicator integration.

The label always identifies these imports as synthetic replay. No broker or
upload request is made, no file is stored in localStorage, and Python performs
all indicator calculations. Switching to Demo or OANDA clears the indicator
series. The existing `oanda-feed.ts` transport is retained.

## Supported format

Only schema 1 from the private Python `indicators.chart_cli` adapter
`synthetic-offline-chart/1` is supported. Both `close` and `hlc3` source settings
are accepted. Raw OANDA responses and Juno result JSON are deliberately rejected;
real recorded provenance needs a separate reviewed adapter after the actual
capture is inspected. Do not relabel real data as synthetic.

The browser validates finite OHLC, sorted unique UTC seconds, line alignment,
availability cutoff, confirmation policy, band masks and synthetic provenance.
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
