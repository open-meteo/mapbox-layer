import { domainOptions } from '../domains';
import { closestModelRun, domainStep, domainStepHours } from '../utils/model-runs';
import { describe, expect, test } from 'vitest';

describe('domainStep', () => {
	test('hourly nearest does not leave time unchanged', () => {
		const t = new Date(Date.UTC(2024, 0, 1, 5, 10, 20));
		const out = domainStep(t, 'hourly', 'floor');
		expect(out.toISOString()).toBe('2024-01-01T05:00:00.000Z');
	});

	test('hourly forward increments hour', () => {
		const t = new Date(Date.UTC(2024, 0, 1, 23, 0, 0));
		const out = domainStep(t, 'hourly', 'forward');
		expect(out.toISOString()).toBe('2024-01-02T00:00:00.000Z');
	});

	test('3_hourly rounds to multiples of 3', () => {
		const t = new Date(Date.UTC(2024, 0, 1, 5, 0, 0));
		expect(domainStep(t, '3_hourly', 'floor').getUTCHours() % 3).toBe(0);
	});

	test('weekly_on_monday behavior on Monday for directions', () => {
		// Monday 2025-12-01 (UTC) 12:00
		const monday = new Date(Date.UTC(2025, 11, 1, 12));
		const tuesday = new Date(Date.UTC(2025, 11, 2, 12));

		const flooredMonday = domainStep(monday, 'weekly_on_monday', 'floor');
		expect(flooredMonday.toISOString()).toBe('2025-12-01T00:00:00.000Z');
		const flooredTuesday = domainStep(tuesday, 'weekly_on_monday', 'floor');
		expect(flooredTuesday.toISOString()).toBe('2025-12-01T00:00:00.000Z');

		// forward from Monday should give next Monday
		const forwardMonday = domainStep(monday, 'weekly_on_monday', 'forward');
		expect(forwardMonday.toISOString()).toBe('2025-12-08T00:00:00.000Z');
		const forwardTuesday = domainStep(tuesday, 'weekly_on_monday', 'forward');
		expect(forwardTuesday.toISOString()).toBe('2025-12-08T00:00:00.000Z');

		// backward from Monday -> previous Monday
		const backwardMonday = domainStep(monday, 'weekly_on_monday', 'backward');
		expect(backwardMonday.toISOString()).toBe('2025-11-24T00:00:00.000Z');
		const backwardTuesday = domainStep(tuesday, 'weekly_on_monday', 'backward');
		expect(backwardTuesday.toISOString()).toBe('2025-12-01T00:00:00.000Z');
	});

	test('monthly forward across month length boundaries (Jan 31 -> behaviour is JS Date overflow)', () => {
		const t = new Date(Date.UTC(2024, 0, 31, 10));
		const out = domainStep(t, 'monthly', 'forward');
		expect(out.toISOString()).toBe('2024-03-01T00:00:00.000Z');
	});

	test('throws on invalid interval', () => {
		// @ts-expect-error: invalid interval throws
		expect(() => domainStep(new Date(), 'not_a_interval')).toThrow();
	});
});

describe('closestModelRun', () => {
	test('hourly truncates minutes/seconds', () => {
		const t = new Date(Date.UTC(2024, 0, 1, 5, 30, 45, 123));
		const out = closestModelRun(t, 'hourly');
		expect(out.toISOString()).toBe('2024-01-01T05:00:00.000Z');
	});

	test('3_hourly rounds down', () => {
		const t = new Date(Date.UTC(2024, 0, 1, 5, 30));
		const out = closestModelRun(t, '3_hourly');
		expect(out.toISOString()).toBe('2024-01-01T03:00:00.000Z');
	});

	test('daily returns midnight UTC', () => {
		const t = new Date(Date.UTC(2024, 0, 2, 13));
		const out = closestModelRun(t, 'daily');
		expect(out.toISOString()).toBe('2024-01-02T00:00:00.000Z');
	});

	test('monthly sets day to 1', () => {
		const t = new Date(Date.UTC(2024, 6, 15, 9));
		const out = closestModelRun(t, 'monthly');
		expect(out.toISOString()).toBe('2024-07-01T00:00:00.000Z');
	});

	test('throws on invalid model interval', () => {
		// @ts-expect-error: invalid interval throws
		expect(() => closestModelRun(new Date(), 'invalid')).toThrow();
	});

	test('does not mutate original date', () => {
		const t = new Date(Date.UTC(2024, 0, 1, 5, 30));
		const copy = new Date(t);
		closestModelRun(t, '3_hourly');
		expect(t.getTime()).toBe(copy.getTime());
	});
});

describe('domainStepHours', () => {
	test('is the base interval without a schedule', () => {
		expect(domainStepHours({ time_interval: 'hourly' }, 5)).toBe(1);
		expect(domainStepHours({ time_interval: '15_minute' }, 0.25)).toBe(0.25);
		expect(domainStepHours({ time_interval: '6_hourly' }, 12)).toBe(6);
	});

	test('follows the schedule, each entry from its lead time on', () => {
		const gfs = {
			time_interval: 'hourly' as const,
			time_steps: [
				{ fromHours: 0, hours: 1 },
				{ fromHours: 120, hours: 3 }
			]
		};
		expect(domainStepHours(gfs, 1)).toBe(1);
		// The step ending at the switch is still the finer one
		expect(domainStepHours(gfs, 120)).toBe(1);
		expect(domainStepHours(gfs, 123)).toBe(3);

		const ukmo = {
			time_interval: 'hourly' as const,
			time_steps: [
				{ fromHours: 0, hours: 1 },
				{ fromHours: 54, hours: 3 },
				{ fromHours: 144, hours: 6 }
			]
		};
		expect(domainStepHours(ukmo, 57)).toBe(3);
		expect(domainStepHours(ukmo, 150)).toBe(6);
	});

	test('lets the schedule override a base interval the files do not follow, also before the run', () => {
		const gefs = { time_interval: '6_hourly' as const, time_steps: [{ fromHours: 0, hours: 3 }] };
		expect(domainStepHours(gefs, 3)).toBe(3);
		// MF wave files start 21 h before the run
		const wave = { time_interval: 'hourly' as const, time_steps: [{ fromHours: 0, hours: 3 }] };
		expect(domainStepHours(wave, -18)).toBe(3);
	});

	test('reaches back to the previous grid time in a phase aligned to UTC hours', () => {
		// NBM: hourly to 36 h, then 3-hourly files on 00/03/06... UTC beyond 36 h,
		// 6-hourly on 00/06/12/18 UTC beyond 186 h
		const nbm = {
			time_interval: 'hourly' as const,
			time_steps: [
				{ fromHours: 0, hours: 1 },
				{ fromHours: 36, hours: 3, aligned: true },
				{ fromHours: 186, hours: 6, aligned: true }
			]
		};
		const at = (run: string, lead: number) =>
			domainStepHours(nbm, lead, new Date(Date.parse(run) + lead * 3_600_000));
		// 10Z run: the last hourly file at 22Z (36 h), the first 3-hourly one at 00Z
		expect(at('2026-10-15T10:00Z', 36)).toBe(1);
		expect(at('2026-10-15T10:00Z', 38)).toBe(2);
		expect(at('2026-10-15T10:00Z', 41)).toBe(3);
		// 09Z run: 36 h lands on the grid (21Z), so the first 3-hourly step is a full one
		expect(at('2026-10-15T09:00Z', 39)).toBe(3);
		// 11Z run: 06Z at 187 h opens the 6-hourly phase, its own step still 3 h from 03Z
		expect(at('2026-10-15T11:00Z', 187)).toBe(3);
		expect(at('2026-10-15T11:00Z', 193)).toBe(6);
		// 12Z run: the 3-hourly files run on to 12Z at 192 h, which opens the phase
		expect(at('2026-10-15T12:00Z', 189)).toBe(3);
		expect(at('2026-10-15T12:00Z', 192)).toBe(3);
		expect(at('2026-10-15T12:00Z', 198)).toBe(6);
		// Without the valid time an aligned phase answers its nominal length
		expect(domainStepHours(nbm, 41)).toBe(3);
	});

	test('has no fixed length for weekly and monthly intervals', () => {
		expect(domainStepHours({ time_interval: 'weekly_on_monday' }, 96)).toBeUndefined();
		expect(domainStepHours({ time_interval: 'monthly' }, 0)).toBeUndefined();
	});

	test('keeps the schedules of the domain table in lead-time order, starting at 0 and growing coarser', () => {
		for (const domain of domainOptions) {
			const steps = domain.time_steps ?? [];
			if (steps.length === 0) continue;
			expect(steps[0].fromHours, domain.value).toBe(0);
			for (let i = 1; i < steps.length; i++) {
				expect(steps[i].fromHours, domain.value).toBeGreaterThan(steps[i - 1].fromHours);
				expect(steps[i].hours, domain.value).toBeGreaterThan(steps[i - 1].hours);
			}
		}
	});
});
