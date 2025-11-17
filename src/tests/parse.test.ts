import { describe, expect, test } from 'vitest';
import { parseCurrent, parseLatest } from '../utils/parse-url';
import { domainOptions } from '../domains';
import { Domain } from '../types';
import { pad } from '../utils';

const omUrl = `https://map-tiles.open-meteo.com/data_spatial/dwd_icon/%latest%/%current+1H%.om?variable=temperature_2m`;
const dwdDomain = domainOptions.find((d) => d.value === 'dwd_icon') as Domain;

describe('parse OM URL with a model-run', () => {
	test('get latest and replace url', async () => {
		const now = new Date();
		let parsedOmUrl = omUrl;
		if (omUrl.includes('%latest%')) {
			parsedOmUrl = await parseLatest(parsedOmUrl, dwdDomain);
		}
		expect(parsedOmUrl).not.toContain('%latest%');
		expect(parsedOmUrl).toContain(
			`/${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/`
		);
	});
	test('get in-progress and replace url', async () => {
		let parsedOmUrl = `https://map-tiles.open-meteo.com/data_spatial/dwd_icon/%in-progress%/%current+1H%.om?variable=temperature_2m`;
		if (omUrl.includes('%latest%') || omUrl.includes('%in-progress%')) {
			parsedOmUrl = await parseLatest(
				parsedOmUrl,
				dwdDomain,
				parsedOmUrl.includes('%in-progress%')
			);
		}
		console.log(parsedOmUrl);
		expect(parsedOmUrl).not.toContain('%in-progress%');
	});
});

describe('parse OM URL forecast modifier', () => {
	test('replace current in url with dates +1 hour', () => {
		const now = new Date();
		let parsedOmUrl = omUrl;
		if (omUrl.includes('%current')) {
			parsedOmUrl = parseCurrent(parsedOmUrl);
		}
		expect(parsedOmUrl).not.toContain('%current+1H%');
		expect(parsedOmUrl).toContain(
			`${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours() + 1)}00.om`
		);
	});
	test('replace current in url with dates +1 day', () => {
		const now = new Date();
		let parsedOmUrl = `https://map-tiles.open-meteo.com/data_spatial/dwd_icon/%latest%/%current+1D%.om?variable=temperature_2m`;
		if (omUrl.includes('%current')) {
			parsedOmUrl = parseCurrent(parsedOmUrl);
		}
		expect(parsedOmUrl).not.toContain('%current+1D%');
		expect(parsedOmUrl).toContain(
			`${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate() + 1)}T${pad(now.getUTCHours())}00.om`
		);
	});
});
