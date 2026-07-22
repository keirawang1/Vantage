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
  stale?: boolean;
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

export type QuotesFreshness = "live" | "stale" | "empty";

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

const QUOTES_LS_KEY = "vantage-quotes-cache";

/** Backend origin for production; empty uses same-origin / Vite proxy in dev. */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function emptyMeta(seed: { symbol: string; name: string; sector: string }): StockMeta {
  return {
    ...seed,
    price: 0, change: 0, changePercent: 0, volume: 0, avgVolume: 0,
    marketCap: 0, pe: null, high52w: 0, low52w: 0, open: 0, dayHigh: 0, dayLow: 0,
    eps: null, dividendYield: null,
  };
}

function loadPersistedQuotes(): StockMeta[] | null {
  try {
    const raw = localStorage.getItem(QUOTES_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StockMeta[];
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed.filter(s => s && typeof s.symbol === "string" && Number(s.price) > 0);
  } catch {
    return null;
  }
}

function persistQuotes(quotes: StockMeta[]) {
  const good = quotes.filter(s => s.price > 0);
  if (!good.length) return;
  try {
    localStorage.setItem(QUOTES_LS_KEY, JSON.stringify(good));
  } catch {
    /* ignore quota */
  }
}

function seedWithPersisted(): StockMeta[] {
  const persisted = loadPersistedQuotes();
  const bySym = new Map((persisted ?? []).map(s => [s.symbol, { ...s, stale: true }]));
  return STOCK_SEED.map(seed => {
    const prev = bySym.get(seed.symbol);
    return prev ? { ...prev, name: seed.name, sector: seed.sector, stale: true } : emptyMeta(seed);
  });
}

/** Mutable live snapshot — seeded from last-good local cache when available */
export let STOCKS_META: StockMeta[] = seedWithPersisted();

/** Freshness of the last successful quote merge */
export let lastQuotesFreshness: QuotesFreshness =
  STOCKS_META.some(s => s.price > 0) ? "stale" : "empty";

const historyCache = new Map<string, PricePoint[]>();
const historyInflight = new Map<string, Promise<PricePoint[]>>();
const HISTORY_VERSION = 2;

function cacheKey(symbol: string, range: TimeRange) {
  return `${HISTORY_VERSION}:${symbol}:${range}`;
}

function n(v: unknown, fallback = 0) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function nNull(v: unknown) {
  if (v == null) return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * Build a StockMeta from API raw. Never invent fake prices — if the API
 * returned no usable price, keep `prev` (last live/stale) when available.
 */
function asStock(
  raw: Record<string, unknown>,
  seed?: { symbol: string; name: string; sector: string },
  prev?: StockMeta,
): StockMeta {
  const symbol = String(raw.symbol ?? seed?.symbol ?? prev?.symbol ?? "");
  const price = n(raw.price, 0);
  const apiStale = raw.stale === true;
  const unusable = !(price > 0);

  if (unusable && prev && prev.price > 0) {
    return {
      ...prev,
      name: String(raw.name ?? seed?.name ?? prev.name),
      sector: String(raw.sector ?? seed?.sector ?? prev.sector),
      stale: true,
    };
  }

  if (unusable) {
    return {
      ...(prev ?? emptyMeta(seed ?? { symbol, name: symbol, sector: "—" })),
      symbol,
      name: String(raw.name ?? seed?.name ?? prev?.name ?? symbol),
      sector: String(raw.sector ?? seed?.sector ?? prev?.sector ?? "—"),
      stale: true,
    };
  }

  return {
    symbol,
    name: String(raw.name ?? seed?.name ?? prev?.name ?? symbol),
    sector: String(raw.sector ?? seed?.sector ?? prev?.sector ?? "—"),
    price,
    change: n(raw.change, prev?.change ?? 0),
    changePercent: n(raw.changePercent, prev?.changePercent ?? 0),
    volume: n(raw.volume, prev?.volume ?? 0),
    avgVolume: n(raw.avgVolume, prev?.avgVolume ?? 0),
    marketCap: n(raw.marketCap, prev?.marketCap ?? 0),
    pe: nNull(raw.pe) ?? prev?.pe ?? null,
    high52w: n(raw.high52w, prev?.high52w ?? 0),
    low52w: n(raw.low52w, prev?.low52w ?? 0),
    open: n(raw.open, prev?.open ?? 0),
    dayHigh: n(raw.dayHigh, prev?.dayHigh ?? 0),
    dayLow: n(raw.dayLow, prev?.dayLow ?? 0),
    eps: nNull(raw.eps) ?? prev?.eps ?? null,
    dividendYield: nNull(raw.dividendYield) ?? prev?.dividendYield ?? null,
    stale: apiStale,
  };
}

function freshnessFrom(quotes: StockMeta[]): QuotesFreshness {
  const priced = quotes.filter(s => s.price > 0);
  if (!priced.length) return "empty";
  if (priced.some(s => s.stale)) return "stale";
  return "live";
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
  const res = await fetch(apiUrl(`/api/quotes?symbols=${encodeURIComponent(request.join(","))}`));
  if (!res.ok) throw new Error(`Quote fetch failed (${res.status})`);
  const json = await res.json();
  const quotes: Record<string, unknown>[] = json?.quotes ?? [];
  const bySym = new Map(quotes.map(q => [String(q.symbol), q]));

  const existing = new Map(STOCKS_META.map(s => [s.symbol, s]));
  const seedSet = new Set(STOCK_SEED.map(s => s.symbol));

  for (const seed of STOCK_SEED) {
    const raw = bySym.get(seed.symbol);
    const prev = existing.get(seed.symbol);
    existing.set(seed.symbol, raw ? asStock(raw, seed, prev) : (prev ?? emptyMeta(seed)));
  }

  for (const sym of request) {
    if (seedSet.has(sym)) continue;
    const raw = bySym.get(sym);
    if (raw) existing.set(sym, asStock(raw, undefined, existing.get(sym)));
  }

  STOCKS_META = [...existing.values()];
  lastQuotesFreshness = freshnessFrom(STOCKS_META);
  persistQuotes(STOCKS_META);
  return STOCKS_META;
}

/** Fetch only the given symbols and merge into the live snapshot. */
export async function mergeQuotes(symbols: string[]): Promise<StockMeta[]> {
  const unique = [...new Set(symbols.map(s => s.trim()).filter(Boolean))];
  if (!unique.length) return STOCKS_META;

  const res = await fetch(apiUrl(`/api/quotes?symbols=${encodeURIComponent(unique.join(","))}`));
  if (!res.ok) throw new Error(`Quote fetch failed (${res.status})`);
  const json = await res.json();
  const quotes: Record<string, unknown>[] = json?.quotes ?? [];
  const bySym = new Map(quotes.map(q => [String(q.symbol), q]));

  const existing = new Map(STOCKS_META.map(s => [s.symbol, s]));
  for (const sym of unique) {
    const raw = bySym.get(sym);
    if (!raw) continue;
    const seed = STOCK_SEED.find(s => s.symbol === sym);
    existing.set(sym, asStock(raw, seed, existing.get(sym)));
  }
  STOCKS_META = [...existing.values()];
  lastQuotesFreshness = freshnessFrom(STOCKS_META);
  persistQuotes(STOCKS_META);
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
      apiUrl(`/api/history/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}`)
    );
    if (!res.ok) throw new Error(`History fetch failed (${res.status})`);
    const json = await res.json();
    let points: PricePoint[] = (json?.points ?? []).filter(
      (p: PricePoint) => Number.isFinite(p.t) && Number.isFinite(p.p)
    );
    const apiLast = typeof json?.lastPrice === "number" ? json.lastPrice : undefined;
    points = alignHistoryToPrice(points, apiLast);
    if (points.length) historyCache.set(key, points);
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
  const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}`));
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
