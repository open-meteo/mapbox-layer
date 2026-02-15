import { bboxToTile, tileToBBOX } from '@mapbox/tilebelt';

import { normalizeLon } from './math';

import { Bounds } from '../types';

export let currentBounds: Bounds | undefined = undefined;

let clippingBounds: Bounds | undefined = undefined;
export const setClippingBounds = (newBounds?: Bounds): void => {
	if (
		clippingBounds &&
		newBounds &&
		clippingBounds[0] === newBounds[0] &&
		clippingBounds[1] === newBounds[1] &&
		clippingBounds[2] === newBounds[2] &&
		clippingBounds[3] === newBounds[3]
	) {
		// No change in clipping bounds
		return;
	}
	clippingBounds = newBounds;
};

export const updateCurrentBounds = (bounds: Bounds) => {
	if (clippingBounds) {
		const clipped = constrainBounds(bounds, clippingBounds);
		if (!clipped) return;
		currentBounds = clipped;
	} else {
		const bbox = tileToBBOX(bboxToTile([bounds[0], bounds[1], bounds[2], bounds[3]]));
		currentBounds = [bbox[0], bbox[1], bbox[2], bbox[3]];
	}
};

export const boundsIncluded = (innerBounds: Bounds, outerBounds: Bounds): boolean => {
	const [inMinX, inMinY, inMaxX, inMaxY] = innerBounds;
	const [outMinX, outMinY, outMaxX, outMaxY] = outerBounds;

	return inMinX >= outMinX && inMinY >= outMinY && inMaxX <= outMaxX && inMaxY <= outMaxY;
};

/*
Compares domain bounds against bounds limitation set in clippingOptions
*/
export const constrainBounds = (bounds: Bounds, constraint: Bounds): Bounds | undefined => {
	let [minLon, minLat, maxLon, maxLat] = bounds;
	const [clipMinLon, clipMinLat, clipMaxLon, clipMaxLat] = constraint;

	// Clip latitude (always simple, no wrapping)
	if (minLat < clipMinLat) minLat = clipMinLat;
	if (maxLat > clipMaxLat) maxLat = clipMaxLat;

	const boundsCrossesDateline = minLon > maxLon;
	const clipCrossesDateline = clipMinLon > clipMaxLon;

	if (!boundsCrossesDateline && !clipCrossesDateline) {
		// Standard case: neither crosses dateline
		if (minLon < clipMinLon) minLon = clipMinLon;
		if (maxLon > clipMaxLon) maxLon = clipMaxLon;
	} else if (!boundsCrossesDateline && clipCrossesDateline) {
		// Bounds don't cross, but clip does
		// Valid clip longitudes: [clipMinLon, 180] ∪ [-180, clipMaxLon]

		// If minLon is in the "gap" (between clipMaxLon and clipMinLon), clamp to clipMinLon
		if (minLon < normalizeLon(clipMaxLon) && minLon < normalizeLon(clipMinLon)) {
			minLon = clipMinLon;
		} else {
			return undefined;
		}

		// If maxLon is in the "gap", clamp to clipMaxLon
		if (maxLon > normalizeLon(clipMinLon) && maxLon > normalizeLon(clipMaxLon)) {
			maxLon = clipMaxLon;
		} else {
			return undefined;
		}
	} else if (boundsCrossesDateline && !clipCrossesDateline) {
		// Bounds cross dateline, but clip doesn't
		// Bounds covers: [minLon, 180] ∪ [-180, maxLon]
		// Clip covers: [clipMinLon, clipMaxLon]
		const deltaClipLon = Math.abs(clipMaxLon - clipMinLon);
		if (deltaClipLon < 360) {
			if (normalizeLon(maxLon) < clipMaxLon) {
				maxLon = clipMaxLon;
			}
			if (normalizeLon(minLon) < clipMinLon) {
				minLon = clipMinLon;
			}
		}

		if (minLon === maxLon) {
			return undefined;
		}
	} else {
		// Both cross dateline
		// Bounds: [minLon, 180] ∪ [-180, maxLon]
		// Clip: [clipMinLon, 180] ∪ [-180, clipMaxLon]
		if (minLon < clipMinLon) minLon = clipMinLon;
		if (maxLon > clipMaxLon) maxLon = clipMaxLon;
	}

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
