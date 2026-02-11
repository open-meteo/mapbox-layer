import { bboxToTile, tileToBBOX } from '@mapbox/tilebelt';
import { LngLatBounds } from 'maplibre-gl';

import { Bounds } from '../types';

export let currentBounds: Bounds | undefined = undefined;
let clippingBounds: Bounds | undefined = undefined;

export const setClippingBounds = (bounds?: Bounds): void => {
	clippingBounds = bounds;
};

export const updateCurrentBounds = (bounds: LngLatBounds) => {
	let [minLng, minLat] = bounds.getSouthWest().toArray();
	let [maxLng, maxLat] = bounds.getNorthEast().toArray();

	if (clippingBounds) {
		const [clipMinLng, clipMinLat, clipMaxLng, clipMaxLat] = clippingBounds;
		if (minLng < clipMinLng) minLng = clipMinLng;
		if (minLat < clipMinLat) minLat = clipMinLat;
		if (maxLng > clipMaxLng) maxLng = clipMaxLng;
		if (maxLat > clipMaxLat) maxLat = clipMaxLat;
	}

	const bbox = tileToBBOX(bboxToTile([minLng, minLat, maxLng, maxLat]));

	currentBounds = [bbox[0], bbox[1], bbox[2], bbox[3]];
};

export const boundsIncluded = (innerBounds: Bounds, outerBounds: Bounds): boolean => {
	const [inMinX, inMinY, inMaxX, inMaxY] = innerBounds;
	const [outMinX, outMinY, outMaxX, outMaxY] = outerBounds;

	return inMinX >= outMinX && inMinY >= outMinY && inMaxX <= outMaxX && inMaxY <= outMaxY;
};
