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
	// since a single Bounds tuple can't represent a wrapped range and
	// getCoveringRanges doesn't handle wrap-around.
	if (snapMinLon < -180 || snapMaxLon > 180) {
		return [-180, snapMinLat, 180, snapMaxLat];
	}

	return [snapMinLon, snapMinLat, snapMaxLon, snapMaxLat];
};

export let currentBounds: Bounds | undefined = undefined;
export const updateCurrentBounds = (bounds: Bounds) => {
	const bbox = snapBounds(bounds);
	currentBounds = [bbox[0], bbox[1], bbox[2], bbox[3]];
};

export const boundsIncluded = (innerBounds: Bounds, outerBounds: Bounds): boolean => {
	const [inMinX, inMinY, inMaxX, inMaxY] = innerBounds;
	const [outMinX, outMinY, outMaxX, outMaxY] = outerBounds;

	return inMinX >= outMinX && inMinY >= outMinY && inMaxX <= outMaxX && inMaxY <= outMaxY;
};
