import { Bounds, DimensionRange } from '../types';

export interface GridPoint {
	index: number; // Index into the flat values array
	lat: number;
	lon: number;
}

export interface GridInterface {
	getLinearInterpolatedValue(values: Float32Array, lat: number, lon: number): number;

	getBounds(): Bounds;
	getCenter(): { lng: number; lat: number };
	getCoveringRanges(south: number, west: number, north: number, east: number): DimensionRange[];

	/**
	 * Iterates over all grid points, invoking the callback with the flat array index
	 * and the geographic coordinates for each point.
	 * Return `false` from the callback to stop iteration early.
	 */
	forEachPoint(callback: (point: GridPoint) => void | false): void;
}
