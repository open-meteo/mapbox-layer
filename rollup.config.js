import fs from 'fs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export const nodeResolve = resolve({
	browser: true,
	preferBuiltins: false
});

const create = (file, format, plugins = []) => ({
	input: 'build/mblayer.js',
	output: {
		name: 'OpenMeteoMapboxLayer',
		file,
		format
		// intro: fs.readFileSync('build/bundle_prelude.js', 'utf8')
	},
	treeshake: false,
	plugins
});

/** @type {import('rollup').RollupOptions[]} */
export default [
	{
		external: ['@openmeteo/file-reader', '@openmeteo/file-format-wasm'],
		input: {
			index: 'src/index.ts',
			worker: 'src/worker.ts'

			// 'worker-pool': 'src/worker-pool.ts',
			// 'om-protocol': 'src/om-protocol.ts',
			// 'om-file-reader': 'src/om-protocol.ts',

			// 'utils/math': 'src/utils/math.ts',
			// 'utils/index': 'src/utils/index.ts',
			// 'utils/domains': 'src/utils/domains.ts',
			// 'utils/variables': 'src/utils/variables.ts',
			// 'utils/projections': 'src/utils/projections.ts',
			// 'utils/color-scales': 'src/utils/color-scales.ts',
			// 'utils/interpolations': 'src/utils/interpolations.ts'
		},
		output: {
			dir: 'dist/staging',
			format: 'amd',
			indent: false,
			chunkFileNames: 'shared.js',
			minifyInternalExports: true
		},
		onwarn: (message) => {
			console.error(message);
			throw message;
		},
		treeshake: true, // was true
		plugins: [nodeResolve, typescript(), commonjs()]
	},
	create('dist/index.cjs', 'cjs'),
	create('dist/index.mjs', 'esm'),
	create('dist/index.js', 'umd')
	// create('dist/index.min.js', 'umd', [terser()])
];
