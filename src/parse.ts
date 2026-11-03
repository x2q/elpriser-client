/**
 * Turn raw API JSON into the objects of `models.ts`. Pure functions, no I/O.
 *
 * The parsers are strict about the structure (a missing `days` list or `zoneInfo` is an
 * {@link ElpriserParseError}) and lenient about everything else: unknown fields are ignored,
 * and a malformed hour becomes an unpriced hour rather than an error.
 */

import { ElpriserParseError } from './errors.js';
import type {
  Day,
  DkNow,
  DkPrices,
  DkSchedule,
  Estimate,
  HourPrice,
  PriceKind,
  PriceLevel,
  ScheduleSlot,
  Slot,
  Supplier,
  TariffDays,
  TariffPrice,
} from './models.js';
import { PRICE_LEVELS, round5 } from './models.js';
import { Series } from './series.js';
import { HOUR_MS, isLocalDate, localDayStarts, localParts } from './time.js';
import { type Zone, ZONES } from './zones.js';

type Obj = Readonly<Record<string, unknown>>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number or `null`. Booleans and strings are not prices. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function needObj(payload: unknown, what: string): Obj {
  if (!isObj(payload)) throw new ElpriserParseError(`${what}: response is not a JSON object`);
  return payload;
}

const OFFSET_RE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** An ISO 8601 timestamp as a `Date` (no offset = UTC, never the host's local time), or `null`. */
export function parseTimestamp(value: unknown): Date | null {
  const text = str(value);
  if (text === null || text === '') return null;
  const normalized = /T/i.test(text) && !OFFSET_RE.test(text) ? `${text}Z` : text;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function scaled(value: number | null, scale: number): number | null {
  return value === null ? null : round5(value * scale);
}

interface ExpandKeys {
  priceKey: string;
  minKey: string;
  maxKey: string;
  scale: number;
  kind: PriceKind;
  mwh: boolean;
}

/**
 * One API day (rows keyed by local hour) as UTC-anchored hours.
 *
 * Daylight saving: on a 25-hour day the API carries one value for the doubled local hour 2,
 * and both 02:00 hours get it; on a 23-hour day there is no hour 2 and no slot. A row with a
 * null price still yields a slot (`price: null`) so the day keeps its shape.
 */
export function expandDay(date: string, timeZone: string, rows: readonly unknown[], keys: ExpandKeys): Slot[] {
  const byHour = new Map<number, Obj>();
  for (const row of rows) {
    if (!isObj(row)) continue;
    const hour = int(row['hour']);
    if (hour !== null && hour >= 0 && hour <= 23) byHour.set(hour, row);
  }
  const slots: Slot[] = [];
  for (const startMs of localDayStarts(date, timeZone)) {
    const local = localParts(timeZone, startMs);
    const row = byHour.get(local.hour);
    if (row === undefined) continue;
    const value = num(row[keys.priceKey]);
    const low = value !== null ? num(row[keys.minKey]) : null;
    const high = value !== null ? num(row[keys.maxKey]) : null;
    const end = localParts(timeZone, startMs + HOUR_MS);
    slots.push({
      start: new Date(startMs),
      end: new Date(startMs + HOUR_MS),
      price: scaled(value, keys.scale),
      kind: keys.kind,
      min: scaled(low, keys.scale),
      max: scaled(high, keys.scale),
      priceMwh: keys.mwh ? value : null,
      minMwh: keys.mwh ? low : null,
      maxMwh: keys.mwh ? high : null,
      hour: local.hour,
      localDate: local.date,
      localStart: local.iso,
      localEnd: end.iso,
    });
  }
  return slots;
}

function gridTariff(value: unknown): readonly (number | null)[] | null {
  return Array.isArray(value) ? value.map(num) : null;
}

function parseDays(payload: Obj, timeZone: string, keys: Omit<ExpandKeys, 'kind'>): Day[] {
  const days = payload['days'];
  if (!Array.isArray(days) || days.length === 0) throw new ElpriserParseError('response has no days');
  const out = new Map<string, Day>();
  for (const entry of days) {
    if (!isObj(entry)) continue;
    const date = entry['date'];
    if (!isLocalDate(date)) continue;
    const rows = entry['prices'];
    if (!Array.isArray(rows)) continue;
    const kind: PriceKind = entry['type'] === 'forecast' ? 'forecast' : 'actual';
    const slots = expandDay(date, timeZone, rows, { ...keys, kind });
    out.set(date, {
      date,
      kind,
      slots,
      horizon: int(entry['horizon']),
      weekday: int(entry['weekday']),
      source: str(entry['source']),
      tariff: str(entry['tariff']),
      gridTariff: gridTariff(entry['grid_tariff']),
      isForecast: kind === 'forecast',
      isSettled: kind === 'actual',
      isComplete: slots.length > 0 && slots.every((s) => s.price !== null),
    });
  }
  if (out.size === 0) throw new ElpriserParseError('response has no usable days');
  return [...out.keys()].sort().map((d) => out.get(d) as Day);
}

function parseEstimate(raw: unknown, timeZone: string, scale: number): Estimate | null {
  if (!isObj(raw)) return null;
  const date = raw['date'];
  if (!isLocalDate(date)) return null;
  const rows = raw['prices'];
  if (!Array.isArray(rows)) return null;
  const slots = expandDay(date, timeZone, rows, {
    priceKey: 'eur_mwh',
    minKey: 'min_eur_mwh',
    maxKey: 'max_eur_mwh',
    scale,
    kind: 'estimate',
    mwh: true,
  });
  const accuracy = raw['accuracy'];
  return {
    date,
    scope: str(raw['scope']) ?? 'partial-day',
    model: str(raw['model']),
    generatedAt: parseTimestamp(raw['generatedAt']),
    slots,
    method: str(raw['method']),
    accuracy: isObj(accuracy) ? accuracy : null,
  };
}

/**
 * `GET /api/nordic?zone=<zone>`: hourly `eur_mwh` plus `zoneInfo` with the ECB rate.
 *
 * Despite the field name `eur_mwh` the unit is whatever `unit` says (`GBP/MWh` for `gb`);
 * local currency per kWh is `value * zoneInfo.rate / 1000` (`rate` is 1 for `gb`).
 */
export function parseZoneFeed(payload: unknown, zone: Zone): Series {
  const data = needObj(payload, 'zone feed');
  const echoed = data['zone'];
  if (typeof echoed === 'string' && echoed.toLowerCase() !== zone) {
    throw new ElpriserParseError(`asked for zone '${zone}' but the API answered '${echoed}'`);
  }
  const info = data['zoneInfo'];
  if (!isObj(info)) throw new ElpriserParseError('response has no zoneInfo');
  const currency = info['currency'];
  if (typeof currency !== 'string' || currency.length !== 3) throw new ElpriserParseError('zoneInfo has no currency');
  const rate = num(info['rate']);
  if (rate === null || rate <= 0) throw new ElpriserParseError('zoneInfo has no usable rate');
  const timeZone = ZONES[zone].timeZone;
  const scale = rate / 1000;
  const days = parseDays(data, timeZone, {
    priceKey: 'eur_mwh',
    minKey: 'min_eur_mwh',
    maxKey: 'max_eur_mwh',
    scale,
    mwh: true,
  });
  const accuracy = data['accuracy'];
  return new Series({
    zone,
    currency: currency.toUpperCase(),
    unit: str(data['unit']) ?? 'EUR/MWh',
    days,
    estimate: parseEstimate(data['estimate'], timeZone, scale),
    source: 'zone-feed',
    rate,
    rateDate: str(info['rateDate']),
    rateSource: str(info['rateSource']),
    generated: str(data['generated']),
    trainedThrough: str(data['trainedThrough']),
    model: data['model'],
    forecastGenerated: str(data['forecastGenerated']),
    accuracy: isObj(accuracy) ? accuracy : null,
    raw: data,
  });
}

/** `GET /api/forecast?area=DK1|DK2&mode=...`: DKK/kWh in the requested mode, today + 9 days. */
export function parseDkForecast(payload: unknown, zone: Zone, mode: string, gln: string | null): Series {
  const data = needObj(payload, 'forecast');
  if (ZONES[zone].area === null) throw new ElpriserParseError(`${zone} is not a Danish zone`);
  const days = parseDays(data, ZONES[zone].timeZone, {
    priceKey: 'price',
    minKey: 'min',
    maxKey: 'max',
    scale: 1,
    mwh: false,
  });
  const model = data['model'];
  const charges = data['charges'];
  return new Series({
    zone,
    currency: 'DKK',
    unit: 'DKK/kWh',
    days,
    source: 'dk-forecast',
    mode: str(data['mode']) ?? mode,
    gln,
    generated: str(data['generated']),
    model: isObj(model) ? { ...model } : null,
    forecastGenerated: isObj(model) ? str(model['generatedAt']) : null,
    charges: isObj(charges) ? charges : null,
    raw: data,
  });
}

// -- Danish single-purpose endpoints ---------------------------------------

function need(data: Obj, key: string, what: string): unknown {
  if (!(key in data)) throw new ElpriserParseError(`${what}: missing '${key}'`);
  return data[key];
}

export function parseDkNow(payload: unknown): DkNow {
  const data = needObj(payload, 'now');
  const hour = int(need(data, 'hour', 'now'));
  if (hour === null) throw new ElpriserParseError('now: hour is not an integer');
  return {
    on: Boolean(data['on']),
    price: num(data['price']),
    hour,
    area: str(data['area']) ?? '',
    mode: str(data['mode']) ?? '',
    strategy: str(data['strategy']) ?? '',
  };
}

function hourPrices(rows: unknown, what: string): HourPrice[] {
  if (!Array.isArray(rows)) throw new ElpriserParseError(`${what}: prices is not a list`);
  const out: HourPrice[] = [];
  for (const row of rows) {
    if (!isObj(row)) continue;
    const hour = int(row['hour']);
    if (hour !== null) out.push({ hour, price: num(row['price']) });
  }
  return out;
}

export function parseDkPrices(payload: unknown): DkPrices {
  const data = needObj(payload, 'prices');
  return {
    area: str(data['area']) ?? '',
    mode: str(data['mode']) ?? '',
    date: str(data['date']) ?? '',
    unit: str(data['unit']) ?? 'DKK/kWh',
    charges: str(data['charges']),
    prices: hourPrices(data['prices'], 'prices'),
    currentHour: int(data['current_hour']),
    currentPrice: num(data['current_price']),
  };
}

export function parseDkSchedule(payload: unknown): DkSchedule {
  const data = needObj(payload, 'schedule');
  const rows = data['schedule'];
  if (!Array.isArray(rows)) throw new ElpriserParseError('schedule: schedule is not a list');
  const schedule: ScheduleSlot[] = [];
  for (const row of rows) {
    if (!isObj(row)) continue;
    const hour = int(row['hour']);
    if (hour !== null) schedule.push({ hour, price: num(row['price']), on: Boolean(row['on']) });
  }
  return {
    area: str(data['area']) ?? '',
    mode: str(data['mode']) ?? '',
    strategy: str(data['strategy']) ?? '',
    param: int(data['param']),
    date: str(data['date']) ?? '',
    onNow: Boolean(data['on_now']),
    schedule,
    onHours: schedule.filter((s) => s.on).map((s) => s.hour),
  };
}

function level(value: unknown): PriceLevel | null {
  return (PRICE_LEVELS as readonly unknown[]).includes(value) ? (value as PriceLevel) : null;
}

/** `GET /api/shelly/tariff`: the Tibber-shaped answer, `today` and `tomorrow`. */
export function parseShellyTariff(payload: unknown): TariffDays {
  const data = needObj(payload, 'shelly tariff');
  let info: unknown;
  try {
    const homes = (data['data'] as { viewer: { homes: unknown[] } }).viewer.homes;
    info = (homes[0] as { currentSubscription: { priceInfo: unknown } }).currentSubscription.priceInfo;
  } catch (cause) {
    throw new ElpriserParseError('shelly tariff: unexpected shape', { cause });
  }
  if (!isObj(info)) throw new ElpriserParseError('shelly tariff: unexpected shape');

  const day = (rows: unknown): TariffPrice[] => {
    const out: TariffPrice[] = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!isObj(row)) continue;
      const startsAt = parseTimestamp(row['startsAt']);
      if (startsAt === null) continue;
      out.push({
        total: num(row['total']),
        startsAt,
        startsAtRaw: str(row['startsAt']) as string,
        currency: str(row['currency']) ?? 'DKK',
        level: level(row['level']),
      });
    }
    return out;
  };
  return { today: day(info['today']), tomorrow: day(info['tomorrow']) };
}

export function parseSupplier(payload: unknown): Supplier {
  const data = needObj(payload, 'supplier lookup');
  const name = str(data['name']);
  return { address: str(data['address']), name, error: str(data['error']), found: name !== null };
}
