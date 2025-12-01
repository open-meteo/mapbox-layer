import { setupGlobalCache } from '@openmeteo/file-reader';
import { type GetResourceResponse, type RequestParameters } from 'maplibre-gl';

import { colorScales as defaultColorScales } from './utils/color-scales';
import { MS_TO_KMH } from './utils/constants';
import {
	assertOmUrlValid,
	parseMetaJson,
	parseResolutionFactor,
	parseTileSize,
	parseUrlComponents
} from './utils/parse-url';
import { getColorScale } from './utils/styling';
import { variableOptions as defaultVariableOptions } from './utils/variables';

import { domainOptions as defaultDomainOptions } from './domains';
import { GridFactory } from './grids/index';
import { OMapsFileReader } from './om-file-reader';
import { capitalize } from './utils';
import { WorkerPool } from './worker-pool';

import type {
	ColorScales,
	Data,
	DataIdentityOptions,
	DimensionRange,
	Domain,
	OmProtocolInstance,
	OmProtocolSettings,
	OmUrlState,
	ParsedRequest,
	ParsedUrlComponents,
	RenderOptions,
	TileJSON,
	TilePromise,
	Variable
} from './types';

// Configuration constants - could be made configurable via OmProtocolSettings
/** Max states that keep data loaded.
 *
 * This should be as low as possible, but needs to be at least the number of
 * variables that you want to display simultaneously. */
const MAX_STATES_WITH_DATA = 2;
/** 1 minute for hard eviction on new data fetches */
const STALE_THRESHOLD_MS = 1 * 60 * 1000;

const workerPool = new WorkerPool();
setupGlobalCache();

// THIS is shared global state. The protocol can be added only once with different settings!
let omProtocolInstance: OmProtocolInstance | undefined = undefined;

const getProtocolInstance = (settings: OmProtocolSettings): OmProtocolInstance => {
	if (omProtocolInstance) {
		// Warn if critical settings differ from initial configuration
		if (settings.useSAB !== omProtocolInstance.omFileReader.config.useSAB) {
			console.warn(
				'omProtocol: useSAB setting differs from initial configuration. ' +
					'The protocol instance is shared and uses the first settings provided.'
			);
		}
		return omProtocolInstance;
	}

	const instance = {
		omFileReader: new OMapsFileReader({ useSAB: settings.useSAB }),
		stateByKey: new Map()
	};
	omProtocolInstance = instance;
	return instance;
};

/**
 * Evicts old state entries.
 * Since Map maintains insertion order and we re-insert on access,
 * the oldest entries are always at the front - no sorting needed.
 */
const evictStaleStates = (stateByKey: Map<string, OmUrlState>, currentKey?: string): void => {
	const now = Date.now();

	// Iterate from oldest to newest (Map iteration order)
	for (const [key, state] of stateByKey) {
		// Stop if we're under the limit and remaining entries aren't stale
		if (stateByKey.size <= MAX_STATES_WITH_DATA) {
			const age = now - state.lastAccess;
			if (age <= STALE_THRESHOLD_MS) break; // Remaining entries are newer
		}

		if (key === currentKey) continue;

		const age = now - state.lastAccess;
		const isStale = age > STALE_THRESHOLD_MS;
		const exceedsMax = stateByKey.size > MAX_STATES_WITH_DATA;

		if (isStale || exceedsMax) {
			console.log(`Evicting stale state for key: ${key}`);
			stateByKey.delete(key);
		} else {
			break; // All remaining entries are newer, stop iterating
		}
	}
};

/**
 * Moves an entry to the end of the map (most recently used position).
 * This maintains LRU order without sorting.
 */
const touchState = (stateByKey: Map<string, OmUrlState>, key: string, state: OmUrlState): void => {
	state.lastAccess = Date.now();
	// Delete and re-insert to move to end (most recent)
	stateByKey.delete(key);
	stateByKey.set(key, state);
};

const getOrCreateState = (
	stateByKey: Map<string, OmUrlState>,
	stateKey: string,
	dataOptions: DataIdentityOptions,
	omFileUrl: string
): OmUrlState => {
	const existing = stateByKey.get(stateKey);
	if (existing) {
		touchState(stateByKey, stateKey, existing);
		return existing;
	}

	evictStaleStates(stateByKey, stateKey);

	console.warn('Creating new state for KEY:', stateKey);

	const state: OmUrlState = {
		dataOptions,
		omFileUrl,
		data: null,
		dataPromise: null,
		lastAccess: Date.now()
	};

	stateByKey.set(stateKey, state);
	return state;
};

const ensureData = async (state: OmUrlState, omFileReader: OMapsFileReader): Promise<Data> => {
	if (state.data) return state.data;
	if (state.dataPromise) return state.dataPromise;

	const promise = (async () => {
		try {
			await omFileReader.setToOmFile(state.omFileUrl);
			const data = await omFileReader.readVariable(
				state.dataOptions.variable.value,
				state.dataOptions.ranges
			);

			state.data = data;
			state.dataPromise = null;

			return data;
		} catch (error) {
			state.dataPromise = null; // Clear promise so retry is possible
			throw error;
		}
	})();

	state.dataPromise = promise;
	return promise;
};

const defaultResolveDataIdentity = (
	components: ParsedUrlComponents,
	domainOptions: Domain[],
	variableOptions: Variable[]
): DataIdentityOptions => {
	const { baseUrl, params } = components;

	const domainValue = baseUrl.split('/')[4];
	const domain = domainOptions.find((dm) => dm.value === domainValue);
	if (!domain) {
		throw new Error(`Invalid domain: ${domainValue}`);
	}

	const variableValue = params.get('variable');
	if (!variableValue) {
		throw new Error(`Variable is required but not defined`);
	}
	const variable = variableOptions.find((v) => v.value === variableValue) ?? {
		value: variableValue
	};
	// if (!variable) {
	// 	throw new Error(`Invalid variable: ${variableValue}`);
	// }

	const partial = params.get('partial') === 'true';
	const mapBounds = params.get('bounds')?.split(',').map(Number) as number[] | undefined;

	let ranges: DimensionRange[];
	if (partial && mapBounds) {
		const gridGetter = GridFactory.create(domain.grid, null);
		ranges = gridGetter.getCoveringRanges(mapBounds[0], mapBounds[1], mapBounds[2], mapBounds[3]);
	} else {
		ranges = [
			{ start: 0, end: domain.grid.ny },
			{ start: 0, end: domain.grid.nx }
		];
	}

	return { domain, variable, ranges };
};

const defaultResolveRenderOptions = (
	components: ParsedUrlComponents,
	dataOptions: DataIdentityOptions,
	colorScales: ColorScales
): RenderOptions => {
	const { params } = components;

	const dark = params.get('dark') === 'true';

	const tileSize = parseTileSize(params.get('tile-size'));
	const resolutionFactor = parseResolutionFactor(params.get('resolution-factor'));

	const makeGrid = params.get('grid') === 'true';
	const makeArrows = params.get('arrows') === 'true';
	const makeContours = params.get('contours') === 'true';
	const interval = Number(params.get('interval')) || 0;

	const colorScale =
		colorScales?.custom ??
		colorScales[dataOptions.variable.value] ??
		getColorScale(dataOptions.variable.value);

	return {
		dark,
		tileSize,
		resolutionFactor,
		makeGrid,
		makeArrows,
		makeContours,
		interval,
		colorScale
	};
};

export const defaultResolveRequest = (
	components: ParsedUrlComponents,
	settings: OmProtocolSettings
): { dataOptions: DataIdentityOptions; renderOptions: RenderOptions } => {
	const dataOptions = defaultResolveDataIdentity(
		components,
		settings.domainOptions,
		settings.variableOptions
	);

	const renderOptions = defaultResolveRenderOptions(components, dataOptions, settings.colorScales);

	return { dataOptions, renderOptions };
};

const parseRequest = (url: string, settings: OmProtocolSettings): ParsedRequest => {
	const components = parseUrlComponents(url);
	const resolver = settings.resolveRequest ?? defaultResolveRequest;
	const { dataOptions, renderOptions } = resolver(components, settings);

	return {
		baseUrl: components.baseUrl,
		stateKey: components.stateKey,
		tileIndex: components.tileIndex,
		dataOptions,
		renderOptions
	};
};

const normalizeUrl = async (url: string): Promise<string> => {
	let normalized = url;
	if (normalized.includes('.json')) {
		normalized = await parseMetaJson(normalized);
	}
	assertOmUrlValid(normalized);
	return normalized;
};

const buildTileKey = (request: ParsedRequest): string => {
	const { baseUrl, renderOptions, tileIndex } = request;
	if (!tileIndex) {
		throw new Error('Cannot build tile key without tile index');
	}
	return `${baseUrl}/${renderOptions.tileSize}/${tileIndex.z}/${tileIndex.x}/${tileIndex.y}`;
};

const requestTile = async (
	request: ParsedRequest,
	data: Data,
	type: 'image' | 'arrayBuffer'
): TilePromise => {
	if (!request.tileIndex) {
		throw new Error('Tile coordinates required for tile request');
	}

	const key = buildTileKey(request);

	return workerPool.requestTile({
		type: `get${capitalize(type)}` as 'getImage' | 'getArrayBuffer',
		key,
		tileIndex: request.tileIndex,
		data,
		dataOptions: request.dataOptions,
		renderOptions: request.renderOptions
	});
};

const getTilejson = async (
	fullUrl: string,
	dataOptions: DataIdentityOptions
): Promise<TileJSON> => {
	// We initialize the grid with the ranges set to null, because we want to find out the maximum bounds of this grid
	const grid = GridFactory.create(dataOptions.domain.grid, null);
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

export const getValueFromLatLong = (
	lat: number,
	lon: number,
	omUrl: string,
	variable: Variable
): { value: number; direction?: number } => {
	if (!omProtocolInstance) {
		throw new Error('OmProtocolInstance is not initialized');
	}

	const { stateKey } = parseUrlComponents(omUrl);
	const state = omProtocolInstance.stateByKey.get(stateKey);
	if (!state) {
		throw new Error(`State not found for key: ${stateKey}`);
	}

	state.lastAccess = Date.now();

	if (!state.data?.values) {
		return { value: NaN };
	}

	const grid = GridFactory.create(state.dataOptions.domain.grid, state.dataOptions.ranges);
	let value = grid.getLinearInterpolatedValue(state.data.values, lat, ((lon + 180) % 360) - 180);

	if (variable.value.includes('wind')) {
		value = value * MS_TO_KMH;
	}

	return { value };
};

export const defaultOmProtocolSettings: OmProtocolSettings = {
	// static
	useSAB: false,

	// dynamic
	colorScales: defaultColorScales,
	domainOptions: defaultDomainOptions,
	variableOptions: defaultVariableOptions,

	resolveRequest: defaultResolveRequest,
	postReadCallback: undefined
};

export const omProtocol = async (
	params: RequestParameters,
	abortController?: AbortController,
	settings = defaultOmProtocolSettings
): Promise<GetResourceResponse<TileJSON | ImageBitmap | ArrayBuffer>> => {
	const instance = getProtocolInstance(settings);

	const url = await normalizeUrl(params.url);
	const request = parseRequest(url, settings);

	// Handle TileJSON request
	if (params.type == 'json') {
		return { data: await getTilejson(params.url, request.dataOptions) };
	}

	// Handle tile request
	if (params.type !== 'image' && params.type !== 'arrayBuffer') {
		throw new Error(`Unsupported request type '${params.type}'`);
	}

	if (!request.tileIndex) {
		throw new Error(`Tile coordinates required for ${params.type} request`);
	}

	const state = getOrCreateState(
		instance.stateByKey,
		request.stateKey,
		request.dataOptions,
		request.baseUrl
	);

	const data = await ensureData(state, instance.omFileReader);

	if (settings.postReadCallback) {
		settings.postReadCallback(instance.omFileReader, request.baseUrl, data);
	}

	const tile = await requestTile(request, data, params.type);

	return { data: tile };
};
