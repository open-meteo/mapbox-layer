import { GridInterface } from '../grids';
import Pbf from 'pbf';

import { VECTOR_TILE_EXTENT } from './constants';
import { lat2tile, lon2tile } from './math';
import { command, writeLayer, zigzag } from './pbf';

export const generateGridPoints = (
	pbf: Pbf,
	values: Float32Array,
	directions: Float32Array | undefined,
	grid: GridInterface,
	x: number,
	y: number,
	z: number,
	extent: number = VECTOR_TILE_EXTENT,
	margin: number = 0
) => {
	const features: Array<{
		id: number;
		type: number;
		properties: { value?: number; direction?: number };
		geom: number[];
	}> = [];

	grid.forEachPoint(({ index, lat, lon }) => {
		const worldPy = Math.floor(lat2tile(lat, z) * extent);
		const py = worldPy - y * extent;
		if (py <= -margin || py > extent + margin) return;

		const worldPx = Math.floor(lon2tile(lon, z) * extent);
		const px = worldPx - x * extent;
		if (px <= -margin || px > extent + margin) return;

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
	});

	// write Layer
	pbf.writeMessage(3, writeLayer, {
		name: 'grid',
		extent,
		features: features
	});
};
