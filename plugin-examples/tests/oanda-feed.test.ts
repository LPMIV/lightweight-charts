import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OandaFeed, mergeCandles, validateCandle, type MarketCandle } from '../src/octane-supercharts/oanda-feed';
const candle = (time: number, complete = false, close = 2): MarketCandle => ({ time, open: 2, high: 4, low: 1, close, volume: 9, complete });
const query = { instrument: 'USD_CAD', granularity: 'H3', price: 'M' as const };
const envelope = (candles: MarketCandle[]) => ({ ...query, source: 'oanda', volumeKind: 'tick-count', candles });
class FakeStream {
	listeners = new Map<string, (event: MessageEvent<string>) => void>();
	onerror: ((event: Event) => void) | null = null;
	closed = false;
	addEventListener(name: string, listener: (event: MessageEvent<string>) => void) { this.listeners.set(name, listener); }
	close() { this.closed = true; }
	emit(name: string, data: unknown) { this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>); }
}
function setup(fetcher: typeof fetch = async () => new Response(JSON.stringify(envelope([])))) {
	const sources: FakeStream[] = []; const statuses: string[] = []; let data: MarketCandle[] = [];
	const feed = new OandaFeed({ onData: c => { data = c; }, onStatus: s => statuses.push(s) }, {
		fetch: fetcher, stream: url => { assert.match(url, /^\/api\/oanda\/stream\?/); const s = new FakeStream(); sources.push(s); return s; },
	});
	feed.connect(query); return { feed, sources, statuses, data: () => data };
}
test('ordered deduplication, revisions and complete bars cannot reopen', () => {
	const c = mergeCandles([candle(20, true)], [candle(30), candle(10), candle(20, false, 3), candle(30, true, 3)]);
	assert.deepEqual(c.map(x => x.time), [10, 20, 30]); assert.equal(c[1].close, 2); assert.equal(c[2].close, 3);
});
test('rejects nonfinite values, bad OHLC, milliseconds, fractional time, bad volume/completion', () => {
	for (const c of [{ ...candle(1), close: NaN }, { ...candle(1), high: 1 }, { ...candle(1), time: 1.5 }, { ...candle(1), time: 1700000000000 }, { ...candle(1), volume: -1 }, { ...candle(1), complete: 'yes' }]) assert.throws(() => validateCandle(c));
});
test('snapshot, provisional and final updates produce one bar per time', t => {
	const h = setup(); t.after(() => h.feed.disconnect(false));
	h.sources[0].emit('snapshot', envelope([candle(10), candle(20)])); h.sources[0].emit('status', { state: 'live', message: 'live' });
	h.sources[0].emit('candle', candle(20, true, 3)); h.sources[0].emit('candle', candle(30));
	assert.deepEqual(h.data().map(c => c.time), [10, 20, 30]); assert.equal(h.data()[1].complete, true); assert.equal(h.statuses.at(-1), 'live');
});
test('reconnect snapshot repairs recent candles while preserving paged history', t => {
	const h = setup(); t.after(() => h.feed.disconnect(false));
	h.sources[0].emit('snapshot', envelope([candle(10), candle(20)])); h.sources[0].emit('status', { state: 'reconnecting', message: 'retry' });
	h.sources[0].emit('snapshot', envelope([candle(20, true, 3), candle(30)]));
	assert.deepEqual(h.data().map(c => c.time), [10, 20, 30]); assert.equal(h.data()[1].close, 3);
});
test('selection change closes old stream and ignores its late events', t => {
	const h = setup(); t.after(() => h.feed.disconnect(false)); h.sources[0].emit('snapshot', envelope([candle(10)]));
	h.feed.connect({ ...query, instrument: 'EUR_USD' }); h.sources[0].emit('candle', candle(20));
	assert.equal(h.sources[0].closed, true); assert.deepEqual(h.data(), []);
	h.sources[1].emit('snapshot', { ...envelope([candle(30)]), instrument: 'EUR_USD' }); assert.equal(h.data()[0].time, 30);
});
test('wrong dataset fails closed', t => {
	const h = setup(); t.after(() => h.feed.disconnect(false)); h.sources[0].emit('snapshot', { ...envelope([candle(10)]), price: 'A' });
	assert.equal(h.sources[0].closed, true); assert.equal(h.statuses.at(-1), 'error');
});
test('terminal auth/config error closes source, no endless auto-reconnect', () => {
	const h = setup(); h.sources[0].emit('status', { state: 'error', message: 'Configure private backend' });
	h.sources[0].onerror?.(new Event('error')); assert.equal(h.sources[0].closed, true); assert.equal(h.statuses.at(-1), 'error');
});
test('older history request is single-flight and cannot overwrite newer stream revisions', async t => {
	let resolve: (value: Response) => void = () => {}; let url = '';
	const h = setup(async input => { url = String(input); return new Promise<Response>(r => { resolve = r; }); });
	t.after(() => h.feed.disconnect(false)); h.sources[0].emit('snapshot', envelope([candle(20), candle(30)]));
	const loading = h.feed.loadOlder(); assert.match(url, /before=20/); assert.equal(await h.feed.loadOlder(), false);
	h.sources[0].emit('candle', candle(30, true, 3)); resolve(new Response(JSON.stringify(envelope([candle(10), candle(20), candle(30)]))));
	assert.equal(await loading, true); assert.deepEqual(h.data().map(c => c.time), [10, 20, 30]); assert.equal(h.data()[2].close, 3);
});
test('late history ignored after selection switch even when transport ignores abort', async t => {
	let resolve: (value: Response) => void = () => {};
	const h = setup(async () => new Promise<Response>(r => { resolve = r; })); t.after(() => h.feed.disconnect(false));
	h.sources[0].emit('snapshot', envelope([candle(20)])); const loading = h.feed.loadOlder(); h.feed.connect(query);
	resolve(new Response(JSON.stringify(envelope([candle(10)])))); assert.equal(await loading, false); assert.deepEqual(h.data(), []);
});
test('empty history stops further requests; retransmissions do not duplicate bars', async t => {
	let calls = 0; const h = setup(async () => { calls++; return new Response(JSON.stringify(envelope([]))); });
	t.after(() => h.feed.disconnect(false)); h.sources[0].emit('snapshot', envelope([candle(20)])); h.sources[0].emit('candle', candle(20));
	await h.feed.loadOlder(); await h.feed.loadOlder(); assert.equal(calls, 1); assert.equal(h.data().length, 1);
});
test('non-overlapping reconnect resets recent segment so history can fill long outage', async t => {
	let url = '';
	const h = setup(async input => { url = String(input); return new Response(JSON.stringify(envelope([candle(90, true)]))); });
	t.after(() => h.feed.disconnect(false)); h.sources[0].emit('snapshot', envelope([candle(10), candle(20)]));
	h.sources[0].emit('snapshot', envelope([candle(100, true), candle(110)]));
	assert.deepEqual(h.data().map(c => c.time), [100, 110]);
	await h.feed.loadOlder(); assert.match(url, /before=100/); assert.deepEqual(h.data().map(c => c.time), [90, 100, 110]);
});
test('watchdog staleness clears on resumed heartbeat without a new connection', t => {
	t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
	const h = setup(); t.after(() => h.feed.disconnect(false));
	h.sources[0].emit('snapshot', envelope([candle(10)])); h.sources[0].emit('status', { state: 'live', message: 'live' });
	t.mock.timers.tick(25000); assert.equal(h.statuses.at(-1), 'reconnecting');
	h.sources[0].emit('heartbeat', { time: 10 }); assert.equal(h.statuses.at(-1), 'live');
});
test('long-gap reset cancels an in-flight old-segment page even if fetch ignores abort', async t => {
	let resolve: (value: Response) => void = () => {};
	const h = setup(async () => new Promise<Response>(r => { resolve = r; })); t.after(() => h.feed.disconnect(false));
	h.sources[0].emit('snapshot', envelope([candle(20)])); const loading = h.feed.loadOlder();
	h.sources[0].emit('snapshot', envelope([candle(100), candle(110)]));
	resolve(new Response(JSON.stringify(envelope([candle(10)])))); assert.equal(await loading, false);
	assert.deepEqual(h.data().map(c => c.time), [100, 110]);
});
