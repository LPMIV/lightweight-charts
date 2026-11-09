import { LineSeries, type IChartApi, type LineData, type WhitespaceData, type UTCTimestamp } from 'lightweight-charts';

type Point = LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;
type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
type ObjectValue = Record<string, unknown>;
export interface ReplaySnapshot {
	asOf: string;
	policy: 'finalized' | 'include_provisional';
	source: 'close' | 'hlc3';
	instrument: string;
	timeframe: string;
	provisional: number;
	series: { candles: Candle[]; vwap: Point[]; upper: Point[]; lower: Point[] };
}
export const REPLAY_MAX_BYTES = 5 * 1024 * 1024;
const invalid = () => new Error('Invalid synthetic Python chart snapshot');
function object(value: unknown): ObjectValue {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
	return value as ObjectValue;
}
function utc(value: unknown): string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) throw invalid();
	const milliseconds = value.slice(0, 23) + 'Z';
	if (!Number.isFinite(Date.parse(milliseconds)) || new Date(milliseconds).toISOString() !== milliseconds) throw invalid();
	return value;
}
function time(value: unknown): UTCTimestamp {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 32503680000) throw invalid();
	return value as UTCTimestamp;
}
function finite(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
	return value;
}
function label(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_:./-]{1,40}$/.test(value)) throw invalid();
	return value;
}
/** Accept the existing Python synthetic adapter only. Raw broker/Juno files are not this schema. */
export function parseReplaySnapshot(value: unknown): ReplaySnapshot {
	const p = object(value);
	if (p.schema_version !== 1 || p.adapter !== 'synthetic-offline-chart/1' || p.synthetic !== true ||
		p.implementation !== 'offline-vwap-reference/2' || p.profile !== 'reference-not-pine-parity' || p.units !== 'price') throw invalid();
	if (p.policy !== 'finalized' && p.policy !== 'include_provisional') throw invalid();
	const asOf = utc(p.as_of);
	const config = object(p.config);
	if (config.source !== 'close' && config.source !== 'hlc3') throw invalid();
	if (config.mode !== 'anchored' && config.mode !== 'rolling') throw invalid();
	if (typeof config.anchor_offset !== 'boolean' || finite(config.multiplier) < 0 ||
		(config.mode === 'anchored' ? config.window !== null :
			!Number.isSafeInteger(config.window) || (config.window as number) < 1 || config.anchor_offset)) throw invalid();
	const s = object(p.series);
	if (!Array.isArray(s.candles) || s.candles.length > 5000 || !Array.isArray(p.availability) || p.availability.length !== s.candles.length) throw invalid();
	const candles: Candle[] = s.candles.map(raw => {
		const c = object(raw);
		const candle = { time: time(c.time), open: finite(c.open), high: finite(c.high), low: finite(c.low), close: finite(c.close) };
		if (candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close)) throw invalid();
		return candle;
	});
	if (candles.some((c, i) => i > 0 && c.time <= candles[i - 1].time)) throw invalid();
	const line = (name: string): Point[] => {
		const rows = s[name];
		if (!Array.isArray(rows) || rows.length !== candles.length) throw invalid();
		return rows.map((raw, i) => {
			const point = object(raw);
			if (time(point.time) !== candles[i].time) throw invalid();
			return 'value' in point ? { time: candles[i].time, value: finite(point.value) } : { time: candles[i].time };
		});
	};
	const vwap = line('vwap'); const upper = line('upper'); const lower = line('lower');
	let provisional = 0;
	p.availability.forEach((raw, i) => {
		const a = object(raw);
		const available = utc(a.available_at);
		if (time(a.time) !== candles[i].time || available > asOf || Date.parse(available) < candles[i].time * 1000 ||
			!Number.isSafeInteger(a.revision) || (a.revision as number) < 0 ||
			(a.status !== 'finalized' && a.status !== 'provisional') || typeof a.indicator_available !== 'boolean') throw invalid();
		if (a.status === 'provisional') {
			provisional++;
			if (p.policy === 'finalized' || i !== candles.length - 1) throw invalid();
		}
		const center = vwap[i]; const hi = upper[i]; const lo = lower[i];
		if (a.indicator_available !== ('value' in center) || ('value' in center) !== ('value' in hi) || ('value' in center) !== ('value' in lo)) throw invalid();
		if ('value' in center && 'value' in hi && 'value' in lo && !(lo.value <= center.value && center.value <= hi.value)) throw invalid();
	});
	const stream = p.stream === null && candles.length === 0 ? null : object(p.stream);
	if (stream && (stream.provider !== 'synthetic' || stream.price_basis !== 'synthetic' || stream.volume_semantics !== 'synthetic')) throw invalid();
	return { asOf, policy: p.policy, source: config.source, instrument: stream ? label(stream.instrument) : 'EMPTY',
		timeframe: stream ? label(stream.timeframe) : '-', provisional, series: { candles, vwap, upper, lower } };
}

/** Python computes all values; the browser only displays validated series arrays. */
export function createReplayLines(chart: IChartApi): { apply: (snapshot: ReplaySnapshot) => void; clear: () => void; visible: (center: boolean, bands: boolean) => void } {
	const options = { priceLineVisible: false, lastValueVisible: false, lineWidth: 2 as const };
	const vwap = chart.addSeries(LineSeries, { ...options, color: '#d65a31', title: 'Python VWAP' });
	const upper = chart.addSeries(LineSeries, { ...options, color: '#7a6aa3', title: 'Python upper' });
	const lower = chart.addSeries(LineSeries, { ...options, color: '#7a6aa3', title: 'Python lower' });
	return {
		apply: snapshot => { vwap.setData(snapshot.series.vwap); upper.setData(snapshot.series.upper); lower.setData(snapshot.series.lower); },
		clear: () => { vwap.setData([]); upper.setData([]); lower.setData([]); },
		visible: (center, bands) => { vwap.applyOptions({ visible: center }); upper.applyOptions({ visible: bands }); lower.applyOptions({ visible: bands }); },
	};
}
