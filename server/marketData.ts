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
const CACHE_TTL = 15 * 60 * 1000;

export async function getLiveQuote(ticker: string): Promise<LiveQuote | null> {
  try {
    const quote = await yahooFinance.quote(ticker);
    if (!quote) return null;
    return {
      price: quote.regularMarketPrice ?? null,
      change: quote.regularMarketChange ?? null,
      changePercent: quote.regularMarketChangePercent ?? null,
      volume: quote.regularMarketVolume ?? null,
      marketCap: quote.marketCap ?? null,
      name: quote.shortName ?? quote.longName ?? null,
    };
  } catch {
    return null;
  }
}

export async function getCachedQuote(ticker: string): Promise<LiveQuote | null> {
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const data = await getLiveQuote(ticker);
  if (data !== null) cache.set(ticker, { data, ts: Date.now() });
  return data;
}

export async function getCachedQuotes(tickers: string[]): Promise<Map<string, LiveQuote | null>> {
  const results = new Map<string, LiveQuote | null>();
  for (let i = 0; i < tickers.length; i += 20) {
    const batch = tickers.slice(i, i + 20);
    await Promise.all(batch.map(async (t) => { results.set(t, await getCachedQuote(t)); }));
    if (i + 20 < tickers.length) await new Promise((r) => setTimeout(r, 150));
  }
  return results;
}

// Pre-warm: fetch all tickers in background after server starts
export async function prewarmCache(): Promise<void> {
  const tickers = getAllStocks().map((s) => s.ticker);
  console.log(`[prewarm] Starting cache warm for ${tickers.length} tickers...`);
  try {
    await getCachedQuotes(tickers);
    console.log(`[prewarm] Cache warm complete.`);
  } catch (err) {
    console.warn("[prewarm] Cache warm encountered errors (non-fatal):", err);
  }
}
