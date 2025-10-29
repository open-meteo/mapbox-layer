import { interpolateLinear } from '../utils/interpolations';
import { getCenterFromBounds } from '../utils/math';

import { GridInterface } from './interface';
import {
	DynamicProjection,
	Projection,
	ProjectionGrid,
	ProjectionName,
	getBorderPoints,
	getBoundsFromBorderPoints,
	getRotatedSWNE
} from './projections';

import { Bounds, DimensionRange, ProjectedGridData } from '../types';

// Projected grid implementation
export class ProjectedGrid implements GridInterface {
	private data: ProjectedGridData;
	private projection: Projection;
	private projectionGrid: ProjectionGrid;
	private _ranges: DimensionRange[];
	private _bounds?: Bounds;
	private _center?: { lng: number; lat: number };

	constructor(data: ProjectedGridData, ranges: DimensionRange[] | null = null) {
		this.data = data;
		// Create projection using existing system
		this.projection = new DynamicProjection(
			data.projection.name as ProjectionName,
			data.projection
		) as Projection;

		// Create projection grid using existing system
		this.projectionGrid = new ProjectionGrid(this.projection, data);
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
		const idx = this.projectionGrid.findPointInterpolated(lat, lon, this._ranges);
		return interpolateLinear(
			values,
			idx.index,
			idx.xFraction,
			idx.yFraction,
			this._ranges[1].end - this._ranges[1].start
		);
	}

	getBounds(): Bounds {
		if (!this._bounds) {
			const borderPoints = getBorderPoints(this.projectionGrid);
			this._bounds = getBoundsFromBorderPoints(borderPoints, this.projection);
		}
		return this._bounds;
	}

	getCenter(): { lng: number; lat: number } {
		if (!this._center) {
			const bounds = this.getBounds();
			this._center = getCenterFromBounds(bounds);
		}
		return this._center;
	}

	getRangeCovering(south: number, west: number, north: number, east: number): DimensionRange[] {
		let dx = this.data.dx;
		let dy = this.data.dy;

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

		let [s, w, n, e] = getRotatedSWNE(this.projection, [south, west, north, east]);

		dx = this.projectionGrid.dx;
		dy = this.projectionGrid.dy;

		// round to nearest grid point + / - 1
		s = Number((s - (s % dy)).toFixed(yPrecision));
		w = Number((w - (w % dx)).toFixed(xPrecision));
		n = Number((n - (n % dy) + dy).toFixed(yPrecision));
		e = Number((e - (e % dx) + dx).toFixed(xPrecision));

		const originX = this.projectionGrid.origin[0];
		const originY = this.projectionGrid.origin[1];

		let minX: number, minY: number, maxX: number, maxY: number;

		if (dx > 0) {
			minX = Math.min(Math.max(Math.floor((w - originX) / dx - 1), 0), nx);
			maxX = Math.max(Math.min(Math.ceil((e - originX) / dx + 1), nx), 0);
		} else {
			minX = Math.min(Math.max(Math.floor((e - originX) / dx - 1), 0), nx);
			maxX = Math.max(Math.min(Math.ceil((w - originX) / dx + 1), nx), 0);
		}

		if (dy > 0) {
			minY = Math.min(Math.max(Math.floor((s - originY) / dy - 1), 0), ny);
			maxY = Math.max(Math.min(Math.ceil((n - originY) / dy + 1), ny), 0);
		} else {
			minY = Math.min(Math.max(Math.floor((n - originY) / dy - 1), 0), ny);
			maxY = Math.max(Math.min(Math.ceil((s - originY) / dy + 1), ny), 0);
		}
		const ranges = [
			{ start: minY, end: maxY },
			{ start: minX, end: maxX }
		];
		return ranges;
	}
}
