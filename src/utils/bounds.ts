import { bboxToTile, tileToBBOX } from '@mapbox/tilebelt';

import { clipBounds } from './math';

import { Bounds } from '../types';

export let currentBounds: Bounds | undefined = undefined;

let clippingBounds: Bounds | undefined = undefined;
export const setClippingBounds = (clipBounds?: Bounds): void => {
	if (
		clippingBounds &&
		clipBounds &&
		clippingBounds[0] === clipBounds[0] &&
		clippingBounds[1] === clipBounds[1] &&
		clippingBounds[2] === clipBounds[2] &&
		clippingBounds[3] === clipBounds[3]
	) {
		// No change in clipping bounds
		return;
	}
	clippingBounds = clipBounds;
};

export const updateCurrentBounds = (bounds: Bounds) => {
	if (clippingBounds) {
		const clipped = clipBounds(bounds, clippingBounds);
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
