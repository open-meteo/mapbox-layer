import { pad } from '.';
import { domainOptions } from '../domains';

import { Domain } from '../types';

const now = new Date();

export const parseCurrent = (parsedOmUrl: string) => {
	let date = new Date(now);
	const regex = /%current([\s\S]*?)%/;
	const matches = parsedOmUrl.match(regex);
	const modifier = matches ? matches[1] : null;

	if (modifier) {
		const splitModifier = modifier.match(/[a-zA-Z]+|[0-9]+/g);
		const modifierAmount = splitModifier ? Number(splitModifier[0]) : 0;
		if (splitModifier && splitModifier[1] == 'D') {
			date.setDate(date.getDate() + modifierAmount);
		} else if (splitModifier && splitModifier[1] == 'H') {
			date.setHours(date.getHours() + modifierAmount);
		}
	}

	return parsedOmUrl.replace(
		regex,
		`${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}00`
	);
};

export const parseLatest = async (parsedOmUrl: string, domain: Domain, inProgress = false) => {
	const latest = await fetch(
		`https://map-tiles.open-meteo.com/data_spatial/${domain.value}/${inProgress ? 'in-progress' : 'latest'}.json`
	).then((response) => response.json());

	const latestDate = new Date(latest.reference_time);

	if (parsedOmUrl.includes('%valid_times_')) {
		const validTimeRegex = /%valid_times_(?<index>[0-9])%/;
		const validTimeMatch = parsedOmUrl.match(validTimeRegex);
		const validTimeIndex = Number(validTimeMatch?.groups?.index);
		const validTimeDate = new Date(latest.valid_times[validTimeIndex]);
		parsedOmUrl = parsedOmUrl.replace(
			validTimeRegex,
			`${validTimeDate.getUTCFullYear()}-${pad(validTimeDate.getUTCMonth() + 1)}-${pad(validTimeDate.getUTCDate())}T${pad(validTimeDate.getUTCHours())}00`
		);
	}

	return parsedOmUrl.replace(
		inProgress ? '%in-progress%' : '%latest%',
		`${latestDate.getUTCFullYear()}/${pad(latestDate.getUTCMonth() + 1)}/${pad(latestDate.getUTCDate())}/${pad(latestDate.getUTCHours())}00Z`
	);
};

export const validUrl = (url: string) => {
	const regex =
		/(http|https):\/\/(?<uri>[\s\S]+)\/data_spatial\/(?<domain>[\s\S]+)\/(?<run_year>[\s\S]+)\/(?<run_month>[\s\S]+)\/(?<run_date>[\s\S]+)\/(?<run_time>[\s\S]+)\/(?<file>[\s\S]+)\.om(?<params>[\s\S]+)?/;
	const groups = url.match(regex)?.groups;
	if (!groups) return false;

	const { uri, domain, run_year, run_month, run_date, run_time, file, params } = groups;

	if (!domainOptions.find((d) => d.value == domain)) return false;
	if (Number(run_year) < 2025) return false;

	return true;
};
