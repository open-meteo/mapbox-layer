import { estimateFlowMps } from '../utils/optical-flow';
import { describe, expect, it } from 'vitest';

const METERS_PER_DEG = 111_320;

/** A field of Gaussian blobs on an nx×ny grid, shifted by (sx, sy) cells. */
const blobField = (nx: number, ny: number, shiftX: number, shiftY: number): Float32Array => {
	const out = new Float32Array(nx * ny);
	const blobs = [
		[nx * 0.3, ny * 0.4, 9],
		[nx * 0.6, ny * 0.55, 7],
		[nx * 0.45, ny * 0.7, 11]
	];
	for (let y = 0; y < ny; y++) {
		for (let x = 0; x < nx; x++) {
			let value = 0;
			for (const [bx, by, r] of blobs) {
				const dxp = x - shiftX - bx;
				const dyp = y - shiftY - by;
				value += 10 * Math.exp(-(dxp * dxp + dyp * dyp) / (2 * r * r));
			}
			out[y * nx + x] = value;
		}
	}
	return out;
};

describe('estimateFlowMps', () => {
	it('recovers a known uniform translation', () => {
		const nx = 200;
		const ny = 160;
		const dx = 0.25;
		const dy = -0.25; // north-up rows
		const originY = 60;
		const dtSec = 3600;
		const shiftX = 4; // cells eastward
		const shiftY = 3; // cells toward increasing row = southward here

		const prev = blobField(nx, ny, 0, 0);
		const next = blobField(nx, ny, shiftX, shiftY);
		const flow = estimateFlowMps(prev, next, nx, ny, dx, dy, originY, dtSec);
		expect(flow).toBeDefined();

		// Sample at a blob centre, where the match is unambiguous.
		const x = Math.round(nx * 0.3);
		const y = Math.round(ny * 0.4);
		const i = y * nx + x;
		const lat = originY + dy * y;
		const expectedU = (shiftX * dx * METERS_PER_DEG * Math.cos((lat * Math.PI) / 180)) / dtSec;
		const expectedV = (shiftY * dy * METERS_PER_DEG) / dtSec;

		expect(flow!.u[i]).toBeCloseTo(expectedU, -1);
		expect(flow!.v[i]).toBeCloseTo(expectedV, -1);
		// Direction sanity: eastward and southward.
		expect(flow!.u[i]).toBeGreaterThan(0);
		expect(flow!.v[i]).toBeLessThan(0);
	});

	it('reverses with a negative dt (backwards scrubbing)', () => {
		const nx = 120;
		const ny = 120;
		const prev = blobField(nx, ny, 0, 0);
		const next = blobField(nx, ny, 3, 0);
		const forward = estimateFlowMps(prev, next, nx, ny, 0.25, -0.25, 50, 3600)!;
		const backward = estimateFlowMps(next, prev, nx, ny, 0.25, -0.25, 50, -3600)!;
		const i = Math.round(ny * 0.4) * nx + Math.round(nx * 0.3);
		// Same physical velocity either way round, within the block quantisation.
		expect(Math.sign(backward.u[i])).toBe(Math.sign(forward.u[i]));
		expect(Math.abs(backward.u[i] - forward.u[i])).toBeLessThan(Math.abs(forward.u[i]) * 0.2);
	});

	it('returns zero motion for a static field', () => {
		const nx = 100;
		const ny = 100;
		const field = blobField(nx, ny, 0, 0);
		const flow = estimateFlowMps(field, field.slice(), nx, ny, 0.25, -0.25, 50, 3600)!;
		const i = Math.round(ny * 0.4) * nx + Math.round(nx * 0.3);
		expect(Math.abs(flow.u[i])).toBeLessThan(1);
		expect(Math.abs(flow.v[i])).toBeLessThan(1);
	});
});
