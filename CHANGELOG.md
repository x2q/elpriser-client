# Changelog

## 1.1.1

### Fixed

- `ZONES.fi.timeZone` is `Europe/Helsinki`: elpriser.org now serves `/api/nordic?zone=fi` in Helsinki days (it was indexed by the Copenhagen hour), so hour 0
  of a Finnish day is 22:00 UTC in winter. 1.1.0 assumed Copenhagen time for `fi` and is one hour off once the API has changed; 1.1.1 is one hour off against
  the old API. Publish it together with the API change.

## 1.1.0

A full TypeScript SDK; additive, the 1.0.0 API is unchanged.

### Added

- `Elpriser` client class: `now`, `nextHour`, `today`, `tomorrow`, `cheapestHours`, `bestWindow`, `forecast`, `levels`, `series`, `zoneFeed`, plus the
  Danish endpoints `dkNow`, `dkPrices`, `dkSchedule`, `shellyTariff`, `supplierLookup` and a `getJson` escape hatch.
- `Series` result object (`now`, `nextHour`, `today`, `tomorrow`, `cheapestHours`, `bestWindow`, `levels`, `stats`, `latestKnown`, `forecastDays`,
  `accuracyFor`, ...), `Slot`, `Day`, `Window`, `Estimate`, `PriceKind` (`'actual' | 'forecast' | 'estimate'`), `PriceLevel`.
- The 40-zone table `ZONES` (names, country, currency, time zone, group) with the `Zone` union type, `ZONE_KEYS`, `parseZone`, `isZone`, `zoneInfo`.
- Local-time handling without a date library: `Intl.DateTimeFormat` with each zone's IANA time zone; 23- and 25-hour days are handled.
- Options `baseUrl`, `fetch`, `timeoutMs`, `retries`, `backoffMs`, `userAgent`, `signal`; retries honour `Retry-After` (seconds or HTTP date), capped at 30 s.
- Typed errors: `ElpriserError`, `ApiError` (`status`, `body`, `url`, `retryAfter`), `BadRequestError`, `NotFoundError`, `RateLimitError`, `ServerError`,
  `ElpriserTimeoutError`, `ElpriserNetworkError`, `ElpriserParseError`, `InvalidArgumentError`, `UnknownZoneError`.
- Dual ESM + CommonJS build with declarations, `exports` map, `sideEffects: false`; no runtime dependencies; works on Node >= 18, browsers, Deno, Bun and Cloudflare Workers.
- Tests (`node:test`) against recorded API answers, including a side-by-side run of the 1.0.0 source, and type-level tests; CI on Node 18, 20 and 22; a tag-triggered
  publish workflow using npm trusted publishing (inactive until configured).

### Changed

- `createElpriserClient()` and the 1.0.0 types are marked `@deprecated` in JSDoc; they keep working exactly as before. A non-2xx answer now throws an `ApiError` (still an
  `Error`, with the same message as before).
- Package layout: the library moved from `index.js` / `index.d.ts` to `dist/` (the `exports` map still exposes only `"."`).

## 1.0.0

Initial release: `createElpriserClient()` for the Danish endpoints (DK1/DK2).
