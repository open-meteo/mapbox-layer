import { lat2tile, lon2tile } from './math';

import { Bounds, ClippingOptions, GeoJson, GeoJsonGeometry } from '../types';

export type ResolvedClipping = {
	polygons?: ReadonlyArray<ReadonlyArray<number[]>>;
	bounds?: Bounds;
};

export const resolveClippingOptions = (options: ClippingOptions): ResolvedClipping | undefined => {
	if (!options) return undefined;

	const polygons: [number, number][][] = [];
	let bounds = options.bounds;

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
			polygons.push(ring);
			for (const [lon, lat] of ring) {
				extendBounds(lon, lat);
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
