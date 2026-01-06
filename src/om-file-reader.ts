import {
	OmDataType,
	OmFileReadOptions,
	type OmFileReader,
	OmHttpBackend
} from '@openmeteo/file-reader';

import { fastAtan2, radiansToDegrees } from './utils/math';

import type { Data, DimensionRange, GridData, RegularGridData } from './types';

/**
 * Configuration options for the OMapsFileReader.
 */
interface FileReaderConfig {
	/** Whether to use SharedArrayBuffer for data reading. @default false */
	useSAB?: boolean;
	/** Maximum number of cached HTTP backends. @default 50 */
	maxCachedFiles?: number;
	/** Number of retry attempts for failed requests. @default 2 */
	retries?: number;
	/** Whether to validate ETags for cache coherency. @default false */
	eTagValidation?: boolean;
}

/**
 * Convenience class for reading from OM-files implementing some utility conversions during reading.
 *
 * Caches the backend of recently accessed files.
 */
export class OMapsFileReader {
	private static readonly s3BackendCache = new Map<string, OmHttpBackend>();

	private reader?: OmFileReader;
	readonly config: Required<FileReaderConfig>;
	private readonly allDerivationRules: VariableDerivationRule[];

	constructor(config: FileReaderConfig = {}) {
		this.config = {
			useSAB: false,
			maxCachedFiles: 50,
			retries: 2,
			eTagValidation: false,
			...config
		};

		// TODO: This could be a combination of user-defined and default derivation rules
		this.allDerivationRules = DEFAULT_DERIVATION_RULES;
	}

	async getGridParameters(variable: string): Promise<GridData> {
		if (!this.reader) {
			throw new Error('Reader not initialized');
		}

		const variableReader = await this.reader.getChildByName(variable);

		if (!variableReader) {
			throw new Error(`Variable ${variable} not found`);
		}

		const dimensions = variableReader.getDimensions();

		if (dimensions.length !== 2) {
			throw new Error(`Variable ${variable} does not have 2 dimensions`);
		}

		const [ny, nx] = dimensions;

		const wkt2Crs = await this.reader.getChildByName('crs_wkt');
		const wkt = wkt2Crs!.readScalar<string>(OmDataType.String)!;
		const grid = parseWktToRegularGridData(wkt, nx, ny, {
			inclusiveBounds: false,
			zoom: 1
		});
		return grid;
	}

	async setToOmFile(omUrl: string): Promise<void> {
		this.dispose();

		let s3Backend = OMapsFileReader.s3BackendCache.get(omUrl);
		if (!s3Backend) {
			s3Backend = new OmHttpBackend({
				url: omUrl,
				eTagValidation: this.config.eTagValidation,
				retries: this.config.retries
			});
			this.setCachedBackend(omUrl, s3Backend);
		}
		this.reader = await s3Backend.asCachedReader();
	}

	private setCachedBackend(url: string, backend: OmHttpBackend): void {
		// Implement LRU-like cache management
		if (OMapsFileReader.s3BackendCache.size >= this.config.maxCachedFiles) {
			const firstKey = OMapsFileReader.s3BackendCache.keys().next().value;
			if (firstKey) {
				OMapsFileReader.s3BackendCache.delete(firstKey);
			}
		}

		OMapsFileReader.s3BackendCache.set(url, backend);
	}

	private getRanges(ranges: DimensionRange[] | null, dimensions: number[]): DimensionRange[] {
		if (ranges) {
			return ranges;
		} else {
			return [
				{ start: 0, end: dimensions[0] },
				{ start: 0, end: dimensions[1] }
			];
		}
	}

	/** Find the first derivation rule that matches the given variable name. */
	private findDerivationRule(variable: string): VariableDerivationRule | undefined {
		return this.allDerivationRules.find((rule) => {
			if (typeof rule.pattern === 'string') {
				return variable.includes(rule.pattern);
			} else {
				return rule.pattern.test(variable);
			}
		});
	}

	/** Read variable data using a derivation rule. */
	private async readWithDerivationRule(
		variable: string,
		rule: VariableDerivationRule,
		ranges: DimensionRange[] | null
	): Promise<Data> {
		if (!this.reader) {
			throw new Error('Reader not initialized. Call setToOmFile() first.');
		}

		const [primaryVar, secondaryVar] = rule.getSourceVars(variable);

		// Get readers for source variables
		const primaryReader = await this.reader.getChildByName(primaryVar);
		if (!primaryReader) {
			throw new Error(`Primary variable ${primaryVar} not found`);
		}

		const secondaryReader = await this.reader.getChildByName(secondaryVar);
		if (!secondaryReader) {
			throw new Error(`Secondary variable ${secondaryVar} not found`);
		}

		// Read data
		const dimensions = primaryReader.getDimensions();
		const readRanges = this.getRanges(ranges, dimensions);
		const readOptions: OmFileReadOptions<OmDataType.FloatArray> = {
			type: OmDataType.FloatArray,
			ranges: readRanges,
			intoSAB: this.config.useSAB
		};

		const primaryPromise = primaryReader.read(readOptions);
		const secondaryPromise = secondaryReader.read(readOptions);
		const [primaryData, secondaryData] = await Promise.all([primaryPromise, secondaryPromise]);

		// Process using the rule
		return rule.process(primaryData, secondaryData);
	}

	/**
	 * Read a single variable directly (no derivation).
	 */
	private async readSimpleVariable(
		variable: string,
		ranges: DimensionRange[] | null
	): Promise<Data> {
		if (!this.reader) {
			throw new Error('Reader not initialized. Call setToOmFile() first.');
		}

		const variableReader = await this.reader.getChildByName(variable);
		if (!variableReader) {
			throw new Error(`Variable: ${variable} not found`);
		}

		const dimensions = variableReader.getDimensions();
		const readRanges = this.getRanges(ranges, dimensions);

		const values = (await variableReader.read({
			type: OmDataType.FloatArray,
			ranges: readRanges,
			intoSAB: this.config.useSAB
		})) as Float32Array;

		return { values, directions: undefined };
	}

	/**
	 * Read a specific variable from the file. Implements on the fly conversion for
	 * some variables, e.g. uv components are converted to speed and direction.
	 *
	 * @param variable The variable to read.
	 * @param ranges The ranges to read. If null, all dimensions are read.
	 * @returns Promise resolving to data object containing values and optional directions
	 */
	async readVariable(variable: string, ranges: DimensionRange[] | null = null): Promise<Data> {
		const derivationRule = this.findDerivationRule(variable);

		if (derivationRule) {
			return this.readWithDerivationRule(variable, derivationRule, ranges);
		} else {
			return this.readSimpleVariable(variable, ranges);
		}
	}

	hasFileOpen(omFileUrl: string) {
		if (OMapsFileReader.s3BackendCache.get(omFileUrl)) {
			return true;
		} else {
			return false;
		}
	}

	dispose() {
		if (this.reader) {
			this.reader.dispose();
		}

		delete this.reader;
	}
}

/**
 * Rule for deriving values and directions from one or two source variables.
 */
interface VariableDerivationRule {
	/** Pattern to match variable names (string or RegExp) */
	pattern: string | RegExp;

	/** Derive two variables from the requested variable. */
	getSourceVars: (variable: string) => [string, string];

	/**
	 * Process the raw data from source variables into values and directions.
	 * @param primary - Data from the primary source variable
	 * @param secondary - Data from the secondary source variable
	 * @returns Data object with values and optional directions
	 */
	process: (primary: Float32Array, secondary: Float32Array) => Data;
}

/**
 * Default derivation rules for common meteorological variables.
 */
const DEFAULT_DERIVATION_RULES: VariableDerivationRule[] = [
	// UV wind components -> speed and direction
	{
		pattern: /_[uv]_(component|current)/,
		getSourceVars: (variable: string) => {
			let postfix = '';
			const match = variable.match(/_[uv]_(?<postfix>component|current)/);
			if (match?.groups) {
				postfix = match.groups.postfix;
			}
			return [
				variable.replace(`_v_${postfix}`, `_u_${postfix}`),
				variable.replace(`_u_${postfix}`, `_v_${postfix}`)
			];
		},
		process: (u: Float32Array, v: Float32Array) => {
			const BufferConstructor = u.buffer.constructor as typeof ArrayBuffer;
			const values = new Float32Array(new BufferConstructor(u.byteLength));
			const directions = new Float32Array(new BufferConstructor(u.byteLength));

			for (let i = 0; i < u.length; i++) {
				values[i] = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
				directions[i] = (radiansToDegrees(fastAtan2(u[i], v[i])) + 180) % 360;
			}

			return { values, directions };
		}
	},

	// Speed/Direction pairs (already stored separately)
	{
		pattern: /_(?:speed|direction)_/,
		getSourceVars: (variable: string) => [
			variable.includes('_speed_') ? variable : variable.replace('_direction_', '_speed_'),
			variable.includes('_direction_') ? variable : variable.replace('_speed_', '_direction_')
		],
		process: (speed: Float32Array, direction: Float32Array) => ({
			values: speed,
			directions: direction
		})
	},

	// Wave height and direction
	{
		pattern: /wave_(?:height|direction)/,
		getSourceVars: (variable: string) => [
			variable.replace('wave_direction', 'wave_height'),
			variable.replace('wave_height', 'wave_direction')
		],
		process: (height: Float32Array, direction: Float32Array) => ({
			values: height,
			directions: direction
		})
	}
];

function parseWktBbox(
	wkt: string
): { latMin: number; lonMin: number; latMax: number; lonMax: number } | null {
	const bboxMatch = wkt.match(/BBOX\[\s*([^\]]+)\s*\]/i);
	if (!bboxMatch) return null;
	const parts = bboxMatch[1].split(',').map((s) => parseFloat(s.trim()));
	if (parts.length !== 4 || parts.some(isNaN)) return null;
	// WKT here is [latMin, lonMin, latMax, lonMax]
	return { latMin: parts[0], lonMin: parts[1], latMax: parts[2], lonMax: parts[3] };
}

type ParseGridOptions = {
	// If true, compute dx = (range) / (n - 1). If false (default) dx = (range) / n.
	inclusiveBounds?: boolean;
	// If true, force longitude range to be positive by adding 360 if necessary
	normalizeLongitude?: boolean;
	zoom?: number;
};

function parseWktToRegularGridData(
	wkt: string,
	nx: number,
	ny: number,
	opts: ParseGridOptions = {}
): RegularGridData {
	const bbox = parseWktBbox(wkt);
	if (!bbox) throw new Error('No BBOX found in WKT');

	const inclusive = opts.inclusiveBounds ?? false;
	const normalizeLon = opts.normalizeLongitude ?? true;

	let lonRange = bbox.lonMax - bbox.lonMin;
	if (normalizeLon && lonRange < 0) {
		lonRange += 360; // e.g. -180..179.75 should be handled
	}
	const latRange = bbox.latMax - bbox.latMin;

	const denomX = inclusive ? nx - 1 : nx;
	const denomY = inclusive ? ny - 1 : ny;
	if (denomX <= 0 || denomY <= 0)
		throw new Error('Invalid nx/ny or inclusive option leading to non-positive denominator');

	const dx = lonRange / denomX;
	const dy = latRange / denomY;

	const result: RegularGridData = {
		type: 'regular',
		nx,
		ny,
		lonMin: bbox.lonMin,
		latMin: bbox.latMin,
		dx,
		dy
	};
	return result;
}
