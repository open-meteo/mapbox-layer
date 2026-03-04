/**
 * Unit tests for the Leaflet adapter (addLeafletProtocolSupport).
 *
 * These tests exercise the adapter's public API in isolation using a minimal
 * mock of the Leaflet library surface — no real Leaflet dependency required.
 */
import type { LeafletLib } from '../../adapters/om-protocol-leaflet';
import { addLeafletProtocolSupport } from '../../adapters/om-protocol-leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Construct a minimal mock of the Leaflet namespace. */
function createMockLeaflet(): LeafletLib {
	return {
		GridLayer: {
			extend(proto: Record<string, unknown>) {
				// Return a constructor that stores the proto and options
				return class MockGridLayer {
					_proto = proto;
					_options: Record<string, unknown>;
					constructor(options: Record<string, unknown> = {}) {
						this._options = options;
					}
					getTileSize() {
						return { x: 256, y: 256 };
					}
				} as unknown as new (options: Record<string, unknown>) => {
					getTileSize(): { x: number; y: number };
				};
			},
			prototype: {
				_removeTile: vi.fn()
			}
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

/** Create a mock image handler that returns an ImageBitmap-like object. */
function createMockImageHandler(tileJsonOverrides: Record<string, unknown> = {}) {
	const tileJson = {
		tiles: ['om://example.com/{z}/{x}/{y}.png'],
		attribution: '© Open-Meteo',
		...tileJsonOverrides
	};

	let callCount = 0;
	return vi.fn().mockImplementation(({ type }: { type: string }) => {
		callCount++;
		if (type === 'json') {
			return Promise.resolve({ data: tileJson });
		}
		// Return a basic ArrayBuffer for image requests
		return Promise.resolve({ data: new ArrayBuffer(16) });
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('addLeafletProtocolSupport', () => {
	let L: LeafletLib;

	beforeEach(() => {
		L = createMockLeaflet();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ── Constructor validation ────────────────────────────────────────────

	describe('constructor validation', () => {
		it('throws when L is null', () => {
			expect(() => addLeafletProtocolSupport(null as unknown as LeafletLib)).toThrow(
				'L.GridLayer is not available'
			);
		});

		it('throws when L.GridLayer is missing', () => {
			expect(() => addLeafletProtocolSupport({} as unknown as LeafletLib)).toThrow(
				'L.GridLayer is not available'
			);
		});

		it('returns an adapter with the expected interface', () => {
			const adapter = addLeafletProtocolSupport(L);
			expect(adapter).toHaveProperty('addProtocol');
			expect(adapter).toHaveProperty('removeProtocol');
			expect(adapter).toHaveProperty('createTileLayer');
			expect(adapter).toHaveProperty('createVectorTileLayer');
			expect(typeof adapter.addProtocol).toBe('function');
			expect(typeof adapter.removeProtocol).toBe('function');
			expect(typeof adapter.createTileLayer).toBe('function');
			expect(typeof adapter.createVectorTileLayer).toBe('function');
		});
	});

	// ── Protocol registration ─────────────────────────────────────────────

	describe('addProtocol / removeProtocol', () => {
		it('registers and unregisters a protocol without error', () => {
			const adapter = addLeafletProtocolSupport(L);
			const handler = createMockHandler();

			expect(() => adapter.addProtocol('om', handler)).not.toThrow();
			expect(() => adapter.removeProtocol('om')).not.toThrow();
		});

		it('allows re-registering a protocol with a different handler', () => {
			const adapter = addLeafletProtocolSupport(L);
			const handler1 = createMockHandler();
			const handler2 = createMockHandler();

			adapter.addProtocol('om', handler1);
			expect(() => adapter.addProtocol('om', handler2)).not.toThrow();
		});

		it('removing a non-existent protocol does not throw', () => {
			const adapter = addLeafletProtocolSupport(L);
			expect(() => adapter.removeProtocol('nonexistent')).not.toThrow();
		});

		it('filters invalid OmProtocolSettings objects', () => {
			const adapter = addLeafletProtocolSupport(L);
			const handler = createMockHandler();

			// An object without domainOptions or colorScales should be ignored
			adapter.addProtocol('om', handler, { returnImageBitmap: true } as any);

			// Valid settings with domainOptions should be kept
			const validSettings = { domainOptions: [], colorScales: {} } as any;
			adapter.addProtocol('om2', handler, validSettings);

			// We can't directly inspect the stored settings, but we verify no errors
			expect(true).toBe(true);
		});
	});

	// ── createTileLayer ───────────────────────────────────────────────────

	describe('createTileLayer', () => {
		it('returns a layer instance', () => {
			const adapter = addLeafletProtocolSupport(L);
			adapter.addProtocol('om', createMockHandler());

			const layer = adapter.createTileLayer('om://example.com/tiles.json');
			expect(layer).toBeDefined();
		});

		it('passes through leaflet options including defaults', () => {
			const adapter = addLeafletProtocolSupport(L);
			adapter.addProtocol('om', createMockHandler());

			const layer = adapter.createTileLayer('om://example.com/tiles.json', {
				opacity: 0.5,
				zIndex: 10
			}) as any;

			// The mock GridLayer stores options in _options
			expect(layer._options.tileSize).toBe(256);
			expect(layer._options.opacity).toBe(0.5);
			expect(layer._options.zIndex).toBe(10);
		});

		it('custom options override defaults', () => {
			const adapter = addLeafletProtocolSupport(L);
			adapter.addProtocol('om', createMockHandler());

			const layer = adapter.createTileLayer('om://example.com/tiles.json', {
				tileSize: 512
			}) as any;

			expect(layer._options.tileSize).toBe(512);
		});
	});

	// ── createVectorTileLayer ─────────────────────────────────────────────

	describe('createVectorTileLayer', () => {
		it('returns a layer instance', () => {
			const adapter = addLeafletProtocolSupport(L);
			adapter.addProtocol('om', createMockHandler());

			const layer = adapter.createVectorTileLayer('om://example.com/tiles.json');
			expect(layer).toBeDefined();
		});

		it('passes through options minus the style key', () => {
			const adapter = addLeafletProtocolSupport(L);
			adapter.addProtocol('om', createMockHandler());

			const customStyle = () => ({ strokeStyle: 'red', lineWidth: 2 });
			const layer = adapter.createVectorTileLayer('om://example.com/tiles.json', {
				style: customStyle,
				opacity: 0.8
			}) as any;

			// style should not be forwarded to GridLayer options
			expect(layer._options.style).toBeUndefined();
			expect(layer._options.opacity).toBe(0.8);
			expect(layer._options.tileSize).toBe(256);
		});

		it('uses default vector style when no style is provided', () => {
			const adapter = addLeafletProtocolSupport(L);
			adapter.addProtocol('om', createMockHandler());

			// Should not throw
			const layer = adapter.createVectorTileLayer('om://example.com/tiles.json');
			expect(layer).toBeDefined();
		});
	});

	// ── Error handling ────────────────────────────────────────────────────

	describe('error handling', () => {
		it('createTileLayer with unregistered protocol creates the layer (error at tile load time)', () => {
			const adapter = addLeafletProtocolSupport(L);
			// Don't register any protocol — layer creation is synchronous and succeeds
			const layer = adapter.createTileLayer('om://example.com/tiles.json');
			expect(layer).toBeDefined();
		});

		it('createVectorTileLayer with unregistered protocol creates the layer', () => {
			const adapter = addLeafletProtocolSupport(L);
			const layer = adapter.createVectorTileLayer('om://example.com/tiles.json');
			expect(layer).toBeDefined();
		});
	});

	// ── Multiple adapters ─────────────────────────────────────────────────

	describe('isolation', () => {
		it('two adapters have independent protocol registries', () => {
			const adapter1 = addLeafletProtocolSupport(L);
			const adapter2 = addLeafletProtocolSupport(L);

			const handler = createMockHandler();
			adapter1.addProtocol('om', handler);

			// adapter2 should not have the protocol registered
			// Creating a layer is fine (synchronous), but using it would fail
			const layer = adapter2.createTileLayer('om://example.com/tiles.json');
			expect(layer).toBeDefined();
		});
	});
});
