import typescript from 'rollup-plugin-typescript2';
import dts from 'rollup-plugin-dts';
import webWorkerLoader from 'rollup-plugin-web-worker-loader';

const input = {
	index: 'src/index.ts',
	types: 'src/types.ts',
	'om-protocol': 'src/om-protocol.ts',
	worker: 'src/worker.ts',
	'worker-pool': 'src/worker-pool.ts',
	'om-file-reader': 'src/om-protocol.ts',
	'utils/arrow': 'src/utils/arrow.ts',
	'utils/color-scales': 'src/utils/color-scales.ts',
	'utils/domains': 'src/utils/domains.ts',
	'utils/icons': 'src/utils/icons.ts',
	'utils/index': 'src/utils/index.ts',
	'utils/interpolations': 'src/utils/interpolations.ts',
	'utils/math': 'src/utils/math.ts',
	'utils/projections': 'src/utils/projections.ts',
	'utils/variables': 'src/utils/variables.ts'
};

const external = ['@openmeteo/file-reader', '@openmeteo/file-format-wasm'];

export default [
	// JS build
	{
		input,
		output: {
			dir: 'dist',
			format: 'esm',
			entryFileNames: '[name].js',
			chunkFileNames: '[name].js',
			assetFileNames: '[name].[ext]'
		},
		external: external,
		plugins: [
			typescript({
				tsconfig: './tsconfig.json',
				useTsconfigDeclarationDir: true
			}),
			webWorkerLoader({
				inline: false,
				targetPlatform: 'browser'
			})
		],
		preserveEntrySignatures: 'strict'
	},
	// CJS build for main entry only
	{
		input: 'src/index.ts',
		output: {
			file: 'dist/index.cjs',
			format: 'cjs',
			exports: 'named'
		},
		plugins: [
			typescript({
				tsconfig: './tsconfig.json',
				useTsconfigDeclarationDir: true
			})
		]
	},

	// UMD build for main entry only
	{
		input: 'src/index.ts',
		output: {
			file: 'dist/index.umd.js',
			format: 'umd',
			name: 'OpenMeteoMapboxLayer', // global variable name for UMD
			exports: 'named',
			globals: {
				'@openmeteo/file-reader': 'OpenMeteoFileReader',
				'@openmeteo/file-format-wasm': 'OpenMeteoFileFormatWasm'
			}
		},
		plugins: [
			typescript({
				tsconfig: './tsconfig.json',
				useTsconfigDeclarationDir: true
			})
		]
	},
	// DTS build
	{
		input: 'src/index.ts',
		output: {
			file: 'dist/index.d.ts',
			format: 'es'
		},
		plugins: [dts()]
	}
];
