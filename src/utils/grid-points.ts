import { GridInterface } from '../grids';
import Pbf from 'pbf';

import { VECTOR_TILE_EXTENT } from './constants';
import { lat2tile, lon2tile } from './math';
import { command, writeLayer, zigzag } from './pbf';

import { Bounds } from '../types';

/**
 * Precomputed world-pixel coordinates for a single grid point.
 */
export interface CachedGridPoint {
	index: number;
	worldPx: number;
	worldPy: number;
}

/**
 * Precompute world-pixel coordinates for all grid points at a given zoom level.
 * This is independent of which tile is being rendered and can be reused
 * across all tiles at the same zoom level.
 */
export const prepareGridPoints = (
	grid: GridInterface,
	z: number,
	extent: number = VECTOR_TILE_EXTENT
): CachedGridPoint[] => {
	const points: CachedGridPoint[] = [];

	grid.forEachPoint(({ index, lat, lon }) => {
		const worldPx = Math.floor(lon2tile(lon, z) * extent);
		const worldPy = Math.floor(lat2tile(lat, z) * extent);
		points.push({ index, worldPx, worldPy });
	});

	return points;
};

/**
 * Generate the PBF grid-point layer for a single tile from precomputed points.
 * When `bounds` is provided, only points within those geographic bounds are emitted.
 */
export const generateGridPoints = (
	pbf: Pbf,
	values: Float32Array,
	directions: Float32Array | undefined,
	cachedPoints: CachedGridPoint[],
	x: number,
	y: number,
	z: number,
	bounds?: Bounds,
	extent: number = VECTOR_TILE_EXTENT,
	margin: number = 0
) => {
	const features: Array<{
		id: number;
		type: number;
		properties: { value?: number; direction?: number };
		geom: number[];
	}> = [];

	const tileOffsetX = x * extent;
	const tileOffsetY = y * extent;

	// Pre-compute bounds in world-pixel space for fast rejection.
	let boundsMinPx: number | undefined,
		boundsMaxPx: number | undefined,
		boundsMinPy: number | undefined,
		boundsMaxPy: number | undefined;
	if (bounds) {
		boundsMinPx = Math.floor(lon2tile(bounds[0], z) * extent);
		boundsMaxPx = Math.ceil(lon2tile(bounds[2], z) * extent);
		// lat2tile is inverted (higher lat → smaller tile y)
		boundsMinPy = Math.floor(lat2tile(bounds[3], z) * extent);
		boundsMaxPy = Math.ceil(lat2tile(bounds[1], z) * extent);
	}

	for (const { index, worldPx, worldPy } of cachedPoints) {
		// Bounds rejection in world-pixel space
		if (boundsMinPx !== undefined) {
			if (worldPx < boundsMinPx || worldPx > boundsMaxPx!) continue;
			if (worldPy < boundsMinPy! || worldPy > boundsMaxPy!) continue;
		}

		const px = worldPx - tileOffsetX;
		const py = worldPy - tileOffsetY;
		if (px < -margin || px > extent + margin) continue;
		if (py < -margin || py > extent + margin) continue;

		const value = values[index];
		if (isNaN(value)) continue;

		const properties: { value?: number; direction?: number } = {};
		properties.value = Number(value.toFixed(2));
		if (directions) {
			properties.direction = directions[index];
		}

		features.push({
			id: index,
			type: 1, // Point
			properties,
			geom: [command(1, 1), zigzag(px), zigzag(py)]
		});
	}

	// write Layer
	pbf.writeMessage(3, writeLayer, {
		name: 'grid',
		extent,
		features
	});
};
