/** Extract the protocol prefix from a URL, e.g. "om" from "om://…". Returns null if not found. */
export function extractProtocol(url: string): string | null {
	const idx = url.indexOf('://');
	return idx !== -1 ? url.substring(0, idx) : null;
}
