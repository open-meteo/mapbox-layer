import * as maplibregl from 'maplibre-gl';

import type { Domain, Variable, DomainMetaData } from '../types';
import { domainOptions } from './domains';

const now = new Date();
now.setHours(now.getHours() + 1, 0, 0, 0);

export const pad = (n: string | number) => {
	return ('0' + n).slice(-2);
};

export function capitalize(s: string) {
	return String(s[0]).toUpperCase() + String(s).slice(1);
}

export const closestDomainInterval = (time: Date, domain: Domain) => {
	let newTime = new Date(time.getTime());
	if (domain.time_interval > 1) {
		if (time.getUTCHours() % domain.time_interval > 0) {
			const closestUTCHour = time.getUTCHours() - (time.getUTCHours() % domain.time_interval);
			newTime.setUTCHours(closestUTCHour + domain.time_interval);
		}
	}
	return newTime;
};

export const closestModelRun = (domain: Domain, selectedTime: Date, latest?: DomainMetaData) => {
	const year = selectedTime.getUTCFullYear();
	const month = selectedTime.getUTCMonth();
	const date = selectedTime.getUTCDate();

	const closestModelRunUTCHour =
		selectedTime.getUTCHours() - (selectedTime.getUTCHours() % domain.model_interval);

	const closestModelRun = new Date();
	closestModelRun.setUTCFullYear(year);
	closestModelRun.setUTCMonth(month);
	closestModelRun.setUTCDate(date);
	closestModelRun.setUTCHours(closestModelRunUTCHour);
	closestModelRun.setUTCMinutes(0);
	closestModelRun.setUTCSeconds(0);
	closestModelRun.setUTCMilliseconds(0);

	return closestModelRun;
};

const iconGlobalDomain = domainOptions.find((dO) => dO.value === 'dwd_icon') as Domain;

export const getOMUrl = (
	time: Date = new Date(),
	domain: Domain = iconGlobalDomain,
	variable: Variable = { value: 'temperature_2m' },

	mode?: 'dark' | 'bright' | undefined,
	partial?: boolean | undefined,
	modelRun?: Date | undefined,
	paddedBounds?: maplibregl.LngLatBounds
) => {
	if (!modelRun) {
		modelRun = closestModelRun(domain, time);
	}

	let omUrl = `https://map-tiles.open-meteo.com/data_spatial/${domain.value}/${modelRun.getUTCFullYear()}/${pad(modelRun.getUTCMonth() + 1)}/${pad(modelRun.getUTCDate())}/${pad(modelRun.getUTCHours())}00Z/${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())}T${pad(time.getUTCHours())}00.om?variable=${variable.value}`;

	if (mode && mode === 'dark') {
		omUrl += `&dark=true`;
	}
	if (partial) {
		omUrl += `&partial=true`;
	}
	if (paddedBounds) {
		omUrl += `&bounds=${paddedBounds.getSouth()},${paddedBounds.getWest()},${paddedBounds.getNorth()},${paddedBounds.getEast()}`;
	}

	return omUrl;
};
