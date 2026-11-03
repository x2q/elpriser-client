/**
 * {@link Series}: everything one API call returned for a zone, plus the questions you ask of
 * it. One HTTP request can answer many questions: fetch the series once, then ask it.
 */

import { InvalidArgumentError } from './errors.js';
import {
  type Day,
  type DayStats,
  type Estimate,
  type PriceLevel,
  type Slot,
  type Window,
  priceLevels,
  round5,
} from './models.js';
import { HOUR_MS, addDays, floorHour, instant, isLocalDate, localDateOf } from './time.js';
import { type Zone, ZONES } from './zones.js';

/** Options shared by the "current hour" questions. */
export interface AtOptions {
  /** The moment to ask about; default: now. */
  at?: Date;
}

export interface NowOptions extends AtOptions {
  /** Fill an unpriced hour with the API's estimate (`gb`, `pt`, `ie`). Default `false`. */
  estimate?: boolean;
}

export interface DayOptions extends AtOptions {
  /** Include the API's estimated hours (`gb`, `pt`, `ie`). Default `false`. */
  includeEstimate?: boolean;
}

/** Which hours `cheapestHours` / `bestWindow` look at. */
export interface WindowOptions extends AtOptions {
  /** A local calendar day (`YYYY-MM-DD`). Cannot be combined with `start`/`end`. */
  day?: string;
  /** Start of the search window (default: the current hour). */
  start?: Date;
  /** End of the search window (default: `start` + 24 hours). */
  end?: Date;
  /** Count the elpriser.org model's forecast hours. Default `true`; `false` = settled prices only. */
  includeForecast?: boolean;
  /** Count the API's estimated hours (`gb`, `pt`, `ie`). Default `false`. */
  includeEstimate?: boolean;
}

export interface LatestKnownOptions extends AtOptions {
  /** How far back to look, in milliseconds. Default 3 hours. */
  maxAgeMs?: number;
}

/** What a {@link Series} is made of; produced by the parsers. */
export interface SeriesInit {
  zone: Zone;
  currency: string;
  unit: string;
  days: readonly Day[];
  estimate?: Estimate | null;
  source?: 'zone-feed' | 'dk-forecast';
  mode?: string | null;
  gln?: string | null;
  rate?: number | null;
  rateDate?: string | null;
  rateSource?: string | null;
  generated?: string | null;
  trainedThrough?: string | null;
  model?: unknown;
  forecastGenerated?: string | null;
  accuracy?: Readonly<Record<string, unknown>> | null;
  charges?: Readonly<Record<string, unknown>> | null;
  raw?: unknown;
}

function priced(slot: Slot): slot is Slot & { readonly price: number } {
  return slot.price !== null;
}

function cmpPriceThenStart(a: Slot & { price: number }, b: Slot & { price: number }): number {
  return a.price - b.price || a.start.getTime() - b.start.getTime();
}

/** Everything one API call returned for a zone, plus the questions you ask of it. */
export class Series {
  readonly zone: Zone;
  /** ISO 4217 code the prices are in (`zoneInfo.currency`; DKK on the Danish feed). */
  readonly currency: string;
  /** What the API published: `"EUR/MWh"`, `"GBP/MWh"` (`gb`) or `"DKK/kWh"`. */
  readonly unit: string;
  readonly days: readonly Day[];
  readonly estimate: Estimate | null;
  /** `"zone-feed"` (`/api/nordic`) or `"dk-forecast"` (`/api/forecast`). */
  readonly source: 'zone-feed' | 'dk-forecast';
  /** Danish feed: the price mode that was asked for. */
  readonly mode: string | null;
  readonly gln: string | null;
  /**
   * ECB reference rate EUR -> `currency` (`zoneInfo.rate`; 1 for EUR zones and for `gb`, whose
   * prices are published in GBP). `null` on the Danish feed.
   */
  readonly rate: number | null;
  /** The date of the ECB rate, `YYYY-MM-DD`. */
  readonly rateDate: string | null;
  readonly rateSource: string | null;
  readonly generated: string | null;
  readonly trainedThrough: string | null;
  readonly model: unknown;
  readonly forecastGenerated: string | null;
  /** The API's back-test statistics for the forecast days, unchanged (`byHorizon` ...). */
  readonly accuracy: Readonly<Record<string, unknown>> | null;
  /** Danish feed: `{ sys, trans, afg, vat }` as the API sends them. */
  readonly charges: Readonly<Record<string, unknown>> | null;
  /** The decoded response body, untouched. */
  readonly raw: unknown;

  constructor(init: SeriesInit) {
    this.zone = init.zone;
    this.currency = init.currency;
    this.unit = init.unit;
    this.days = init.days;
    this.estimate = init.estimate ?? null;
    this.source = init.source ?? 'zone-feed';
    this.mode = init.mode ?? null;
    this.gln = init.gln ?? null;
    this.rate = init.rate ?? null;
    this.rateDate = init.rateDate ?? null;
    this.rateSource = init.rateSource ?? null;
    this.generated = init.generated ?? null;
    this.trainedThrough = init.trainedThrough ?? null;
    this.model = init.model ?? null;
    this.forecastGenerated = init.forecastGenerated ?? null;
    this.accuracy = init.accuracy ?? null;
    this.charges = init.charges ?? null;
    this.raw = init.raw ?? null;
  }

  // -- basics ---------------------------------------------------------------

  /** IANA time zone of the zone's wall clock. */
  get timeZone(): string {
    return ZONES[this.zone].timeZone;
  }

  /** Unit of {@link Slot.price}: `"<currency>/kWh"`. */
  get priceUnit(): string {
    return `${this.currency}/kWh`;
  }

  /**
   * Every hour in time order. With `includeEstimate` an estimated hour replaces the unpriced
   * settled hour it belongs to (kind `'estimate'`).
   */
  allSlots(options: { includeEstimate?: boolean } = {}): Slot[] {
    const byStart = new Map<number, Slot>();
    for (const day of this.days) for (const slot of day.slots) byStart.set(slot.start.getTime(), slot);
    if (options.includeEstimate === true && this.estimate !== null) {
      for (const est of this.estimate.slots) {
        const key = est.start.getTime();
        const current = byStart.get(key);
        if (current !== undefined && current.price === null && est.price !== null) byStart.set(key, est);
      }
    }
    return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, slot]) => slot);
  }

  /** The {@link Day} for a local date (`YYYY-MM-DD`), if the API delivered it. */
  day(date: string): Day | undefined {
    return this.days.find((d) => d.date === date);
  }

  /** The days that are settled prices. */
  get settledDays(): Day[] {
    return this.days.filter((d) => d.isSettled);
  }

  /** The days that are elpriser.org's forecast, not settled prices. */
  get forecastDays(): Day[] {
    return this.days.filter((d) => d.isForecast);
  }

  /** The local calendar date (`YYYY-MM-DD`) of `at` (default: now) in the zone. */
  localToday(at?: Date): string {
    return localDateOf(this.timeZone, instant(at, 'at'));
  }

  // -- current / next ---------------------------------------------------------

  /** The hour containing `at` (default: now), priced or not; `null` if the series has none. */
  slotAt(options: DayOptions = {}): Slot | null {
    const moment = instant(options.at, 'at');
    for (const slot of this.allSlots({ includeEstimate: options.includeEstimate === true })) {
      if (slot.start.getTime() <= moment && moment < slot.end.getTime()) return slot;
    }
    return null;
  }

  /**
   * The priced hour containing `at` (default: now), or `null`.
   *
   * `null` means there is no price for this hour (yet), e.g. `gb`, where an hour is only priced
   * once it is over. With `estimate: true` such an hour is filled with elpriser.org's estimate
   * when the API sent one (`slot.kind` is then `'estimate'`). A forecast hour is returned as is
   * (`kind` says so).
   */
  now(options: NowOptions = {}): Slot | null {
    const slot = this.slotAt({ at: options.at, includeEstimate: options.estimate === true });
    return slot !== null && slot.price !== null ? slot : null;
  }

  /** The priced hour that starts at the next hour boundary, or `null`. */
  nextHour(options: NowOptions = {}): Slot | null {
    const moment = floorHour(instant(options.at, 'at')) + HOUR_MS;
    for (const slot of this.allSlots({ includeEstimate: options.estimate === true })) {
      if (slot.start.getTime() === moment) return slot.price !== null ? slot : null;
    }
    return null;
  }

  /**
   * The newest priced hour that ended no more than `maxAgeMs` (default 3 hours) before `at`.
   * For `gb`, whose current hour is never priced yet.
   */
  latestKnown(options: LatestKnownOptions = {}): Slot | null {
    const moment = instant(options.at, 'at');
    const maxAge = options.maxAgeMs ?? 3 * HOUR_MS;
    let found: Slot | null = null;
    for (const s of this.allSlots()) {
      const end = s.end.getTime();
      if (s.price !== null && end <= moment && moment - end <= maxAge) found = s;
    }
    return found;
  }

  // -- days -------------------------------------------------------------------

  /** The hours of a local calendar day (empty if the API has none for it). */
  daySlots(date: string, options: { includeEstimate?: boolean } = {}): Slot[] {
    checkDate(date);
    return this.allSlots(options).filter((s) => s.localDate === date);
  }

  /**
   * Today's hours (the zone's local day). Check `slot.kind`: `'forecast'` hours are
   * elpriser.org's own model, not settled prices.
   */
  today(options: DayOptions = {}): Slot[] {
    return this.daySlots(this.localToday(options.at), { includeEstimate: options.includeEstimate === true });
  }

  /**
   * Tomorrow's hours. Until the day-ahead prices are published (about 13:00 CET) these are
   * `'forecast'` hours (or absent, for `gb` and `xk`); the kind tells which.
   */
  tomorrow(options: DayOptions = {}): Slot[] {
    return this.daySlots(addDays(this.localToday(options.at), 1), {
      includeEstimate: options.includeEstimate === true,
    });
  }

  /** Lowest, highest and mean price of a local day (`null` if nothing is priced). */
  stats(date: string): DayStats | null {
    const pool = this.daySlots(date).filter(priced);
    if (pool.length === 0) return null;
    let minimum = pool[0] as Slot & { price: number };
    let maximum = minimum;
    let sum = 0;
    for (const s of pool) {
      sum += s.price;
      if (s.price < minimum.price) minimum = s; // strict: the earliest wins a tie
      if (s.price > maximum.price) maximum = s;
    }
    return { minimum, maximum, average: round5(sum / pool.length), count: pool.length };
  }

  // -- levels -------------------------------------------------------------------

  /** Every hour of a local day (default: today) with its {@link PriceLevel}. */
  levels(options: AtOptions & { date?: string } = {}): Array<{ slot: Slot; level: PriceLevel }> {
    const slots = this.daySlots(options.date ?? this.localToday(options.at));
    const levels = priceLevels(slots.map((s) => s.price));
    return slots.map((slot, i) => ({ slot, level: levels[i] as PriceLevel }));
  }

  /** The level of `slot` among the hours of its own local day; `null` if unpriced. */
  level(slot: Slot): PriceLevel | null {
    if (slot.price === null) return null;
    const hit = this.levels({ date: slot.localDate }).find((x) => x.slot.start.getTime() === slot.start.getTime());
    return hit === undefined ? null : hit.level;
  }

  // -- cheapest hours / best window ---------------------------------------------

  private candidates(options: WindowOptions): Array<Slot & { price: number }> {
    const slots = this.allSlots({ includeEstimate: options.includeEstimate === true });
    let chosen: Slot[];
    if (options.day !== undefined) {
      if (options.start !== undefined || options.end !== undefined) {
        throw new InvalidArgumentError('pass either day or start/end, not both');
      }
      checkDate(options.day);
      chosen = slots.filter((s) => s.localDate === options.day);
    } else {
      const lo = options.start !== undefined ? instant(options.start, 'start') : floorHour(instant(options.at, 'at'));
      const hi = options.end !== undefined ? instant(options.end, 'end') : lo + 24 * HOUR_MS;
      chosen = slots.filter((s) => s.start.getTime() >= lo && s.end.getTime() <= hi);
    }
    let out = chosen.filter(priced);
    if (options.includeForecast === false) out = out.filter((s) => s.kind !== 'forecast');
    return out;
  }

  /**
   * The `n` cheapest priced hours, in time order (the earliest wins a tie).
   *
   * Window: a local `day`, or `start`..`end`; by default the next 24 hours counted from the
   * current hour. `includeForecast: false` restricts it to settled prices. Fewer than `n` hours
   * come back when fewer are priced.
   */
  cheapestHours(n: number, options: WindowOptions = {}): Slot[] {
    if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError(`n must be an integer >= 0, got ${String(n)}`);
    const pool = this.candidates(options);
    return pool
      .sort(cmpPriceThenStart)
      .slice(0, n)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  /**
   * The cheapest run of `hours` consecutive priced hours (lowest mean; the earliest wins a tie).
   * Same window rules as {@link Series.cheapestHours}. `null` if no such run exists.
   */
  bestWindow(hours: number, options: WindowOptions = {}): Window | null {
    if (!Number.isInteger(hours) || hours < 1) {
      throw new InvalidArgumentError(`hours must be an integer >= 1, got ${String(hours)}`);
    }
    const pool = this.candidates(options); // time order, as allSlots() is sorted
    let best: { total: number; index: number } | null = null;
    for (let i = 0; i + hours <= pool.length; i++) {
      const run = pool.slice(i, i + hours);
      let contiguous = true;
      let total = 0;
      for (let j = 0; j < run.length; j++) {
        const s = run[j] as Slot & { price: number };
        total += s.price;
        const next = run[j + 1];
        if (next !== undefined && next.start.getTime() !== s.end.getTime()) contiguous = false;
      }
      if (!contiguous) continue;
      if (best === null || total < best.total - 1e-12) best = { total, index: i };
    }
    if (best === null) return null;
    const run = pool.slice(best.index, best.index + hours);
    const first = run[0] as Slot;
    const last = run[run.length - 1] as Slot;
    return {
      start: first.start,
      end: last.end,
      slots: run,
      average: round5(best.total / hours),
      hours: run.length,
      localStart: first.localStart,
      localEnd: last.localEnd,
    };
  }

  // -- accuracy -------------------------------------------------------------------

  /** The API's back-test numbers for forecast day `D+horizon` (zone feed), if it sent any. */
  accuracyFor(horizon: number): Readonly<Record<string, unknown>> | null {
    const byHorizon = this.accuracy?.['byHorizon'];
    if (typeof byHorizon === 'object' && byHorizon !== null) {
      const entry = (byHorizon as Record<string, unknown>)[String(horizon)];
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        return entry as Record<string, unknown>;
      }
    }
    return null;
  }

  /** The API's `low` flag for `horizon` (`null` when it sent no accuracy). */
  isLowConfidence(horizon: number): boolean | null {
    const entry = this.accuracyFor(horizon);
    if (entry === null || !('low' in entry)) return null;
    return Boolean(entry['low']);
  }

  /** A plain, JSON-friendly summary (the `raw` body is omitted); what `JSON.stringify(series)` gives. */
  toJSON(): Record<string, unknown> {
    const { raw: _raw, ...rest } = this;
    return rest;
  }
}

function checkDate(date: string): void {
  if (!isLocalDate(date)) throw new InvalidArgumentError(`date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
}
