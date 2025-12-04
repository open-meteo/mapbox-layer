import * as maplibregl from 'maplibre-gl';

import type { Domain, Variable } from '../types';

const now = new Date();
now.setHours(now.getHours() + 1, 0, 0, 0);

export const pad = (n: string | number) => {
	return ('0' + n).slice(-2);
};

export function capitalize(s: string) {
	return String(s[0]).toUpperCase() + String(s).slice(1);
}

export const getOMUrl = (
	time: Date,
	mode: 'dark' | 'bright',
	partial: boolean,
	domain: Domain,
	variable: Variable,
	modelRun: Date,
	paddedBounds?: maplibregl.LngLatBounds
) => {
	if (paddedBounds) {
		return `https://map-tiles.open-meteo.com/data_spatial/${domain.value}/${modelRun.getUTCFullYear()}/${pad(modelRun.getUTCMonth() + 1)}/${pad(modelRun.getUTCDate())}/${pad(modelRun.getUTCHours())}00Z/${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())}T${pad(time.getUTCHours())}00.om?dark=${mode === 'dark'}&variable=${variable.value}&partial=${partial}&bounds=${paddedBounds.getSouth()},${paddedBounds.getWest()},${paddedBounds.getNorth()},${paddedBounds.getEast()}`;
	} else {
		return `https://map-tiles.open-meteo.com/data_spatial/${domain.value}/${modelRun.getUTCFullYear()}/${pad(modelRun.getUTCMonth() + 1)}/${pad(modelRun.getUTCDate())}/${pad(modelRun.getUTCHours())}00Z/${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())}T${pad(time.getUTCHours())}00.om?dark=${mode === 'dark'}&variable=${variable.value}&partial=${partial}`;
	}
};
