import { GaussianGrid as ExistingGaussianGrid } from './utils/gaussian';
import { interpolateLinear } from './utils/interpolations';
import { getCenterFromBounds, getCenterFromGrid, getIndexFromLatLong } from './utils/math';
import {
	DynamicProjection,
	Projection,
	ProjectionGrid,
	ProjectionName,
	getBorderPoints,
	getBoundsFromBorderPoints,
	getBoundsFromGrid
} from './utils/projections';

import { Bounds, DimensionRange, Domain } from './types';

export interface GridBehavior {
	getLinearInterpolatedValue(
		values: Float32Array,
		lat: number,
		lon: number,
		ranges: DimensionRange[] | null
	): number;

	getBounds(): Bounds;
	getCenter(): { lng: number; lat: number };
}

// Regular grid implementation
class RegularGrid implements GridBehavior {
	constructor(private data: Domain['grid']) {}

	getLinearInterpolatedValue(
		values: Float32Array,
		lat: number,
		lon: number,
		ranges: DimensionRange[] | null
	): number {
		const defaultRanges = ranges || [
			{ start: 0, end: this.data.ny },
			{ start: 0, end: this.data.nx }
		];

		const bounds = this.getBounds();
		const idx = getIndexFromLatLong(
			lat,
			lon,
			this.data.dx,
			this.data.dy,
			defaultRanges[1].end - defaultRanges[1].start,
			[bounds[1], bounds[0], bounds[3], bounds[2]] // [minLat, minLon, maxLat, maxLon]
		);

		return interpolateLinear(values, idx.index, idx.xFraction, idx.yFraction, defaultRanges);
	}

	getBounds(): Bounds {
		return getBoundsFromGrid(
			this.data.lonMin,
			this.data.latMin,
			this.data.dx,
			this.data.dy,
			this.data.nx,
			this.data.ny
		);
	}

	getCenter(): { lng: number; lat: number } {
		return getCenterFromGrid(this.data);
	}
}

// Projected grid implementation
class ProjectedGrid implements GridBehavior {
	private projection: Projection;
	private projectionGrid: ProjectionGrid;

	constructor(private data: Domain['grid']) {
		// Create projection using existing system
		this.projection = new DynamicProjection(
			data.projection!.name as ProjectionName,
			data.projection
		) as Projection;

		// Create projection grid using existing system
		this.projectionGrid = new ProjectionGrid(this.projection, data);
	}

	getLinearInterpolatedValue(
		values: Float32Array,
		lat: number,
		lon: number,
		ranges: DimensionRange[] | null
	): number {
		const defaultRanges = ranges || [
			{ start: 0, end: this.data.ny },
			{ start: 0, end: this.data.nx }
		];

		const idx = this.projectionGrid.findPointInterpolated(lat, lon, defaultRanges);
		return interpolateLinear(values, idx.index, idx.xFraction, idx.yFraction, defaultRanges);
	}

	getBounds(): Bounds {
		const borderPoints = getBorderPoints(this.projectionGrid);
		return getBoundsFromBorderPoints(borderPoints, this.projection);
	}

	getCenter(): { lng: number; lat: number } {
		const bounds = this.getBounds();
		return getCenterFromBounds(bounds);
	}
}
// Gaussian grid implementation (you'll need to implement this based on your existing logic)
class GaussianGrid implements GridBehavior {
	private gaussianGrid: ExistingGaussianGrid;

	constructor(data: Domain['grid']) {
		this.gaussianGrid = new ExistingGaussianGrid(data.gaussianGridLatitudeLines!);
	}

	getLinearInterpolatedValue(
		values: Float32Array,
		lat: number,
		lon: number,
		ranges: DimensionRange[] | null
	): number {
		// Use your existing gaussian interpolation
		return this.gaussianGrid.getLinearInterpolatedValue(values, lat, lon);
	}

	getBounds(): Bounds {
		// global for now
		return [-180, -90, 180, 90];
	}

	getCenter(): { lng: number; lat: number } {
		// FIXME: Center hardcoded for now
		return { lng: 0, lat: 0 };
	}
}

export class GridFactory {
	static create(data: Domain['grid']): GridBehavior {
		if (data.gaussianGridLatitudeLines) {
			return new GaussianGrid(data);
		} else if (data.projection) {
			return new ProjectedGrid(data);
		} else {
			return new RegularGrid(data);
		}
	}
}
