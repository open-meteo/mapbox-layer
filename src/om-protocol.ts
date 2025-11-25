import { setupGlobalCache } from '@openmeteo/file-reader';
import { type GetResourceResponse, type RequestParameters } from 'maplibre-gl';

import { colorScales as defaultColorScales } from './utils/color-scales';
import { MS_TO_KMH } from './utils/constants';
import { getColorScale } from './utils/styling';
import { variableOptions as defaultVariableOptions } from './utils/variables';

import { domainOptions as defaultDomainOptions } from './domains';
import { GridFactory } from './grids/index';
import { OMapsFileReader } from './om-file-reader';
import { capitalize } from './utils';
import { TilePromise, WorkerPool } from './worker-pool';

import type {
	Data,
	DimensionRange,
	Domain,
	OmParseUrlCallbackResult,
	OmProtocolInstance,
	OmProtocolSettings,
	OmUrlState,
	TileIndex,
	TileJSON,
	Variable
} from './types';

setupGlobalCache();
const workerPool = new WorkerPool();

// THIS is shared global state. The protocol can be added only once with different settings!
let omProtocolInstance: OmProtocolInstance | undefined = undefined;

const getProtocolInstance = (settings: OmProtocolSettings): OmProtocolInstance => {
	if (omProtocolInstance) return omProtocolInstance;

	const instance = {
		colorScales: settings.colorScales,
		domainOptions: settings.domainOptions,
		variableOptions: settings.variableOptions,
		resolutionFactor: settings.resolutionFactor, // move to url
		omFileReader: new OMapsFileReader({ useSAB: settings.useSAB }),
		stateByKey: new Map()
	};
	omProtocolInstance = instance;
	return instance;
};

/// needs to be called before setUrl using the old source url
export const clearOmUrlData = (url: string) => {
	if (!omProtocolInstance) return;
	const key = getStateKeyFromUrl(url);
	const state = omProtocolInstance.stateByKey.get(key);
	if (!state) return;
	state.data = null;
	state.dataPromise = null;
};

const STATE_REGEX = /(?<grid>&grid=true)|(?<arrows>&arrows=true)|(?<contours>&contours=true)/gm;
const getStateKeyFromUrl = (url: string): string => {
	return url.replace(/^om:\/\//, '').replace(STATE_REGEX, '');
};

const getOrCreateUrlState = (
	url: string,
	settings: OmProtocolSettings,
	instance: OmProtocolInstance
): OmUrlState => {
	const key = getStateKeyFromUrl(url);
	const existing = instance.stateByKey.get(key);
	if (existing) return existing;

	console.warn('Creating new state for URL:', url);

	const parsed = settings.parseUrlCallback(key, instance.domainOptions, instance.variableOptions);

	const { omUrl, variable, ranges, dark, partial, interval, domain, mapBounds } = parsed;

	const state: OmUrlState = {
		dark,
		omUrl,
		partial,
		ranges,
		tileSize: settings.tileSize,
		interval,
		domain,
		variable,
		mapBounds,
		resolutionFactor: settings.resolutionFactor,

		data: null,
		dataPromise: null,
		lastAccess: Date.now()
	};

	instance.stateByKey.set(key, state);
	return state;
};

const ensureData = async (
	omUrl: string,
	protocol: OmProtocolInstance,
	state: OmUrlState,
	settings: OmProtocolSettings
): Promise<Data> => {
	state.lastAccess = Date.now();

	if (state.data) return state.data;
	if (state.dataPromise) return state.dataPromise;

	const promise = (async () => {
		await protocol.omFileReader.setToOmFile(omUrl);
		const data = await protocol.omFileReader.readVariable(state.variable.value, state.ranges);

		state.data = data;
		state.dataPromise = null;

		if (settings.postReadCallback) {
			settings.postReadCallback(protocol.omFileReader, omUrl, data);
		}
		return data;
	})();

	state.dataPromise = promise;
	return promise;
};

export const getValueFromLatLong = (
	lat: number,
	lon: number,
	omUrl: string,
	variable: Variable
): { value: number; direction?: number } => {
	const key = getStateKeyFromUrl(omUrl);
	if (!omProtocolInstance) {
		throw new Error('OmProtocolInstance is not initialized');
	}
	const state = omProtocolInstance.stateByKey.get(key);
	if (!state) {
		throw new Error('State not found');
	}

	if (!state.data?.values) {
		return { value: NaN };
	}

	const values = state.data.values;
	const grid = GridFactory.create(state.domain.grid, state.ranges);
	let px = grid.getLinearInterpolatedValue(values, lat, ((lon + 180) % 360) - 180);
	if (variable.value.includes('wind')) {
		px = px * MS_TO_KMH;
	}
	return { value: px };
};

const getTile = async (
	tileIndex: TileIndex,
	type: 'image' | 'arrayBuffer',
	data: Data,
	state: OmUrlState,
	omUrl: string,
	protocol: OmProtocolInstance
): TilePromise => {
	const { z, x, y } = tileIndex;
	const key = `${omUrl}/${state.tileSize}/${z}/${x}/${y}`;

	return await workerPool.requestTile({
		type: ('get' + capitalize(type)) as 'getImage' | 'getArrayBuffer',
		tileIndex,
		key,
		data,
		dark: state.dark,
		ranges: state.ranges,
		tileSize: state.resolutionFactor * state.tileSize,
		interval: state.interval,
		domain: state.domain,
		variable: state.variable,
		colorScale:
			protocol.colorScales?.custom ??
			protocol.colorScales[state.variable.value] ??
			getColorScale(state.variable.value),
		mapBounds: state.mapBounds
	});
};

const URL_REGEX = /^om:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/;
const renderTile = async (
	url: string,
	type: 'image' | 'arrayBuffer',
	state: OmUrlState,
	settings: OmProtocolSettings,
	protocol: OmProtocolInstance
) => {
	const result = url.match(URL_REGEX);
	if (!result) {
		throw new Error(`Invalid OM protocol URL '${url}'`);
	}
	const urlParts = result[1].split('#');
	const omUrl = urlParts[0];
	const z = parseInt(result[2]);
	const x = parseInt(result[3]);
	const y = parseInt(result[4]);

	const data = await ensureData(omUrl, protocol, state, settings);
	return getTile({ z, x, y }, type, data, state, omUrl, protocol);
};

const getTilejson = async (fullUrl: string, state: OmUrlState): Promise<TileJSON> => {
	// We initialize the grid with the ranges set to null, because we want to find out the maximum bounds of this grid
	const grid = GridFactory.create(state.domain.grid, null);
	const bounds = grid.getBounds();

	return {
		tilejson: '2.2.0',
		tiles: [fullUrl + '/{z}/{x}/{y}'],
		attribution: '<a href="https://open-meteo.com">Open-Meteo</a>',
		minzoom: 0,
		maxzoom: 12,
		bounds: bounds
	};
};

/**
 * Parses an OM protocol URL and extracts settings for rendering.
 * Returns an object with dark mode, partial mode, domain, variable, ranges, and omUrl.
 */
export const parseOmUrl = (
	url: string,
	domainOptions: Domain[],
	variableOptions: Variable[]
): OmParseUrlCallbackResult => {
	const [omUrl, omParams] = url.replace('om://', '').split('?');
	const urlParams = new URLSearchParams(omParams);

	const dark = urlParams.get('dark') === 'true';
	const partial = urlParams.get('partial') === 'true';
	const interval = Number(urlParams.get('interval'));
	const domain = domainOptions.find((dm) => dm.value === omUrl.split('/')[4]) ?? domainOptions[0];
	const variable =
		variableOptions.find((v) => urlParams.get('variable') === v.value) ?? variableOptions[0];
	const mapBounds = urlParams
		.get('bounds')
		?.split(',')
		.map((b: string): number => Number(b)) as number[];

	// We initialize the grid with the ranges set to null
	// This will return the entire grid, and allows us to parse the ranges which cover the map bounds
	const gridGetter = GridFactory.create(domain.grid, null);

	let ranges: DimensionRange[] | null;
	if (partial) {
		ranges = gridGetter.getCoveringRanges(mapBounds[0], mapBounds[1], mapBounds[2], mapBounds[3]);
	} else {
		ranges = [
			{ start: 0, end: domain.grid.ny },
			{ start: 0, end: domain.grid.nx }
		];
	}

	return { variable, ranges, omUrl, dark, partial, interval, domain, mapBounds };
};

export const defaultOmProtocolSettings: OmProtocolSettings = {
	// static
	useSAB: false,

	// dynamic
	tileSize: 256, // move to url
	resolutionFactor: 1, // move to url
	colorScales: defaultColorScales,
	domainOptions: defaultDomainOptions,
	variableOptions: defaultVariableOptions,

	parseUrlCallback: parseOmUrl,
	postReadCallback: undefined
};

export const omProtocol = async (
	params: RequestParameters,
	abortController?: AbortController,
	omProtocolSettings = defaultOmProtocolSettings
): Promise<GetResourceResponse<TileJSON | ImageBitmap | ArrayBuffer>> => {
	const protocol = getProtocolInstance(omProtocolSettings);
	const state = getOrCreateUrlState(params.url, omProtocolSettings, protocol);

	if (params.type == 'json') {
		return { data: await getTilejson(params.url, state) };
	} else if (params.type && ['image', 'arrayBuffer'].includes(params.type)) {
		return {
			data: await renderTile(
				params.url,
				params.type as 'image' | 'arrayBuffer',
				state,
				omProtocolSettings,
				protocol
			)
		};
	} else {
		throw new Error(`Unsupported request type '${params.type}'`);
	}
};
