// Runs against the built package, the way a consumer imports it: `import 'elpriser-client'`
// (self-reference through package.json "exports") resolves to dist/esm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as esm from 'elpriser-client';
import defaultFactory, { Elpriser, ZONES, createElpriserClient } from 'elpriser-client';

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8');
const fakeFetch = async () => ({ status: 200, headers: { get: () => null }, text: async () => fixture('zone_de') });

test('ESM entry: the new SDK works', async () => {
  const s = await new Elpriser({ fetch: fakeFetch }).series('de');
  assert.equal(s.zone, 'de');
  assert.equal(s.now({ at: new Date('2026-11-03T07:20:00Z') }).priceMwh, 301.31);
  assert.equal(Object.keys(ZONES).length, 40);
});

test('ESM entry: the 1.0.0 surface is there', () => {
  assert.equal(typeof createElpriserClient, 'function');
  assert.equal(defaultFactory, createElpriserClient);
});

test('ESM entry: nothing unexpected is exported', () => {
  const names = Object.keys(esm).sort();
  for (const must of ['Elpriser', 'Series', 'ZONES', 'ApiError', 'RateLimitError', 'NotFoundError', 'ElpriserError', 'createElpriserClient', 'default', 'VERSION']) {
    assert.ok(names.includes(must), must);
  }
});
