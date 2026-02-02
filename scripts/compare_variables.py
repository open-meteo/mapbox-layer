#!/usr/bin/env python3

import json
import re
import sys
import os
import subprocess

# Extract known variables dynamically from variables.ts
def get_known_variables():
    """Extract all variable values from src/utils/variables.ts, including dynamically generated ones"""
    ts_file = os.path.join(os.path.dirname(__file__), '..', 'src', 'utils', 'variables.ts')
    
    try:
        # Read the TypeScript file to extract explicit variables and arrays
        result = subprocess.run([
            'node', '-e', '''
const fs = require('fs');
const code = fs.readFileSync(%r, 'utf8');

// Extract explicit variables
const matches = code.match(/value: '([^']+)'/g);
const variables = matches.map(m => m.match(/value: '([^']+)'/)[1]);

// Extract pressureLevels array
const pressureLevelsMatch = code.match(/const pressureLevels = \\[(.*?)\\]/s);
const pressureLevels = pressureLevelsMatch ? 
  JSON.parse('[' + pressureLevelsMatch[1] + ']') : [];

// Extract heights array
const heightsMatch = code.match(/const heights = \\[(.*?)\\]/s);
const heights = heightsMatch ? 
  JSON.parse('[' + heightsMatch[1] + ']') : [];

// Generate dynamic variables for pressure levels
const dynamicVars = [];
const pressureLevelGroups = ['cloud_cover', 'geopotential_height', 'relative_humidity', 'temperature', 'vertical_velocity', 'wind', 'wind_u_component', 'wind_v_component', 'wind_speed'];
for (const group of pressureLevelGroups) {
  for (const pl of pressureLevels) {
    dynamicVars.push(`${group}_${pl}hPa`);
  }
}

// Generate dynamic variables for heights
const heightGroups = ['relative_humidity', 'temperature', 'wind', 'wind_u_component', 'wind_v_component', 'wind_speed'];
for (const group of heightGroups) {
  for (const h of heights) {
    dynamicVars.push(`${group}_${h}m`);
  }
}

const result = {
  explicit: variables,
  dynamic: dynamicVars,
  all: [...new Set([...variables, ...dynamicVars])]
};
console.log(JSON.stringify(result));
''' % ts_file.replace("'", "\\'")
        ], capture_output=True, text=True, cwd=os.path.dirname(__file__))
        
        if result.returncode == 0:
            data = json.loads(result.stdout)
            return set(data['all'])
    except Exception as e:
        print(f"Warning: Could not extract variables from TypeScript: {e}", file=sys.stderr)
    
    # Fallback to hardcoded list if extraction fails
    return {
        'aerosol_optical_depth', 'albedo', 'alder_pollen', 'ammonia', 'birch_pollen',
        'boundary_layer_height', 'cape', 'carbon_dioxide', 'carbon_monoxide',
        'categorical_freezing_rain', 'cloud_base', 'cloud_cover', 'cloud_cover_2m',
        'cloud_cover_anomaly', 'cloud_cover_high', 'cloud_cover_low', 'cloud_cover_mean',
        'cloud_cover_mid', 'cloud_top', 'convective_cloud_base', 'convective_cloud_top',
        'convective_inhibition', 'dew_point', 'dew_point_2m', 'dew_point_2m_anomaly',
        'dew_point_2m_mean', 'diffuse_radiation', 'direct_radiation', 'dust',
        'freezing_level_height', 'freezing_rain_probability', 'formaldehyde', 'geopotential_height',
        'glyoxal', 'grass_pollen', 'hail', 'ice_pellets_probability', 'k_index',
        'latent_heat_flux', 'lifted_index', 'lightning_density', 'lightning_potential',
        'methane', 'mugwort_pollen', 'nitrogen_dioxide', 'nitrogen_monoxide',
        'non_methane_volatile_organic_compounds', 'ocean_u_current', 'ocean_v_current',
        'olive_pollen', 'ozone', 'peroxyacyl_nitrates', 'pm10_wildfires', 'pm2_5',
        'pm2_5_total_organic_matter', 'pm10', 'potential_evapotranspiration',
        'precipitation', 'precipitation_anomaly', 'precipitation_anomaly_gt0',
        'precipitation_anomaly_gt10', 'precipitation_anomaly_gt20', 'precipitation_efi',
        'precipitation_mean', 'precipitation_probability', 'precipitation_sot90',
        'precipitation_type', 'pressure_msl', 'pressure_msl_anomaly', 'pressure_msl_mean',
        'ragweed_pollen', 'rain', 'rain_probability', 'relative_humidity', 'residential_elementary_carbon',
        'roughness_length', 'runoff', 'sea_ice_thickness', 'sea_level_height_msl',
        'sea_salt_aerosol', 'sea_surface_temperature', 'sea_surface_temperature_anomaly',
        'sea_surface_temperature_mean', 'secondary_inorganic_aerosol', 'secondary_swell_wave_direction',
        'secondary_swell_wave_height', 'secondary_swell_wave_period', 'sensible_heat_flux',
        'showers', 'showers_mean', 'shortwave_radiation', 'snow', 'snow_depth',
        'snow_depth_water_equivalent', 'snow_depth_water_equivalent_anomaly',
        'snow_depth_water_equivalent_mean', 'snow_density', 'snow_density_anomaly',
        'snow_density_mean', 'snowfall', 'snowfall_height', 'snowfall_probability',
        'snowfall_water_equivalent', 'snowfall_water_equivalent_anomaly',
        'snowfall_water_equivalent_mean', 'soil_moisture', 'soil_moisture_0_to_1cm',
        'soil_moisture_0_to_7cm', 'soil_moisture_0_to_10cm', 'soil_moisture_1_to_3cm',
        'soil_moisture_3_to_9cm', 'soil_moisture_7_to_28cm', 'soil_moisture_9_to_27cm',
        'soil_moisture_10_to_40cm', 'soil_moisture_27_to_81cm', 'soil_moisture_40_to_100cm',
        'soil_moisture_100_to_200cm', 'soil_moisture_100_to_255cm', 'soil_moisture_243_to_729cm',
        'soil_moisture_729_to_2187cm', 'soil_temperature', 'soil_temperature_0cm',
        'soil_temperature_6cm', 'soil_temperature_18cm', 'soil_temperature_54cm',
        'soil_temperature_162cm', 'soil_temperature_486cm', 'soil_temperature_1458cm',
        'soil_temperature_0_to_7cm', 'soil_temperature_0_to_7cm_anomaly', 'soil_temperature_0_to_7cm_mean',
        'soil_temperature_0_to_10cm', 'soil_temperature_7_to_28cm', 'soil_temperature_10_to_40cm',
        'soil_temperature_28_to_100cm', 'soil_temperature_40_to_100cm', 'soil_temperature_100_to_200cm',
        'soil_temperature_100_to_255cm', 'sunshine_duration', 'sunshine_duration_anomaly',
        'sunshine_duration_mean', 'sulphur_dioxide', 'surface_temperature',
        'surface_temperature_anomaly_gt0', 'swell_wave_direction', 'swell_wave_height',
        'swell_wave_peak_period', 'swell_wave_period', 'temperature',
        'temperature_2m_anomaly', 'temperature_2m_anomaly_gt0', 'temperature_2m_anomaly_gt1',
        'temperature_2m_anomaly_gt2', 'temperature_2m_anomaly_ltm0', 'temperature_2m_anomaly_ltm1',
        'temperature_2m_anomaly_ltm2', 'temperature_2m_efi', 'temperature_2m_mean',
        'temperature_2m_min', 'temperature_2m_max', 'temperature_2m_sot10', 'temperature_2m_sot90',
        'temperature_max6h_2m_anomaly', 'temperature_max6h_2m_mean', 'temperature_min6h_2m_anomaly',
        'temperature_min6h_2m_mean', 'tertiary_swell_wave_direction', 'tertiary_swell_wave_height',
        'tertiary_swell_wave_period', 'thunderstorm_probability', 'total_column_integrated_water_vapour',
        'total_column_integrated_water_vapour_anomaly', 'total_column_integrated_water_vapour_mean',
        'total_elementary_carbon', 'updraft', 'uv_index', 'uv_index_clear_sky', 'vertical_velocity',
        'visibility', 'wave_direction', 'wave_height', 'wave_peak_period', 'wave_period',
        'weather_code', 'wind', 'wind_direction', 'wind_gusts', 'wind_gusts_10m', 'wind_speed',
        'wind_u_component', 'wind_u_component_10m_anomaly', 'wind_u_component_10m_mean',
        'wind_u_component_100m_anomaly', 'wind_u_component_100m_mean', 'wind_v_component',
        'wind_v_component_10m_anomaly', 'wind_v_component_10m_mean', 'wind_v_component_100m_anomaly',
        'wind_v_component_100m_mean', 'wind_wave_direction', 'wind_wave_height',
        'wind_wave_peak_period', 'wind_wave_period'
    }

KNOWN_VARIABLES = get_known_variables()

def get_base_variable(var_name):
    """Extract base variable name, removing level suffixes and member indices"""
    # Remove pressure level suffixes (e.g., _500hPa, _1000hPa)
    var_name = re.sub(r'_\d+hPa$', '', var_name)
    # Remove height level suffixes (e.g., _10m, _100m)
    var_name = re.sub(r'_\d+m$', '', var_name)
    # Remove member indices (e.g., _member01, _spread)
    var_name = re.sub(r'_member\d+$', '', var_name)
    var_name = re.sub(r'_spread$', '', var_name)
    return var_name

def main():
    # Load all variables found from the API
    with open('all_variables.json') as f:
        data = json.load(f)
    
    all_api_variables = set(data['variables'])
    
    # Get base variables (without levels/members)
    base_api_variables = set()
    for var in all_api_variables:
        base = get_base_variable(var)
        base_api_variables.add(base)
    
    # Compare
    missing_in_known = base_api_variables - KNOWN_VARIABLES
    not_in_api = KNOWN_VARIABLES - base_api_variables
    
    print(f"=== Variable Comparison ===")
    print(f"Total known variables (hardcoded): {len(KNOWN_VARIABLES)}")
    print(f"Total unique base variables found in API: {len(base_api_variables)}")
    print(f"Total variables found in API (with all levels): {len(all_api_variables)}")
    
    if missing_in_known:
        print(f"\n=== Missing Variables (in API but not in variableOptions) ===")
        print(f"Count: {len(missing_in_known)}\n")
        for var in sorted(missing_in_known):
            print(f'  "{var}",')
    else:
        print(f"\n✓ All base variables from API are in variableOptions")
    
    if not_in_api:
        print(f"\n=== Variables NOT Found in Any Domain ===")
        print(f"Count: {len(not_in_api)}\n")
        for var in sorted(not_in_api):
            print(f'  "{var}",')
    else:
        print(f"\n✓ All variableOptions are present in at least one domain")

if __name__ == '__main__':
    main()
