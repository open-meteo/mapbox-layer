import { COLOR_SCALES } from './color-scales';
import { pressureHpaToIsaHeight } from './isa-height';

import type {
	BreakpointColorScale,
	ColorScale,
	ColorScales,
	RenderableColorScale,
	ResolvedBreakpointColorScale
} from '../types';

function findLastIndexLE(arr: number[], value: number): number {
	let lo = 0,
		hi = arr.length - 1,
		res = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		if (arr[mid] <= value) {
			res = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return res;
}

export const getColor = (
	colorScale: RenderableColorScale,
	px: number
): [number, number, number, number] => {
	switch (colorScale.type) {
		case 'rgba': {
			const deltaPerIndex = (colorScale.max - colorScale.min) / colorScale.colors.length;
			const index = Math.min(
				colorScale.colors.length - 1,
				Math.max(0, Math.floor((px - colorScale.min) / deltaPerIndex))
			);
			return colorScale.colors[index];
		}
		case 'breakpoint': {
			const index = Math.max(0, findLastIndexLE(colorScale.breakpoints, px));
			return colorScale.colors[index % colorScale.colors.length];
		}
		default: {
			// This ensures exhaustiveness checking
			const _exhaustive: never = colorScale;
			throw new Error(`Unknown color scale: ${_exhaustive}`);
		}
	}
};

export const COLOR_SCALES_WITH_ALIASES: ColorScales = {
	...COLOR_SCALES,
	albedo: COLOR_SCALES['cloud_cover'],
	boundary_layer_height: { ...COLOR_SCALES['convective_cloud_top'], min: 0, max: 2000 },
	cloud_base: COLOR_SCALES['convective_cloud_top'],
	cloud_top: COLOR_SCALES['convective_cloud_top'],
	convective_cloud_base: COLOR_SCALES['convective_cloud_top'],
	dew_point: COLOR_SCALES['temperature'],
	diffuse_radiation: COLOR_SCALES['shortwave'],
	direct_radiation: COLOR_SCALES['shortwave'],
	freezing_level_height: { ...COLOR_SCALES['temperature'], unit: 'm', min: 0, max: 4000 },
	latent_heat_flux: {
		...COLOR_SCALES['temperature'],
		unit: 'W/m²',
		min: -50,
		max: 20
	},
	sea_surface_temperature: {
		...COLOR_SCALES['temperature'],
		min: -2,
		max: 35
	},
	sensible_heat_flux: {
		...COLOR_SCALES['temperature'],
		unit: 'W/m²',
		min: -50,
		max: 50
	},
	rain: COLOR_SCALES['precipitation'],
	showers: COLOR_SCALES['precipitation'],
	snow_depth_water_equivalent: { ...COLOR_SCALES['precipitation'], unit: 'mm', min: 0, max: 3200 },
	snowfall_water_equivalent: COLOR_SCALES['precipitation'],
	visibility: {
		...COLOR_SCALES['geopotential_height'],
		min: 0,
		max: 20000
	},
	wave: COLOR_SCALES['swell'],
	wind_wave_height: COLOR_SCALES['swell'],
	swell_wave_height: COLOR_SCALES['swell'],
	secondary_swell_wave_height: COLOR_SCALES['swell'],
	tertiary_swell_wave_height: COLOR_SCALES['swell'],
	wave_peak_period: COLOR_SCALES['swell_period'],
	wave_period: COLOR_SCALES['swell_period'],
	swell_wave_period: COLOR_SCALES['swell_period'],
	secondary_swell_wave_period: COLOR_SCALES['swell_period'],
	tertiary_swell_wave_period: COLOR_SCALES['swell_period']
};

const getOptionalColorScale = (
	variable: string,
	colorScalesSource: ColorScales
): ColorScale | undefined => {
	const exactMatch = colorScalesSource[variable];
	if (exactMatch) return exactMatch;
	const parts = variable.split('_');
	const lastIndex = parts.length - 1;

	const scale = colorScalesSource[parts[0] + '_' + parts[1]] ?? colorScalesSource[parts[0]];

	// geopotential height variables -> derive typical height from ISA
	if (variable.includes('geopotential_height')) {
		// try to parse level from the variable string, e.g. geopotential_height_500hPa
		const m = variable.match(LEVEL_REGEX);
		if (!m) {
			return scale;
		}

		const levelNum = Number(m[1]);
		// Compute ISA height (meters) for the pressure level
		const computedMax = pressureHpaToIsaHeight(Math.floor(0.9 * levelNum));
		const computedMin = pressureHpaToIsaHeight(Math.ceil(1.1 * levelNum));

		return {
			...scale,
			min: computedMin,
			max: computedMax
		};
	}

	if (['mean', 'max', 'min'].includes(parts[lastIndex])) {
		return getOptionalColorScale(parts.slice(0, -1).join('_'), colorScalesSource);
	} else if (parts[lastIndex] == 'anomaly') {
		return colorScalesSource['temperature_anomaly'];
	}
	return colorScalesSource[parts[0] + '_' + parts[1]] ?? colorScalesSource[parts[0]];
};

export const getColorScale = (
	variable: string,
	dark: boolean,
	colorScalesSource: ColorScales = COLOR_SCALES_WITH_ALIASES
): RenderableColorScale => {
	const anyColorScale =
		getOptionalColorScale(variable, colorScalesSource) ?? colorScalesSource['temperature'];
	if (!anyColorScale) {
		throw new Error(`Unknown color scale for variable: ${variable}`);
	}
	return resolveColorScale(anyColorScale, dark);
};

// Helper to check if colors have light/dark variants
const hasColorVariants = (
	colors: BreakpointColorScale['colors']
): colors is {
	light: [number, number, number, number][];
	dark: [number, number, number, number][];
} => {
	return !Array.isArray(colors) && 'light' in colors && 'dark' in colors;
};

export const resolveColorScale = (colorScale: ColorScale, dark: boolean): RenderableColorScale => {
	switch (colorScale.type) {
		case 'rgba':
			return colorScale;
		case 'breakpoint': {
			if (hasColorVariants(colorScale.colors)) {
				return {
					...colorScale,
					colors: dark ? colorScale.colors.dark : colorScale.colors.light
				} as ResolvedBreakpointColorScale;
			}
			return colorScale as ResolvedBreakpointColorScale;
		}
		default: {
			// This ensures exhaustiveness checking
			const _exhaustive: never = colorScale;
			throw new Error(`Unknown color scale: ${_exhaustive}`);
		}
	}
};

const LEVEL_REGEX = /_(\d+)(hPa)?$/i;
