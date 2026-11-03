import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ApiError,
  BadRequestError,
  DEFAULT_USER_AGENT,
  Elpriser,
  ElpriserError,
  ElpriserNetworkError,
  ElpriserParseError,
  ElpriserTimeoutError,
  InvalidArgumentError,
  NotFoundError,
  RateLimitError,
  ServerError,
  UnknownZoneError,
  VERSION,
} from '../src/index.js';
import type { ElpriserOptions } from '../src/index.js';
import { fail, fakeFetch, fixtures, load, must, ok, pathOf, query, recordSleeps, reply } from './helpers.js';

const AT = new Date('2026-11-03T07:20:00Z');
const hang = (_url: string, init: { signal: any }) =>
  new Promise<never>((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));

function client(fake: { fetch: ElpriserOptions['fetch'] }, extra: ElpriserOptions = {}) {
  return new Elpriser({ fetch: fake.fetch, backoffMs: 0, ...extra });
}

test('headers: Accept, and the default User-Agent in Node', async () => {
  const f = fixtures();
  await client(f).now('de', { at: AT });
  const call = must(f.calls[0]);
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.headers['Accept'], 'application/json');
  assert.equal(call.init.headers['User-Agent'], DEFAULT_USER_AGENT);
  assert.match(DEFAULT_USER_AGENT, /^elpriser-client\/\d+\.\d+\.\d+ \(\+https:\/\/elpriser\.org\)$/);
  assert.equal(new URL(call.url).host, 'elpriser.org');
  assert.ok(call.init.signal);
});

test('userAgent: custom, and null sends none', async () => {
  const f = fixtures();
  await client(f, { userAgent: 'my-app/2.0' }).series('xk');
  assert.equal(must(f.calls[0]).init.headers['User-Agent'], 'my-app/2.0');
  const g = fixtures();
  const c = client(g, { userAgent: null });
  await c.series('xk');
  assert.equal(c.userAgent, null);
  assert.ok(!('User-Agent' in must(g.calls[0]).init.headers));
});

test('in a browser (a global document) no User-Agent is sent by default, to avoid a CORS preflight', async () => {
  const g = globalThis as any;
  g.document = {};
  try {
    const f = fixtures();
    await client(f).series('xk');
    assert.ok(!('User-Agent' in must(f.calls[0]).init.headers));
    const forced = fixtures();
    await client(forced, { userAgent: 'x/1' }).series('xk');
    assert.equal(must(forced.calls[0]).init.headers['User-Agent'], 'x/1');
  } finally {
    delete g.document;
  }
});

test('custom base URL, trailing slash stripped', async () => {
  const f = fixtures();
  await client(f, { baseUrl: 'http://localhost:8788/' }).series('de');
  assert.equal(must(f.urls[0]), 'http://localhost:8788/api/nordic?zone=de');
});

test('constructor validation', () => {
  const bad: ElpriserOptions[] = [
    { timeoutMs: 0 },
    { timeoutMs: -5 },
    { timeoutMs: NaN },
    { retries: -1 },
    { retries: 1.5 },
    { backoffMs: -1 },
    { baseUrl: 'ftp://x' },
    { baseUrl: 'file:///etc' },
    { baseUrl: 'elpriser.org' },
  ];
  for (const o of bad) assert.throws(() => new Elpriser({ ...o, fetch: fixtures().fetch }), InvalidArgumentError, JSON.stringify(o));
});

test('without a global fetch and without options.fetch the constructor says so', () => {
  const g = globalThis as any;
  const saved = g.fetch;
  g.fetch = undefined;
  try {
    assert.throws(() => new Elpriser(), InvalidArgumentError);
    assert.doesNotThrow(() => new Elpriser({ fetch: fixtures().fetch }));
  } finally {
    g.fetch = saved;
  }
});

test('the global fetch is used, looked up at call time and called as a plain function', async () => {
  const g = globalThis as any;
  const saved = g.fetch;
  let seenThis: unknown = 'unset';
  g.fetch = function (this: unknown, url: string) {
    seenThis = this;
    return fixtures().fetch(url);
  };
  try {
    const c = new Elpriser();
    g.fetch = function (this: unknown, url: string) { // replaced after construction: still picked up
      seenThis = this;
      return fixtures().fetch(url);
    };
    assert.equal((await c.series('de')).zone, 'de');
    assert.equal(seenThis, undefined);
  } finally {
    g.fetch = saved;
  }
});

test('a user fetch is also called as a plain function (browsers throw on obj.fetch())', async () => {
  let seenThis: unknown = 'unset';
  const f = fixtures();
  const c = new Elpriser({
    fetch: function (this: unknown, url: string, init?: unknown) {
      seenThis = this;
      return f.fetch(url, init);
    },
  });
  await c.series('de');
  assert.equal(seenThis, undefined);
});

test('works with a real Response object', async () => {
  const R = (globalThis as any).Response;
  const c = new Elpriser({ fetch: async () => new R(JSON.stringify(load('zone_de')), { status: 200, headers: { 'content-type': 'application/json' } }) });
  assert.equal((await c.series('de')).currency, 'EUR');
  const bad = new Elpriser({ fetch: async () => new R('{"error":"nope"}', { status: 400 }), retries: 0 });
  await assert.rejects(bad.series('de'), BadRequestError);
});

// -- which endpoint ---------------------------------------------------------------------------

test('a non-Danish zone uses the zone feed', async () => {
  const f = fixtures();
  const s = await client(f).series('se3');
  assert.equal(pathOf(must(f.urls[0])), '/api/nordic');
  assert.deepEqual(query(must(f.urls[0])), { zone: 'se3' });
  assert.equal(s.currency, 'SEK');
});

test('a Danish zone defaults to the tariff-aware forecast feed', async () => {
  const f = fixtures();
  const s = await client(f).series('dk1');
  assert.equal(pathOf(must(f.urls[0])), '/api/forecast');
  assert.deepEqual(query(must(f.urls[0])), { area: 'DK1', mode: 'inkl_alt' });
  assert.deepEqual([s.source, s.currency], ['dk-forecast', 'DKK']);
});

test('Danish mode and gln', async () => {
  const f = fixtures();
  const c = client(f);
  const s = await c.series('dk2', { mode: 'net_inkl_alt', gln: '5790000704842' });
  assert.deepEqual(query(must(f.urls[0])), { area: 'DK2', mode: 'net_inkl_alt', gln: '5790000704842' });
  assert.deepEqual([s.mode, s.gln], ['net_inkl_alt', '5790000704842']);
  assert.ok(must(s.days[0]).gridTariff);
  await c.series('dk1', { mode: 'spot_ex' });
  assert.equal(query(must(f.urls[1]))['mode'], 'spot_ex');
});

test('zoneFeed for a Danish zone is the plain spot feed', async () => {
  const f = fixtures();
  const s = await client(f).zoneFeed('dk1');
  assert.deepEqual(query(must(f.urls[0])), { zone: 'dk1' });
  assert.deepEqual([s.unit, s.currency, s.rate, s.source], ['EUR/MWh', 'DKK', 7.4737, 'zone-feed']);
});

test('invalid parameters fail before any request, as a rejected promise', async () => {
  const f = fixtures();
  const c = client(f);
  const cases: Array<[() => Promise<unknown>, RegExp]> = [
    [() => c.series('de', { mode: 'spot_ex' }), /only apply to the Danish/],
    [() => c.series('de', { gln: '5790000704842' }), /only apply to the Danish/],
    [() => c.series('dk1', { mode: 'net_inkl_alt' }), /needs gln/],
    [() => c.series('dk1', { mode: 'bogus' as any }), /unknown mode/],
  ];
  for (const [call, match] of cases) {
    let promise: Promise<unknown> | undefined;
    assert.doesNotThrow(() => (promise = call())); // never a synchronous throw
    await assert.rejects(must(promise), (e: Error) => e instanceof InvalidArgumentError && match.test(e.message));
  }
  assert.equal(f.calls.length, 0);
});

test('an unknown zone fails before any request', async () => {
  const f = fixtures();
  await assert.rejects(client(f).now('narnia' as any), UnknownZoneError);
  assert.equal(f.calls.length, 0);
});

test('zone spellings are accepted', async () => {
  const f = fakeFetch(fail(404, 'no fixture for this test'));
  const c = client(f);
  for (const z of ['DE', 'IT-N', 'it_n', ' se3 ']) await c.series(z as any).catch(() => undefined);
  assert.deepEqual(f.urls.map((u) => query(u)['zone']), ['de', 'it-n', 'it-n', 'se3']);
});

test('convenience methods', async () => {
  const f = fixtures();
  const c = client(f);
  assert.equal(must(await c.now('de', { at: AT })).priceMwh, 301.31);
  assert.equal(must(await c.nextHour('de', { at: AT })).hour, 9);
  assert.equal((await c.today('de', { at: AT })).length, 24);
  assert.equal(must((await c.tomorrow('de', { at: AT }))[0]).kind, 'forecast');
  const today = await c.today('de', { at: AT });
  const expected = [...today].sort((a, b) => a.price! - b.price! || a.start.getTime() - b.start.getTime()).slice(0, 2);
  assert.deepEqual(
    await c.cheapestHours('de', 2, { day: '2026-11-03' }),
    expected.sort((a, b) => a.start.getTime() - b.start.getTime()),
  );
  assert.equal(must(await c.bestWindow('de', 3, { day: '2026-11-03' })).hours, 3);
  const days = await c.forecast('de');
  assert.deepEqual(days.map((d) => d.horizon), [2, 3, 4, 5, 6, 7]);
  assert.ok(days.every((d) => d.isForecast));
  assert.equal((await c.levels('de', { at: AT })).length, 24);
});

test('every convenience call makes exactly one request', async () => {
  const f = fixtures();
  const c = client(f);
  await c.now('de');
  await c.cheapestHours('se3', 4);
  await c.bestWindow('pl', 3);
  assert.equal(f.calls.length, 3);
});

test('gb now needs the estimate flag', async () => {
  const c = client(fixtures());
  assert.equal(await c.now('gb', { at: AT }), null);
  assert.equal(must(await c.now('gb', { at: AT, estimate: true })).kind, 'estimate');
});

test('the Danish endpoints', async () => {
  const f = fixtures();
  const c = client(f);
  const url = () => must(f.urls.at(-1));
  const now = await c.dkNow('DK1', { strategy: 'cheapest_n', hours: 6 });
  assert.deepEqual([now.price, now.hour], [2.9896, 8]);
  assert.deepEqual(query(url()), { area: 'DK1', mode: 'inkl_alt', strategy: 'cheapest_n', hours: '6' });
  const prices = await c.dkPrices('dk2', { date: '2026-11-03', charges: 'current' });
  assert.equal(prices.prices.length, 24);
  assert.deepEqual(query(url()), { area: 'DK2', mode: 'inkl_alt', date: '2026-11-03', charges: 'current' });
  const sched = await c.dkSchedule('dk1', { strategy: 'cheapest_n', hours: 6, date: '2026-11-03', maxOff: 4, pct: 20 });
  assert.deepEqual(sched.onHours, [0, 1, 2, 3, 4, 5]);
  assert.equal(pathOf(url()), '/api/schedule');
  assert.deepEqual(query(url()), { area: 'DK1', mode: 'inkl_alt', strategy: 'cheapest_n', hours: '6', pct: '20', max_off: '4', date: '2026-11-03' });
  const tariff = await c.shellyTariff();
  assert.equal(tariff.today.length, 24);
  assert.equal(pathOf(url()), '/api/shelly/tariff');
  assert.deepEqual(query(url()), { area: 'DK1', mode: 'inkl_alt' });
  const sup = await c.supplierLookup(55.6761, 12.5683);
  assert.ok(sup.found);
  assert.deepEqual(query(url()), { lat: '55.6761', lng: '12.5683' });
});

test('Danish endpoint parameter validation', async () => {
  const f = fixtures();
  const c = client(f);
  const cases: Array<[() => Promise<unknown>, RegExp]> = [
    [() => c.dkNow('DK3' as any), /area must be DK1 or DK2/],
    [() => c.dkNow('DK1', { strategy: 'nope' as any }), /unknown strategy/],
    [() => c.dkNow('DK1', { hours: 24 }), /hours must be/],
    [() => c.dkNow('DK1', { hours: 1.5 }), /hours must be/],
    [() => c.dkNow('DK1', { pct: 0 }), /pct must be/],
    [() => c.dkSchedule('DK1', { maxOff: 13 }), /maxOff must be/],
    [() => c.dkPrices('DK1', { date: '03-11-2026' }), /YYYY-MM-DD/],
    [() => c.dkPrices('DK1', { date: '2026-02-30' }), /YYYY-MM-DD/],
    [() => c.dkPrices('DK1', { charges: 'x' as any }), /charges must be/],
    [() => c.dkPrices('DK1', { mode: 'net_inkl_tarif' }), /needs gln/],
    [() => c.supplierLookup(95, 0), /lat must be/],
    [() => c.supplierLookup(0, 'x' as any), /lng must be/],
    [() => c.supplierLookup(NaN, 0), /lat must be/],
  ];
  for (const [call, match] of cases) {
    await assert.rejects(call(), (e: Error) => e instanceof InvalidArgumentError && match.test(e.message), String(match));
  }
  assert.equal(f.calls.length, 0);
});

test('getJson is the escape hatch', async () => {
  const f = fixtures();
  const c = client(f);
  const json = (await c.getJson('/api/now', { area: 'DK1', mode: undefined, strategy: null, hours: 3, flag: true })) as { hour: number };
  assert.equal(json.hour, 8);
  assert.deepEqual(query(must(f.urls[0])), { area: 'DK1', hours: '3', flag: 'true' });
});

test('query values are percent-encoded', async () => {
  const f = fixtures();
  await client(f).getJson('/api/x', { q: 'a b&c=d' }).catch(() => undefined);
  assert.equal(must(f.urls[0]), 'https://elpriser.org/api/x?q=a%20b%26c%3Dd');
});

// -- errors, retries, timeouts -----------------------------------------------------------------

test('HTTP errors are typed, carry status/body/url, and are not retried', async () => {
  const cases: Array<[number, new (...a: any[]) => ApiError | Error]> = [
    [400, BadRequestError],
    [404, NotFoundError],
    [403, ApiError],
    [418, ApiError],
  ];
  for (const [status, Cls] of cases) {
    const f = fakeFetch(fail(status, 'nope'));
    await assert.rejects(client(f).series('de'), (e: any) => {
      assert.ok(e instanceof Cls, `${status}`);
      assert.ok(e instanceof ApiError && e instanceof ElpriserError && e instanceof Error);
      assert.equal(e.status, status);
      assert.deepEqual(e.body, { error: 'nope' });
      assert.match(e.message, /nope/);
      assert.match(e.url, /nordic/);
      assert.equal(e.name, Cls.name);
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
  assert.equal(
    (await client(fakeFetch(fail(403))).series('de').catch((e) => e)).constructor,
    ApiError,
  );
});

test('the API error text is surfaced', async () => {
  await assert.rejects(client(fakeFetch(fail(400, 'zone must be one of: dk1, dk2'))).series('de'), /zone must be one of/);
});

test('a non-JSON error body is summarised and kept as text', async () => {
  const f = fakeFetch(reply(403, '<html>Cloudflare says no</html>'));
  await assert.rejects(client(f).series('de'), (e: any) => {
    assert.ok(e instanceof ApiError);
    assert.match(e.message, /Cloudflare says no/);
    assert.equal(e.body, '<html>Cloudflare says no</html>');
    return true;
  });
  await assert.rejects(client(fakeFetch(reply(403, ''))).series('de'), /no message/);
});

test('5xx is retried, then succeeds; the delay is exponential backoff', async () => {
  const { sleep, sleeps } = recordSleeps();
  const f = fakeFetch(fail(503), fail(502), ok(load('zone_de')));
  const c = new Elpriser({ fetch: f.fetch, retries: 2, backoffMs: 500, sleep });
  assert.equal((await c.series('de')).zone, 'de');
  assert.equal(f.calls.length, 3);
  assert.deepEqual(sleeps, [500, 1000]);
});

test('gives up after the retries with a ServerError that carries Retry-After', async () => {
  const { sleep } = recordSleeps();
  const f = fakeFetch(fail(503, 'down', { 'Retry-After': '7' }));
  await assert.rejects(new Elpriser({ fetch: f.fetch, retries: 2, sleep }).series('de'), (e: any) => {
    assert.ok(e instanceof ServerError);
    assert.deepEqual([e.status, e.retryAfter], [503, 7]);
    return true;
  });
  assert.equal(f.calls.length, 3);
});

test('Retry-After is honoured and capped at 30 s', async () => {
  const { sleep, sleeps } = recordSleeps();
  const f = fakeFetch(fail(429, 'slow down', { 'retry-after': '3' }), fail(429, 'slow down', { 'retry-after': '999' }), ok(load('zone_de')));
  await new Elpriser({ fetch: f.fetch, retries: 2, backoffMs: 100, sleep }).series('de');
  assert.deepEqual(sleeps, [3000, 30_000]);
});

test('Retry-After as an HTTP date', async () => {
  const { sleep, sleeps } = recordSleeps();
  const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
  const f = fakeFetch(fail(429, 'x', { 'Retry-After': inTenSeconds }), ok(load('zone_de')));
  await new Elpriser({ fetch: f.fetch, retries: 1, sleep }).series('de');
  const waited = must(sleeps[0]);
  assert.ok(waited > 7_000 && waited <= 10_000, String(waited));
});

test('an unusable Retry-After falls back to the backoff', async () => {
  const { sleep, sleeps } = recordSleeps();
  const f = fakeFetch(fail(503, 'x', { 'Retry-After': 'soon' }), ok(load('zone_de')));
  await new Elpriser({ fetch: f.fetch, retries: 1, backoffMs: 250, sleep }).series('de');
  assert.deepEqual(sleeps, [250]);
});

test('RateLimitError after the retries', async () => {
  const { sleep } = recordSleeps();
  const f = fakeFetch(fail(429, 'slow down', { 'retry-after': '2' }));
  await assert.rejects(new Elpriser({ fetch: f.fetch, retries: 1, sleep }).series('de'), (e: any) => {
    assert.ok(e instanceof RateLimitError);
    assert.equal(e.retryAfter, 2);
    return true;
  });
  assert.equal(f.calls.length, 2);
});

test('retries: 0 means one attempt', async () => {
  const f = fakeFetch(fail(500));
  await assert.rejects(new Elpriser({ fetch: f.fetch, retries: 0 }).series('de'), ServerError);
  assert.equal(f.calls.length, 1);
});

test('a timeout is retried, then raised as ElpriserTimeoutError with the cause', async () => {
  const { sleep, sleeps } = recordSleeps();
  const f = fakeFetch(hang);
  const c = new Elpriser({ fetch: f.fetch, timeoutMs: 15, retries: 2, backoffMs: 10, sleep });
  await assert.rejects(c.series('de'), (e: any) => {
    assert.ok(e instanceof ElpriserTimeoutError && e instanceof ElpriserNetworkError && e instanceof ElpriserError);
    assert.match(e.message, /timed out after 15ms/);
    assert.ok(e.cause instanceof Error);
    return true;
  });
  assert.equal(f.calls.length, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test('a timeout while reading the body counts too', async () => {
  const f = fakeFetch((_url, init) =>
    Promise.resolve({
      status: 200,
      headers: { get: () => null },
      text: () => new Promise<string>((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
    }),
  );
  await assert.rejects(new Elpriser({ fetch: f.fetch, timeoutMs: 15, retries: 0 }).series('de'), ElpriserTimeoutError);
});

test('each attempt gets a fresh signal and the timeout timer is cleaned up', async () => {
  const { sleep } = recordSleeps();
  const f = fakeFetch(fail(503), ok(load('zone_de')));
  await new Elpriser({ fetch: f.fetch, retries: 1, timeoutMs: 60_000, sleep }).series('de');
  const [a, b] = f.calls;
  assert.notEqual(must(a).init.signal, must(b).init.signal);
  // if the 60 s timer were left running, the test process would not exit; reaching here proves it was cleared
});

test('a network error is retried, then raised as ElpriserNetworkError', async () => {
  const { sleep } = recordSleeps();
  const f = fakeFetch(new TypeError('fetch failed'), new TypeError('fetch failed'), ok(load('zone_de')));
  assert.equal((await new Elpriser({ fetch: f.fetch, retries: 2, sleep }).series('de')).zone, 'de');
  const g = fakeFetch(new TypeError('name resolution failed'));
  await assert.rejects(new Elpriser({ fetch: g.fetch, retries: 1, sleep }).series('de'), (e: any) => {
    assert.ok(e instanceof ElpriserNetworkError && !(e instanceof ElpriserTimeoutError));
    assert.match(e.message, /could not reach .*name resolution failed/);
    assert.ok(e.cause instanceof TypeError);
    return true;
  });
  assert.equal(g.calls.length, 2);
});

test('invalid JSON is a parse error (not retried)', async () => {
  const f = fakeFetch(reply(200, '<html>captive portal</html>'));
  await assert.rejects(client(f).series('de'), (e: any) => e instanceof ElpriserParseError && /did not return JSON/.test(e.message));
  assert.equal(f.calls.length, 1);
});

test('a wrong shape is a parse error', async () => {
  await assert.rejects(client(fakeFetch(ok({ zone: 'de', unexpected: true }))).series('de'), ElpriserParseError);
});

test('all errors share a base class', () => {
  for (const E of [ApiError, BadRequestError, NotFoundError, RateLimitError, ServerError, ElpriserTimeoutError, ElpriserNetworkError, ElpriserParseError, InvalidArgumentError, UnknownZoneError]) {
    assert.ok(Object.create(E.prototype) instanceof ElpriserError, E.name);
  }
  assert.ok(Object.create(UnknownZoneError.prototype) instanceof InvalidArgumentError);
  assert.ok(Object.create(ServerError.prototype) instanceof ApiError);
});

// -- abort -------------------------------------------------------------------------------------

test('an already-aborted signal rejects with its reason and makes no request', async () => {
  const f = fixtures();
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(client(f).series('de', { signal: ctrl.signal }), (e: any) => e.name === 'AbortError');
  assert.equal(f.calls.length, 0);
});

test('aborting during a request rethrows the abort reason and does not retry', async () => {
  const f = fakeFetch(hang);
  const ctrl = new AbortController();
  const p = new Elpriser({ fetch: f.fetch, retries: 3, timeoutMs: 60_000 }).series('de', { signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(p, (e: any) => e.name === 'AbortError' && !(e instanceof ElpriserError));
  assert.equal(f.calls.length, 1);
});

test('a custom abort reason is rethrown as is', async () => {
  const f = fakeFetch(hang);
  const ctrl = new AbortController();
  const reason = new Error('user navigated away');
  const p = client(f).series('de', { signal: ctrl.signal });
  setTimeout(() => ctrl.abort(reason), 10);
  await assert.rejects(p, (e) => e === reason);
});

test('aborting during the retry delay stops the retries', async () => {
  const f = fakeFetch(fail(503));
  const ctrl = new AbortController();
  const p = new Elpriser({ fetch: f.fetch, retries: 3, backoffMs: 60_000 }).series('de', { signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(p, (e: any) => e.name === 'AbortError');
  assert.equal(f.calls.length, 1);
});

test('the client-level signal aborts every call', async () => {
  const f = fakeFetch(hang);
  const ctrl = new AbortController();
  const c = new Elpriser({ fetch: f.fetch, signal: ctrl.signal, timeoutMs: 60_000 });
  const p = c.now('de');
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(p, (e: any) => e.name === 'AbortError');
  await assert.rejects(c.series('fr'), (e: any) => e.name === 'AbortError');
  assert.equal(f.calls.length, 1);
});

test('the version constant matches package.json', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
  assert.equal(VERSION, '1.1.1');
});

test('toString does not leak anything but the base URL', () => {
  assert.equal(String(client(fixtures())), 'Elpriser(baseUrl="https://elpriser.org")');
});
