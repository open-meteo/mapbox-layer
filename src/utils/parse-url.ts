import { pad } from '.';
import { domainOptions } from '../domains';

const now = new Date();

const omUrlRegex =
	/(http|https):\/\/(?<uri>[\s\S]+)\/(?<domain>[\s\S]+)\/(?<runYear>[\s\S]+)?\/(?<runMonth>[\s\S]+)?\/(?<runDate>[\s\S]+)?\/(?<runTime>[\s\S]+)?\/(?<file>[\s\S]+)?\.(om|json)(?<params>[\s\S]+)?/;
const domainRegex =
	/(http|https):\/\/(?<uri>[\s\S]+)\/(?<domain>[\s\S]+)\/(?<meta>(latest|in-progress)).json/;
const timeStepRegex = /(?<capture>(current-time|valid-times))(-)?(?<modifier>.*)?/;

export const parseLatest = async (omUrl: string) => {
	let date = new Date(now);
	const url = omUrl.replace('om://', '');
	const { uri, domain, meta } = url.match(domainRegex)?.groups as {
		uri: string;
		domain: string;
		meta: 'latest' | 'in-progress';
	};
	const latest = await fetch(`https://${uri}/${domain}/${meta}.json`).then((response) =>
		response.json()
	);
	const latestRun = new Date(latest.reference_time);

	const parsedOmUrl = new URL(url);
	const timeStep = parsedOmUrl.searchParams.get('time-step');
	const timeStepMatch = timeStep?.match(timeStepRegex);
	if (timeStep && timeStepMatch) {
		const { capture, modifier } = timeStepMatch.groups as { capture: string; modifier: string };
		if (capture === 'current-time') {
			if (modifier) {
				const splitModifier = modifier.match(/[a-zA-Z]+|[0-9]+/g);
				const modifierAmount = splitModifier ? Number(splitModifier[0]) : 0;
				if (splitModifier && splitModifier[1] == 'D') {
					date.setDate(date.getDate() + modifierAmount);
				} else if (splitModifier && splitModifier[1] == 'H') {
					date.setHours(date.getHours() + modifierAmount);
				}
			} else {
				// it will take the current hour selected with date object at the beginning of this function
			}
		} else if (capture === 'valid-times') {
			if (modifier) {
				const index = modifier;
				date = new Date(latest.valid_times[index]);
			} else {
				throw new Error('Missing valid times index');
			}
		}
	} else {
		throw new Error('Invalid time step');
	}
	parsedOmUrl.searchParams.delete('time-step'); // delete time-step from url

	return parsedOmUrl.href.replace(
		`${meta}.json`, // either 'in-progress' or 'latest'
		`${latestRun.getUTCFullYear()}/${pad(latestRun.getUTCMonth() + 1)}/${pad(latestRun.getUTCDate())}/${pad(latestRun.getUTCHours())}00Z/${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}00.om`
	);
};

export const validUrl = (url: string) => {
	const groups = url.match(omUrlRegex)?.groups;
	if (!groups) return false;

	// const { uri, domain, run_year, run_month, run_date, run_time, file, params } = groups;
	const { domain, run_year } = groups;

	if (!domainOptions.find((d) => d.value == domain)) return false;
	if (Number(run_year) < 2025) return false;

	return true;
};
