function generateBar(i, target) {
	const step = (i % 20) / 1000;
	const base = i / 5;
	target.open = base * (1 - step);
	target.high = base * (1 + 2 * step);
	target.low = base * (1 - 2 * step);
	target.close = base * (1 + step);
}

function generateData() {
	const res = [];
	const time = new Date(Date.UTC(2018, 0, 1, 0, 0, 0, 0));
	for (let i = 0; i < 500; ++i) {
		const item = {
			time: time.getTime() / 1000,
		};
		time.setUTCDate(time.getUTCDate() + 1);

		generateBar(i, item);
		res.push(item);
	}
	return res;
}

function runTestCase(container) {
	const chart = window.chart = LightweightCharts.createChart(
		container,
		{
			layout: {
				fontSize: 20,
				attributionLogo: false,
			},
		}
	);

	const mainSeries = chart.addSeries(LightweightCharts.BarSeries);

	const data = generateData();
	mainSeries.setData(data);
	LightweightCharts.createSeriesMarkers(
		mainSeries,
		[
			{ time: data[data.length - 50].time, position: 'belowBar', color: 'red', shape: 'arrowUp', text: 'test' },
			{ time: data[data.length - 50].time, position: 'belowBar', color: 'red', shape: 'arrowDown', text: 'test' },
			{ time: data[data.length - 50].time, position: 'belowBar', color: 'red', shape: 'circle', text: 'test' },
			{ time: data[data.length - 50].time, position: 'belowBar', color: 'red', shape: 'square', text: 'test' },
			{ time: data[data.length - 40].time, position: 'aboveBar', color: 'red', shape: 'arrowUp', text: 'test' },
			{ time: data[data.length - 40].time, position: 'aboveBar', color: 'red', shape: 'arrowDown', text: 'test' },
			{ time: data[data.length - 40].time, position: 'aboveBar', color: 'red', shape: 'circle', text: 'test' },
			{ time: data[data.length - 40].time, position: 'aboveBar', color: 'red', shape: 'square', text: 'test' },
			{ time: data[data.length - 30].time, position: 'inBar', color: 'blue', shape: 'arrowUp', text: 'test' },
			{ time: data[data.length - 30].time, position: 'inBar', color: 'blue', shape: 'arrowDown', text: 'test' },
			{ time: data[data.length - 30].time, position: 'inBar', color: 'blue', shape: 'circle', text: 'test' },
			{ time: data[data.length - 30].time, position: 'inBar', color: 'blue', shape: 'square', text: 'test' },
			{ time: data[data.length - 20].time, position: 'belowBar', color: 'aqua', shape: 'square', text: 'test', size: 0 },
			{ time: data[data.length - 20].time, position: 'belowBar', color: 'aqua', shape: 'square', text: 'test', size: 1 },
			{ time: data[data.length - 20].time, position: 'belowBar', color: 'aqua', shape: 'square', text: 'test', size: 2 },
			{ time: data[data.length - 20].time, position: 'belowBar', color: 'aqua', shape: 'square', text: 'test', size: 3 },
			{ time: data[data.length - 10].time, position: 'aboveBar', color: 'aqua', shape: 'cricle', text: '', size: 0 },
			{ time: data[data.length - 10].time, position: 'aboveBar', color: 'aqua', shape: 'cricle', text: '', size: 1 },
			{ time: data[data.length - 10].time, position: 'aboveBar', color: 'aqua', shape: 'cricle', text: '', size: 2 },
			{ time: data[data.length - 10].time, position: 'aboveBar', color: 'aqua', shape: 'cricle', text: '', size: 3 },
		]
	);
}
