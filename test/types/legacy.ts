// The 1.0.0 type surface (test/legacy/index-1.0.0.d.mts, verbatim) and the new package's must agree:
// every type of 1.0.0 is exported under the same name with an identical shape, so code that
// type-checked against 1.0.0 type-checks against 1.1.0.
import type * as Old from '../legacy/index-1.0.0.mjs';
import type * as New from 'elpriser-client';
import { createElpriserClient as newFactory } from 'elpriser-client';
import oldDefault, { createElpriserClient as oldFactory } from '../legacy/index-1.0.0.mjs';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type Checks = [
  Expect<Same<Old.Area, New.Area>>,
  Expect<Same<Old.Mode, New.Mode>>,
  Expect<Same<Old.Strategy, New.Strategy>>,
  Expect<Same<Old.NowResult, New.NowResult>>,
  Expect<Same<Old.PricePoint, New.PricePoint>>,
  Expect<Same<Old.PricesResult, New.PricesResult>>,
  Expect<Same<Old.ScheduleSlot, New.ScheduleSlot>>,
  Expect<Same<Old.ScheduleResult, New.ScheduleResult>>,
  Expect<Same<Old.ForecastDay, New.ForecastDay>>,
  Expect<Same<Old.ForecastResult, New.ForecastResult>>,
  Expect<Same<Old.SupplierResult, New.SupplierResult>>,
  Expect<Same<Old.NowOptions, New.NowOptions>>,
  Expect<Same<Old.PricesOptions, New.PricesOptions>>,
  Expect<Same<Old.ScheduleOptions, New.ScheduleOptions>>,
  Expect<Same<Old.ForecastOptions, New.ForecastOptions>>,
  Expect<Same<Old.ShellyTariffOptions, New.ShellyTariffOptions>>,
  Expect<Same<Old.SupplierLookupOptions, New.SupplierLookupOptions>>,
  Expect<Same<Old.ElpriserClient, New.ElpriserClient>>,
  // options accepted by 1.0.0 are accepted by 1.1.0 (the new `fetch` type is wider than `typeof fetch`)
  Expect<[Old.ClientOptions] extends [New.ClientOptions] ? true : false>,
  // the factory returns the same client type
  Expect<Same<ReturnType<typeof oldFactory>, ReturnType<typeof newFactory>>>,
  // and the new factory can stand in wherever the 1.0.0 one was typed
  Expect<[typeof newFactory] extends [typeof oldFactory] ? true : false>,
  Expect<[typeof newFactory] extends [typeof oldDefault] ? true : false>,
];

// 1.0.0-style usage keeps compiling
export async function usage() {
  const elpriser = newFactory();
  const now = await elpriser.now({ area: 'DK1', mode: 'inkl_alt' });
  const hours: number[] = (await elpriser.schedule({ area: 'DK1', strategy: 'cheapest_n', hours: 5 })).schedule
    .filter((s) => s.on)
    .map((s) => s.hour);
  const fc = await elpriser.forecast({ area: 'DK2' });
  const labels: Record<New.Mode, string> = {
    spot_ex: 'a',
    spot_inkl: 'b',
    inkl_alt: 'c',
    inkl_alt_minus: 'd',
    net_inkl_alt: 'e',
    net_inkl_tarif: 'f',
  };
  const custom = newFactory({ baseUrl: 'http://localhost:8788', fetch: globalThis.fetch });
  return [now.price, hours, fc.days.length, labels, custom, await elpriser.supplierLookup({ lat: 1, lng: 2 })];
}
