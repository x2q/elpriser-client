/**
 * Request planning, argument validation, HTTP status -> error mapping and the retry policy.
 * No I/O happens here.
 */

import {
  ApiError,
  BadRequestError,
  InvalidArgumentError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from './errors.js';
import { MODES, STRATEGIES, modeNeedsGln } from './models.js';
import type { Area, DkNow, DkPrices, DkSchedule, PriceMode, Strategy, Supplier, TariffDays } from './models.js';
import * as parse from './parse.js';
import type { Series } from './series.js';
import { isLocalDate } from './time.js';
import { ZONES, parseZone } from './zones.js';
import type { Zone, ZoneInput } from './zones.js';

export const DEFAULT_BASE_URL = 'https://elpriser.org';
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_BACKOFF_MS = 500;
export const MAX_RETRY_DELAY_MS = 30_000;
export const RETRY_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/** A request and how to read the answer. */
export interface Plan<T> {
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly parse: (payload: unknown) => T;
}

// -- validation ---------------------------------------------------------------

export function validateBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== 'string' || !/^https?:\/\/[^/?#\s]+/i.test(baseUrl)) {
    throw new InvalidArgumentError(`baseUrl must be an http(s) URL, got ${JSON.stringify(baseUrl)}`);
  }
  return baseUrl.replace(/\/+$/, '');
}

export function checkOptions(timeoutMs: number, retries: number, backoffMs: number): void {
  if (typeof timeoutMs !== 'number' || !(timeoutMs > 0)) throw new InvalidArgumentError('timeoutMs must be > 0');
  if (!Number.isInteger(retries) || retries < 0) throw new InvalidArgumentError('retries must be an integer >= 0');
  if (typeof backoffMs !== 'number' || !(backoffMs >= 0)) throw new InvalidArgumentError('backoffMs must be >= 0');
}

/** Validate a Danish price mode (default `inkl_alt`) and its `gln` requirement. */
export function toMode(mode: string | undefined, gln: string | undefined): PriceMode {
  const chosen = mode === undefined ? 'inkl_alt' : mode;
  if (!(MODES as readonly string[]).includes(chosen)) {
    throw new InvalidArgumentError(`unknown mode ${JSON.stringify(mode)}; valid modes: ${MODES.join(', ')}`);
  }
  const m = chosen as PriceMode;
  if (modeNeedsGln(m) && !gln) {
    throw new InvalidArgumentError(`mode '${m}' needs gln - the grid tariff depends on the network company`);
  }
  return m;
}

export function toArea(area: string): Area {
  const text = typeof area === 'string' ? area.trim().toUpperCase() : '';
  if (text !== 'DK1' && text !== 'DK2') {
    throw new InvalidArgumentError(`area must be DK1 or DK2, got ${JSON.stringify(area)}`);
  }
  return text;
}

export function toDateStr(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!isLocalDate(value)) throw new InvalidArgumentError(`date must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  return value;
}

function bounded(name: string, value: number | undefined, lo: number, hi: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < lo || value > hi) {
    throw new InvalidArgumentError(`${name} must be an integer ${lo}..${hi}, got ${String(value)}`);
  }
  return String(value);
}

// -- planning -------------------------------------------------------------------

export interface ScheduleOptions {
  mode?: PriceMode | undefined;
  gln?: string | undefined;
  strategy?: Strategy | undefined;
  hours?: number | undefined;
  pct?: number | undefined;
  maxOff?: number | undefined;
}

/**
 * What to call to get a zone's `Series`. Danish zones default to `/api/forecast` (DKK/kWh incl.
 * tariffs, `mode`), every other zone, and any zone with `feed: true`, to `/api/nordic`
 * (EUR/MWh + ECB rate).
 */
export function planSeries(zone: ZoneInput, mode: string | undefined, gln: string | undefined, feed: boolean): Plan<Series> {
  const z: Zone = parseZone(zone);
  const area = ZONES[z].area;
  if (area !== null && !feed) {
    const chosen = toMode(mode, gln);
    const params: Record<string, string> = { area, mode: chosen };
    if (gln) params['gln'] = gln;
    return { path: '/api/forecast', params, parse: (p) => parse.parseDkForecast(p, z, chosen, gln ?? null) };
  }
  if (mode !== undefined || gln) {
    throw new InvalidArgumentError(
      `mode and gln only apply to the Danish tariff-aware feed (dk1/dk2, not zoneFeed()); ${z} has plain spot prices`,
    );
  }
  return { path: '/api/nordic', params: { zone: z }, parse: (p) => parse.parseZoneFeed(p, z) };
}

function scheduleParams(params: Record<string, string>, o: ScheduleOptions): void {
  if (o.gln) params['gln'] = o.gln;
  if (o.strategy !== undefined) {
    if (!(STRATEGIES as readonly string[]).includes(o.strategy)) {
      throw new InvalidArgumentError(
        `unknown strategy ${JSON.stringify(o.strategy)}; valid strategies: ${STRATEGIES.join(', ')}`,
      );
    }
    params['strategy'] = o.strategy;
  }
  const checked: Array<[string, string | undefined]> = [
    ['hours', bounded('hours', o.hours, 1, 23)],
    ['pct', bounded('pct', o.pct, 1, 100)],
    ['max_off', bounded('maxOff', o.maxOff, 1, 12)],
  ];
  for (const [name, value] of checked) if (value !== undefined) params[name] = value;
}

export function planDkNow(area: string, o: ScheduleOptions): Plan<DkNow> {
  const params: Record<string, string> = { area: toArea(area), mode: toMode(o.mode, o.gln) };
  scheduleParams(params, o);
  return { path: '/api/now', params, parse: parse.parseDkNow };
}

export function planDkSchedule(area: string, o: ScheduleOptions & { date?: string | undefined }): Plan<DkSchedule> {
  const params: Record<string, string> = { area: toArea(area), mode: toMode(o.mode, o.gln) };
  scheduleParams(params, o);
  const day = toDateStr(o.date);
  if (day !== undefined) params['date'] = day;
  return { path: '/api/schedule', params, parse: parse.parseDkSchedule };
}

export function planDkPrices(
  area: string,
  o: { date?: string | undefined; mode?: PriceMode | undefined; gln?: string | undefined; charges?: 'historical' | 'current' | undefined },
): Plan<DkPrices> {
  const params: Record<string, string> = { area: toArea(area), mode: toMode(o.mode, o.gln) };
  if (o.gln) params['gln'] = o.gln;
  const day = toDateStr(o.date);
  if (day !== undefined) params['date'] = day;
  if (o.charges !== undefined) {
    if (o.charges !== 'historical' && o.charges !== 'current') {
      throw new InvalidArgumentError("charges must be 'historical' or 'current'");
    }
    params['charges'] = o.charges;
  }
  return { path: '/api/prices', params, parse: parse.parseDkPrices };
}

export function planShellyTariff(area: string, o: { mode?: PriceMode | undefined; gln?: string | undefined }): Plan<TariffDays> {
  const params: Record<string, string> = { area: toArea(area), mode: toMode(o.mode, o.gln) };
  if (o.gln) params['gln'] = o.gln;
  return { path: '/api/shelly/tariff', params, parse: parse.parseShellyTariff };
}

export function planSupplier(lat: number, lng: number): Plan<Supplier> {
  for (const [name, value, bound] of [
    ['lat', lat, 90],
    ['lng', lng, 180],
  ] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < -bound || value > bound) {
      throw new InvalidArgumentError(`${name} must be a number within +-${bound}, got ${String(value)}`);
    }
  }
  return { path: '/api/supplierlookup', params: { lat: String(lat), lng: String(lng) }, parse: parse.parseSupplier };
}

// -- URLs -------------------------------------------------------------------------

export function buildUrl(baseUrl: string, path: string, params: Readonly<Record<string, string>>): string {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${baseUrl}${path}${query ? `?${query}` : ''}`;
}

// -- responses --------------------------------------------------------------------

/** `Retry-After` in seconds: a number of seconds or an HTTP date. `null` when absent or unusable. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (text === '') return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.max(0, (at - now) / 1000);
}

/** Decode a body the way the error classes report it: JSON when it parses, else the raw text. */
function decodeBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(body: unknown): string {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const message = (body as Record<string, unknown>)['error'];
    if (typeof message === 'string') return message;
  }
  if (typeof body === 'string') {
    const text = body.trim();
    return text === '' ? 'no message' : text.slice(0, 200);
  }
  return 'no message';
}

/** The exception for a non-2xx response. */
export function errorFor(status: number, rawBody: string, retryAfterHeader: string | null, url: string): ApiError {
  const body = decodeBody(rawBody);
  const message = `HTTP ${status} from ${url}: ${errorText(body)}`;
  const init = { status, url, body, retryAfter: parseRetryAfter(retryAfterHeader) };
  if (status === 400) return new BadRequestError(message, init);
  if (status === 404) return new NotFoundError(message, init);
  if (status === 429) return new RateLimitError(message, init);
  if (status >= 500) return new ServerError(message, init);
  return new ApiError(message, init);
}

/** Milliseconds to wait before retry number `attempt` (0-based): `Retry-After` if sent, else exponential backoff; capped. */
export function retryDelayMs(attempt: number, backoffMs: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) return Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS);
  return Math.min(backoffMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
}
