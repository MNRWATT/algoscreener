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

// Daily price history (24M) cache — 24 hour TTL
const historyCache = new Map<string, { data: PricePoint[]; ts: number }>();
const HISTORY_CACHE_TTL = 24 * 60 * 60 * 1000;

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

// ─── Live quote via Finnhub ──────────────────────────────────────

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
  for (const t of tickers) {
    results.set(t, await getCachedQuote(t));
  }
  return results;
}

// ─── Daily price history (24M) via Yahoo Finance v8 ─────────────
//
// Uses Yahoo's free public chart API — no API key required.
// endpoint: https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?interval=1d&range=2y

async function fetchYahooHistory(ticker: string): Promise<PricePoint[] | null> {
  // Yahoo uses "-" instead of "." for some tickers (e.g. BRK-B stays BRK-B)
  const yahooSymbol = ticker.replace(".", "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol,
  )}?interval=1d&range=2y`;

  try {
    const res = await fetch(url, {
      headers: {
        // Yahoo requires a browser-like User-Agent to avoid 401s
        "User-Agent": "Mozilla/5.0 (compatible; AlgoScreener/1.0)",
        "Accept": "application/json",
      },
    });

    if (!res || !res.ok) {
      console.warn(`[yahoo] HTTP ${res?.status} for ${ticker}`);
      return null;
    }

    const json = (await res.json()) as any;
    const result = json?.chart?.result?.[0];
    if (!result) {
      console.warn(`[yahoo] no result for ${ticker}`);
      return null;
    }

    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

    if (timestamps.length === 0 || closes.length === 0) {
      console.warn(`[yahoo] empty timestamps/closes for ${ticker}`);
      return null;
    }

    const points: PricePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      const ts = timestamps[i];
      // Skip null/undefined closes (market holidays etc.)
      if (close == null || typeof close !== "number" || !isFinite(close)) continue;
      if (typeof ts !== "number") continue;
      const date = new Date(ts * 1000).toISOString().slice(0, 10);
      points.push({ date, price: Math.round(close * 100) / 100 });
    }

    if (points.length === 0) {
      console.warn(`[yahoo] all closes were null for ${ticker}`);
      return null;
    }

    console.log(`[yahoo] fetched ${points.length} daily closes for ${ticker}`);
    return points;
  } catch (err) {
    console.warn("[yahoo] history fetch failed for", ticker, err);
    return null;
  }
}

export async function getPriceHistory24M(
  ticker: string,
): Promise<PricePoint[] | null> {
  const now = Date.now();
  const cached = historyCache.get(ticker);
  if (cached && now - cached.ts < HISTORY_CACHE_TTL) return cached.data;

  const data = await fetchYahooHistory(ticker);
  if (data && data.length > 0) {
    historyCache.set(ticker, { data, ts: now });
    return data;
  }
  return null;
}

// ─── Compute momentum returns from price history ─────────────────

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

  // Approximate trading days: 252/year, 126/6mo, 63/3mo
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

// ─── Startup cache warm ──────────────────────────────────────────

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
