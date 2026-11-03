import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InvalidArgumentError, priceLevels } from '../src/index.js';
import type { PriceLevel, Zone } from '../src/index.js';
import { parseDkForecast, parseShellyTariff, parseZoneFeed } from '../src/parse.js';
import { load, must } from './helpers.js';

const utc = (s: string) => new Date(s.endsWith('Z') ? s : `${s}Z`);
const zoneSeries = (zone: Zone) => parseZoneFeed(load(`zone_${zone.replace('-', '_')}`), zone);

interface Synth {
  d?: string;
  kind?: string;
  zone?: Zone;
  rate?: number;
  more?: unknown[];
}

/** A series with hand-made hourly EUR/MWh prices (null = unpriced) for one day (+ more days). */
function synthetic(dayPrices: Array<number | null>, { d = '2026-06-10', kind = 'actual', zone = 'de', rate = 1, more = [] }: Synth = {}) {
  const days: unknown[] = [{ date: d, type: kind, prices: dayPrices.map((p, h) => ({ hour: h, eur_mwh: p })) }, ...more];
  return parseZoneFeed({ zoneInfo: { currency: 'EUR', rate }, days }, zone);
}

const AT = utc('2026-11-03T07:20:00'); // 08:20 in Berlin, 07:20 in London
const approx = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a != null && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const hours = (slots: readonly { hour: number }[]) => slots.map((s) => s.hour);

// -- current / next -------------------------------------------------------------

test('now and nextHour', () => {
  const s = zoneSeries('de');
  assert.equal(must(s.now({ at: AT })).hour, 8);
  assert.equal(must(s.now({ at: AT })).priceMwh, 301.31);
  assert.equal(must(s.nextHour({ at: AT })).hour, 9);
  assert.equal(must(s.nextHour({ at: AT })).priceMwh, 270.94);
  assert.equal(must(s.now({ at: AT })).kind, 'actual');
});

test('now accepts any Date instant and rejects an invalid Date', () => {
  const s = zoneSeries('de');
  assert.deepEqual(s.now({ at: new Date(AT.getTime()) }), s.now({ at: AT }));
  assert.throws(() => s.now({ at: new Date('nonsense') }), InvalidArgumentError);
  assert.throws(() => s.now({ at: '2026-11-03' as unknown as Date }), InvalidArgumentError);
});

test('now is null outside the data', () => {
  const s = zoneSeries('de');
  assert.equal(s.now({ at: utc('2030-01-01T00:00:00') }), null);
  assert.equal(s.nextHour({ at: utc('2030-01-01T00:00:00') }), null);
});

test('nextHour crosses midnight into the forecast day', () => {
  const nxt = must(zoneSeries('de').nextHour({ at: utc('2026-11-03T22:30:00') })); // 23:30 Berlin
  assert.deepEqual([nxt.localDate, nxt.hour, nxt.kind], ['2026-11-04', 0, 'forecast']);
});

test('gb current hour is unpriced until estimated', () => {
  const s = zoneSeries('gb');
  assert.equal(must(s.slotAt({ at: AT })).price, null);
  assert.equal(s.now({ at: AT }), null);
  const est = must(s.now({ at: AT, estimate: true }));
  assert.equal(est.kind, 'estimate');
  assert.equal(est.hour, 7);
  assert.equal(est.priceMwh, 209.85);
  assert.ok(est.min! < est.price! && est.price! < est.max!);
  approx(est.price, 0.20985);
});

test('gb latestKnown falls back to the last settled hour', () => {
  const s = zoneSeries('gb');
  const last = must(s.latestKnown({ at: AT }));
  assert.deepEqual([last.hour, last.priceMwh], [6, 202.06]);
  const later = new Date(AT.getTime() + 4 * 3_600_000);
  assert.equal(s.latestKnown({ at: later }), null); // older than the default 3 h
  assert.equal(must(s.latestKnown({ at: later, maxAgeMs: 6 * 3_600_000 })).hour, 6);
});

test('pt hour 23 estimate fills the last hour only', () => {
  const s = zoneSeries('pt');
  const at = utc('2026-11-03T23:10:00'); // 23:10 Lisbon (UTC in November)
  assert.equal(s.now({ at }), null);
  assert.equal(must(s.now({ at, estimate: true })).priceMwh, 252.7);
  assert.equal(must(s.now({ at: utc('2026-11-03T22:10:00'), estimate: true })).kind, 'actual');
});

test('an estimate never replaces a settled price', () => {
  const s = zoneSeries('gb');
  const merged = new Map(s.allSlots({ includeEstimate: true }).map((x) => [x.start.getTime(), x]));
  const plain = new Map(s.allSlots().map((x) => [x.start.getTime(), x]));
  for (const [start, slot] of plain) if (slot.price !== null) assert.deepEqual(merged.get(start), slot);
  assert.equal([...merged.values()].filter((x) => x.kind === 'estimate').length, 17);
});

// -- days ---------------------------------------------------------------------------

test('today and tomorrow are the zone\'s own days', () => {
  const s = zoneSeries('de');
  assert.deepEqual(hours(s.today({ at: AT })), Array.from({ length: 24 }, (_, i) => i));
  assert.deepEqual(new Set(s.today({ at: AT }).map((x) => x.localDate)), new Set(['2026-11-03']));
  const tomorrow = s.tomorrow({ at: AT });
  assert.deepEqual(new Set(tomorrow.map((x) => x.localDate)), new Set(['2026-11-04']));
  assert.deepEqual(new Set(tomorrow.map((x) => x.kind)), new Set(['forecast'])); // not published yet: a forecast, flagged
});

test('today uses the local date, not the UTC date', () => {
  const s = zoneSeries('de');
  const at = utc('2026-11-03T23:30:00'); // already Nov 4 in Berlin
  assert.equal(s.localToday(at), '2026-11-04');
  assert.deepEqual(new Set(s.today({ at }).map((x) => x.localDate)), new Set(['2026-11-04']));
});

test('gb has no published tomorrow but forecast days', () => {
  const s = zoneSeries('gb');
  assert.deepEqual(new Set(s.tomorrow({ at: AT }).map((x) => x.kind)), new Set(['forecast']));
  assert.equal(must(s.day('2026-11-04')).horizon, 1);
});

test('xk tomorrow is absent', () => {
  const s = zoneSeries('xk');
  const at = utc('2026-11-03T12:00:00');
  assert.deepEqual(s.tomorrow({ at }), []);
  assert.equal(s.today({ at }).length, 24);
});

test('stats', () => {
  const s = synthetic([10, 30, 20, null, ...Array<number>(20).fill(25)]);
  const st = must(s.stats('2026-06-10'));
  assert.deepEqual([st.minimum.hour, st.maximum.hour, st.count], [0, 1, 23]);
  approx(st.average, (10 + 30 + 20 + 25 * 20) / 23 / 1000, 1e-5);
  assert.equal(s.stats('2000-01-01'), null);
});

test('stats: the earliest hour wins ties for both minimum and maximum', () => {
  const st = must(synthetic([5, 9, 5, 9, ...Array<number>(20).fill(7)]).stats('2026-06-10'));
  assert.deepEqual([st.minimum.hour, st.maximum.hour], [0, 1]);
});

test('daySlots rejects a malformed date', () => {
  assert.throws(() => synthetic([1]).daySlots('10-06-2026'), InvalidArgumentError);
});

// -- cheapest hours ---------------------------------------------------------------------

test('cheapestHours of a day, in time order', () => {
  const s = synthetic([50, 40, 10, 30, 20, 60, ...Array<number>(18).fill(100)]);
  const got = s.cheapestHours(3, { day: '2026-06-10' });
  assert.deepEqual(hours(got), [2, 3, 4]);
  assert.deepEqual(got.map((x) => x.priceMwh), [10, 30, 20]);
});

test('cheapestHours: a tie prefers the earliest', () => {
  const s = synthetic([5, 5, 5, 5, ...Array<number>(20).fill(9)]);
  assert.deepEqual(hours(s.cheapestHours(2, { day: '2026-06-10' })), [0, 1]);
});

test('cheapestHours skips unpriced hours and returns fewer when short', () => {
  const s = synthetic([...Array<null>(22).fill(null), 7, 3]);
  assert.deepEqual(hours(s.cheapestHours(5, { day: '2026-06-10' })), [22, 23]);
  assert.deepEqual(s.cheapestHours(0, { day: '2026-06-10' }), []);
});

test('cheapestHours: the default window is the next 24 hours', () => {
  const nextDay = [{ date: '2026-06-11', type: 'actual', prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: 100 + h })) }];
  const s = synthetic(Array<number>(24).fill(1), { more: nextDay }); // Jun 10 is super cheap, Jun 11 dearer
  const at = utc('2026-06-10T10:30:00'); // 12:30 Berlin (CEST): window 12:00 .. 12:00 next day
  assert.deepEqual(s.cheapestHours(2, { at }).map((x) => x.localStart.slice(0, 13)), ['2026-06-10T12', '2026-06-10T13']);
  const got = s.cheapestHours(3, { start: utc('2026-06-10T20:00:00'), end: utc('2026-06-11T22:00:00') });
  assert.deepEqual(got.map((x) => x.priceMwh), [1, 1, 100]); // 22:00 and 23:00 local on Jun 10, then 00:00 on Jun 11
});

test('cheapestHours: settled only excludes forecast', () => {
  const s = zoneSeries('de');
  const only = s.cheapestHours(4, { at: AT, includeForecast: false });
  assert.ok(only.every((x) => x.kind === 'actual'));
  assert.equal(only.length, 4);
  const withForecast = s.cheapestHours(4, { at: AT });
  assert.equal(withForecast.length, 4);
});

test('cheapestHours validation', () => {
  const s = synthetic(Array<number>(24).fill(1));
  assert.throws(() => s.cheapestHours(-1), InvalidArgumentError);
  assert.throws(() => s.cheapestHours(1.5), InvalidArgumentError);
  assert.throws(
    () => s.cheapestHours(1, { day: '2026-06-10', start: utc('2026-06-10T00:00:00') }),
    (e: Error) => e instanceof InvalidArgumentError && /either day or start\/end/.test(e.message),
  );
});

test('cheapestHours with the estimate flag', () => {
  const s = zoneSeries('gb');
  const plain = s.cheapestHours(3, { day: '2026-11-03' });
  assert.ok(plain.every((x) => x.kind === 'actual'));
  assert.equal(plain.length, 3);
  const mixed = s.cheapestHours(24, { day: '2026-11-03', includeEstimate: true });
  assert.equal(mixed.length, 24);
  assert.ok(mixed.some((x) => x.kind === 'estimate'));
});

// -- best window ----------------------------------------------------------------------------

test('bestWindow finds the cheapest consecutive run', () => {
  const s = synthetic([10, 90, 20, 20, 20, 90, 15, 15, 95, ...Array<number>(15).fill(100)]);
  const w = must(s.bestWindow(3, { day: '2026-06-10' }));
  assert.equal(w.hours, 3);
  assert.equal(w.localStart.slice(11, 13), '02');
  assert.equal(w.localEnd.slice(11, 13), '05');
  approx(w.average, 0.02);
  assert.deepEqual(w.slots.map((x) => x.priceMwh), [20, 20, 20]);
  assert.equal(w.end.getTime() - w.start.getTime(), 3 * 3_600_000);
});

test('bestWindow is not the same as cheapestHours', () => {
  const s = synthetic([1, 99, 1, 99, 1, 99, 20, 20, 20, ...Array<number>(15).fill(200)]);
  assert.deepEqual(hours(s.cheapestHours(3, { day: '2026-06-10' })), [0, 2, 4]);
  assert.equal(must(s.bestWindow(3, { day: '2026-06-10' })).slots[0]!.hour, 6);
});

test('bestWindow does not bridge gaps', () => {
  const s = synthetic([1, 1, null, 1, 1, ...Array<number>(19).fill(100)]);
  const w = must(s.bestWindow(3, { day: '2026-06-10' })); // 0-1 and 3-4 cannot be joined; 3-5 is the best run
  assert.equal(w.slots[0]!.hour, 3);
  approx(w.average, 0.034);
  assert.equal(must(s.bestWindow(2, { day: '2026-06-10' })).slots[0]!.hour, 0);
});

test('bestWindow: a tie goes to the earliest, impossible gives null', () => {
  const s = synthetic(Array<number>(24).fill(4));
  assert.equal(must(s.bestWindow(5, { day: '2026-06-10' })).slots[0]!.hour, 0);
  assert.equal(s.bestWindow(25, { day: '2026-06-10' }), null);
  assert.equal(synthetic(Array<null>(24).fill(null)).bestWindow(1, { day: '2026-06-10' }), null);
  assert.throws(() => s.bestWindow(0), InvalidArgumentError);
  assert.throws(() => s.bestWindow(2.5), InvalidArgumentError);
});

test('bestWindow across midnight', () => {
  const next = [{ date: '2026-06-11', type: 'actual', prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: h < 2 ? 1 : 500 })) }];
  const s = synthetic([...Array<number>(22).fill(500), 1, 1], { more: next });
  const w = must(s.bestWindow(4, { start: utc('2026-06-10T20:00:00'), end: utc('2026-06-12T00:00:00') }));
  assert.deepEqual([w.slots[0]!.localDate, w.slots[0]!.hour, w.localEnd.slice(0, 13)], ['2026-06-10', 22, '2026-06-11T02']);
});

// -- DST ------------------------------------------------------------------------------------

test('a 25-hour day doubles hour 2', () => {
  const s = synthetic(Array.from({ length: 24 }, (_, i) => i), { d: '2026-10-25', zone: 'dk1' }); // clocks go back in Denmark
  const slots = must(s.day('2026-10-25')).slots;
  assert.equal(slots.length, 25);
  assert.deepEqual(hours(slots.slice(0, 5)), [0, 1, 2, 2, 3]);
  assert.equal(slots[2]!.priceMwh, 2);
  assert.equal(slots[3]!.priceMwh, 2);
  assert.equal(slots[3]!.start.getTime() - slots[2]!.start.getTime(), 3_600_000); // the doubled hour is a real hour
  assert.equal(slots[2]!.localStart, '2026-10-25T02:00:00+02:00');
  assert.equal(slots[3]!.localStart, '2026-10-25T02:00:00+01:00');
  assert.equal(new Set(slots.map((x) => x.start.getTime())).size, 25);
});

test('a 23-hour day has no hour 2', () => {
  const s = synthetic(Array.from({ length: 24 }, (_, i) => i), { d: '2026-03-29', zone: 'dk1' });
  const slots = must(s.day('2026-03-29')).slots;
  assert.equal(slots.length, 23);
  assert.ok(!hours(slots).includes(2));
  assert.deepEqual(hours(slots.slice(0, 4)), [0, 1, 3, 4]);
  assert.equal(slots[1]!.end.getTime(), slots[2]!.start.getTime()); // no gap on the timeline
});

test('window arithmetic over DST uses elapsed time', () => {
  const s = synthetic(Array<number>(24).fill(10), { d: '2026-10-25', zone: 'dk1' });
  const w = must(s.bestWindow(25, { day: '2026-10-25' }));
  assert.equal(w.end.getTime() - w.start.getTime(), 25 * 3_600_000);
});

// -- levels ---------------------------------------------------------------------------------

test('priceLevels quintiles', () => {
  // the API's cut points are the sorted values at index floor(n*f): 3, 5, 7, 9 for ten prices
  assert.deepEqual(priceLevels([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), [
    ...Array<PriceLevel>(3).fill('VERY_CHEAP'),
    ...Array<PriceLevel>(2).fill('CHEAP'),
    ...Array<PriceLevel>(2).fill('NORMAL'),
    ...Array<PriceLevel>(2).fill('EXPENSIVE'),
    'VERY_EXPENSIVE',
  ]);
});

test('priceLevels: missing and flat days', () => {
  assert.deepEqual(priceLevels([null, null]), ['NORMAL', 'NORMAL']);
  assert.deepEqual(priceLevels([3, 3, 3, 3, 3]), Array<PriceLevel>(5).fill('VERY_CHEAP')); // same as the API: p <= p20
  assert.equal(priceLevels([1, null, 9])[1], 'NORMAL');
  assert.deepEqual(priceLevels([]), []);
});

test('series levels per local day', () => {
  const s = zoneSeries('de');
  const levels = s.levels({ at: AT });
  assert.equal(levels.length, 24);
  assert.ok(levels.filter((x) => x.level === 'VERY_CHEAP').length >= 4);
  const byPrice = [...levels].sort((a, b) => a.slot.price! - b.slot.price!);
  assert.equal(must(byPrice[0]).level, 'VERY_CHEAP');
  assert.equal(s.level(must(byPrice[0]).slot), 'VERY_CHEAP');
  const dearest = must(byPrice.at(-1));
  assert.equal(dearest.level, 'VERY_EXPENSIVE');
  assert.equal(s.level(dearest.slot), 'VERY_EXPENSIVE');
});

test('the level of an unpriced slot is null', () => {
  const s = zoneSeries('gb');
  assert.equal(s.level(must(s.slotAt({ at: AT }))), null);
});

test("Danish levels equal the API's own Tibber levels", () => {
  // The Danish feed's day 1 is exactly /api/shelly/tariff's `today`; our levels must agree.
  const s = parseDkForecast(load('dk_forecast'), 'dk1', 'inkl_alt', null);
  const api = parseShellyTariff(load('dk_shelly')).today;
  const mine = s.levels({ date: '2026-11-03' });
  assert.deepEqual(mine.map((x) => Number(x.slot.price!.toFixed(4))), api.map((t) => t.total));
  assert.deepEqual(mine.map((x) => x.level), api.map((t) => t.level));
});

test('priceLevels reproduces the API levels from the recorded tariff', () => {
  const tariff = parseShellyTariff(load('dk_shelly'));
  assert.deepEqual(priceLevels(tariff.today.map((t) => t.total)), tariff.today.map((t) => t.level));
});

// -- misc -----------------------------------------------------------------------------------

test('JSON.stringify of a series omits raw and keeps the answers', () => {
  const json = JSON.parse(JSON.stringify(zoneSeries('de')));
  assert.equal(json.raw, undefined);
  assert.equal(json.zone, 'de');
  assert.equal(json.days.length, 9);
});
