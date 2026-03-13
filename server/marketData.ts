import yahooFinanceModule from "yahoo-finance2";

// Fix CJS/ESM interop issue when bundled with esbuild
const yahooFinance = (yahooFinanceModule as any).default ?? yahooFinanceModule;

const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000;

export async function getLiveQuote(ticker: string) {
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const quote = await yahooFinance.quote(ticker);
  const data = {
    price: quote.regularMarketPrice,
    change: quote.regularMarketChange,
    changePercent: quote.regularMarketChangePercent,
    volume: quote.regularMarketVolume,
    marketCap: quote.marketCap,
    name: quote.shortName || quote.longName,
  };
  cache.set(ticker, { data, ts: Date.now() });
  return data;
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
