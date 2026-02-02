import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const domains = [
	'cams_europe',
	'cams_global',
	'cams_global_greenhouse_gases',
	'cma_grapes_global',
	'cmc_gem_gdps',
	'cmc_gem_geps',
	'cmc_gem_hrdps',
	'cmc_gem_hrdps_west',
	'cmc_gem_rdps',
	'dmi_harmonie_arome_europe',
	'dwd_ewam',
	'dwd_gwam',
	'dwd_icon',
	'dwd_icon_d2',
	'dwd_icon_d2_eps',
	'dwd_icon_eps',
	'dwd_icon_eu',
	'dwd_icon_eu_eps',
	'ecmwf_aifs025_ensemble',
	'ecmwf_aifs025_single',
	'ecmwf_ec46',
	'ecmwf_ec46_ensemble_mean',
	'ecmwf_ec46_weekly',
	'ecmwf_ifs',
	'ecmwf_ifs025',
	'ecmwf_ifs025_ensemble',
	'ecmwf_wam',
	'ecmwf_wam025',
	'italia_meteo_arpae_icon_2i',
	'jma_gsm',
	'jma_msm',
	'jma_msm_upper_level',
	'kma_gdps',
	'knmi_harmonie_arome_europe',
	'knmi_harmonie_arome_netherlands',
	'meteofrance_arome_france0025',
	'meteofrance_arome_france0025_15min',
	'meteofrance_arome_france_hd',
	'meteofrance_arome_france_hd_15min',
	'meteofrance_arpege_europe',
	'meteofrance_arpege_world025',
	'meteofrance_currents',
	'meteofrance_sea_surface_temperature',
	'meteofrance_wave',
	'meteoswiss_icon_ch1',
	'meteoswiss_icon_ch1_ensemble',
	'meteoswiss_icon_ch2',
	'meteoswiss_icon_ch2_ensemble',
	'metno_nordic_pp',
	'ncep_aigfs025',
	'ncep_gefs025',
	'ncep_gefs05',
	'ncep_gfs013',
	'ncep_gfs025',
	'ncep_gfs_graphcast025',
	'ncep_gfswave016',
	'ncep_gfswave025',
	'ncep_hgefs025_ensemble_mean',
	'ncep_hrrr_conus',
	'ncep_hrrr_conus_15min',
	'ncep_nam_conus',
	'ncep_nbm_conus',
	'ukmo_global_deterministic_10km',
	'ukmo_uk_deterministic_2km'
];

function fetchJson(url) {
	return new Promise((resolve, reject) => {
		https
			.get(url, (res) => {
				let data = '';
				res.on('data', (chunk) => (data += chunk));
				res.on('end', () => {
					try {
						resolve(JSON.parse(data));
					} catch (e) {
						reject(e);
					}
				});
			})
			.on('error', reject);
	});
}

function getBaseVariables(variables) {
	const base = new Set();
	for (const v of variables) {
		// Match pressure levels (e.g., _10hPa, _500hPa) or height levels (e.g., _10m, _100m)
		const match = v.match(/^(.+?)(_\d+hPa|_\d+m)$/);
		if (match) {
			base.add(match[1]);
		} else {
			base.add(v);
		}
	}
	return Array.from(base).sort();
}

async function checkVariables() {
	const allVariables = new Set();
	const domainVariableMap = {};
	let successCount = 0;
	let failCount = 0;

	console.log('Fetching variables from all domains...\n');

	for (const domain of domains) {
		const url = `https://openmeteo.s3.amazonaws.com/data_spatial/${domain}/latest.json`;
		try {
			const data = await fetchJson(url);
			// Variables are an array, not an object
			const variables = Array.isArray(data.variables)
				? data.variables
				: Object.keys(data.variables || {});
			const baseVariables = getBaseVariables(variables);
			domainVariableMap[domain] = baseVariables;
			baseVariables.forEach((v) => allVariables.add(v));
			console.log(`✓ ${domain}: ${baseVariables.length} unique base variables`);
			successCount++;
		} catch (e) {
			console.log(`✗ ${domain}: Error - ${e.message}`);
			failCount++;
		}
	}

	console.log(`\n=== Summary ===`);
	console.log(`Successfully fetched: ${successCount}/${domains.length}`);
	console.log(`Failed: ${failCount}/${domains.length}`);

	const sorted = Array.from(allVariables).sort();
	console.log(`\nTotal unique base variables found: ${sorted.length}\n`);

	// Write to file
	const outputPath = path.join(__dirname, 'all_variables.json');
	const output = {
		timestamp: new Date().toISOString(),
		totalCount: sorted.length,
		variables: sorted,
		domainVariables: domainVariableMap
	};

	fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
	console.log(`\n✓ Variables saved to: ${outputPath}`);
	console.log(`\nVariables list:`);
	sorted.forEach((v) => console.log(`  "${v}",`));
}

checkVariables().catch(console.error);
