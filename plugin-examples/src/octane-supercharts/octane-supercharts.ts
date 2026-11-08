import { attachOandaControls } from './oanda-controls';
import {
	CandlestickSeries,
	ColorType,
	createChart,
	type IChartApi,
	type ISeriesApi,
	type Time,
} from 'lightweight-charts';
import usdcad3h from './usdcad-3h.json';
import {
	RectangleDrawingTool,
	type RectangleDrawingRecord,
} from '../plugins/rectangle-drawing-tool/rectangle-drawing-tool';

type CandleRecord = {
	time: Time;
	open: number;
	high: number;
	low: number;
	close: number;
};

interface DrawingRepository {
	loadDrawings(): RectangleDrawingRecord[];
	createDrawing(record: RectangleDrawingRecord): void;
	updateDrawing(record: RectangleDrawingRecord): void;
	deleteDrawing(id: string): void;
	clear(): void;
}

class LocalRectangleRepository implements DrawingRepository {
	constructor(private readonly storageKey: string) {}

	loadDrawings(): RectangleDrawingRecord[] {
		const raw = window.localStorage.getItem(this.storageKey);
		if (!raw) return [];
		try {
			return JSON.parse(raw) as RectangleDrawingRecord[];
		} catch {
			return [];
		}
	}

	createDrawing(record: RectangleDrawingRecord): void {
		const drawings = this.loadDrawings().filter(item => item.id !== record.id);
		drawings.push(record);
		this.saveAll(drawings);
	}

	updateDrawing(record: RectangleDrawingRecord): void {
		this.createDrawing(record);
	}

	deleteDrawing(id: string): void {
		this.saveAll(this.loadDrawings().filter(item => item.id !== id));
	}

	clear(): void {
		window.localStorage.removeItem(this.storageKey);
	}

	private saveAll(drawings: RectangleDrawingRecord[]) {
		window.localStorage.setItem(this.storageKey, JSON.stringify(drawings));
	}
}

type OctaneState = {
	symbol: string;
	interval: string;
	selectedRectangleId: string | null;
	drawings: RectangleDrawingRecord[];
};

const headerGroups = {
	symbol: ['USDCAD', 'Compare', 'Data Type'],
	interval: ['3h', '4h', 'D', 'W', 'Interval'],
	style: ['Candles', 'Bar Style'],
	studies: ['Indicators', 'Favorites', 'Templates'],
	actions: ['Alert', 'Replay', 'Undo', 'Redo'],
	layout: ['FX Entry/Exit', 'Save', 'Layouts'],
	utilities: ['Quick Search', 'Settings', 'Fullscreen', 'Snapshot'],
	publish: ['Trade', 'Publish'],
};

const leftRailGroups = [
	{ label: 'Cursors', buttons: ['+', '⌖'] },
	{ label: 'Trend', buttons: ['／', '╱'] },
	{ label: 'Fib', buttons: ['𝑓', '∿'] },
	{ label: 'Patterns', buttons: ['◇', '⋔'] },
	{ label: 'Measure', buttons: ['⊿', '◫'] },
	{ label: 'Shapes', buttons: ['▭', '◯'] },
	{ label: 'Notes', buttons: ['T', '✎'] },
	{ label: 'Icons', buttons: ['★', '⚑'] },
	{ label: 'Zoom', buttons: ['⊕', '⊖'] },
	{ label: 'Draw', buttons: ['⌁', '🔒'] },
	{ label: 'Remove', buttons: ['⌫', '✕'] },
];

const rightRailItems = [
	'Watchlist',
	'Alerts',
	'Object tree',
	'Chats',
	'Pine',
	'Calendars',
	'News Flow',
	'Portfolio',
	'Fundamental Graphs',
	'Macro Maps',
	'Notifications',
	'Products',
	'Help Center',
];

const settingsSchema = [
	'Symbol',
	'Canvas',
	'Scales and lines',
	'Timezone',
	'Precision',
	'Background',
	'Grid lines',
	'Price labels',
	'Date format',
	'Time hours format',
];

const repository = new LocalRectangleRepository(
	'octane-supercharts:rectangle-drawings'
);

const state: OctaneState = {
	symbol: 'USDCAD',
	interval: '3h',
	selectedRectangleId: null,
	drawings: repository.loadDrawings(),
};

const chartElement = document.getElementById('chart') as HTMLDivElement;
const drawingToolbarElement = document.getElementById(
	'drawing-toolbar'
) as HTMLDivElement;
const chartStatsElement = document.getElementById('chart-stats') as HTMLDivElement;
const rectangleListElement = document.getElementById(
	'rectangle-list'
) as HTMLDivElement;

populateHeader();
populateLeftRail();
populateRightRail();
populateSettingsSchema();

const chart = createChart(chartElement, {
	layout: {
		background: { type: ColorType.Solid, color: 'rgba(255,255,255,0.18)' },
		textColor: '#3f3429',
		fontFamily: 'Trebuchet MS, Segoe UI, sans-serif',
	},
	grid: {
		vertLines: { color: 'rgba(166, 149, 131, 0.15)' },
		horzLines: { color: 'rgba(166, 149, 131, 0.15)' },
	},
	crosshair: {
		vertLine: { color: 'rgba(214, 90, 49, 0.35)' },
		horzLine: { color: 'rgba(214, 90, 49, 0.35)' },
	},
	rightPriceScale: {
		borderColor: 'rgba(166, 149, 131, 0.22)',
	},
	timeScale: {
		borderColor: 'rgba(166, 149, 131, 0.22)',
		timeVisible: true,
		secondsVisible: false,
	},
});

const series = chart.addSeries(CandlestickSeries, {
	upColor: '#2e8b57',
	downColor: '#ca4b36',
	borderVisible: true,
	wickUpColor: '#2e8b57',
	wickDownColor: '#ca4b36',
	borderUpColor: '#2e8b57',
	borderDownColor: '#ca4b36',
});

const sampleData = usdcad3h as CandleRecord[];
series.setData(sampleData);
chart.timeScale().fitContent();
renderStats(sampleData);
attachOandaControls(chart, series, sampleData, renderStats);

const rectangleTool = new RectangleDrawingTool(
	chart as IChartApi,
	series as ISeriesApi<'Candlestick'>,
	drawingToolbarElement,
	{
		showLabels: false,
		initialRectangles: state.drawings,
		onChange: rectangles => {
			state.drawings = rectangles;
			syncRepository(rectangles);
			renderRectangleList();
		},
	}
);

document
	.getElementById('clear-rectangles')
	?.addEventListener('click', () => {
		repository.clear();
		state.drawings = [];
		state.selectedRectangleId = null;
		rectangleTool.loadRectangles([]);
		renderRectangleList();
	});

window.addEventListener('resize', () => chart.resize(chartElement.clientWidth, 620));

renderRectangleList();

function populateHeader() {
	renderChipGroup('symbol-group', headerGroups.symbol);
	renderChipGroup('interval-group', headerGroups.interval, 'highlight');
	renderChipGroup('style-group', headerGroups.style);
	renderChipGroup('study-group', headerGroups.studies);
	renderChipGroup('action-group', headerGroups.actions);
	renderChipGroup('layout-group', headerGroups.layout);
	renderChipGroup('utility-group', headerGroups.utilities);
	renderChipGroup('publish-group', headerGroups.publish);
}

function renderChipGroup(id: string, chips: string[], variant = '') {
	const element = document.getElementById(id);
	if (!element) return;
	element.innerHTML = chips
		.map(
			chip =>
				`<span class="header-chip ${variant}">${chip}</span>`
		)
		.join('');
}

function populateLeftRail() {
	const container = document.getElementById('left-rail-groups');
	if (!container) return;
	container.innerHTML = leftRailGroups
		.map(
			group => `<section class="left-rail-group">
				${group.buttons
					.map(
						(button, index) =>
							`<button class="rail-button ${group.label === 'Shapes' && index === 0 ? 'active' : ''}" type="button">${button}</button>`
					)
					.join('')}
				<div class="left-rail-label">${group.label}</div>
			</section>`
		)
		.join('');
}

function populateRightRail() {
	const container = document.getElementById('right-rail-items');
	if (!container) return;
	container.innerHTML = rightRailItems
		.map(item => `<div class="rail-item">${item}</div>`)
		.join('');
}

function populateSettingsSchema() {
	const container = document.getElementById('settings-schema');
	if (!container) return;
	container.innerHTML = settingsSchema
		.map(item => `<span class="settings-pill">${item}</span>`)
		.join('');
}

function renderStats(data: CandleRecord[]) {
	const latest = data[data.length - 1];
	if (!latest) { chartStatsElement.textContent = 'No data'; return; }
	const previous = data[data.length - 2] ?? latest;
	const delta = latest.close - previous.close;
	const deltaPercent = previous.close === 0 ? 0 : (delta / previous.close) * 100;
	chartStatsElement.innerHTML = [
		`O ${latest.open.toFixed(4)}`,
		`H ${latest.high.toFixed(4)}`,
		`L ${latest.low.toFixed(4)}`,
		`C ${latest.close.toFixed(4)}`,
		`${delta >= 0 ? '+' : ''}${delta.toFixed(4)} (${deltaPercent.toFixed(2)}%)`,
	]
		.map(value => `<span class="header-chip">${value}</span>`)
		.join('');
}

function syncRepository(rectangles: RectangleDrawingRecord[]) {
	const currentIds = new Set(rectangles.map(item => item.id));
	const existingIds = new Set(repository.loadDrawings().map(item => item.id));
	rectangles.forEach(record => {
		if (existingIds.has(record.id)) {
			repository.updateDrawing(record);
		} else {
			repository.createDrawing(record);
		}
	});
	existingIds.forEach(id => {
		if (!currentIds.has(id)) {
			repository.deleteDrawing(id);
		}
	});
}

function renderRectangleList() {
	if (state.drawings.length === 0) {
		rectangleListElement.innerHTML =
			'<div class="empty-state">No local rectangles yet. Use the shape tool chip to create one on the chart.</div>';
		return;
	}

	rectangleListElement.innerHTML = state.drawings
		.map(record => {
			const selected = state.selectedRectangleId === record.id ? 'selected' : '';
			return `<article class="rectangle-card ${selected}" data-id="${record.id}">
				<div class="rectangle-card-header">
					<strong>${record.id}</strong>
					<div class="rectangle-actions">
						<button type="button" data-action="select" data-id="${record.id}">Select</button>
						<button type="button" data-action="delete" data-id="${record.id}">Delete</button>
					</div>
				</div>
				<div class="rectangle-meta">
					<div>${formatPoint(record.p1)} → ${formatPoint(record.p2)}</div>
					<div>Fill: ${record.options.fillColor ?? 'default'}</div>
				</div>
			</article>`;
		})
		.join('');

	rectangleListElement
		.querySelectorAll<HTMLButtonElement>('button[data-action]')
		.forEach(button => {
			button.addEventListener('click', () => {
				const id = button.dataset.id!;
				const action = button.dataset.action;
				if (action === 'select') {
					state.selectedRectangleId = id;
					renderRectangleList();
				}
				if (action === 'delete') {
					if (state.selectedRectangleId === id) {
						state.selectedRectangleId = null;
					}
					rectangleTool.removeRectangle(id);
				}
			});
		});
}

function formatPoint(point: RectangleDrawingRecord['p1']) {
	return `${String(point.time)} @ ${point.price.toFixed(4)}`;
}
