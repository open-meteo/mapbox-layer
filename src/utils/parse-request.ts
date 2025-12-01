import { GridFactory } from '../grids/index';

import { parseResolutionFactor, parseTileSize, parseUrlComponents } from './parse-url';
import { getColorScale } from './styling';

import type {
	ColorScales,
	DataIdentityOptions,
	DimensionRange,
	Domain,
	OmProtocolSettings,
	ParsedRequest,
	ParsedUrlComponents,
	RenderOptions,
	Variable
} from '../types';

export const parseRequest = (url: string, settings: OmProtocolSettings): ParsedRequest => {
	const urlComponents = parseUrlComponents(url);
	const resolver = settings.resolveRequest ?? defaultResolveRequest;
	const { dataOptions, renderOptions } = resolver(urlComponents, settings);

	return {
		baseUrl: urlComponents.baseUrl,
		stateKey: urlComponents.stateKey,
		tileIndex: urlComponents.tileIndex,
		dataOptions,
		renderOptions
	};
};

export const defaultResolveRequest = (
	urlComponents: ParsedUrlComponents,
	settings: OmProtocolSettings
): { dataOptions: DataIdentityOptions; renderOptions: RenderOptions } => {
	const dataOptions = defaultResolveDataIdentity(
		urlComponents,
		settings.domainOptions,
		settings.variableOptions
	);

	const renderOptions = defaultResolveRenderOptions(
		urlComponents,
		dataOptions,
		settings.colorScales
	);

	return { dataOptions, renderOptions };
};

const defaultResolveDataIdentity = (
	urlComponents: ParsedUrlComponents,
	domainOptions: Domain[],
	variableOptions: Variable[]
): DataIdentityOptions => {
	const { baseUrl, params } = urlComponents;

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
	urlComponents: ParsedUrlComponents,
	dataOptions: DataIdentityOptions,
	colorScales: ColorScales
): RenderOptions => {
	const { params } = urlComponents;

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
