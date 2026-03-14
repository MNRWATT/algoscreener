import yahooFinance from "yahoo-finance2";
import { getAllStocks } from "./stockData";

export interface LiveQuote {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  name: string | null;
}

const cache = new Map<string, { data: LiveQuote; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function mapQuoteToLive(q: any): LiveQuote {
  return {
    price: q?.regularMarketPrice ?? null,
    change: q?.regularMarketChange ?? null,
    changePercent: q?.regularMarketChangePercent ?? null,
    volume: q?.regularMarketVolume ?? null,
    marketCap: q?.marketCap ?? null,
    name: q?.shortName ?? q?.longName ?? null,
  };
}

async function fetchQuote(ticker: string): Promise<LiveQuote | null> {
  try {
    const q = await yahooFinance.quote(ticker as any);
    if (!q) return null;
    return mapQuoteToLive(q);
  } catch (error: any) {
    console.warn(
      `[yahoo-lib] quote failed for ${ticker}: [${error?.name}] ${error?.message}`,
    );
    return null;
  }
}

export async function getCachedQuote(ticker: string): Promise<LiveQuote | null> {
  const cached = cache.get(ticker);
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL) return cached.data;

  const data = await fetchQuote(ticker);
  if (data) {
    cache.set(ticker, { data, ts: now });
  }
  return data;
}

export async function getCachedQuotes(
  tickers: string[],
): Promise<Map<string, LiveQuote | null>> {
  const results = new Map<string, LiveQuote | null>();

  // Simple per-symbol concurrency; yahoo-finance2 already rate-limits internally.
  for (const t of tickers) {
    results.set(t, await getCachedQuote(t));
  }

  return results;
}

// Pre-warm: fetch all tickers in background after server starts
export async function prewarmCache(): Promise<void> {
  const tickers = getAllStocks().map((s) => s.ticker);
  console.log(`[prewarm] Starting cache warm for ${tickers.length} tickers...`);
  try {
    for (const t of tickers) {
      await getCachedQuote(t);
    }
    console.log(`[prewarm] Cache warm complete.`);
  } catch (err) {
    console.warn("[prewarm] Cache warm encountered errors (non-fatal):", err);
  }
}
