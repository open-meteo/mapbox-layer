/**
 * Visual regression tests for tile rendering.
 *
 * These tests read real data from the OM file in `public/test.om`,
 * render tiles at various zoom levels and positions using the same
 * grid + color-scale logic as the worker, and compare the resulting
 * RGBA pixels against previously saved PNG baselines.
 *
 * On the very first run the baselines do not exist yet, so they are
 * written automatically. Subsequent runs compare against those files.
 *
 * To regenerate baselines after an intentional visual change, delete
 * the `__snapshots__` directory and re-run the tests.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	FileBackend,
	initWasm,
	OmDataType,
	OmFileReader,
	type OmFileReaderBackend
} from '@openmeteo/file-reader';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RegularGrid } from '../grids/regular';
import type { DimensionRange, RegularGridData, RenderableColorScale } from '../types';
import { tile2lat, tile2lon } from '../utils/math';
import { getColor, getColorScale } from '../utils/styling';

// ────────────────────────────────────────────────────────────
// Paths
// ────────────────────────────────────────────────────────────
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const OM_FILE_PATH = resolve(__dirname, '../../public/test.om');
const SNAPSHOT_DIR = resolve(__dirname, '__snapshots__');

// ────────────────────────────────────────────────────────────
// Test-scoped shared state
// ────────────────────────────────────────────────────────────
let reader: OmFileReader;
let backend: OmFileReaderBackend;

// The test.om file is a DWD ICON global grid
const GRID_DATA: RegularGridData = {
	type: 'regular',
	nx: 2879,
	ny: 1441,
	latMin: -90,
	lonMin: -180,
	dx: 0.125,
	dy: 0.125
};

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** Render a single tile to an RGBA Uint8ClampedArray (same logic as worker.ts) */
function renderTile(
	values: Float32Array,
	grid: RegularGrid,
	colorScale: RenderableColorScale,
	tileIndex: { z: number; x: number; y: number },
	tileSize: number
): Uint8ClampedArray {
	const { z, x, y } = tileIndex;
	const pixels = tileSize * tileSize;
	const rgba = new Uint8ClampedArray(pixels * 4);

	for (let i = 0; i < tileSize; i++) {
		const lat = tile2lat(y + i / tileSize, z);

		for (let j = 0; j < tileSize; j++) {
			const ind = j + i * tileSize;
			const lon = tile2lon(x + j / tileSize, z);

			const px = grid.getLinearInterpolatedValue(values, lat, lon);
			if (isFinite(px)) {
				const color = getColor(colorScale, px);
				rgba[4 * ind] = color[0];
				rgba[4 * ind + 1] = color[1];
				rgba[4 * ind + 2] = color[2];
				rgba[4 * ind + 3] = 255 * color[3];
			}
		}
	}

	return rgba;
}

/** Encode raw RGBA pixels to a PNG Buffer */
function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
	const png = new PNG({ width, height });
	png.data = Buffer.from(rgba);
	return PNG.sync.write(png);
}

/** Decode a PNG file into an RGBA Uint8ClampedArray */
function decodePng(pngBuffer: Buffer): { rgba: Uint8ClampedArray; width: number; height: number } {
	const png = PNG.sync.read(pngBuffer);
	return { rgba: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

/**
 * Compare two RGBA buffers and return the percentage of pixels
 * that differ by more than `tolerance` on any channel.
 */
function compareImages(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
	tolerance: number = 1
): { mismatchRatio: number; maxDelta: number } {
	if (actual.length !== expected.length) {
		return { mismatchRatio: 1, maxDelta: 255 };
	}

	const pixelCount = actual.length / 4;
	let mismatchCount = 0;
	let maxDelta = 0;

	for (let i = 0; i < pixelCount; i++) {
		const offset = i * 4;
		let pixelMismatch = false;
		for (let c = 0; c < 4; c++) {
			const delta = Math.abs(actual[offset + c] - expected[offset + c]);
			if (delta > maxDelta) maxDelta = delta;
			if (delta > tolerance) pixelMismatch = true;
		}
		if (pixelMismatch) mismatchCount++;
	}

	return { mismatchRatio: mismatchCount / pixelCount, maxDelta };
}

/**
 * Assert that a rendered tile matches its baseline snapshot.
 * If no baseline exists yet it is created automatically.
 */
function assertMatchesSnapshot(
	rgba: Uint8ClampedArray,
	tileSize: number,
	snapshotName: string,
	tolerancePercent: number = 0
): void {
	const pngBuffer = encodePng(rgba, tileSize, tileSize);
	const snapshotPath = resolve(SNAPSHOT_DIR, `${snapshotName}.png`);

	if (!existsSync(snapshotPath)) {
		writeFileSync(snapshotPath, pngBuffer);
		console.log(`  ✏️  Created baseline: ${snapshotName}.png`);
		// First run: nothing to compare against, pass automatically
		return;
	}

	const baselineBuffer = readFileSync(snapshotPath);
	const baseline = decodePng(baselineBuffer);

	expect(baseline.width).toBe(tileSize);
	expect(baseline.height).toBe(tileSize);

	const { mismatchRatio, maxDelta } = compareImages(rgba, baseline.rgba);

	if (mismatchRatio > tolerancePercent) {
		// Write actual output next to the baseline for easy inspection
		const actualPath = resolve(SNAPSHOT_DIR, `${snapshotName}.actual.png`);
		writeFileSync(actualPath, pngBuffer);
		expect.fail(
			`Visual mismatch for "${snapshotName}": ` +
				`${(mismatchRatio * 100).toFixed(2)}% of pixels differ ` +
				`(max channel delta: ${maxDelta}). ` +
				`Actual output saved to ${actualPath}`
		);
	}
}

/** Read a variable from the OM file */
async function readVariable(variableName: string): Promise<Float32Array> {
	const child = await reader.getChildByName(variableName);
	if (!child) throw new Error(`Variable "${variableName}" not found in OM file`);
	const dims = child.getDimensions();
	const values = (await child.read({
		type: OmDataType.FloatArray,
		ranges: [
			{ start: 0, end: dims[0] },
			{ start: 0, end: dims[1] }
		]
	})) as Float32Array;
	return values;
}

// ────────────────────────────────────────────────────────────
// Setup / Teardown
// ────────────────────────────────────────────────────────────
beforeAll(async () => {
	if (!existsSync(SNAPSHOT_DIR)) {
		mkdirSync(SNAPSHOT_DIR, { recursive: true });
	}
	await initWasm();
	backend = new FileBackend(OM_FILE_PATH);
	reader = await OmFileReader.create(backend);
});

afterAll(async () => {
	reader?.dispose();
	await (backend as any)?.close?.();
});

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────
const TILE_SIZE = 256;

describe('Visual tile rendering', () => {
	// ── Temperature 2m ───────────────────────────────────────
	describe('temperature_2m', () => {
		let values: Float32Array;
		let grid: RegularGrid;
		let colorScale: RenderableColorScale;

		beforeAll(async () => {
			values = await readVariable('temperature_2m');
			grid = new RegularGrid(GRID_DATA);
			colorScale = getColorScale('temperature_2m', false);
		});

		it('global overview — zoom 1, tile (0, 0)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 1, x: 0, y: 0 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'temperature_2m-z1-x0-y0');
		});

		it('global overview — zoom 1, tile (1, 0)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 1, x: 1, y: 0 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'temperature_2m-z1-x1-y0');
		});

		it('global overview — zoom 1, tile (0, 1)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 1, x: 0, y: 1 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'temperature_2m-z1-x0-y1');
		});

		it('Europe — zoom 3, tile (4, 2)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 3, x: 4, y: 2 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'temperature_2m-z3-x4-y2');
		});

		it('USA — zoom 3, tile (1, 3)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 3, x: 1, y: 3 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'temperature_2m-z3-x1-y3');
		});

		it('antimeridian — zoom 2, tile (3, 1)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 2, x: 3, y: 1 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'temperature_2m-z2-x3-y1');
		});

		it('high zoom — zoom 5, tile (17, 10) Central Europe', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 5, x: 17, y: 10 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'temperature_2m-z5-x17-y10');
		});

		it('dark theme', () => {
			const darkColorScale = getColorScale('temperature_2m', true);
			const rgba = renderTile(values, grid, darkColorScale, { z: 1, x: 0, y: 0 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'temperature_2m-dark-z1-x0-y0');
		});
	});

	// ── Precipitation ────────────────────────────────────────
	describe('precipitation', () => {
		let values: Float32Array;
		let grid: RegularGrid;
		let colorScale: RenderableColorScale;

		beforeAll(async () => {
			values = await readVariable('precipitation');
			grid = new RegularGrid(GRID_DATA);
			colorScale = getColorScale('precipitation', false);
		});

		it('global overview — zoom 1, tile (0, 0)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 1, x: 0, y: 0 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'precipitation-z1-x0-y0');
		});

		it('Europe — zoom 3, tile (4, 2)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 3, x: 4, y: 2 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'precipitation-z3-x4-y2');
		});
	});

	// ── Cloud Cover ──────────────────────────────────────────
	describe('cloud_cover', () => {
		let values: Float32Array;
		let grid: RegularGrid;
		let colorScale: RenderableColorScale;

		beforeAll(async () => {
			values = await readVariable('cloud_cover');
			grid = new RegularGrid(GRID_DATA);
			colorScale = getColorScale('cloud_cover', false);
		});

		it('global overview — zoom 1, tile (0, 0)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 1, x: 0, y: 0 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'cloud_cover-z1-x0-y0');
		});

		it('Europe — zoom 3, tile (4, 2)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 3, x: 4, y: 2 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'cloud_cover-z3-x4-y2');
		});
	});

	// ── Wind Gusts ───────────────────────────────────────────
	describe('wind_gusts_10m', () => {
		let values: Float32Array;
		let grid: RegularGrid;
		let colorScale: RenderableColorScale;

		beforeAll(async () => {
			values = await readVariable('wind_gusts_10m');
			grid = new RegularGrid(GRID_DATA);
			colorScale = getColorScale('wind_gusts_10m', false);
		});

		it('global overview — zoom 1, tile (0, 0)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 1, x: 0, y: 0 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'wind_gusts_10m-z1-x0-y0');
		});
	});

	// ── Pressure MSL ─────────────────────────────────────────
	describe('pressure_msl', () => {
		let values: Float32Array;
		let grid: RegularGrid;
		let colorScale: RenderableColorScale;

		beforeAll(async () => {
			values = await readVariable('pressure_msl');
			grid = new RegularGrid(GRID_DATA);
			colorScale = getColorScale('pressure_msl', false);
		});

		it('global overview — zoom 1, tile (0, 0)', () => {
			const rgba = renderTile(values, grid, colorScale, { z: 1, x: 0, y: 0 }, TILE_SIZE);
			assertMatchesSnapshot(rgba, TILE_SIZE, 'pressure_msl-z1-x0-y0');
		});
	});

	// ── Tile size variations ─────────────────────────────────
	describe('tile size variations', () => {
		let values: Float32Array;
		let grid: RegularGrid;
		let colorScale: RenderableColorScale;

		beforeAll(async () => {
			values = await readVariable('temperature_2m');
			grid = new RegularGrid(GRID_DATA);
			colorScale = getColorScale('temperature_2m', false);
		});

		it('128×128 tile', () => {
			const size = 128;
			const rgba = renderTile(values, grid, colorScale, { z: 1, x: 0, y: 0 }, size);
			assertMatchesSnapshot(rgba, size, 'temperature_2m-128-z1-x0-y0');
		});

		it('512×512 tile', () => {
			const size = 512;
			const rgba = renderTile(values, grid, colorScale, { z: 1, x: 0, y: 0 }, size);
			assertMatchesSnapshot(rgba, size, 'temperature_2m-512-z1-x0-y0');
		});
	});
});
