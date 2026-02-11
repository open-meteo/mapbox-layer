import { lat2tile, lon2tile, normalizeLon } from './math';

import { Bounds, ClippingOptions, GeoJson, GeoJsonGeometry } from '../types';

export type ResolvedClipping = {
	polygons?: ReadonlyArray<ReadonlyArray<number[]>>;
	bounds?: Bounds;
};

export const resolveClippingOptions = (options: ClippingOptions): ResolvedClipping | undefined => {
	if (!options) return undefined;

	const polygons: [number, number][][] = [];
	let bounds = options.bounds;

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

		const unwrapped: [number, number][] = [[points[0][0], points[0][1]]];
		let prevLon = points[0][0];
		for (let i = 1; i < points.length; i++) {
			const [lon, lat] = points[i];
			const delta = lon - prevLon;
			const shift = Math.round(delta / 360) * -360;
			const adjustedLon = lon + shift;
			unwrapped.push([adjustedLon, lat]);
			prevLon = adjustedLon;
		}

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
	}

	if (options.geojson) {
		const extendBounds = (lon: number, lat: number) => {
			if (!bounds) {
				bounds = [lon, lat, lon, lat];
				return;
			}
			if (lon < bounds[0]) bounds[0] = lon;
			if (lat < bounds[1]) bounds[1] = lat;
			if (lon > bounds[2]) bounds[2] = lon;
			if (lat > bounds[3]) bounds[3] = lat;
		};

		const addRing = (ring: [number, number][]) => {
			const splitRings = splitRingAtDateline(ring);
			for (const splitRing of splitRings) {
				polygons.push(splitRing);
				for (const [lon, lat] of splitRing) {
					extendBounds(lon, lat);
				}
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
			}
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

	if (!bounds && polygons.length > 0) {
		for (const ring of polygons) {
			for (const [lon, lat] of ring) {
				if (!bounds) {
					bounds = [lon, lat, lon, lat];
					continue;
				}
				if (lon < bounds[0]) bounds[0] = lon;
				if (lat < bounds[1]) bounds[1] = lat;
				if (lon > bounds[2]) bounds[2] = lon;
				if (lat > bounds[3]) bounds[3] = lat;
			}
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
