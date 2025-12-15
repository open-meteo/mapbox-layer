import L, { Coords, DoneCallback, GridLayerOptions } from 'leaflet';

import { parseRequest } from './utils/parse-request';

import { defaultOmProtocolSettings, requestTile } from './om-protocol';
import { ensureData, getOrCreateState, getProtocolInstance } from './om-protocol-state';

import { OmProtocolInstance, ParsedRequest, TileResponse } from './types';

export interface OpenMeteoLeafletLayerOptions extends GridLayerOptions {
	omUrl: string;
}

export class OpenMeteoLeafletLayer extends L.GridLayer {
	omUrl: string;
	parsedRequest: ParsedRequest;
	omProtocolInstance: OmProtocolInstance;

	constructor(options: OpenMeteoLeafletLayerOptions) {
		super(options);
		const omProtocolOptions = defaultOmProtocolSettings;
		this.omUrl = options.omUrl;
		this.parsedRequest = parseRequest(this.omUrl, omProtocolOptions);
		this.omProtocolInstance = getProtocolInstance(omProtocolOptions);
	}

	createTile(coords: Coords, done: DoneCallback): HTMLCanvasElement {
		const tile = document.createElement('canvas');
		tile.width = 256;
		tile.height = 256;

		const state = getOrCreateState(
			this.omProtocolInstance.stateByKey,
			this.parsedRequest.stateKey,
			this.parsedRequest.dataOptions,
			this.parsedRequest.baseUrl
		);

		ensureData(state, this.omProtocolInstance.omFileReader).then((data) => {
			this.parsedRequest.tileIndex = {
				x: coords.x,
				y: coords.y,
				z: coords.z
			};
			requestTile(this.parsedRequest, data, 'image')
				.then((value: TileResponse) => {
					const imageBitmap = value as ImageBitmap;
					const ctx = tile.getContext('2d');
					if (ctx) {
						ctx.drawImage(imageBitmap, 0, 0);
					}
					done(undefined, tile);
				})
				.catch((err: unknown) => {
					console.error('Tile error', coords, err);
					done(err as Error, tile);
				});
		});

		return tile;
	}
}
