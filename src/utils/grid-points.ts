import { GridInterface } from '../grids';
import Pbf from 'pbf';

import { Bounds } from '../types';

import { constrainBounds } from './bounds';
import { VECTOR_TILE_EXTENT } from './constants';
import { lat2tile, lon2tile } from './math';
import { command, writeLayer, zigzag } from './pbf';

/**
 * Precomputed world-pixel coordinates for a single grid point.
 */
export interface CachedGridPoint {
	index: number;
	worldPx: number;
	worldPy: number;
}

// Module-level cache for precomputed grid-point world coordinates.
// Keyed by grid config + ranges + zoom so it's reused across tiles at the same zoom.
let _gridPointCache: CachedGridPoint[] | undefined;
let _gridPointCacheKey: string | undefined;

/**
 * Return cached world-pixel coordinates for all grid points at a given zoom level,
 * recomputing only when the grid config, ranges, or zoom level changes.
 * The `cacheKey` should uniquely identify the grid + ranges + zoom combination.
 */
export const prepareGridPoints = (
	grid: GridInterface,
	z: number,
	cacheKey: string,
	extent: number = VECTOR_TILE_EXTENT
): CachedGridPoint[] => {
	if (cacheKey === _gridPointCacheKey && _gridPointCache) {
		return _gridPointCache;
	}

	const points: CachedGridPoint[] = [];
	grid.forEachPoint(({ index, lat, lon }) => {
		const worldPx = Math.floor(lon2tile(lon, z) * extent);
		const worldPy = Math.floor(lat2tile(lat, z) * extent);
		points.push({ index, worldPx, worldPy });
	});

	_gridPointCache = points;
	_gridPointCacheKey = cacheKey;
	return points;
};

/**
 * Generate the PBF grid-point layer for a single tile from precomputed points.
 * Points are filtered to the intersection of `currentBounds` and `clippingBounds`
 * when provided. Either bound may be omitted independently.
 */
export const generateGridPoints = (
	pbf: Pbf,
	values: Float32Array,
	directions: Float32Array | undefined,
	cachedPoints: CachedGridPoint[],
	x: number,
	y: number,
	z: number,
	currentBounds?: Bounds,
	clippingBounds?: Bounds,
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

	// Compute effective bounds: intersection of viewport and clipping bounds.
	let effectiveBounds: Bounds | undefined;
	if (currentBounds && clippingBounds) {
		effectiveBounds = constrainBounds(currentBounds, clippingBounds);
	} else {
		effectiveBounds = currentBounds ?? clippingBounds;
	}

	// Pre-compute effective bounds in world-pixel space for fast rejection.
	let boundsMinPx: number | undefined,
		boundsMaxPx: number | undefined,
		boundsMinPy: number | undefined,
		boundsMaxPy: number | undefined;
	if (effectiveBounds) {
		boundsMinPx = Math.floor(lon2tile(effectiveBounds[0], z) * extent);
		boundsMaxPx = Math.ceil(lon2tile(effectiveBounds[2], z) * extent);
		// lat2tile is inverted (higher lat → smaller tile y)
		boundsMinPy = Math.floor(lat2tile(effectiveBounds[3], z) * extent);
		boundsMaxPy = Math.ceil(lat2tile(effectiveBounds[1], z) * extent);
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
