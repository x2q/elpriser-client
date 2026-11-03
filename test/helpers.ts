import { readFileSync } from 'node:fs';
import type { FetchLike, FetchResponseLike } from '../src/index.js';

/** A recorded API answer (test/fixtures, recorded 2026-11-03 from the live API). */
export function load(name: string): any {
  return JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}.json`, import.meta.url), 'utf8'));
}

export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

/** A plain-object response (also proves the client only needs the structural `FetchResponseLike`). */
export function reply(status: number, body: string, headers: Record<string, string> = {}): FetchResponseLike {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

export function ok(payload: unknown, headers: Record<string, string> = {}): FetchResponseLike {
  return reply(200, JSON.stringify(payload), headers);
}

export function fail(status: number, message = 'boom', headers: Record<string, string> = {}): FetchResponseLike {
  return reply(status, JSON.stringify({ error: message }), headers);
}

export interface Call {
  url: string;
  init: { method: string; headers: Record<string, string>; signal: any };
}

type Item = FetchResponseLike | Error | ((url: string, init: Call['init']) => Promise<FetchResponseLike>);

export interface Fake {
  fetch: FetchLike;
  calls: Call[];
  urls: string[];
}

function recorder(answer: (url: string, init: Call['init']) => Promise<FetchResponseLike>): Fake {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  return { fetch, calls, get urls() { return calls.map((c) => c.url); } };
}

/** A fetch that answers from a queue (the last item repeats) and records its calls. */
export function fakeFetch(...items: Item[]): Fake {
  const queue: Item[] = [...items];
  return recorder(async (url, init) => {
    const item = queue.length > 1 ? (queue.shift() as Item) : (queue[0] as Item);
    if (item instanceof Error) throw item;
    if (typeof item === 'function') return item(url, init);
    return item;
  });
}

/** A fetch that answers from a route function and records its calls. */
export function routeFetch(route: (path: string, params: Record<string, string>) => FetchResponseLike): Fake {
  return recorder(async (url) => {
    const u = new URL(url);
    return route(u.pathname, Object.fromEntries(u.searchParams));
  });
}

/** Serve the recorded answer that matches a request. */
export function fixtureRoute(path: string, params: Record<string, string>): FetchResponseLike {
  if (path === '/api/nordic') return ok(load(`zone_${(params['zone'] ?? '').replace('-', '_')}`));
  const table: Record<string, string> = {
    '/api/forecast': (params['mode'] ?? '').startsWith('net_') ? 'dk_forecast_net' : 'dk_forecast',
    '/api/now': 'dk_now',
    '/api/prices': 'dk_prices',
    '/api/schedule': 'dk_schedule',
    '/api/shelly/tariff': 'dk_shelly',
    '/api/supplierlookup': 'supplier_ok',
  };
  const name = table[path];
  return name ? ok(load(name)) : fail(404, 'no such fixture');
}

export function fixtures(): Fake {
  return routeFetch(fixtureRoute);
}

export function query(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams);
}

export function pathOf(url: string): string {
  return new URL(url).pathname;
}

/** A sleep that records instead of waiting. */
export function recordSleeps(): { sleep: (ms: number) => Promise<void>; sleeps: number[] } {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms) => void sleeps.push(ms) };
}
