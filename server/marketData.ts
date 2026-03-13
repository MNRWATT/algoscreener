import yahooFinance from "yahoo-finance2";

export async function getLiveQuote(ticker: string) {
  try {
    const quote = await yahooFinance.quote(ticker, {}, { validateResult: false });
    if (!quote) throw new Error(`No data returned for ${ticker}`);
    return {
      price: (quote as any).regularMarketPrice ?? null,
      change: (quote as any).regularMarketChange ?? null,
      changePercent: (quote as any).regularMarketChangePercent ?? null,
      volume: (quote as any).regularMarketVolume ?? null,
      marketCap: (quote as any).marketCap ?? null,
      name: (quote as any).shortName || (quote as any).longName || ticker,
    };
  } catch (err) {
    console.error(`[marketData] getLiveQuote failed for ${ticker}:`, err);
    throw err;
  }
}

export async function getLiveQuotes(tickers: string[]) {
  const results = [];
  for (let i = 0; i < tickers.length; i += 20) {
    const batch = tickers.slice(i, i + 20);
    const quotes = await Promise.all(
      batch.map((t) => getLiveQuote(t).catch(() => null))
    );
    results.push(...quotes);
  }
  return results;
}

const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000;

export async function getCachedQuote(ticker: string) {
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }
  const data = await getLiveQuote(ticker);
  cache.set(ticker, { data, ts: Date.now() });
  return data;
}