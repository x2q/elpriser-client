/**
 * elpriser-client — tiny, zero-dependency client for the elpriser.org API.
 *
 * Danish electricity prices (DK1/DK2): current price, 24h prices, cheapest
 * hours, 7-day forecast, Tibber-compatible tariff, and net-company lookup.
 *
 * Works in the browser and Node.js ≥ 18 (uses the global `fetch`). For older
 * Node, pass your own fetch via `createElpriserClient({ fetch })`.
 *
 * Data: elpriser.org → Energi Data Service (Energinet) / Nord Pool. No key.
 */

const DEFAULT_BASE = 'https://elpriser.org';

export function createElpriserClient(options = {}) {
  const base = (options.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const doFetch = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) {
    throw new Error('No global fetch available — pass options.fetch (Node < 18).');
  }

  async function get(path, params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const q = qs.toString();
    const res = await doFetch(`${base}${path}${q ? '?' + q : ''}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`elpriser.org API ${res.status} for ${path}`);
    return res.json();
  }

  return {
    /** Current price (this hour) + whether a schedule strategy says ON now. */
    now: (o = {}) =>
      get('/api/now', { area: 'DK1', mode: 'inkl_alt', ...o }),
    /** 24 hourly prices for a date (default today). */
    prices: (o = {}) =>
      get('/api/prices', { area: 'DK1', mode: 'inkl_alt', ...o }),
    /** Full 24h ON/OFF schedule for a strategy (e.g. cheapest_n). */
    schedule: (o = {}) =>
      get('/api/schedule', { area: 'DK1', mode: 'inkl_alt', strategy: 'cheapest_n', ...o }),
    /** 7-day price forecast (actual for today/tomorrow, estimate beyond). */
    forecast: (o = {}) =>
      get('/api/forecast', { area: 'DK1', mode: 'inkl_alt', ...o }),
    /** Tibber-compatible JSON (today + tomorrow) for Shelly / Home Assistant. */
    shellyTariff: (o = {}) =>
      get('/api/shelly/tariff', { area: 'DK1', mode: 'inkl_alt', ...o }),
    /** Net company (netselskab) for a lat/lng. */
    supplierLookup: (o) =>
      get('/api/supplierlookup', { lat: o.lat, lng: o.lng }),
  };
}

export default createElpriserClient;
