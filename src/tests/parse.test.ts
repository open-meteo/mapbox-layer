import { pad } from '../utils';
import { deltaTimeHoursAt, parseMetaJson, parseUrlComponents } from '../utils/parse-url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('URL Parsing', () => {
	describe('parseMetaJson', () => {
		// parseMetaJson fetches the meta json itself; stub the network so the
		// tests are deterministic and run offline
		beforeEach(() => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => ({
					ok: true,
					json: async () => ({
						completed: true,
						last_modified_time: new Date().toISOString(),
						reference_time: new Date().toISOString(),
						valid_times: [new Date().toISOString()],
						variables: ['temperature_2m']
					})
				}))
			);
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it('resolves latest.json to current model run URL', async () => {
			const url =
				'https://openmeteo.s3.amazonaws.com/data_spatial/dwd_icon/latest.json?time_step=current_time_1H&variable=temperature_2m';
			const parsedUrl = await parseMetaJson(url);
			const now = new Date();

			expect(parsedUrl).not.toContain('latest');
			expect(parsedUrl).toContain(
				`/${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/`
			);
			expect(parsedUrl).not.toContain('current_time_1H');
		});

		it('resolves in-progress.json to current model run URL', async () => {
			const url =
				'https://openmeteo.s3.amazonaws.com/data_spatial/dwd_icon/in-progress.json?time_step=current_time_1H&variable=temperature_2m';
			const parsedUrl = await parseMetaJson(url);

			expect(parsedUrl).not.toContain('in-progress');
		});
	});

	describe('parseUrlComponents', () => {
		it('parses URL with query params and tile coordinates', async () => {
			const url =
				'om://https://example.com/data_spatial/domain1/file.om?variable=temp&dark=true/5/10/15';
			const components = parseUrlComponents(url);

			expect(components.baseUrl).toBe('https://example.com/data_spatial/domain1/file.om');
			expect(components.params.get('variable')).toBe('temp');
			expect(components.params.get('dark')).toBe('true');
			expect(components.tileIndex).toEqual({ z: 5, x: 10, y: 15 });
		});

		it('parses URL without tile coordinates (tilejson request)', async () => {
			const url = 'om://https://example.com/data_spatial/domain1/file.om?variable=temp';
			const components = parseUrlComponents(url);

			expect(components.baseUrl).toBe('https://example.com/data_spatial/domain1/file.om');
			expect(components.tileIndex).toBeNull();
		});

		it('excludes rendering-only params from stateKey', async () => {
			const url1 =
				'om://https://example.com/data_spatial/domain1/file.om?variable=temp&tile_size=512';
			const url2 =
				'om://https://example.com/data_spatial/domain1/file.om?variable=temp&tile_size=256';

			const components1 = parseUrlComponents(url1);
			const components2 = parseUrlComponents(url2);

			// Same stateKey despite different tile_size
			expect(components1.fileAndVariableKey).toBe(components2.fileAndVariableKey);
		});

		it('includes data-affecting params in stateKey', async () => {
			const url1 = 'om://https://example.com/data_spatial/domain1/file.om?variable=temp';
			const url2 = 'om://https://example.com/data_spatial/domain1/file.om?variable=humidity';

			const components1 = parseUrlComponents(url1);
			const components2 = parseUrlComponents(url2);

			expect(components1.fileAndVariableKey).not.toBe(components2.fileAndVariableKey);
		});

		it('rejects invalid OM protocol URL', async () => {
			expect(() => parseUrlComponents('https://example.com/file.om')).toThrow(
				'Invalid OM protocol URL'
			);
		});
	});
});

describe('deltaTimeHoursAt', () => {
	// Hourly steps turning 3-hourly, listed out of order like some runs are
	const validTimes = [
		'2026-10-15T01:00Z',
		'2026-10-15T00:00Z',
		'2026-10-15T05:00Z',
		'2026-10-15T02:00Z'
	];

	it('is the gap to the previous valid time, the first one taking the next gap', () => {
		expect(deltaTimeHoursAt(new Date('2026-10-15T02:00Z'), validTimes)).toBe(1);
		expect(deltaTimeHoursAt(new Date('2026-10-15T05:00Z'), validTimes)).toBe(3);
		expect(deltaTimeHoursAt(new Date('2026-10-15T00:00Z'), validTimes)).toBe(1);
	});

	it('is undefined off the run, or without a second valid time', () => {
		expect(deltaTimeHoursAt(new Date('2026-10-15T04:00Z'), validTimes)).toBeUndefined();
		expect(deltaTimeHoursAt(new Date('2026-10-15T00:00Z'), ['2026-10-15T00:00Z'])).toBeUndefined();
		expect(deltaTimeHoursAt(new Date('2026-10-15T00:00Z'), undefined)).toBeUndefined();
	});
});

describe('capture API time step', () => {
	const meta = {
		completed: true,
		last_modified_time: '',
		reference_time: '2026-10-15T00:00Z',
		valid_times: [
			'2026-10-15T00:00Z',
			'2026-10-15T01:00Z',
			'2026-10-15T02:00Z',
			'2026-10-15T05:00Z'
		],
		variables: ['precipitation']
	};

	beforeEach(() =>
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json(meta))
		)
	);
	afterEach(() => vi.unstubAllGlobals());

	it('sets the step length of the resolved file from the run valid times', async () => {
		const url = await parseMetaJson(
			'https://host/data_spatial/capture_step_a/latest.json?time_step=valid_times_3&variable=precipitation'
		);
		expect(url).toContain('/2026/10/15/0000Z/2026-10-15T0500.om');
		expect(parseUrlComponents(url).params.get('delta_time_hours')).toBe('3');
	});

	it('keeps the tile coordinates of a tile request at the end', async () => {
		const url = await parseMetaJson(
			'om://https://host/data_spatial/capture_step_c/latest.json?time_step=valid_times_3&variable=precipitation/5/16/10'
		);
		expect(url.endsWith('/5/16/10')).toBe(true);
		const { tileIndex, params } = parseUrlComponents(url);
		expect(tileIndex).toEqual({ z: 5, x: 16, y: 10 });
		expect(params.get('variable')).toBe('precipitation');
		expect(params.get('delta_time_hours')).toBe('3');
	});

	it('keeps a step length the caller passed', async () => {
		const url = await parseMetaJson(
			'https://host/data_spatial/capture_step_b/latest.json?time_step=valid_times_3&variable=precipitation&delta_time_hours=6'
		);
		expect(parseUrlComponents(url).params.get('delta_time_hours')).toBe('6');
	});
});
