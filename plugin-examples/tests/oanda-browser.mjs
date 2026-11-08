// Offline browser integration check. Requires a local Chromium executable.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import puppeteer from 'puppeteer';
const bar = (time, close = 1.35, complete = false) => ({ time, open: 1.34, high: 1.36, low: 1.33, close, volume: 42, complete });
let connections = [];
let historyCalls = 0;
const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost');
	const identity = { instrument: url.searchParams.get('instrument'), granularity: url.searchParams.get('granularity'), price: url.searchParams.get('price'), source: 'oanda', volumeKind: 'tick-count' };
	if (url.pathname.endsWith('/candles')) {
		historyCalls++;
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ...identity, candles: [bar(1699989200, 1.35, true)] })); return;
	}
	res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
	const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	connections.push({ emit, identity });
	if (identity.instrument === 'GBP_USD') { emit('status', { state: 'error', message: 'Configure private backend' }); res.end(); return; }
	emit('snapshot', { ...identity, candles: [bar(1700000000, 1.35, true), bar(1700010800)] });
	emit('status', { state: 'live', message: 'Offline fixture' });
});
await new Promise(resolve => server.listen(8765, '127.0.0.1', resolve));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'src/vite.config.js'], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
let browser;
try {
	for (let i = 0; i < 100; i++) {
		try { if ((await fetch('http://127.0.0.1:5173')).ok) break; } catch { /* Starting. */ }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	if (process.env.OANDA_BROWSER_HOLD === '1') { console.log('Offline QA server ready'); await new Promise(() => {}); }
	browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.setViewport({ width: 1440, height: 1050 });
	const errors = []; page.on('pageerror', error => errors.push(error.message));
	await page.goto('http://127.0.0.1:5173/src/octane-supercharts/index.html');
	await page.waitForSelector('.data-status[data-state="demo"]');
	await page.select('select[name="source"]', 'oanda'); await page.click('.market-data-controls button[type="submit"]');
	await page.waitForSelector('.data-status[data-state="live"]');
	assert.match(await page.$eval('#chart-stats', x => x.textContent), /1.3500/);
	connections.at(-1).emit('candle', bar(1700010800, 1.355, true));
	await page.waitForFunction(() => document.querySelector('#chart-stats').textContent.includes('1.3550'));
	await page.click('[data-action="older"]');
	await page.waitForFunction(() => document.querySelector('[data-action="older"]').textContent === 'Load older');
	assert.equal(historyCalls, 1);
	connections.at(-1).emit('status', { state: 'reconnecting', message: 'Repairing' });
	await page.waitForSelector('.data-status[data-state="reconnecting"]');
	connections.at(-1).emit('snapshot', { ...connections.at(-1).identity, candles: [bar(1700010800, 1.355, true), bar(1700021600)] });
	connections.at(-1).emit('status', { state: 'live', message: 'Repaired' });
	await page.waitForSelector('.data-status[data-state="live"]');
	await page.select('select[name="instrument"]', 'EUR_USD'); await page.select('select[name="granularity"]', 'D'); await page.select('select[name="price"]', 'B');
	await page.click('.market-data-controls button[type="submit"]'); await page.waitForFunction(() => document.querySelector('#chart-symbol').textContent === 'EURUSD');
	await page.waitForSelector('.data-status[data-state="live"]');
	assert.deepEqual(connections.at(-1).identity, { instrument: 'EUR_USD', granularity: 'D', price: 'B', source: 'oanda', volumeKind: 'tick-count' });
	await page.click('[data-action="disconnect"]'); await page.waitForSelector('.data-status[data-state="closed"]');
	await page.select('select[name="instrument"]', 'GBP_USD'); await page.click('.market-data-controls button[type="submit"]');
	await page.waitForSelector('.data-status[data-state="error"]');
	await page.select('select[name="source"]', 'demo'); await page.waitForSelector('.data-status[data-state="demo"]');
	assert.equal(await page.$eval('#chart-symbol', x => x.textContent), 'USDCAD');
	assert.deepEqual(errors, []);
	console.log('PASS: demo, snapshot, live revision, older paging, reconnect repair, symbol/interval/price change, disconnect, terminal error and demo recovery; no browser errors');
} finally {
	await browser?.close(); vite.kill('SIGTERM'); server.closeAllConnections(); server.close();
	await once(vite, 'exit').catch(() => {});
}
