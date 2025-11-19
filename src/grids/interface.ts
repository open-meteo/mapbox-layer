import { Bounds, DimensionRange } from '../types';

export interface GridInterface {
	getLinearInterpolatedValue(values: Float32Array, lat: number, lon: number): number;

	getBounds(): Bounds;
	getIndex?(lat: number, lon: number): number;
	getCenter(): { lng: number; lat: number };
	getCoveringRanges(south: number, west: number, north: number, east: number): DimensionRange[];
}
