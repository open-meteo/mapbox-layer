import type { ModelDt, ModelUpdateInterval } from '../types';

export const pad = (n: string | number) => {
	return ('0' + n).slice(-2);
};

export function capitalize(s: string) {
	return String(s[0]).toUpperCase() + String(s).slice(1);
}

export const domainStep = (
	time: Date,
	timeInterval: ModelDt,
	direction: 'forward' | 'backward' | 'nearest' = 'nearest'
): Date => {
	const newTime = new Date(time);
	const operator = direction === 'nearest' ? 0 : direction === 'forward' ? 1 : -1;
	switch (timeInterval) {
		case 'hourly':
			newTime.setUTCHours(time.getUTCHours() + operator);
			break;
		case '3hourly':
			newTime.setUTCHours(Math.floor(time.getUTCHours() / 3) * 3 + operator * 3);
			break;
		case '6hourly':
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
		default:
			throw new Error(`Invalid time interval: ${timeInterval}`);
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
		case '3hourly':
			hours = Math.floor(time.getUTCHours() / 3) * 3;
			break;
		case '6hourly':
			hours = Math.floor(time.getUTCHours() / 6) * 6;
			break;
		case '12hourly':
			hours = Math.floor(time.getUTCHours() / 12) * 12;
			break;
		case 'daily':
			hours = 0;
			break;
		case 'monthly':
			newTime.setUTCDate(1);
			hours = 0;
			break;
		default:
			throw new Error(`Invalid model interval: ${modelInterval}`);
	}

	newTime.setUTCHours(hours, 0, 0, 0);

	return newTime;
};
