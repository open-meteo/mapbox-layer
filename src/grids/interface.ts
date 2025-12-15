import { Bounds, DimensionRange } from '../types';

export interface GridInterface {
	getLinearInterpolatedValue(values: Float32Array, lat: number, lon: number): number;

	getIndex(lng: number, lat: number): number | undefined;
	getLatLon(index: number): [lat: number, lon: number] | undefined;
	getCenter(): { lng: number; lat: number };
	getBounds(): Bounds;
	getCoveringRanges(south: number, west: number, north: number, east: number): DimensionRange[];
}
