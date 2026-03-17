import type { OmProtocolSettings } from '../types';

/**
 * Protocol handler signature – identical to MapLibre's addProtocol handler so
 * that `omProtocol` can be passed directly.
 */
export type ProtocolHandler = (
	params: { url: string; type: string; headers?: Record<string, string> },
	abortController: AbortController,
	settings?: OmProtocolSettings
) => Promise<{ data: unknown }>;

export interface RegisteredProtocol {
	handler: ProtocolHandler;
	settings?: OmProtocolSettings;
}
