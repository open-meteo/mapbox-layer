import { setupGlobalCache } from '@openmeteo/file-reader';
import { type GetResourceResponse, type RequestParameters } from 'maplibre-gl';

import { colorScales as defaultColorScales } from './utils/color-scales';
import { MS_TO_KMH } from './utils/constants';
import { assertOmUrlValid, parseMetaJson } from './utils/parse-url';
import { getColorScale } from './utils/styling';
import { variableOptions as defaultVariableOptions } from './utils/variables';

import { domainOptions as defaultDomainOptions } from './domains';
import { GridFactory } from './grids/index';
import { OMapsFileReader } from './om-file-reader';
import { capitalize } from './utils';
import { WorkerPool } from './worker-pool';

import type {
	Data,
	DimensionRange,
	Domain,
	OmProtocolInstance,
	OmProtocolSettings,
	OmUrlState,
	ParsedUrlComponents,
	ResolvedUrlSettings,
	TileIndex,
	TileJSON,
	TilePromise,
	TileRequestOptions,
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
const evictStaleStates = (instance: OmProtocolInstance, currentKey?: string): void => {
	const now = Date.now();
	const map = instance.stateByKey;

	// Iterate from oldest to newest (Map iteration order)
	for (const [key, state] of map) {
		// Stop if we're under the limit and remaining entries aren't stale
		if (map.size <= MAX_STATES_WITH_DATA) {
			const age = now - state.lastAccess;
			if (age <= STALE_THRESHOLD_MS) break; // Remaining entries are newer
		}

		if (key === currentKey) continue;

		const age = now - state.lastAccess;
		const isStale = age > STALE_THRESHOLD_MS;
		const exceedsMax = map.size > MAX_STATES_WITH_DATA;

		if (isStale || exceedsMax) {
			console.log(`Evicting stale state for key: ${key}`);
			map.delete(key);
		} else {
			break; // All remaining entries are newer, stop iterating
		}
	}
};

/**
 * Moves an entry to the end of the map (most recently used position).
 * This maintains LRU order without sorting.
 */
const touchState = (map: Map<string, OmUrlState>, key: string, state: OmUrlState): void => {
	state.lastAccess = Date.now();
	// Delete and re-insert to move to end (most recent)
	map.delete(key);
	map.set(key, state);
};

// Parameters that don't affect the data identity (only affect rendering)
const RENDERING_ONLY_PARAMS = new Set([
	'grid',
	'arrows',
	'contours',
	'partial',
	'tile-size', // TODO: tile_size ?
	'resolution-factor', // TODO: resolution_factor ?
	'interval'
]);

const URL_REGEX = /^om:\/\/([^?]+)(?:\?(.*))?$/;
// Match both regular and percent-encoded slashes
const TILE_SUFFIX_REGEX = /(?:\/|%2F)(\d+)(?:\/|%2F)(\d+)(?:\/|%2F)(\d+)$/i;

/**
 * Parses URL structure - this is always done internally.
 * Handles om:// prefix, query params, and tile coordinates.
 *
 * The URL structure is:
 * om://<baseUrl>?<params>/<z>/<x>/<y>  (tile request)
 * om://<baseUrl>?<params>              (tilejson request)
 * om://<baseUrl>/<z>/<x>/<y>           (tile request, no params)
 * om://<baseUrl>                       (tilejson request, no params)
 */
export const parseUrlComponents = (url: string): ParsedUrlComponents => {
	let urlToParse = url;
	let tileIndex: TileIndex | null = null;

	const tileMatch = url.match(TILE_SUFFIX_REGEX);
	if (tileMatch) {
		tileIndex = {
			z: parseInt(tileMatch[1]),
			x: parseInt(tileMatch[2]),
			y: parseInt(tileMatch[3])
		};
		urlToParse = url.slice(0, tileMatch.index);
	} else {
		console.log(`No tile match in '${url}`);
	}

	// Now validate and parse the rest
	const match = urlToParse.match(URL_REGEX);
	if (!match) {
		throw new Error(`Invalid OM protocol URL: ${url}`);
	}

	const [, baseUrl, queryString] = match;
	const params = new URLSearchParams(queryString ?? '');

	console.log('params', params);

	// Build state key from baseUrl + only data-affecting params
	const dataParams = new URLSearchParams();
	for (const [key, value] of params) {
		if (!RENDERING_ONLY_PARAMS.has(key)) {
			dataParams.set(key, value);
		}
	}
	dataParams.sort();
	const paramString = dataParams.toString();
	const stateKey = paramString ? `${baseUrl}?${paramString}` : baseUrl;

	return { baseUrl, params, stateKey, tileIndex };
};

interface UrlStateResult {
	state: OmUrlState;
	options: ResolvedUrlSettings;
	stateKey: string;
	tileIndex: TileIndex | null;
	baseUrl: string;
}

const getOrCreateUrlState = (
	url: string,
	settings: OmProtocolSettings,
	instance: OmProtocolInstance
): UrlStateResult => {
	const components = parseUrlComponents(url);
	const { baseUrl, stateKey, tileIndex } = components;

	const resolved = settings.resolveUrlSettings(
		components,
		settings.domainOptions,
		settings.variableOptions
	);

	const existing = instance.stateByKey.get(stateKey);
	if (existing) {
		touchState(instance.stateByKey, stateKey, existing); // Move to end
		return { state: existing, stateKey, tileIndex, baseUrl, options: resolved };
	}

	console.warn('Creating new state for KEY:', stateKey);

	const state: OmUrlState = {
		domain: resolved.domain,
		variable: resolved.variable,
		ranges: resolved.ranges,
		omFileUrl: baseUrl,
		data: null,
		dataPromise: null,
		lastAccess: Date.now()
	};

	instance.stateByKey.set(stateKey, state);
	return { state, stateKey, tileIndex, baseUrl, options: resolved };
};

const ensureData = async (
	baseUrl: string,
	stateKey: string,
	protocol: OmProtocolInstance,
	state: OmUrlState,
	settings: OmProtocolSettings
): Promise<Data> => {
	if (state.data) return state.data;
	if (state.dataPromise) return state.dataPromise;

	// Evict stale entries before loading new data
	evictStaleStates(protocol, stateKey);

	const promise = (async () => {
		await protocol.omFileReader.setToOmFile(baseUrl);
		const data = await protocol.omFileReader.readVariable(state.variable.value, state.ranges);

		state.data = data;
		state.dataPromise = null;

		if (settings.postReadCallback) {
			settings.postReadCallback(protocol.omFileReader, baseUrl, data);
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
	if (!omProtocolInstance) {
		throw new Error('OmProtocolInstance is not initialized');
	}

	const { stateKey } = parseUrlComponents(omUrl);
	const state = omProtocolInstance.stateByKey.get(stateKey);
	if (!state) {
		throw new Error(`State not found for key: ${stateKey}`);
	}
	// Update access time to prevent eviction during active queries
	state.lastAccess = Date.now();

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
	options: ResolvedUrlSettings,
	omUrl: string,
	settings: OmProtocolSettings
): TilePromise => {
	const { z, x, y } = tileIndex;
	const key = `${omUrl}/${options.tileSize}/${z}/${x}/${y}`;

	const tileOptions: TileRequestOptions = {
		...options,
		colorScale:
			settings.colorScales?.custom ??
			settings.colorScales[options.variable.value] ??
			getColorScale(options.variable.value)
	};

	return await workerPool.requestTile({
		type: ('get' + capitalize(type)) as 'getImage' | 'getArrayBuffer',
		key,
		tileIndex,
		data,
		options: tileOptions
	});
};

const renderTile = async (
	tileIndex: TileIndex,
	baseUrl: string,
	stateKey: string,
	type: 'image' | 'arrayBuffer',
	state: OmUrlState,
	options: ResolvedUrlSettings,
	settings: OmProtocolSettings,
	protocol: OmProtocolInstance
) => {
	const data = await ensureData(baseUrl, stateKey, protocol, state, settings);
	return getTile(tileIndex, type, data, options, baseUrl, settings);
};

const getTilejson = async (fullUrl: string, options: ResolvedUrlSettings): Promise<TileJSON> => {
	// We initialize the grid with the ranges set to null, because we want to find out the maximum bounds of this grid
	const grid = GridFactory.create(options.domain.grid, null);
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

/** Default implementation for resolving URL settings */
export const defaultResolveUrlSettings = (
	{ baseUrl, params }: ParsedUrlComponents,
	domainOptions: Domain[],
	variableOptions: Variable[]
): ResolvedUrlSettings => {
	const dark = params.get('dark') === 'true';
	const partial = params.get('partial') === 'true';
	const domain = domainOptions.find((dm) => dm.value === baseUrl.split('/')[4]);
	if (!domain) {
		throw new Error(`Invalid domain: ${baseUrl.split('/')[4]}`);
	}
	// FIXME: Variable would need to be validated per domain, possible not something we can do here
	const variable = variableOptions.find((v) => params.get('variable') === v.value);
	if (!variable) {
		throw new Error(`Invalid variable: ${params.get('variable')}`);
	}
	const mapBounds = params
		.get('bounds')
		?.split(',')
		.map((b: string): number => Number(b)) as number[];

	const tileSize = (params.get('tile-size') ? Number(params.get('tile-size')) : 256) as
		| 64
		| 128
		| 256
		| 512
		| 1024;
	if (![64, 128, 256, 512, 1024].includes(tileSize)) {
		throw new Error('Invalid tile size, please use one of: 64, 128, 256, 512, 1024');
	}
	const resolutionFactor = (
		params.get('resolution-factor') ? Number(params.get('resolution-factor')) : 1
	) as 0.5 | 1 | 2;

	if (![0.5, 1, 2].includes(resolutionFactor)) {
		throw new Error('Invalid resolution factor, please use one of: 0.5, 1, 2');
	}

	console.log('arrows param', params.get('arrows'));

	const makeGrid = params.get('grid') === 'true';
	const makeArrows = params.get('arrows') === 'true';
	const interval = Number(params.get('interval'));
	const makeContours = params.get('contours') === 'true';

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

	return {
		dark,
		partial,
		ranges,
		tileSize,
		domain,
		variable,
		mapBounds,
		resolutionFactor,
		makeGrid,
		makeArrows,
		makeContours,
		interval
	};
};

export const defaultOmProtocolSettings: OmProtocolSettings = {
	// static
	useSAB: false,

	// dynamic
	colorScales: defaultColorScales,
	domainOptions: defaultDomainOptions,
	variableOptions: defaultVariableOptions,

	resolveUrlSettings: defaultResolveUrlSettings,
	postReadCallback: undefined
};

export const omProtocol = async (
	params: RequestParameters,
	abortController?: AbortController,
	omProtocolSettings = defaultOmProtocolSettings
): Promise<GetResourceResponse<TileJSON | ImageBitmap | ArrayBuffer>> => {
	const protocol = getProtocolInstance(omProtocolSettings);
	let parsedOmUrl = params.url;
	if (parsedOmUrl.includes('.json')) {
		parsedOmUrl = await parseMetaJson(parsedOmUrl);
	}
	assertOmUrlValid(parsedOmUrl);
	const { state, stateKey, tileIndex, options } = getOrCreateUrlState(
		parsedOmUrl,
		omProtocolSettings,
		protocol
	);

	if (params.type == 'json') {
		return { data: await getTilejson(params.url, options) };
	} else if (params.type && ['image', 'arrayBuffer'].includes(params.type)) {
		if (!tileIndex) {
			throw new Error(`Tile coordinates required for ${params.type} request`);
		}
		return {
			data: await renderTile(
				tileIndex,
				parsedOmUrl.replace('om://', ''),
				stateKey,
				params.type as 'image' | 'arrayBuffer',
				state,
				options,
				omProtocolSettings,
				protocol
			)
		};
	} else {
		throw new Error(`Unsupported request type '${params.type}'`);
	}
};
