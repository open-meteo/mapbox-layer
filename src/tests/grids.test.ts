import { domainOptions } from '../domains';
import { LambertConformalConicProjection, RotatedLatLonProjection } from '../grids/projections';
import { RegularGrid } from '../grids/regular';
import { describe, expect, test } from 'vitest';

import type { DimensionRange, RegularGridData } from '../types';
import { ProjectedGridData } from '../types';

const dmiDomain = domainOptions.find((d) => d.value === 'dmi_harmonie_arome_europe');
const knmiDomain = domainOptions.find((d) => d.value === 'knmi_harmonie_arome_europe');

test('Test LambertConformalConicProjection for DMI', () => {
	const grid = dmiDomain?.grid as ProjectedGridData;
	const proj = new LambertConformalConicProjection(grid.projection);
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
	const grid = knmiDomain?.grid as ProjectedGridData;
	const proj = new RotatedLatLonProjection(grid.projection);
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

describe('RegularGrid', () => {
	test('constructs and computes bounds', () => {
		const grid = new RegularGrid(gridData);
		expect(grid.getBounds()).toEqual([10, 50, 20, 56]);
	});

	test('construct a new partial regular grid', () => {
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
