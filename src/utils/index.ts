import type { ModelDt, ModelUpdateInterval } from '../types';

export const pad = (n: string | number) => {
	return ('0' + n).slice(-2);
};

export const capitalize = (s: string) => {
	return String(s[0]).toUpperCase() + String(s).slice(1);
};

/**
 * Computes the next/previous/nearest time step for a model domain using UTC.
 * `timeInterval` must be one of:
 * - '15_minute', 'hourly', '3_hourly', '6_hourly', 'weekly_on_monday', 'monthly'
 * @param time
 * @param timeInterval
 * @param direction
 * @returns
 */
export const domainStep = (
	time: Date,
	timeInterval: ModelDt,
	direction: 'forward' | 'backward' | 'nearest' = 'nearest'
): Date => {
	const newTime = new Date(time);
	const operator = direction === 'nearest' ? 0 : direction === 'forward' ? 1 : -1;
	switch (timeInterval) {
		case '15_minute':
			newTime.setUTCMinutes(Math.floor(time.getUTCMinutes() / 15) * 15 + operator * 15);
			break;
		case 'hourly':
			newTime.setUTCHours(time.getUTCHours() + operator);
			break;
		case '3_hourly':
			newTime.setUTCHours(Math.floor(time.getUTCHours() / 3) * 3 + operator * 3);
			break;
		case '6_hourly':
			newTime.setUTCHours(Math.floor(time.getUTCHours() / 6) * 6 + operator * 6);
			break;
		case 'weekly_on_monday': {
			const dayOfWeek = newTime.getUTCDay();
			const nextMondayInDays = (8 - dayOfWeek) % 7;
			switch (direction) {
				case 'nearest':
					newTime.setUTCDate(time.getUTCDate() + nextMondayInDays);
					break;
				case 'backward':
					newTime.setUTCDate(time.getUTCDate() + nextMondayInDays - 7);
					break;
				case 'forward':
					if (nextMondayInDays === 0) {
						newTime.setUTCDate(time.getUTCDate() + 7);
					} else {
						newTime.setUTCDate(time.getUTCDate() + nextMondayInDays);
					}
					break;
			}
			newTime.setUTCHours(0);
			break;
		}
		case 'monthly':
			newTime.setUTCMonth(time.getUTCMonth() + operator);
			break;
		default: {
			// This ensures exhaustiveness checking
			const _exhaustive: never = timeInterval;
			throw new Error(`Invalid time interval: ${timeInterval}`);
		}
	}
	return newTime;
};

export const closestModelRun = (time: Date, modelInterval: ModelUpdateInterval): Date => {
	const newTime = new Date(time);

	let hours: number;
	switch (modelInterval) {
		case 'hourly':
			hours = time.getUTCHours();
			break;
		case '3_hourly':
			hours = Math.floor(time.getUTCHours() / 3) * 3;
			break;
		case '6_hourly':
			hours = Math.floor(time.getUTCHours() / 6) * 6;
			break;
		case '12_hourly':
			hours = Math.floor(time.getUTCHours() / 12) * 12;
			break;
		case 'daily':
			hours = 0;
			break;
		case 'monthly':
			newTime.setUTCDate(1);
			hours = 0;
			break;
		default: {
			// This ensures exhaustiveness checking
			const _exhaustive: never = modelInterval;
			throw new Error(`Invalid model interval: ${modelInterval}`);
		}
	}

	newTime.setUTCHours(hours, 0, 0, 0);

	return newTime;
};
