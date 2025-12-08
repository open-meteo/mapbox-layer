import { COLOR_SCALES } from './color-scales';
import { pressureHpaToIsaHeight } from './isa-height';

import type { ColorScale, ColorScales, OpacityDefinition } from '../types';

export const getColor = (colorScale: ColorScale, px: number): [number, number, number] => {
	const deltaPerIndex = (colorScale.max - colorScale.min) / colorScale.colors.length;
	const index = Math.min(
		colorScale.colors.length - 1,
		Math.max(0, Math.floor((px - colorScale.min) / deltaPerIndex))
	);
	return colorScale.colors[index];
};

export const defaultPowerScaleOpacity: OpacityDefinition = {
	mode: 'power',
	params: {
		exponent: 1.5,
		denom: 1000,
		opacityDark: 75,
		opacityLight: 75
	}
};

export const centeredPowerOpacity = (scale: number): OpacityDefinition => ({
	mode: 'centered-power',
	params: {
		// 'scale' is the absolute value at which opacity reaches full
		scale: scale,
		exponent: 1.5,
		opacityDark: 75,
		opacityLight: 75
	}
});

export const defaultConstantOpacity: OpacityDefinition = {
	mode: 'constant',
	params: {
		opacityDark: 55,
		opacityLight: 75
	}
};

export const linearThenConstantWithThreshold = (threshold: number): OpacityDefinition => ({
	mode: 'linear-then-constant',
	params: {
		threshold,
		opacityDark: 50,
		opacityLight: 100
	}
});

export const defaultLinearThenConstantOpacity: OpacityDefinition = {
	mode: 'linear-then-constant',
	params: {
		threshold: 1.5,
		opacityDark: 50,
		opacityLight: 100
	}
};

export const getOpacity = (
	v: string,
	px: number,
	dark: boolean,
	colorScale: ColorScale
): number => {
	const opacityConfig = colorScale.opacity ?? defaultConstantOpacity;
	switch (opacityConfig.mode) {
		case 'constant': {
			const params = opacityConfig.params;
			const scalePct = dark ? params.opacityDark : params.opacityLight;
			return 255 * (scalePct / 100);
		}
		case 'power': {
			const params = opacityConfig.params;
			const scalePct = dark ? params.opacityDark : params.opacityLight;
			return (
				255 *
				(Math.min(
					Math.max((Math.pow(Math.max(px, 0), params.exponent) / params.denom) * scalePct, 0),
					100
				) /
					100)
			);
		}
		case 'centered-power': {
			const params = opacityConfig.params;
			const scalePct = dark ? params.opacityDark : params.opacityLight;
			const scaleVal = params.scale;
			// fraction goes from 0 (px==0) to 1 (|px| >= scaleVal)
			const frac = Math.min(Math.pow(Math.abs(px) / scaleVal, params.exponent), 1);
			return 255 * (frac * (scalePct / 100));
		}
		case 'power-then-constant': {
			const params = opacityConfig.params;
			const scalePct = dark ? params.opacityDark : params.opacityLight;
			if (px < params.threshold) {
				return (255 * Math.min(Math.pow(px, params.exponent) / params.denom, 1) * scalePct) / 100;
			} else {
				return 255 * (scalePct / 100);
			}
		}
		case 'linear-then-constant': {
			const params = opacityConfig.params;
			const scalePct = dark ? params.opacityDark : params.opacityLight;
			return (255 * Math.min(px / params.threshold, 1) * scalePct) / 100;
		}
		case 'zero-then-constant': {
			const params = opacityConfig.params;
			const scalePct = dark ? params.opacityDark : params.opacityLight;
			if (px <= params.threshold) {
				return 0;
			} else {
				return 255 * (scalePct / 100);
			}
		}
	}
};

const COLOR_SCALES_WITH_ALIASES: ColorScales = {
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
		colors: COLOR_SCALES['geopotential_height'].colors.reverse(),
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

const getOptionalColorScale = (variable: string): ColorScale | undefined => {
	const exactMatch = COLOR_SCALES_WITH_ALIASES[variable];
	if (exactMatch) return exactMatch;
	const parts = variable.split('_');
	const lastIndex = parts.length - 1;

	const scale =
		COLOR_SCALES_WITH_ALIASES[parts[0] + '_' + parts[1]] ?? COLOR_SCALES_WITH_ALIASES[parts[0]];

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
		return getOptionalColorScale(parts.slice(0, -1).join('_'));
	} else if (parts[lastIndex] == 'anomaly') {
		const match = getOptionalColorScale(parts.slice(0, -1).join('_'));
		if (match) {
			const delta = (match.max - match.min) / 5;
			return { ...match, max: delta, min: -delta, opacity: centeredPowerOpacity(delta * 0.5) };
		}
	}
	return (
		COLOR_SCALES_WITH_ALIASES[parts[0] + '_' + parts[1]] ?? COLOR_SCALES_WITH_ALIASES[parts[0]]
	);
};

export const getColorScale = (variable: string): ColorScale => {
	return getOptionalColorScale(variable) ?? COLOR_SCALES_WITH_ALIASES['temperature'];
};

const LEVEL_REGEX = /_(\d+)(hPa)?$/i;
