import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReplayLines, parseReplaySnapshot } from '../src/octane-supercharts/offline-replay';

function fixture() {
	return { schema_version: 1, adapter: 'synthetic-offline-chart/1', synthetic: true,
		implementation: 'offline-vwap-reference/2', profile: 'reference-not-pine-parity', units: 'price',
		as_of: '2026-11-07T00:01:30.000000Z', policy: 'include_provisional',
		config: { mode: 'anchored', window: null, anchor_offset: false, multiplier: 1, source: 'hlc3' },
		stream: { provider: 'synthetic', instrument: 'DEMO', timeframe: 'M1', price_basis: 'synthetic', volume_semantics: 'synthetic' },
		availability: [{ time: 1794009600, available_at: '2026-11-07T00:01:00.000000Z', revision: 0, status: 'finalized', indicator_available: true }],
		series: { candles: [{ time: 1794009600, open: 9, high: 15, low: 3, close: 12 }],
			vwap: [{ time: 1794009600, value: 10 }], upper: [{ time: 1794009600, value: 10 }], lower: [{ time: 1794009600, value: 10 }] } };
}
type Fixture = ReturnType<typeof fixture>;
function rejects(change: (p: Fixture) => void): void { const p = fixture(); change(p); assert.throws(() => parseReplaySnapshot(p)); }

test('accepts Python synthetic contract and projects only chart fields', () => {
	const p = fixture();
	const out = parseReplaySnapshot({ ...p, ignored_metadata: 'never displayed' });
	assert.equal(out.source, 'hlc3'); assert.equal(out.instrument, 'DEMO'); assert.equal(out.provisional, 0);
	assert.deepEqual(out.series, p.series); assert.equal('ignored_metadata' in out, false);
});
test('rejects real-origin relabeling and unsupported schemas', () => {
	for (const v of [null, {}, [], { candles: [] }]) assert.throws(() => parseReplaySnapshot(v));
	rejects(p => { p.synthetic = false; }); rejects(p => { p.stream.provider = 'oanda'; });
	rejects(p => { p.stream.price_basis = 'mid'; }); rejects(p => { p.adapter = 'future'; });
	rejects(p => { p.schema_version = 2; }); rejects(p => { p.profile = 'pine-parity'; });
});
test('rejects bad OHLC, duplicate times and wrong line alignment', () => {
	rejects(p => { p.series.candles[0].high = 1; }); rejects(p => { p.series.candles[0].close = Infinity; });
	rejects(p => { p.series.vwap[0].time++; }); rejects(p => { p.series.upper = []; });
	rejects(p => { p.series.candles.push(p.series.candles[0]); p.availability.push(p.availability[0]); });
	rejects(p => { p.series.candles[0].time *= 1000; });
});
test('preserves whitespace, rejects null/zero mask substitutions and inverted bands', () => {
	const p = fixture(); p.availability[0].indicator_available = false;
	const point = { time: p.series.candles[0].time };
	const out = parseReplaySnapshot({ ...p, series: { ...p.series, vwap: [point], upper: [point], lower: [point] } });
	assert.deepEqual(out.series.vwap, [point]);
	rejects(p => { p.availability[0].indicator_available = false; });
	rejects(p => { p.series.lower[0].value = 11; });
	assert.throws(() => parseReplaySnapshot({ ...fixture(), series: { ...fixture().series, vwap: [{ ...point, value: null }] } }));
});
test('enforces cutoff, canonical UTC, revisions and final/provisional policy', () => {
	rejects(p => { p.as_of = '2026-11-07T00:00:00.000000Z'; });
	rejects(p => { p.as_of = '2026-02-30T00:01:30.000000Z'; });
	rejects(p => { p.availability[0].available_at = '2026-11-07T00:01:30.000001Z'; });
	rejects(p => { p.availability[0].revision = -1; });
	rejects(p => { p.policy = 'finalized'; p.availability[0].status = 'provisional'; });
	const p = fixture(); p.availability[0].status = 'provisional'; assert.equal(parseReplaySnapshot(p).provisional, 1);
});
test('rejects unsupported config and unsafe labels', () => {
	rejects(p => { p.config.source = 'ohlc4'; }); rejects(p => { p.config.multiplier = -1; });
	rejects(p => { p.config.mode = 'rolling'; }); rejects(p => { p.stream.instrument = '<script>'; });
});
test('line adapter applies Python values, keeps whitespace, toggles visibility and clears stale data', () => {
	const calls: { data: unknown; options: unknown }[] = [];
	const chart = { addSeries: () => {
		const state = { data: undefined as unknown, options: undefined as unknown }; calls.push(state);
		return { setData: (data: unknown) => { state.data = data; }, applyOptions: (options: unknown) => { state.options = options; } };
	} };
	const lines = createReplayLines(chart as unknown as Parameters<typeof createReplayLines>[0]);
	const snapshot = parseReplaySnapshot(fixture()); lines.apply(snapshot);
	assert.deepEqual(calls.map(c => c.data), [snapshot.series.vwap, snapshot.series.upper, snapshot.series.lower]);
	lines.visible(false, true); assert.deepEqual(calls.map(c => c.options), [{ visible: false }, { visible: true }, { visible: true }]);
	lines.clear(); assert.deepEqual(calls.map(c => c.data), [[], [], []]);
});
