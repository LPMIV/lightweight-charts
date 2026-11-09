import { LineSeries, type IChartApi, type LineData, type WhitespaceData, type UTCTimestamp } from 'lightweight-charts';

type Point = LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;
type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
type ObjectValue = Record<string, unknown>;
export interface ReplaySnapshot {
	asOf: string | null;
	evidence: 'synthetic' | 'recorded-snapshot';
	priceBasis: string;
	anchorPolicy: string;
	policy: 'finalized' | 'include_provisional';
	source: 'close' | 'hlc3';
	instrument: string;
	timeframe: string;
	provisional: number;
	series: { candles: Candle[]; vwap: Point[]; upper: Point[]; lower: Point[] };
}
export const REPLAY_MAX_BYTES = 5 * 1024 * 1024;
const invalid = () => new Error('Invalid Python chart snapshot');
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
/** Accept explicit Python synthetic/recorded contracts. Raw broker/Juno files require private normalization. */
export function parseReplaySnapshot(value: unknown): ReplaySnapshot {
	const p = object(value);
	const recorded = p.adapter === 'oanda-juno-recorded-chart/1';
	if (p.schema_version !== 1 || (!recorded && (p.adapter !== 'synthetic-offline-chart/1' || p.synthetic !== true)) ||
		p.implementation !== 'offline-vwap-reference/2' || p.profile !== 'reference-not-pine-parity' || p.units !== 'price') throw invalid();
	if (recorded && (p.synthetic !== false || p.evidence !== 'recorded-snapshot' || p.as_of !== null ||
		p.observation_timing !== 'unobserved' || p.environment !== 'practice' || p.initial_partial_period !== true ||
		p.warmup !== 'available-capture-only' || typeof p.capture_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.capture_sha256))) throw invalid();
	if (recorded) {
		// This is capture start metadata, never a receipt timestamp or cutoff.
		if (typeof p.capture_started_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(p.capture_started_at)) throw invalid();
		utc(p.capture_started_at.slice(0, 19) + '.000000Z');
	}
	if (p.policy !== 'finalized' && p.policy !== 'include_provisional') throw invalid();
	const asOf = recorded ? null : utc(p.as_of);
	const config = object(p.config);
	if (config.source !== 'close' && config.source !== 'hlc3') throw invalid();
	if (config.mode !== 'anchored' && config.mode !== 'rolling') throw invalid();
	if (typeof config.anchor_offset !== 'boolean' || finite(config.multiplier) < 0 ||
		(config.mode === 'anchored' ? config.window !== null :
			!Number.isSafeInteger(config.window) || (config.window as number) < 1 || config.anchor_offset)) throw invalid();
	if (recorded && (config.anchor_offset || p.anchor_policy !== (config.mode === 'anchored' ? 'capture-window' : 'rolling-bars'))) throw invalid();
	const s = object(p.series);
	if (!Array.isArray(s.candles) || s.candles.length > 5000 || !Array.isArray(p.availability) || p.availability.length !== s.candles.length) throw invalid();
	const candles: Candle[] = s.candles.map(raw => {
		const c = object(raw);
		const candle = { time: time(c.time), open: finite(c.open), high: finite(c.high), low: finite(c.low), close: finite(c.close) };
		if (candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close)) throw invalid();
		if (recorded && candle.time % 60 !== 0) throw invalid();
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
		if (recorded) {
			if (a.available_at !== null || a.revision !== null || !Number.isSafeInteger(a.volume) || (a.volume as number) < 0) throw invalid();
		} else {
			const available = utc(a.available_at);
			if (available > asOf! || Date.parse(available) < candles[i].time * 1000 ||
				!Number.isSafeInteger(a.revision) || (a.revision as number) < 0) throw invalid();
		}
		if (time(a.time) !== candles[i].time ||
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
	if (stream && (recorded ? stream.provider !== 'oanda' || stream.timeframe !== 'M1' ||
		!['mid', 'bid', 'ask'].includes(stream.price_basis as string) || stream.volume_semantics !== 'tick_count' :
		stream.provider !== 'synthetic' || stream.price_basis !== 'synthetic' || stream.volume_semantics !== 'synthetic')) throw invalid();
	if (recorded && !stream) throw invalid();
	if (recorded && (typeof stream!.instrument !== 'string' || !/^[A-Z]{3}_[A-Z]{3}$/.test(stream!.instrument))) throw invalid();
	return { asOf, evidence: recorded ? 'recorded-snapshot' : 'synthetic', priceBasis: stream ? label(stream.price_basis) : '-',
		anchorPolicy: recorded ? p.anchor_policy as string : 'caller-supplied',
		policy: p.policy, source: config.source, instrument: stream ? label(stream.instrument) : 'EMPTY',
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
