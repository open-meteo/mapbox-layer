import { domainOptions } from '../domains';
import { ProjectionGrid } from '../grids/projected';
import { LambertConformalConicProjection, RotatedLatLonProjection } from '../grids/projections';
import { RegularGrid } from '../grids/regular';
import { describe, expect, test } from 'vitest';

import type {
	AnyProjectionGrid,
	DimensionRange,
	LCCProjectionData,
	ProjectionGridFromGeographicOrigin,
	RegularGridData,
	RotatedLatLonProjectionData
} from '../types';

const dmiDomain = domainOptions.find((d) => d.value === 'dmi_harmonie_arome_europe');
const knmiDomain = domainOptions.find((d) => d.value === 'knmi_harmonie_arome_europe');

test('Test LambertConformalConicProjection for DMI', () => {
	const projectedGrid = dmiDomain?.grid as AnyProjectionGrid;
	const lccProjectionData = projectedGrid.projection as LCCProjectionData;
	const proj = new LambertConformalConicProjection(lccProjectionData);
	expect(proj.ρ0).toBe(0.6872809586016131);
	expect(proj.F).toBe(1.801897704650192);
	expect(proj.n).toBe(0.8241261886220157);
	expect(proj.λ0).toBe(-0.13962634015954636);
	expect(proj.R).toBe(6371229);

	expect(proj.forward(39.671, -25.421997)[0]).toBe(-1527524.6244234492);
	expect(proj.forward(39.671, -25.421997)[1]).toBe(-1588681.0428292789);

	expect(proj.reverse(-1527524.6244234492, -1588681.0428292789)[0]).toBe(39.671000000000014);
	expect(proj.reverse(-1527524.6244234492, -1588681.0428292789)[1]).toBe(-25.421996999999998);
});

test('Test RotatedLatLon for KNMI', () => {
	const projectedGrid = knmiDomain?.grid as AnyProjectionGrid;
	const rotatedLatLonProjectionData = projectedGrid.projection as RotatedLatLonProjectionData;
	const proj = new RotatedLatLonProjection(rotatedLatLonProjectionData);
	expect(proj.θ).toBe(0.9599310885968813);
	expect(proj.ϕ).toBe(-0.13962634015954636);

	expect(proj.forward(39.671, -25.421997)[0]).toBe(13.716985366241445);
	expect(proj.forward(39.671, -25.421997)[1]).toBe(13.617348599940314);
});

// Example grid data
const gridData: RegularGridData = {
	type: 'regular',
	nx: 10,
	ny: 3,
	lonMin: 10,
	latMin: 50,
	dx: 1,
	dy: 2
};

const projectedGridData: ProjectionGridFromGeographicOrigin = {
	type: 'projectedFromGeographicOrigin',
	nx: 10,
	ny: 10,
	latitude: 50,
	longitude: 10,
	dx: 10000,
	dy: 10000,
	projection: {
		λ0: 10,
		ϕ0: 50,
		ϕ1: 50,
		ϕ2: 50,
		radius: 6371229,
		name: 'LambertConformalConicProjection'
	}
};

describe('RegularGrid', () => {
	test('constructs and computes bounds', () => {
		const grid = new RegularGrid(gridData);
		expect(grid.getBounds()).toEqual([10, 50, 20, 56]);
	});

	test('construct a new partial grid', () => {
		const ranges: DimensionRange[] = [
			{ start: 0, end: 3 },
			{ start: 0, end: 4 }
		];
		const grid = new RegularGrid(gridData, ranges);
		expect(grid.getBounds()).toEqual([10, 50, 14, 56]);
	});

	test('computes center', () => {
		const grid = new RegularGrid(gridData);
		const center = grid.getCenter();
		expect(center.lng).toBe(15);
		expect(center.lat).toBe(53);
	});

	test('computes center on partial grid', () => {
		const ranges: DimensionRange[] = [
			{ start: 0, end: 3 },
			{ start: 0, end: 4 }
		];
		const grid = new RegularGrid(gridData, ranges);
		const center = grid.getCenter();
		expect(center.lng).toBe(12);
		expect(center.lat).toBe(53);
	});

	test('linear interpolation at grid point', () => {
		const grid = new RegularGrid(gridData);
		const values = new Float32Array(Array.from({ length: 30 }, (_, index) => index));
		// At (lat=52, lon=11), should be row 1, col 1 => index 11, value 11
		expect(grid.getLinearInterpolatedValue(values, 52, 11)).toBe(11);
	});

	test('linear interpolation between grid points', () => {
		const grid = new RegularGrid(gridData);
		const values = new Float32Array(Array.from({ length: 30 }, (_, index) => index));
		// Between (52, 11) and (52, 12): should interpolate between index 11 and 12
		const interpolated = grid.getLinearInterpolatedValue(values, 52, 11.5);
		expect(interpolated).toBeCloseTo(11.5);
	});

	test('returns NaN for out-of-bounds', () => {
		const grid = new RegularGrid(gridData);
		const values = new Float32Array(Array.from({ length: 30 }, (_, index) => index));
		expect(grid.getLinearInterpolatedValue(values, 100, 100)).toBeNaN();
	});

	test('getCoveringRanges returns correct ranges', () => {
		const grid = new RegularGrid(gridData);
		// TODO: The behavior of getCoveringRanges can surely be improved
		const ranges = grid.getCoveringRanges(52, 12, 55, 12.5);
		expect(ranges[0].start).toBe(0);
		expect(ranges[0].end).toBe(gridData.ny);
		expect(ranges[1].start).toBe(1);
		expect(ranges[1].end).toBe(4);
	});
});

describe('ProjectionGrid', () => {
	test('construction, bounds and center', () => {
		const grid = new ProjectionGrid(projectedGridData);
		const bounds = grid.getBounds();
		expect(bounds).toHaveLength(4);
		expect(bounds[0]).toBeCloseTo(10, 3);
		expect(bounds[1]).toBeCloseTo(49.992, 3); // latMin is a bit smaller than the specified latMin, because it is matched the next available value on the projection grid ???
		expect(bounds[2]).toBeCloseTo(11.426, 3); // approximate longitude max
		expect(bounds[3]).toBeCloseTo(50.899, 3); // approximate latitude max

		const center = grid.getCenter();
		expect(center.lng).toBeCloseTo(10.71, 2);
		expect(center.lat).toBeCloseTo(50.45, 2);
	});

	test('construction, bounds and center for partial grid', () => {
		const ranges: DimensionRange[] = [
			{ start: 0, end: 5 },
			{ start: 0, end: 5 }
		];
		const grid = new ProjectionGrid(projectedGridData, ranges);
		const bounds = grid.getBounds();
		// bounds should be smaller than the full grid
		expect(bounds).toHaveLength(4);
		expect(bounds[0]).toBeCloseTo(10, 3);
		expect(bounds[1]).toBeCloseTo(49.998, 3); // FIXME: Why is this not the same as above?
		expect(bounds[2]).toBeCloseTo(10.706, 3); // approximate longitude max
		expect(bounds[3]).toBeCloseTo(50.45, 3); // approximate latitude max

		const center = grid.getCenter();
		expect(center.lng).toBeCloseTo(10.35, 2);
		expect(center.lat).toBeCloseTo(50.22, 2);
	});

	test('linear interpolation at projected grid point', () => {
		const grid = new ProjectionGrid(projectedGridData);
		const values = new Float32Array(Array.from({ length: 100 }, (_, index) => index));

		// Test a point that should be within the grid
		const result = grid.getLinearInterpolatedValue(values, 50.001, 10.001);
		expect(result).toBeCloseTo(0.118, 3);
	});

	test('returns NaN for out-of-bounds in projected grid', () => {
		const grid = new ProjectionGrid(projectedGridData);
		const values = new Float32Array(Array.from({ length: 100 }, (_, index) => index));

		// Test points outside the grid
		expect(grid.getLinearInterpolatedValue(values, 48, 10)).toBeNaN();
	});

	// test('getBorderPoints generates correct number of points', () => {
	// 	const grid = new ProjectionGrid(projectedGridData);
	// 	const borderPoints = grid.getBorderPoints();

	// 	// Should have points for all 4 sides of the grid perimeter
	// 	// ny + nx + ny + nx = 2*(ny + nx) = 2*(10 + 10) = 40
	// 	expect(borderPoints.length).toBe(40);

	// 	// Each point should be a 2D coordinate
	// 	borderPoints.forEach((point) => {
	// 		expect(point).toHaveLength(2);
	// 		expect(typeof point[0]).toBe('number');
	// 		expect(typeof point[1]).toBe('number');
	// 	});
	// });

	// test('getBoundsFromBorderPoints works correctly', () => {
	// 	const grid = new ProjectionGrid(projectedGridData);
	// 	const borderPoints = [
	// 		[0, 0],
	// 		[1000, 0],
	// 		[1000, 1000],
	// 		[0, 1000]
	// 	];
	// 	const bounds = grid.getBoundsFromBorderPoints(borderPoints);

	// 	expect(bounds).toHaveLength(4);
	// 	expect(bounds[0]).toBeLessThan(bounds[2]); // minLon < maxLon
	// 	expect(bounds[1]).toBeLessThan(bounds[3]); // minLat < maxLat
	// });

	// test('getCenterFromBounds calculates correct center', () => {
	// 	const grid = new ProjectionGrid(projectedGridData);
	// 	const bounds: Bounds = [10, 50, 12, 52]; // [minLon, minLat, maxLon, maxLat]
	// 	const center = grid.getCenterFromBounds(bounds);

	// 	expect(center.lng).toBe(11);
	// 	expect(center.lat).toBe(51);
	// });

	test('getCoveringRanges returns valid ranges', () => {
		const grid = new ProjectionGrid(projectedGridData);
		const ranges = grid.getCoveringRanges(49.9, 9.9, 50.1, 10.1);

		expect(ranges).toHaveLength(2);
		expect(ranges[0].start).toBeGreaterThanOrEqual(0);
		expect(ranges[0].end).toBeLessThanOrEqual(projectedGridData.ny);
		expect(ranges[1].start).toBeGreaterThanOrEqual(0);
		expect(ranges[1].end).toBeLessThanOrEqual(projectedGridData.nx);
		expect(ranges[0].start).toBeLessThanOrEqual(ranges[0].end);
		expect(ranges[1].start).toBeLessThanOrEqual(ranges[1].end);
	});
});
