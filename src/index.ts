/**
 * elpriser-client: typed SDK for the elpriser.org electricity price API.
 *
 * 40 European price zones, current and next hour, today and tomorrow hour by hour, cheapest
 * hours, best window, forecast days (settled vs forecast flagged), price levels, and the Danish
 * tariff-aware endpoints. No API key, no dependencies; uses the global `fetch`.
 *
 * ```ts
 * import { Elpriser } from 'elpriser-client';
 * const client = new Elpriser();
 * const slot = await client.now('de');
 * ```
 *
 * The 1.0.0 `createElpriserClient()` is still exported, unchanged (deprecated).
 *
 * Data: https://elpriser.org. Outside Denmark these are spot prices only (no VAT, duties or grid
 * fees); forecast days are elpriser.org's own model, not an official forecast.
 */

export { Elpriser, DEFAULT_USER_AGENT } from './client.js';
export type {
  AreaInput,
  DkPricesOptions,
  DkScheduleOptions,
  ElpriserOptions,
  RequestOptions,
  SeriesOptions,
} from './client.js';

export { Series } from './series.js';
export type { AtOptions, DayOptions, LatestKnownOptions, NowOptions as SeriesNowOptions, SeriesInit, WindowOptions } from './series.js';

export { ZONES, ZONE_KEYS, isDanish, isZone, parseZone, zoneInfo } from './zones.js';
export type { DanishZone, Zone, ZoneGroup, ZoneInfo, ZoneInput } from './zones.js';

export { MODES, PRICE_LEVELS, STRATEGIES, modeNeedsGln, priceLevels } from './models.js';
export type {
  Area,
  Day,
  DayStats,
  DkNow,
  DkPrices,
  DkSchedule,
  Estimate,
  HourPrice,
  PriceKind,
  PriceLevel,
  PriceMode,
  ScheduleSlot,
  Slot,
  Strategy,
  Supplier,
  TariffDays,
  TariffPrice,
  Window,
} from './models.js';

export {
  ApiError,
  BadRequestError,
  ElpriserError,
  ElpriserNetworkError,
  ElpriserParseError,
  ElpriserTimeoutError,
  InvalidArgumentError,
  NotFoundError,
  RateLimitError,
  ServerError,
  UnknownZoneError,
} from './errors.js';
export type { ApiErrorInit } from './errors.js';

export type { AbortSignalLike, FetchLike, FetchResponseLike } from './runtime.js';

export { VERSION } from './version.js';

// -- 1.0.0 compatibility surface (unchanged, deprecated) ---------------------------------
export { createElpriserClient, default } from './legacy.js';
export type {
  ClientOptions,
  ElpriserClient,
  ForecastDay,
  ForecastOptions,
  ForecastResult,
  Mode,
  NowOptions,
  NowResult,
  PricePoint,
  PricesOptions,
  PricesResult,
  ScheduleOptions,
  ScheduleResult,
  ShellyTariffOptions,
  SupplierLookupOptions,
  SupplierResult,
  LegacyFetch,
} from './legacy.js';
