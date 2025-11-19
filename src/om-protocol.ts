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

import type { ColorScales, DimensionRange, Domain, TileIndex, TileJSON, Variable } from './types';

interface OmProtocolInstance {
	colorScales: ColorScales;
	domainOptions: Domain[];
	variableOptions: Variable[];
	resolutionFactor: 0.5 | 1 | 2;
	omFileReader: OMapsFileReader;

	// per-URL state:
	stateByKey: Map<string, OmUrlState>;
}

interface OmUrlState {
	omUrl: string;
	dark: boolean;
	partial: boolean;
	tileSize: number;
	interval: number;
	domain: Domain;
	variable: Variable;
	mapBounds: number[];
	ranges: DimensionRange[] | null;

	data: Data | null;
	dataPromise: Promise<Data> | null;
	lastAccess: number;
}

export interface OmParseUrlCallbackResult {
	variable: Variable;
	ranges: DimensionRange[] | null;
	omUrl: string;
	dark: boolean;
	partial: boolean;
	interval: number;
	domain: Domain;
	mapBounds: number[];
}

export interface OmProtocolSettings {
	tileSize: number;
	useSAB: boolean;
	colorScales: ColorScales;
	domainOptions: Domain[];
	variableOptions: Variable[];
	resolutionFactor: 0.5 | 1 | 2;
	parseUrlCallback: (
		url: string,
		domainOptions: Domain[],
		variableOptions: Variable[]
	) => OmParseUrlCallbackResult;
	postReadCallback:
		| ((omFileReader: OMapsFileReader, omUrl: string, data: Data) => void)
		| undefined;
}

export interface Data {
	values: Float32Array | undefined;
	directions: Float32Array | undefined;
}

setupGlobalCache();
const workerPool = new WorkerPool();

// THIS is shared global state. The protocol can be added only once with different settings!
let omProtocolInstance: OmProtocolInstance | undefined = undefined;

const getProtocolInstance = (settings: OmProtocolSettings): OmProtocolInstance => {
	if (omProtocolInstance) return omProtocolInstance;

	const inst = {
		colorScales: settings.colorScales,
		domainOptions: settings.domainOptions,
		variableOptions: settings.variableOptions,
		resolutionFactor: settings.resolutionFactor,
		omFileReader: new OMapsFileReader({ useSAB: settings.useSAB }),
		stateByKey: new Map()
	};
	omProtocolInstance = inst;
	return inst;
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

const getStateKeyFromUrl = (url: string): string => {
	const match = url.match(URL_REGEX);
	// FIXME: removing arrows=true avoids duplicate decoding for raster and vector layers (for windspeeds)
	// This should be generic over any vector layer settings.
	if (match) {
		// match[1] is "<omUrl>?query" without the leading "om://"
		return match[1].replace('arrows=true', '');
	}
	// JSON request or non-tile URL: just strip the om:// prefix
	return url.replace(/^om:\/\//, '').replace('arrows=true', '');
};

const getOrCreateUrlState = (
	url: string,
	protocol: OmProtocolInstance,
	settings: OmProtocolSettings
): OmUrlState => {
	const key = getStateKeyFromUrl(url);
	const existing = protocol.stateByKey.get(key);
	if (existing) return existing;

	console.warn('Creating new state for URL:', url);

	const parsed = settings.parseUrlCallback(url, protocol.domainOptions, protocol.variableOptions);

	const { omUrl, variable, ranges, dark, partial, interval, domain, mapBounds } = parsed;

	const state: OmUrlState = {
		omUrl,
		dark,
		partial,
		tileSize: settings.tileSize,
		interval,
		domain,
		variable,
		mapBounds,
		ranges,
		data: null,
		dataPromise: null,
		lastAccess: Date.now()
	};

	protocol.stateByKey.set(key, state);
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
	variable: Variable,
	omUrl: string
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
	protocol: OmProtocolInstance,
	state: OmUrlState,
	data: Data,
	omUrl: string,
	type: 'image' | 'arrayBuffer'
): TilePromise => {
	const key = `${omUrl}/${state.tileSize}/${z}/${x}/${y}`;

	return await workerPool.requestTile({
		type: ('get' + capitalize(type)) as 'getImage' | 'getArrayBuffer',
		x,
		y,
		z,
		key,
		data,
		dark: state.dark,
		ranges: state.ranges,
		tileSize: protocol.resolutionFactor * state.tileSize,
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
	protocol: OmProtocolInstance,
	state: OmUrlState,
	settings: OmProtocolSettings
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
	return getTile({ z, x, y }, protocol, state, data, omUrl, type);
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
	tileSize: 256,
	useSAB: false,
	colorScales: defaultColorScales,
	domainOptions: defaultDomainOptions,
	variableOptions: defaultVariableOptions,
	resolutionFactor: 1,
	parseUrlCallback: parseOmUrl,
	postReadCallback: undefined
};

export const omProtocol = async (
	params: RequestParameters,
	abortController?: AbortController,
	omProtocolSettings = defaultOmProtocolSettings
): Promise<GetResourceResponse<TileJSON | ImageBitmap | ArrayBuffer>> => {
	const protocol = getProtocolInstance(omProtocolSettings);
	const state = getOrCreateUrlState(params.url, protocol, omProtocolSettings);

	if (params.type == 'json') {
		return { data: await getTilejson(params.url, state) };
	} else if (params.type && ['image', 'arrayBuffer'].includes(params.type)) {
		return {
			data: await renderTile(
				params.url,
				params.type as 'image' | 'arrayBuffer',
				protocol,
				state,
				omProtocolSettings
			)
		};
	} else {
		throw new Error(`Unsupported request type '${params.type}'`);
	}
};
