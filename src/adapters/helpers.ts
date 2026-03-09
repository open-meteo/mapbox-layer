/** Extract the protocol prefix from a URL, e.g. "om" from "om://…". Returns null if not found. */
export function extractProtocol(url: string): string | null {
	const idx = url.indexOf('://');
	return idx !== -1 ? url.substring(0, idx) : null;
}

/** Substitute {z}/{x}/{y} placeholders in a tile URL template. */
export function buildTileUrl(template: string, z: number, x: number, y: number): string {
	return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}
