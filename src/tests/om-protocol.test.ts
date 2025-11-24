import { defaultOmProtocolSettings } from '../om-protocol';
import { RequestParameters } from 'maplibre-gl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DimensionRange, Domain, TileJSON } from '../types';

beforeEach(() => {
	// Reset module cache so module-level singletons are recreated for each test
	vi.resetModules();
	vi.clearAllMocks();
});

describe('om-protocol unit tests', () => {
	it('parseOmUrl returns expected fields and computes ranges for partial=true', async () => {
		const { parseOmUrl } = await import('../om-protocol');

		const domainOptions: Domain[] = [
			{
				value: 'domain1',
				label: 'Domain 1',
				grid: { type: 'regular', nx: 10, ny: 20, lonMin: 0, latMin: 0, dx: 1, dy: 1 },
				time_interval: 1,
				model_interval: 3,
				windUVComponents: false
			}
		];
		const variableOptions = [{ value: 'temperature', label: 'Temperature' }];

		const partial = true;
		const mapBounds = [0, 0, 10, 10];

		const url = 'om://https://map-tiles.open-meteo.com/data_spatial?variable=temperature_2m';
		const { ranges } = parseOmUrl(url, partial, domainOptions, variableOptions, mapBounds);

		// expect(variables[0].value).toBe('temperature_2m');
		// If partial is true, the ranges are the overlap of the domain grid and the requested mapBounds
		expect(ranges).toEqual([
			{ start: 0, end: 12 },
			{ start: 0, end: 10 }
		]);
	});

	it('omProtocol with json returns tilejson with tiles url', async () => {
		const { omProtocol } = await import('../om-protocol');

		const params: RequestParameters = {
			url: 'om://https://map-tiles.open-meteo.com/data_spatial/dwd_icon/2025/10/27/1200Z/2025-10-27T1200.om?variable=temperature_2m',
			type: 'json'
		};
		const result = await omProtocol(params, undefined, defaultOmProtocolSettings);
		const resultData = result.data as TileJSON;

		// tiles url uses the full request URL + '/{z}/{x}/{y}'
		expect(resultData.tiles[0]).toBe(
			'om://https://map-tiles.open-meteo.com/data_spatial/dwd_icon/2025/10/27/1200Z/2025-10-27T1200.om?variable=temperature_2m/{z}/{x}/{y}'
		);
		expect(resultData.tilejson).toBe('2.2.0');
		expect(resultData.bounds).toEqual([-180, -90, 179.875, 90.125]); // bounds of icon global
	});

	it('omProtocol arrayBuffer path calls workerPool and returns ArrayBuffer', async () => {
		// Mock OMapsFileReader so ensureData will put values in state.data
		vi.mock('../om-file-reader', () => {
			return {
				OMapsFileReader: class {
					async setToOmFile() {}
					async readVariable(variable: string, ranges: DimensionRange[]) {
						const totalValues =
							ranges?.reduce((acc, range) => acc * (range.end - range.start + 1), 1) || 0;
						const values = new Float32Array(totalValues); // initialize with zeros
						return { values, directions: undefined };
					}
				}
			};
		});

		// Mock WorkerPool so requestTile returns a predictable ArrayBuffer and "works" on Node
		vi.mock('../worker-pool', () => {
			const fakeBuf = new ArrayBuffer(16);
			return {
				WorkerPool: class {
					requestTile = vi.fn(() => Promise.resolve(fakeBuf));
				}
			};
		});

		const { omProtocol, getValueFromLatLong } = await import('../om-protocol');

		const params: RequestParameters = {
			url: 'om://https://map-tiles.open-meteo.com/data_spatial/dwd_icon/2025/10/27/1200Z/2025-10-27T1200.om?variable=temperature_2m/0/0/0',
			type: 'arrayBuffer'
		};
		const res = await omProtocol(params, undefined, defaultOmProtocolSettings);
		expect(res.data).toEqual(new ArrayBuffer(16));

		// test getValueFromLatLong uses the same stored state and returns the interpolated value
		const valueResult = getValueFromLatLong(0, 0, params.url, { value: 'temperature_2m' });
		expect(valueResult.value).toEqual(0);
	});
});
