/**
 * Coarse optical flow between two timesteps of the same regular-grid crop,
 * for the advected temporal blend. A steering wind only approximates how
 * precipitation features actually move — any displacement error makes the
 * blend's two copies misalign (peaks split into lobes on under-shoot, the
 * interior texture races and snaps back on over-shoot). Block-matching the
 * fields themselves measures the true apparent motion.
 *
 * The result is a full-resolution synthetic velocity field (m/s eastward /
 * northward), so it plugs into the existing wind-advect shader unchanged.
 * Pure math with no GL or DOM dependencies — runs in the decode worker.
 */

export interface FlowField {
	u: Float32Array;
	v: Float32Array;
}

/** Longest coarse-grid side; caps the matching cost for huge crops. */
const COARSE_MAX = 256;
/** Block side in coarse cells compared per match. */
const BLOCK = 6;
/** Fastest apparent motion searched for (m/s); caps the search radius. */
const MAX_SPEED_MPS = 45;
/** Search-distance penalty per coarse cell, as a fraction of the mean
 *  absolute difference — prefers small motion where the field is flat. */
const DISTANCE_PENALTY = 0.02;
/** Minimum mean |value| in a block to attempt a match (else neighbour fill). */
const MIN_SIGNAL = 1e-4;

const METERS_PER_DEG = 111_320;

/**
 * Estimate the apparent motion from `prev` to `next` (values on the same
 * `nx`×`ny` regular grid; `dx`/`dy` in degrees with `dy`'s sign as stored,
 * `originY` the first row's latitude). `dtSec` is signed (next − prev), so
 * backwards steps yield reversed velocities that the shader's signed Δt
 * reconstitutes. Returns undefined for degenerate inputs.
 */
export const estimateFlowMps = (
	prev: Float32Array,
	next: Float32Array,
	nx: number,
	ny: number,
	dx: number,
	dy: number,
	originY: number,
	dtSec: number
): FlowField | undefined => {
	const n = nx * ny;
	if (prev.length < n || next.length < n || dtSec === 0 || !(dx > 0) || dy === 0) {
		return undefined;
	}

	// ── Downsample both fields to the coarse matching grid ────────────────
	const factor = Math.max(1, Math.pow(2, Math.ceil(Math.log2(Math.max(nx, ny) / COARSE_MAX))));
	const cw = Math.ceil(nx / factor);
	const ch = Math.ceil(ny / factor);
	const coarse = (values: Float32Array): Float32Array => {
		const out = new Float32Array(cw * ch).fill(NaN);
		for (let cy = 0; cy < ch; cy++) {
			for (let cx = 0; cx < cw; cx++) {
				let sum = 0;
				let count = 0;
				const y1 = Math.min(ny, (cy + 1) * factor);
				const x1 = Math.min(nx, (cx + 1) * factor);
				for (let y = cy * factor; y < y1; y++) {
					const row = y * nx;
					for (let x = cx * factor; x < x1; x++) {
						const value = values[row + x];
						if (Number.isFinite(value)) {
							sum += value;
							count++;
						}
					}
				}
				if (count > 0) out[cy * cw + cx] = sum / count;
			}
		}
		return out;
	};
	const a = coarse(prev);
	const b = coarse(next);

	// ── Search radius from the max speed, in coarse cells ─────────────────
	const midLat = originY + (dy * ny) / 2;
	const cosMid = Math.max(0.3, Math.cos((midLat * Math.PI) / 180));
	const maxDispDeg = (MAX_SPEED_MPS * Math.abs(dtSec)) / METERS_PER_DEG;
	const radiusX = Math.min(10, Math.max(1, Math.ceil(maxDispDeg / (dx * factor * cosMid))));
	const radiusY = Math.min(10, Math.max(1, Math.ceil(maxDispDeg / (Math.abs(dy) * factor))));

	// ── Block matching on the coarse grids ────────────────────────────────
	const bw = Math.max(1, Math.floor(cw / BLOCK));
	const bh = Math.max(1, Math.floor(ch / BLOCK));
	const flowX = new Float32Array(bw * bh).fill(NaN);
	const flowY = new Float32Array(bw * bh).fill(NaN);

	for (let by = 0; by < bh; by++) {
		for (let bx = 0; bx < bw; bx++) {
			const x0 = bx * BLOCK;
			const y0 = by * BLOCK;

			// Signal gate: matching a flat/empty block is noise.
			let signal = 0;
			let signalCount = 0;
			for (let y = y0; y < y0 + BLOCK && y < ch; y++) {
				for (let x = x0; x < x0 + BLOCK && x < cw; x++) {
					const value = a[y * cw + x];
					if (Number.isFinite(value)) {
						signal += Math.abs(value);
						signalCount++;
					}
				}
			}
			if (signalCount === 0 || signal / signalCount < MIN_SIGNAL) continue;
			const meanAbs = signal / signalCount;

			let bestCost = Infinity;
			let bestDx = 0;
			let bestDy = 0;
			for (let sy = -radiusY; sy <= radiusY; sy++) {
				for (let sx = -radiusX; sx <= radiusX; sx++) {
					let sad = 0;
					let count = 0;
					for (let y = y0; y < y0 + BLOCK && y < ch; y++) {
						const ty = y + sy;
						if (ty < 0 || ty >= ch) continue;
						for (let x = x0; x < x0 + BLOCK && x < cw; x++) {
							const tx = x + sx;
							if (tx < 0 || tx >= cw) continue;
							const va = a[y * cw + x];
							const vb = b[ty * cw + tx];
							if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
							sad += Math.abs(va - vb);
							count++;
						}
					}
					if (count < (BLOCK * BLOCK) / 2) continue;
					const cost = sad / count + meanAbs * DISTANCE_PENALTY * Math.hypot(sx, sy);
					if (cost < bestCost) {
						bestCost = cost;
						bestDx = sx;
						bestDy = sy;
					}
				}
			}
			if (bestCost < Infinity) {
				flowX[by * bw + bx] = bestDx;
				flowY[by * bw + bx] = bestDy;
			}
		}
	}

	// ── Fill unmatched blocks from neighbours, then smooth ────────────────
	const fillAndSmooth = (field: Float32Array, passes: number): void => {
		const scratch = new Float32Array(field.length);
		for (let pass = 0; pass < passes; pass++) {
			let changed = false;
			for (let y = 0; y < bh; y++) {
				for (let x = 0; x < bw; x++) {
					const i = y * bw + x;
					let sum = 0;
					let count = 0;
					for (let oy = -1; oy <= 1; oy++) {
						for (let ox = -1; ox <= 1; ox++) {
							const yy = y + oy;
							const xx = x + ox;
							if (yy < 0 || yy >= bh || xx < 0 || xx >= bw) continue;
							const value = field[yy * bw + xx];
							if (Number.isFinite(value)) {
								sum += value;
								count++;
							}
						}
					}
					if (count > 0) {
						scratch[i] = sum / count;
						if (!Number.isFinite(field[i])) changed = true;
					} else {
						scratch[i] = NaN;
					}
				}
			}
			field.set(scratch);
			if (!changed && pass > 0) break;
		}
		for (let i = 0; i < field.length; i++) {
			if (!Number.isFinite(field[i])) field[i] = 0;
		}
	};
	fillAndSmooth(flowX, 8);
	fillAndSmooth(flowY, 8);

	// ── Upsample to full resolution as m/s east/north ─────────────────────
	// Displacement per block is in coarse cells; deg = cells·factor·d. The
	// velocity divides by the SIGNED dt, so backwards steps reverse cleanly.
	const BufferConstructor = prev.buffer.constructor as typeof ArrayBuffer;
	const u = new Float32Array(new BufferConstructor(n * 4));
	const v = new Float32Array(new BufferConstructor(n * 4));
	const blockPx = BLOCK * factor;
	for (let y = 0; y < ny; y++) {
		const lat = originY + dy * y;
		const mPerDegLon = METERS_PER_DEG * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
		// Bilinear position in block space (block centres at (i + 0.5)·blockPx).
		const fy = Math.min(bh - 1, Math.max(0, y / blockPx - 0.5));
		const y0b = Math.floor(fy);
		const y1b = Math.min(bh - 1, y0b + 1);
		const wy = fy - y0b;
		for (let x = 0; x < nx; x++) {
			const fx = Math.min(bw - 1, Math.max(0, x / blockPx - 0.5));
			const x0b = Math.floor(fx);
			const x1b = Math.min(bw - 1, x0b + 1);
			const wx = fx - x0b;
			const lerp = (field: Float32Array): number => {
				const top = field[y0b * bw + x0b] * (1 - wx) + field[y0b * bw + x1b] * wx;
				const bottom = field[y1b * bw + x0b] * (1 - wx) + field[y1b * bw + x1b] * wx;
				return top * (1 - wy) + bottom * wy;
			};
			const cells = lerp(flowX);
			const cellsY = lerp(flowY);
			const i = y * nx + x;
			u[i] = (cells * factor * dx * mPerDegLon) / dtSec;
			v[i] = (cellsY * factor * dy * METERS_PER_DEG) / dtSec;
		}
	}
	return { u, v };
};
