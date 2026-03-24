import { resolveClippingOptions } from '../utils/clipping';
import { describe, expect, test } from 'vitest';

describe('resolveClippingOptions - bounds computation', () => {
	test('non-crossing polygon produces standard bounds', () => {
		const result = resolveClippingOptions({
			geojson: {
				type: 'Feature',
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[10, 50],
							[20, 50],
							[20, 60],
							[10, 60],
							[10, 50]
						]
					]
				}
			}
		});
		expect(result?.bounds).toEqual([10, 50, 20, 60]);
	});

	test('explicit bounds are preserved when polygons are also provided', () => {
		const result = resolveClippingOptions({
			bounds: [0, 0, 10, 10],
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
		expect(result?.bounds).toEqual([0, 0, 10, 10]);
	});

	test('global-spanning polygon produces full globe bounds', () => {
		// A polygon that wraps entirely around the globe
		const result = resolveClippingOptions({
			geojson: {
				type: 'Feature',
				geometry: {
					type: 'Polygon',
					coordinates: [
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
				}
			}
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
