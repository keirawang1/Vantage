export interface StockMeta {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  marketCap: number;
  pe: number | null;
  high52w: number;
  low52w: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  eps: number | null;
  dividendYield: number | null;
}

export interface PricePoint {
  t: number;
  p: number;
}

export interface SearchResult {
  symbol: string;
  name: string;
  sector: string;
  exchange?: string;
  type?: string;
}

export type TimeRange =
  | "1D" | "1W" | "1M" | "3M" | "6M" | "YTD"
  | "1Y" | "2Y" | "5Y" | "10Y" | "ALL";

/** Static universe — live fields filled from yfinance */
export const STOCK_SEED: { symbol: string; name: string; sector: string }[] = [
  { symbol: "AAPL", name: "Apple Inc.", sector: "Technology" },
  { symbol: "MSFT", name: "Microsoft Corp.", sector: "Technology" },
  { symbol: "NVDA", name: "NVIDIA Corp.", sector: "Technology" },
  { symbol: "GOOGL", name: "Alphabet Inc.", sector: "Technology" },
  { symbol: "AMZN", name: "Amazon.com Inc.", sector: "Consumer" },
  { symbol: "META", name: "Meta Platforms", sector: "Technology" },
  { symbol: "TSLA", name: "Tesla Inc.", sector: "Automotive" },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Finance" },
  { symbol: "V", name: "Visa Inc.", sector: "Finance" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", sector: "ETF" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", sector: "ETF" },
  { symbol: "NFLX", name: "Netflix Inc.", sector: "Technology" },
  { symbol: "BRK.B", name: "Berkshire Hathaway", sector: "Finance" },
  { symbol: "GLD", name: "SPDR Gold Shares", sector: "Commodity" },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare" },
];

export const ALL_SYMBOLS = STOCK_SEED.map(s => s.symbol);

const FALLBACK: Record<string, Omit<StockMeta, "symbol" | "name" | "sector">> = {
  AAPL:  { price: 189.84, change: 3.22, changePercent: 1.72, volume: 52_840_000, avgVolume: 58_200_000, marketCap: 2_940_000_000_000, pe: 31.2, high52w: 199.62, low52w: 164.08, open: 186.74, dayHigh: 190.12, dayLow: 186.22, eps: 6.43, dividendYield: 0.52 },
  MSFT:  { price: 415.60, change: 3.38, changePercent: 0.82, volume: 18_240_000, avgVolume: 22_100_000, marketCap: 3_090_000_000_000, pe: 37.4, high52w: 430.82, low52w: 309.45, open: 412.80, dayHigh: 416.90, dayLow: 411.22, eps: 11.10, dividendYield: 0.73 },
  NVDA:  { price: 875.40, change: 43.28, changePercent: 5.20, volume: 42_880_000, avgVolume: 38_600_000, marketCap: 2_160_000_000_000, pe: 68.2, high52w: 974.00, low52w: 392.30, open: 832.20, dayHigh: 880.54, dayLow: 828.10, eps: 12.83, dividendYield: 0.03 },
  GOOGL: { price: 175.20, change: -0.53, changePercent: -0.30, volume: 21_440_000, avgVolume: 24_800_000, marketCap: 2_180_000_000_000, pe: 26.8, high52w: 193.31, low52w: 129.40, open: 175.90, dayHigh: 176.84, dayLow: 174.12, eps: 6.55, dividendYield: null },
  AMZN:  { price: 192.80, change: 3.01, changePercent: 1.58, volume: 32_600_000, avgVolume: 36_400_000, marketCap: 2_030_000_000_000, pe: 52.1, high52w: 201.20, low52w: 118.35, open: 189.90, dayHigh: 193.40, dayLow: 189.20, eps: 3.71, dividendYield: null },
  META:  { price: 527.30, change: 15.90, changePercent: 3.11, volume: 14_280_000, avgVolume: 16_900_000, marketCap: 1_360_000_000_000, pe: 28.4, high52w: 531.49, low52w: 279.40, open: 511.60, dayHigh: 529.80, dayLow: 510.40, eps: 18.50, dividendYield: 0.40 },
  TSLA:  { price: 248.70, change: -6.08, changePercent: -2.38, volume: 88_420_000, avgVolume: 104_600_000, marketCap: 793_000_000_000, pe: 58.6, high52w: 299.29, low52w: 138.80, open: 254.90, dayHigh: 256.20, dayLow: 247.30, eps: 4.25, dividendYield: null },
  JPM:   { price: 215.40, change: 0.84, changePercent: 0.39, volume: 8_840_000, avgVolume: 9_200_000, marketCap: 620_000_000_000, pe: 11.8, high52w: 223.11, low52w: 137.22, open: 214.60, dayHigh: 216.10, dayLow: 213.90, eps: 18.25, dividendYield: 2.22 },
  V:     { price: 285.60, change: 0.57, changePercent: 0.20, volume: 6_120_000, avgVolume: 6_800_000, marketCap: 580_000_000_000, pe: 30.2, high52w: 290.96, low52w: 213.27, open: 285.10, dayHigh: 286.40, dayLow: 284.20, eps: 9.45, dividendYield: 0.77 },
  SPY:   { price: 524.80, change: 4.68, changePercent: 0.90, volume: 68_240_000, avgVolume: 72_600_000, marketCap: 505_000_000_000, pe: null, high52w: 531.88, low52w: 410.44, open: 521.20, dayHigh: 525.40, dayLow: 520.80, eps: null, dividendYield: 1.24 },
  QQQ:   { price: 455.20, change: 4.96, changePercent: 1.10, volume: 42_180_000, avgVolume: 48_200_000, marketCap: 244_000_000_000, pe: null, high52w: 461.05, low52w: 336.21, open: 450.40, dayHigh: 456.20, dayLow: 449.80, eps: null, dividendYield: 0.56 },
  NFLX:  { price: 785.40, change: 32.00, changePercent: 4.24, volume: 4_880_000, avgVolume: 5_200_000, marketCap: 338_000_000_000, pe: 48.2, high52w: 800.22, low52w: 344.73, open: 753.80, dayHigh: 788.60, dayLow: 752.10, eps: 16.29, dividendYield: null },
  "BRK.B": { price: 418.30, change: 1.22, changePercent: 0.29, volume: 3_440_000, avgVolume: 3_800_000, marketCap: 908_000_000_000, pe: 22.1, high52w: 429.82, low52w: 317.43, open: 417.10, dayHigh: 419.40, dayLow: 416.80, eps: 18.89, dividendYield: null },
  GLD:   { price: 242.60, change: 1.22, changePercent: 0.51, volume: 8_620_000, avgVolume: 9_400_000, marketCap: 70_000_000_000, pe: null, high52w: 246.30, low52w: 176.22, open: 241.40, dayHigh: 243.10, dayLow: 240.80, eps: null, dividendYield: null },
  JNJ:   { price: 155.20, change: -0.94, changePercent: -0.60, volume: 7_240_000, avgVolume: 8_100_000, marketCap: 374_000_000_000, pe: 14.2, high52w: 175.97, low52w: 143.13, open: 156.20, dayHigh: 156.80, dayLow: 154.40, eps: 10.91, dividendYield: 3.22 },
};

function emptyMeta(seed: { symbol: string; name: string; sector: string }): StockMeta {
  const fb = FALLBACK[seed.symbol];
  return fb ? { ...seed, ...fb } : {
    ...seed,
    price: 0, change: 0, changePercent: 0, volume: 0, avgVolume: 0,
    marketCap: 0, pe: null, high52w: 0, low52w: 0, open: 0, dayHigh: 0, dayLow: 0,
    eps: null, dividendYield: null,
  };
}

/** Mutable live snapshot */
export let STOCKS_META: StockMeta[] = STOCK_SEED.map(emptyMeta);

const historyCache = new Map<string, PricePoint[]>();
const historyInflight = new Map<string, Promise<PricePoint[]>>();
const HISTORY_VERSION = 2;

function cacheKey(symbol: string, range: TimeRange) {
  return `${HISTORY_VERSION}:${symbol}:${range}`;
}

function asStock(raw: Record<string, unknown>, seed?: { symbol: string; name: string; sector: string }): StockMeta {
  const symbol = String(raw.symbol ?? seed?.symbol ?? "");
  const fb = FALLBACK[symbol];
  const n = (v: unknown, fallback = 0) => {
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : fallback;
  };
  const nNull = (v: unknown) => {
    if (v == null) return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    symbol,
    name: String(raw.name ?? seed?.name ?? symbol),
    sector: String(raw.sector ?? seed?.sector ?? "—"),
    price: n(raw.price, fb?.price ?? 0),
    change: n(raw.change, fb?.change ?? 0),
    changePercent: n(raw.changePercent, fb?.changePercent ?? 0),
    volume: n(raw.volume, fb?.volume ?? 0),
    avgVolume: n(raw.avgVolume, fb?.avgVolume ?? 0),
    marketCap: n(raw.marketCap, fb?.marketCap ?? 0),
    pe: nNull(raw.pe) ?? fb?.pe ?? null,
    high52w: n(raw.high52w, fb?.high52w ?? 0),
    low52w: n(raw.low52w, fb?.low52w ?? 0),
    open: n(raw.open, fb?.open ?? 0),
    dayHigh: n(raw.dayHigh, fb?.dayHigh ?? 0),
    dayLow: n(raw.dayLow, fb?.dayLow ?? 0),
    eps: nNull(raw.eps) ?? fb?.eps ?? null,
    dividendYield: nNull(raw.dividendYield) ?? fb?.dividendYield ?? null,
  };
}

/** Pin chart endpoint to displayed quote price */
export function alignHistoryToPrice(points: PricePoint[], lastPrice?: number): PricePoint[] {
  if (!points.length || lastPrice == null || !Number.isFinite(lastPrice)) return points;
  const next = points.slice();
  const last = next[next.length - 1];
  if (last.p === lastPrice) return points;
  next[next.length - 1] = { ...last, p: lastPrice };
  return next;
}

export function invalidateHistory(symbol?: string) {
  if (!symbol) {
    historyCache.clear();
    return;
  }
  const prefix = `${HISTORY_VERSION}:${symbol}:`;
  for (const k of [...historyCache.keys()]) {
    if (k.startsWith(prefix)) historyCache.delete(k);
  }
}

export function invalidateHistoryRange(range: TimeRange) {
  const suffix = `:${range}`;
  for (const k of [...historyCache.keys()]) {
    if (k.endsWith(suffix)) historyCache.delete(k);
  }
}

export async function fetchQuotes(symbols: string[] = ALL_SYMBOLS): Promise<StockMeta[]> {
  const knownExtras = STOCKS_META.map(s => s.symbol).filter(s => !ALL_SYMBOLS.includes(s));
  const request = [...new Set([...symbols, ...knownExtras])];
  const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(request.join(","))}`);
  if (!res.ok) throw new Error(`Quote fetch failed (${res.status})`);
  const json = await res.json();
  const quotes: Record<string, unknown>[] = json?.quotes ?? [];
  const bySym = new Map(quotes.map(q => [String(q.symbol), q]));

  const existing = new Map(STOCKS_META.map(s => [s.symbol, s]));
  const seedSet = new Set(STOCK_SEED.map(s => s.symbol));

  for (const seed of STOCK_SEED) {
    const raw = bySym.get(seed.symbol);
    existing.set(seed.symbol, raw ? asStock(raw, seed) : (existing.get(seed.symbol) ?? emptyMeta(seed)));
  }

  for (const sym of request) {
    if (seedSet.has(sym)) continue;
    const raw = bySym.get(sym);
    if (raw) existing.set(sym, asStock(raw));
  }

  STOCKS_META = [...existing.values()];
  return STOCKS_META;
}

/** Fetch only the given symbols and merge into the live snapshot. */
export async function mergeQuotes(symbols: string[]): Promise<StockMeta[]> {
  const unique = [...new Set(symbols.map(s => s.trim()).filter(Boolean))];
  if (!unique.length) return STOCKS_META;

  const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(unique.join(","))}`);
  if (!res.ok) throw new Error(`Quote fetch failed (${res.status})`);
  const json = await res.json();
  const quotes: Record<string, unknown>[] = json?.quotes ?? [];
  const bySym = new Map(quotes.map(q => [String(q.symbol), q]));

  const existing = new Map(STOCKS_META.map(s => [s.symbol, s]));
  for (const sym of unique) {
    const raw = bySym.get(sym);
    if (!raw) continue;
    const seed = STOCK_SEED.find(s => s.symbol === sym);
    existing.set(sym, asStock(raw, seed));
  }
  STOCKS_META = [...existing.values()];
  return STOCKS_META;
}

/** Fetch symbols and merge into the live snapshot (for search/detail of any ticker). */
export async function ensureQuotes(symbols: string[]): Promise<StockMeta[]> {
  const need = symbols.filter(s => {
    const m = STOCKS_META.find(x => x.symbol === s);
    return !m || m.price <= 0;
  });
  if (!need.length) return STOCKS_META;
  return mergeQuotes(need);
}

export async function fetchHistory(symbol: string, range: TimeRange, lastPrice?: number): Promise<PricePoint[]> {
  const key = cacheKey(symbol, range);
  const cached = historyCache.get(key);
  if (cached) return alignHistoryToPrice(cached, lastPrice);

  const inflight = historyInflight.get(key);
  if (inflight) {
    const pts = await inflight;
    return alignHistoryToPrice(pts, lastPrice);
  }

  const promise = (async () => {
    const res = await fetch(
      `/api/history/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}`
    );
    if (!res.ok) throw new Error(`History fetch failed (${res.status})`);
    const json = await res.json();
    let points: PricePoint[] = (json?.points ?? []).filter(
      (p: PricePoint) => Number.isFinite(p.t) && Number.isFinite(p.p)
    );
    const apiLast = typeof json?.lastPrice === "number" ? json.lastPrice : undefined;
    points = alignHistoryToPrice(points, apiLast);
    historyCache.set(key, points);
    return points;
  })().finally(() => {
    historyInflight.delete(key);
  });

  historyInflight.set(key, promise);
  const pts = await promise;
  return alignHistoryToPrice(pts, lastPrice);
}

/** Sync read of cached history only (empty until fetched). */
export function getHistory(symbol: string, range: TimeRange, lastPrice?: number): PricePoint[] {
  return alignHistoryToPrice(historyCache.get(cacheKey(symbol, range)) ?? [], lastPrice);
}

export function clearHistoryCache() {
  historyCache.clear();
}

/** $ / % move over a history series (first → last). */
export function changeFromPoints(
  points: PricePoint[],
  fallback: { change: number; changePercent: number } = { change: 0, changePercent: 0 },
): { change: number; changePercent: number } {
  if (points.length < 2) return fallback;
  const first = points[0].p;
  const last = points[points.length - 1].p;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return fallback;
  const change = last - first;
  return { change, changePercent: (change / first) * 100 };
}

/**
 * Quote change for UI: 1D uses live day change; other ranges use history
 * first→last (falls back to day change until history is cached).
 */
export function quoteChangeForRange(
  symbol: string,
  range: TimeRange,
  stock: Pick<StockMeta, "change" | "changePercent" | "price">,
): { change: number; changePercent: number } {
  const day = { change: stock.change, changePercent: stock.changePercent };
  if (range === "1D") return day;
  return changeFromPoints(getHistory(symbol, range, stock.price), day);
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = await res.json();
  return (json?.results ?? []) as SearchResult[];
}

/** Prefetch common ranges for sparklines */
export async function prefetchSparklines(symbols: string[], range: TimeRange = "1D") {
  const concurrency = 4;
  let i = 0;
  async function worker() {
    while (i < symbols.length) {
      const idx = i++;
      try { await fetchHistory(symbols[idx], range); } catch { /* ignore */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, () => worker()));
}
