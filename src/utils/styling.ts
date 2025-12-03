import { colorScales } from './color-scales';

import type { ColorScale, ColorScales, OpacityDefinition, Variable } from '../types';

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

export const defaultConstantOpacity: OpacityDefinition = {
	mode: 'constant',
	params: {
		opacityDark: 55,
		opacityLight: 75
	}
};

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
	boundary_layer_height: colorScales['convective_cloud_top'],
	cloud_base: colorScales['convective_cloud_top'],
	convective_cloud_base: colorScales['convective_cloud_top'],
	diffuse_radiation: colorScales['shortwave'],
	direct_radiation: colorScales['shortwave'],
	soil_moisture: {
		...colorScales['shortwave'],
		unit: '',
		min: 0,
		max: 1,
		opacity: defaultLinearThenConstantOpacity
	},
	rain: colorScales['precipitation'],
	showers: colorScales['precipitation'],
	wave: colorScales['swell']
};

export const getColorScale = (variable: Variable['value']) => {
	return (
		COLOR_SCALES_WITH_ALIASES[variable] ??
		COLOR_SCALES_WITH_ALIASES[variable.split('_')[0]] ??
		COLOR_SCALES_WITH_ALIASES[variable.split('_')[0] + '_' + variable.split('_')[1]] ??
		COLOR_SCALES_WITH_ALIASES['temperature']
	);
};

const LEVEL_REGEX = /_(\d+)(hPa)?$/i;

// ISA / barometric constants
const ISA = {
	p0_hPa: 1013.25, // reference pressure in hPa
	T0: 288.15, // sea-level standard temperature (K)
	L: 0.0065, // temperature lapse rate (K/m)
	R: 287.05, // specific gas constant for dry air (J/(kg·K))
	g0: 9.80665 // gravity (m/s^2)
};

/** Convert pressure in hPa to geopotential height (meters) using ISA troposphere formula.
 *  valid for typical tropospheric pressures (roughly 1000 -> 200 hPa). */
const pressureHpaToIsaHeight = (hpa: number): number => {
	if (hpa <= 0) return 0;
	const { p0_hPa, T0, L, R, g0 } = ISA;
	const r = hpa / p0_hPa;
	const exponent = (R * L) / g0; // ~0.1903
	// H = (T0 / L) * (1 - r^exponent)
	const height = (T0 / L) * (1 - Math.pow(r, exponent));
	return Math.max(0, height);
};

/** Compute ISA temperature (°C) at geopotential height (meters) within troposphere:
 *  T(K) = T0 - L * z
 */
const scaleTemperatureMinMax = (
	min: number,
	max: number,
	pressureLevel: number
): { min: number; max: number } => {
	const height = pressureHpaToIsaHeight(pressureLevel);
	return {
		min: min - 0.0065 * height,
		max: max - 0.0065 * height
	};
};

export const getColorScaleMinMaxScaled = (variable: Variable['value']) => {
	const scale = getColorScale(variable);

	// try to parse level from the variable string, e.g. geopotential_height_500hPa
	const m = variable.match(LEVEL_REGEX);
	if (!m) {
		return scale;
	}

	const levelNum = Number(m[1]);

	// 1) geopotential height variables -> derive typical height from ISA
	// Detect variable name indicating geopotential height; adjust min/max around ISA value.
	if (variable.includes('geopotential_height')) {
		// Only handle hPa suffix for now (LEVEL_REGEX captured the hPa optional part)
		// Compute ISA height (meters) for the pressure level
		// const center = pressureHpaToIsaHeight(levelNum);
		const computedMax = pressureHpaToIsaHeight(0.9 * levelNum);
		const computedMin = pressureHpaToIsaHeight(1.1 * levelNum);

		return {
			...scale,
			min: computedMin,
			max: computedMax
		};
	}

	if (variable.includes('temperature')) {
		const { min: computedMin, max: computedMax } = scaleTemperatureMinMax(
			scale.min,
			scale.max,
			levelNum
		);

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
		1000: { min: 0, max: 25 },
		925: { min: 0, max: 30 },
		850: { min: 0, max: 30 },
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
			console.log(`Exact wind breakpoint for level ${levelNum} is ${bp.min} to ${bp.max} m/s`);
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
		console.log(`Nearest wind breakpoint for level ${levelNum} is ${bp.min} to ${bp.max} m/s`);
		return {
			...scale,
			min: bp.min,
			max: bp.max
		};
	}

	return scale;
};
