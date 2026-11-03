# elpriser-client

Typed TypeScript/JavaScript SDK for the [elpriser.org](https://elpriser.org) electricity price API:
**40 European price zones**, current and next hour, today and tomorrow hour by hour, cheapest hours,
best window, forecast days with the settled-versus-forecast flag, price levels, and the Danish
tariff-aware endpoints. No API key.

- **No runtime dependencies.** Uses the global `fetch`. Node >= 18, browsers, Deno, Bun, Cloudflare Workers.
- TypeScript source, shipped as **ESM + CommonJS + `.d.ts`**, `sideEffects: false`. The declarations need neither DOM nor Node types.
- Timeouts (`AbortSignal`), retries with `Retry-After` and backoff, typed errors, `signal` support.
- Parity with the [Python SDK](https://github.com/x2q/elpriser-python): same zones, same price arithmetic, same answers (checked against the live API).
- Fully **backward compatible**: `createElpriserClient()` from 1.0.0 keeps working unchanged ([migration](#migrating-from-100)).

The MCP server for LLM clients is [elpriser-mcp](https://github.com/x2q/elpriser-mcp).

## Install

```bash
npm install elpriser-client
```

## Quick start

```ts
import { Elpriser } from 'elpriser-client';

const client = new Elpriser();

const slot = await client.now('de'); // the current hour, or null if it has no price (yet)
console.log(slot?.price, 'EUR/kWh', slot?.localStart); // 0.30131 EUR/kWh 2026-11-03T08:00:00+01:00

for (const s of await client.cheapestHours('se3', 4)) {
  // the 4 cheapest hours in the next 24 h
  console.log(s.localStart, s.price, s.kind); // kind: 'actual' | 'forecast' | 'estimate'
}

const window = await client.bestWindow('nl', 3); // cheapest 3 consecutive hours (EV charging, dishwasher ...)
console.log(window?.localStart, window?.average);
```

Every convenience method makes **one request**. To ask several questions, fetch the series once:

```ts
const s = await client.series('pl'); // one HTTP request
s.now();
s.nextHour();
s.today();
s.tomorrow();
s.cheapestHours(3);
s.bestWindow(2);
s.levels(); // [{ slot, level: 'CHEAP' }, ...] for today
s.forecastDays; // only the days that are forecasts
s.currency, s.rate, s.rateDate; // 'PLN', 4.4185, '2026-11-02'
```

### Node (ESM and CommonJS)

```js
import { Elpriser } from 'elpriser-client'; // or: const { Elpriser } = require('elpriser-client');
const client = new Elpriser({ userAgent: 'my-heatpump/1.0' });
console.log(await client.now('dk1'));
```

### Browser

The API sends full CORS headers, so it works straight from a page. With a bundler (`import { Elpriser } from 'elpriser-client'`)
or without one:

```html
<script type="module">
  import { Elpriser } from 'https://esm.sh/elpriser-client';
  const slot = await new Elpriser().now('dk1');
  document.body.textContent = `${slot?.price} DKK/kWh`;
</script>
```

In a browser the client sends no `User-Agent` (see [Errors, timeouts, retries](#errors-timeouts-retries)).

### Deno and Bun

```ts
import { Elpriser } from 'npm:elpriser-client'; // Deno; in Bun: from 'elpriser-client'
console.log(await new Elpriser().bestWindow('dk2', 3));
```

### Cloudflare Workers

```ts
import { Elpriser } from 'elpriser-client';

export default {
  async fetch(): Promise<Response> {
    const window = await new Elpriser().bestWindow('dk1', 3);
    return Response.json(window); // dates serialise to ISO 8601
  },
};
```

## What the prices are

| Zones | Endpoint | What you get |
|---|---|---|
| `dk1`, `dk2` | `/api/forecast` | **DKK/kWh as a customer pays it**: spot + Energinet's system and transmission tariffs + electricity duty + VAT (`mode: 'inkl_alt'`, the default). `'spot_ex'`, `'net_inkl_alt'` + `gln` (adds one grid company's tariff) and the other modes pick a different price. Today plus nine forecast days. |
| the other 38 | `/api/nordic` | **Spot price only**: no VAT, duties or grid fees, so it is not what a consumer pays. Published in EUR/MWh (GBP/MWh for `gb`) and converted by the client to local currency per kWh with the ECB rate the API sends. |

`Slot.price` is always **local currency per kWh** (`series.currency`, e.g. `'SEK'`). On the zone feed the numbers as
published are kept alongside: `slot.priceMwh` (in `series.unit`, e.g. `'EUR/MWh'`), `series.rate`, `series.rateDate`,
`series.rateSource`. `price == priceMwh * rate / 1000`. `client.zoneFeed('dk1')` gives the plain spot feed for a Danish
zone as well.

### Zones

```ts
import { ZONES, ZONE_KEYS, parseZone, type Zone } from 'elpriser-client';

ZONES.de; // { label: 'DE-LU Germany and Luxembourg', country: 'DE', currency: 'EUR', timeZone: 'Europe/Berlin', group: 'eu', area: null }
ZONES.pl.currency; // 'PLN' (a literal type)
ZONE_KEYS; // ['dk1', 'dk2', 'no1', ... 'gb', 'ie'] in the API's order
parseZone('IT_N'); // 'it-n'; throws UnknownZoneError for anything else
const zone: Zone = 'se3'; // a union of the 40 keys: typos are compile errors
```

Every method takes the lower-case key (`'it-n'`) or the upper-case spelling (`'IT-N'` is accepted at runtime, `'DE'` also by the
types). Use `parseZone()` for strings you do not control. The table is checked against the live `/api/openapi.json`
by the opt-in live test (`ELPRISER_LIVE=1 npm test`).

### Times, time zones and daylight saving

An instant (`slot.start`, `slot.end`, `window.start`) is a plain `Date`, so comparing, sorting and subtracting is always right,
also across a daylight-saving change. What the API calls an hour (0-23) is a local wall-clock hour, and "today" and
"tomorrow" are the zone's own calendar days. The SDK needs no date library for this: it asks `Intl.DateTimeFormat` for the zone's
IANA time zone (`ZONES.de.timeZone`), which every supported runtime ships with its own tz database. Nothing depends on the time zone of
the machine the code runs on.

- `slot.hour`, `slot.localDate` (`'2026-11-03'`), `slot.localStart` / `slot.localEnd` (`'2026-11-03T08:00:00+01:00'`) are the zone's wall clock.
- A "local date" argument or result (`day: '2026-11-04'`, `series.today()`) is a `YYYY-MM-DD` string; there is no local `Date` type.
- A 25-hour day has 25 slots (local hour 2 appears twice, with offsets `+02:00` and `+01:00`), a 23-hour day has 23.
- The 13 Nordic/NL feed zones (also Finland) are on Copenhagen time; every other zone is on its own country's clock.

### Settled, forecast, estimate

- `slot.kind === 'actual'`: the settled day-ahead price.
- `'forecast'`: elpriser.org's **own statistical model, not an official forecast**; it is replaced by the settled price when
  that is published (about 13:00 CET for the next day). Forecast hours carry `min` / `max` (P10 / P90), and `day.horizon` tells
  how many days ahead. Per-horizon back-test numbers are in `series.accuracy` (`series.accuracyFor(3)`, `series.isLowConfidence(3)`).
  The model ranks the cheapest hours better than it hits the price level. So `tomorrow()` before the auction results are out
  returns forecast hours: check `slot.kind`, or pass `includeForecast: false` to `cheapestHours()` / `bestWindow()` to use settled prices only.
- `'estimate'`: for `gb`, `pt` and `ie` the API may attach an `estimate` for hours of a settled day that have no price yet (GB: the
  hours of today that have not traded; PT/IE: the last hour, 23). It is never mixed in unless you ask:
  `client.now('gb', { estimate: true })`, `series.today({ includeEstimate: true })`.
- **Great Britain is not a day-ahead price**: it is the Market Index Price (within-day), an hour is priced only once it has traded,
  and there is no tomorrow. `series.now()` is therefore `null` for `gb` unless you pass `estimate: true`; `series.latestKnown()`
  returns the newest priced hour.

### Price levels

`PriceLevel` (`'VERY_CHEAP' | 'CHEAP' | 'NORMAL' | 'EXPENSIVE' | 'VERY_EXPENSIVE'`) ranks an hour among the priced hours of its
local day in quintiles, the same scale and algorithm as the `level` field of `/api/shelly/tariff`. Use `series.levels()`,
`series.level(slot)` or `priceLevels([...])`. `client.shellyTariff()` returns the API's own levels.

### Cheapest hours and best window

```ts
s.cheapestHours(5); // the 5 cheapest hours, in time order, scattered anywhere in the window
s.bestWindow(5); // the cheapest 5 consecutive hours
s.bestWindow(3, { day: '2026-11-04', includeForecast: false });
s.cheapestHours(2, { start: t0, end: t1 }); // any window of Dates; the default is the next 24 hours
```

Hours without a price never count; fewer than `n` hours come back if fewer are priced. A tie goes to the earliest hour.
`bestWindow` never bridges a gap.

## Denmark-only endpoints (the 1.0.0 client's endpoints)

| 1.0.0 `createElpriserClient()` | `new Elpriser()` |
|---|---|
| `now()` | `client.dkNow(area, { mode, strategy, hours })` (or `client.now('dk1')` for the `Slot`) |
| `prices()` | `client.dkPrices(area, { date, mode, gln, charges })` |
| `schedule()` | `client.dkSchedule(area, { strategy, hours, pct, maxOff, date })` |
| `forecast()` | `client.forecast('dk1')` / `(await client.series('dk1')).forecastDays` |
| `shellyTariff()` | `client.shellyTariff(area)` |
| `supplierLookup({ lat, lng })` | `client.supplierLookup(lat, lng)` |

`PriceMode` and `Strategy` list the values the API accepts (`MODES`, `STRATEGIES`). Invalid combinations (a `net_` mode
without `gln`, a `mode` on a non-Danish zone, `hours` out of range) reject with `InvalidArgumentError` before any request.

## Errors, timeouts, retries

```ts
new Elpriser({
  baseUrl: 'https://elpriser.org',
  timeoutMs: 10_000, // per attempt, connect and read
  retries: 2, // extra attempts after a timeout, a network error, 429 or 5xx
  backoffMs: 500, // delay before retry n: backoffMs * 2 ** n, or the server's Retry-After (capped at 30 s)
  userAgent: undefined, // see below
  signal: undefined, // aborts every call of this client
  fetch: undefined, // your own fetch (node-fetch, undici, a test double)
});
await client.series('de', { signal: AbortSignal.timeout(3000) }); // per call
```

Timeouts, network errors, 429 and 500/502/503/504 are retried; other 4xx are not. Everything thrown derives from `ElpriserError`:

| Error | When |
|---|---|
| `InvalidArgumentError`, `UnknownZoneError` | a bad argument or an unknown zone; thrown before any request, as a rejected promise |
| `ApiError` (`.status`, `.body`, `.url`, `.retryAfter`) | any other non-2xx answer |
| `BadRequestError` / `NotFoundError` | HTTP 400 / 404 (`.message` carries the API's own text) |
| `RateLimitError` / `ServerError` | HTTP 429 / 5xx after the retries (`.retryAfter` in seconds) |
| `ElpriserTimeoutError`, `ElpriserNetworkError` | no HTTP answer (`.cause` holds the underlying error) |
| `ElpriserParseError` | a 200 that is not the shape this version understands |

If you abort with your own `signal`, the signal's reason (normally an `AbortError`) is rethrown unchanged and nothing is retried.

```ts
import { RateLimitError, NotFoundError, ElpriserError } from 'elpriser-client';
try {
  await client.now('de');
} catch (e) {
  if (e instanceof RateLimitError) console.log('retry in', e.retryAfter, 's');
  else if (e instanceof NotFoundError) console.log(e.status, e.body);
  else if (e instanceof ElpriserError) console.log(e.message);
  else throw e;
}
```

**User-Agent.** Cloudflare's bot protection in front of the API rejects some default agents (Python's `urllib`, for one), so server runtimes (Node, Bun, Deno) send
`elpriser-client/<version> (+https://elpriser.org)` unless you set `userAgent: 'my-app/1.0'`. A browser sends none by default:
`User-Agent` is not a CORS-safelisted header, so setting it would add a preflight request to every call. `userAgent: null` never sends one.

## Migrating from 1.0.0

1.1.0 is additive. **Nothing changes for existing code**: `createElpriserClient()` (named and default export), all its methods,
options, result shapes (raw snake_case JSON), URLs and error messages work exactly as in 1.0.0; the test suite runs every call
through the 1.0.0 source and the new one side by side and requires identical requests and results. The only difference you can
observe: a non-2xx answer now throws an `ApiError` (a subclass of `Error`, same message `elpriser.org API 404 for /api/now`,
plus `.status`). The 1.0.0 functions are marked `@deprecated` in the editor, not removed.

To move to the new API when you like:

```diff
-import { createElpriserClient } from 'elpriser-client';
-const elpriser = createElpriserClient();
-const now = await elpriser.now({ area: 'DK1' });
-console.log(now.price, now.hour);
+import { Elpriser } from 'elpriser-client';
+const client = new Elpriser();
+const slot = await client.now('dk1'); // DKK/kWh incl. tariffs, as before; null if no price
+console.log(slot?.price, slot?.hour);
```

What you gain: 40 zones instead of two, parsed results (`Date` instants, local hours, `kind`), `cheapestHours`/`bestWindow`/`levels`, retries,
timeouts and typed errors. The old `Mode` type keeps its six values; `PriceMode` lists all eight.

## Compared with the Python SDK

Same zones, same arithmetic, same answers. Naming is camelCase; the differences by design:

- Promises only (no sync/async split), no CLI, no pandas export. `to_dataframe()` has no counterpart.
- Instants are `Date`; the zone's wall clock is `hour`, `localDate`, `localStart` (ISO 8601 with offset) instead of tz-aware datetimes.
- Local dates are `'YYYY-MM-DD'` strings; `levels()` returns `{ slot, level }` objects instead of tuples.
- `Mode` is `PriceMode` (the 1.0.0 `Mode` type is kept as it was); `ValueError` is `InvalidArgumentError`; `Transport` is the `fetch` option.
- `Retry-After` is also understood as an HTTP date.

## Data and attribution

Prices come from elpriser.org, which aggregates: Energi Data Service (Energinet) for Denmark; Bundesnetzagentur | SMARD.de via
Energy-Charts.info (CC BY 4.0) for DE-LU, FR, PL, IT-North, AT, BE, CH, CZ, HU and SI; the ENTSO-E Transparency Platform for ES, PT,
SK, GR, RO, BG, HR, RS, EE, LV, LT, ME, MK, AL, XK and the Nordic/NL zones; SEMOpx for Ireland; and Elexon BMRS for Great Britain
(*Contains BMRS data (c) Elexon Limited copyright and database right*). Sub-hourly prices are averaged to hourly means by
elpriser.org. Keep the attribution if you republish the data. See <https://elpriser.org/api> and `/api/openapi.json`. The service
is free; please keep request volume reasonable (responses are edge-cached for minutes, so polling more often than every few minutes
gains nothing).

## Dansk

SDK til elpriser.org i TypeScript: spotpriser for 40 europæiske prisområder, aktuel og næste time, billigste timer, bedste
sammenhængende vindue og prognose. For `dk1`/`dk2` er prisen i kr/kWh inkl. Energinets tariffer, elafgift og moms
(`mode: 'inkl_alt'`); tilføj `mode: 'net_inkl_alt', gln: '...'` for dit netselskabs tariff. Uden for Danmark er det børsprisen uden
moms, afgifter og nettariffer. Prognosedage er elpriser.orgs egen model (ikke en officiel prognose) og markeres med `kind === 'forecast'`.
Version 1.0.0's `createElpriserClient()` virker uændret.

## Development

```bash
npm ci
npm run check          # typecheck, build, tests, type-level tests, tests of the built package
npm test               # offline, against recorded API answers in test/fixtures
ELPRISER_LIVE=1 npm test   # opt-in: a few read-only requests to the live API
```

`npm run build` writes `dist/esm` and `dist/cjs` (with `.d.ts`) using `tsc` only. The fixtures in `test/fixtures` are real API answers
recorded by the Python SDK on 2026-11-03.

## Maintainers: releasing

Publishing is automatic on a `v*` tag, through npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no token in
GitHub, provenance attached), and **stays inert until you switch it on**:

1. On npmjs.com open the package `elpriser-client` -> Settings -> Trusted publisher -> GitHub Actions and enter: owner `x2q`,
   repository `elpriser-client`, workflow `publish.yml`, environment `npm`.
2. In GitHub: Settings -> Secrets and variables -> Actions -> Variables, add `NPM_PUBLISH` = `true`. (Until then the
   `publish` job is skipped; the `verify` job still runs on tags.)
3. Bump `version` in `package.json` and `src/version.ts`, update `CHANGELOG.md`, merge, then `git tag v1.1.0 && git push origin v1.1.0`.
   The workflow checks that the tag equals the package version, builds, tests, and runs `npm publish --provenance --access public`.

## License

MIT. Data © their respective sources, see above.
