// End-to-end synthetic Python export -> existing Octane shell. No broker requests.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer';

if (!process.env.OCTANE_CORE_PATH) throw new Error('Set OCTANE_CORE_PATH to the private core checkout containing the HLC3 change');
const core = resolve(process.env.OCTANE_CORE_PATH);
const temp = await mkdtemp(join(tmpdir(), 'octane-replay-'));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'src/vite.config.js', '--port', '5174'], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
let browser;
try {
	for (const [name, cutoff] of [['preview', '2026-11-07T00:01:30Z'], ['final', '2026-11-07T00:02:00Z']]) {
		const out = spawnSync(process.env.PYTHON || 'python3', ['-m', 'indicators.chart_cli', 'tests/fixtures/replay_synthetic.jsonl', '--source', 'hlc3', '--as-of', cutoff, '--policy', 'include_provisional'], { cwd: core, encoding: 'utf8' });
		assert.equal(out.status, 0, out.stderr);
		await writeFile(join(temp, name + '.json'), out.stdout);
	}
	await writeFile(join(temp, 'invalid.txt'), '{"candles":[],"synthetic":false}');
	await writeFile(join(temp, 'oversized.txt'), ' '.repeat(5 * 1024 * 1024 + 1));
	for (let i = 0; i < 100; i++) {
		try { if ((await fetch('http://127.0.0.1:5174')).ok) break; } catch { /* Starting. */ }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage(); const errors = []; const apiRequests = [];
	page.on('pageerror', e => errors.push(e.message));
	page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) apiRequests.push(r.url()); });
	for (const width of [1440, 430]) {
		await page.setViewport({ width, height: 1000 });
		await page.goto('http://127.0.0.1:5174/src/octane-supercharts/index.html');
		await page.waitForSelector('.data-status[data-state="demo"]');
		await page.select('select[name="source"]', 'replay');
		const file = await page.$('input[name="replay-file"]');
		await file.uploadFile(join(temp, 'preview.json'));
		await page.waitForFunction(() => document.querySelector('.data-detail').textContent.includes('1 provisional'));
		assert.match(await page.$eval('#chart-stats', e => e.textContent), /25\.0000/);
		assert.equal(await page.$eval('.chart-exchange', e => e.textContent), 'SYNTHETIC');
		assert.equal(await page.$eval('[data-action="older"]', e => e.disabled), true);
		await file.uploadFile(join(temp, 'final.json'));
		await page.waitForFunction(() => document.querySelector('.data-detail').textContent.includes('0 provisional'));
		assert.match(await page.$eval('#chart-stats', e => e.textContent), /20\.0000/);
		assert.match(await page.$eval('.data-detail', e => e.textContent), /2 candles.*HLC3/);
		await page.click('[name="replay-vwap"]'); await page.click('[name="replay-bands"]');
		await file.uploadFile(join(temp, 'invalid.txt'));
		await page.waitForSelector('.data-status[data-state="error"]');
		assert.match(await page.$eval('#chart-stats', e => e.textContent), /20\.0000/);
		await file.uploadFile(join(temp, 'oversized.txt'));
		await page.waitForFunction(() => document.querySelector('.data-status').textContent.includes('Could not load'));
		await page.select('select[name="source"]', 'demo');
		await page.waitForSelector('.data-status[data-state="demo"]');
		assert.equal(await page.$eval('.replay-indicators', e => e.hidden), true);
		assert.equal(await page.$eval('.replay-file', e => getComputedStyle(e).display), 'none');
		await page.select('select[name="source"]', 'replay');
		await file.uploadFile(join(temp, 'final.json'));
		await page.waitForFunction(() => document.querySelector('.data-detail').textContent.includes('2 candles'));
		if (process.env.OCTANE_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.OCTANE_SCREENSHOT_DIR, `octane-replay-${width}.png`), fullPage: true });
	}
	assert.deepEqual(apiRequests, []); assert.deepEqual(errors, []);
	console.log('PASS: synthetic Python HLC3 export, preview/final replacement, indicator toggles, invalid/oversized rejection, demo recovery, desktop/mobile Chromium viewports; no API requests or browser errors');
} finally {
	await browser?.close(); vite.kill('SIGTERM');
	if (vite.exitCode === null) await once(vite, 'exit').catch(() => {});
	await rm(temp, { recursive: true, force: true });
}
