// ISA / barometric constants
const ISA = {
	p0_hPa: 1013.25, // reference pressure in hPa
	t0: 288.15, // sea-level standard temperature (K)
	lapse: 0.0065, // temperature lapse rate (K/m)
	gasConstant: 287.05, // specific gas constant for dry air (J/(kg·K))
	g0: 9.80665 // gravity (m/s^2)
};

/* Tropopause / lower stratosphere constants (ISA standard) */
const P_TROPOPAUSE = 226.32; // hPa (pressure at ~11 km)
const H_TROPOPAUSE = 11000; // m  (height of tropopause ~11 km)
const T_TROPOPAUSE = 216.65; // K  (temperature in lower stratosphere)

export const pressureHpaToIsaHeight = (hpa: number): number => {
	if (!isFinite(hpa) || hpa <= 0) return NaN;

	// Use troposphere formula for pressures >= tropopause pressure; otherwise use isothermal stratosphere formula.
	return hpa >= P_TROPOPAUSE
		? troposphereHeightFromPressure(hpa)
		: stratosphereHeightFromPressure(hpa);
};

const troposphereHeightFromPressure = (hpa: number): number => {
	const { p0_hPa, t0, lapse, gasConstant, g0 } = ISA;
	const r = hpa / p0_hPa;
	const exponent = (gasConstant * lapse) / g0; // dimensionless (~0.1903)
	// H = (T0 / L) * (1 - r^exponent)
	return (t0 / lapse) * (1 - Math.pow(r, exponent));
};

const stratosphereHeightFromPressure = (hpa: number): number => {
	// H = H_tropopause + (R * T_tropopause / g0) * ln(P_tropopause / P)
	return H_TROPOPAUSE + ((ISA.gasConstant * T_TROPOPAUSE) / ISA.g0) * Math.log(P_TROPOPAUSE / hpa);
};
