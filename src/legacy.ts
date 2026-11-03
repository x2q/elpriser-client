/**
 * The 1.0.0 API of `elpriser-client`, unchanged: `createElpriserClient()` and the raw,
 * snake_case result shapes of the Danish endpoints. It keeps working exactly as before.
 * New code should use the {@link Elpriser} class, which covers 40 zones, retries, timeouts,
 * typed errors and the price arithmetic (cheapest hours, best window ...).
 */

import { ApiError } from './errors.js';
import type { Area, ScheduleSlot, Strategy } from './models.js';

/** The part of a `Response` the 1.0.0 client reads. */
export interface LegacyResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** A `fetch` implementation for the 1.0.0 client (for Node < 18 or tests). */
export type LegacyFetch = (input: string, init?: any) => Promise<LegacyResponse>;

/**
 * The price modes the 1.0.0 type listed (6 of the 8 the API accepts; the type is kept exactly as it
 * was, so `Record<Mode, ...>` maps keep compiling). Use `PriceMode` for all 8.
 */
export type Mode =
  | 'spot_ex' // raw spot, no VAT
  | 'spot_inkl' // spot incl. 25% VAT
  | 'inkl_alt' // total incl. tariffs + electricity tax + VAT
  | 'inkl_alt_minus' // total without electricity tax
  | 'net_inkl_alt' // total incl. a specific net company's tariff (needs gln)
  | 'net_inkl_tarif'; // net tariff incl., without electricity tax (needs gln)

export interface ClientOptions {
  /** API base URL. Defaults to https://elpriser.org */
  baseUrl?: string;
  /** Custom fetch implementation (for Node < 18). */
  fetch?: LegacyFetch;
}

export interface NowResult {
  on: boolean;
  price: number | null;
  hour: number;
  area: Area;
  mode: Mode;
  strategy: Strategy;
}

export interface PricePoint {
  hour: number;
  price: number | null;
}

export interface PricesResult {
  area: Area;
  mode: Mode;
  date: string;
  unit: string;
  prices: PricePoint[];
  current_hour: number;
  current_price: number | null;
}

export interface ScheduleResult {
  area: Area;
  mode: Mode;
  strategy: Strategy;
  param: number;
  date: string;
  on_now: boolean;
  schedule: ScheduleSlot[];
}

export interface ForecastDay {
  date: string;
  type: 'actual' | 'forecast';
  weekday: number;
  prices: Array<{ hour: number; price: number | null; min?: number; max?: number }>;
}

export interface ForecastResult {
  area: Area;
  mode: Mode;
  generated: string;
  days: ForecastDay[];
}

export interface SupplierResult {
  address: string | null;
  name: string | null;
  error?: string;
}

export interface NowOptions {
  area?: Area;
  mode?: Mode;
  gln?: string;
  strategy?: Strategy;
  hours?: number;
}
export interface PricesOptions {
  area?: Area;
  mode?: Mode;
  date?: string;
  gln?: string;
}
export interface ScheduleOptions {
  area?: Area;
  mode?: Mode;
  strategy?: Strategy;
  hours?: number;
  pct?: number;
  max_off?: number;
  date?: string;
  gln?: string;
}
export interface ForecastOptions {
  area?: Area;
  mode?: Mode;
}
export interface ShellyTariffOptions {
  area?: Area;
  mode?: Mode;
  gln?: string;
}
export interface SupplierLookupOptions {
  lat: number;
  lng: number;
}

/** @deprecated Use the {@link Elpriser} class. The 1.0.0 client, kept unchanged. */
export interface ElpriserClient {
  now(options?: NowOptions): Promise<NowResult>;
  prices(options?: PricesOptions): Promise<PricesResult>;
  schedule(options?: ScheduleOptions): Promise<ScheduleResult>;
  forecast(options?: ForecastOptions): Promise<ForecastResult>;
  /** Tibber-compatible GraphQL-shaped response. */
  shellyTariff(options?: ShellyTariffOptions): Promise<unknown>;
  supplierLookup(options: SupplierLookupOptions): Promise<SupplierResult>;
}

const DEFAULT_BASE = 'https://elpriser.org';

interface URLSearchParamsLike {
  set(name: string, value: string): void;
  toString(): string;
}

/**
 * The 1.0.0 factory, unchanged: raw API answers, Danish zones only, no retries or timeouts, a
 * plain `Error` (now an {@link ApiError}, which extends `Error` and keeps the message) on a non-2xx.
 *
 * @deprecated Use `new Elpriser()`: it covers 40 zones, retries, timeouts, typed errors and
 * parsed results (see the migration notes in the README). This function keeps working.
 */
export function createElpriserClient(options: ClientOptions = {}): ElpriserClient {
  const base = (options.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const globalFetch = (globalThis as unknown as { fetch?: LegacyFetch }).fetch;
  const doFetch: LegacyFetch | null = options.fetch || (typeof globalFetch !== 'undefined' ? globalFetch : null);
  if (!doFetch) {
    throw new Error('No global fetch available — pass options.fetch (Node < 18).');
  }

  async function get<T>(path: string, params: Record<string, unknown>): Promise<T> {
    const qs = new (globalThis as unknown as { URLSearchParams: new () => URLSearchParamsLike }).URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const q = qs.toString();
    const res = await doFetch!(`${base}${path}${q ? '?' + q : ''}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new ApiError(`elpriser.org API ${res.status} for ${path}`, {
        status: res.status,
        url: `${base}${path}`,
        body: null,
      });
    }
    return (await res.json()) as T;
  }

  return {
    now: (o: NowOptions = {}) => get<NowResult>('/api/now', { area: 'DK1', mode: 'inkl_alt', ...o }),
    prices: (o: PricesOptions = {}) => get<PricesResult>('/api/prices', { area: 'DK1', mode: 'inkl_alt', ...o }),
    schedule: (o: ScheduleOptions = {}) =>
      get<ScheduleResult>('/api/schedule', { area: 'DK1', mode: 'inkl_alt', strategy: 'cheapest_n', ...o }),
    forecast: (o: ForecastOptions = {}) => get<ForecastResult>('/api/forecast', { area: 'DK1', mode: 'inkl_alt', ...o }),
    shellyTariff: (o: ShellyTariffOptions = {}) =>
      get<unknown>('/api/shelly/tariff', { area: 'DK1', mode: 'inkl_alt', ...o }),
    supplierLookup: (o: SupplierLookupOptions) => get<SupplierResult>('/api/supplierlookup', { lat: o.lat, lng: o.lng }),
  };
}

export default createElpriserClient;
