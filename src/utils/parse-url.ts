import { pad } from '.';
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

	return parsedOmUrl.replace(
		inProgress ? '%in-progress%' : '%latest%',
		`${latestDate.getUTCFullYear()}/${pad(latestDate.getUTCMonth() + 1)}/${pad(latestDate.getUTCDate())}/${pad(latestDate.getUTCHours())}00Z`
	);
};
