import { GridInterface } from '../grids';
import Pbf from 'pbf';

import { constrainBounds } from './bounds';
import { VECTOR_TILE_EXTENT } from './constants';
import { lat2tile, lon2tile, tile2lat, tile2lon } from './math';
import { command, writeLayer, zigzag } from './pbf';

import { Bounds } from '../types';

/**
 * Generate the PBF grid-point layer for a single tile.
 * Computes tile geographic bounds and intersects with `currentBounds` and
 * `clippingBounds` to iterate only relevant grid points via `forEachPoint`.
 */
export const generateGridPoints = (
	pbf: Pbf,
	grid: GridInterface,
	values: Float32Array,
	directions: Float32Array | undefined,
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

	// Tile geographic bounds with margin.
	const marginFrac = margin / extent;
	const tileBounds: Bounds = [
		tile2lon(x - marginFrac, z),
		tile2lat(y + 1 + marginFrac, z),
		tile2lon(x + 1 + marginFrac, z),
		tile2lat(y - marginFrac, z)
	];

	// Intersect tile bounds with effective bounds for tighter iteration.
	const iterBounds: Bounds = effectiveBounds
		? [
				Math.max(tileBounds[0], effectiveBounds[0]),
				Math.max(tileBounds[1], effectiveBounds[1]),
				Math.min(tileBounds[2], effectiveBounds[2]),
				Math.min(tileBounds[3], effectiveBounds[3])
			]
		: tileBounds;

	// If the intersection is empty, skip iteration entirely.
	if (iterBounds[0] > iterBounds[2] || iterBounds[1] > iterBounds[3]) {
		pbf.writeMessage(3, writeLayer, { name: 'grid', extent, features });
		return;
	}

	grid.forEachPoint(({ index, lat, lon }) => {
		const worldPx = Math.floor(lon2tile(lon, z) * extent);
		const worldPy = Math.floor(lat2tile(lat, z) * extent);

		const px = worldPx - tileOffsetX;
		const py = worldPy - tileOffsetY;
		if (px < -margin || px > extent + margin) return;
		if (py < -margin || py > extent + margin) return;

		const value = values[index];
		if (isNaN(value)) return;

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
	}, iterBounds);

	// write Layer
	pbf.writeMessage(3, writeLayer, {
		name: 'grid',
		extent,
		features
	});
};
