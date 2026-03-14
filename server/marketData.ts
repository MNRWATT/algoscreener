import { getAllStocks } from "./stockData";

export interface LiveQuote {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  name: string | null;
}

// Node 18+ / Render provide global fetch; declare it so TypeScript is happy.
declare const fetch: (input: any, init?: any) => Promise<any>;

const cache = new Map<string, { data: LiveQuote; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

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

    // Finnhub quote response:
    // c: current price
    // pc: previous close
    const c = typeof data.c === "number" ? data.c : null;
    const pc = typeof data.pc === "number" ? data.pc : null;

    let change: number | null = null;
    let changePercent: number | null = null;
    if (c != null && pc != null && pc !== 0) {
      change = c - pc;
      changePercent = (change / pc) * 100;
    }

    return {
      price: c,
      change,
      changePercent,
      volume: null,
      marketCap: null,
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

// Pre-warm: fetch a limited subset of tickers in background after server starts
// to avoid exhausting Finnhub free-tier limits.
export async function prewarmCache(): Promise<void> {
  const allTickers = getAllStocks().map((s) => s.ticker);
  const tickers = allTickers.slice(0, 50); // warm top 50 only
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
      // Small delay between calls to respect rate limits
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

