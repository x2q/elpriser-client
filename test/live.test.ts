// Opt-in checks against the real https://elpriser.org API:
//
//   ELPRISER_LIVE=1 npm test
//
// Skipped otherwise (CI and a plain `npm test` never touch the network). Read-only GETs, a handful.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Elpriser, MODES, STRATEGIES, ZONE_KEYS, priceLevels } from '../src/index.js';

const live = process.env['ELPRISER_LIVE'] === '1';
const opts = { skip: live ? false : 'set ELPRISER_LIVE=1 to talk to elpriser.org' };
const api = new Elpriser({ userAgent: 'elpriser-client-tests/live', retries: 3 });

test('zone, mode and strategy lists equal the API spec', opts, async () => {
  const spec = (await api.getJson('/api/openapi.json')) as any;
  assert.deepEqual([...ZONE_KEYS], spec.paths['/api/nordic'].get.parameters[0].schema.enum);
  const params = Object.fromEntries(spec.paths['/api/schedule'].get.parameters.map((p: any) => [p.name, p]));
  assert.deepEqual([...MODES], params.mode.schema.enum);
  assert.deepEqual([...STRATEGIES], params.strategy.schema.enum);
});

test('a zone feed parses and has a price for the zone\'s local today', opts, async () => {
  const s = await api.zoneFeed('se3');
  assert.equal(s.currency, 'SEK');
  assert.ok(s.today().length >= 23);
});

test('levels equal the API\'s Tibber levels', opts, async () => {
  const tariff = await api.shellyTariff('DK1');
  assert.deepEqual(priceLevels(tariff.today.map((t) => t.total)), tariff.today.map((t) => t.level));
});
