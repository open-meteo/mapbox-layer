// @ts-expect-error worker import
import TileWorker from './worker?worker&inline';

import { TilePromise, TileRequest, TileResult, WorkerResponse } from './types';

export class WorkerPool {
	private workers: Worker[] = [];
	private nextWorker = 0;
	/** Stores pending tile requests by key to avoid duplicate requests for the same tile */
	private pendingTiles = new Map<string, TilePromise>();

	/**
	 * Stores an array of resolve functions for each pending key.
	 * This allows for multiple subscribers for the same tile key.
	 */
	private resolvers = new Map<string, Array<(tile: TileResult) => void>>();

	constructor() {
		if (typeof window === 'undefined' || typeof Worker === 'undefined') {
			// Not in browser, don't create workers
			return;
		}
		const workerCount = navigator.hardwareConcurrency || 4;
		for (let i = 0; i < workerCount; i++) {
			const worker = new TileWorker();
			worker.onmessage = (message: MessageEvent) => this.handleMessage(message);
			worker.onerror = (error: ErrorEvent) => this.handleError(error);
			this.workers.push(worker);
		}
	}

	private handleMessage(message: MessageEvent): void {
		const data = message.data as WorkerResponse;

		if (data.type === 'cancelled') {
			const resolvers = this.resolvers.get(data.key);
			if (resolvers) {
				// Resolve with cancelled status
				resolvers.forEach((resolve) => resolve({ cancelled: true }));
				this.cleanupRequest(data.key);
			}
			return;
		}

		if (data.type.startsWith('return')) {
			const resolveFns = this.resolvers.get(data.key);

			if (resolveFns && resolveFns.length > 0) {
				const originalTile = data.tile;

				// The first subscriber can receive the original (transferred) buffer.
				const firstResolver = resolveFns.shift()!;
				firstResolver({ data: originalTile, cancelled: false });

				// All other subscribers must receive a clone.
				resolveFns.forEach((resolve) => {
					// Create a copy for each subsequent subscriber.
					// ImageBitmaps are safe to share without cloning.
					const tile = originalTile instanceof ArrayBuffer ? originalTile.slice(0) : originalTile;
					resolve({ data: tile, cancelled: false });
				});

				this.cleanupRequest(data.key);
			} else {
				console.error(`Unexpected tile response for ${data.key}. ${data.type}`);
			}
		}
	}

	private cleanupRequest(key: string): void {
		this.resolvers.delete(key);
		this.pendingTiles.delete(key);
	}

	private handleError(error: ErrorEvent): void {
		// Simplified error handler: just log for now
		console.error('Error in worker:', error.message, error);
	}

	public getNextWorker(): Worker | undefined {
		if (this.workers.length === 0) return undefined;

		const worker = this.workers[this.nextWorker];
		this.nextWorker = (this.nextWorker + 1) % this.workers.length;
		return worker;
	}

	public requestTile(request: TileRequest): TilePromise {
		// Return resolved promise with null/undefined for aborted requests
		if (request.signal?.aborted) {
			return Promise.resolve({ cancelled: true });
		}

		// If a request for this key is already in flight...
		if (this.pendingTiles.has(request.key)) {
			return new Promise<TileResult>((resolve, reject) => {
				this.resolvers.get(request.key)!.push(resolve);

				// Set up abort listener for this specific promise
				if (request.signal) {
					const abortHandler = () => {
						reject(new Error('Request aborted'));
					};
					request.signal.addEventListener('abort', abortHandler, { once: true });
				}
			});
		}

		// This is the first request for this key.
		const worker = this.getNextWorker();
		if (!worker) {
			return Promise.reject(new Error('No workers available (likely running in SSR)'));
		}

		// Create the promise and store its resolver in a new array.
		const promise = new Promise<TileResult>((resolve) => {
			this.resolvers.set(request.key, [resolve]);

			// Set up abort listener
			if (request.signal) {
				const abortHandler = () => {
					// Send cancel message to worker
					worker.postMessage({
						type: 'cancel',
						key: request.key
					});
				};

				request.signal.addEventListener('abort', abortHandler, { once: true });
			}
		});

		// Store the master promise to indicate a request is in-flight.
		this.pendingTiles.set(request.key, promise);

		// Don't send the signal object to the worker (it's not transferable)
		const { signal: _signal, ...requestWithoutSignal } = request;
		worker.postMessage(requestWithoutSignal);

		return promise;
	}
}
