import { colorScales } from './color-scales';

import type { ColorScale, OpacityDefinition, Variable } from '../types';

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

export const defaultConstantOpacity: OpacityDefinition = {
	mode: 'constant',
	params: {
		opacityDark: 55,
		opacityLight: 75
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

export const getColorScale = (variable: Variable['value']) => {
	return (
		colorScales[variable] ??
		colorScales[variable.split('_')[0]] ??
		colorScales[variable.split('_')[0] + '_' + variable.split('_')[1]] ??
		colorScales['temperature']
	);
};
