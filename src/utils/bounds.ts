import { Bounds } from '../types';

/** Smallest power of 2 that is >= n (returns 1 for n <= 0) */
const ceilPow2 = (n: number): number => {
	if (n <= 0) return 1;
	return Math.pow(2, Math.ceil(Math.log2(n)));
};

/**
 * Snap bounds to a power-of-2 aligned grid based on viewport size.
 * This quantizes continuous viewport changes into discrete steps,
 * so small pans within the same grid cell produce identical bounds.
 */
export const snapBounds = (bounds: Bounds): Bounds => {
	const [minLon, minLat, maxLon, maxLat] = bounds;

	const latStep = ceilPow2(maxLat - minLat);
	const lonStep = ceilPow2(maxLon - minLon);

	return [
		Math.floor(minLon / lonStep) * lonStep,
		Math.floor(minLat / latStep) * latStep,
		Math.ceil(maxLon / lonStep) * lonStep,
		Math.ceil(maxLat / latStep) * latStep
	];
};

let clippingBounds: Bounds | undefined = undefined;
export const setClippingBounds = (newClippingBounds?: Bounds): void => {
	if (
		clippingBounds &&
		newClippingBounds &&
		clippingBounds[0] === newClippingBounds[0] &&
		clippingBounds[1] === newClippingBounds[1] &&
		clippingBounds[2] === newClippingBounds[2] &&
		clippingBounds[3] === newClippingBounds[3]
	) {
		// No change in clipping bounds
		return;
	}
	clippingBounds = newClippingBounds;
};

export let currentBounds: Bounds | undefined = undefined;
export const updateCurrentBounds = (bounds: Bounds) => {
	// Snap to a stable grid first so small pans don't change the request
	let effectiveBounds = snapBounds(bounds);

	// Then constrain to clipping bounds
	if (clippingBounds) {
		effectiveBounds = constrainBounds(effectiveBounds, clippingBounds);
	}

	currentBounds = effectiveBounds;
};

export const boundsIncluded = (innerBounds: Bounds, outerBounds: Bounds): boolean => {
	const [inMinX, inMinY, inMaxX, inMaxY] = innerBounds;
	const [outMinX, outMinY, outMaxX, outMaxY] = outerBounds;

	return inMinX >= outMinX && inMinY >= outMinY && inMaxX <= outMaxX && inMaxY <= outMaxY;
};

/*
Compares domain bounds against bounds limitation set in clippingOptions
*/
export const constrainBounds = (bounds: Bounds, constraint: Bounds): Bounds => {
	let [minLon, minLat, maxLon, maxLat] = bounds;
	const [clipMinLon, clipMinLat, clipMaxLon, clipMaxLat] = constraint;

	if (minLat < clipMinLat) minLat = clipMinLat;
	if (maxLat > clipMaxLat) maxLat = clipMaxLat;
	if (minLon < clipMinLon) minLon = clipMinLon;
	if (maxLon > clipMaxLon) maxLon = clipMaxLon;

	return [minLon, minLat, maxLon, maxLat];
};

export const checkAgainstBounds = (point: number, min: number, max: number) => {
	if (max < min) {
		if (point < min && point > max) {
			return true;
		} else {
			return false;
		}
	} else {
		if (point < min || point > max) {
			return true;
		} else {
			return false;
		}
	}
};
