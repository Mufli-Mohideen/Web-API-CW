/** Sri Lanka local time (UTC+05:30, no daylight saving) for "today" and daily figures. */
export const TIMEZONE = 'Asia/Colombo';
const OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC instant at which the local (Colombo) day containing `at` starts. */
export function localDayStart(at: Date): Date {
  const local = at.getTime() + OFFSET_MS;
  return new Date(local - (local % DAY_MS) - OFFSET_MS);
}

/** Local calendar date (YYYY-MM-DD) of an instant. */
export function localDate(at: Date): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
