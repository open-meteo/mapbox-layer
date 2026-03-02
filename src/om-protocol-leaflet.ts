/**
 * Leaflet adapter for omProtocol.
 *
 * Leaflet has no custom-protocol mechanism and no native vector tile support.
 * This module provides `addLeafletProtocolSupport`, which creates:
 *
 *   - `createTileLayer(tileJsonUrl, options?)` — an `L.GridLayer` whose
 *     `createTile` calls the registered protocol handler and draws the
 *     returned `ImageBitmap` directly onto a `<canvas>` tile element.
 *     No extra PNG encode/decode cycle.
 *
 *   - `createVectorTileLayer(tileJsonUrl, options?)` — an `L.GridLayer` whose
 *     `createTile` fetches PBF bytes through the protocol handler, decodes
 *     the MVT features, and renders them onto a `<canvas>` tile using a
 *     configurable style function.
 *
 * Both layers are created synchronously. The TileJSON is resolved lazily on
 * the first tile load, so the map can be set up before the protocol resolves.
 *
 * Usage:
 *
 * ```ts
 * import L from 'leaflet';
 * import { omProtocol, addLeafletProtocolSupport } from '@openmeteo/mapbox-layer';
 *
 * // 1. Create the adapter, passing the Leaflet global.
 * const leafletAdapter = addLeafletProtocolSupport(L);
 *
 * // 2. Register your protocol handler (same signature as MapLibre's addProtocol).
 * leafletAdapter.addProtocol('om', omProtocol);
 *
 * // 3. Create the map with a standard base layer.
 * const map = L.map('map').setView([50, 10], 5);
 *
 * // 4. Create layers — synchronous, TileJSON resolved on first tile load.
 * const rasterLayer = leafletAdapter.createTileLayer('om://' + omUrl, { opacity: 0.75 });
 * const vectorLayer = leafletAdapter.createVectorTileLayer('om://' + omUrl + '&arrows=true');
 *
 * rasterLayer.addTo(map);
 * vectorLayer.addTo(map);
 * ```
 */
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

import type { OmProtocolSettings } from './types';

/**
 * Protocol handler signature – identical to MapLibre's addProtocol handler so
 * that `omProtocol` can be passed directly.
 */
type ProtocolHandler = (
	params: { url: string; type: string; headers?: Record<string, string> },
	abortController: AbortController,
	settings?: OmProtocolSettings
) => Promise<{ data: unknown }>;

interface RegisteredProtocol {
	handler: ProtocolHandler;
	settings?: OmProtocolSettings;
}

/** Extract the protocol prefix from a URL, e.g. "om" from "om://…". Returns null if not found. */
function extractProtocol(url: string): string | null {
	const idx = url.indexOf('://');
	return idx !== -1 ? url.substring(0, idx) : null;
}

/**
 * Style callback for vector tile features drawn on a Leaflet canvas.
 *
 * Return `null` / `undefined` to skip the feature.
 */
export interface LeafletVectorStyle {
	strokeStyle?: string | ((value: number) => string);
	lineWidth?: number | ((value: number) => number);
	lineCap?: CanvasLineCap;
	globalAlpha?: number | ((value: number) => number);
}

export type LeafletVectorStyleFn = (
	properties: Record<string, unknown>,
	layerName: string
) => LeafletVectorStyle | null | undefined;

/**
 * Options accepted by `createVectorTileLayer`, extending Leaflet GridLayer options.
 */
export interface VectorTileLayerOptions {
	/** Style function called for each feature. */
	style?: LeafletVectorStyleFn;
	/** Extra options forwarded to L.GridLayer. */
	[key: string]: unknown;
}

/**
 * The object returned by `addLeafletProtocolSupport`.
 */
export interface LeafletProtocolAdapter {
	/**
	 * Register a protocol handler.
	 *
	 * @param protocol - Protocol prefix WITHOUT the trailing "://", e.g. `"om"`.
	 * @param handler  - Protocol handler (e.g. `omProtocol`).
	 * @param settings - Optional OmProtocolSettings forwarded to every handler call.
	 */
	addProtocol: (protocol: string, handler: ProtocolHandler, settings?: OmProtocolSettings) => void;

	/**
	 * Unregister a previously registered protocol handler.
	 *
	 * @param protocol - Protocol prefix WITHOUT the trailing "://", e.g. `"om"`.
	 */
	removeProtocol: (protocol: string) => void;

	/**
	 * Create a raster tile layer backed by the registered protocol handler.
	 *
	 * Returns an `L.GridLayer` whose `createTile` fetches each tile through
	 * omProtocol and draws the `ImageBitmap` directly onto a canvas element —
	 * no redundant PNG encode/decode step.
	 *
	 * @param tileJsonUrl   - The `om://` TileJSON URL.
	 * @param leafletOptions - Extra options forwarded to `L.GridLayer`.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createTileLayer: (tileJsonUrl: string, leafletOptions?: Record<string, unknown>) => any;

	/**
	 * Create a vector tile layer backed by the registered protocol handler.
	 *
	 * Returns an `L.GridLayer` that fetches PBF bytes through omProtocol,
	 * decodes MVT features, and renders them on a canvas tile.
	 * Suitable for wind arrows, contour lines, grid points, etc.
	 *
	 * @param tileJsonUrl   - The `om://` TileJSON URL.
	 * @param options        - Style function and extra `L.GridLayer` options.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createVectorTileLayer: (tileJsonUrl: string, options?: VectorTileLayerOptions) => any;
}

/** The default vector tile extent used by the PBF encoder. */
const VECTOR_TILE_EXTENT = 4096;

/** Default arrow style: semi-transparent dark lines, width based on wind speed. */
const defaultVectorStyle: LeafletVectorStyleFn = (properties) => {
	const value = Number(properties['value']) || 0;
	const alpha = value > 5 ? 0.6 : value > 4 ? 0.5 : value > 3 ? 0.4 : value > 2 ? 0.3 : 0.2;
	const width = value > 10 ? 3.5 : value > 5 ? 3 : 2;
	return {
		strokeStyle: `rgba(0, 0, 0, ${alpha})`,
		lineWidth: width,
		lineCap: 'round'
	};
};

/**
 * Adds custom protocol support to Leaflet.
 *
 * @param L - The Leaflet global object (`import L from 'leaflet'` or `window.L`).
 * @returns A `LeafletProtocolAdapter` with `addProtocol`, `removeProtocol`,
 *          `createTileLayer`, and `createVectorTileLayer`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addLeafletProtocolSupport(L: any): LeafletProtocolAdapter {
	if (!L?.GridLayer) {
		throw new Error(
			'[om-protocol-leaflet] L.GridLayer is not available. ' +
				'Make sure Leaflet is fully loaded before calling addLeafletProtocolSupport().'
		);
	}

	const protocols = new Map<string, RegisteredProtocol>();

	function getRegistered(protocol: string): RegisteredProtocol {
		const entry = protocols.get(protocol);
		if (!entry) {
			throw new Error(`[om-protocol-leaflet] No handler registered for protocol: "${protocol}"`);
		}
		return entry;
	}

	/**
	 * Build a lazy TileJSON resolver for a given om:// URL.
	 *
	 * The returned function can be called many times; only one network request
	 * is made.  Once resolved the result is cached indefinitely.
	 */
	function makeTileJsonResolver(
		tileJsonUrl: string
	): () => Promise<{ tileTemplate: string; tileJson: Record<string, unknown> }> {
		type Resolved = { tileTemplate: string; tileJson: Record<string, unknown> };
		let cached: Resolved | null = null;
		let pending: Promise<Resolved> | null = null;

		return () => {
			if (cached) return Promise.resolve(cached);
			if (pending) return pending;

			const protocol = extractProtocol(tileJsonUrl)!;
			const { handler, settings } = getRegistered(protocol);

			pending = handler({ url: tileJsonUrl, type: 'json' }, new AbortController(), settings)
				.then((response) => {
					if (!response?.data) {
						throw new Error(
							`[om-protocol-leaflet] Protocol handler returned no data for TileJSON: ${tileJsonUrl}`
						);
					}
					const tileJson = response.data as Record<string, unknown>;
					const tiles = tileJson['tiles'] as string[] | undefined;
					if (!tiles?.length) {
						throw new Error(`[om-protocol-leaflet] TileJSON contains no tile URLs: ${tileJsonUrl}`);
					}
					cached = { tileTemplate: tiles[0], tileJson };
					pending = null;
					return cached;
				})
				.catch((err) => {
					pending = null; // allow retry on next call
					throw err;
				});

			return pending;
		};
	}

	/** Substitute {z}/{x}/{y} placeholders in a tile URL template. */
	function buildTileUrl(template: string, z: number, x: number, y: number): string {
		return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
	}

	/**
	 * Render decoded MVT features onto a canvas tile.
	 * Handles line (type 2) and polygon (type 3) geometries.
	 */
	function renderVectorFeatures(
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vectorTile: any,
		tileSize: number,
		styleFn: LeafletVectorStyleFn
	): void {
		const scale = tileSize / VECTOR_TILE_EXTENT;

		for (const layerName of Object.keys(vectorTile.layers)) {
			const layer = vectorTile.layers[layerName];

			// Detect whether this layer is an N×N square-grid arrow layer.
			// For those we apply a 2×2 checkerboard skip (¼ density) and scale
			// each surviving arrow 2× around its own center so it fills the
			// larger cell.  Any overflow is hidden with a clip rect.
			const gridN = Math.round(Math.sqrt(layer.length));
			const isArrowGrid = gridN >= 2 && gridN * gridN === layer.length;
			const cellSize = isArrowGrid ? VECTOR_TILE_EXTENT / gridN : 0;

			if (isArrowGrid) {
				ctx.save();
				ctx.beginPath();
				ctx.rect(0, 0, tileSize, tileSize);
				ctx.clip();
			}

			for (let i = 0; i < layer.length; i++) {
				// Checkerboard skip — only for arrow grid layers.
				if (isArrowGrid) {
					const gridRow = Math.floor(i / gridN);
					const gridCol = i % gridN;
					// Keep parity-1 rows/cols (1,3,5,...) rather than parity-0.
					// Row/col 0 and N-1 are always skipped so no kept arrow ever
					// has its center on the tile boundary — 2× scaling can never
					// produce a half-clipped arrowhead at a tile seam.
					if (gridRow % 2 !== 1 || gridCol % 2 !== 1) continue;
				}

				const feature = layer.feature(i);
				const props = feature.properties;
				const style = styleFn(props, layerName);
				if (!style) continue;

				const value = Number(props['value']) || 0;

				// Resolve style properties (support both static values and functions).
				const strokeStyle =
					typeof style.strokeStyle === 'function'
						? style.strokeStyle(value)
						: (style.strokeStyle ?? 'rgba(0, 0, 0, 0.4)');
				const rawLineWidth =
					typeof style.lineWidth === 'function' ? style.lineWidth(value) : (style.lineWidth ?? 1.5);
				const lineCap = style.lineCap ?? 'round';
				const globalAlpha =
					typeof style.globalAlpha === 'function'
						? style.globalAlpha(value)
						: (style.globalAlpha ?? 1);

				ctx.strokeStyle = strokeStyle;
				// Scale lineWidth 2× for arrow-grid layers to match the larger cell.
				ctx.lineWidth = isArrowGrid ? rawLineWidth * 2 : rawLineWidth;
				ctx.lineCap = lineCap;
				ctx.globalAlpha = globalAlpha;

				const geometry = feature.loadGeometry();

				// For arrow-grid layers, scale geometry 2× around the arrow's
				// center (gridCol*cellSize, gridRow*cellSize) so arrows visually
				// fill the space made available by the checkerboard skip.
				const gridRow = isArrowGrid ? Math.floor(i / gridN) : 0;
				const gridCol = isArrowGrid ? i % gridN : 0;
				const centerX = gridCol * cellSize;
				const centerY = gridRow * cellSize;

				// Determine rendering type from actual geometry.
				// If any ring has >1 point, render as line (handles arrows
				// which may be typed as point but contain line geometry).
				let renderType = feature.type;
				if (renderType === 1) {
					for (const ring of geometry) {
						if (ring.length > 1) {
							renderType = 2;
							break;
						}
					}
				}

				if (renderType === 2 || renderType === 3) {
					ctx.beginPath();
					for (const ring of geometry) {
						for (let j = 0; j < ring.length; j++) {
							// Apply 2× scale around the arrow center for grid layers,
							// otherwise use the raw coordinate.
							const sx = isArrowGrid
								? ((ring[j].x - centerX) * 2 + centerX) * scale
								: ring[j].x * scale;
							const sy = isArrowGrid
								? ((ring[j].y - centerY) * 2 + centerY) * scale
								: ring[j].y * scale;
							if (j === 0) {
								ctx.moveTo(sx, sy);
							} else {
								ctx.lineTo(sx, sy);
							}
						}
						if (renderType === 3) {
							ctx.closePath();
						}
					}
					ctx.stroke();
					if (renderType === 3 && style.strokeStyle) {
						ctx.fill();
					}
				} else if (renderType === 1) {
					// True point features — draw small circles.
					for (const ring of geometry) {
						for (const pt of ring) {
							ctx.beginPath();
							ctx.arc(pt.x * scale, pt.y * scale, rawLineWidth * 1.5, 0, Math.PI * 2);
							ctx.fill();
						}
					}
				}
			}

			if (isArrowGrid) {
				ctx.restore();
			}
		}

		// Reset alpha.
		ctx.globalAlpha = 1;
	}

	return {
		addProtocol(protocol, handler, settings) {
			// Only store settings if it looks like a valid OmProtocolSettings object.
			// This guards against callers accidentally passing non-settings objects
			// (e.g. `{ returnImageBitmap: true }`), which would replace the handler's
			// built-in defaults and cause runtime errors.
			const validSettings =
				settings &&
				typeof settings === 'object' &&
				('domainOptions' in settings || 'colorScales' in settings)
					? settings
					: undefined;
			protocols.set(protocol, { handler, settings: validSettings });
		},
		removeProtocol(protocol) {
			protocols.delete(protocol);
		},

		createTileLayer(tileJsonUrl, leafletOptions = {}) {
			const resolve = makeTileJsonResolver(tileJsonUrl);

			// Track in-flight AbortControllers per tile key for cancellation.
			const inflight = new Map<string, AbortController>();

			const OmRasterGridLayer = L.GridLayer.extend({
				createTile(
					coords: { x: number; y: number; z: number },
					done: (error: Error | null, tile: HTMLElement) => void
				): HTMLCanvasElement {
					const tileSize: number = this.getTileSize().x;
					const canvas = document.createElement('canvas') as HTMLCanvasElement;
					canvas.width = tileSize;
					canvas.height = tileSize;

					const tileKey = `${coords.z}/${coords.x}/${coords.y}`;
					const abortController = new AbortController();
					inflight.set(tileKey, abortController);

					resolve()
						.then(({ tileTemplate }) => {
							if (abortController.signal.aborted) return;

							const url = buildTileUrl(tileTemplate, coords.z, coords.x, coords.y);
							const tileProtocol = extractProtocol(url) ?? extractProtocol(tileJsonUrl)!;
							const { handler, settings } = getRegistered(tileProtocol);

							return handler({ url, type: 'image' }, abortController, settings);
						})
						.then((response) => {
							if (!response || abortController.signal.aborted) {
								done(null as unknown as Error, canvas);
								return;
							}

							const data = response.data;
							if (!data) {
								// Empty tile — return blank canvas.
								done(null as unknown as Error, canvas);
								return;
							}

							if (data instanceof ImageBitmap) {
								const ctx = canvas.getContext('2d');
								if (ctx) {
									ctx.drawImage(data, 0, 0, tileSize, tileSize);
									data.close();
								}
								done(null as unknown as Error, canvas);
								return;
							}

							if (data instanceof ArrayBuffer) {
								// Raw PNG bytes — decode to ImageBitmap then draw.
								createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }))
									.then((bmp) => {
										const ctx = canvas.getContext('2d');
										if (ctx) {
											ctx.drawImage(bmp, 0, 0, tileSize, tileSize);
											bmp.close();
										}
										done(null as unknown as Error, canvas);
									})
									.catch((err) => done(err, canvas));
								return;
							}

							done(
								new Error(
									`[om-protocol-leaflet] Unsupported raster tile data type: ${Object.prototype.toString.call(data)}`
								),
								canvas
							);
						})
						.catch((err) => {
							if (err.name !== 'AbortError' && !abortController.signal.aborted) {
								console.error('[om-protocol-leaflet] Raster tile error:', err);
								done(err, canvas);
							} else {
								done(null as unknown as Error, canvas);
							}
						})
						.finally(() => {
							inflight.delete(tileKey);
						});

					return canvas;
				},

				_removeTile(key: string) {
					// Abort any in-flight request for this tile before Leaflet removes it.
					const controller = inflight.get(key);
					if (controller) {
						controller.abort();
						inflight.delete(key);
					}
					// Call the original Leaflet _removeTile.
					L.GridLayer.prototype._removeTile.call(this, key);
				}
			});

			return new OmRasterGridLayer({
				tileSize: 256,
				crossOrigin: true,
				...leafletOptions
			});
		},

		createVectorTileLayer(tileJsonUrl, options = {}) {
			const { style: userStyle, ...restOptions } = options;
			const styleFn: LeafletVectorStyleFn =
				(userStyle as LeafletVectorStyleFn) ?? defaultVectorStyle;
			const resolve = makeTileJsonResolver(tileJsonUrl);

			// Track in-flight AbortControllers per tile key for cancellation.
			const inflight = new Map<string, AbortController>();

			const OmVectorGridLayer = L.GridLayer.extend({
				createTile(
					coords: { x: number; y: number; z: number },
					done: (error: Error | null, tile: HTMLElement) => void
				): HTMLCanvasElement {
					const tileSize: number = this.getTileSize().x;
					const canvas = document.createElement('canvas') as HTMLCanvasElement;
					canvas.width = tileSize;
					canvas.height = tileSize;

					const tileKey = `${coords.z}/${coords.x}/${coords.y}`;
					const abortController = new AbortController();
					inflight.set(tileKey, abortController);

					resolve()
						.then(({ tileTemplate }) => {
							if (abortController.signal.aborted) return;

							const url = buildTileUrl(tileTemplate, coords.z, coords.x, coords.y);
							const tileProtocol = extractProtocol(url) ?? extractProtocol(tileJsonUrl)!;
							const { handler, settings } = getRegistered(tileProtocol);

							return handler({ url, type: 'arrayBuffer' }, abortController, settings);
						})
						.then((response) => {
							if (!response || abortController.signal.aborted) {
								done(null as unknown as Error, canvas);
								return;
							}

							const data = response.data;
							if (!data || (data instanceof ArrayBuffer && data.byteLength === 0)) {
								// Empty tile — return blank canvas.
								done(null as unknown as Error, canvas);
								return;
							}

							// Decode MVT features from PBF bytes.
							const pbfData = new Pbf(data as ArrayBuffer);
							const vectorTile = new VectorTile(pbfData);

							const ctx = canvas.getContext('2d');
							if (ctx) {
								renderVectorFeatures(ctx, vectorTile, tileSize, styleFn);
							}

							done(null as unknown as Error, canvas);
						})
						.catch((err) => {
							if (err.name !== 'AbortError' && !abortController.signal.aborted) {
								console.error('[om-protocol-leaflet] Vector tile error:', err);
								done(err, canvas);
							} else {
								done(null as unknown as Error, canvas);
							}
						})
						.finally(() => {
							inflight.delete(tileKey);
						});

					return canvas;
				},

				_removeTile(key: string) {
					const controller = inflight.get(key);
					if (controller) {
						controller.abort();
						inflight.delete(key);
					}
					L.GridLayer.prototype._removeTile.call(this, key);
				}
			});

			return new OmVectorGridLayer({
				tileSize: 256,
				crossOrigin: true,
				...restOptions
			});
		}
	};
}
