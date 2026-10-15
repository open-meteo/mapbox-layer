import type { Domain, ModelDt, ModelUpdateInterval } from '../types';

/** Hours per interval, for the intervals that are a fixed number of hours. */
const INTERVAL_HOURS: Partial<Record<ModelDt, number>> = {
	'15_minute': 0.25,
	hourly: 1,
	'3_hourly': 3,
	'6_hourly': 6,
	'12_hourly': 12,
	daily: 24
};

/**
 * Length in hours of the time step that ends `leadTimeHours` into a run of
 * `domain`: from its `time_steps` schedule where it has one, else its base
 * interval. A schedule entry covers the steps beginning at its lead time, so
 * the step ending exactly there still has the previous length. A phase
 * aligned to the UTC grid needs the valid time: it opens with the first grid
 * time beyond its lead time, the previous phase's files run on until then,
 * and a step reaches back to the previous grid time or that last file.
 * Undefined for a base interval without a fixed length (weekly, monthly).
 */
export const domainStepHours = (
	domain: Pick<Domain, 'time_interval' | 'time_steps'>,
	leadTimeHours: number,
	validTime?: Date
): number | undefined => {
	const steps = domain.time_steps;
	if (!steps?.length) return INTERVAL_HOURS[domain.time_interval];

	// Times in hours since the epoch; a grid time is a multiple of the phase's
	// step length, `below` the largest multiple under a value
	const validHours = validTime ? validTime.getTime() / 3_600_000 : NaN;
	const runHours = validHours - leadTimeHours;
	const below = (hours: number, grid: number): number => Math.ceil(hours / grid - 1) * grid;
	const openingOf = (phase: (typeof steps)[number]): number =>
		(Math.floor((runHours + phase.fromHours) / phase.hours) + 1) * phase.hours;

	let index = 0;
	for (let i = 1; i < steps.length; i++) {
		const inPhase =
			steps[i].aligned && validTime
				? validHours >= openingOf(steps[i])
				: steps[i].fromHours < leadTimeHours;
		if (inPhase) index = i;
	}
	const phase = steps[index];
	if (!phase.aligned || !validTime || index === 0) return phase.hours;

	const previous = steps[index - 1];
	const start = runHours + phase.fromHours;
	const lastOfPrevious = previous.aligned
		? below(openingOf(phase), previous.hours)
		: start - ((start - runHours - previous.fromHours) % previous.hours);
	return validHours - Math.max(below(validHours, phase.hours), lastOfPrevious);
};

/**
 * Computes the next/previous/nearest time step for a model domain using UTC.
 * `timeInterval` must be one of:
 * - '15_minute', 'hourly', '3_hourly', '6_hourly', 'weekly_on_monday', 'monthly'
 *
 * @param time - source Date (not mutated)
 * @param timeInterval - the time step type (see above)
 * @param direction - 'forward' | 'backward' | 'nearest' (default 'nearest')
 * @returns a new Date adjusted to the requested domain step (UTC-based)
 * @throws Error on invalid timeInterval
 */
export const domainStep = (
	time: Date,
	timeInterval: ModelDt,
	direction: 'forward' | 'backward' | 'floor' = 'floor'
): Date => {
	const newTime = new Date(time);
	const modifier = direction === 'floor' ? 0 : direction === 'forward' ? 1 : -1;
	switch (timeInterval) {
		case '15_minute':
			newTime.setUTCMinutes(Math.floor(time.getUTCMinutes() / 15) * 15 + modifier * 15);
			break;
		case 'hourly':
			newTime.setUTCHours(time.getUTCHours() + modifier, 0, 0, 0);
			break;
		case '3_hourly':
			newTime.setUTCHours(Math.floor(time.getUTCHours() / 3) * 3 + modifier * 3, 0, 0, 0);
			break;
		case '6_hourly':
			newTime.setUTCHours(Math.floor(time.getUTCHours() / 6) * 6 + modifier * 6, 0, 0, 0);
			break;
		case '12_hourly':
			newTime.setUTCHours(Math.floor(time.getUTCHours() / 12) * 12 + modifier * 12, 0, 0, 0);
			break;
		case 'daily':
			newTime.setUTCDate(time.getUTCDate() + modifier);
			newTime.setUTCHours(0, 0, 0, 0);
			break;
		case 'weekly_on_monday': {
			const dayOfWeek = newTime.getUTCDay();
			const nextMondayInDays = (8 - dayOfWeek) % 7;
			switch (direction) {
				case 'backward':
				case 'floor':
					if (nextMondayInDays === 0 && direction === 'floor') {
						newTime.setUTCDate(time.getUTCDate());
					} else {
						newTime.setUTCDate(time.getUTCDate() + nextMondayInDays - 7);
					}
					break;
				case 'forward':
					if (nextMondayInDays === 0) {
						newTime.setUTCDate(time.getUTCDate() + 7);
					} else {
						newTime.setUTCDate(time.getUTCDate() + nextMondayInDays);
					}
					break;
			}
			newTime.setUTCHours(0, 0, 0, 0);
			break;
		}
		case 'monthly':
			newTime.setUTCMonth(time.getUTCMonth() + modifier);
			newTime.setUTCDate(1);
			newTime.setUTCHours(0, 0, 0, 0);
			break;
		default: {
			// This ensures exhaustiveness checking
			const _exhaustive: never = timeInterval;
			throw new Error(`Invalid time interval: ${timeInterval}`);
		}
	}
	return newTime;
};

/**
 * Get the closest model run time rounded down to the model interval, in UTC.
 * Supported model intervals:
 * - 'hourly', '3_hourly', '6_hourly', '12_hourly', 'daily', 'monthly'
 */
export const closestModelRun = (time: Date, modelInterval: ModelUpdateInterval): Date => {
	const modelDtCompatible: ModelDt = modelInterval;
	return domainStep(time, modelDtCompatible, 'floor');
};
