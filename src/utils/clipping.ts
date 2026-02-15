import inside from 'point-in-polygon-hao';

import { lat2tile, lon2tile, normalizeLon } from './math';

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

	const splitRingAtDateline = (ring: [number, number][]): [number, number][][] => {
		if (ring.length < 2) return [];
		const points = ring.slice();
		if (!samePoint(points[0], points[points.length - 1])) {
			points.push([points[0][0], points[0][1]]);
		}

		const unwrapped = unwrapLongitudes(points);

		let minLon = unwrapped[0][0];
		let maxLon = unwrapped[0][0];
		for (const [lon] of unwrapped) {
			if (lon < minLon) minLon = lon;
			if (lon > maxLon) maxLon = lon;
		}

		const needsSplitAt180 = maxLon > 180;
		const needsSplitAtMinus180 = minLon < -180;

		if (!needsSplitAt180 && !needsSplitAtMinus180) {
			const normalized = unwrapped.map(([lon, lat]) => [normalizeLon(lon), lat]);
			return [closeRing(normalized as [number, number][])];
		}

		const splitMeridian = needsSplitAt180 ? 180 : -180;
		const left: [number, number][] = [];
		const right: [number, number][] = [];

		for (let i = 1; i < unwrapped.length; i++) {
			const [lon1, lat1] = unwrapped[i - 1];
			const [lon2, lat2] = unwrapped[i];
			const lon1Side = lon1 <= splitMeridian;
			const lon2Side = lon2 <= splitMeridian;

			const addPoint = (lon: number, lat: number, toLeft: boolean) => {
				if (toLeft) {
					left.push([lon, lat]);
				} else {
					right.push([lon + (splitMeridian === 180 ? -360 : 360), lat]);
				}
			};

			if (i === 1) {
				addPoint(lon1, lat1, lon1Side);
			}

			if (lon1Side === lon2Side) {
				addPoint(lon2, lat2, lon2Side);
				continue;
			}

			const t = (splitMeridian - lon1) / (lon2 - lon1);
			const lat = lat1 + t * (lat2 - lat1);
			addPoint(splitMeridian, lat, true);
			addPoint(splitMeridian, lat, false);
			addPoint(lon2, lat2, lon2Side);
		}

		const rings: [number, number][][] = [];
		if (left.length >= 4) rings.push(closeRing(left));
		if (right.length >= 4) rings.push(closeRing(right));
		return rings;
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
			const splitRings = splitRingAtDateline(normalizedRing);
			for (const splitRing of splitRings) {
				polygons.push(splitRing);
			}
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

export const clipRasterToPolygons = async (
	canvas: OffscreenCanvas,
	tileSize: number,
	z: number,
	x: number,
	y: number,
	polygons: ReadonlyArray<ReadonlyArray<number[]>>
): Promise<Blob> => {
	if (polygons.length === 0) {
		return canvas.convertToBlob({ type: 'image/png' });
	}

	const clipCanvas = new OffscreenCanvas(tileSize, tileSize);
	const clipContext = clipCanvas.getContext('2d');

	if (!clipContext) {
		throw new Error('Could not initialise canvas context');
	}

	clipContext.beginPath();
	for (const ring of polygons) {
		for (const [index, [polyX, polyY]] of ring.entries()) {
			const polyXtile = (lon2tile(polyX, z) - x) * tileSize;
			const polyYtile = (lat2tile(polyY, z) - y) * tileSize;
			if (index === 0) {
				clipContext.moveTo(polyXtile, polyYtile);
			} else {
				clipContext.lineTo(polyXtile, polyYtile);
			}
		}
		clipContext.closePath();
	}

	clipContext.clip('evenodd');
	clipContext.drawImage(canvas, 0, 0);

	return clipCanvas.convertToBlob({ type: 'image/png' });
};
