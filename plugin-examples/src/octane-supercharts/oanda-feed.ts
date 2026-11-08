/** Credential-free browser protocol. All broker access stays in private core. */
export interface MarketQuery { instrument: string; granularity: string; price: 'M' | 'B' | 'A'; }
export interface MarketCandle { time: number; open: number; high: number; low: number; close: number; volume: number; complete: boolean; }
export type FeedState = 'loading' | 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error';
interface Stream {
	addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
	onerror: ((event: Event) => void) | null;
	close(): void;
}
interface Transport { fetch: typeof fetch; stream: (url: string) => Stream; }
interface Events {
	onData: (candles: MarketCandle[], reason: 'snapshot' | 'reset' | 'candle' | 'history') => void;
	onStatus: (state: FeedState, message: string) => void;
}
const states = new Set<FeedState>(['connecting', 'live', 'reconnecting', 'closed', 'error']);
const intervals = new Set(['M1', 'M5', 'M15', 'H1', 'H3', 'H4', 'D', 'W']);
export function validateCandle(value: unknown): MarketCandle {
	if (!value || typeof value !== 'object') throw new Error('Invalid candle');
	const c = value as MarketCandle;
	if (!Number.isSafeInteger(c.time) || c.time < 0 || c.time > 32503680000 ||
		!Number.isSafeInteger(c.volume) || c.volume < 0 || typeof c.complete !== 'boolean' ||
		![c.open, c.high, c.low, c.close].every(Number.isFinite) ||
		c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) throw new Error('Invalid candle');
	return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, complete: c.complete };
}
export function mergeCandles(existing: MarketCandle[], incoming: MarketCandle[]): MarketCandle[] {
	const rows = new Map(existing.map(c => [c.time, c]));
	for (const raw of incoming) {
		const candle = validateCandle(raw);
		if (!rows.get(candle.time)?.complete || candle.complete) rows.set(candle.time, candle);
	}
	return [...rows.values()].sort((a, b) => a.time - b.time);
}
export class OandaFeed {
	private generation = 0;
	private source: Stream | null = null;
	private historyRequest: AbortController | null = null;
	private query: MarketQuery | null = null;
	private candles: MarketCandle[] = [];
	private exhausted = false;
	private gotSnapshot = false;
	private live = false;
	private stale = false;
	private watchdog: ReturnType<typeof setInterval> | null = null;
	private lastMessage = 0;
	constructor(private readonly events: Events, private readonly transport: Transport = {
		fetch: (...args) => fetch(...args), stream: url => new EventSource(url),
	}) {}
	connect(query: MarketQuery): void {
		this.disconnect(false);
		if (!/^[A-Z0-9]{2,12}_[A-Z0-9]{2,12}$/.test(query.instrument) || !intervals.has(query.granularity) || !['M', 'B', 'A'].includes(query.price)) {
			this.events.onStatus('error', 'Unsupported selection'); return;
		}
		this.query = { ...query }; this.candles = []; this.exhausted = false; this.gotSnapshot = false;
		this.events.onData([], 'snapshot'); this.events.onStatus('loading', 'Loading OANDA historical candles');
		const generation = this.generation;
		const current = () => generation === this.generation;
		const source = this.transport.stream(this.url('stream')); this.source = source;
		this.lastMessage = Date.now();
		const listen = (name: string, handler: (data: unknown) => void) => source.addEventListener(name, event => {
			if (!current()) return;
			this.lastMessage = Date.now();
			try {
				handler(JSON.parse(event.data));
				if (current() && this.stale && this.live) {
					this.stale = false; this.events.onStatus('live', 'Connection resumed; OANDA REST candles are updating.');
				}
			} catch {
				this.disconnect(false); this.events.onStatus('error', 'Invalid market data response. Reconnect to retry.');
			}
		});
		listen('snapshot', data => {
			const incoming = this.readEnvelope(data);
			const last = this.candles.at(-1);
			// No overlap means paging from the old oldest bar cannot fill the interior gap.
			// Reset to the recent segment, making backward history paging contiguous again.
			const reset = Boolean(last && incoming.length && Math.min(...incoming.map(c => c.time)) > last.time);
			this.candles = mergeCandles(reset ? [] : this.candles, incoming); this.gotSnapshot = true;
			if (reset) { this.exhausted = false; this.historyRequest?.abort(); this.historyRequest = null; }
			this.events.onData([...this.candles], reset ? 'reset' : 'snapshot');
		});
		listen('candle', data => {
			if (!this.gotSnapshot) throw new Error('Missing snapshot');
			this.candles = mergeCandles(this.candles, [validateCandle(data)]);
			this.events.onData([...this.candles], 'candle');
		});
		listen('heartbeat', () => { /* Liveness only. */ });
		listen('status', data => {
			const s = data as { state: FeedState; message: string };
			if (!states.has(s.state) || typeof s.message !== 'string' || (s.state === 'live' && !this.gotSnapshot)) throw new Error('Invalid status');
			this.live = s.state === 'live'; this.events.onStatus(s.state, s.message.slice(0, 240));
			if (s.state === 'error' || s.state === 'closed') this.disconnect(false);
		});
		source.onerror = () => {
			if (!current()) return;
			this.live = false; this.events.onStatus('reconnecting', 'Connection interrupted. Retrying with historical gap repair.');
		};
		this.watchdog = setInterval(() => {
			if (current() && Date.now() - this.lastMessage > 20000) {
				this.stale = true; this.events.onStatus('reconnecting', 'No recent update. Displayed candles may be stale.');
			}
		}, 5000);
	}
	async loadOlder(): Promise<boolean> {
		if (!this.query || !this.candles.length || this.historyRequest || this.exhausted) return false;
		const generation = this.generation; const before = this.candles[0].time;
		const request = new AbortController(); this.historyRequest = request;
		try {
			const response = await this.transport.fetch(this.url('candles', before), { signal: request.signal, credentials: 'same-origin' });
			if (!response.ok) throw new Error('History unavailable');
			const data: unknown = await response.json();
			if (generation !== this.generation || request.signal.aborted) return false;
			const older = this.readEnvelope(data).filter(c => c.time < before); this.exhausted = older.length === 0;
			this.candles = mergeCandles(older, this.candles); this.events.onData([...this.candles], 'history');
			return older.length > 0;
		} catch {
			if (generation === this.generation && !request.signal.aborted) this.events.onStatus(this.live ? 'live' : 'reconnecting', 'Could not load older candles. Retry Load older.');
			return false;
		} finally { if (this.historyRequest === request) this.historyRequest = null; }
	}
	disconnect(notify = true): void {
		this.generation++; this.source?.close(); this.source = null;
		this.historyRequest?.abort(); this.historyRequest = null; this.live = false; this.stale = false;
		if (this.watchdog) clearInterval(this.watchdog); this.watchdog = null;
		if (notify) this.events.onStatus('closed', 'Disconnected. Displayed candles are no longer updating.');
	}
	private url(endpoint: string, before?: number): string {
		const params = new URLSearchParams({ ...this.query!, count: '500' });
		if (before !== undefined) params.set('before', String(before));
		return `/api/oanda/${endpoint}?${params}`;
	}
	private readEnvelope(data: unknown): MarketCandle[] {
		const p = data as MarketQuery & { candles: unknown[]; source: string; volumeKind: string };
		if (!p || !this.query || p.instrument !== this.query.instrument || p.granularity !== this.query.granularity || p.price !== this.query.price ||
			p.source !== 'oanda' || p.volumeKind !== 'tick-count' || !Array.isArray(p.candles) || p.candles.length > 5000) throw new Error('Wrong dataset');
		return p.candles.map(validateCandle);
	}
}
