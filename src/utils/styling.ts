import { colorScales } from './color-scales';

import type { ColorScale, OpacityDefinition, Variable } from '../types';

const OPACITY = 75;

export const getColor = (colorScale: ColorScale, px: number): [number, number, number] => {
	return colorScale.colors[
		Math.min(
			colorScale.colors.length - 1,
			Math.max(0, Math.floor((px - colorScale.min) * colorScale.scalefactor))
		)
	];
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

export const getOpacity = (
	v: string,
	px: number,
	dark: boolean,
	colorScale: ColorScale
): number => {
	if (colorScale.opacity) {
		switch (colorScale.opacity.mode) {
			case 'constant': {
				const params = colorScale.opacity.params;
				const scalePct = dark ? params.opacityDark : params.opacityLight;
				return 255 * (scalePct / 100);
			}
			case 'power': {
				const params = colorScale.opacity.params;
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
		}
	} else if (v.startsWith('cloud_base')) {
		// scale cloud base to 20900m
		return Math.min(1 - px / 20900, 1) * 255 * (OPACITY / 100);
	} else if (v.startsWith('precipitation')) {
		// scale opacity with precip values below 1.5mm
		return Math.min(px / 1.5, 1) * 255 * (OPACITY / 100);
	} else if (v.startsWith('wind')) {
		// scale opacity with wind values below 10kmh
		if (px < 10 / 3.6) {
			return Math.min(Math.pow(px - 2, 3) / 1000, 1) * 255 * (OPACITY / 100);
		} else {
			return 255 * (OPACITY / 100);
		}
	} else {
		// else set the opacity with env variable and deduct 20% for darkmode
		return 255 * (dark ? OPACITY / 100 - 0.2 : OPACITY / 100);
	}
};

export const getColorScale = (variable: Variable['value']) => {
	return (
		colorScales[variable] ??
		colorScales[variable.split('_')[0]] ??
		colorScales[variable.split('_')[0] + '_' + variable.split('_')[1]] ??
		colorScales['temperature']
	);
};
