#!/usr/bin/env node
/** Smoke test against the live elpriser.org API. Run: npm test */
import { createElpriserClient } from './index.js';
import assert from 'node:assert/strict';

const c = createElpriserClient();
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     └─ ${(e.message || e).split('\n')[0]}`); fail++; }
};

await t('now() returns a numeric price + hour', async () => {
  const r = await c.now({ area: 'DK1' });
  assert.equal(typeof r.hour, 'number');
  assert.ok(r.price == null || typeof r.price === 'number');
  assert.equal(r.area, 'DK1');
});

await t('prices() returns 24 hourly points', async () => {
  const r = await c.prices({ area: 'DK2', mode: 'spot_inkl' });
  assert.ok(Array.isArray(r.prices) && r.prices.length === 24);
});

await t('schedule(cheapest_n, hours=4) marks exactly 4 hours on', async () => {
  const r = await c.schedule({ area: 'DK1', strategy: 'cheapest_n', hours: 4 });
  assert.equal(r.schedule.filter(s => s.on).length, 4);
});

await t('forecast() returns 7 days', async () => {
  const r = await c.forecast({ area: 'DK1' });
  assert.equal(r.days.length, 7);
});

await t('shellyTariff() returns Tibber-shaped data', async () => {
  const r = await c.shellyTariff({ area: 'DK1' });
  assert.ok(r?.data?.viewer?.homes?.[0]?.currentSubscription?.priceInfo);
});

await t('supplierLookup() resolves a known address', async () => {
  const r = await c.supplierLookup({ lat: 56.179, lng: 10.187 });
  assert.ok('name' in r);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
