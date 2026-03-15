import { getAllStocks } from "./stockData";
import { getFundamentals } from "./fundamentalsCache";

export interface LiveQuote {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null; // in raw dollars (from FMP), or null
  name: string | null;
}

declare const fetch: (input: any, init?: any) => Promise<any>;

const cache = new Map<string, { data: LiveQuote; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

async function fetchFinnhubQuote(ticker: string): Promise<LiveQuote | null> {
  if (!FINNHUB_API_KEY) {
    console.warn("[finnhub] FINNHUB_API_KEY not set; skipping live quote");
    return null;
  }

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_API_KEY}`;

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
  const cached = cache.get(ticker);
  if (cached && now - cached.ts < CACHE_TTL) return cached.data;

  const data = await fetchFinnhubQuote(ticker);
  if (data) {
    cache.set(ticker, { data, ts: now });
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

export async function prewarmCache(): Promise<void> {
  const allTickers = getAllStocks().map((s) => s.ticker);
  const tickers = allTickers.slice(0, 50);
  console.log(`[prewarm] Starting Finnhub cache warm for ${tickers.length} tickers...`);

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
    console.warn("[prewarm] Finnhub cache warm encountered errors (non-fatal):", err);
  }
}
