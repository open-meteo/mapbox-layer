/**
 * OpenLayers adapter for omProtocol.
 *
 * OpenLayers has no custom-protocol mechanism. This module provides
 * `addOpenLayersProtocolSupport`, which creates:
 *
 *   - `createRasterSource(tileJsonUrl, options?)` — an `ol.source.DataTile`
 *     whose async `loader` calls the registered protocol handler and returns
 *     the `ImageBitmap` directly to OL.  No PNG encode/decode cycle.
 *     Use with `new ol.layer.WebGLTile({ source })`.
 *
 *   - `createVectorTileSource(tileJsonUrl, options?)` — an `ol.source.VectorTile`
 *     that fetches PBF bytes through the protocol handler, converts them to
 *     a blob URL, and feeds them to OL's native MVT pipeline for true vector
 *     rendering.  Use with `new ol.layer.VectorTile({ source, style })`.
 *
 * Both sources are created synchronously. The TileJSON is resolved lazily on
 * the first tile load, so the map can be set up before the protocol resolves.
 *
 * Usage:
 *
 * ```ts
 * import { omProtocol, addOpenLayersProtocolSupport } from '@openmeteo/mapbox-layer';
 *
 * // 1. Create the adapter, passing the OpenLayers global.
 * const olAdapter = addOpenLayersProtocolSupport(ol);
 *
 * // 2. Register your protocol handler.
 * olAdapter.addProtocol('om', omProtocol);
 *
 * // 3. Create sources — synchronous, TileJSON resolved on first tile load.
 * const rasterSource = olAdapter.createRasterSource('om://' + omUrl);
 * const vectorSource = olAdapter.createVectorTileSource('om://' + omUrl + '&arrows=true');
 *
 * // 4. Add to the map.
 * new ol.Map({
 *   target: 'map',
 *   layers: [
 *     new ol.layer.WebGLTile({ source: rasterSource, opacity: 0.75 }),
 *     new ol.layer.VectorTile({ source: vectorSource }),
 *   ],
 *   view: new ol.View({ center: ol.proj.fromLonLat([10, 50]), zoom: 5 }),
 * });
 * ```
 */
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
 * The object returned by `addOpenLayersProtocolSupport`.
 */
export interface OpenLayersProtocolAdapter {
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
	 * Create a raster tile source backed by the registered protocol handler.
	 *
	 * Returns an `ol.source.DataTile` whose async `loader` fetches each tile
	 * through omProtocol and returns the `ImageBitmap` directly to OL — no PNG
	 * encode/decode roundtrip.  Use with `new ol.layer.WebGLTile({ source })`.
	 *
	 * @param tileJsonUrl - The `om://` TileJSON URL.
	 * @param olOptions   - Extra options forwarded to `ol.source.DataTile` constructor.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createRasterSource: (tileJsonUrl: string, olOptions?: Record<string, unknown>) => any;

	/**
	 * Create a vector tile source backed by the registered protocol handler.
	 *
	 * Returns an `ol.source.VectorTile` (MVT format) with a custom
	 * `tileLoadFunction` that fetches PBF bytes through omProtocol and
	 * feeds them to OL's native MVT parser via a blob URL.
	 * Use with `new ol.layer.VectorTile({ source, style })`.
	 *
	 * @param tileJsonUrl - The `om://` TileJSON URL.
	 * @param olOptions   - Extra options forwarded to `ol.source.VectorTile`.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createVectorTileSource: (tileJsonUrl: string, olOptions?: Record<string, unknown>) => any;
}

/**
 * Adds custom protocol support to OpenLayers.
 *
 * @param ol - The OpenLayers global object (or a subset with
 *             `{ source: { DataTile, VectorTile }, format: { MVT } }`).
 * @returns An `OpenLayersProtocolAdapter` with `addProtocol`, `removeProtocol`,
 *          `createRasterSource`, and `createVectorTileSource`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addOpenLayersProtocolSupport(ol: any): OpenLayersProtocolAdapter {
	if (!ol?.source?.DataTile || !ol?.source?.VectorTile) {
		throw new Error(
			'[om-protocol-openlayers] ol.source.DataTile and ol.source.VectorTile must be available. ' +
				'OpenLayers 7.5+ is required.'
		);
	}

	const protocols = new Map<string, RegisteredProtocol>();

	function getRegistered(protocol: string): RegisteredProtocol {
		const entry = protocols.get(protocol);
		if (!entry) {
			throw new Error(`[om-protocol-openlayers] No handler registered for protocol: "${protocol}"`);
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
							`[om-protocol-openlayers] Protocol handler returned no data for TileJSON: ${tileJsonUrl}`
						);
					}
					const tileJson = response.data as Record<string, unknown>;
					const tiles = tileJson['tiles'] as string[] | undefined;
					if (!tiles?.length) {
						throw new Error(
							`[om-protocol-openlayers] TileJSON contains no tile URLs: ${tileJsonUrl}`
						);
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

	return {
		addProtocol(protocol, handler, settings) {
			protocols.set(protocol, { handler, settings });
		},
		removeProtocol(protocol) {
			protocols.delete(protocol);
		},

		createRasterSource(tileJsonUrl, olOptions = {}) {
			const resolve = makeTileJsonResolver(tileJsonUrl);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const source: any = new ol.source.DataTile({
				/**
				 * OL calls this for every visible tile.  The first call also resolves
				 * TileJSON and updates source metadata (attribution, zoom range).
				 *
				 * We return `ImageBitmap` directly — OL's DataTile + WebGLTile pipeline
				 * accepts it natively and uploads it to the GPU without re-encoding.
				 */
				loader: async (z: number, x: number, y: number) => {
					const { tileTemplate, tileJson } = await resolve();

					// Update source metadata once on first successful TileJSON fetch.
					if (tileJson['attribution'] && !source._omAttributionSet) {
						source._omAttributionSet = true;
						source.setAttributions(tileJson['attribution'] as string);
					}

					const url = buildTileUrl(tileTemplate, z, x, y);
					const tileProtocol = extractProtocol(url) ?? extractProtocol(tileJsonUrl)!;
					const { handler, settings } = getRegistered(tileProtocol);
					const abortController = new AbortController();

					const response = await handler({ url, type: 'image' }, abortController, settings);
					const data = response?.data;

					if (!data) {
						// Empty tile — return a transparent 1×1 pixel so OL marks it LOADED.
						return new ImageData(1, 1);
					}

					if (data instanceof ImageBitmap) {
						// Fast path: hand ImageBitmap directly to OL's WebGL pipeline.
						return data;
					}

					if (data instanceof ArrayBuffer) {
						// ArrayBuffer = raw encoded PNG bytes — decode into ImageBitmap.
						return createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
					}

					throw new Error(
						`[om-protocol-openlayers] Unsupported raster tile data type: ${Object.prototype.toString.call(data)}`
					);
				},
				tileSize: 256,
				...olOptions
			});

			return source;
		},

		createVectorTileSource(tileJsonUrl, olOptions = {}) {
			if (!ol.format?.MVT) {
				throw new Error(
					'[om-protocol-openlayers] ol.format.MVT is not available. ' +
						'Make sure the full OpenLayers bundle is loaded.'
				);
			}

			const resolve = makeTileJsonResolver(tileJsonUrl);
			const baseProtocol = extractProtocol(tileJsonUrl)!;
			const format = (olOptions['format'] as unknown) ?? new ol.format.MVT();
			const { format: _unusedFormat, ...restOlOptions } = olOptions;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const source: any = new ol.source.VectorTile({
				format,

				// A placeholder URL with {z}/{x}/{y} is required so OL enters
				// its tile-loading pipeline for every tile coordinate.
				url: 'om://placeholder/{z}/{x}/{y}',

				/**
				 * Custom tile load function:
				 *
				 * 1. Fetch PBF bytes through omProtocol.
				 * 2. Parse them with ol.format.MVT.readFeatures().
				 * 3. Hand the features to tile.onLoad() for native OL
				 *    vector rendering (projection, styling, hit-detection).
				 */
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				tileLoadFunction: (tile: any, _placeholderUrl: string) => {
					const tileCoord = tile.getTileCoord();
					const [z, x, y] = tileCoord;

					resolve()
						.then(({ tileTemplate }) => {
							const url = buildTileUrl(tileTemplate, z, x, y);
							const tileProtocol = extractProtocol(url) ?? baseProtocol;
							const { handler, settings } = getRegistered(tileProtocol);

							return handler({ url, type: 'arrayBuffer' }, new AbortController(), settings);
						})
						.then((response) => {
							const data = response?.data;

							// Determine the tile's map-coordinate extent and
							// projection so MVT coordinates are scaled correctly.
							const tileGrid = source.getTileGrid();
							const tileExtent = tileGrid.getTileCoordExtent(tileCoord);
							const projection = source.getProjection() || 'EPSG:3857';

							if (!data || (data instanceof ArrayBuffer && data.byteLength === 0)) {
								// Empty tile — signal no features.
								tile.setFeatures([]);
								return;
							}

							// Parse the PBF with OL's MVT format and hand
							// features to the tile for native vector rendering.
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const features = (format as any).readFeatures(data, {
								extent: tileExtent,
								featureProjection: projection
							});
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const dataProjection = (format as any).readProjection(data);
							tile.onLoad(features, dataProjection);
						})
						.catch((err: unknown) => {
							if ((err as Error).name !== 'AbortError') {
								console.error('[om-protocol-openlayers] Vector tile error:', err);
							}
							// Signal error state so OL doesn't keep retrying.
							tile.setState(3); // TileState.ERROR
						});
				},

				...restOlOptions
			});

			// Eagerly kick off TileJSON resolution so the first tiles don't
			// have to wait for it.  Set attribution once resolved.
			resolve()
				.then(({ tileJson }) => {
					if (tileJson['attribution']) {
						source.setAttributions(tileJson['attribution'] as string);
					}
				})
				.catch((err: Error) => {
					console.error(
						'[om-protocol-openlayers] Error resolving TileJSON for vector source:',
						err
					);
				});

			return source;
		}
	};
}
