import {
	checkAgainstBounds,
	currentBounds,
	setClippingBounds,
	snapBounds,
	updateCurrentBounds
} from '../utils/bounds';
import { afterEach, describe, expect, it } from 'vitest';

import type { Bounds } from '../types';

// Reset module-level state between tests
afterEach(() => {
	setClippingBounds(undefined);
	updateCurrentBounds([0, 0, 1, 1]); // reset currentBounds to a known value
	setClippingBounds(undefined); // clear again after updateCurrentBounds
});

describe('snapBounds', () => {
	it('returns snapped bounds that fully contain the viewport', () => {
		const viewport: Bounds = [10, 40, 20, 50];
		const snapped = snapBounds(viewport);

		// Snapped bounds must contain the original viewport
		expect(snapped[0]).toBeLessThanOrEqual(viewport[0]);
		expect(snapped[1]).toBeLessThanOrEqual(viewport[1]);
		expect(snapped[2]).toBeGreaterThanOrEqual(viewport[2]);
		expect(snapped[3]).toBeGreaterThanOrEqual(viewport[3]);
	});

	it('snaps to tile boundaries (values align to tile grid)', () => {
		const viewport: Bounds = [5, 30, 15, 50];
		const snapped = snapBounds(viewport);

		// Result should be aligned; a small pan should produce the same snap
		const slightlyPanned: Bounds = [5.1, 30.1, 15.1, 50.1];
		const snapped2 = snapBounds(slightlyPanned);

		expect(snapped).toEqual(snapped2);
	});

	it('returns [-180, lat, 180, lat] for full-world longitude span', () => {
		const viewport: Bounds = [-180, -60, 180, 60];
		const snapped = snapBounds(viewport);

		expect(snapped[0]).toBe(-180);
		expect(snapped[2]).toBe(180);
	});

	it('returns [-180, lat, 180, lat] for longitude span exceeding 360', () => {
		const viewport: Bounds = [-200, -30, 200, 30];
		const snapped = snapBounds(viewport);

		expect(snapped[0]).toBe(-180);
		expect(snapped[2]).toBe(180);
	});

	it('handles a narrow viewport (high zoom)', () => {
		const viewport: Bounds = [10, 47, 11, 48];
		const snapped = snapBounds(viewport);

		expect(snapped[0]).toBeLessThanOrEqual(10);
		expect(snapped[1]).toBeLessThanOrEqual(47);
		expect(snapped[2]).toBeGreaterThanOrEqual(11);
		expect(snapped[3]).toBeGreaterThanOrEqual(48);
	});

	it('handles bounds crossing the antimeridian', () => {
		const viewport: Bounds = [170, -10, 190, 10];
		const snapped = snapBounds(viewport);

		// Should contain the viewport
		expect(snapped[0]).toBeLessThanOrEqual(170);
		expect(snapped[2]).toBeGreaterThanOrEqual(190);
	});

	it('returns valid latitude bounds within Mercator limits', () => {
		const viewport: Bounds = [-180, -85, 180, 85];
		const snapped = snapBounds(viewport);

		expect(snapped[1]).toBeGreaterThanOrEqual(-90);
		expect(snapped[3]).toBeLessThanOrEqual(90);
	});

	it('falls back to full-world when tile range covers all tiles', () => {
		// A very wide viewport that spans almost 360 degrees
		const viewport: Bounds = [-170, -40, 170, 40];
		const snapped = snapBounds(viewport);

		// At z=0 (one tile), the tile range covers the full world
		expect(snapped[0]).toBe(-180);
		expect(snapped[2]).toBe(180);
	});
});

describe('setClippingBounds', () => {
	it('sets clipping bounds that updateCurrentBounds uses', () => {
		setClippingBounds([0, 0, 50, 50]);
		updateCurrentBounds([-10, -10, 60, 60]);

		// currentBounds should be constrained to [0, 0, 50, 50]
		expect(currentBounds![0]).toBeGreaterThanOrEqual(0);
		expect(currentBounds![1]).toBeGreaterThanOrEqual(0);
		expect(currentBounds![2]).toBeLessThanOrEqual(50);
		expect(currentBounds![3]).toBeLessThanOrEqual(50);
	});

	it('clears clipping bounds when set to undefined', () => {
		setClippingBounds([0, 0, 10, 10]);
		setClippingBounds(undefined);
		updateCurrentBounds([-50, -50, 50, 50]);

		// Without clipping, snapped bounds can exceed [0,0,10,10]
		const snapped = snapBounds([-50, -50, 50, 50]);
		expect(currentBounds).toEqual(snapped);
	});

	it('is idempotent for identical bounds', () => {
		setClippingBounds([10, 20, 30, 40]);
		updateCurrentBounds([0, 0, 50, 50]);
		const first = currentBounds;

		// Set again with same values — should be a no-op
		setClippingBounds([10, 20, 30, 40]);
		updateCurrentBounds([0, 0, 50, 50]);
		expect(currentBounds).toEqual(first);
	});
});

describe('updateCurrentBounds', () => {
	it('updates the exported currentBounds', () => {
		updateCurrentBounds([5, 10, 15, 20]);
		expect(currentBounds).toBeDefined();
	});

	it('applies snapBounds before setting currentBounds', () => {
		updateCurrentBounds([5, 40, 15, 50]);

		// currentBounds should be the snapped version, not the raw input
		const snapped = snapBounds([5, 40, 15, 50]);
		expect(currentBounds).toEqual(snapped);
	});

	it('constrains to clipping bounds when set', () => {
		setClippingBounds([0, 0, 20, 60]);
		updateCurrentBounds([-10, 30, 30, 70]);

		expect(currentBounds![0]).toBeGreaterThanOrEqual(0);
		expect(currentBounds![2]).toBeLessThanOrEqual(20);
		expect(currentBounds![3]).toBeLessThanOrEqual(60);
	});
});

describe('checkAgainstBounds', () => {
	describe('normal range (max >= min)', () => {
		it('returns false when point is within bounds', () => {
			expect(checkAgainstBounds(5, 0, 10)).toBe(false);
		});

		it('returns false when point equals min', () => {
			expect(checkAgainstBounds(0, 0, 10)).toBe(false);
		});

		it('returns false when point equals max', () => {
			expect(checkAgainstBounds(10, 0, 10)).toBe(false);
		});

		it('returns true when point is below min', () => {
			expect(checkAgainstBounds(-1, 0, 10)).toBe(true);
		});

		it('returns true when point is above max', () => {
			expect(checkAgainstBounds(11, 0, 10)).toBe(true);
		});
	});

	describe('wrapped range (max < min, e.g. antimeridian)', () => {
		// When max < min, the valid range wraps: [min..360] ∪ [0..max]
		it('returns false when point is above min', () => {
			expect(checkAgainstBounds(170, 160, 10)).toBe(false);
		});

		it('returns false when point is below max', () => {
			expect(checkAgainstBounds(5, 160, 10)).toBe(false);
		});

		it('returns true when point is in the gap between max and min', () => {
			expect(checkAgainstBounds(50, 160, 10)).toBe(true);
		});

		it('returns false when point equals min', () => {
			expect(checkAgainstBounds(160, 160, 10)).toBe(false);
		});

		it('returns false when point equals max', () => {
			expect(checkAgainstBounds(10, 160, 10)).toBe(false);
		});
	});
});
