import { getAllStocks } from "./stockData";

// Use Yahoo Finance public quote endpoint directly instead of the yahoo-finance2 library.
// This avoids any library/runtime incompatibilities on the Render server while still
// pulling live quote data.

export interface LiveQuote {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  name: string | null;
}

// Node 18+ (and Render) expose global fetch. We declare it here so TypeScript
// does not complain even if the DOM lib is not included in tsconfig.
declare const fetch: (input: any, init?: any) => Promise<any>;

const cache = new Map<string, { data: LiveQuote; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

interface YahooQuoteRaw {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  marketCap?: number;
  shortName?: string;
  longName?: string;
}

interface YahooQuoteResponse {
  quoteResponse?: {
    result?: YahooQuoteRaw[];
    error?: unknown;
  };
}

function mapYahooQuote(q: YahooQuoteRaw): LiveQuote {
  return {
    price: q.regularMarketPrice ?? null,
    change: q.regularMarketChange ?? null,
    changePercent: q.regularMarketChangePercent ?? null,
    volume: q.regularMarketVolume ?? null,
    marketCap: q.marketCap ?? null,
    name: q.shortName ?? q.longName ?? null,
  };
}

async function fetchYahooQuotesBatch(tickers: string[]): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  if (tickers.length === 0) return out;

  const symbolsParam = encodeURIComponent(tickers.join(","));
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolsParam}`;

  try {
    const res = await fetch(url, {
      // Basic headers only; Yahoo does not require auth for this endpoint.
      headers: { "User-Agent": "algoscreener/1.0" },
    });

    if (!res || !res.ok) {
      console.warn(`[yahoo] HTTP ${res?.status} for symbols: ${tickers.join(",")}`);
      return out;
    }

    const json = (await res.json()) as YahooQuoteResponse;
    const list = json.quoteResponse?.result ?? [];

    for (const q of list) {
      const symbol = q.symbol;
      if (!symbol) continue;
      out.set(symbol, mapYahooQuote(q));
    }
  } catch (err) {
    console.warn("[yahoo] fetch failed for symbols batch", tickers, err);
  }

  return out;
}

export async function getCachedQuotes(tickers: string[]): Promise<Map<string, LiveQuote | null>> {
  const results = new Map<string, LiveQuote | null>();
  const toFetch: string[] = [];
  const now = Date.now();

  for (const t of tickers) {
    const cached = cache.get(t);
    if (cached && now - cached.ts < CACHE_TTL) {
      results.set(t, cached.data);
    } else {
      toFetch.push(t);
    }
  }

  const batchSize = 40; // conservative; Yahoo supports many symbols per call
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    const batchQuotes = await fetchYahooQuotesBatch(batch);

    for (const symbol of batch) {
      const q = batchQuotes.get(symbol) ?? null;
      if (q) {
        cache.set(symbol, { data: q, ts: now });
      }
      results.set(symbol, q);
    }

    if (i + batchSize < toFetch.length) {
      // Small delay between batches to be polite to Yahoo
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // Ensure every requested ticker has an entry, even if we only had cache
  for (const t of tickers) {
    if (!results.has(t)) {
      const cached = cache.get(t);
      results.set(t, cached ? cached.data : null);
    }
  }

  return results;
}

export async function getCachedQuote(ticker: string): Promise<LiveQuote | null> {
  const map = await getCachedQuotes([ticker]);
  return map.get(ticker) ?? null;
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
