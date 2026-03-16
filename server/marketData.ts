import { getAllStocks } from "./stockData";
import { getFundamentals } from "./fundamentalsCache";
import type { PricePoint } from "@shared/schema";

export interface LiveQuote {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  name: string | null;
}

export function isTradableQuote(q: LiveQuote | null): boolean {
  if (!q) return false;
  if (typeof q.price !== "number") return false;
  if (q.price <= 0) return false;
  return true;
}

declare const fetch: (input: any, init?: any) => Promise<any>;

const quoteCache = new Map<string, { data: LiveQuote; ts: number }>();
const QUOTE_CACHE_TTL = 15 * 60 * 1000;

const historyCache = new Map<string, { data: PricePoint[]; ts: number }>();
const HISTORY_CACHE_TTL = 24 * 60 * 60 * 1000;

// Derived momentum/vol metrics computed from history, shared by screener + detail
export interface HistoryMetrics {
  return12m: number | null;
  return6m: number | null;
  return3m: number | null;
  volatility52w: number | null; // annualised % std dev of daily returns
}

const metricsCache = new Map<string, HistoryMetrics>();

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

// ─── Live quote via Finnhub ─────────────────────────────────────

async function fetchFinnhubQuote(ticker: string): Promise<LiveQuote | null> {
  if (!FINNHUB_API_KEY) {
    console.warn("[finnhub] FINNHUB_API_KEY not set; skipping live quote");
    return null;
  }
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res || !res.ok) { console.warn(`[finnhub] HTTP ${res?.status} for ${ticker}`); return null; }
    const data = (await res.json()) as any;
    const c = typeof data.c === "number" && data.c > 0 ? data.c : null;
    const pc = typeof data.pc === "number" ? data.pc : null;
    let change: number | null = null;
    let changePercent: number | null = null;
    if (c != null && pc != null && pc !== 0) {
      change = Math.round((c - pc) * 100) / 100;
      changePercent = Math.round(((c - pc) / pc) * 10000) / 100;
    }
    const fmp = getFundamentals(ticker);
    const marketCap = fmp?.marketCap ?? null;
    return { price: c, change, changePercent, volume: null, marketCap, name: null };
  } catch (err) {
    console.warn("[finnhub] fetch failed for", ticker, err);
    return null;
  }
}

export async function getCachedQuote(ticker: string): Promise<LiveQuote | null> {
  const now = Date.now();
  const cached = quoteCache.get(ticker);
  if (cached && now - cached.ts < QUOTE_CACHE_TTL) return cached.data;
  const data = await fetchFinnhubQuote(ticker);
  if (data) quoteCache.set(ticker, { data, ts: now });
  return data;
}

export async function getCachedQuotes(
  tickers: string[],
): Promise<Map<string, LiveQuote | null>> {
  const results = new Map<string, LiveQuote | null>();
  for (const t of tickers) results.set(t, await getCachedQuote(t));
  return results;
}

// ─── Daily price history via Yahoo Finance v8 (free, no key) ─────

async function fetchYahooHistory(ticker: string): Promise<PricePoint[] | null> {
  const yahooSymbol = ticker.replace(".", "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=2y`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AlgoScreener/1.0)",
        "Accept": "application/json",
      },
    });
    if (!res || !res.ok) { console.warn(`[yahoo] HTTP ${res?.status} for ${ticker}`); return null; }
    const json = (await res.json()) as any;
    const result = json?.chart?.result?.[0];
    if (!result) { console.warn(`[yahoo] no result for ${ticker}`); return null; }
    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    if (timestamps.length === 0 || closes.length === 0) { console.warn(`[yahoo] empty data for ${ticker}`); return null; }
    const points: PricePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      const ts = timestamps[i];
      if (close == null || typeof close !== "number" || !isFinite(close)) continue;
      if (typeof ts !== "number") continue;
      points.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), price: Math.round(close * 100) / 100 });
    }
    if (points.length === 0) { console.warn(`[yahoo] all closes null for ${ticker}`); return null; }
    return points;
  } catch (err) {
    console.warn("[yahoo] fetch failed for", ticker, err);
    return null;
  }
}

export async function getPriceHistory24M(ticker: string): Promise<PricePoint[] | null> {
  const now = Date.now();
  const cached = historyCache.get(ticker);
  if (cached && now - cached.ts < HISTORY_CACHE_TTL) return cached.data;
  const data = await fetchYahooHistory(ticker);
  if (data && data.length > 0) {
    historyCache.set(ticker, { data, ts: now });
    // Recompute metrics whenever history refreshes
    metricsCache.set(ticker, deriveMetrics(data));
    return data;
  }
  return null;
}

// ─── Derive momentum returns + 52W volatility from price history ───

function deriveMetrics(history: PricePoint[]): HistoryMetrics {
  if (history.length < 2) return { return12m: null, return6m: null, return3m: null, volatility52w: null };

  const closes = history.map((p) => p.price);
  const n = closes.length;
  const latest = closes[n - 1];

  function calcReturn(oldIdx: number): number | null {
    const start = closes[Math.max(0, oldIdx)];
    if (!start || start <= 0 || !latest || latest <= 0) return null;
    return Math.round(((latest - start) / start) * 10000) / 100;
  }

  // 52W annualised volatility from last 252 trading days of daily returns
  const vol252 = closes.slice(Math.max(0, n - 253));
  let vol52w: number | null = null;
  if (vol252.length >= 10) {
    const dailyReturns: number[] = [];
    for (let i = 1; i < vol252.length; i++) {
      if (vol252[i - 1] > 0) dailyReturns.push((vol252[i] - vol252[i - 1]) / vol252[i - 1]);
    }
    if (dailyReturns.length >= 5) {
      const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyReturns.length;
      vol52w = Math.round(Math.sqrt(variance * 252) * 10000) / 100; // annualised %
    }
  }

  return {
    return12m: calcReturn(n - 252),
    return6m: calcReturn(n - 126),
    return3m: calcReturn(n - 63),
    volatility52w: vol52w,
  };
}

/** Returns pre-computed history metrics for a ticker, or null if not yet cached. */
export function getHistoryMetrics(ticker: string): HistoryMetrics | null {
  return metricsCache.get(ticker) ?? null;
}

// Kept for backwards compat — routes.ts calls this for stock detail overlay
export function computeReturnsFromHistory(history: PricePoint[]): {
  return12m: number | null;
  return6m: number | null;
  return3m: number | null;
} {
  const m = deriveMetrics(history);
  return { return12m: m.return12m, return6m: m.return6m, return3m: m.return3m };
}

// ─── Startup: pre-warm Yahoo history for entire universe ─────────

export async function prewarmHistoryCache(): Promise<void> {
  const tickers = getAllStocks().map((s) => s.ticker);
  console.log(`[yahoo-prewarm] Fetching 24M history for ${tickers.length} tickers (staggered 350ms)...`);
  let success = 0;
  let failed = 0;
  for (const ticker of tickers) {
    try {
      const data = await fetchYahooHistory(ticker);
      if (data && data.length > 0) {
        historyCache.set(ticker, { data, ts: Date.now() });
        metricsCache.set(ticker, deriveMetrics(data));
        success++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
    // 350ms between requests — polite to Yahoo, ~250 tickers ≈ 90s total
    await new Promise((r) => setTimeout(r, 350));
  }
  console.log(`[yahoo-prewarm] Complete: ${success} succeeded, ${failed} failed.`);

  // Invalidate stock score cache so next screener request picks up real momentum
  invalidateStockCache();
}

// Callback registered by stockData to bust its cache after history is ready
let _invalidateStockCache: (() => void) | null = null;
export function registerStockCacheInvalidator(fn: () => void) {
  _invalidateStockCache = fn;
}
function invalidateStockCache() {
  if (_invalidateStockCache) _invalidateStockCache();
}

// ─── Finnhub quote prewarm (unchanged) ────────────────────────

export async function prewarmCache(): Promise<void> {
  const allTickers = getAllStocks().map((s) => s.ticker);
  const tickers = allTickers.slice(0, 50);
  console.log(`[prewarm] Starting Finnhub cache warm for ${tickers.length} tickers...`);
  if (!FINNHUB_API_KEY) { console.warn("[finnhub] FINNHUB_API_KEY not set; skipping prewarm"); return; }
  try {
    for (const t of tickers) {
      await getCachedQuote(t);
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log("[prewarm] Finnhub cache warm complete.");
  } catch (err) {
    console.warn("[prewarm] Finnhub cache warm encountered errors (non-fatal):", err);
  }
}
