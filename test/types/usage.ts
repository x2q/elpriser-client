// Type-level tests: compiled (never run) with `tsc` against the *built* package (`import ... from
// 'elpriser-client'` resolves through package.json "exports" to dist/esm/index.d.ts) with no
// DOM and no Node type packages, so the published declarations must be self-contained.
// `// @ts-expect-error` lines must fail to compile; everything else must compile.
import {
  ApiError,
  Elpriser,
  ElpriserError,
  MODES,
  NotFoundError,
  RateLimitError,
  ZONES,
  ZONE_KEYS,
  isZone,
  parseZone,
} from 'elpriser-client';
import type {
  AbortSignalLike,
  Day,
  DkSchedule,
  FetchLike,
  PriceKind,
  PriceLevel,
  PriceMode,
  Series,
  Slot,
  Strategy,
  Window,
  Zone,
  ZoneInfo,
} from 'elpriser-client';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// -- zones ------------------------------------------------------------------------------------
type _Zone1 = Expect<Equal<'de' extends Zone ? true : false, true>>;
type _Zone2 = Expect<Equal<'it-n' extends Zone ? true : false, true>>;
type _Zone3 = Expect<Equal<'narnia' extends Zone ? true : false, false>>;
type _Zone4 = Expect<Equal<'DE' extends Zone ? true : false, false>>;
type _Cur = Expect<Equal<(typeof ZONES)['de']['currency'], 'EUR'>>;
type _Cur2 = Expect<Equal<(typeof ZONES)['pl']['timeZone'], 'Europe/Warsaw'>>;
type _Area = Expect<Equal<(typeof ZONES)['dk1']['area'], 'DK1'>>;
type _Info = Expect<Equal<ZoneInfo['group'], 'dk' | 'nordic' | 'eu'>>;
type _Keys = Expect<Equal<(typeof ZONE_KEYS)[number], Zone>>;
const z: Zone = parseZone(' DE ');
if (isZone(z)) type_unused(z);
// @ts-expect-error not a zone key
const badZone: Zone = 'narnia';

// -- the client -------------------------------------------------------------------------------
const client = new Elpriser({ timeoutMs: 5000, retries: 1, backoffMs: 100, userAgent: 'my-app/1.0', baseUrl: 'http://localhost' });
// @ts-expect-error unknown option
new Elpriser({ timeout: 5 });
// @ts-expect-error timeoutMs is a number
new Elpriser({ timeoutMs: '5' });
new Elpriser({ userAgent: null });

async function api(signal: AbortSignalLike, fetchImpl: FetchLike) {
  const e = new Elpriser({ fetch: fetchImpl, signal });
  const slot = await e.now('de');
  type _Now = Expect<Equal<typeof slot, Slot | null>>;
  const upper = await e.now('DE'); // upper-case spelling is typed too
  const next = await e.nextHour('se3', { at: new Date(), estimate: true, signal });
  const today = await e.today('gb', { includeEstimate: true });
  type _Today = Expect<Equal<typeof today, Slot[]>>;
  const cheap = await e.cheapestHours('pl', 4, { includeForecast: false, day: '2026-11-03' });
  type _Cheap = Expect<Equal<typeof cheap, Slot[]>>;
  const win = await e.bestWindow('nl', 3, { start: new Date(), end: new Date() });
  type _Win = Expect<Equal<typeof win, Window | null>>;
  const fc = await e.forecast('dk1', { mode: 'inkl_alt' });
  type _Fc = Expect<Equal<typeof fc, Day[]>>;
  const lv = await e.levels('de');
  type _Lv = Expect<Equal<typeof lv, Array<{ slot: Slot; level: PriceLevel }>>>;
  const s = await e.series('dk2', { mode: 'net_inkl_alt', gln: '5790000704842' });
  type _S = Expect<Equal<typeof s, Series>>;
  const sched = await e.dkSchedule('DK1', { strategy: 'cheapest_n', hours: 5, maxOff: 2 });
  type _Sched = Expect<Equal<typeof sched, DkSchedule>>;
  const hoursOn: readonly number[] = sched.onHours;
  const supplier = await e.supplierLookup(55.6, 12.5);
  const name: string | null = supplier.name;
  return [slot, upper, next, hoursOn, name, await e.dkNow(), await e.dkPrices('DK2', { date: '2026-11-03', charges: 'current' }), await e.shellyTariff()];
}

async function misuse(e: Elpriser) {
  // @ts-expect-error unknown zone
  await e.now('narnia');
  // @ts-expect-error the mode must be one of the API's modes
  await e.series('dk1', { mode: 'bogus' });
  // @ts-expect-error n must be a number
  await e.cheapestHours('de', '3');
  // @ts-expect-error day is a YYYY-MM-DD string, not a Date
  await e.cheapestHours('de', 3, { day: new Date() });
  // @ts-expect-error includeForecast is a boolean
  await e.cheapestHours('de', 3, { includeForecast: 'yes' });
  // @ts-expect-error strategy must be one of the API's strategies
  await e.dkNow('DK1', { strategy: 'cheapest' });
  // @ts-expect-error DK3 does not exist
  await e.dkNow('DK3');
  // @ts-expect-error charges is 'historical' | 'current'
  await e.dkPrices('DK1', { charges: 'other' });
  // @ts-expect-error at must be a Date
  await e.now('de', { at: '2026-11-03' });
}

// -- results are read-only data ---------------------------------------------------------------
function results(slot: Slot, series: Series, w: Window, d: Day) {
  const price: number | null = slot.price;
  const kind: PriceKind = slot.kind;
  const hour: number = slot.hour;
  const start: Date = slot.start;
  const local: string = slot.localStart;
  // @ts-expect-error slots are read-only
  slot.price = 1;
  // @ts-expect-error days are read-only
  d.date = 'x';
  const slots: readonly Slot[] = w.slots;
  const horizon: number | null = d.horizon;
  const gt: readonly (number | null)[] | null = d.gridTariff;
  const unit: string = series.unit;
  const rate: number | null = series.rate;
  const fcDays: Day[] = series.forecastDays;
  const maybe: Slot | null = series.now({ estimate: true });
  const level: PriceLevel | null = series.level(slot);
  const stats = series.stats('2026-11-03');
  const avg: number | undefined = stats?.average;
  // @ts-expect-error kind is a closed union
  const wrongKind: PriceKind = 'predicted';
  return [price, kind, hour, start, local, slots, horizon, gt, unit, rate, fcDays, maybe, level, avg];
}

// kind narrows
function narrow(slot: Slot) {
  switch (slot.kind) {
    case 'actual':
    case 'forecast':
    case 'estimate':
      return 1;
  }
}

// -- errors -----------------------------------------------------------------------------------
function errors(e: unknown) {
  if (e instanceof RateLimitError) {
    const n: number | null = e.retryAfter;
    const status: number = e.status;
    const body: unknown = e.body;
    const url: string = e.url;
    return [n, status, body, url];
  }
  if (e instanceof NotFoundError) return e.status;
  if (e instanceof ApiError) return e.message;
  if (e instanceof ElpriserError) return e.name;
  return null;
}

// -- lists ------------------------------------------------------------------------------------
const modes: readonly PriceMode[] = MODES;
const strat: Strategy = 'avoid_peak';
// @ts-expect-error not a strategy
const badStrat: Strategy = 'avoid';

function type_unused(..._args: unknown[]): void {}
export { client, api, misuse, results, narrow, errors, modes, strat, z };
