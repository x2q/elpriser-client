/**
 * Local-time arithmetic without a date library.
 *
 * Instants are `Date` objects (or epoch milliseconds internally). The wall clock of a
 * zone is derived with `Intl.DateTimeFormat` and the zone's IANA time zone name, which
 * every supported runtime (Node >= 18, browsers, Deno, Bun, Cloudflare Workers) ships
 * with its own tz database. A "local date" is a plain `'YYYY-MM-DD'` string; there is
 * no local `Date` type, so nothing here depends on the host machine's own time zone.
 */

import { ElpriserError, InvalidArgumentError } from './errors.js';

export const HOUR_MS = 3_600_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (fmt === undefined) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (cause) {
      throw new ElpriserError(`this runtime does not know the time zone ${timeZone}`, { cause });
    }
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

/** Offset of `timeZone` from UTC at the instant `ms`, in minutes (CET = 60, CEST = 120). */
export function offsetMinutes(timeZone: string, ms: number): number {
  const seconds = Math.floor(ms / 1000);
  const parts = formatter(timeZone).formatToParts(seconds * 1000);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  const hour = get('hour') % 24; // some engines print midnight as 24
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return Math.round((asUtc - seconds * 1000) / 60_000);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `true` when `value` is a real calendar date written `YYYY-MM-DD`. */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d;
}

function dateParts(value: string): [number, number, number] {
  const m = DATE_RE.exec(value);
  if (m === null) throw new InvalidArgumentError(`date must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The local date `days` after (or before, when negative) `date`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = dateParts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The instant (epoch ms) at which local midnight of `date` happens in `timeZone`. */
export function localMidnight(date: string, timeZone: string): number {
  const [y, m, d] = dateParts(date);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes: the offset at the guess may differ from the offset at the real instant.
  const first = guess - offsetMinutes(timeZone, guess) * 60_000;
  return guess - offsetMinutes(timeZone, first) * 60_000;
}

/**
 * Start (epoch ms, UTC) of every hour of the local calendar day: 23, 24 or 25 of
 * them, depending on daylight saving.
 */
export function localDayStarts(date: string, timeZone: string): number[] {
  const start = localMidnight(date, timeZone);
  const end = localMidnight(addDays(date, 1), timeZone);
  const count = Math.round((end - start) / HOUR_MS);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(start + i * HOUR_MS);
  return out;
}

/** The wall clock of one instant in a zone. */
export interface LocalParts {
  /** Local hour 0-23 (the doubled hour of a 25-hour day appears twice). */
  readonly hour: number;
  /** Local calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  /** Offset from UTC in minutes. */
  readonly offsetMinutes: number;
  /** ISO 8601 local time with offset, e.g. `2026-11-03T08:00:00+01:00`. */
  readonly iso: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The local hour, date and ISO string (with UTC offset) of the instant `ms` in `timeZone`. */
export function localParts(timeZone: string, ms: number): LocalParts {
  const offset = offsetMinutes(timeZone, ms);
  const shifted = new Date(ms + offset * 60_000).toISOString(); // fields are the wall clock
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return {
    hour: Number(shifted.slice(11, 13)),
    date: shifted.slice(0, 10),
    offsetMinutes: offset,
    iso: `${shifted.slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
  };
}

/** The local calendar date of the instant `ms` in `timeZone`. */
export function localDateOf(timeZone: string, ms: number): string {
  return localParts(timeZone, ms).date;
}

/** Floor an instant to the start of its UTC hour (all supported zones have whole-hour offsets). */
export function floorHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/** Validate a `Date` argument and return its epoch milliseconds. */
export function instant(value: Date | undefined, name: string): number {
  if (value === undefined) return Date.now();
  if (typeof value !== 'object' || value === null || typeof value.getTime !== 'function' || Number.isNaN(value.getTime())) {
    throw new InvalidArgumentError(`${name} must be a valid Date`);
  }
  return value.getTime();
}
