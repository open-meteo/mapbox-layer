import { GridFactory } from '../grids/index';
import { OMapsFileReader } from '../om-file-reader';

import {
	DEFAULT_INTERVAL,
	DEFAULT_RESOLUTION_FACTOR,
	DEFAULT_TILE_SIZE,
	VALID_RESOLUTION_FACTORS,
	VALID_TILE_SIZES
} from './constants';
import { parseUrlComponents } from './parse-url';
import { getColorScale, resolveColorScale } from './styling';

import type {
	ColorScales,
	DataIdentityOptions,
	DimensionRange,
	OmProtocolSettings,
	ParsedRequest,
	ParsedUrlComponents,
	RenderOptions,
	RenderableColorScale
} from '../types';

export const parseRequest = async (
	url: string,
	settings: OmProtocolSettings,
	reader: OMapsFileReader
): Promise<ParsedRequest> => {
	const urlComponents = parseUrlComponents(url);
	const resolver = settings.resolveRequest ?? defaultResolveRequest;
	const { dataOptions, renderOptions } = await resolver(urlComponents, settings, reader);

	return {
		baseUrl: urlComponents.baseUrl,
		stateKey: urlComponents.stateKey,
		tileIndex: urlComponents.tileIndex,
		dataOptions,
		renderOptions
	};
};

export const defaultResolveRequest = async (
	urlComponents: ParsedUrlComponents,
	settings: OmProtocolSettings,
	reader: OMapsFileReader
): Promise<{ dataOptions: DataIdentityOptions; renderOptions: RenderOptions }> => {
	const dataOptions = await defaultResolveDataIdentity(urlComponents, reader);

	const renderOptions = defaultResolveRenderOptions(
		urlComponents,
		dataOptions,
		settings.colorScales
	);

	return { dataOptions, renderOptions };
};

const defaultResolveDataIdentity = async (
	urlComponents: ParsedUrlComponents,
	reader: OMapsFileReader
): Promise<DataIdentityOptions> => {
	const { baseUrl, params } = urlComponents;

	// const match = baseUrl.match(RESOLVE_DOMAIN_REGEX);
	// const domainValue = match?.groups?.domain;

	// if (!domainValue) {
	// 	throw new Error(`Could not parse domain from URL: ${baseUrl}`);
	// }
	// const domain = domainOptions.find((dm) => dm.value === domainValue);
	// if (!domain) {
	// 	throw new Error(`Invalid domain: ${domainValue}`);
	// }

	const variable = params.get('variable');
	if (!variable) {
		throw new Error(`Variable is required but not defined`);
	}

	await reader.setToOmFile(baseUrl);
	const grid = await reader.getGridParameters(variable);

	const partial = params.get('partial') === 'true';
	const mapBounds = params.get('bounds')?.split(',').map(Number) as number[] | undefined;

	let ranges: DimensionRange[];
	if (partial && mapBounds) {
		const gridGetter = GridFactory.create(grid, null);
		ranges = gridGetter.getCoveringRanges(mapBounds[0], mapBounds[1], mapBounds[2], mapBounds[3]);
	} else {
		ranges = [
			{ start: 0, end: grid.ny },
			{ start: 0, end: grid.nx }
		];
	}

	return { baseUrl, grid, variable, ranges };
};

const defaultResolveRenderOptions = (
	urlComponents: ParsedUrlComponents,
	dataOptions: DataIdentityOptions,
	colorScales: ColorScales
): RenderOptions => {
	const { params } = urlComponents;

	const dark = params.get('dark') === 'true';
	let colorScale: RenderableColorScale;
	if (colorScales.custom) {
		colorScale = resolveColorScale(colorScales.custom, dark);
	} else {
		colorScale = getColorScale(dataOptions.variable, dark, colorScales);
	}

	const tileSize = parseTileSize(params.get('tile_size'));
	const resolutionFactor = parseResolutionFactor(params.get('resolution_factor'));

	let intervals = [DEFAULT_INTERVAL];
	if (params.get('intervals')) {
		intervals = params
			.get('intervals')
			?.split(',')
			.map((interval) => Number(interval)) as number[];
	} else if (colorScale.type === 'breakpoint') {
		intervals = colorScale.breakpoints;
	}

	const drawGrid = params.get('grid') === 'true';
	const drawArrows = params.get('arrows') === 'true';
	const drawContours = params.get('contours') === 'true';

	return {
		tileSize,
		resolutionFactor,
		drawGrid,
		drawArrows,
		drawContours,
		colorScale,
		intervals
	};
};

const parseTileSize = (value: string | null): 64 | 128 | 256 | 512 | 1024 => {
	const tileSize = value ? Number(value) : DEFAULT_TILE_SIZE;
	if (!VALID_TILE_SIZES.includes(tileSize)) {
		throw new Error(`Invalid tile size, please use one of: ${VALID_TILE_SIZES.join(', ')}`);
	}
	return tileSize as 64 | 128 | 256 | 512 | 1024;
};

const parseResolutionFactor = (value: string | null): 0.5 | 1 | 2 => {
	const resolutionFactor = value ? Number(value) : DEFAULT_RESOLUTION_FACTOR;
	if (!VALID_RESOLUTION_FACTORS.includes(resolutionFactor)) {
		throw new Error(
			`Invalid resolution factor, please use one of: ${VALID_RESOLUTION_FACTORS.join(', ')}`
		);
	}
	return resolutionFactor as 0.5 | 1 | 2;
};
