/**
 * The few things the client needs from the host runtime, reached through `globalThis` so the core
 * has no Node-only imports and no dependency on the DOM or Node type packages: `fetch`,
 * `AbortController` and timers exist in Node >= 18, browsers, Deno, Bun and Cloudflare Workers.
 */

/** The part of a `Response` the client reads. The global `Response` satisfies it. */
export interface FetchResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/**
 * A `fetch` implementation. The global `fetch`, `node-fetch`, `undici.fetch` and test doubles all
 * fit. It is called as `fetch(url, { method: 'GET', headers, signal })`.
 */
export type FetchLike = (input: string, init?: any) => Promise<FetchResponseLike>;

/** The part of an `AbortSignal` the client uses. The global `AbortSignal` satisfies it. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

interface AbortControllerLike {
  readonly signal: AbortSignalLike;
  abort(reason?: unknown): void;
}

interface Globals {
  fetch?: FetchLike;
  AbortController?: new () => AbortControllerLike;
  setTimeout?: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  process?: { versions?: { node?: string } };
  Deno?: unknown;
  Bun?: unknown;
  document?: unknown;
}

const g = globalThis as unknown as Globals;

export function hasGlobalFetch(): boolean {
  return typeof g.fetch === 'function';
}

/**
 * The global `fetch`, looked up at call time and always invoked as a plain function (browsers
 * and Workers throw "Illegal invocation" when `fetch` is called as a method of another object).
 */
export const globalFetch: FetchLike = (input, init) => {
  const f = g.fetch;
  if (typeof f !== 'function') throw new TypeError('fetch is not available in this runtime');
  return f(input, init);
};

/** Whether setting a `User-Agent` is useful by default: server runtimes yes, browsers no (it would trigger a CORS preflight). */
export function defaultSendsUserAgent(): boolean {
  if (g.document !== undefined) return false;
  return typeof g.process?.versions?.node === 'string' || g.Deno !== undefined || g.Bun !== undefined;
}

export interface Deadline {
  readonly signal: AbortSignalLike;
  /** `true` when the deadline (not a caller's signal) aborted the request. */
  timedOut(): boolean;
  cleanup(): void;
}

/**
 * A signal that aborts after `timeoutMs`, or as soon as any of `signals` aborts. Does not use
 * `AbortSignal.timeout`/`AbortSignal.any`, which Node 18 lacks.
 */
export function deadline(timeoutMs: number, signals: readonly AbortSignalLike[]): Deadline {
  const AC = g.AbortController;
  if (AC === undefined || g.setTimeout === undefined || g.clearTimeout === undefined) {
    throw new TypeError('AbortController and timers are required');
  }
  const controller = new AC();
  let timedOut = false;
  const listeners: Array<[AbortSignalLike, () => void]> = [];
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      continue;
    }
    const onAbort = (): void => controller.abort(s.reason);
    s.addEventListener('abort', onAbort, { once: true });
    listeners.push([s, onAbort]);
  }
  const handle = g.setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('timeout'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      (g.clearTimeout as (h: unknown) => void)(handle);
      for (const [s, fn] of listeners) s.removeEventListener('abort', fn);
    },
  };
}

/** Sleep `ms`, rejecting with the signal's reason if one of `signals` aborts meanwhile. */
export function sleep(ms: number, signals: readonly AbortSignalLike[] = []): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const setT = g.setTimeout;
    const clearT = g.clearTimeout;
    if (setT === undefined || clearT === undefined) {
      reject(new TypeError('timers are required'));
      return;
    }
    const listeners: Array<[AbortSignalLike, () => void]> = [];
    const done = (): void => {
      for (const [s, fn] of listeners) s.removeEventListener('abort', fn);
    };
    const handle = setT(() => {
      done();
      resolve();
    }, ms);
    for (const s of signals) {
      const onAbort = (): void => {
        clearT(handle);
        done();
        reject(s.reason);
      };
      if (s.aborted) {
        onAbort();
        return;
      }
      s.addEventListener('abort', onAbort, { once: true });
      listeners.push([s, onAbort]);
    }
  });
}
