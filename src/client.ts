/** The client: one `fetch` per question, with timeouts, retries and typed errors. */

import {
  DEFAULT_BACKOFF_MS,
  DEFAULT_BASE_URL,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  RETRY_STATUSES,
  buildUrl,
  checkOptions,
  errorFor,
  planDkNow,
  planDkPrices,
  planDkSchedule,
  planSeries,
  planShellyTariff,
  planSupplier,
  retryDelayMs,
  validateBaseUrl,
} from './core.js';
import type { Plan } from './core.js';
import {
  ElpriserError,
  ElpriserNetworkError,
  ElpriserParseError,
  ElpriserTimeoutError,
  InvalidArgumentError,
} from './errors.js';
import type {
  Area,
  Day,
  DkNow,
  DkPrices,
  DkSchedule,
  PriceMode,
  PriceLevel,
  Slot,
  Strategy,
  Supplier,
  TariffDays,
  Window,
} from './models.js';
import { defaultSendsUserAgent, deadline, globalFetch, hasGlobalFetch, sleep as defaultSleep } from './runtime.js';
import type { AbortSignalLike, FetchLike } from './runtime.js';
import type { DayOptions, NowOptions, Series, WindowOptions } from './series.js';
import type { DanishZone, ZoneInput } from './zones.js';
import { VERSION } from './version.js';

/** The `User-Agent` sent by default from server runtimes. */
export const DEFAULT_USER_AGENT = `elpriser-client/${VERSION} (+https://elpriser.org)`;

/** Options of the {@link Elpriser} client. */
export interface ElpriserOptions {
  /** API root. Default `https://elpriser.org`. */
  baseUrl?: string;
  /** Replace the HTTP layer (default: the global `fetch`). Called as a plain function. */
  fetch?: FetchLike;
  /** Milliseconds per attempt, connect and read. Default 10 000. */
  timeoutMs?: number;
  /**
   * Extra attempts after a timeout, a network error, 429 or 5xx. Default 2. `Retry-After` is
   * honoured (capped at 30 s), otherwise `backoffMs * 2 ** attempt`.
   */
  retries?: number;
  /** Base delay between retries in milliseconds. Default 500. */
  backoffMs?: number;
  /**
   * `User-Agent` to send. Default: `elpriser-client/<version> (+https://elpriser.org)` where the
   * runtime lets a program set it and a preflight is not a concern (Node, Bun, Deno). In a
   * browser nothing is sent by default (the header is not CORS-safelisted, so setting it would
   * add a preflight request); pass a string to force it, `null` to never send one.
   */
  userAgent?: string | null;
  /** Aborts every request of this client (and pending retries) when it fires. */
  signal?: AbortSignalLike;
  /**
   * Replace the delay between retries (mainly for tests). Receives the milliseconds to wait;
   * must reject if a signal aborts meanwhile.
   */
  sleep?: (ms: number, signals?: readonly AbortSignalLike[]) => Promise<void>;
}

/** Options every call accepts. */
export interface RequestOptions {
  /** Aborts this call (and its pending retries) when it fires. The signal's reason is rethrown. */
  signal?: AbortSignalLike;
}

/** Options of everything that fetches a zone's series. */
export interface SeriesOptions extends RequestOptions {
  /** Danish zones only: which price (`inkl_alt` by default). */
  mode?: PriceMode;
  /** Danish zones only: the grid company's `gln`, required by the `net_*` modes. */
  gln?: string;
}

/** Options of the Danish `/api/now`, `/api/schedule` strategy parameters. */
export interface DkScheduleOptions extends RequestOptions {
  mode?: PriceMode;
  gln?: string;
  strategy?: Strategy;
  /** 1..23, for `cheapest_n` / `avoid_expensive_n`. */
  hours?: number;
  /** 1..100, for the `_pct` strategies. */
  pct?: number;
  /** 1..12: the longest stretch the schedule may be OFF. */
  maxOff?: number;
}

export interface DkPricesOptions extends RequestOptions {
  /** Local Danish date, `YYYY-MM-DD`. Default: today. */
  date?: string;
  mode?: PriceMode;
  gln?: string;
  /** Which tax/tariff rates a past date is priced with. */
  charges?: 'historical' | 'current';
}

/** The area argument of the Danish endpoints. */
export type AreaInput = Area | DanishZone;

/** Client for the elpriser.org API. */
export class Elpriser {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly backoffMs: number;
  /** The `User-Agent` this client sends, or `null` when it sends none. */
  readonly userAgent: string | null;
  readonly #fetch: FetchLike;
  readonly #signal: AbortSignalLike | undefined;
  readonly #sleep: (ms: number, signals?: readonly AbortSignalLike[]) => Promise<void>;

  constructor(options: ElpriserOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = options.retries ?? DEFAULT_RETRIES;
    const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    checkOptions(timeoutMs, retries, backoffMs);
    this.baseUrl = validateBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.backoffMs = backoffMs;
    if (options.fetch === undefined && !hasGlobalFetch()) {
      throw new InvalidArgumentError('No global fetch available: pass options.fetch.');
    }
    this.#fetch = options.fetch ?? globalFetch;
    this.#signal = options.signal;
    this.#sleep = options.sleep ?? defaultSleep;
    this.userAgent =
      options.userAgent === undefined ? (defaultSendsUserAgent() ? DEFAULT_USER_AGENT : null) : options.userAgent;
  }

  toString(): string {
    return `Elpriser(baseUrl=${JSON.stringify(this.baseUrl)})`;
  }

  // -- HTTP -----------------------------------------------------------------

  async #run<T>(plan: Plan<T>, signal: AbortSignalLike | undefined): Promise<T> {
    const url = buildUrl(this.baseUrl, plan.path, plan.params);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.userAgent !== null) headers['User-Agent'] = this.userAgent;
    const external: AbortSignalLike[] = [];
    if (this.#signal !== undefined) external.push(this.#signal);
    if (signal !== undefined) external.push(signal);
    const callerAborted = (): boolean => external.some((s) => s.aborted);

    for (let attempt = 0; ; attempt++) {
      if (callerAborted()) throw (external.find((s) => s.aborted) as AbortSignalLike).reason ?? abortError();
      const limit = deadline(this.timeoutMs, external);
      let failure: ElpriserError;
      let retryAfter: number | null = null;
      try {
        const doFetch = this.#fetch; // called as a plain function: browsers and Workers reject `obj.fetch()`
        const res = await doFetch(url, { method: 'GET', headers, signal: limit.signal });
        const text = await res.text();
        if (RETRY_STATUSES.has(res.status) && attempt < this.retries) {
          const err = errorFor(res.status, text, res.headers.get('retry-after'), url);
          failure = err;
          retryAfter = err.retryAfter;
        } else if (res.status < 200 || res.status >= 300) {
          throw errorFor(res.status, text, res.headers.get('retry-after'), url);
        } else {
          let payload: unknown;
          try {
            payload = JSON.parse(text);
          } catch (cause) {
            throw new ElpriserParseError(`${url} did not return JSON`, { cause });
          }
          return plan.parse(payload);
        }
      } catch (err) {
        if (err instanceof ElpriserError) throw err;
        if (callerAborted()) throw err;
        failure = limit.timedOut()
          ? new ElpriserTimeoutError(`timed out after ${this.timeoutMs}ms: ${url}`, { cause: err })
          : new ElpriserNetworkError(`could not reach ${url}: ${describe(err)}`, { cause: err });
      } finally {
        limit.cleanup();
      }
      if (attempt >= this.retries) throw failure;
      await this.#sleep(retryDelayMs(attempt, this.backoffMs, retryAfter), external);
    }
  }

  /** Escape hatch: `GET` any API path and return the decoded JSON (no parsing). `undefined`/`null` params are left out. */
  async getJson(
    path: string,
    params: Readonly<Record<string, string | number | boolean | null | undefined>> = {},
    options: RequestOptions = {},
  ): Promise<unknown> {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) clean[k] = String(v);
    return this.#run({ path, params: clean, parse: (payload) => payload }, options.signal);
  }

  // -- prices (any of the 40 zones) -------------------------------------------

  /**
   * Fetch a zone's whole price series in one request and return it. Everything else
   * ({@link Elpriser.now}, {@link Elpriser.cheapestHours} ...) is this plus a method on the result:
   * call `series()` once and ask it several questions.
   *
   * - Danish zones (`dk1`/`dk2`): `/api/forecast`, DKK/kWh incl. Energinet's tariffs, electricity
   *   duty and VAT (`mode` default `inkl_alt`; `net_` modes need `gln`), today plus nine forecast days.
   * - Every other zone: `/api/nordic`, the spot price (no VAT, duties or grid fees) in EUR/MWh
   *   converted to the local currency with the ECB rate; settled days plus forecast days (where the
   *   zone has a forecast); `estimate` for `gb`/`pt`/`ie`.
   */
  async series(zone: ZoneInput, options: SeriesOptions = {}): Promise<Series> {
    return this.#run(planSeries(zone, options.mode, options.gln, false), options.signal);
  }

  /** Like {@link Elpriser.series}, but always the plain spot-price feed `/api/nordic`, also for `dk1`/`dk2` (EUR/MWh, no Danish tariffs or taxes). */
  async zoneFeed(zone: ZoneInput, options: RequestOptions = {}): Promise<Series> {
    return this.#run(planSeries(zone, undefined, undefined, true), options.signal);
  }

  /** The price of the current hour, or `null` when this hour has no price (yet). See {@link Series.now}. */
  async now(zone: ZoneInput, options: SeriesOptions & NowOptions = {}): Promise<Slot | null> {
    return (await this.series(zone, options)).now(options);
  }

  /** The price of the next hour (a forecast hour if tomorrow is not published yet). */
  async nextHour(zone: ZoneInput, options: SeriesOptions & NowOptions = {}): Promise<Slot | null> {
    return (await this.series(zone, options)).nextHour(options);
  }

  /** Today's hourly prices in the zone's local day. */
  async today(zone: ZoneInput, options: SeriesOptions & DayOptions = {}): Promise<Slot[]> {
    return (await this.series(zone, options)).today(options);
  }

  /** Tomorrow's hourly prices; `'forecast'` hours until the day-ahead prices are published. */
  async tomorrow(zone: ZoneInput, options: SeriesOptions & DayOptions = {}): Promise<Slot[]> {
    return (await this.series(zone, options)).tomorrow(options);
  }

  /** The `n` cheapest hours (default: within the next 24 h). See {@link Series.cheapestHours}. */
  async cheapestHours(zone: ZoneInput, n: number, options: SeriesOptions & WindowOptions = {}): Promise<Slot[]> {
    return (await this.series(zone, options)).cheapestHours(n, options);
  }

  /** The cheapest run of `hours` consecutive hours. See {@link Series.bestWindow}. */
  async bestWindow(zone: ZoneInput, hours: number, options: SeriesOptions & WindowOptions = {}): Promise<Window | null> {
    return (await this.series(zone, options)).bestWindow(hours, options);
  }

  /**
   * Only the forecast days (`day.kind === 'forecast'`; `day.horizon` where given). The zone feed's
   * forecast is elpriser.org's own statistical model, not an official forecast, and is replaced by
   * the settled price when that is published.
   */
  async forecast(zone: ZoneInput, options: SeriesOptions = {}): Promise<Day[]> {
    return (await this.series(zone, options)).forecastDays;
  }

  /** Today's (or `date`'s) hours with their quintile {@link PriceLevel}. */
  async levels(
    zone: ZoneInput,
    options: SeriesOptions & { date?: string; at?: Date } = {},
  ): Promise<Array<{ slot: Slot; level: PriceLevel }>> {
    return (await this.series(zone, options)).levels(options);
  }

  // -- Denmark-only endpoints (the 1.0.0 client's endpoints) -----------------------

  /** `/api/now`: this hour's DKK/kWh and whether the schedule `strategy` says ON now. */
  async dkNow(area: AreaInput = 'DK1', options: DkScheduleOptions = {}): Promise<DkNow> {
    return this.#run(planDkNow(area, options), options.signal);
  }

  /** `/api/prices`: the 24 hourly prices of one date (default today, Danish time). */
  async dkPrices(area: AreaInput = 'DK1', options: DkPricesOptions = {}): Promise<DkPrices> {
    return this.#run(planDkPrices(area, options), options.signal);
  }

  /** `/api/schedule`: the 24 h ON/OFF plan of a strategy (e.g. `cheapest_n` with `hours: 5`). */
  async dkSchedule(area: AreaInput = 'DK1', options: DkScheduleOptions & { date?: string } = {}): Promise<DkSchedule> {
    return this.#run(planDkSchedule(area, options), options.signal);
  }

  /** `/api/shelly/tariff`: today + tomorrow in Tibber's shape, with the API's own quintile `level`. */
  async shellyTariff(area: AreaInput = 'DK1', options: SeriesOptions = {}): Promise<TariffDays> {
    return this.#run(planShellyTariff(area, options), options.signal);
  }

  /** `/api/supplierlookup`: the Danish grid company (netselskab) at a coordinate. */
  async supplierLookup(lat: number, lng: number, options: RequestOptions = {}): Promise<Supplier> {
    return this.#run(planSupplier(lat, lng), options.signal);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function abortError(): Error {
  const e = new Error('This operation was aborted');
  e.name = 'AbortError';
  return e;
}

