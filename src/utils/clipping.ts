import inside from 'point-in-polygon-hao';

import { lat2tile, lon2tile } from './math';

import { Bounds, ClippingOptions, GeoJson, GeoJsonGeometry, GeoJsonPosition } from '../types';

/**
 * Flat representation of clipping polygons.
 * When `useSAB` is true the backing buffer is a SharedArrayBuffer (zero-copy
 * across workers); otherwise a regular ArrayBuffer is used.
 */
export type SharedPolygons = {
	/** Flat [lon, lat, …] pairs for all rings. */
	coordinates: Float64Array;
	/** Ring start indices (element offsets into `coordinates`). Length = numRings + 1. */
	offsets: Uint32Array;
};

export type ResolvedClipping = {
	polygons?: SharedPolygons;
	bounds?: Bounds;
};

/** Number of rings stored in a SharedPolygons structure. */
export const sharedPolygonsRingCount = (sp: SharedPolygons): number => sp.offsets.length - 1;

/** Extract ring *i* as a plain `number[][]` (each element `[lon, lat]`). */
export const sharedPolygonsRing = (sp: SharedPolygons, i: number): number[][] => {
	const start = sp.offsets[i];
	const end = sp.offsets[i + 1];
	const ring: number[][] = [];
	for (let j = start; j < end; j += 2) {
		ring.push([sp.coordinates[j], sp.coordinates[j + 1]]);
	}
	return ring;
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
	const sp = clippingOptions?.polygons;
	if (!sp || sp.offsets.length <= 1) return undefined;

	const numRings = sharedPolygonsRingCount(sp);

	// Pre-extract each ring into the [ring] shape that point-in-polygon-hao expects,
	// so we avoid allocating wrapper arrays on every call.
	const wrappedPolygons: number[][][][] = [];
	for (let i = 0; i < numRings; i++) {
		wrappedPolygons.push([sharedPolygonsRing(sp, i)]);
	}

	// Pre-extract bounds for a fast AABB rejection (O(1) per point).
	const bounds = clippingOptions?.bounds;

	// Reusable point array to avoid allocating [lon, lat] per call.
	const point: [number, number] = [0, 0];

	return (lon: number, lat: number): boolean => {
		// Fast bounds rejection
		if (bounds) {
			const [minLon, minLat, maxLon, maxLat] = bounds;
			if (lat < minLat || lat > maxLat) return false;
			if (lon < minLon || lon > maxLon) return false;
		}

		point[0] = lon;
		point[1] = lat;
		return wrappedPolygons.some((polygon) => !!inside(point, polygon));
	};
};

export const resolveClippingOptions = (
	options: ClippingOptions,
	useSAB = false
): ResolvedClipping | undefined => {
	if (!options) return undefined;

	// Collect rings as plain arrays first, then pack into a flat buffer at the end.
	const rings: [number, number][][] = [];
	let bounds = options.bounds;

	let combinedMinLon = Infinity;
	let combinedMaxLon = -Infinity;
	let combinedMinLat = Infinity;
	let combinedMaxLat = -Infinity;

	const extendBoundsWithRing = (ring: [number, number][]) => {
		for (const [lon, lat] of ring) {
			if (lon < combinedMinLon) combinedMinLon = lon;
			if (lon > combinedMaxLon) combinedMaxLon = lon;
			if (lat < combinedMinLat) combinedMinLat = lat;
			if (lat > combinedMaxLat) combinedMaxLat = lat;
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

	if (options.geojson) {
		const addRing = (ring: GeoJsonPosition[]) => {
			const normalizedRing = ring.map((position) => toCoord2(position));
			if (!bounds) {
				extendBoundsWithRing(normalizedRing);
			}
			if (normalizedRing.length === 0) return;
			rings.push(closeRing(normalizedRing));
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

	if (!bounds && combinedMinLon !== Infinity) {
		bounds = [combinedMinLon, combinedMinLat, combinedMaxLon, combinedMaxLat];
	}

	if (!bounds && rings.length === 0) return undefined;

	// Pack collected rings into flat typed arrays (SharedArrayBuffer when useSAB is true).
	let sharedPolygons: SharedPolygons | undefined;
	if (rings.length > 0) {
		let totalElements = 0;
		for (const ring of rings) totalElements += ring.length * 2;

		const coordBytes = totalElements * Float64Array.BYTES_PER_ELEMENT;
		const offsetBytes = (rings.length + 1) * Uint32Array.BYTES_PER_ELEMENT;
		const coordBuffer = useSAB ? new SharedArrayBuffer(coordBytes) : new ArrayBuffer(coordBytes);
		const coordinates = new Float64Array(coordBuffer);
		const offsetBuffer = useSAB ? new SharedArrayBuffer(offsetBytes) : new ArrayBuffer(offsetBytes);
		const offsets = new Uint32Array(offsetBuffer);

		let idx = 0;
		for (let r = 0; r < rings.length; r++) {
			offsets[r] = idx;
			for (const [lon, lat] of rings[r]) {
				coordinates[idx++] = lon;
				coordinates[idx++] = lat;
			}
		}
		offsets[rings.length] = idx;

		sharedPolygons = { coordinates, offsets };
	}

	return { polygons: sharedPolygons, bounds };
};

export const clipRasterToPolygons = (
	canvas: OffscreenCanvas,
	tileSize: number,
	z: number,
	x: number,
	y: number,
	clippingOptions: ResolvedClipping
): ImageBitmap => {
	const sp = clippingOptions.polygons;
	if (!sp) {
		return canvas.transferToImageBitmap();
	}

	const numRings = sharedPolygonsRingCount(sp);
	if (numRings === 0) {
		return canvas.transferToImageBitmap();
	}

	const clipCanvas = new OffscreenCanvas(tileSize, tileSize);
	const clipContext = clipCanvas.getContext('2d');

	if (!clipContext) {
		throw new Error('Could not initialise canvas context');
	}

	clipContext.beginPath();
	for (let r = 0; r < numRings; r++) {
		const ring = sharedPolygonsRing(sp, r);
		for (let i = 0; i < ring.length; i++) {
			const [polyX, polyY] = ring[i];
			const polyXtile = (lon2tile(polyX, z) - x) * tileSize;
			const polyYtile = (lat2tile(polyY, z) - y) * tileSize;
			if (i === 0) {
				clipContext.moveTo(polyXtile, polyYtile);
			} else {
				clipContext.lineTo(polyXtile, polyYtile);
			}
		}
		clipContext.closePath();
	}

	clipContext.clip();
	clipContext.drawImage(canvas, 0, 0);

	return clipCanvas.transferToImageBitmap();
};
