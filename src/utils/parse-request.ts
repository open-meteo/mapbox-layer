import { MapboxLayerFileReader } from '../om-file-reader';

import { currentBounds } from './bounds';
import { DEFAULT_INTERVAL, DEFAULT_TILE_SIZE, VALID_TILE_SIZES } from './constants';
import { parseUrlComponents } from './parse-url';
import { getColorScale, resolveColorScale } from './styling';

import type {
	ColorScales,
	DataIdentityOptions,
	OmProtocolSettings,
	ParsedRequest,
	ParsedUrlComponents,
	RenderOptions,
	RenderableColorScale
} from '../types';

export const parseRequest = async (
	url: string,
	settings: OmProtocolSettings,
	reader: MapboxLayerFileReader
): Promise<ParsedRequest> => {
	const urlComponents = parseUrlComponents(url);
	const resolver = settings.resolveRequest ?? defaultResolveRequest;
	const { dataOptions, renderOptions } = await resolver(urlComponents, settings, reader);

	return {
		baseUrl: urlComponents.baseUrl,
		fileAndVariableKey: urlComponents.fileAndVariableKey,
		tileIndex: urlComponents.tileIndex,
		dataOptions,
		renderOptions,
		clippingOptions: settings.clippingOptions
	};
};

export const defaultResolveRequest = async (
	urlComponents: ParsedUrlComponents,
	settings: OmProtocolSettings,
	reader: MapboxLayerFileReader
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
	reader: MapboxLayerFileReader
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

	const mapBounds = currentBounds;

	return { baseUrl, grid, variable, bounds: mapBounds };
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
