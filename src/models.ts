/**
 * Result types and the price arithmetic that works on them. Nothing here does I/O.
 *
 * Money: `Slot.price` is always **local currency per kWh** (`Series.currency`). For
 * the zone feed (`/api/nordic`) the API publishes EUR/MWh (GBP/MWh for `gb`) plus an
 * ECB rate; `priceMwh` is the number as published and `price = priceMwh * rate / 1000`.
 * For the Danish tariff-aware feed (`/api/forecast`) the API publishes DKK/kWh directly.
 */

/** What a price is. */
export type PriceKind =
  /** Settled day-ahead price (for `gb`: the within-day market index). */
  | 'actual'
  /**
   * elpriser.org's own statistical forecast. NOT an official forecast; it is replaced by
   * the settled price when that is published.
   */
  | 'forecast'
  /**
   * elpriser.org's estimate of an hour of a settled day that has no price yet (`gb`, `pt`,
   * `ie`). Only appears when you ask for it.
   */
  | 'estimate';

/**
 * Quintile rank of an hour among the priced hours of its local day: the cheapest fifth of
 * the day is `VERY_CHEAP` and so on. The same scale and method as the `level` field of
 * `/api/shelly/tariff`.
 */
export type PriceLevel = 'VERY_CHEAP' | 'CHEAP' | 'NORMAL' | 'EXPENSIVE' | 'VERY_EXPENSIVE';

/** All price levels, cheapest first. */
export const PRICE_LEVELS: readonly PriceLevel[] = ['VERY_CHEAP', 'CHEAP', 'NORMAL', 'EXPENSIVE', 'VERY_EXPENSIVE'];

/**
 * Which Danish price `/api/forecast` and friends return (`dk1`/`dk2` only): all 8 modes the API
 * accepts. (The 1.0.0 type `Mode`, which lists only 6 of them, is kept unchanged for the
 * deprecated 1.0.0 client.)
 */
export type PriceMode =
  /** Raw spot price, excluding VAT. */
  | 'spot_ex'
  /** Spot incl. 25 % VAT. */
  | 'spot_inkl'
  /**
   * Spot + Energinet system and transmission tariffs + electricity duty, incl. VAT. Not the
   * local grid tariff (use `net_inkl_alt` + `gln`). The default.
   */
  | 'inkl_alt'
  /** `inkl_alt` with the reduced duty for electric heating. */
  | 'inkl_alt_elvarme'
  /** `inkl_alt` without the electricity duty. */
  | 'inkl_alt_minus'
  /** `inkl_alt` plus a specific grid company's tariff (needs `gln`). */
  | 'net_inkl_alt'
  | 'net_inkl_alt_elvarme'
  /** Grid tariff included but without the electricity duty (needs `gln`). */
  | 'net_inkl_tarif';

/** All modes the API accepts. */
export const MODES: readonly PriceMode[] = [
  'spot_ex',
  'spot_inkl',
  'inkl_alt',
  'inkl_alt_elvarme',
  'inkl_alt_minus',
  'net_inkl_alt',
  'net_inkl_alt_elvarme',
  'net_inkl_tarif',
];

/** Server-side schedule strategies of `/api/schedule` and `/api/now`. */
export type Strategy =
  | 'cheapest_n'
  | 'cheapest_pct'
  | 'avoid_expensive_n'
  | 'avoid_expensive_pct'
  | 'avoid_peak'
  | 'night_cheap'
  | 'smart';

/** All strategies the API accepts. */
export const STRATEGIES: readonly Strategy[] = [
  'cheapest_n',
  'cheapest_pct',
  'avoid_expensive_n',
  'avoid_expensive_pct',
  'avoid_peak',
  'night_cheap',
  'smart',
];

/** The Danish price areas. */
export type Area = 'DK1' | 'DK2';

/** `true` for the modes that need a grid company's `gln` (`net_*`). */
export function modeNeedsGln(mode: PriceMode): boolean {
  return mode.startsWith('net_');
}

/**
 * One hour of price.
 *
 * `start` and `end` are instants (`Date`), so comparing, sorting and subtracting them is
 * always right, also across a daylight-saving change. `hour`, `localDate`, `localStart` and
 * `localEnd` are the zone's own wall clock, which is also what "today" and "tomorrow" mean.
 */
export interface Slot {
  readonly start: Date;
  readonly end: Date;
  /** Local currency per kWh (`Series.currency`); `null` = no price (yet). */
  readonly price: number | null;
  readonly kind: PriceKind;
  /** P10, local currency per kWh. Only on model forecast/estimate hours. */
  readonly min: number | null;
  /** P90, local currency per kWh. Only on model forecast/estimate hours. */
  readonly max: number | null;
  /**
   * The number as the zone feed publishes it (`Series.unit`, e.g. EUR/MWh). `null` on the
   * Danish tariff-aware feed, which is published in DKK/kWh.
   */
  readonly priceMwh: number | null;
  readonly minMwh: number | null;
  readonly maxMwh: number | null;
  /**
   * The local wall-clock hour (0-23), as the API's `hour` field (on a 25-hour day the
   * doubled hour 2 appears twice).
   */
  readonly hour: number;
  /** The local calendar date, `YYYY-MM-DD`. */
  readonly localDate: string;
  /** `start` on the zone's wall clock with its UTC offset, e.g. `2026-11-03T08:00:00+01:00`. */
  readonly localStart: string;
  /** `end` on the zone's wall clock with its UTC offset. */
  readonly localEnd: string;
}

/** One local calendar day as the API delivered it. */
export interface Day {
  /** Local calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  /**
   * `'actual'` for a settled day, `'forecast'` for a model day (`'estimate'` never appears
   * here: estimates are kept apart in `Series.estimate`).
   */
  readonly kind: PriceKind;
  readonly slots: readonly Slot[];
  /**
   * Zone feed, forecast days of EU zones: days after the last settled day + 1 (2-7; `gb`
   * starts at 1).
   */
  readonly horizon: number | null;
  /** Danish feed only: `0` = Sunday .. `6` = Saturday, as the API sends it. */
  readonly weekday: number | null;
  /** Danish feed only: `"model"` or `"heuristic"` (weekday-average fallback) on forecast days. */
  readonly source: string | null;
  /** Danish `net_` modes: `"published"` or `"last_known"`. */
  readonly tariff: string | null;
  /**
   * Danish `net_` modes: the grid company's tariff for each local hour (as the API sends it:
   * DKK/kWh excl. VAT; `null` where it publishes none).
   */
  readonly gridTariff: readonly (number | null)[] | null;
  /** `true` for a model day. */
  readonly isForecast: boolean;
  /** `true` for a settled day. */
  readonly isSettled: boolean;
  /** Every hour of the day has a price. */
  readonly isComplete: boolean;
}

/**
 * The API's top-level `estimate` (`gb`, `pt`, `ie`): elpriser.org's own statistical estimate
 * for hours of a settled day that have no price yet (`gb`: the hours of today that have not
 * traded; `pt`/`ie`: the last local hour, 23). `Series.days` is never changed by it.
 */
export interface Estimate {
  readonly date: string;
  readonly scope: string;
  readonly model: string | null;
  readonly generatedAt: Date | null;
  readonly slots: readonly Slot[];
  readonly method: string | null;
  readonly accuracy: Readonly<Record<string, unknown>> | null;
}

/** Lowest, highest and mean price of a local day. */
export interface DayStats {
  readonly minimum: Slot;
  readonly maximum: Slot;
  /** Mean price per kWh (local currency), rounded to 5 decimals. */
  readonly average: number;
  readonly count: number;
}

/** A run of consecutive hours (see `Series.bestWindow`). */
export interface Window {
  readonly start: Date;
  readonly end: Date;
  readonly slots: readonly Slot[];
  /** Mean price per kWh over the window (local currency). */
  readonly average: number;
  /** Number of hours (`slots.length`). */
  readonly hours: number;
  /** Wall clock of the first hour's start, with UTC offset. */
  readonly localStart: string;
  /** Wall clock of the last hour's end, with UTC offset. */
  readonly localEnd: string;
}

// -- Danish endpoints (as the API returns them) ------------------------------

/** `/api/now`: this hour's price and whether a schedule strategy says ON. */
export interface DkNow {
  readonly on: boolean;
  /** DKK/kWh in the requested mode. */
  readonly price: number | null;
  readonly hour: number;
  readonly area: string;
  readonly mode: string;
  readonly strategy: string;
}

export interface HourPrice {
  readonly hour: number;
  readonly price: number | null;
}

/** `/api/prices` for one date. */
export interface DkPrices {
  readonly area: string;
  readonly mode: string;
  readonly date: string;
  readonly unit: string;
  /** `"historical"` or `"current"`: which tax/tariff rates a past date is priced with. */
  readonly charges: string | null;
  readonly prices: readonly HourPrice[];
  readonly currentHour: number | null;
  readonly currentPrice: number | null;
}

export interface ScheduleSlot {
  hour: number;
  price: number | null;
  on: boolean;
}

/** `/api/schedule`: a 24 h ON/OFF plan for a strategy. */
export interface DkSchedule {
  readonly area: string;
  readonly mode: string;
  readonly strategy: string;
  readonly param: number | null;
  readonly date: string;
  readonly onNow: boolean;
  readonly schedule: readonly ScheduleSlot[];
  /** The hours that are ON. */
  readonly onHours: readonly number[];
}

/** One hour of `/api/shelly/tariff` (Tibber-compatible). */
export interface TariffPrice {
  readonly total: number | null;
  /** The instant `startsAt` denotes. */
  readonly startsAt: Date;
  /** `startsAt` exactly as the API wrote it (local time with offset, e.g. `2026-11-03T00:00:00.000+01:00`). */
  readonly startsAtRaw: string;
  readonly currency: string;
  /** The API's own level (quintile of the day). */
  readonly level: PriceLevel | null;
}

export interface TariffDays {
  readonly today: readonly TariffPrice[];
  readonly tomorrow: readonly TariffPrice[];
}

/** `/api/supplierlookup`: the grid company (netselskab) at an address. */
export interface Supplier {
  readonly address: string | null;
  readonly name: string | null;
  /** The API's own reason when it found nothing, e.g. `"no_address"`. */
  readonly error: string | null;
  /** `true` when a grid company was found. */
  readonly found: boolean;
}

// -- Levels ------------------------------------------------------------------

/**
 * Quintile levels for one day's prices, in the same order.
 *
 * Mirrors the API: cut points are the sorted values at 20/40/60/80 % (index
 * `floor(n * f)`, clamped), `p <= cut` decides. A missing price is `NORMAL` (as in the API);
 * a day without any price is all `NORMAL`.
 */
export function priceLevels(prices: readonly (number | null | undefined)[]): PriceLevel[] {
  const valid = prices.filter((p): p is number => typeof p === 'number').sort((a, b) => a - b);
  if (valid.length === 0) return prices.map(() => 'NORMAL');
  const at = (f: number): number => valid[Math.min(Math.floor(valid.length * f), valid.length - 1)] as number;
  const [p20, p40, p60, p80] = [at(0.2), at(0.4), at(0.6), at(0.8)];
  return prices.map((p): PriceLevel => {
    if (typeof p !== 'number') return 'NORMAL';
    if (p <= p20) return 'VERY_CHEAP';
    if (p <= p40) return 'CHEAP';
    if (p <= p60) return 'NORMAL';
    if (p <= p80) return 'EXPENSIVE';
    return 'VERY_EXPENSIVE';
  });
}

/** Round to the 5 decimals the client keeps (the API itself publishes at most 4-5). */
export function round5(value: number): number {
  return Number(value.toFixed(5));
}
