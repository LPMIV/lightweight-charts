// Explicit local artifact paths only. Never writes or prints uploaded market records.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OandaFeed, validateCandle } from '../src/octane-supercharts/oanda-feed.ts';
import { parseReplaySnapshot } from '../src/octane-supercharts/offline-replay.ts';

const [capturePath, snapshotPath] = process.argv.slice(2);
if (!capturePath || !snapshotPath) throw new Error('Pass sanitized capture and Python recorded snapshot paths');
const capture = JSON.parse(await readFile(capturePath, 'utf8'));
const snapshot = parseReplaySnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')));
assert.equal(capture.adapter, 'oanda-juno-capture/1'); assert.equal(capture.environment, 'practice');
assert.equal(snapshot.evidence, 'recorded-snapshot'); assert.equal(snapshot.asOf, null);
const price = { mid: 'M', bid: 'B', ask: 'A' }[snapshot.priceBasis];
const candles = capture.candle_sets[price].map(validateCandle);
const handlers = new Map(); let received = [];
const stream = { addEventListener: (name, fn) => handlers.set(name, fn), close() {}, onerror: null };
const feed = new OandaFeed({ onData: rows => { received = rows; }, onStatus() {} }, {
	fetch: async () => { throw new Error('No network permitted in recorded path check'); }, stream: () => stream,
});
try {
	feed.connect({ instrument: capture.instrument, granularity: capture.granularity, price });
	handlers.get('snapshot')({ data: JSON.stringify({ instrument: capture.instrument, granularity: capture.granularity,
		price, source: 'oanda', volumeKind: 'tick-count', candles }) });
	assert.deepEqual(received, candles);
	const selected = candles.filter(c => snapshot.policy === 'include_provisional' || c.complete);
	assert.deepEqual(snapshot.series.candles, selected.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
	assert.equal(snapshot.instrument, capture.instrument);
	console.log(`PASS: ${received.length} recorded candles through unchanged OandaFeed; ${selected.length} through Python snapshot parser; no network or browser rendering`);
} finally { feed.disconnect(false); }
