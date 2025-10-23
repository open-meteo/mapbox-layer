import L, { GridLayerOptions, DoneCallback, Coords } from 'leaflet';
import { defaultOmProtocolSettings, getTile, initOMFile, omProtocol } from './om-protocol';

export interface OpenMeteoLeafletLayerOptions extends GridLayerOptions {
	omUrl: string;
}

export class OpenMeteoLeafletLayer extends L.GridLayer {
	omUrl: string;

	constructor(options: OpenMeteoLeafletLayerOptions) {
		super(options);
		const omProtocolOptions = defaultOmProtocolSettings;
		this.omUrl = options.omUrl;
		initOMFile(this.omUrl, omProtocolOptions);
	}

	createTile(coords: Coords, done: DoneCallback): HTMLCanvasElement {
		const tile = document.createElement('canvas');
		tile.width = 256;
		tile.height = 256;

		getTile({ z: coords.z, x: coords.x, y: coords.y }, this.omUrl)
			.then((imageBitmap: ImageBitmap) => {
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

		return tile;
	}
}
