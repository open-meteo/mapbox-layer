import dts from 'unplugin-dts/rolldown';
import { type Plugin, defineConfig } from 'vite';

/**
 * The decode worker bundles @openmeteo/file-format-wasm (externals cannot
 * stay external inside an inline worker), whose loader locates its .wasm via
 * `new URL("om_reader_wasm.web.wasm", import.meta.url)`. Inside a blob-URL
 * worker that base is `blob:` and the constructor throws — and the emitted
 * `/assets/...` path would not exist on a consumer's server anyway. Rewrite
 * it to a URL the host injects at worker init (FileReaderConfig
 * .workerWasmUrl); without one the first read fails and the client falls
 * back to main-thread decoding.
 */
const injectedWorkerWasmUrl = (): Plugin => ({
	name: 'om-injected-worker-wasm-url',
	transform(code, id) {
		if (!id.includes('om_reader_wasm.web.js')) return;
		return code.replace(
			'new URL("om_reader_wasm.web.wasm",import.meta.url)',
			'new URL(self.__OM_WASM_URL__)'
		);
	}
});

export default defineConfig({
	plugins: [
		injectedWorkerWasmUrl(),
		dts({
			exclude: ['src/tests'],
			entryRoot: 'src',
			insertTypesEntry: true
		})
	],
	worker: {
		plugins: () => [injectedWorkerWasmUrl()]
	},
	optimizeDeps: {
		exclude: ['@openmeteo/file-reader', '@openmeteo/file-format-wasm']
	},
	build: {
		chunkSizeWarningLimit: 1200,
		rolldownOptions: {
			external: ['@openmeteo/file-reader', '@openmeteo/file-format-wasm'],
			input: {
				index: 'src/index.ts'
			},
			output: {
				entryFileNames: `[name].mjs`
			},
			preserveEntrySignatures: 'strict'
		}
	}
});
