import * as maplibregl from 'maplibre-gl';

import type { Domain, ModelDt, ModelUpdateInterval, Variable } from '../types';

const now = new Date();
now.setHours(now.getHours() + 1, 0, 0, 0);

export const pad = (n: string | number) => {
	return ('0' + n).slice(-2);
};

export function capitalize(s: string) {
	return String(s[0]).toUpperCase() + String(s).slice(1);
}

export const domainStep = (
	time: Date,
	timeInterval: ModelDt,
	direction: 'forward' | 'backward' | 'nearest' = 'nearest'
): Date => {
	const newTime = new Date(time.getTime());
	const operator = direction === 'nearest' ? 0 : direction === 'forward' ? 1 : -1;
	switch (timeInterval) {
		case 'hourly':
			newTime.setUTCHours(time.getUTCHours() + operator);
			break;
		case '3hourly':
			newTime.setUTCHours(Math.floor(time.getUTCHours() / 3) * 3 + operator * 3);
			break;
		case '6hourly':
			newTime.setUTCHours(Math.floor(time.getUTCHours() / 6) * 6 + operator * 6);
			break;
		case 'weekly_on_monday': {
			const dayOfWeek = newTime.getUTCDay();
			const nextMondayInDays = (8 - dayOfWeek) % 7;
			switch (direction) {
				case 'nearest':
					newTime.setUTCDate(time.getUTCDate() + nextMondayInDays);
					break;
				case 'backward':
					newTime.setUTCDate(time.getUTCDate() + nextMondayInDays - 7);
					break;
				case 'forward':
					if (nextMondayInDays === 0) {
						newTime.setUTCDate(time.getUTCDate() + 7);
					} else {
						newTime.setUTCDate(time.getUTCDate() + nextMondayInDays);
					}
					break;
			}
			newTime.setUTCHours(0);
			break;
		}
		case 'monthly':
			newTime.setUTCMonth(time.getUTCMonth() + operator);
			break;
		default:
			throw new Error(`Invalid time interval: ${timeInterval}`);
	}
	return newTime;
};

export const closestModelRun = (time: Date, modelInterval: ModelUpdateInterval): Date => {
	const newTime = new Date(time.getTime());

	let hours: number;
	switch (modelInterval) {
		case 'hourly':
			hours = time.getUTCHours();
			break;
		case '3hourly':
			hours = Math.floor(time.getUTCHours() / 3) * 3;
			break;
		case '6hourly':
			hours = Math.floor(time.getUTCHours() / 6) * 6;
			break;
		case '12hourly':
			hours = Math.floor(time.getUTCHours() / 12) * 12;
			break;
		case 'daily':
			hours = 0;
			break;
		case 'monthly':
			newTime.setUTCDate(1);
			hours = 0;
			break;
		default:
			throw new Error(`Invalid model interval: ${modelInterval}`);
	}

	newTime.setUTCHours(hours, 0, 0, 0);

	return newTime;
};

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
