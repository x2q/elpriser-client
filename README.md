# elpriser-client

> Tiny, **zero-dependency**, typed JavaScript/TypeScript client for the
> [elpriser.org](https://elpriser.org) API — Danish electricity prices for
> DK1 and DK2: current price, cheapest hours, and a 7-day forecast.

Works in the **browser** and **Node.js ≥ 18** (uses the global `fetch`).
No API key. Data from Energi Data Service (Energinet) / Nord Pool via
[elpriser.org](https://elpriser.org).

## Install

```bash
npm install elpriser-client
```

## Usage

```js
import { createElpriserClient } from 'elpriser-client';

const elpriser = createElpriserClient();

// What does electricity cost right now in West Denmark?
const now = await elpriser.now({ area: 'DK1', mode: 'inkl_alt' });
console.log(now.price, 'kr/kWh at', now.hour + ':00');

// When are the 5 cheapest hours today? (e.g. for EV charging)
const sched = await elpriser.schedule({ area: 'DK1', strategy: 'cheapest_n', hours: 5 });
const cheapest = sched.schedule.filter(s => s.on).map(s => s.hour);
console.log('Cheapest hours:', cheapest);

// 7-day forecast
const fc = await elpriser.forecast({ area: 'DK2' });
```

TypeScript types are bundled — `now`, `prices`, `schedule`, `forecast`,
`shellyTariff` and `supplierLookup` are all fully typed.

## API

| Method | Endpoint | Returns |
|---|---|---|
| `now(opts)` | `/api/now` | Current price for this hour + schedule on/off |
| `prices(opts)` | `/api/prices` | 24 hourly prices for a date |
| `schedule(opts)` | `/api/schedule` | Full 24h on/off schedule for a strategy |
| `forecast(opts)` | `/api/forecast` | 7-day forecast |
| `shellyTariff(opts)` | `/api/shelly/tariff` | Tibber-compatible JSON (today + tomorrow) |
| `supplierLookup({lat,lng})` | `/api/supplierlookup` | Net company for a location |

### Options

- `area`: `'DK1'` (Vestdanmark) or `'DK2'` (Østdanmark). Default `'DK1'`.
- `mode`: `spot_ex` · `spot_inkl` · `inkl_alt` *(default)* · `inkl_alt_minus` · `net_inkl_alt` · `net_inkl_tarif`
- `strategy` (schedule): `cheapest_n` · `cheapest_pct` · `avoid_expensive_n` · `avoid_expensive_pct` · `avoid_peak` · `night_cheap` · `smart`
- `hours` / `pct` / `max_off` / `date` / `gln` as applicable.

### Node < 18

```js
import fetch from 'node-fetch';
const elpriser = createElpriserClient({ fetch });
```

### Custom base URL (self-hosting / testing)

```js
const elpriser = createElpriserClient({ baseUrl: 'http://localhost:8788' });
```

## Related

- **MCP server** — [elpriser-mcp](https://github.com/x2q/elpriser-mcp): use the same data from Claude Desktop and other LLM clients.
- **API docs** — <https://elpriser.org/api> · OpenAPI spec: <https://elpriser.org/api/openapi.json>

## License

MIT © [elpriser.org](https://elpriser.org)
