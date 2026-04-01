import { constrainBounds } from '../utils/bounds';
import { describe, expect, it } from 'vitest';

import { Bounds } from '../types';

describe('constrainBounds', () => {
	describe('standard bounds', () => {
		it('should return the same bounds when fully within constraint', () => {
			const bounds: Bounds = [-50, -30, 50, 30];
			const clip: Bounds = [-180, -90, 180, 90];

			expect(constrainBounds(bounds, clip)).toEqual([-50, -30, 50, 30]);
		});

		it('should clip minLon to constraint minLon', () => {
			const bounds: Bounds = [-100, -30, 50, 30];
			const clip: Bounds = [-80, -90, 180, 90];

			expect(constrainBounds(bounds, clip)).toEqual([-80, -30, 50, 30]);
		});

		it('should clip maxLon to constraint maxLon', () => {
			const bounds: Bounds = [-50, -30, 100, 30];
			const clip: Bounds = [-180, -90, 80, 90];

			expect(constrainBounds(bounds, clip)).toEqual([-50, -30, 80, 30]);
		});

		it('should clip minLat to constraint minLat', () => {
			const bounds: Bounds = [-50, -100, 50, 30];
			const clip: Bounds = [-180, -90, 180, 90];

			expect(constrainBounds(bounds, clip)).toEqual([-50, -90, 50, 30]);
		});

		it('should clip maxLat to constraint maxLat', () => {
			const bounds: Bounds = [-50, -30, 50, 100];
			const clip: Bounds = [-180, -90, 180, 90];

			expect(constrainBounds(bounds, clip)).toEqual([-50, -30, 50, 90]);
		});

		it('should clip all values when bounds exceed constraint on all sides', () => {
			const bounds: Bounds = [-100, -50, 100, 50];
			const clip: Bounds = [-80, -40, 80, 40];

			expect(constrainBounds(bounds, clip)).toEqual([-80, -40, 80, 40]);
		});

		it('should return exact constraint when bounds match exactly', () => {
			const bounds: Bounds = [-180, -90, 180, 90];
			const clip: Bounds = [-180, -90, 180, 90];

			expect(constrainBounds(bounds, clip)).toEqual([-180, -90, 180, 90]);
		});

		it('should handle partial overlap', () => {
			const bounds: Bounds = [-100, -50, 50, 30];
			const clip: Bounds = [-80, -40, 80, 40];

			expect(constrainBounds(bounds, clip)).toEqual([-80, -40, 50, 30]);
		});
	});

	describe('edge cases', () => {
		it('should handle zero-width bounds', () => {
			const bounds: Bounds = [50, -30, 50, 30];
			const clip: Bounds = [-180, -90, 180, 90];

			expect(constrainBounds(bounds, clip)).toEqual([50, -30, 50, 30]);
		});

		it('should handle zero-height bounds', () => {
			const bounds: Bounds = [-50, 0, 50, 0];
			const clip: Bounds = [-180, -90, 180, 90];

			expect(constrainBounds(bounds, clip)).toEqual([-50, 0, 50, 0]);
		});
	});
});
