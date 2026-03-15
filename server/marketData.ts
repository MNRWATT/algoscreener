import { getAllStocks } from "./stockData";
import { getFundamentals } from "./fundamentalsCache";
import type { PricePoint } from "@shared/schema";

export interface LiveQuote {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null; // in raw dollars (from FMP), or null
  name: string | null;
}

// A stock is considered tradable if we have a positive live price.
export function isTradableQuote(q: LiveQuote | null): boolean {
  if (!q) return false;
  if (typeof q.price !== "number") return false;
  if (q.price <= 0) return false;
  return true;
}

declare const fetch: (input: any, init?: any) => Promise<any>;

const quoteCache = new Map<string, { data: LiveQuote; ts: number }>();
const QUOTE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Daily price history (24M) cache
const historyCache = new Map<string, { data: PricePoint[]; ts: number }>();
const HISTORY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

async function fetchFinnhubQuote(ticker: string): Promise<LiveQuote | null> {
  if (!FINNHUB_API_KEY) {
    console.warn("[finnhub] FINNHUB_API_KEY not set; skipping live quote");
    return null;
  }

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
    ticker,
  )}&token=${FINNHUB_API_KEY}`;

  try {
    const res = await fetch(url);
    if (!res || !res.ok) {
      console.warn(`[finnhub] HTTP ${res?.status} for ${ticker}`);
      return null;
    }

    const data = (await res.json()) as any;

    const c = typeof data.c === "number" && data.c > 0 ? data.c : null;
    const pc = typeof data.pc === "number" ? data.pc : null;

    let change: number | null = null;
    let changePercent: number | null = null;
    if (c != null && pc != null && pc !== 0) {
      change = Math.round((c - pc) * 100) / 100;
      // Round to exactly 2 decimal places at source
      changePercent = Math.round(((c - pc) / pc) * 10000) / 100;
    }

    // Finnhub free tier does NOT return market cap.
    // Pull it from the FMP fundamentals cache instead.
    const fmp = getFundamentals(ticker);
    const marketCap = fmp?.marketCap ?? null;

    return {
      price: c,
      change,
      changePercent,
      volume: null,
      marketCap,
      name: null,
    };
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
  if (data) {
    quoteCache.set(ticker, { data, ts: now });
  }
  return data;
}

export async function getCachedQuotes(
  tickers: string[],
): Promise<Map<string, LiveQuote | null>> {
  const results = new Map<string, LiveQuote | null>();
  for (const t of tickers) {
    results.set(t, await getCachedQuote(t));
  }
  return results;
}

// ─── Daily price history (24M) via Finnhub ───────────────────────

async function fetchFinnhubHistory(ticker: string): Promise<PricePoint[] | null> {
  if (!FINNHUB_API_KEY) {
    console.warn("[finnhub] FINNHUB_API_KEY not set; skipping history");
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // ~2 years of data (730 days)
  const fromSec = nowSec - 730 * 24 * 60 * 60;

  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(
    ticker,
  )}&resolution=D&from=${fromSec}&to=${nowSec}&token=${FINNHUB_API_KEY}`;

  try {
    const res = await fetch(url);
    if (!res || !res.ok) {
      console.warn(`[finnhub] history HTTP ${res?.status} for ${ticker}`);
      return null;
    }

    const data = (await res.json()) as any;
    if (!data || data.s !== "ok" || !Array.isArray(data.c) || !Array.isArray(data.t)) {
      console.warn("[finnhub] bad history payload for", ticker, data?.s);
      return null;
    }

    const points: PricePoint[] = [];
    for (let i = 0; i < data.c.length; i++) {
      const close = data.c[i];
      const ts = data.t[i];
      if (typeof close !== "number" || typeof ts !== "number") continue;
      const date = new Date(ts * 1000).toISOString().slice(0, 10);
      points.push({ date, price: close });
    }

    if (points.length === 0) return null;
    return points;
  } catch (err) {
    console.warn("[finnhub] history fetch failed for", ticker, err);
    return null;
  }
}

export async function getPriceHistory24M(
  ticker: string,
): Promise<PricePoint[] | null> {
  const now = Date.now();
  const cached = historyCache.get(ticker);
  if (cached && now - cached.ts < HISTORY_CACHE_TTL) return cached.data;

  const data = await fetchFinnhubHistory(ticker);
  if (data && data.length > 0) {
    historyCache.set(ticker, { data, ts: now });
    return data;
  }
  return null;
}

export function computeReturnsFromHistory(history: PricePoint[]): {
  return12m: number | null;
  return6m: number | null;
  return3m: number | null;
} {
  if (history.length < 2) {
    return { return12m: null, return6m: null, return3m: null };
  }

  const closes = history.map((p) => p.price);
  const n = closes.length;

  const idx12 = Math.max(0, n - 252);
  const idx6 = Math.max(0, n - 126);
  const idx3 = Math.max(0, n - 63);

  const latest = closes[n - 1];

  function calcReturn(oldIdx: number): number | null {
    const start = closes[oldIdx];
    if (!start || start <= 0 || !latest || latest <= 0) return null;
    return Math.round(((latest - start) / start) * 10000) / 100;
  }

  return {
    return12m: calcReturn(idx12),
    return6m: calcReturn(idx6),
    return3m: calcReturn(idx3),
  };
}

export async function prewarmCache(): Promise<void> {
  const allTickers = getAllStocks().map((s) => s.ticker);
  const tickers = allTickers.slice(0, 50);
  console.log(
    `[prewarm] Starting Finnhub cache warm for ${tickers.length} tickers...`,
  );

  if (!FINNHUB_API_KEY) {
    console.warn("[finnhub] FINNHUB_API_KEY not set; skipping prewarm");
    return;
  }

  try {
    for (const t of tickers) {
      await getCachedQuote(t);
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log("[prewarm] Finnhub cache warm complete.");
  } catch (err) {
    console.warn(
      "[prewarm] Finnhub cache warm encountered errors (non-fatal):",
      err,
    );
  }
}
