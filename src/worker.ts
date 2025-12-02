import * as tilebelt from '@mapbox/tilebelt';
import * as turf from '@turf/turf';
import Pbf from 'pbf';

import { generateArrows } from './utils/arrows';
import { MS_TO_KMH } from './utils/constants';
import { generateContours } from './utils/contours';
import { generateGridPoints } from './utils/grid-points';
import { lat2tile, lon2tile, tile2lat, tile2lon } from './utils/math';
import { getColor, getOpacity } from './utils/styling';
import { hideZero } from './utils/variables';

import { GridFactory } from './grids/index';

import { TileRequest } from './types';

self.onmessage = async (message: MessageEvent<TileRequest>): Promise<void> => {
	const key = message.data.key;
	const { z, x, y } = message.data.tileIndex;
	const ranges = message.data.dataOptions.ranges;
	const domain = message.data.dataOptions.domain;
	const values = message.data.data.values;

	if (!values) {
		throw new Error('No values provided');
	}

	if (message.data.type == 'getImage') {
		const dark = message.data.renderOptions.dark;
		const tileSize = message.data.renderOptions.tileSize;
		const colorScale = message.data.renderOptions.colorScale;
		const variable = message.data.dataOptions.variable;

		const clippingOptions = message.data.clippingOptions;

		let tileLiesInBoundaries = true;
		let tileLiesWithinBoundaries = true;
		let boundaries, polygons;
		if (clippingOptions) {
			try {
				// optional dependancy
				// const turf = await import('@turf/turf');

				tileLiesInBoundaries = false;
				tileLiesWithinBoundaries = false;
				const tileBbox = turf.polygon(tilebelt.tileToGeoJSON([x, y, z]).coordinates);

				// zoomlevel 0 should be 0.25 zoomlevel 12 should be 0.00025 (works for both example sources)
				const tolerance = 0.00025 * 10 ** ((12 - z) / 3);

				boundaries = [];
				polygons = [];
				for (const feature of clippingOptions.geojson.features) {
					const boundary = turf.polygon(feature.geometry.coordinates[0]);
					// highQuality is 10-20x slower, but better results, and since it's run only once here should be okay.
					const simplifiedBoundary = turf.simplify(boundary, {
						tolerance: tolerance,
						highQuality: true
					});
					if (!tileLiesInBoundaries && turf.booleanIntersects(tileBbox, simplifiedBoundary)) {
						tileLiesInBoundaries = true;
					}
					if (!tileLiesWithinBoundaries && turf.booleanWithin(tileBbox, simplifiedBoundary)) {
						tileLiesWithinBoundaries = true;
					}

					boundaries.push(simplifiedBoundary);

					for (const coordinates of simplifiedBoundary.geometry.coordinates) {
						polygons.push(
							coordinates.map((coordinate) => {
								const polyX = lon2tile(coordinate[0], z);
								const polyY = lat2tile(coordinate[1], z);
								return [(polyX - x) * tileSize, (polyY - y) * tileSize];
							})
						);
					}
				}
			} catch (e) {
				console.log(e);
				throw new Error('Could not load @turf/turf');
			}
		}

		const pixels = tileSize * tileSize;
		const rgba = new Uint8ClampedArray(pixels * 4);

		const grid = GridFactory.create(domain.grid, ranges);

		const isWind = variable.value.includes('wind');
		const isHideZero = hideZero.includes(variable.value);
		const isWeatherCode = variable.value === 'weather_code';

		if (tileLiesInBoundaries) {
			for (let i = 0; i < tileSize; i++) {
				const lat = tile2lat(y + i / tileSize, z);
				for (let j = 0; j < tileSize; j++) {
					const ind = j + i * tileSize;
					const lon = tile2lon(x + j / tileSize, z);
					let px = grid.getLinearInterpolatedValue(values, lat, lon);

					if (isHideZero) {
						if (px < 0.25) {
							px = NaN;
						}
					}

					if (isWind) {
						px = px * MS_TO_KMH;
					}

					if (isNaN(px) || px === Infinity || isWeatherCode) {
						rgba[4 * ind] = 0;
						rgba[4 * ind + 1] = 0;
						rgba[4 * ind + 2] = 0;
						rgba[4 * ind + 3] = 0;
					} else {
						const color = getColor(colorScale, px);

						if (color) {
							rgba[4 * ind] = color[0];
							rgba[4 * ind + 1] = color[1];
							rgba[4 * ind + 2] = color[2];
							rgba[4 * ind + 3] = getOpacity(variable.value, px, dark, colorScale);
						}
					}
				}
			}
		}

		const imageData = new ImageData(rgba, tileSize, tileSize);

		const canvas = new OffscreenCanvas(tileSize, tileSize);
		const context = canvas.getContext('2d');

		if (!context) {
			throw new Error('Could not initialise canvas context');
		}

		context.putImageData(imageData, 0, 0);

		let blob;
		// if tile lies completely within boundaries, no need to clip
		if (clippingOptions && !tileLiesWithinBoundaries && !clippingOptions.onlyClipCompleteTiles) {
			// generate 2nd OffscreenCanvas to handle clipping
			const clipCanvas = new OffscreenCanvas(tileSize, tileSize);
			const clipContext = clipCanvas.getContext('2d');

			if (!clipContext) {
				throw new Error('Could not initialise canvas context');
			}

			// draw the polygon(s) as path on the clipCanvas
			if (polygons) {
				clipContext.beginPath();
				for (const polygon of polygons) {
					for (const [index, [polyX, polyY]] of polygon.entries()) {
						if (index === 0) {
							clipContext.moveTo(polyX, polyY);
						} else {
							clipContext.lineTo(polyX, polyY);
						}
					}
				}
				clipContext.closePath();

				clipContext.clip('nonzero');
			}

			// clipContext.fillStyle = 'red';
			// clipContext.fill();

			clipContext?.drawImage(canvas, 0, 0);
			blob = await clipCanvas.convertToBlob({ type: 'image/png' });
		} else {
			blob = await canvas.convertToBlob({ type: 'image/png' });
		}

		const arrayBuffer = await blob.arrayBuffer();

		postMessage({ type: 'returnImage', tile: arrayBuffer, key: key }, { transfer: [arrayBuffer] });
	} else if (message.data.type == 'getArrayBuffer') {
		const directions = message.data.data.directions;

		const pbf = new Pbf();

		if (message.data.renderOptions.drawGrid) {
			if (domain.grid.type !== 'regular') {
				throw new Error('Only regular grid types supported');
			}
			generateGridPoints(pbf, values, directions, domain.grid, x, y, z);
		}
		if (message.data.renderOptions.drawArrows && directions) {
			generateArrows(pbf, values, directions, domain, ranges, x, y, z);
		}
		if (message.data.renderOptions.drawContours) {
			const interval = message.data.renderOptions.interval;
			const grid = GridFactory.create(domain.grid, ranges);
			generateContours(pbf, values, grid, x, y, z, interval ? interval : 2);
		}

		const arrayBuffer = pbf.finish();
		postMessage(
			{ type: 'returnArrayBuffer', tile: arrayBuffer.buffer, key: key },
			{ transfer: [arrayBuffer.buffer] }
		);
	}
};
