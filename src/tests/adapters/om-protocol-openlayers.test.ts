/**
 * Unit tests for the OpenLayers adapter (addOpenLayersProtocolSupport).
 *
 * These tests exercise the adapter's public API in isolation using a minimal
 * mock of the OpenLayers library surface — no real OL dependency required.
 */
import type { OlLib } from '../../adapters/om-protocol-openlayers';
import { addOpenLayersProtocolSupport } from '../../adapters/om-protocol-openlayers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OmProtocolSettings } from '../../types';

/** Shape of the mock DataTile/VectorTile instances so tests can inspect stored state. */
interface MockSourceInstance {
	_options: Record<string, unknown>;
	_attributions: string | null;
	_listeners: Map<string, ((...args: unknown[]) => void)[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
	});

	afterEach(() => {
		vi.restoreAllMocks();
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

		it('stores optional OmProtocolSettings', () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler = createMockHandler();
			const settings = { domainOptions: [], colorScales: {} } as unknown as OmProtocolSettings;

			expect(() => adapter.addProtocol('om', handler, settings)).not.toThrow();
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
				transition: 200
			}) as unknown as MockSourceInstance;

			expect(source._options.transition).toBe(200);
			expect(source._options.tileSize).toBe(256);
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

			// Stub ImageBitmap (not available in Node) and createImageBitmap
			vi.stubGlobal('ImageBitmap', class ImageBitmap {});
			const mockBitmap = { width: 256, height: 256 };
			vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap));

			await loader(5, 10, 15, {});

			// First call = TileJSON, second call = tile image
			expect(handler).toHaveBeenCalledTimes(2);

			vi.unstubAllGlobals();
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

			// First call triggers TileJSON fetch
			await loader(1, 0, 0, {}).catch(() => {});
			const jsonCalls1 = handler.mock.calls.filter(
				(c: unknown[]) => (c[0] as { type: string }).type === 'json'
			).length;
			expect(jsonCalls1).toBe(1);

			// Second call should reuse cached TileJSON
			await loader(2, 1, 1, {}).catch(() => {});
			const jsonCalls2 = handler.mock.calls.filter(
				(c: unknown[]) => (c[0] as { type: string }).type === 'json'
			).length;
			expect(jsonCalls2).toBe(1); // Still 1 — cached
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

			await expect(loader(1, 0, 0, {})).rejects.toThrow('No handler registered for protocol: "om"');
		});

		it('raster loader rejects when TileJSON has no tiles', async () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler = vi.fn().mockResolvedValue({ data: { tiles: [] } });
			adapter.addProtocol('om', handler);

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			await expect(loader(1, 0, 0, {})).rejects.toThrow('TileJSON contains no tile URLs');
		});

		it('raster loader rejects when handler returns no data', async () => {
			const adapter = addOpenLayersProtocolSupport(ol);
			const handler = vi.fn().mockResolvedValue({ data: null });
			adapter.addProtocol('om', handler);

			const source = adapter.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			await expect(loader(1, 0, 0, {})).rejects.toThrow(
				'Protocol handler returned no data for TileJSON'
			);
		});
	});

	// ── Isolation between adapters ────────────────────────────────────────

	describe('isolation', () => {
		it('two adapters have independent protocol registries', async () => {
			const adapter1 = addOpenLayersProtocolSupport(ol);
			const adapter2 = addOpenLayersProtocolSupport(ol);

			const handler = createMockHandler();
			adapter1.addProtocol('om', handler);

			// adapter2 should not have access to adapter1's protocol
			const source = adapter2.createRasterSource(
				'om://example.com/tiles.json'
			) as unknown as MockSourceInstance;
			const loader = source._options.loader as (...args: unknown[]) => Promise<unknown>;

			await expect(loader(1, 0, 0, {})).rejects.toThrow('No handler registered');
		});
	});
});
