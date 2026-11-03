import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZONES, ZONE_KEYS, UnknownZoneError, isDanish, isZone, parseZone, zoneInfo } from '../src/index.js';
import type { Zone } from '../src/index.js';

// The zone enum of https://elpriser.org/api/openapi.json (checked live in live.test.ts).
const API_ZONES = [
  'dk1', 'dk2', 'no1', 'no2', 'no3', 'no4', 'no5', 'se1', 'se2', 'se3', 'se4', 'fi', 'nl', 'de', 'fr', 'pl',
  'it-n', 'at', 'be', 'ch', 'cz', 'hu', 'si', 'es', 'pt', 'sk', 'gr', 'ro', 'bg', 'hr', 'rs', 'ee', 'lv', 'lt',
  'me', 'mk', 'al', 'xk', 'gb', 'ie',
];

test('all forty zones in API order', () => {
  assert.deepEqual([...ZONE_KEYS], API_ZONES);
  assert.deepEqual(Object.keys(ZONES), API_ZONES);
  assert.equal(ZONE_KEYS.length, 40);
});

test('every zone has valid metadata and a time zone this runtime knows', () => {
  for (const key of ZONE_KEYS) {
    const z = ZONES[key];
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: z.timeZone }), key);
    assert.equal(z.currency.length, 3, key);
    assert.equal(z.country.length, 2, key);
    assert.ok(z.label, key);
    assert.equal(z.area !== null, z.group === 'dk', key);
  }
});

test('currencies other than euro', () => {
  const nonEur = Object.fromEntries(ZONE_KEYS.filter((k) => ZONES[k].currency !== 'EUR').map((k) => [k, ZONES[k].currency]));
  assert.deepEqual(nonEur, {
    dk1: 'DKK', dk2: 'DKK', no1: 'NOK', no2: 'NOK', no3: 'NOK', no4: 'NOK', no5: 'NOK',
    se1: 'SEK', se2: 'SEK', se3: 'SEK', se4: 'SEK', pl: 'PLN', gb: 'GBP',
  });
});

test('time zones: Nordic and NL feed zones are on Copenhagen time, the others on their own clock', () => {
  for (const k of ZONE_KEYS.filter((k) => ZONES[k].group !== 'eu')) assert.equal(ZONES[k].timeZone, 'Europe/Copenhagen', k);
  assert.equal(ZONES.de.timeZone, 'Europe/Berlin');
  assert.equal(ZONES.gb.timeZone, 'Europe/London');
  assert.equal(ZONES.pt.timeZone, 'Europe/Lisbon');
  assert.equal(ZONES.xk.timeZone, 'Europe/Belgrade');
  assert.equal(ZONES.fi.timeZone, 'Europe/Copenhagen');
});

test('Danish zones', () => {
  assert.equal(ZONES.dk1.area, 'DK1');
  assert.equal(ZONES.dk2.area, 'DK2');
  assert.deepEqual(ZONE_KEYS.filter(isDanish), ['dk1', 'dk2']);
});

test('parseZone accepts the spellings Python accepts', () => {
  const cases: Array<[string, Zone]> = [['de', 'de'], ['DE', 'de'], [' de ', 'de'], ['it-n', 'it-n'], ['IT_N', 'it-n'], ['it_n', 'it-n']];
  for (const [text, expected] of cases) assert.equal(parseZone(text), expected, text);
});

test('parseZone rejects unknown zones with a helpful UnknownZoneError', () => {
  for (const bad of ['xx', '', 'dk3', 'it', null, 5, undefined] as unknown as string[]) {
    assert.throws(() => parseZone(bad), (e: Error) => e instanceof UnknownZoneError && /valid zones/.test(e.message), String(bad));
  }
});

test('isZone is exact', () => {
  assert.ok(isZone('de'));
  assert.ok(!isZone('DE'));
  assert.ok(!isZone('toString'));
  assert.ok(!isZone('__proto__'));
});

test('zoneInfo returns the row plus the key', () => {
  assert.deepEqual(zoneInfo('PL'), { key: 'pl', ...ZONES.pl });
});
