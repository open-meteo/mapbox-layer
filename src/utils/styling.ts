import { colorScales } from './color-scales';

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
	...colorScales,
	albedo: colorScales['cloud_cover'],
	boundary_layer_height: { ...colorScales['convective_cloud_top'], min: 0, max: 2000 },
	cloud_base: colorScales['convective_cloud_top'],
	cloud_top: colorScales['convective_cloud_top'],
	convective_cloud_base: colorScales['convective_cloud_top'],
	dew_point: colorScales['temperature'],
	diffuse_radiation: colorScales['shortwave'],
	direct_radiation: colorScales['shortwave'],
	freezing_level_height: { ...colorScales['temperature'], unit: 'm', min: 0, max: 4000 },
	latent_heat_flux: {
		...colorScales['temperature'],
		unit: 'W/m²',
		min: -50,
		max: 20
	},
	sea_surface_temperature: {
		...colorScales['temperature'],
		min: -2,
		max: 35
	},
	sensible_heat_flux: {
		...colorScales['temperature'],
		unit: 'W/m²',
		min: -50,
		max: 50
	},
	rain: colorScales['precipitation'],
	showers: colorScales['precipitation'],
	snow_depth_water_equivalent: { ...colorScales['precipitation'], unit: 'mm', min: 0, max: 3200 },
	snowfall_water_equivalent: colorScales['precipitation'],
	visibility: {
		...colorScales['geopotential_height'],
		colors: colorScales['geopotential_height'].colors.reverse(),
		min: 0,
		max: 20000
	},
	wave: colorScales['swell'],
	wind_wave_height: colorScales['swell'],
	swell_wave_height: colorScales['swell'],
	secondary_swell_wave_height: colorScales['swell'],
	tertiary_swell_wave_height: colorScales['swell'],
	wave_peak_period: colorScales['swell_period'],
	wave_period: colorScales['swell_period'],
	swell_wave_period: colorScales['swell_period'],
	secondary_swell_wave_period: colorScales['swell_period'],
	tertiary_swell_wave_period: colorScales['swell_period']
};

const getOptionalColorScale = (variable: string): ColorScale | undefined => {
	const exactMatch = COLOR_SCALES_WITH_ALIASES[variable];
	if (exactMatch) return exactMatch;
	const parts = variable.split('_');
	const lastIndex = parts.length - 1;

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

// ISA / barometric constants
const ISA = {
	p0_hPa: 1013.25, // reference pressure in hPa
	t0: 288.15, // sea-level standard temperature (K)
	lapse: 0.0065, // temperature lapse rate (K/m)
	gasConstant: 287.05, // specific gas constant for dry air (J/(kg·K))
	g0: 9.80665 // gravity (m/s^2)
};

/* Tropopause / lower stratosphere constants (ISA standard) */
const P_TROPOPAUSE = 226.32; // hPa (pressure at ~11 km)
const H_TROPOPAUSE = 11000; // m  (height of tropopause ~11 km)
const T_TROPOPAUSE = 216.65; // K  (temperature in lower stratosphere)

const pressureHpaToIsaHeight = (hpa: number): number => {
	if (!isFinite(hpa) || hpa <= 0) return NaN;

	// Use troposphere formula for pressures >= tropopause pressure; otherwise use isothermal stratosphere formula.
	return hpa >= P_TROPOPAUSE
		? troposphereHeightFromPressure(hpa)
		: stratosphereHeightFromPressure(hpa);
};

const troposphereHeightFromPressure = (hpa: number): number => {
	const { p0_hPa, t0, lapse, gasConstant, g0 } = ISA;
	const r = hpa / p0_hPa;
	const exponent = (gasConstant * lapse) / g0; // dimensionless (~0.1903)
	// H = (T0 / L) * (1 - r^exponent)
	return (t0 / lapse) * (1 - Math.pow(r, exponent));
};

const stratosphereHeightFromPressure = (hpa: number): number => {
	// H = H_tropopause + (R * T_tropopause / g0) * ln(P_tropopause / P)
	return H_TROPOPAUSE + ((ISA.gasConstant * T_TROPOPAUSE) / ISA.g0) * Math.log(P_TROPOPAUSE / hpa);
};

export const getColorScaleMinMaxScaled = (variable: string) => {
	const scale = getColorScale(variable);

	// try to parse level from the variable string, e.g. geopotential_height_500hPa
	const m = variable.match(LEVEL_REGEX);
	if (!m) {
		return scale;
	}

	const levelNum = Number(m[1]);

	// geopotential height variables -> derive typical height from ISA
	if (variable.includes('geopotential_height')) {
		// Compute ISA height (meters) for the pressure level
		const computedMax = pressureHpaToIsaHeight(Math.floor(0.9 * levelNum));
		const computedMin = pressureHpaToIsaHeight(Math.ceil(1.1 * levelNum));

		return {
			...scale,
			min: computedMin,
			max: computedMax
		};
	}

	// Custom wind-speed breakpoints (m/s) by pressure level (hPa).
	// These are chosen to reflect typical magnitude ranges at different levels
	// (surface / boundary layer -> mid-troposphere -> upper-level jet regions).
	// If an exact level isn't present, we'll pick the nearest defined breakpoint.
	const windBreakpoints: Record<number, { min: number; max: number }> = {
		1000: { min: 0, max: 30 },
		850: { min: 0, max: 35 },
		700: { min: 0, max: 40 },
		500: { min: 0, max: 50 },
		400: { min: 0, max: 60 },
		300: { min: 0, max: 70 },
		250: { min: 0, max: 75 },
		200: { min: 0, max: 80 },
		150: { min: 0, max: 80 },
		100: { min: 0, max: 60 }
	};

	if (variable.includes('wind')) {
		// find exact or nearest breakpoint
		const keys = Object.keys(windBreakpoints).map((k) => Number(k));
		// prefer exact match
		if (windBreakpoints[levelNum]) {
			const bp = windBreakpoints[levelNum];
			return {
				...scale,
				min: bp.min,
				max: bp.max
			};
		}
		// otherwise choose nearest breakpoint level
		let nearest = keys[0];
		let bestDelta = Math.abs(levelNum - nearest);
		for (let i = 1; i < keys.length; i++) {
			const k = keys[i];
			const d = Math.abs(levelNum - k);
			if (d < bestDelta) {
				bestDelta = d;
				nearest = k;
			}
		}
		const bp = windBreakpoints[nearest];
		return {
			...scale,
			min: bp.min,
			max: bp.max
		};
	}

	return scale;
};
