import inside from 'point-in-polygon-hao';

import { normalizeLon, tile2lon } from './math';

import { Bounds, ClippingOptions, GeoJson, GeoJsonGeometry, GeoJsonPosition } from '../types';

export type ResolvedClipping = {
	polygons?: ReadonlyArray<ReadonlyArray<number[]>>;
	bounds?: Bounds;
};

/**
 * Creates a reusable point-in-clipping tester from resolved clipping options.
 * Pre-computes the wrapped polygon arrays and bounds so the hot loop only
 * does an O(1) bounds check followed by the point-in-polygon raycast when
 * actually needed.
 *
 * Returns `undefined` when there are no polygon constraints — callers can
 * skip the test entirely.
 */
export const createClippingTester = (
	clippingOptions: ResolvedClipping | undefined
): ((lon: number, lat: number) => boolean) | undefined => {
	const polygons = clippingOptions?.polygons;
	if (!polygons || polygons.length === 0) return undefined;

	// Pre-wrap each ring into the [ring] shape that point-in-polygon-hao expects,
	// so we avoid allocating wrapper arrays on every call.
	const wrappedPolygons = polygons.map((ring) => [ring as unknown as number[][]]);

	// Pre-extract bounds for a fast AABB rejection (O(1) per point).
	const bounds = clippingOptions?.bounds;

	// Reusable point array to avoid allocating [lon, lat] per call.
	const point: [number, number] = [0, 0];

	return (lon: number, lat: number): boolean => {
		// Fast bounds rejection
		if (bounds) {
			const [minLon, minLat, maxLon, maxLat] = bounds;
			if (lat < minLat || lat > maxLat) return false;
			// Dateline-aware longitude check (same logic as checkAgainstBounds)
			if (maxLon >= minLon) {
				if (lon < minLon || lon > maxLon) return false;
			} else {
				// Wrapping bounds: valid range is [minLon, 180] ∪ [-180, maxLon]
				if (lon < minLon && lon > maxLon) return false;
			}
		}

		point[0] = lon;
		point[1] = lat;
		return wrappedPolygons.some((polygon) => !!inside(point, polygon));
	};
};

/** Unwrap a ring's longitudes to be continuous (no jumps > 180°) */
export const unwrapLongitudes = (ring: [number, number][]): [number, number][] => {
	if (ring.length < 2) return ring.slice();
	const result: [number, number][] = [[ring[0][0], ring[0][1]]];
	let prevLon = ring[0][0];
	for (let i = 1; i < ring.length; i++) {
		const [lon, lat] = ring[i];
		const delta = lon - prevLon;
		const shift = Math.round(delta / 360) * -360;
		const adjustedLon = lon + shift;
		result.push([adjustedLon, lat]);
		prevLon = adjustedLon;
	}
	return result;
};

export const resolveClippingOptions = (options: ClippingOptions): ResolvedClipping | undefined => {
	if (!options) return undefined;

	const polygons: [number, number][][] = [];
	let bounds = options.bounds;

	// Track combined (unwrapped) bounds for dateline-aware auto-computation
	let combinedMinLon = Infinity;
	let combinedMaxLon = -Infinity;
	let combinedMinLat = Infinity;
	let combinedMaxLat = -Infinity;

	/** Extend the combined bounds with an entire ring, shifting it into the
	 *  same longitude frame as previously added rings so that rings on opposite
	 *  sides of the dateline are correctly merged. */
	const extendBoundsWithRing = (ring: [number, number][]) => {
		const unwrapped = unwrapLongitudes(ring);
		if (unwrapped.length === 0) return;

		let ringMinLon = Infinity;
		let ringMaxLon = -Infinity;
		for (const [lon, lat] of unwrapped) {
			if (lon < ringMinLon) ringMinLon = lon;
			if (lon > ringMaxLon) ringMaxLon = lon;
			if (lat < combinedMinLat) combinedMinLat = lat;
			if (lat > combinedMaxLat) combinedMaxLat = lat;
		}

		if (combinedMinLon === Infinity) {
			// First ring establishes the reference frame
			combinedMinLon = ringMinLon;
			combinedMaxLon = ringMaxLon;
		} else {
			// Shift this ring's interval to be closest to the existing midpoint
			const mid = (combinedMinLon + combinedMaxLon) / 2;
			const ringMid = (ringMinLon + ringMaxLon) / 2;
			const shift = Math.round((mid - ringMid) / 360) * 360;
			ringMinLon += shift;
			ringMaxLon += shift;

			combinedMinLon = Math.min(combinedMinLon, ringMinLon);
			combinedMaxLon = Math.max(combinedMaxLon, ringMaxLon);
		}
	};

	const toCoord2 = (position: GeoJsonPosition): [number, number] => [
		position[0] ?? 0,
		position[1] ?? 0
	];

	const samePoint = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

	const closeRing = (ring: [number, number][]) => {
		if (ring.length === 0) return ring;
		const first = ring[0];
		const last = ring[ring.length - 1];
		if (!samePoint(first, last)) ring.push([first[0], first[1]]);
		return ring;
	};

	if (options.polygons) {
		polygons.push(...options.polygons);
		if (!bounds) {
			for (const ring of options.polygons) {
				extendBoundsWithRing(ring);
			}
		}
	}

	if (options.geojson) {
		const addRing = (ring: GeoJsonPosition[]) => {
			const normalizedRing = ring.map((position) => toCoord2(position));
			if (!bounds) {
				extendBoundsWithRing(normalizedRing);
			}
			const unwrapped = unwrapLongitudes(normalizedRing);
			if (unwrapped.length === 0) return;
			polygons.push(closeRing(unwrapped));
		};

		const addGeometry = (geometry: GeoJsonGeometry | null) => {
			if (!geometry) return;
			if (geometry.type === 'Polygon') {
				for (const ring of geometry.coordinates) {
					addRing(ring);
				}
				return;
			}
			if (geometry.type === 'MultiPolygon') {
				for (const polygon of geometry.coordinates) {
					for (const ring of polygon) {
						addRing(ring);
					}
				}
				return;
			}
			if (geometry.type === 'GeometryCollection') {
				for (const geom of geometry.geometries) {
					addGeometry(geom);
				}
				return;
			}

			// Ignore non-polygon geometries for clipping.
			return;
		};

		const geojson: GeoJson = options.geojson;
		if (geojson.type === 'FeatureCollection') {
			for (const feature of geojson.features) {
				if (feature.geometry) {
					addGeometry(feature.geometry);
				}
			}
		} else if (geojson.type === 'Feature') {
			if (geojson.geometry) {
				addGeometry(geojson.geometry);
			}
		} else {
			addGeometry(geojson);
		}
	}

	// Finalize auto-computed bounds from unwrapped coordinates
	if (!bounds && combinedMinLon !== Infinity) {
		if (combinedMaxLon - combinedMinLon >= 360) {
			// Polygon spans the entire globe
			bounds = [-180, combinedMinLat, 180, combinedMaxLat];
		} else {
			bounds = [
				normalizeLon(combinedMinLon),
				combinedMinLat,
				normalizeLon(combinedMaxLon),
				combinedMaxLat
			];
		}
	}

	if (!bounds && polygons.length === 0) return undefined;

	return { polygons: polygons.length > 0 ? polygons : undefined, bounds };
};

// export const clipRasterToPolygons = async (
// 	canvas: OffscreenCanvas,
// 	tileSize: number,
// 	z: number,
// 	x: number,
// 	y: number,
// 	polygons: ReadonlyArray<ReadonlyArray<number[]>>
// ): Promise<Blob> => {
// 	console.log('clipRasterToPolygons');
// 	if (polygons.length === 0) {
// 		return canvas.convertToBlob({ type: 'image/png' });
// 	}

// 	const clipCanvas = new OffscreenCanvas(tileSize, tileSize);
// 	const clipContext = clipCanvas.getContext('2d');
// 	if (!clipContext) throw new Error('Could not initialise canvas context');

// 	// tile center longitude used to choose best 360° frame for polygons
// 	const tileCenterLon = tile2lon(x + 0.5, z);

// 	clipContext.beginPath();
// 	for (const ring of polygons) {
// 		// compute a representative longitude for the ring (midpoint of min/max)
// 		let minLon = Infinity,
// 			maxLon = -Infinity;
// 		for (const [lon] of ring) {
// 			if (lon < minLon) minLon = lon;
// 			if (lon > maxLon) maxLon = lon;
// 		}
// 		const ringMidLon = (minLon + maxLon) / 2;

// 		// choose integer multiple of 360 that moves the ring closest to the tile center
// 		const lonShift = Math.round((tileCenterLon - ringMidLon) / 360) * 360;

// 		for (const [index, [polyX, polyY]] of ring.entries()) {
// 			// shift the polygon longitude into the tile's frame
// 			const adjustedLon = polyX + lonShift;
// 			const polyXtile = (lon2tile(adjustedLon, z) - x) * tileSize;
// 			const polyYtile = (lat2tile(polyY, z) - y) * tileSize;
// 			if (index === 0) {
// 				clipContext.moveTo(polyXtile, polyYtile);
// 			} else {
// 				clipContext.lineTo(polyXtile, polyYtile);
// 			}
// 		}
// 		clipContext.closePath();
// 	}

// 	clipContext.clip('evenodd');
// 	clipContext.drawImage(canvas, 0, 0);

// 	return clipCanvas.convertToBlob({ type: 'image/png' });
// };

export const clipRasterToPolygons = async (
	canvas: OffscreenCanvas,
	tileSize: number,
	z: number,
	x: number,
	y: number,
	polygons: ReadonlyArray<ReadonlyArray<number[]>>
): Promise<Blob> => {
	if (!polygons || polygons.length === 0) {
		return canvas.convertToBlob({ type: 'image/png' });
	}

	const clipCanvas = new OffscreenCanvas(tileSize, tileSize);
	const ctx = clipCanvas.getContext('2d');
	if (!ctx) throw new Error('Could not initialise canvas context');

	// Precompute constants
	const nTiles = 1 << z; // 2^z
	const lonToTileScale = nTiles / 360; // tile units per degree longitude
	const tileOriginX = x; // tile index of left edge
	const tileOriginY = y; // tile index of top edge
	const tileCenterLon = tile2lon(x + 0.5, z);

	// clip path builder
	const path = new Path2D();

	// temporary vars reused in loops
	let ringMinLon: number, ringMaxLon: number, ringMidLon: number, lonShift: number;
	let minLat: number, maxLat: number;
	const tilePixelLeft = 0;
	const tilePixelRight = tileSize;
	const tilePixelTop = 0;
	const tilePixelBottom = tileSize;

	// Helper: convert adjustedLon (degrees) -> pixel X within tile
	// px = ((adjustedLon + 180) * lonToTileScale - tileOriginX) * tileSize
	// but compute (tileX - x) * tileSize inline to avoid function call.
	for (let ri = 0; ri < polygons.length; ri++) {
		const ring = polygons[ri] as [number, number][]; // [lon, lat] pairs
		if (!ring || ring.length === 0) continue;

		// compute ring lon/lat bbox (cheap index loop)
		ringMinLon = Infinity;
		ringMaxLon = -Infinity;
		minLat = Infinity;
		maxLat = -Infinity;
		for (let i = 0; i < ring.length; i++) {
			const lon = ring[i][0];
			const lat = ring[i][1];
			if (lon < ringMinLon) ringMinLon = lon;
			if (lon > ringMaxLon) ringMaxLon = lon;
			if (lat < minLat) minLat = lat;
			if (lat > maxLat) maxLat = lat;
		}

		// representative midpoint of ring longitudes and shift into tile frame
		ringMidLon = (ringMinLon + ringMaxLon) / 2;
		lonShift = Math.round((tileCenterLon - ringMidLon) / 360) * 360;

		// Early reject by projecting ring bbox to tile pixel bbox.
		// Compute pixel X range for shifted lon bbox:
		const shiftedMinLon = ringMinLon + lonShift;
		const shiftedMaxLon = ringMaxLon + lonShift;
		// tile index (floating) for longitudes
		const tileXMin = (shiftedMinLon + 180) * lonToTileScale;
		const tileXMax = (shiftedMaxLon + 180) * lonToTileScale;
		const pixelXMin = (tileXMin - tileOriginX) * tileSize;
		const pixelXMax = (tileXMax - tileOriginX) * tileSize;

		const latToTileY = (lat: number) => {
			const rad = (lat * Math.PI) / 180;
			const merc = Math.log(Math.tan(rad) + 1 / Math.cos(rad));
			return ((1 - merc / Math.PI) / 2) * nTiles;
		};

		const tileYMin = latToTileY(maxLat); // note lat to tile Y inverses (maxLat -> min tileY)
		const tileYMax = latToTileY(minLat);
		const pixelYMin = (tileYMin - tileOriginY) * tileSize;
		const pixelYMax = (tileYMax - tileOriginY) * tileSize;

		// If the ring pixel bbox doesn't intersect tile pixel rectangle, skip.
		if (
			pixelXMax < tilePixelLeft ||
			pixelXMin > tilePixelRight ||
			pixelYMax < tilePixelTop ||
			pixelYMin > tilePixelBottom
		) {
			continue;
		}

		// Build path for this ring (index loop, inline transforms)
		// We assume ring already closed; if not, duplicating the first point is cheap
		const len = ring.length;
		if (len === 0) continue;

		// First vertex
		{
			const lon = ring[0][0] + lonShift;
			const lat = ring[0][1];
			// inline lon->tileX -> pixelX
			const tileXF = (lon + 180) * lonToTileScale;
			const px = (tileXF - tileOriginX) * tileSize;
			// inline lat->tileY -> pixelY
			const rad = (lat * Math.PI) / 180;
			const py =
				(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * nTiles - tileOriginY) *
				tileSize;
			path.moveTo(px, py);
		}

		for (let i = 1; i < len; i++) {
			const lon = ring[i][0] + lonShift;
			const lat = ring[i][1];
			const tileXF = (lon + 180) * lonToTileScale;
			const px = (tileXF - tileOriginX) * tileSize;
			const rad = (lat * Math.PI) / 180;
			const py =
				(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * nTiles - tileOriginY) *
				tileSize;
			path.lineTo(px, py);
		}

		path.closePath();
	}

	// Clip once with the constructed path and draw
	// passing 'evenodd' is optional, keep it if you need that rule
	ctx.clip(path, 'evenodd');
	ctx.drawImage(canvas, 0, 0);

	return clipCanvas.convertToBlob({ type: 'image/png' });
};
