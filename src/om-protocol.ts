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

// Shared global state. The protocol can be added only once with different settings
let omProtocolInstance: OmProtocolInstance | undefined = undefined;

const getProtocolInstance = (settings: OmProtocolSettings): OmProtocolInstance => {
	if (omProtocolInstance) return omProtocolInstance;

	const instance = {
		colorScales: settings.colorScales,
		domainOptions: settings.domainOptions,
		variableOptions: settings.variableOptions,
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

const URL_REGEX = /^om:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/;

const getStateKeyFromUrl = (url: string): string => {
	const match = url.match(URL_REGEX);
	// This should be generic over any vector layer settings.
	if (match) {
		// match[1] is "<omUrl>?query" without the leading "om://"
		return match[1];
	}
	// JSON request or non-tile URL: just strip the om:// prefix
	return url.replace(/^om:\/\//, '');
};

const getOrCreateUrlState = (
	url: string,
	settings: OmProtocolSettings,
	protocol: OmProtocolInstance
): OmUrlState => {
	const key = getStateKeyFromUrl(url);
	const existing = protocol.stateByKey.get(key);
	if (existing) return existing;

	console.warn('Creating new state for URL:', url);

	const parsed = settings.parseUrlCallback(
		key,
		settings.partial,
		protocol.domainOptions,
		protocol.variableOptions,
		settings.mapBounds
	);

	const { omUrl, ranges, domain, variables } = parsed;

	const state: OmUrlState = {
		omUrl,
		ranges,
		domain,
		variables,

		dark: settings.dark,
		partial: settings.partial,
		tileSize: settings.tileSize,
		mapBounds: settings.mapBounds,
		contourInterval: settings.vectorOptions.contourInterval,
		resolutionFactor: settings.resolutionFactor,

		data: null,
		dataPromise: null,
		lastAccess: Date.now()
	};

	protocol.stateByKey.set(key, state);
	return state;
};

const ensureData = async (
	omUrl: string,
	state: OmUrlState,
	settings: OmProtocolSettings,
	protocol: OmProtocolInstance
): Promise<Data> => {
	state.lastAccess = Date.now();

	if (state.data) return state.data;
	if (state.dataPromise) return state.dataPromise;

	// currently only one variable supported
	let variable = state.variables;
	if (Array.isArray(variable)) {
		variable = variable[0];
	}

	const promise = (async () => {
		await protocol.omFileReader.setToOmFile(omUrl);
		const data = await protocol.omFileReader.readVariable(variable.value, state.ranges);

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
	{ z, x, y }: TileIndex,
	type: 'image' | 'arrayBuffer',
	data: Data,
	state: OmUrlState,
	omUrl: string,
	settings: OmProtocolSettings,
	protocol: OmProtocolInstance
): TilePromise => {
	const key = `${omUrl}/${state.tileSize}/${z}/${x}/${y}`;

	// currently only one variable supported
	let variable = state.variables;
	if (Array.isArray(variable)) {
		variable = variable[0];
	}

	return await workerPool.requestTile({
		type: ('get' + capitalize(type)) as 'getImage' | 'getArrayBuffer',

		x,
		y,
		z,
		key,
		data,
		dark: state.dark,
		ranges: state.ranges,
		tileSize: state.resolutionFactor * state.tileSize,
		domain: state.domain,
		variables: variable,
		colorScale:
			protocol.colorScales?.custom ??
			protocol.colorScales[variable.value] ??
			getColorScale(variable.value),
		mapBounds: state.mapBounds,
		vectorOptions: settings.vectorOptions
	});
};

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

	const data = await ensureData(omUrl, state, settings, protocol);
	return getTile({ z, x, y }, type, data, state, omUrl, settings, protocol);
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
	partial: boolean,
	domainOptions: Domain[],
	variableOptions: Variable[],
	mapBounds?: number[]
): OmParseUrlCallbackResult => {
	const [omUrl, omUrlParams] = url.replace('om://', '').split('?');

	const urlParams = new URLSearchParams(omUrlParams);

	const domain = domainOptions.find((dm) => dm.value === omUrl.split('/')[4]) ?? domainOptions[0];
	const variables =
		variableOptions.find((v) => urlParams.get('variable') === v.value) ?? variableOptions[0];

	// We initialize the grid with the ranges set to null
	// This will return the entire grid, and allows us to parse the ranges which cover the map bounds
	const grid = GridFactory.create(domain.grid, null);

	let ranges: DimensionRange[] | null;
	if (partial && mapBounds) {
		ranges = grid.getCoveringRanges(mapBounds[0], mapBounds[1], mapBounds[2], mapBounds[3]);
	} else {
		ranges = [
			{ start: 0, end: domain.grid.ny },
			{ start: 0, end: domain.grid.nx }
		];
	}

	return { omUrl, ranges, variables, domain };
};

export const defaultOmProtocolSettings: OmProtocolSettings = {
	// solid state
	tileSize: 256,
	useSAB: false,

	// can be altered during runtime
	dark: false,
	partial: false,
	colorScales: defaultColorScales,
	mapBounds: undefined,
	domainOptions: defaultDomainOptions,
	variableOptions: defaultVariableOptions,
	resolutionFactor: 1,
	parseUrlCallback: parseOmUrl,
	postReadCallback: undefined,

	vectorOptions: {
		grid: false,
		arrows: true,
		contours: false,
		contourInterval: 2
	}
};

export const omProtocol = async (
	params: RequestParameters,
	abortController?: AbortController,
	omProtocolSettings = defaultOmProtocolSettings
): Promise<GetResourceResponse<TileJSON | ImageBitmap | ArrayBuffer>> => {
	const protocolInstance = getProtocolInstance(omProtocolSettings);
	const state = getOrCreateUrlState(params.url, omProtocolSettings, protocolInstance);

	if (params.type == 'json') {
		return { data: await getTilejson(params.url, state) };
	} else if (params.type && ['image', 'arrayBuffer'].includes(params.type)) {
		return {
			data: await renderTile(
				params.url,
				params.type as 'image' | 'arrayBuffer',
				state,
				omProtocolSettings,
				protocolInstance
			)
		};
	} else {
		throw new Error(`Unsupported request type '${params.type}'`);
	}
};
