/**
 * The price zones elpriser.org serves.
 *
 * The table mirrors the `zone` enum of https://elpriser.org/api/openapi.json (40
 * zones, checked against it in the tests). `timeZone` is the IANA time zone of the
 * wall clock the API's `hour` field (0-23) is expressed in: the 13 Nordic/NL feed
 * zones are all on Copenhagen time (Finland too: the feed floors every slot to the
 * Copenhagen hour), every other zone is on its own country's clock.
 */

import { UnknownZoneError } from './errors.js';

/** Which feed a zone comes from: `dk` (tariff-aware), `nordic` (NO/SE/FI/NL) or `eu`. */
export type ZoneGroup = 'dk' | 'nordic' | 'eu';

/** Everything the table says about one zone. */
export interface ZoneInfo {
  /** Human-readable name as the API reports it (`zoneInfo.name`). */
  readonly label: string;
  /** ISO-like country code (`XK` for Kosovo). */
  readonly country: string;
  /** The local currency the API converts to (`zoneInfo.currency`). */
  readonly currency: string;
  /** IANA name of the wall clock the API's `hour` field is expressed in. */
  readonly timeZone: string;
  readonly group: ZoneGroup;
  /** `"DK1"` / `"DK2"` for the two Danish zones (they also have the tariff-aware endpoints), else `null`. */
  readonly area: 'DK1' | 'DK2' | null;
}

/**
 * All 40 zones, keyed by the key the API uses (`'it-n'`, `'se3'`), in the API's
 * order. `ZONES.de.currency === 'EUR'`, `ZONES.pl.timeZone === 'Europe/Warsaw'`.
 */
export const ZONES = {
  'dk1': { label: 'DK1 Vestdanmark', country: 'DK', currency: 'DKK', timeZone: 'Europe/Copenhagen', group: 'dk', area: 'DK1' },
  'dk2': { label: 'DK2 Østdanmark', country: 'DK', currency: 'DKK', timeZone: 'Europe/Copenhagen', group: 'dk', area: 'DK2' },
  'no1': { label: 'NO1 Oslo', country: 'NO', currency: 'NOK', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'no2': { label: 'NO2 Kristiansand', country: 'NO', currency: 'NOK', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'no3': { label: 'NO3 Trondheim', country: 'NO', currency: 'NOK', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'no4': { label: 'NO4 Tromsø', country: 'NO', currency: 'NOK', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'no5': { label: 'NO5 Bergen', country: 'NO', currency: 'NOK', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'se1': { label: 'SE1 Luleå', country: 'SE', currency: 'SEK', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'se2': { label: 'SE2 Sundsvall', country: 'SE', currency: 'SEK', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'se3': { label: 'SE3 Stockholm', country: 'SE', currency: 'SEK', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'se4': { label: 'SE4 Malmö', country: 'SE', currency: 'SEK', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'fi': { label: 'FI Finland', country: 'FI', currency: 'EUR', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'nl': { label: 'NL Nederland', country: 'NL', currency: 'EUR', timeZone: 'Europe/Copenhagen', group: 'nordic', area: null },
  'de': { label: 'DE-LU Germany and Luxembourg', country: 'DE', currency: 'EUR', timeZone: 'Europe/Berlin', group: 'eu', area: null },
  'fr': { label: 'FR France', country: 'FR', currency: 'EUR', timeZone: 'Europe/Paris', group: 'eu', area: null },
  'pl': { label: 'PL Poland', country: 'PL', currency: 'PLN', timeZone: 'Europe/Warsaw', group: 'eu', area: null },
  'it-n': { label: 'IT-North', country: 'IT', currency: 'EUR', timeZone: 'Europe/Rome', group: 'eu', area: null },
  'at': { label: 'AT Austria', country: 'AT', currency: 'EUR', timeZone: 'Europe/Vienna', group: 'eu', area: null },
  'be': { label: 'BE Belgium', country: 'BE', currency: 'EUR', timeZone: 'Europe/Brussels', group: 'eu', area: null },
  'ch': { label: 'CH Switzerland', country: 'CH', currency: 'EUR', timeZone: 'Europe/Zurich', group: 'eu', area: null },
  'cz': { label: 'CZ Czechia', country: 'CZ', currency: 'EUR', timeZone: 'Europe/Prague', group: 'eu', area: null },
  'hu': { label: 'HU Hungary', country: 'HU', currency: 'EUR', timeZone: 'Europe/Budapest', group: 'eu', area: null },
  'si': { label: 'SI Slovenia', country: 'SI', currency: 'EUR', timeZone: 'Europe/Ljubljana', group: 'eu', area: null },
  'es': { label: 'ES Spain', country: 'ES', currency: 'EUR', timeZone: 'Europe/Madrid', group: 'eu', area: null },
  'pt': { label: 'PT Portugal', country: 'PT', currency: 'EUR', timeZone: 'Europe/Lisbon', group: 'eu', area: null },
  'sk': { label: 'SK Slovakia', country: 'SK', currency: 'EUR', timeZone: 'Europe/Bratislava', group: 'eu', area: null },
  'gr': { label: 'GR Greece', country: 'GR', currency: 'EUR', timeZone: 'Europe/Athens', group: 'eu', area: null },
  'ro': { label: 'RO Romania', country: 'RO', currency: 'EUR', timeZone: 'Europe/Bucharest', group: 'eu', area: null },
  'bg': { label: 'BG Bulgaria', country: 'BG', currency: 'EUR', timeZone: 'Europe/Sofia', group: 'eu', area: null },
  'hr': { label: 'HR Croatia', country: 'HR', currency: 'EUR', timeZone: 'Europe/Zagreb', group: 'eu', area: null },
  'rs': { label: 'RS Serbia', country: 'RS', currency: 'EUR', timeZone: 'Europe/Belgrade', group: 'eu', area: null },
  'ee': { label: 'EE Estonia', country: 'EE', currency: 'EUR', timeZone: 'Europe/Tallinn', group: 'eu', area: null },
  'lv': { label: 'LV Latvia', country: 'LV', currency: 'EUR', timeZone: 'Europe/Riga', group: 'eu', area: null },
  'lt': { label: 'LT Lithuania', country: 'LT', currency: 'EUR', timeZone: 'Europe/Vilnius', group: 'eu', area: null },
  'me': { label: 'ME Montenegro', country: 'ME', currency: 'EUR', timeZone: 'Europe/Podgorica', group: 'eu', area: null },
  'mk': { label: 'MK North Macedonia', country: 'MK', currency: 'EUR', timeZone: 'Europe/Skopje', group: 'eu', area: null },
  'al': { label: 'AL Albania', country: 'AL', currency: 'EUR', timeZone: 'Europe/Tirane', group: 'eu', area: null },
  'xk': { label: 'XK Kosovo', country: 'XK', currency: 'EUR', timeZone: 'Europe/Belgrade', group: 'eu', area: null },
  'gb': { label: 'GB Great Britain', country: 'GB', currency: 'GBP', timeZone: 'Europe/London', group: 'eu', area: null },
  'ie': { label: 'IE Ireland (SEM)', country: 'IE', currency: 'EUR', timeZone: 'Europe/Dublin', group: 'eu', area: null },
} as const satisfies Record<string, ZoneInfo>;

/** A zone key: `'dk1' | 'dk2' | 'no1' | ... | 'gb' | 'ie'`. */
export type Zone = keyof typeof ZONES;

/** A zone key, or its upper-case spelling (`'DE'`). Other spellings go through {@link parseZone}. */
export type ZoneInput = Zone | Uppercase<Zone>;

/** Every zone key, in the API's order. */
export const ZONE_KEYS: readonly Zone[] = Object.freeze(Object.keys(ZONES) as Zone[]);

/** The two Danish zones, which also have the tariff-aware endpoints. */
export type DanishZone = 'dk1' | 'dk2';

/** `true` when `value` is exactly one of the 40 zone keys. */
export function isZone(value: unknown): value is Zone {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ZONES, value);
}

/**
 * Turn `'de'`, `'DE'`, `' it_n '` or `'IT-N'` into a {@link Zone}.
 * Throws {@link UnknownZoneError} for anything else.
 */
export function parseZone(value: string): Zone {
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase().replace(/_/g, '-');
    if (isZone(key)) return key;
  }
  throw new UnknownZoneError(`unknown zone ${JSON.stringify(value)}; valid zones: ${ZONE_KEYS.join(', ')}`);
}

/** The table row of a zone (accepts every spelling {@link parseZone} accepts). */
export function zoneInfo(zone: ZoneInput | (string & {})): ZoneInfo & { readonly key: Zone } {
  const key = parseZone(zone);
  return { key, ...ZONES[key] };
}

/** `true` for `dk1` and `dk2`, the zones with the tariff-aware endpoints. */
export function isDanish(zone: Zone): zone is DanishZone {
  return ZONES[zone].area !== null;
}
