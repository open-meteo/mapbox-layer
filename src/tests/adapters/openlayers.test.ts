/**
 * Unit tests for the OpenLayers adapter (addOpenLayersProtocolSupport).
 *
 * These tests exercise the adapter's public API in isolation using a minimal
 * mock of the OpenLayers library surface — no real OL dependency required.
 */
import type { OlLib } from '../../adapters/openlayers';
import { addOpenLayersProtocolSupport } from '../../adapters/openlayers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Shape of the mock DataTile/VectorTile instances so tests can inspect stored state. */
interface MockSourceInstance {
	_options: Record<string, unknown>;
	_attributions: string | null;
	_listeners: Map<string, ((...args: unknown[]) => void)[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal fake AbortSignal that can be aborted on demand. */
function makeSignal(): { signal: AbortSignal; abort: () => void } {
	const ac = new AbortController();
	return { signal: ac.signal, abort: () => ac.abort() };
}

/** Convenience: OL loader options with a live, non-aborted signal. */
function loaderOpts(): { signal: AbortSignal } {
	return { signal: makeSignal().signal };
}

/** Construct a minimal mock of the OpenLayers namespace. */
function createMockOl(): OlLib {
	class MockDataTile {
		_options: Record<string, unknown>;
		_attributions: string | null = null;

		constructor(options: Record<string, unknown>) {
			this._options = options;
		}

		setAttributions(attr: string) {
			this._attributions = attr;
		}
	}

	class MockVectorTile {
		_options: Record<string, unknown>;
		_attributions: string | null = null;
		_tileGrid = {
			getTileCoordExtent: () => [0, 0, 256, 256]
		};
		_listeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();

		constructor(options: Record<string, unknown>) {
			this._options = options;
		}

		setAttributions(attr: string) {
			this._attributions = attr;
		}

		getTileGrid() {
			return this._tileGrid;
		}

		getProjection() {
			return 'EPSG:3857';
		}

		on(event: string, listener: (...args: unknown[]) => void) {
			const existing = this._listeners.get(event) || [];
			existing.push(listener);
			this._listeners.set(event, existing);
		}
	}

	class MockMVT {
		readFeatures() {
			return [];
		}
		readProjection() {
			return 'EPSG:3857';
		}
	}

	return {
		source: {
			DataTile: MockDataTile as unknown as OlLib['source']['DataTile'],
			VectorTile: MockVectorTile as unknown as OlLib['source']['VectorTile']
		},
		format: {
			MVT: MockMVT as unknown as NonNullable<OlLib['format']>['MVT']
		}
	};
}

/** Create a mock vector tile object with the state/event API that the adapter uses. */
function createMockTile(coord: [number, number, number]) {
	let state = 1; // LOADING
	const listeners: Map<string, (() => void)[]> = new Map();

	return {
		getTileCoord: () => coord,
		setFeatures: vi.fn(),
		onLoad: vi.fn(),
		setState: vi.fn((s: number) => {
			state = s;
			(listeners.get('change') ?? []).forEach((fn) => fn());
		}),
		getState: () => state,
		addEventListener: (type: string, fn: () => void) => {
			const arr = listeners.get(type) ?? [];
			arr.push(fn);
			listeners.set(type, arr);
		},
		removeEventListener: (type: string, fn: () => void) => {
			const arr = listeners.get(type) ?? [];
			listeners.set(
				type,
				arr.filter((f) => f !== fn)
			);
		},
		/** Test helper: trigger a state transition (simulates OL setting ABORT/EMPTY). */
		_fireState: (s: number) => {
			state = s;
			(listeners.get('change') ?? []).forEach((fn) => fn());
		}
	};
}

/** Create a mock protocol handler that returns predictable TileJSON. */
function createMockHandler(overrides: Record<string, unknown> = {}) {
	const tileJson = {
		tiles: ['om://example.com/{z}/{x}/{y}.png'],
		attribution: '© Open-Meteo',
		minzoom: 0,
		maxzoom: 12,
		...overrides
	};

	return vi.fn().mockResolvedValue({ data: tileJson });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('addOpenLayersProtocolSupport', () => {
	let ol: OlLib;

	beforeEach(() => {
		ol = createMockOl();
		// Stub browser globals unavailable in Node.
		vi.stubGlobal('ImageData', class ImageData {});
		vi.stubGlobal('ImageBitmap', class ImageBitmap {});
		vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 256, height: 256 }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	// ── Constructor validation ────────────────────────────────────────────

	describe('constructor validation', () => {
		it('throws when ol is null', () => {
			expect(() => addOpenLayersProtocolSupport(null as unknown as OlLib)).toThrow(
				'ol.source.DataTile and ol.source.VectorTile must be available'
			);
		});

		it('throws when ol.source is missing', () => {
			expect(() => addOpenLayersProtocolSupport({} as unknown as OlLib)).toThrow(
				'ol.source.DataTile and ol.source.VectorTile must be available'
			);
		});

		it('throws when ol.source.DataTile is missing', () => {
			expect(() =>
				addOpenLayersProtocolSupport({ source: { VectorTile: vi.fn() } } as unknown as OlLib)
			).toThrow('ol.source.DataTile and ol.source.VectorTile must be available');
		});

		it('throws when ol.source.VectorTile is missing', () => {
			expect(() =>
				addOpenLayersProtocolSupport({ source: { DataTile: vi.fn() } } as unknown as OlLib)
			).toThrow('ol.source.DataTile and ol.source.VectorTile must be available');
		});

		it('returns an adapter with the expected interface', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			expect(adapter).toHaveProperty('addProtocol');
			expect(adapter).toHaveProperty('removeProtocol');
			expect(adapter).toHaveProperty('createRasterSource');
			expect(adapter).toHaveProperty('createVectorTileSource');
			expect(typeof adapter.addProtocol).toBe('function');
			expect(typeof adapter.removeProtocol).toBe('function');
			expect(typeof adapter.createRasterSource).toBe('function');
			expect(typeof adapter.createVectorTileSource).toBe('function');
		});
	});

	// ── Protocol registration ─────────────────────────────────────────────

	describe('addProtocol / removeProtocol', () => {
		it('registers and unregisters a protocol without error', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler = createMockHandler();

			expect(() => adapter.addProtocol('om', handler)).not.toThrow();
			expect(() => adapter.removeProtocol('om')).not.toThrow();
		});

		it('allows re-registering a protocol', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler1 = createMockHandler();
			const handler2 = createMockHandler();

			adapter.addProtocol('om', handler1);
			expect(() => adapter.addProtocol('om', handler2)).not.toThrow();
		});

		it('removing a non-existent protocol does not throw', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			expect(() => adapter.removeProtocol('nonexistent')).not.toThrow();
		});
	});

	// ── createRasterSource ────────────────────────────────────────────────

	describe('createRasterSource', () => {
		it('returns an ol.source.DataTile instance', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', createMockHandler());

			const source = adapter.createRasterSource('om://example.com/tiles.json');
			expect(source).toBeDefined();
		});

		it('passes through extra OL options', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', createMockHandler());

			const source = adapter.createRasterSource('om://example.com/tiles.json', {
				transition: 200,
				tileSize: 512
			}) as unknown as MockSourceInstance;

			expect(source._options.transition).toBe(200);
			expect(source._options.tileSize).toBe(512);
			expect(source._options.wrapX).toBe(true);
		});

		it('default options include wrapX and tileSize', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', createMockHandler());

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			expect(source._options.wrapX).toBe(true);
			expect(source._options.tileSize).toBe(256);
		});

		it('has a loader function in the source options', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', createMockHandler());

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			expect(typeof source._options.loader).toBe('function');
		});

		it('loader calls the protocol handler for tile data', async () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler = vi
				.fn()
				.mockResolvedValueOnce({
					data: {
						tiles: ['om://example.com/{z}/{x}/{y}.png'],
						attribution: '© Test'
					}
				})
				.mockResolvedValueOnce({
					data: new ArrayBuffer(16)
				});
			adapter.addProtocol('om', handler);

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			// Eager prefetch consumed the first handler call (TileJSON).
			// Wait for it to resolve so the cache is warm before the tile load.
			await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

			// Now the tile load only needs the image call.
			await loader(5, 10, 15, loaderOpts());

			// 1 TileJSON (eager) + 1 tile image
			expect(handler).toHaveBeenCalledTimes(2);
		});

		it('eagerly kick-starts TileJSON resolution on source creation', async () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler = createMockHandler();
			adapter.addProtocol('om', handler);

			adapter.createRasterSource('om://example.com/tiles.json');

			// The eager resolve() fires on the next microtask without any tile load.
			await vi.waitFor(() => {
				expect(handler).toHaveBeenCalled();
				const firstCall = handler.mock.calls[0][0] as { type: string; url: string };
				expect(firstCall.type).toBe('json');
				expect(firstCall.url).toBe('om://example.com/tiles.json');
			});
		});
	});

	// ── createVectorTileSource ────────────────────────────────────────────

	describe('createVectorTileSource', () => {
		it('throws if ol.format.MVT is not available', () => {
			const olNoMvt = { ...ol, format: undefined };
			const adapter = addOpenLayersProtocolSupport(olNoMvt as OlLib);
			adapter.addProtocol('om', createMockHandler());

			expect(() => adapter.createVectorTileSource('om://example.com/tiles.json')).toThrow(
				'ol.format.MVT is not available'
			);
		});

		it('returns an ol.source.VectorTile instance', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', createMockHandler());

			const source = adapter.createVectorTileSource('om://example.com/tiles.json');
			expect(source).toBeDefined();
		});

		it('passes through extra OL options', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', createMockHandler());

			const source = adapter.createVectorTileSource('om://example.com/tiles.json', {
				transition: 100
			}) as unknown as MockSourceInstance;

			expect(source._options.transition).toBe(100);
			expect(source._options.wrapX).toBe(true);
		});

		it('creates a custom tileLoadFunction', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', createMockHandler());

			const source = adapter.createVectorTileSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			expect(typeof source._options.tileLoadFunction).toBe('function');
		});

		it('has a placeholder URL for the tile grid pipeline', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', createMockHandler());

			const source = adapter.createVectorTileSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			expect(source._options.url).toBe('om://placeholder/{z}/{x}/{y}');
		});

		it('registers event listeners for tileloaderror and clear', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', createMockHandler());

			const source = adapter.createVectorTileSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;

			expect(source._listeners.has('tileloaderror')).toBe(true);
			expect(source._listeners.has('clear')).toBe(true);
		});

		it('eagerly resolves TileJSON and sets attribution', async () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler = createMockHandler({ attribution: '© Eager Test' });
			adapter.addProtocol('om', handler);

			const source = adapter.createVectorTileSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;

			// Wait for the eager TileJSON resolution
			await vi.waitFor(() => {
				expect(handler).toHaveBeenCalled();
			});

			await new Promise((r) => setTimeout(r, 10));
			expect(source._attributions).toBe('© Eager Test');
		});

		it('accepts custom MVT format via options', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', createMockHandler());

			const customFormat = {
				readFeatures: () => [],
				readProjection: () => 'EPSG:4326'
			};

			const source = adapter.createVectorTileSource('om://example.com/tiles.json', {
				format: customFormat
			}) as unknown as MockSourceInstance;

			// The custom format should be used, and not forwarded in restOlOptions
			expect(source._options.format).toBe(customFormat);
		});
	});

	// ── TileJSON caching (lazy resolver) ──────────────────────────────────

	describe('TileJSON lazy resolver caching', () => {
		it('raster source caches TileJSON across multiple loader calls', async () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler = vi.fn().mockImplementation(({ type }: { type: string }) => {
				if (type === 'json') {
					return Promise.resolve({
						data: { tiles: ['om://example.com/{z}/{x}/{y}.png'] }
					});
				}
				return Promise.resolve({ data: null });
			});
			adapter.addProtocol('om', handler);

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			// Wait for eager prefetch to prime the cache
			await vi.waitFor(() =>
				expect(
					handler.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'json')
						.length
				).toBe(1)
			);

			// First tile load — TileJSON already cached, only image call
			await loader(1, 0, 0, loaderOpts()).catch(() => {});
			// Second tile load at a different zoom — still cached
			await loader(2, 1, 1, loaderOpts()).catch(() => {});

			const jsonCalls = handler.mock.calls.filter(
				(c: unknown[]) => (c[0] as { type: string }).type === 'json'
			).length;
			expect(jsonCalls).toBe(1);
		});
	});

	// ── Abort behaviour ───────────────────────────────────────────────────

	describe('abort behaviour', () => {
		it('raster: OL signal abort propagates to the handler', async () => {
			// Use a never-resolving handler so the tile stays in-flight
			let resolveJson!: (v: unknown) => void;
			const jsonPromise = new Promise((res) => (resolveJson = res));
			const handler = vi.fn().mockReturnValue(jsonPromise);

			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', handler);

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			const { signal, abort } = makeSignal();
			const loadPromise = loader(3, 1, 1, { signal });

			// Abort while tile is in-flight
			abort();

			// Resolve TileJSON after abort — tile should still be aborted
			resolveJson({
				data: { tiles: ['om://example.com/{z}/{x}/{y}.png'] }
			});

			await expect(loadPromise).rejects.toThrow('Aborted');
		});

		it('raster: tiles at a stale zoom are aborted when a new zoom starts loading', async () => {
			const tileJsonData = { tiles: ['om://example.com/{z}/{x}/{y}.png'] };
			// Track image resolvers per invocation index (after TileJSON)
			const imageResolvers: Array<(v: unknown) => void> = [];

			const handler = vi.fn().mockImplementation(({ type }: { type: string }) => {
				if (type === 'json') return Promise.resolve({ data: tileJsonData });
				return new Promise((res) => imageResolvers.push(res));
			});

			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', handler);

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			// Wait for the eager TileJSON prefetch to complete and warm the cache.
			await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

			// Start a tile at zoom 4 — the handler now gets called for the image.
			const load4 = loader(4, 0, 0, loaderOpts());
			await vi.waitFor(() => expect(imageResolvers).toHaveLength(1));

			// Now start a tile at zoom 5 — should abort the zoom-4 tile.
			const load5 = loader(5, 0, 0, loaderOpts());
			await vi.waitFor(() => expect(imageResolvers).toHaveLength(2));

			// Resolve both image handlers; load4 should be aborted regardless.
			imageResolvers[0]({ data: null });
			imageResolvers[1]({ data: null });

			// The zoom-4 tile must have been aborted
			await expect(load4).rejects.toThrow('Aborted');
			// The zoom-5 tile completes normally
			await expect(load5).resolves.toBeDefined();
		});

		it('raster: same-tile-key re-request aborts the previous in-flight load', async () => {
			let resolveJson!: (v: unknown) => void;
			const tileJsonData = { tiles: ['om://example.com/{z}/{x}/{y}.png'] };

			// First call: slow tile handler, then fast tile handler
			let firstTileResolve!: (v: unknown) => void;
			const handler = vi
				.fn()
				.mockImplementationOnce(() => new Promise((res) => (resolveJson = res))) // TileJSON
				.mockImplementationOnce(() => new Promise((res) => (firstTileResolve = res))) // slow tile 1
				.mockResolvedValue({ data: null }); // fast tile 2

			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', handler);

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			await vi.waitFor(() => expect(typeof resolveJson).toBe('function'));
			resolveJson({ data: tileJsonData });

			// Start two loads for the exact same tile key
			const load1 = loader(3, 2, 2, loaderOpts());
			await new Promise((r) => setTimeout(r, 0)); // let first load register
			const load2 = loader(3, 2, 2, loaderOpts());

			// Resolve first (now-aborted) tile — should not matter
			firstTileResolve({ data: new ArrayBuffer(1) });

			// First load is aborted by the second
			await expect(load1).rejects.toThrow('Aborted');
			// Second load resolves (returns empty tile for null data)
			await expect(load2).resolves.toBeDefined();
		});

		it('vector: OL tile state ABORT (5) cancels the in-flight fetch', async () => {
			let resolveTileJson!: (v: unknown) => void;
			const handler = vi.fn().mockReturnValueOnce(new Promise((res) => (resolveTileJson = res))); // TileJSON

			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', handler);

			const source = adapter.createVectorTileSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const tileLoadFn = source._options.tileLoadFunction as (
				tile: ReturnType<typeof createMockTile>,
				url: string
			) => void;

			const tile = createMockTile([3, 1, 1]);

			// Start loading the tile
			tileLoadFn(tile, '');

			// OL aborts the tile (e.g. evicted) before TileJSON resolves
			tile._fireState(5 /* ABORT */);

			// Resolve TileJSON after the abort
			resolveTileJson({ data: { tiles: ['om://example.com/{z}/{x}/{y}.png'] } });
			await new Promise((r) => setTimeout(r, 10));

			// Handler should not have been called for the tile fetch (only TileJSON).
			// The abort made resolve() short-circuit.
			expect(handler).toHaveBeenCalledTimes(1); // only TileJSON
		});

		it('vector: tiles at a stale zoom are aborted when a new zoom starts loading', async () => {
			const tileJsonData = { tiles: ['om://example.com/{z}/{x}/{y}.png'] };
			let resolveHandler!: (v: unknown) => void;

			const handler = vi.fn().mockImplementation(({ type }: { type: string }) => {
				if (type === 'json') return Promise.resolve({ data: tileJsonData });
				return new Promise((res) => (resolveHandler = res));
			});

			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', handler);

			const source = adapter.createVectorTileSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const tileLoadFn = source._options.tileLoadFunction as (
				tile: ReturnType<typeof createMockTile>,
				url: string
			) => void;

			// Start a tile at zoom 4 and let TileJSON resolve
			const tile4 = createMockTile([4, 0, 0]);
			tileLoadFn(tile4, '');
			await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2)); // eager + TileJSON

			// Now load a tile at zoom 5 — should abort zoom-4 tile
			const tile5 = createMockTile([5, 0, 0]);
			tileLoadFn(tile5, '');
			// Allow tile5's promise chain to start before resolving (resolve → handler registration is async)
			await new Promise((r) => setTimeout(r, 0));
			// Resolve the array-buffer handler (now pointing to tile5's resolver)
			resolveHandler({ data: new ArrayBuffer(0) });
			await new Promise((r) => setTimeout(r, 10));

			// tile4's setState should not have been called with ERROR since it was aborted cleanly
			expect(tile4.setState).not.toHaveBeenCalledWith(3 /* ERROR */);
			// tile5 should have loaded with empty features (empty ArrayBuffer)
			expect(tile5.setFeatures).toHaveBeenCalledWith([]);
		});

		it('vector: source clear aborts all in-flight tiles', async () => {
			const tileJsonData = { tiles: ['om://example.com/{z}/{x}/{y}.png'] };
			const handler = vi.fn().mockImplementation(({ type }: { type: string }) => {
				if (type === 'json') return Promise.resolve({ data: tileJsonData });
				return new Promise(() => {}); // never resolves
			});

			const adapter = addOpenLayersProtocolSupport(ol);
			adapter.addProtocol('om', handler);

			const source = adapter.createVectorTileSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const tileLoadFn = source._options.tileLoadFunction as (
				tile: ReturnType<typeof createMockTile>,
				url: string
			) => void;

			const tile1 = createMockTile([3, 0, 0]);
			const tile2 = createMockTile([3, 1, 0]);
			tileLoadFn(tile1, '');
			tileLoadFn(tile2, '');

			// Wait for tiles to be in-flight
			await vi.waitFor(() => expect(handler.mock.calls.length).toBeGreaterThanOrEqual(3));

			// Fire the 'clear' event
			const clearListeners = source._listeners.get('clear') ?? [];
			clearListeners.forEach((fn) => fn());
			await new Promise((r) => setTimeout(r, 10));

			// Neither tile should have been marked ERROR — they were aborted cleanly
			expect(tile1.setState).not.toHaveBeenCalledWith(3);
			expect(tile2.setState).not.toHaveBeenCalledWith(3);
		});
	});

	// ── Error handling ────────────────────────────────────────────────────

	describe('error handling', () => {
		it('raster loader rejects when no handler is registered', async () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			// Don't register a protocol

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			await expect(loader(1, 0, 0, loaderOpts())).rejects.toThrow(
				`[openlayers-adapter] No handler registered for protocol: "om"`
			);
		});

		it('raster loader rejects when TileJSON has no tiles', async () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler = vi.fn().mockResolvedValue({ data: { tiles: [] } });
			adapter.addProtocol('om', handler);

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			await expect(loader(1, 0, 0, loaderOpts())).rejects.toThrow('TileJSON contains no tile URLs');
		});

		it('raster loader rejects when handler returns no data', async () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler = vi.fn().mockResolvedValue({ data: null });
			adapter.addProtocol('om', handler);

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			await expect(loader(1, 0, 0, loaderOpts())).rejects.toThrow(
				'Protocol handler returned no data for TileJSON'
			);
		});
	});
});
