// The same through require(): `require('elpriser-client')` resolves to dist/cjs.
'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const pkg = require('elpriser-client');

const fixture = (name) => readFileSync(join(__dirname, '..', 'fixtures', `${name}.json`), 'utf8');
const fakeFetch = async () => ({ status: 200, headers: { get: () => null }, text: async () => fixture('zone_de') });

test('CJS entry: the new SDK works', async () => {
  const s = await new pkg.Elpriser({ fetch: fakeFetch }).series('de');
  assert.equal(s.zone, 'de');
  assert.equal(s.cheapestHours(2, { day: '2026-11-03' }).length, 2);
  assert.ok(new pkg.NotFoundError('x', { status: 404, url: 'u', body: null }) instanceof pkg.ApiError);
});

test('CJS entry: the 1.0.0 surface is there (named and default)', () => {
  assert.equal(typeof pkg.createElpriserClient, 'function');
  assert.equal(pkg.default, pkg.createElpriserClient);
});

test('CJS and ESM are two builds of the same API', async () => {
  const esm = await import('elpriser-client');
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(pkg).filter((k) => k !== '__esModule').sort());
});
