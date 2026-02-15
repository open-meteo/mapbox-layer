import { describe, expect, test } from 'vitest';

import { resolveClippingOptions, unwrapLongitudes } from '../utils/clipping';

describe('unwrapLongitudes', () => {
	test('no wrapping needed for standard ring', () => {
		const ring: [number, number][] = [
			[10, 50],
			[20, 50],
			[20, 60],
			[10, 60]
		];
		expect(unwrapLongitudes(ring)).toEqual(ring);
	});

	test('unwraps eastward dateline crossing', () => {
		const ring: [number, number][] = [
			[170, 50],
			[175, 50],
			[-175, 50],
			[-170, 50]
		];
		const unwrapped = unwrapLongitudes(ring);
		expect(unwrapped).toEqual([
			[170, 50],
			[175, 50],
			[185, 50],
			[190, 50]
		]);
	});

	test('unwraps westward dateline crossing', () => {
		const ring: [number, number][] = [
			[-170, 50],
			[-175, 50],
			[175, 50],
			[170, 50]
		];
		const unwrapped = unwrapLongitudes(ring);
		expect(unwrapped).toEqual([
			[-170, 50],
			[-175, 50],
			[-185, 50],
			[-190, 50]
		]);
	});

	test('empty ring returns empty', () => {
		expect(unwrapLongitudes([])).toEqual([]);
	});

	test('single point returns copy', () => {
		expect(unwrapLongitudes([[10, 50]])).toEqual([[10, 50]]);
	});
});

describe('resolveClippingOptions - bounds computation', () => {
	test('non-crossing polygon produces standard bounds', () => {
		const result = resolveClippingOptions({
			polygons: [
				[
					[10, 50],
					[20, 50],
					[20, 60],
					[10, 60],
					[10, 50]
				]
			]
		});
		expect(result?.bounds).toEqual([10, 50, 20, 60]);
	});

	test('dateline-crossing polygon produces wrapped bounds (minLon > maxLon)', () => {
		const result = resolveClippingOptions({
			polygons: [
				[
					[170, 50],
					[175, 50],
					[-175, 50],
					[-170, 50],
					[170, 50]
				]
			]
		});
		expect(result?.bounds).toBeDefined();
		const [minLon, minLat, maxLon, maxLat] = result!.bounds!;
		expect(minLon).toBe(170);
		expect(maxLon).toBe(-170);
		expect(minLon).toBeGreaterThan(maxLon); // dateline-crossing convention
		expect(minLat).toBe(50);
		expect(maxLat).toBe(50);
	});

	test('dateline-crossing GeoJSON polygon produces wrapped bounds', () => {
		const result = resolveClippingOptions({
			geojson: {
				type: 'Feature',
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[170, 50],
							[175, 50],
							[-175, 50],
							[-170, 50],
							[170, 50]
						]
					]
				}
			}
		});
		expect(result?.bounds).toBeDefined();
		const [minLon, , maxLon] = result!.bounds!;
		expect(minLon).toBe(170);
		expect(maxLon).toBe(-170);
		expect(minLon).toBeGreaterThan(maxLon);
	});

	test('GeoJSON MultiPolygon crossing dateline produces wrapped bounds', () => {
		const result = resolveClippingOptions({
			geojson: {
				type: 'Feature',
				geometry: {
					type: 'MultiPolygon',
					coordinates: [
						[
							[
								[170, 40],
								[180, 40],
								[180, 50],
								[170, 50],
								[170, 40]
							]
						],
						[
							[
								[-180, 40],
								[-170, 40],
								[-170, 50],
								[-180, 50],
								[-180, 40]
							]
						]
					]
				}
			}
		});
		expect(result?.bounds).toBeDefined();
		const [minLon, minLat, maxLon, maxLat] = result!.bounds!;
		// Both rings together span 170 to -170 across the dateline
		expect(minLon).toBe(170);
		expect(maxLon).toBe(-170);
		expect(minLat).toBe(40);
		expect(maxLat).toBe(50);
	});

	test('explicit bounds are preserved when polygons are also provided', () => {
		const result = resolveClippingOptions({
			bounds: [0, 0, 10, 10],
			polygons: [
				[
					[170, 50],
					[175, 50],
					[-175, 50],
					[-170, 50],
					[170, 50]
				]
			]
		});
		expect(result?.bounds).toEqual([0, 0, 10, 10]);
	});

	test('global-spanning polygon produces full globe bounds', () => {
		// A polygon that wraps entirely around the globe
		const result = resolveClippingOptions({
			polygons: [
				[
					[-180, -60],
					[-90, -60],
					[0, -60],
					[90, -60],
					[180, -60],
					[180, 60],
					[90, 60],
					[0, 60],
					[-90, 60],
					[-180, 60],
					[-180, -60]
				]
			]
		});
		expect(result?.bounds).toBeDefined();
		const [minLon, minLat, maxLon, maxLat] = result!.bounds!;
		expect(minLon).toBe(-180);
		expect(maxLon).toBe(180);
		expect(minLat).toBe(-60);
		expect(maxLat).toBe(60);
	});

	test('undefined options returns undefined', () => {
		expect(resolveClippingOptions(undefined)).toBeUndefined();
	});
});
