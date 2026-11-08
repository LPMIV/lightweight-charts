import { resolve } from 'path';
import { defineConfig } from 'vite';
import { globby } from 'globby';

const paths = (await globby(['./src/**/*.html'])).map(path =>
	path.replace('./src/', '')
);

const input = {
	main: resolve(__dirname, '../index.html'),
};

let count = 0;
paths.forEach(p => {
	input[count++] = resolve(__dirname, p);
});

export default defineConfig({
	base: './',
	server: {
		host: '127.0.0.1', port: 5173, strictPort: true,
		proxy: { '/api/oanda': { target: 'http://127.0.0.1:8765', changeOrigin: true } },
	},
	build: {
		rollupOptions: {
			input,
		},
	},
});
