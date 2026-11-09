import type { CandlestickData, IChartApi, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts';
import { OandaFeed, type MarketCandle, type MarketQuery } from './oanda-feed';
import { createReplayLines, parseReplaySnapshot, REPLAY_MAX_BYTES } from './offline-replay';

/** Attach market data to the existing shell without modifying the chart library. */
export function attachOandaControls(chart: IChartApi, series: ISeriesApi<'Candlestick'>, demo: CandlestickData<Time>[], stats: (data: CandlestickData<Time>[]) => void): void {
	const container = document.createElement('div');
	container.innerHTML = `
		<form class="market-data-controls">
			<label>Data <select name="source"><option value="demo">Demo</option><option value="oanda">OANDA</option><option value="replay">Offline Python replay</option></select></label>
			<label>Instrument <select name="instrument"><option value="USD_CAD">USDCAD</option><option value="EUR_USD">EURUSD</option><option value="GBP_USD">GBPUSD</option><option value="USD_JPY">USDJPY</option></select></label>
			<label>Interval <select name="granularity"><option value="M1">1m</option><option value="M5">5m</option><option value="M15">15m</option><option value="H1">1h</option><option value="H3" selected>3h</option><option value="H4">4h</option><option value="D">D</option><option value="W">W</option></select></label>
			<label>Price <select name="price"><option value="M">Mid</option><option value="B">Bid</option><option value="A">Ask</option></select></label>
			<button type="submit">Connect / Reload</button>
			<button type="button" data-action="disconnect">Disconnect</button>
			<button type="button" data-action="older" disabled>Load older</button>
			<label class="replay-file" hidden>Python snapshot <input name="replay-file" type="file" accept=".json,.txt,application/json,text/plain"></label>
		</form>
		<fieldset class="replay-indicators" hidden><legend>Replay indicators</legend><label><input name="replay-vwap" type="checkbox" checked> Python VWAP</label> <label><input name="replay-bands" type="checkbox" checked> Weighted price bands</label></fieldset>
		<div class="data-status" role="status" aria-live="polite"></div><div class="data-detail"></div>`;
	document.querySelector('.chart-stage')!.before(container);
	const form = container.querySelector('form')!;
	const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;
	const status = container.querySelector('.data-status') as HTMLDivElement;
	const detail = container.querySelector('.data-detail') as HTMLDivElement;
	const older = container.querySelector('[data-action="older"]') as HTMLButtonElement;
	const replayInput = form.elements.namedItem('replay-file') as HTMLInputElement;
	const replayOptions = container.querySelector('.replay-indicators') as HTMLFieldSetElement;
	const replayLines = createReplayLines(chart);
	let firstSnapshot = true;
	let displayed: MarketCandle[] = [];
	let generation = 0;
	let loadingOlder = false;
	let historyReset = false;
	const feed = new OandaFeed({
		onData: (candles, reason) => {
			if (reason === 'reset') { firstSnapshot = true; historyReset = true; }
			const range = chart.timeScale().getVisibleRange();
			const previous = displayed;
			displayed = candles;
			const changed = candles.filter((c, i) => JSON.stringify(c) !== JSON.stringify(previous[i]));
			if (reason === 'candle' && changed.length === 1 && changed[0].time >= (previous.at(-1)?.time ?? 0)) {
				series.update({ ...changed[0], time: changed[0].time as UTCTimestamp });
			} else {
				series.setData(candles.map(c => ({ ...c, time: c.time as UTCTimestamp })));
				if (range && candles.length && !firstSnapshot) chart.timeScale().setVisibleRange(range);
			}
			if (candles.length && firstSnapshot) { chart.timeScale().fitContent(); firstSnapshot = false; }
			stats(candles.map(c => ({ ...c, time: c.time as UTCTimestamp })));
			const latest = candles.at(-1);
			detail.textContent = latest ? `${latest.complete ? 'Completed' : 'Forming'} candle · Tick count ${latest.volume} · UTC · OANDA REST OHLC` : 'No candles returned for this selection.';
			if (historyReset) detail.textContent += ' · History restarted after long gap; Load older to extend';
			older.disabled = !candles.length || loadingOlder;
		},
		onStatus: (state, message) => { status.dataset.state = state; status.textContent = `${state.toUpperCase()}: ${message}`; },
	});
	const labels = (symbol: string, interval: string) => {
		document.getElementById('chart-symbol')!.textContent = symbol;
		document.getElementById('chart-interval')!.textContent = interval;
		const exchange = document.querySelector('.chart-exchange');
		if (exchange) exchange.textContent = select('source').value === 'replay' ? 'SYNTHETIC' : select('source').value === 'demo' ? 'DEMO' : 'OANDA';
		const symbolChip = document.querySelector('#symbol-group .header-chip');
		if (symbolChip) symbolChip.textContent = symbol;
		const intervalChip = document.querySelector('#interval-group .header-chip');
		if (intervalChip) intervalChip.textContent = interval;
	};
	const showDemo = () => {
		generation++; feed.disconnect(false); displayed = []; loadingOlder = false;
		replayLines.clear();
		series.setData(demo); chart.timeScale().fitContent(); stats(demo); labels('USDCAD', '3h');
		status.dataset.state = 'demo'; status.textContent = 'DEMO: Static USDCAD sample, not connected to OANDA';
		detail.textContent = 'Select OANDA and Connect to load historical and live market data.';
		older.disabled = true; older.textContent = 'Load older';
	};
	const loadReplay = async () => {
		const current = ++generation;
		feed.disconnect(false); loadingOlder = false; older.disabled = true; older.textContent = 'Load older';
		const file = replayInput.files?.[0];
		if (!file) { status.dataset.state = 'replay'; status.textContent = 'REPLAY: Choose a Python chart snapshot. No live connection.'; return; }
		status.dataset.state = 'loading'; status.textContent = 'REPLAY: Reading local snapshot';
		try {
			if (file.size > REPLAY_MAX_BYTES) throw new Error('Too large');
			const text = await file.text();
			if (current !== generation || select('source').value !== 'replay') return;
			const snapshot = parseReplaySnapshot(JSON.parse(text) as unknown);
			series.setData(snapshot.series.candles); replayLines.apply(snapshot); displayed = [];
			chart.timeScale().fitContent(); stats(snapshot.series.candles); labels(snapshot.instrument, snapshot.timeframe);
			status.dataset.state = 'replay';
			status.textContent = 'REPLAY: Synthetic Python snapshot. No live data or TradingView parity.';
			detail.textContent = `${snapshot.series.candles.length} candles · ${snapshot.provisional} provisional · Source ${snapshot.source.toUpperCase()} · As of ${snapshot.asOf} · ${snapshot.policy}`;
		} catch {
			if (current !== generation) return;
			status.dataset.state = 'error'; status.textContent = 'REPLAY: Could not load snapshot. Use the synthetic Python chart export (maximum 5 MiB).';
		}
	};
	form.addEventListener('submit', event => {
		event.preventDefault();
		if (select('source').value === 'demo') { showDemo(); return; }
		if (select('source').value === 'replay') { void loadReplay(); return; }
		replayLines.clear();
		generation++; firstSnapshot = true; loadingOlder = false; historyReset = false; older.textContent = 'Load older';
		labels(select('instrument').value.replace('_', ''), select('granularity').selectedOptions[0].text);
		feed.connect({ instrument: select('instrument').value, granularity: select('granularity').value, price: select('price').value as MarketQuery['price'] });
	});
	select('source').addEventListener('change', () => {
		const replay = select('source').value === 'replay';
		for (const name of ['instrument', 'granularity', 'price']) select(name).disabled = replay;
		if (replay) replayInput.value = '';
		(container.querySelector('.replay-file') as HTMLLabelElement).hidden = !replay; replayOptions.hidden = !replay;
		if (select('source').value === 'demo') { showDemo(); return; }
		generation++; feed.disconnect(false); replayLines.clear(); displayed = []; loadingOlder = false;
		series.setData([]); stats([]); older.disabled = true; older.textContent = 'Load older'; labels(replay ? 'REPLAY' : select('instrument').value.replace('_', ''), '-');
		status.dataset.state = replay ? 'replay' : 'closed';
		status.textContent = replay ? 'REPLAY: Choose a Python chart snapshot. No live connection.' : 'DISCONNECTED: Select Connect / Reload to load OANDA.';
		detail.textContent = replay ? 'Local file only. Raw Juno result files require private normalization first.' : '';
	});
	replayInput.addEventListener('change', () => { if (select('source').value === 'replay') void loadReplay(); });
	replayOptions.addEventListener('change', () => replayLines.visible(
		(container.querySelector('[name="replay-vwap"]') as HTMLInputElement).checked,
		(container.querySelector('[name="replay-bands"]') as HTMLInputElement).checked));
	container.querySelector('[data-action="disconnect"]')!.addEventListener('click', () => {
		generation++; feed.disconnect(select('source').value !== 'replay'); loadingOlder = false; older.disabled = true; older.textContent = 'Load older';
		if (select('source').value === 'replay') { status.dataset.state = 'replay'; status.textContent = 'REPLAY: Offline snapshot retained. No live connection.'; }
	});
	older.addEventListener('click', async () => {
		const current = generation; loadingOlder = true; older.disabled = true; older.textContent = 'Loading…';
		await feed.loadOlder();
		if (current !== generation) return;
		loadingOlder = false; older.disabled = false; older.textContent = 'Load older';
	});
	window.addEventListener('pagehide', () => {
		generation++; feed.disconnect(); loadingOlder = false; older.disabled = true; older.textContent = 'Load older';
	});
	showDemo();
}
