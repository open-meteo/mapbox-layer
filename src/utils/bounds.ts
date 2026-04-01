import { Bounds } from '../types';

/**
 * Smallest value >= n from the series 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, …
 */
const ceilSnapStep = (n: number): number => {
	if (n <= 1) return 1;
	const p = Math.pow(2, Math.floor(Math.log2(n)));
	if (n <= p) return p;
	if (n <= p * 1.5) return p * 1.5;
	return p * 2;
};

/**
 * Snap bounds to a stable grid based on viewport size.
 * This quantizes continuous viewport changes into discrete steps,
 * so small pans within the same grid cell produce identical bounds.
 *
 * Uses a grid spacing of step/4 for alignment, which means you need
 * to pan ~25% of the viewport before bounds change.
 *
 * Adds one grid step of padding on each side so that map tiles at the
 * viewport edge (which extend beyond the viewport) always have data.
 * This keeps fetched area within ~1.5–2× the viewport, much less than
 * tile-boundary snapping while avoiding partially rendered edge tiles.
 */
export const snapBounds = (bounds: Bounds): Bounds => {
	const [minLon, minLat, maxLon, maxLat] = bounds;

	const latGrid = ceilSnapStep(maxLat - minLat) / 4; // 25% of viewport height
	const lonGrid = ceilSnapStep(maxLon - minLon) / 4; // 25% of viewport width

	return [
		Math.floor(minLon / lonGrid) * lonGrid - lonGrid,
		Math.floor(minLat / latGrid) * latGrid - latGrid,
		Math.ceil(maxLon / lonGrid) * lonGrid + lonGrid,
		Math.ceil(maxLat / latGrid) * latGrid + latGrid
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
