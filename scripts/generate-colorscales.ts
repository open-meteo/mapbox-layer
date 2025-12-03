import { defaultPowerScaleOpacity } from '../src/utils/styling';
import { color } from 'd3-color';
import { interpolateHsl, interpolateRgb } from 'd3-interpolate';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import type { ColorScale, OpacityDefinition } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function interpolateColorScale(
	colors: string[],
	steps: number,
	interpolationMethod: 'hsl' | 'rgb' = 'hsl'
): [number, number, number][] {
	const segments = colors.length - 1;
	const stepsPerSegment = Math.floor(steps / segments);
	const remainder = steps % segments;

	const rgbArray: [number, number, number][] = [];

	for (let i = 0; i < segments; i++) {
		const startColor = colors[i];
		const endColor = colors[i + 1];
		const interpolate =
			interpolationMethod === 'hsl'
				? interpolateHsl(startColor, endColor)
				: interpolateRgb(startColor, endColor);

		const numSteps = stepsPerSegment + (i < remainder ? 1 : 0);

		for (let j = 0; j < numSteps; j++) {
			const t = j / (numSteps - 1);
			const c = color(interpolate(t))!.rgb();
			rgbArray.push([Math.round(c.r), Math.round(c.g), Math.round(c.b)]);
		}
	}

	return rgbArray;
}

const colorScaleDefinitions: Record<string, ColorScaleDefinition> = {
	cape: {
		unit: 'J/kg',
		min: 0,
		max: 4000,
		steps: 100,
		colors: ['green', 'orange', 'red'],
		opacity: defaultPowerScaleOpacity
	},
	cloud_base: {
		unit: 'm',
		min: 0,
		max: 20900,
		steps: 100,
		colors: ['#fff', '#c3c2c2']
	},
	cloud_cover: {
		unit: '%',
		min: 0,
		max: 100,
		steps: 100,
		colors: ['#fff', '#c3c2c2'],
		opacity: defaultPowerScaleOpacity
	},
	convective_cloud_top: {
		unit: 'm',
		min: 0,
		max: 6000,
		steps: 100,
		colors: ['#c0392b', '#d35400', '#f1c40f', '#16a085', '#2980b9']
	},
	precipitation: {
		unit: 'mm',
		min: 0,
		max: 20,
		steps: 20,
		colors: [
			{ colors: ['blue', 'green'], steps: 5 },
			{ colors: ['green', 'orange'], steps: 5 },
			{ colors: ['orange', 'red'], steps: 10 }
		]
	},
	pressure: {
		unit: 'hPa',
		min: 950,
		max: 1050,
		steps: 50,
		colors: ['#4444ff', '#fff', '#ff4444']
	},
	relative: {
		unit: '%',
		min: 0,
		max: 100,
		steps: 100,
		colors: ['#009392', '#39b185', '#9ccb86', '#e9e29c', '#eeb479', '#e88471', '#cf597e'].reverse()
	},
	shortwave: {
		unit: 'W/m^2',
		min: 0,
		max: 1000,
		steps: 100,
		colors: ['#009392', '#39b185', '#9ccb86', '#e9e29c', '#eeb479', '#e88471', '#cf597e']
	},
	temperature: {
		unit: 'C°',
		min: -40,
		max: 60,
		steps: 100,
		colors: [
			{ colors: ['white', 'purple'], steps: 20 },
			{ colors: ['purple', 'navy'], steps: 20 },
			{ colors: ['mediumblue', 'green'], steps: 16 },
			{ colors: ['green', 'orange'], steps: 12 },
			{ colors: ['orange', 'red'], steps: 14 },
			{ colors: ['red', 'purple'], steps: 18 }
		]
	},
	temperature_2m_anomaly: {
		unit: 'K',
		min: -5,
		max: 5,
		steps: 20,
		colors: [
			{ colors: ['blue', 'white'], steps: 10 },
			{ colors: ['white', 'red'], steps: 10 }
		]
	},
	thunderstorm: {
		unit: '%',
		min: 0,
		max: 100,
		steps: 100,
		colors: [
			{ colors: ['blue', 'green'], steps: 33 },
			{ colors: ['green', 'orange'], steps: 33 },
			{ colors: ['orange', 'red'], steps: 34 }
		],
		opacity: defaultPowerScaleOpacity
	},
	swell: {
		unit: 'm',
		min: 0,
		max: 10,
		steps: 50,
		colors: [
			{ colors: ['blue', 'green'], steps: 10 }, // 0 to 2m
			{ colors: ['green', 'orange'], steps: 20 }, // 2 to 6m
			{ colors: ['orange', 'red'], steps: 20 } // 6 to 10m
		]
	},
	uv: {
		unit: '',
		min: 0,
		max: 12,
		steps: 12,
		colors: ['#009392', '#39b185', '#9ccb86', '#e9e29c', '#eeb479', '#e88471', '#cf597e']
	},
	wind: {
		unit: 'm/s',
		min: 0,
		max: 70,
		steps: 40,
		colors: [
			{ colors: ['blue', 'green'], steps: 10 }, // 0 to 10kn
			{ colors: ['green', 'orange'], steps: 10 }, // 10 to 20kn
			{ colors: ['orange', 'red'], steps: 20 } // 20 to 40kn
		]
	}
};

const aliases: Record<string, AliasConfig> = {
	// Simple aliases (exact copy)
	rain: {
		source: 'precipitation'
	},
	convective_cloud_base: {
		source: 'convective_cloud_top'
	},
	wave: {
		source: 'swell'
	}
};

function generateColorScales(): Record<string, ColorScale> {
	const colorScales: Record<string, ColorScale> = {};

	// Helper function to generate a single color scale
	function generateSingleColorScale(definition: ColorScaleDefinition): ColorScale {
		const { min, max, steps, colors, opacity } = definition;

		let generatedColors: [number, number, number][];

		if (
			Array.isArray(colors) &&
			colors.length > 0 &&
			typeof colors[0] === 'object' &&
			'colors' in colors[0]
		) {
			// Handle ColorSegment[] - multi-segment color scales
			const segments = colors as ColorSegment[];
			generatedColors = [];

			for (const segment of segments) {
				const segmentColors = interpolateColorScale(segment.colors, segment.steps, 'hsl');
				generatedColors.push(...segmentColors);
			}
		} else {
			// Handle string[] - simple color array
			const colorStrings = colors as string[];
			generatedColors = interpolateColorScale(colorStrings, steps, 'hsl');
		}

		const scalefactor = steps / (max - min);
		return { ...definition, scalefactor, colors: generatedColors, opacity };
	}

	// Generate base color scales
	for (const [key, definition] of Object.entries(colorScaleDefinitions)) {
		colorScales[key] = generateSingleColorScale(definition);
	}

	// Generate aliases
	for (const [aliasName, aliasConfig] of Object.entries(aliases)) {
		const { source } = aliasConfig;

		// Get the source (could be a base definition or another alias)
		const sourceColorScale = colorScales[source];
		if (!sourceColorScale) {
			throw new Error(`Source color scale '${source}' not found for alias '${aliasName}'`);
		}
		// Simple copy
		colorScales[aliasName] = { ...sourceColorScale };
	}

	return colorScales;
}

function serializeOpacity(opacity: OpacityDefinition): string {
	if (!opacity) return '';
	const mode = opacity.mode;
	const params = opacity.params || {};
	let paramsLines = '';
	for (const [k, v] of Object.entries(params)) {
		paramsLines += `\n\t\t\t${k}: ${JSON.stringify(v)},`;
	}
	return `\n\t\topacity: {\n\t\t\tmode: '${mode}',\n\t\t\tparams: {${paramsLines}\n\t\t\t}\n\t\t},`;
}

function generateTypeScript(): void {
	const colorScales = generateColorScales();
	console.log(colorScales['cloud_cover']['getOpacity']);

	let content = `import type { ColorScales } from '../types';

export const colorScales: ColorScales = {`;
	for (const [key, colorScale] of Object.entries(colorScales)) {
		const { min, max, steps, colors, unit, opacity, scalefactor } = colorScale;

		content += `
	'${key}': {
		unit: '${unit}',
		min: ${min},
		max: ${max},
		steps: ${steps},
		colors: [`;
		for (const color of colors) {
			content += `\n			[${color[0]}, ${color[1]}, ${color[2]}],`;
		}
		content += `],
		scalefactor: ${scalefactor},`;

		if (opacity) {
			content += serializeOpacity(opacity);
		}
		content += `
	},`;
	}
	content += `}`;

	const outputPath = join(__dirname, '../src/utils/color-scales.ts');
	writeFileSync(outputPath, content);
	console.log('✅ Generated color scales at:', outputPath);
}

generateTypeScript();

interface ColorSegment {
	colors: string[];
	steps: number;
}

interface AliasConfig {
	source: string;
}

interface ColorScaleDefinition {
	min: number;
	max: number;
	steps: number;
	colors: string[] | ColorSegment[];
	opacity?: OpacityDefinition;
	unit: string;
}
