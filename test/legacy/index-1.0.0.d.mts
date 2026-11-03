export type Area = 'DK1' | 'DK2';

export type Mode =
  | 'spot_ex'         // raw spot, no VAT
  | 'spot_inkl'       // spot incl. 25% VAT
  | 'inkl_alt'        // total incl. tariffs + electricity tax + VAT
  | 'inkl_alt_minus'  // total without electricity tax
  | 'net_inkl_alt'    // total incl. a specific net company's tariff (needs gln)
  | 'net_inkl_tarif'; // net tariff incl., without electricity tax (needs gln)

export type Strategy =
  | 'cheapest_n' | 'cheapest_pct'
  | 'avoid_expensive_n' | 'avoid_expensive_pct'
  | 'avoid_peak' | 'night_cheap' | 'smart';

export interface ClientOptions {
  /** API base URL. Defaults to https://elpriser.org */
  baseUrl?: string;
  /** Custom fetch implementation (for Node < 18). */
  fetch?: typeof fetch;
}

export interface NowResult {
  on: boolean;
  price: number | null;
  hour: number;
  area: Area;
  mode: Mode;
  strategy: Strategy;
}

export interface PricePoint { hour: number; price: number | null; }

export interface PricesResult {
  area: Area; mode: Mode; date: string; unit: string;
  prices: PricePoint[];
  current_hour: number;
  current_price: number | null;
}

export interface ScheduleSlot { hour: number; price: number | null; on: boolean; }

export interface ScheduleResult {
  area: Area; mode: Mode; strategy: Strategy; param: number; date: string;
  on_now: boolean;
  schedule: ScheduleSlot[];
}

export interface ForecastDay {
  date: string;
  type: 'actual' | 'forecast';
  weekday: number;
  prices: Array<{ hour: number; price: number | null; min?: number; max?: number }>;
}

export interface ForecastResult {
  area: Area; mode: Mode; generated: string;
  days: ForecastDay[];
}

export interface SupplierResult {
  address: string | null;
  name: string | null;
  error?: string;
}

export interface NowOptions { area?: Area; mode?: Mode; gln?: string; strategy?: Strategy; hours?: number; }
export interface PricesOptions { area?: Area; mode?: Mode; date?: string; gln?: string; }
export interface ScheduleOptions { area?: Area; mode?: Mode; strategy?: Strategy; hours?: number; pct?: number; max_off?: number; date?: string; gln?: string; }
export interface ForecastOptions { area?: Area; mode?: Mode; }
export interface ShellyTariffOptions { area?: Area; mode?: Mode; gln?: string; }
export interface SupplierLookupOptions { lat: number; lng: number; }

export interface ElpriserClient {
  now(options?: NowOptions): Promise<NowResult>;
  prices(options?: PricesOptions): Promise<PricesResult>;
  schedule(options?: ScheduleOptions): Promise<ScheduleResult>;
  forecast(options?: ForecastOptions): Promise<ForecastResult>;
  /** Tibber-compatible GraphQL-shaped response. */
  shellyTariff(options?: ShellyTariffOptions): Promise<unknown>;
  supplierLookup(options: SupplierLookupOptions): Promise<SupplierResult>;
}

export function createElpriserClient(options?: ClientOptions): ElpriserClient;
export default createElpriserClient;
