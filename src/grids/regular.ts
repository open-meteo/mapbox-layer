import { interpolateLinear } from '../utils/interpolations';
import { getCenterFromGrid, getIndexFromLatLong } from '../utils/math';

import { GridInterface } from './interface';

import { Bounds, DimensionRange, RegularGridData } from '../types';

// Regular grid implementation
export class RegularGrid implements GridInterface {
	private data: RegularGridData;
	private _bounds: Bounds;
	private _ranges: DimensionRange[];
	private _center?: { lng: number; lat: number };

	constructor(data: RegularGridData, ranges: DimensionRange[] | null = null) {
		this.data = data;
		if (!ranges) {
			ranges = [
				{ start: 0, end: data.ny },
				{ start: 0, end: data.nx }
			];
		}
		this._ranges = ranges;
		const lonMin = data.lonMin + data.dx * ranges[1]['start'];
		const latMin = data.latMin + data.dy * ranges[0]['start'];
		const lonMax = data.lonMin + data.dx * ranges[1]['end'];
		const latMax = data.latMin + data.dy * ranges[0]['end'];
		this._bounds = [lonMin, latMin, lonMax, latMax];
	}

	getLinearInterpolatedValue(values: Float32Array, lat: number, lon: number): number {
		const idx = getIndexFromLatLong(
			lat,
			lon,
			this.data.dx,
			this.data.dy,
			this._ranges[1].end - this._ranges[1].start,
			this._bounds
		);

		return interpolateLinear(
			values,
			idx.index,
			idx.xFraction,
			idx.yFraction,
			this._ranges[1].end - this._ranges[1].start
		);
	}

	getBounds(): Bounds {
		return this._bounds;
	}

	getCenter(): { lng: number; lat: number } {
		if (!this._center) {
			this._center = getCenterFromGrid(this.data);
		}
		return this._center;
	}

	getRangeCovering(south: number, west: number, north: number, east: number): DimensionRange[] {
		const dx = this.data.dx;
		const dy = this.data.dy;
		const nx = this.data.nx;
		const ny = this.data.ny;

		let xPrecision, yPrecision;
		if (String(dx).split('.')[1]) {
			xPrecision = String(dx).split('.')[1].length;
			yPrecision = String(dy).split('.')[1].length;
		} else {
			xPrecision = 2;
			yPrecision = 2;
		}

		const originX = this.data.lonMin;
		const originY = this.data.latMin;

		const s = Number((south - (south % dy)).toFixed(yPrecision));
		const w = Number((west - (west % dx)).toFixed(xPrecision));
		const n = Number((north - (north % dy) + dy).toFixed(yPrecision));
		const e = Number((east - (east % dx) + dx).toFixed(xPrecision));

		let minX: number, minY: number, maxX: number, maxY: number;

		if (s - originY < 0) {
			minY = 0;
		} else {
			minY = Math.floor(Math.max((s - originY) / dy - 1, 0));
		}

		if (w - originX < 0) {
			minX = 0;
		} else {
			minX = Math.floor(Math.max((w - originX) / dx - 1, 0));
		}

		if (n - originY < 0) {
			maxY = ny;
		} else {
			maxY = Math.ceil(Math.min((n - originY) / dy + 1, ny));
		}

		if (e - originX < 0) {
			maxX = nx;
		} else {
			maxX = Math.ceil(Math.min((e - originX) / dx + 1, nx));
		}
		const ranges = [
			{ start: minY, end: maxY },
			{ start: minX, end: maxX }
		];
		return ranges;
	}
}
