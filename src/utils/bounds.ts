import { lat2tile, lon2tile, tile2lat } from './math';

import { Bounds } from '../types';

/**
 * Snap bounds to tile boundaries for stable, padded data fetching.
 */
export const snapBounds = (viewportBounds: Bounds): Bounds => {
	const [minLon, minLat, maxLon, maxLat] = viewportBounds;

	const lonSpan = maxLon - minLon;

	// Pick a zoom where tiles are closest to viewport-sized
	const z = Math.max(0, Math.round(Math.log2(360 / lonSpan)));
	const numTiles = Math.pow(2, z);

	// Snap latitude via tile boundaries
	const minTileY = Math.max(0, Math.floor(lat2tile(maxLat, z)));
	const maxTileY = Math.min(numTiles, Math.ceil(lat2tile(minLat, z)));
	const snapMinLat = tile2lat(maxTileY, z);
	const snapMaxLat = tile2lat(minTileY, z);

	// Full-world longitude: use [-180, 180] but still snap latitude
	if (lonSpan >= 360) {
		return [-180, snapMinLat, 180, snapMaxLat];
	}

	// Snap longitude via tile boundaries
	const minTileX = Math.floor(lon2tile(minLon, z));
	const maxTileX = Math.ceil(lon2tile(maxLon, z));

	if (maxTileX - minTileX >= numTiles) {
		return [-180, snapMinLat, 180, snapMaxLat];
	}

	// Convert tile X range without modular wrap
	const snapMinLon = (minTileX / numTiles) * 360 - 180;
	const snapMaxLon = (maxTileX / numTiles) * 360 - 180;

	// If snapped bounds cross the dateline, fall back to full-world longitude
	if (snapMinLon < -180 || snapMaxLon > 180) {
		return [-180, snapMinLat, 180, snapMaxLat];
	}

	return [snapMinLon, snapMinLat, snapMaxLon, snapMaxLat];
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
export const updateCurrentBounds = (viewportBounds: Bounds) => {
	// Snap to a stable grid first so small pans don't change the request
	let effectiveBounds = snapBounds(viewportBounds);

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
