import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ElpriserParseError } from '../src/index.js';
import type { Zone } from '../src/index.js';
import {
  parseDkForecast,
  parseDkNow,
  parseDkPrices,
  parseDkSchedule,
  parseShellyTariff,
  parseSupplier,
  parseTimestamp,
  parseZoneFeed,
} from '../src/parse.js';
import { load, must } from './helpers.js';

function series(zone: Zone, name = '') {
  return parseZoneFeed(load(name || `zone_${zone.replace('-', '_')}`), zone);
}

const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('euro zone basics', () => {
  const s = series('de');
  assert.deepEqual([s.currency, s.unit, s.rate, s.rateSource], ['EUR', 'EUR/MWh', 1, 'ECB']);
  assert.equal(s.source, 'zone-feed');
  assert.equal(s.priceUnit, 'EUR/kWh');
  assert.equal(must(s.days[0]).date, '2026-11-01');
  assert.deepEqual(s.days.slice(0, 3).map((d) => d.kind), ['actual', 'actual', 'actual']);
  assert.deepEqual(s.forecastDays.map((d) => d.horizon), [2, 3, 4, 5, 6, 7]);
  assert.ok(s.days.every((d) => d.slots.length === 24));
});

test('price is priceMwh times rate over 1000', () => {
  const s = series('de');
  const slot = must(s.day('2026-11-03')).slots[8]!;
  assert.equal(slot.priceMwh, 301.31);
  close(slot.price, 0.30131);
  assert.equal(slot.hour, 8);
  assert.equal(slot.kind, 'actual');
  assert.equal(slot.min, null);
  assert.equal(slot.max, null);
});

test('forecast hours carry P10/P90', () => {
  const slot = must(series('de').day('2026-11-04')).slots[0]!;
  assert.equal(slot.kind, 'forecast');
  assert.deepEqual([slot.priceMwh, slot.minMwh, slot.maxMwh], [197.16, 161.45, 276.16]);
  close(slot.min, 0.16145);
  close(slot.price, 0.19716);
  close(slot.max, 0.27616);
});

test('local currency conversion uses the ECB rate', () => {
  const pl = series('pl');
  assert.deepEqual([pl.currency, pl.unit, pl.rate, pl.rateDate], ['PLN', 'EUR/MWh', 4.4185, '2026-11-02']);
  const raw = load('zone_pl').days[2].prices[12].eur_mwh as number;
  close(must(pl.day('2026-11-03')).slots[12]!.price, (raw * 4.4185) / 1000, 1e-5);
  const se3 = series('se3');
  assert.deepEqual([se3.currency, se3.rate], ['SEK', 10.9475]);
  const s3 = must(se3.day('2026-11-03')).slots[3]!;
  assert.ok(s3.price! > s3.priceMwh! / 1000);
});

test('the zone time zone is applied, not UTC', () => {
  const slot = must(series('de').day('2026-11-03')).slots[8]!;
  assert.equal(slot.start.toISOString(), '2026-11-03T07:00:00.000Z');
  assert.equal(slot.localStart, '2026-11-03T08:00:00+01:00');
  assert.equal(slot.localEnd, '2026-11-03T09:00:00+01:00');
  assert.equal(slot.hour, 8);
  assert.equal(slot.localDate, '2026-11-03');
  assert.equal(slot.end.getTime() - slot.start.getTime(), 3_600_000);
  const pt = must(series('pt').day('2026-11-03')).slots[8]!;
  assert.equal(pt.start.toISOString(), '2026-11-03T08:00:00.000Z');
});

test('accuracy passthrough', () => {
  const s = series('de');
  assert.equal(s.model, 'eu-ens-v2');
  assert.equal(s.forecastGenerated, '2026-11-03');
  assert.equal(s.trainedThrough, '2026-11-01');
  assert.equal(must(s.accuracyFor(2))['mae'], 19.7);
  assert.equal(s.isLowConfidence(2), false);
  assert.equal(s.accuracyFor(1), null);
  assert.equal(s.isLowConfidence(1), null);
  assert.equal(series('pt').isLowConfidence(2), true);
});

test('zone without forecast', () => {
  const s = series('xk');
  assert.deepEqual(s.forecastDays, []);
  assert.equal(s.accuracy, null);
  assert.equal(s.trainedThrough, null);
  assert.equal(s.days.length, 3);
});

test('Nordic zone forecast has no horizon', () => {
  const s = series('se3');
  assert.equal(s.forecastDays.length, 8);
  assert.ok(s.forecastDays.every((d) => d.horizon === null));
  assert.equal(s.model, null);
});

test('gb is published in pounds despite the field name', () => {
  const s = series('gb');
  assert.deepEqual([s.unit, s.currency, s.rate], ['GBP/MWh', 'GBP', 1]);
  const first = must(s.day('2026-11-02')).slots[0]!;
  assert.equal(first.priceMwh, 191.1);
  close(first.price, 0.1911);
  assert.equal(s.priceUnit, 'GBP/kWh');
});

test('gb today has unpriced hours and an estimate', () => {
  const s = series('gb');
  const today = must(s.day('2026-11-03'));
  assert.deepEqual(
    today.slots.flatMap((sl, i) => (sl.price === null ? [i] : [])),
    Array.from({ length: 17 }, (_, i) => i + 7),
  );
  assert.ok(today.slots.every((sl) => sl.kind === 'actual'));
  const est = must(s.estimate);
  assert.deepEqual([est.date, est.scope, est.model], ['2026-11-03', 'partial-day', 'gb-est-v1']);
  assert.equal(est.generatedAt?.toISOString(), '2026-11-03T07:12:01.000Z');
  assert.deepEqual(est.slots.map((sl) => sl.hour), Array.from({ length: 17 }, (_, i) => i + 7));
  assert.ok(est.slots.every((sl) => sl.kind === 'estimate' && sl.min !== null && sl.max !== null));
  // days is never changed by the estimate
  assert.equal(today.slots[7]!.price, null);
  assert.deepEqual(s.forecastDays.map((d) => d.horizon), [1, 2, 3, 4, 5, 6, 7]);
});

for (const zone of ['pt', 'ie'] as const) {
  test(`${zone} estimate is hour 23 of the newest day`, () => {
    const s = series(zone);
    const est = must(s.estimate);
    assert.equal(est.model, 'hour23-v1');
    assert.deepEqual(est.slots.map((sl) => sl.hour), [23]);
    assert.ok(['last-settled-hour', 'last-settled-hour-plus-typical-step'].includes(must(est.method)));
    assert.equal(est.accuracy?.['hours'], 1);
    assert.equal(must(s.day(est.date)).slots[23]!.price, null);
  });
}

test('zones without an estimate', () => {
  assert.equal(series('de').estimate, null);
});

test('Danish forecast feed', () => {
  const s = parseDkForecast(load('dk_forecast'), 'dk1', 'inkl_alt', null);
  assert.deepEqual([s.currency, s.unit, s.source, s.mode, s.rate], ['DKK', 'DKK/kWh', 'dk-forecast', 'inkl_alt', null]);
  assert.deepEqual(s.charges, { sys: 0.072, trans: 0.043, afg: 0.008, vat: 0.25 });
  assert.equal((s.model as { name: string }).name, 'v3');
  assert.equal(s.forecastGenerated, '2026-11-02T12:13:57.958767+00:00');
  assert.deepEqual(s.days.slice(0, 2).map((d) => d.kind), ['actual', 'forecast']);
  assert.equal(s.days.slice(1).at(-1)!.source, 'heuristic');
  assert.equal(s.days[1]!.source, 'model');
  assert.equal(s.days[0]!.weekday, 2);
  for (const d of s.days) assert.equal(d.weekday, new Date(`${d.date}T00:00:00Z`).getUTCDay());
  const slot = s.days[1]!.slots[0]!;
  const raw = load('dk_forecast').days[1].prices[0];
  assert.deepEqual([slot.price, slot.min, slot.max, slot.priceMwh], [raw.price, raw.min, raw.max, null]);
  assert.ok(s.days[0]!.slots.every((sl) => sl.min === null));
});

test('Danish net mode carries the grid tariff', () => {
  const s = parseDkForecast(load('dk_forecast_net'), 'dk2', 'net_inkl_alt', '5790000704842');
  assert.deepEqual([s.mode, s.gln], ['net_inkl_alt', '5790000704842']);
  const day = must(s.days[0]);
  assert.equal(day.tariff, 'published');
  assert.equal(day.gridTariff?.length, 24);
  assert.equal(day.gridTariff?.[17], 0.5449);
});

test('a zone feed for another zone is rejected', () => {
  assert.throws(() => parseZoneFeed(load('zone_de'), 'fr'), (e: Error) => e instanceof ElpriserParseError && /answered/.test(e.message));
});

test('malformed zone feeds are parse errors', () => {
  const info = { currency: 'EUR', rate: 1 };
  const payloads: unknown[] = [
    [],
    'x',
    null,
    {},
    { zoneInfo: info },
    { zoneInfo: info, days: [] },
    { zoneInfo: { currency: 'EUR', rate: 0 }, days: [{ date: '2026-11-03', prices: [] }] },
    { zoneInfo: { currency: 'EU', rate: 1 }, days: [{ date: '2026-11-03', prices: [] }] },
    { zoneInfo: info, days: [{ date: 'garbage', prices: [] }] },
    { zoneInfo: info, days: [{ date: '2026-02-30', prices: [] }] },
  ];
  for (const p of payloads) assert.throws(() => parseZoneFeed(p, 'de'), ElpriserParseError, JSON.stringify(p));
});

test('malformed hours become unpriced hours', () => {
  const payload = {
    zoneInfo: { currency: 'EUR', rate: 1 },
    days: [
      {
        date: '2026-11-03',
        type: 'actual',
        prices: [
          { hour: 0, eur_mwh: '12' },
          { hour: 1, eur_mwh: true },
          { hour: 2, eur_mwh: NaN },
          { hour: 3, eur_mwh: 5 },
          { hour: 99, eur_mwh: 1 },
          'junk',
          { eur_mwh: 1 },
        ],
      },
    ],
  };
  const s = parseZoneFeed(payload, 'de');
  assert.deepEqual(must(s.days[0]).slots.map((sl) => sl.price), [null, null, null, 0.005]);
});

test('unknown fields are ignored', () => {
  const payload = load('zone_de');
  payload.brand_new_field = { x: 1 };
  payload.days[0].extra = 1;
  assert.notEqual(parseZoneFeed(payload, 'de').days[0]!.slots[0]!.price, null);
});

test('Danish single-purpose endpoints', () => {
  const now = parseDkNow(load('dk_now'));
  assert.deepEqual(now, { on: false, price: 2.9896, hour: 8, area: 'DK1', mode: 'inkl_alt', strategy: 'cheapest_n' });
  const prices = parseDkPrices(load('dk_prices'));
  assert.deepEqual(
    [prices.unit, prices.charges, prices.currentHour, prices.currentPrice],
    ['DKK/kWh', 'historical', 8, 2.9896],
  );
  assert.equal(prices.prices.length, 24);
  assert.equal(prices.prices[8]!.price, 2.9896);
  const sched = parseDkSchedule(load('dk_schedule'));
  assert.deepEqual([sched.strategy, sched.param, sched.onNow, sched.onHours], ['cheapest_n', 6, false, [0, 1, 2, 3, 4, 5]]);
  assert.equal(sched.schedule.length, 24);
});

test('shelly tariff', () => {
  const tariff = parseShellyTariff(load('dk_shelly'));
  assert.equal(tariff.today.length, 24);
  assert.deepEqual(tariff.tomorrow, []);
  const first = must(tariff.today[0]);
  assert.equal(first.currency, 'DKK');
  assert.equal(first.level, 'VERY_CHEAP');
  assert.match(first.startsAtRaw, /\+01:00$/);
  assert.equal(first.startsAt.toISOString(), '2026-11-02T23:00:00.000Z');
});

test('supplier', () => {
  const found = parseSupplier(load('supplier_ok'));
  assert.ok(found.found && found.name && found.address && found.error === null);
  const none = parseSupplier(load('supplier_none'));
  assert.ok(!none.found);
  assert.equal(none.error, 'no_address');
});

test('unexpected shelly shape', () => {
  assert.throws(() => parseShellyTariff({ data: {} }), ElpriserParseError);
  assert.throws(() => parseShellyTariff({ data: { viewer: { homes: [{ currentSubscription: { priceInfo: 5 } }] } } }), ElpriserParseError);
});

test('now/prices/schedule reject non-objects and missing hour', () => {
  assert.throws(() => parseDkNow([]), ElpriserParseError);
  assert.throws(() => parseDkNow({ price: 1 }), ElpriserParseError);
  assert.throws(() => parseDkNow({ hour: 'x' }), ElpriserParseError);
  assert.throws(() => parseDkPrices({ prices: 'x' }), ElpriserParseError);
  assert.throws(() => parseDkSchedule({ schedule: null }), ElpriserParseError);
});

test('parseTimestamp never uses the host time zone for offset-less input', () => {
  assert.equal(parseTimestamp('2026-11-03T08:00:00')?.toISOString(), '2026-11-03T08:00:00.000Z');
  assert.equal(parseTimestamp('2026-11-03T08:00:00Z')?.toISOString(), '2026-11-03T08:00:00.000Z');
  assert.equal(parseTimestamp('2026-11-03T08:00:00+01:00')?.toISOString(), '2026-11-03T07:00:00.000Z');
  assert.equal(parseTimestamp('2026-11-03T12:13:57.958767+00:00')?.toISOString(), '2026-11-03T12:13:57.958Z');
  assert.equal(parseTimestamp('nonsense'), null);
  assert.equal(parseTimestamp(5), null);
  assert.equal(parseTimestamp(''), null);
});

test('Finland is on Helsinki time: hour 0 of a Finnish day is 22:00Z in winter (ENTSO-E: the 2026-11-03 market day starts at 23:00Z = hour 1)', () => {
  const day = (date: string) => ({
    date,
    type: 'actual',
    prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: h === 1 ? 5.77 : h })),
  });
  const feed = (...dates: string[]) => ({
    zone: 'fi',
    generated: '2026-11-03',
    trainedThrough: null,
    unit: 'EUR/MWh',
    zoneInfo: { name: 'FI Finland', country: 'FI', currency: 'EUR', rate: 1, rateDate: '2026-11-03', rateSource: 'ECB' },
    days: dates.map(day),
  });
  const slots = must(parseZoneFeed(feed('2026-11-03'), 'fi').day('2026-11-03')).slots;
  assert.equal(slots[0]!.start.toISOString(), '2026-11-02T22:00:00.000Z');
  assert.equal(slots[1]!.start.toISOString(), '2026-11-02T23:00:00.000Z');
  assert.equal(slots[1]!.priceMwh, 5.77);
  assert.equal(slots[1]!.localStart, '2026-11-03T01:00:00+02:00');
  assert.equal(slots[23]!.start.toISOString(), '2026-11-03T21:00:00.000Z');
  // the clock-change days: 23 hours (no 03:00) and 25 hours (03:00 twice, one value for both)
  const spring = must(parseZoneFeed(feed('2026-03-29'), 'fi').day('2026-03-29')).slots;
  assert.equal(spring.length, 23);
  assert.equal(spring[0]!.start.toISOString(), '2026-03-28T22:00:00.000Z');
  assert.equal(spring[3]!.start.toISOString(), '2026-03-29T01:00:00.000Z'); // 04:00 EEST
  const fall = must(parseZoneFeed(feed('2026-10-25'), 'fi').day('2026-10-25')).slots;
  assert.equal(fall.length, 25);
  assert.equal(fall[0]!.start.toISOString(), '2026-10-24T21:00:00.000Z');
  assert.deepEqual([fall[3]!.start.toISOString(), fall[4]!.start.toISOString()], ['2026-10-25T00:00:00.000Z', '2026-10-25T01:00:00.000Z']);
  assert.deepEqual([fall[3]!.priceMwh, fall[4]!.priceMwh], [3, 3]);
});
