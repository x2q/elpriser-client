// The 1.0.0 public surface must keep working unchanged. test/legacy/index-1.0.0.mjs is the 1.0.0
// source, verbatim (from commit e1ee7a4 of x2q/elpriser-client); every case below runs the same
// calls through it and through the new package with the same fake fetch and requires the same
// URLs, headers, results and error messages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import defaultFactory, * as pkg from '../src/index.js';
import { createElpriserClient, ApiError } from '../src/index.js';
import { load } from './helpers.js';

const old = (await import(new URL('../../test/legacy/index-1.0.0.mjs', import.meta.url).href)) as {
  createElpriserClient: typeof createElpriserClient;
  default: typeof createElpriserClient;
};

interface Seen {
  url: string;
  init: unknown;
}

/** A 1.0.0-style fetch double: `{ ok, status, json() }`, recording what it was called with. */
function legacyFetch(answer: (url: string) => { status: number; body: unknown }) {
  const seen: Seen[] = [];
  const fetch = async (url: string, init?: unknown) => {
    seen.push({ url, init });
    const { status, body } = answer(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, seen };
}

const routes = (url: string) => {
  const path = new URL(url).pathname;
  const table: Record<string, string> = {
    '/api/now': 'dk_now',
    '/api/prices': 'dk_prices',
    '/api/schedule': 'dk_schedule',
    '/api/forecast': 'dk_forecast',
    '/api/shelly/tariff': 'dk_shelly',
    '/api/supplierlookup': 'supplier_ok',
  };
  const name = table[path];
  return name ? { status: 200, body: load(name) } : { status: 404, body: { error: 'nope' } };
};

type Call = (c: ReturnType<typeof createElpriserClient>) => Promise<unknown>;
const calls: Array<[string, Call]> = [
  ['now()', (c) => c.now()],
  ['now({area:DK1})', (c) => c.now({ area: 'DK1' })],
  ['now({area:DK2, mode, strategy, hours})', (c) => c.now({ area: 'DK2', mode: 'spot_inkl', strategy: 'cheapest_n', hours: 3 })],
  ['now with gln', (c) => c.now({ mode: 'net_inkl_alt', gln: '5790000704842' })],
  ['prices()', (c) => c.prices()],
  ['prices({area:DK2, mode:spot_inkl})', (c) => c.prices({ area: 'DK2', mode: 'spot_inkl' })],
  ['prices with date', (c) => c.prices({ date: '2026-11-03' })],
  ['schedule()', (c) => c.schedule()],
  ['schedule(cheapest_n, hours 4)', (c) => c.schedule({ area: 'DK1', strategy: 'cheapest_n', hours: 4 })],
  ['schedule with pct/max_off/date', (c) => c.schedule({ strategy: 'cheapest_pct', pct: 25, max_off: 3, date: '2026-11-03' })],
  ['forecast()', (c) => c.forecast()],
  ['forecast({area:DK2})', (c) => c.forecast({ area: 'DK2' })],
  ['shellyTariff()', (c) => c.shellyTariff()],
  ['shellyTariff({area:DK2, mode})', (c) => c.shellyTariff({ area: 'DK2', mode: 'spot_ex' })],
  ['supplierLookup', (c) => c.supplierLookup({ lat: 56.179, lng: 10.187 })],
  ['supplierLookup with 0', (c) => c.supplierLookup({ lat: 0, lng: 0 })],
  ['undefined and empty options are skipped', (c) => c.now({ area: undefined, gln: '' } as any)],
];

for (const [name, call] of calls) {
  test(`1.0.0 parity: ${name}`, async () => {
    const a = legacyFetch(routes);
    const b = legacyFetch(routes);
    const resultOld = await call(old.createElpriserClient({ fetch: a.fetch as any }));
    const resultNew = await call(createElpriserClient({ fetch: b.fetch as any }));
    assert.deepEqual(b.seen, a.seen); // same URL, same init (headers) — exactly one request
    assert.equal(a.seen.length, 1);
    assert.deepEqual(resultNew, resultOld);
  });
}

test('1.0.0 parity: baseUrl handling', async () => {
  for (const baseUrl of ['http://localhost:8788', 'http://localhost:8788/', 'http://localhost:8788///', undefined, '']) {
    const a = legacyFetch(routes);
    const b = legacyFetch(routes);
    await old.createElpriserClient({ baseUrl, fetch: a.fetch as any }).now();
    await createElpriserClient({ baseUrl, fetch: b.fetch as any }).now();
    assert.deepEqual(b.seen, a.seen, String(baseUrl));
  }
});

test('1.0.0 parity: a non-2xx throws an Error with the same message', async () => {
  for (const status of [400, 404, 429, 500, 503]) {
    const a = legacyFetch(() => ({ status, body: {} }));
    const b = legacyFetch(() => ({ status, body: {} }));
    const errOld = await old.createElpriserClient({ fetch: a.fetch as any }).forecast().catch((e: Error) => e);
    const errNew = await createElpriserClient({ fetch: b.fetch as any }).forecast().catch((e: Error) => e);
    assert.ok(errOld instanceof Error && errNew instanceof Error);
    assert.equal((errNew as Error).message, (errOld as Error).message);
    assert.equal((errNew as Error).message, `elpriser.org API ${status} for /api/forecast`);
    assert.equal(a.seen.length, 1); // no retries in 1.0.0
    assert.equal(b.seen.length, 1);
    // the new one is also a typed ApiError (a subclass of Error), for callers who want the status
    assert.ok(errNew instanceof ApiError && errNew.status === status);
  }
});

test('1.0.0 parity: a body that is not JSON rejects the same way (no retries, no wrapping)', async () => {
  const broken = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  const errOld = await old.createElpriserClient({ fetch: broken as any }).now().catch((e: Error) => e);
  const errNew = await createElpriserClient({ fetch: broken as any }).now().catch((e: Error) => e);
  assert.ok(errOld instanceof SyntaxError && errNew instanceof SyntaxError);
});

test('1.0.0 parity: a network failure propagates as thrown, unwrapped and unretried', async () => {
  let n = 0;
  const boom = async () => { n++; throw new TypeError('fetch failed'); };
  const e1 = await old.createElpriserClient({ fetch: boom as any }).now().catch((e: Error) => e);
  const e2 = await createElpriserClient({ fetch: boom as any }).now().catch((e: Error) => e);
  assert.ok(e1 instanceof TypeError && e2 instanceof TypeError);
  assert.equal(n, 2);
});

test('1.0.0 parity: without a fetch at all the factory throws the same Error', () => {
  const g = globalThis as any;
  const saved = g.fetch;
  g.fetch = undefined;
  try {
    const attempt = (f: () => unknown): Error | undefined => {
      try {
        f();
      } catch (e) {
        return e as Error;
      }
      return undefined;
    };
    const eOld = attempt(() => old.createElpriserClient());
    const eNew = attempt(() => createElpriserClient());
    assert.ok(eOld && eNew);
    assert.equal(eNew.message, eOld.message);
    assert.equal(eNew.message, 'No global fetch available — pass options.fetch (Node < 18).');
  } finally {
    g.fetch = saved;
  }
});

test('1.0.0 parity: the global fetch is captured when the client is created', async () => {
  const g = globalThis as any;
  const saved = g.fetch;
  const a = legacyFetch(routes);
  g.fetch = a.fetch;
  try {
    const c = createElpriserClient();
    g.fetch = async () => { throw new Error('should not be called'); };
    await c.now();
    assert.equal(a.seen.length, 1);
  } finally {
    g.fetch = saved;
  }
});

test('the exports of 1.0.0 are still there: createElpriserClient as named and default export', () => {
  assert.equal(typeof createElpriserClient, 'function');
  assert.equal(defaultFactory, createElpriserClient);
  assert.equal(pkg.createElpriserClient, createElpriserClient);
  assert.equal(old.default, old.createElpriserClient);
  // the 1.0.0 module exposed exactly these two runtime names; the new one only adds
  for (const name of ['createElpriserClient', 'default']) assert.ok(name in pkg, name);
});

test('the old smoke test (test.js of 1.0.0) passes against recorded answers', async () => {
  const f = legacyFetch((url) => {
    const u = new URL(url);
    if (u.pathname === '/api/schedule') {
      const sched = load('dk_schedule');
      if (u.searchParams.get('hours') === '4') {
        sched.schedule = sched.schedule.map((s: any, i: number) => ({ ...s, on: i < 4 }));
      }
      return { status: 200, body: sched };
    }
    return routes(url);
  });
  const c = createElpriserClient({ fetch: f.fetch as any });
  const now = await c.now({ area: 'DK1' });
  assert.equal(typeof now.hour, 'number');
  assert.ok(now.price == null || typeof now.price === 'number');
  assert.equal(now.area, 'DK1');
  const prices = await c.prices({ area: 'DK2', mode: 'spot_inkl' });
  assert.ok(Array.isArray(prices.prices) && prices.prices.length === 24);
  const sched = await c.schedule({ area: 'DK1', strategy: 'cheapest_n', hours: 4 });
  assert.equal(sched.schedule.filter((s) => s.on).length, 4);
  const fc = await c.forecast({ area: 'DK1' });
  assert.ok(fc.days.length >= 7);
  const tariff = (await c.shellyTariff({ area: 'DK1' })) as any;
  assert.ok(tariff?.data?.viewer?.homes?.[0]?.currentSubscription?.priceInfo);
  const sup = await c.supplierLookup({ lat: 56.179, lng: 10.187 });
  assert.ok('name' in sup);
});
