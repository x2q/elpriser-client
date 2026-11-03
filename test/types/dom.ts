// With the DOM lib (browsers, Deno, Workers type setups) the real `fetch` and `AbortSignal` are accepted.
import { Elpriser } from 'elpriser-client';

export const c1 = new Elpriser({ fetch: globalThis.fetch, signal: new AbortController().signal });
export const c2 = new Elpriser({ fetch: fetch });
export const c3 = new Elpriser({ fetch: (input, init) => fetch(input, init) });
export async function run(signal: AbortSignal) {
  return c1.cheapestHours('se3', 3, { signal });
}
