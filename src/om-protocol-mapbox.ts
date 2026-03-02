/**
 * Mapbox GL JS adapter for omProtocol.
 *
 * Mapbox GL JS does not support custom protocols (unlike MapLibre's addProtocol).
 * This module provides `addMapboxProtocolSupport`, which shims that capability by
 * creating a custom raster source type that intercepts tile and TileJSON requests
 * matching a registered protocol prefix (e.g. "om://").
 *
 * Usage:
 *
 * ```ts
 * import mapboxgl from 'mapbox-gl';
 * import { omProtocol, addMapboxProtocolSupport } from '@openmeteo/mapbox-layer';
 *
 * // 1. Create the adapter (before or after creating the map).
 * const adapter = addMapboxProtocolSupport(mapboxgl);
 *
 * // 2. Register your protocol handler (same signature as MapLibre's addProtocol).
 * adapter.addProtocol('om', omProtocol);
 *
 * // 3. Create the map.
 * const map = new mapboxgl.Map({ container: 'map', ... });
 *
 * // 4. Register the custom source type with the map instance.
 * //    Use the name you like; just keep it consistent with step 5.
 * map.addSourceType('raster-om', adapter.sourceType, (err) => {
 *   if (err) console.error('Failed to register raster-om source type', err);
 * });
 *
 * // 5. Add a source using that type and the custom protocol URL.
 * map.on('load', () => {
 *   map.addSource('weather', { type: 'raster-om', url: 'om://...', maxzoom: 12 });
 *   map.addLayer({ id: 'weather-layer', type: 'raster', source: 'weather' });
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

/**
 * The object returned by `addMapboxProtocolSupport`.
 */
export interface MapboxProtocolAdapter {
	/**
	 * Register a protocol handler.
	 * The handler receives params and an AbortController, just like MapLibre's addProtocol.
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
	 * Custom raster source class – pass to `map.addSourceType('raster-om', adapter.rasterSourceType, cb)`.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	rasterSourceType: new (...args: any[]) => unknown;

	/**
	 * Custom vector source class – pass to `map.addSourceType('vector-om', adapter.vectorSourceType, cb)`.
	 * Required for vector tile layers (arrows, contours, grids, …).
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vectorSourceType: new (...args: any[]) => unknown;

	/**
	 * @deprecated Use `rasterSourceType` instead. Kept for backward compatibility.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	sourceType: new (...args: any[]) => unknown;
}

/** Extract the protocol prefix from a URL, e.g. "om" from "om://…". Returns null if not found. */
function extractProtocol(url: string): string | null {
	const idx = url.indexOf('://');
	return idx !== -1 ? url.substring(0, idx) : null;
}

/**
 * Convert the data returned by a protocol handler into an object URL that
 * Mapbox can load as an image tile.
 *
 * Prefers `OffscreenCanvas` when available to avoid DOM canvas creation
 * overhead (no layout, no GC of DOM nodes).
 */
async function dataToObjectUrl(data: unknown): Promise<string> {
	if (data instanceof ImageBitmap) {
		// Prefer OffscreenCanvas for ImageBitmap → Blob conversion (no DOM overhead).
		if (typeof OffscreenCanvas !== 'undefined') {
			const oc = new OffscreenCanvas(data.width, data.height);
			const ctx = oc.getContext('2d');
			if (!ctx) {
				throw new Error('[om-protocol-mapbox] Could not obtain OffscreenCanvas 2D context');
			}
			ctx.drawImage(data, 0, 0);
			const blob = await oc.convertToBlob({ type: 'image/png' });
			return URL.createObjectURL(blob);
		}

		// Fallback to DOM canvas for older browsers.
		return new Promise<string>((resolve, reject) => {
			const canvas = document.createElement('canvas');
			canvas.width = data.width;
			canvas.height = data.height;
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				return reject(new Error('[om-protocol-mapbox] Could not obtain 2D canvas context'));
			}
			ctx.drawImage(data, 0, 0);
			canvas.toBlob((blob) => {
				if (!blob) {
					return reject(new Error('[om-protocol-mapbox] canvas.toBlob returned null'));
				}
				resolve(URL.createObjectURL(blob));
			}, 'image/png');
		});
	}

	if (data instanceof ArrayBuffer) {
		// Treat the raw bytes as an encoded image (PNG/WebP as returned by omProtocol).
		const blob = new Blob([new Uint8Array(data)], { type: 'image/png' });
		return URL.createObjectURL(blob);
	}

	throw new Error(
		`[om-protocol-mapbox] Unsupported tile data type: ${Object.prototype.toString.call(data)}`
	);
}

/**
 * Adds custom protocol support to Mapbox GL JS.
 *
 * Mapbox does not have a built-in `addProtocol` API, so this function works
 * around that limitation by creating a custom raster source type whose
 * `load()` (TileJSON fetch) and `loadTile()` (individual tile fetch) methods
 * are overridden to call registered protocol handlers instead of making real
 * HTTP requests.
 *
 * @param mapboxgl - The Mapbox GL JS library object (`import mapboxgl from 'mapbox-gl'`).
 * @returns A `MapboxProtocolAdapter` containing `addProtocol`, `removeProtocol`, and `sourceType`.
 *
 * @throws If `mapboxgl.Style` is not available (i.e., the library is not fully
 *         loaded when this function is called).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addMapboxProtocolSupport(mapboxgl: any): MapboxProtocolAdapter {
	if (!mapboxgl?.Style?.getSourceType) {
		throw new Error(
			'[om-protocol-mapbox] mapboxgl.Style.getSourceType is not available. ' +
				'Make sure the Mapbox GL JS library is fully loaded before calling addMapboxProtocolSupport().'
		);
	}

	const protocols = new Map<string, RegisteredProtocol>();

	/**
	 * Shared `load()` override for both raster and vector source subclasses.
	 *
	 * Mapbox's source `load()` internally calls `loadTileJSON(this._options, …)` which
	 * immediately HTTP-fetches `this._options.url`.  For custom-protocol URLs we:
	 *   1. Call the registered handler ourselves to get the TileJSON.
	 *   2. Patch `this._options` in-place: remove `url`, inject `tiles` + metadata.
	 *   3. Call `super.load()` – now `loadTileJSON` sees no URL, uses `tiles` directly.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function omLoad(this: any, superLoad: () => void): void {
		const optionsObj: Record<string, unknown> | undefined = this._options ?? this.options;
		const originalUrl: string | undefined =
			(optionsObj?.['url'] as string) ?? (this.url as string | undefined);

		const protocol = originalUrl ? extractProtocol(originalUrl) : null;
		if (!protocol || !protocols.has(protocol)) {
			superLoad.call(this);
			return;
		}

		const { handler, settings } = protocols.get(protocol)!;
		const abortController = new AbortController();

		handler({ url: originalUrl, type: 'json' }, abortController, settings)
			.then((response) => {
				if (!response?.data) {
					throw new Error(
						`[om-protocol-mapbox] Protocol handler returned no data for TileJSON: ${originalUrl}`
					);
				}

				const tileJson = response.data as Record<string, unknown>;

				if (optionsObj) {
					delete optionsObj['url'];
					optionsObj['tiles'] = tileJson['tiles'];
					if (tileJson['bounds'] != null) optionsObj['bounds'] = tileJson['bounds'];
					if (tileJson['minzoom'] != null) optionsObj['minzoom'] = tileJson['minzoom'];
					if (tileJson['maxzoom'] != null) optionsObj['maxzoom'] = tileJson['maxzoom'];
					if (tileJson['attribution'] != null) optionsObj['attribution'] = tileJson['attribution'];
					if (tileJson['scheme'] != null) optionsObj['scheme'] = tileJson['scheme'];
				}
				this.url = undefined;

				superLoad.call(this);
			})
			.catch((err: Error) => {
				console.error('[om-protocol-mapbox] Error fetching TileJSON:', err);
				this.fire?.('error', { error: err });
			});
	}

	const RasterTileSource: new (...args: any[]) => any = mapboxgl.Style.getSourceType('raster');

	class OmRasterSource extends RasterTileSource {
		constructor(...args: any[]) {
			super(...args);
		}

		load() {
			omLoad.call(this, super.load);
		}

		/**
		 * Override `loadTile()` to intercept individual tile requests for custom protocols.
		 *
		 * When the tile URL starts with a registered protocol, we call the handler
		 * with `type: 'image'`, convert the returned ImageBitmap / ArrayBuffer into
		 * a Blob URL, and delegate to the parent `loadTile()` with that Blob URL so
		 * that Mapbox can decode and display the tile normally.
		 */
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		loadTile(tile: any, callback: (err?: Error | null) => void): void {
			const self = this as Record<string, unknown>;

			// Reconstruct the tile URL from the tile coordinate and the source's tile templates.
			const rawUrl: string =
				typeof tile.tileID?.canonical?.url === 'function'
					? tile.tileID.canonical.url(self.tiles, self.scheme)
					: '';

			const protocol = rawUrl ? extractProtocol(rawUrl) : null;
			if (!protocol || !protocols.has(protocol)) {
				super.loadTile(tile, callback);
				return;
			}

			const { handler, settings } = protocols.get(protocol)!;
			const abortController = new AbortController();

			// Expose cancellation so Mapbox can abort in-flight tile requests.
			tile.request = { cancel: () => abortController.abort() };

			handler(
				{ url: rawUrl, type: 'image', headers: { accept: 'image/webp,*/*' } },
				abortController,
				settings
			)
				.then(async (response) => {
					if (abortController.signal.aborted) {
						tile.state = 'unloaded';
						callback(null);
						return;
					}

					if (!response?.data) {
						// Empty / null response – treat as an empty tile rather than an error.
						tile.state = 'errored';
						callback(null);
						return;
					}

					let objectUrl: string;
					try {
						objectUrl = await dataToObjectUrl(response.data);
					} catch (convErr) {
						callback(convErr instanceof Error ? convErr : new Error(String(convErr)));
						return;
					}

					// Temporarily patch tile.tileID.canonical.url so the parent's
					// loadTile picks up the Blob URL instead of the custom-protocol URL.
					// We restore the original function immediately after the parent
					// returns so the canonical URL object is not permanently modified.
					const originalUrlFn = tile.tileID.canonical.url;
					tile.tileID.canonical.url = () => {
						tile.tileID.canonical.url = originalUrlFn;
						return objectUrl;
					};

					super.loadTile(tile, (err?: Error | null) => {
						URL.revokeObjectURL(objectUrl);
						callback(err);
					});
				})
				.catch((err: Error) => {
					if (err.name === 'AbortError' || abortController.signal.aborted) {
						tile.state = 'unloaded';
						callback(null);
					} else {
						callback(err);
					}
				});
		}
	}

	// ── Vector source ────────────────────────────────────────────────────────

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const VectorTileSource: new (...args: any[]) => any = mapboxgl.Style.getSourceType('vector');

	class OmVectorSource extends VectorTileSource {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		constructor(...args: any[]) {
			super(...args);
		}

		load() {
			omLoad.call(this, super.load);
		}

		/**
		 * Override `loadTile()` for vector (PBF) tiles.
		 *
		 * Mapbox serializes `tile.tileID` (including `tileID.canonical`) via its own
		 * structured-clone mechanism to send to the web worker. Patching
		 * `tileID.canonical.url` with a plain function breaks that serializer
		 * ("can't serialize object of type function").
		 *
		 * Safe approach:
		 *   1. Call the protocol handler ourselves to get the raw PBF ArrayBuffer.
		 *   2. Create a blob URL from the bytes.
		 *   3. Temporarily swap `this.tiles` to `[blobUrl]` – Mapbox's `super.loadTile`
		 *      reads `this.tiles` **synchronously** to build the request URL string
		 *      (`canonical.url(this.tiles, this.scheme)`).  The blob URL has no
		 *      `{z}/{x}/{y}` placeholders so the substitution is a no-op.
		 *   4. Call `super.loadTile()`.  The synchronous part picks up the blob URL and
		 *      ships it to the worker as a plain string – `tileID` is untouched.
		 *   5. Immediately restore `this.tiles`.  JS is single-threaded, so this
		 *      swap-call-restore is atomic relative to any concurrent `loadTile` call.
		 *   6. The worker fetches the blob URL (same-origin blob URLs are reachable
		 *      from workers), parses the PBF, and returns the tile data normally.
		 *   7. Revoke the blob URL in the callback once the worker is done.
		 */
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		loadTile(tile: any, callback: (err?: Error | null) => void): void {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const self = this as any;

			const rawUrl: string =
				typeof tile.tileID?.canonical?.url === 'function'
					? tile.tileID.canonical.url(self.tiles, self.scheme)
					: '';

			const protocol = rawUrl ? extractProtocol(rawUrl) : null;
			if (!protocol || !protocols.has(protocol)) {
				super.loadTile(tile, callback);
				return;
			}

			const { handler, settings } = protocols.get(protocol)!;
			const abortController = new AbortController();

			tile.request = { cancel: () => abortController.abort() };

			handler({ url: rawUrl, type: 'arrayBuffer' }, abortController, settings)
				.then((response) => {
					if (abortController.signal.aborted) {
						tile.state = 'unloaded';
						callback(null);
						return;
					}

					const bytes =
						response?.data instanceof ArrayBuffer
							? new Uint8Array(response.data)
							: new Uint8Array(0);
					const blob = new Blob([bytes], { type: 'application/x-protobuf' });
					const objectUrl = URL.createObjectURL(blob);

					// Swap tiles, dispatch (synchronous URL resolution), restore – atomically.
					const savedTiles = self.tiles;
					self.tiles = [objectUrl];
					try {
						super.loadTile(tile, (err?: Error | null) => {
							URL.revokeObjectURL(objectUrl);
							callback(err);
						});
					} finally {
						self.tiles = savedTiles;
					}
				})
				.catch((err: Error) => {
					if (err.name === 'AbortError' || abortController.signal.aborted) {
						tile.state = 'unloaded';
						callback(null);
					} else {
						callback(err);
					}
				});
		}
	}

	return {
		addProtocol(protocol, handler, settings) {
			protocols.set(protocol, { handler, settings });
		},
		removeProtocol(protocol) {
			protocols.delete(protocol);
		},
		rasterSourceType: OmRasterSource,
		vectorSourceType: OmVectorSource,
		// backward-compat alias
		sourceType: OmRasterSource
	};
}
