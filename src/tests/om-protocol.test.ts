import { OMapsFileReader } from '../om-file-reader';
import { defaultOmProtocolSettings } from '../om-protocol';
import { parseRequest } from '../utils/parse-request';
import { RequestParameters } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	DimensionRange,
	GridData,
	OmProtocolSettings,
	ResolvedBreakpointColorScale,
	TileJSON
} from '../types';

const { mockReturnBuffer, mockReadVariableResult } = vi.hoisted(() => ({
	mockReturnBuffer: { value: new ArrayBuffer(16) },
	mockReadVariableResult: { value: null as { values: Float32Array; directions: undefined } | null }
}));

vi.mock('../om-file-reader', () => ({
	OMapsFileReader: class {
		config = { useSAB: false };
		async setToOmFile(_baseUrl: string) {}
		async readVariable(_variable: string, ranges: DimensionRange[]) {
			if (mockReadVariableResult.value) {
				return mockReadVariableResult.value;
			}
			const totalValues =
				ranges?.reduce((acc, range) => acc * (range.end - range.start + 1), 1) || 0;
			return { values: new Float32Array(totalValues), directions: undefined };
		}

		async getGridParameters(_variable: string): Promise<GridData> {
			return {
				type: 'regular',
				nx: 10,
				ny: 20,
				lonMin: 0,
				latMin: 0,
				dx: 1,
				dy: 1
			};
		}
	}
}));

vi.mock('../worker-pool', () => ({
	WorkerPool: class {
		requestTile = vi.fn(() => Promise.resolve(mockReturnBuffer.value));
	}
}));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mockReturnBuffer.value = new ArrayBuffer(16);
	mockReadVariableResult.value = null;
});

afterEach(() => {
	vi.restoreAllMocks();
});

const createTestSettings = (overrides: Partial<OmProtocolSettings> = {}): OmProtocolSettings => ({
	...defaultOmProtocolSettings,
	...overrides
});

describe('Request Resolution', () => {
	describe('parseRequest', () => {
		it('resolves data identity and render options from URL', async () => {
			const settings = createTestSettings();
			const reader = new OMapsFileReader();

			const url =
				'om://https://example.com/data_spatial/domain1/file.om?variable=temperature&dark=true&intervals=2';
			const { dataOptions, renderOptions } = await parseRequest(url, settings, reader);

			expect(dataOptions.baseUrl).toBe('https://example.com/data_spatial/domain1/file.om');
			expect(dataOptions.variable).toBe('temperature');
			expect(renderOptions.intervals).toStrictEqual([2]);
		});

		it('can resolve domain from a variety of different urls', async () => {
			const settings = createTestSettings();
			const reader = new OMapsFileReader();

			const url1 =
				'om://https://nested.subdomain.of.example.com/data_spatial/domain1/file.om?variable=temperature&dark=true&intervals=2';

			const url2 =
				'om://http:/nested.subdomain.of.example.com/data_spatial/domain1/file.om?variable=temperature&dark=true&intervals=2';

			const url3 =
				'om://https://example.com/nested/bucket/structure/data_spatial/domain1/file.om?variable=temperature&dark=true&intervals=2';

			for (const url of [url1, url2, url3]) {
				const { dataOptions, renderOptions } = await parseRequest(url, settings, reader);
				expect(dataOptions.baseUrl).toContain('data_spatial/domain1/file.om');
				expect(dataOptions.variable).toBe('temperature');
				expect(renderOptions.intervals).toStrictEqual([2]);
			}
		});

		it('computes partial ranges when partial=true and bounds provided', async () => {
			const settings = createTestSettings();
			const reader = new OMapsFileReader();
			const url =
				'om://https://example.com/data_spatial/domain1/file.om?variable=temperature&partial=true&bounds=0,0,10,10';

			const { dataOptions } = await parseRequest(url, settings, reader);
			// Ranges should be computed based on bounds overlap with grid
			expect(dataOptions.ranges).toEqual([
				{ start: 0, end: 12 },
				{ start: 0, end: 10 }
			]);
		});

		it('uses full grid ranges when partial=false', async () => {
			const settings = createTestSettings();
			const reader = new OMapsFileReader();
			vi.spyOn(reader, 'getGridParameters').mockResolvedValue({
				type: 'regular',
				nx: 100,
				ny: 200,
				lonMin: 0,
				latMin: 0,
				dx: 1,
				dy: 1
			});

			const url =
				'om://https://example.com/data_spatial/domain1/file.om?variable=temperature&bounds=0,0,10,10';

			const { dataOptions } = await parseRequest(url, settings, reader);
			expect(dataOptions.ranges).toEqual([
				{ start: 0, end: 200 },
				{ start: 0, end: 100 }
			]);
		});

		it('throws for missing variable', async () => {
			const settings = createTestSettings();
			const reader = new OMapsFileReader();
			const url = 'om://https://example.com/data_spatial/domain1/file.om';

			expect(() => parseRequest(url, settings, reader)).rejects.toThrow(
				'Variable is required but not defined'
			);
		});

		it('parses render options with defaults', async () => {
			const settings = createTestSettings();
			const reader = new OMapsFileReader();

			const url = 'om://https://example.com/data_spatial/domain1/file.om?variable=temp';
			const { renderOptions } = await parseRequest(url, settings, reader);

			const colorScale = renderOptions.colorScale as ResolvedBreakpointColorScale;

			expect(renderOptions.tileSize).toBe(256);
			expect(renderOptions.resolutionFactor).toBe(1);
			expect(renderOptions.drawGrid).toBe(false);
			expect(renderOptions.drawArrows).toBe(false);
			expect(renderOptions.drawContours).toBe(false);
			expect(renderOptions.intervals).toStrictEqual(colorScale.breakpoints);
			expect(renderOptions.colorScale.colors.length).toBe(46);
		});

		it('parses custom render options', async () => {
			const settings = createTestSettings();
			const reader = new OMapsFileReader();

			const url =
				'om://https://example.com/data_spatial/domain1/file.om?variable=temp&tile_size=512&resolution_factor=2&grid=true&arrows=true&contours=true';
			const { renderOptions } = await parseRequest(url, settings, reader);

			expect(renderOptions.tileSize).toBe(512);
			expect(renderOptions.resolutionFactor).toBe(2);
			expect(renderOptions.drawGrid).toBe(true);
			expect(renderOptions.drawArrows).toBe(true);
			expect(renderOptions.drawContours).toBe(true);
		});

		it('throws for invalid tile size', async () => {
			const settings = createTestSettings();
			const reader = new OMapsFileReader();

			const url =
				'om://https://example.com/data_spatial/domain1/file.om?variable=temp&tile_size=999';

			expect(() => parseRequest(url, settings, reader)).rejects.toThrow('Invalid tile size');
		});

		it('throws for invalid resolution factor', async () => {
			const settings = createTestSettings();
			const reader = new OMapsFileReader();

			const url =
				'om://https://example.com/data_spatial/domain1/file.om?variable=temp&resolution_factor=3';

			expect(() => parseRequest(url, settings, reader)).rejects.toThrow(
				'Invalid resolution factor'
			);
		});
	});

	describe('custom resolver', () => {
		it('allows custom request resolver', async () => {
			const { omProtocol } = await import('../om-protocol');

			const customResolver = vi.fn().mockReturnValue({
				dataOptions: {
					variable: { value: 'custom_var' },
					ranges: [
						{ start: 0, end: 10 },
						{ start: 0, end: 10 }
					]
				},
				renderOptions: {
					dark: true,
					tileSize: 512,
					resolutionFactor: 1,
					makeGrid: false,
					makeArrows: false,
					makeContours: false,
					interval: [2],
					colorScale: {
						min: 0,
						max: 100,
						colors: [],
						unit: 'C'
					}
				}
			});

			const settings = createTestSettings({ resolveRequest: customResolver });

			const params: RequestParameters = {
				url: 'om://https://example.com/data_spatial/custom_domain/file.om?variable=custom_var/0/0/0',
				type: 'arrayBuffer'
			};

			await omProtocol(params, undefined, settings);

			expect(customResolver).toHaveBeenCalled();
		});
	});
});

describe('getValueFromLatLong', () => {
	it('returns interpolated value from loaded state', async () => {
		const { omProtocol } = await import('../om-protocol');
		const { getValueFromLatLong } = await import('../om-protocol-state');

		// First load data via tile request
		const url =
			'om://https://map-tiles.open-meteo.com/data_spatial/dwd_icon/2025/10/27/1200Z/2025-10-27T1200.om?variable=temperature_2m/0/0/0';
		await omProtocol({ url, type: 'arrayBuffer' }, undefined, defaultOmProtocolSettings);

		// Then query value
		const result = getValueFromLatLong(0, 0, url);

		expect(result.value).toBe(0); // Mock returns zeros
	});

	it('throws when protocol not initialized', async () => {
		const { getValueFromLatLong } = await import('../om-protocol-state');

		expect(() =>
			getValueFromLatLong(
				0,
				0,
				'om://https://example.com/data_spatial/dwd_icon/file.om?variable=temp'
			)
		).toThrow('OmProtocolInstance is not initialized');
	});

	it('throws when state not found', async () => {
		const { omProtocol } = await import('../om-protocol');
		const { getValueFromLatLong } = await import('../om-protocol-state');

		// Initialize protocol with one URL
		await omProtocol(
			{
				url: 'om://https://map-tiles.open-meteo.com/data_spatial/dwd_icon/2025/10/27/1200Z/2025-10-27T1200.om?variable=temperature_2m/0/0/0',
				type: 'arrayBuffer'
			},
			undefined,
			defaultOmProtocolSettings
		);

		// Query with different URL
		expect(() =>
			getValueFromLatLong(
				0,
				0,
				'om://https://example.com/data_spatial/dwd_icon/other.om?variable=other'
			)
		).toThrow('State not found');
	});
});

describe('omProtocol', () => {
	describe('TileJSON requests', () => {
		beforeEach(() => {
			vi.resetModules();
			// FIXME: This is extremely ugly. Any test after these tests will not have the om-file-reader mock available anymore.
			vi.doUnmock('../om-file-reader');
		});

		afterEach(() => {
			// Re-establish mock for tests outside this block
			vi.resetModules();
		});
		it('returns tilejson with correct tiles URL', async () => {
			const { omProtocol } = await import('../om-protocol');
			const params: RequestParameters = {
				url: 'om://https://map-tiles.open-meteo.com/data_spatial/dwd_icon/latest.json?variable=temperature_2m',
				type: 'json'
			};
			const result = await omProtocol(params, undefined, defaultOmProtocolSettings);
			const resultData = result.data as TileJSON;

			expect(resultData.tilejson).toBe('2.2.0');
			expect(resultData.tiles[0]).toBe(params.url + '/{z}/{x}/{y}');
			expect(resultData.attribution).toContain('Open-Meteo');
			expect(resultData.minzoom).toBe(0);
			expect(resultData.maxzoom).toBe(12);
			expect(resultData.bounds).toBeDefined();
		});

		it('returns correct bounds for domain grid', async () => {
			const { omProtocol } = await import('../om-protocol');
			const params: RequestParameters = {
				url: 'om://https://map-tiles.open-meteo.com/data_spatial/dwd_icon/latest.json?variable=temperature_2m',
				type: 'json'
			};
			const result = await omProtocol(params, undefined, defaultOmProtocolSettings);
			const resultData = result.data as TileJSON;

			// DWD ICON global bounds
			expect(resultData.bounds).toEqual([-180, -90, 179.875, 90.125]);
		});
	});

	describe('tile requests', () => {
		it('early return for vector requests', async () => {
			const { omProtocol } = await import('../om-protocol');

			const params: RequestParameters = {
				url: 'om://https://map-tiles.open-meteo.com/data_spatial/dwd_icon/latest.json?variable=temperature_2m/0/0/0',
				type: 'arrayBuffer'
			};
			const result = await omProtocol(params, undefined, defaultOmProtocolSettings);

			expect(result.data).toBeInstanceOf(ArrayBuffer);
			expect(result.data as ArrayBuffer).toEqual(new ArrayBuffer(0));
		});

		it('throws for tile request without coordinates', async () => {
			const { omProtocol } = await import('../om-protocol');

			const params: RequestParameters = {
				url: 'om://https://map-tiles.open-meteo.com/data_spatial/dwd_icon/latest.json?variable=temperature_2m',
				type: 'arrayBuffer'
			};

			await expect(omProtocol(params, undefined, defaultOmProtocolSettings)).rejects.toThrow(
				'Tile coordinates required'
			);
		});

		it('calls postReadCallback after data is loaded', async () => {
			const { omProtocol } = await import('../om-protocol');

			const postReadCallback = vi.fn();
			const settings = createTestSettings({ postReadCallback });

			const params: RequestParameters = {
				url: 'om://https://map-tiles.open-meteo.com/data_spatial/dwd_icon/latest.json?variable=temperature_2m/0/0/0',
				type: 'arrayBuffer'
			};

			await omProtocol(params, undefined, settings);

			expect(postReadCallback).toHaveBeenCalledTimes(1);
			expect(postReadCallback).toHaveBeenCalledWith(
				expect.anything(), // omFileReader
				expect.objectContaining({ values: expect.any(Float32Array) }), // data
				expect.objectContaining({ omFileUrl: expect.stringContaining('map-tiles.open-meteo.com') })
			);
		});
	});
});
