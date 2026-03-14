import yahooFinanceModule from "yahoo-finance2";

// ─── CJS/ESM interop fix ──────────────────────────────────────────
const yf = (yahooFinanceModule as any).default ?? yahooFinanceModule;

// ─── Cache TTLs ───────────────────────────────────────────────────
const PRICE_TTL       = 5  * 60 * 1000;
const FUNDAMENTAL_TTL = 60 * 60 * 1000;
const HISTORY_TTL     = 60 * 60 * 1000;

const priceCache       = new Map<string, { data: YahooQuote;        ts: number }>();
const fundamentalCache = new Map<string, { data: YahooFundamentals; ts: number }>();
const historyCache     = new Map<string, { data: PricePoint[];      ts: number }>();

// ─── Types ────────────────────────────────────────────────────────

export interface YahooQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  name: string;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  week52ChangePercent: number | null;
}

export interface YahooFundamentals {
  ticker: string;
  roe: number | null;
  profitMargin: number | null;
  debtToEquity: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  insiderOwnership: number | null;
  institutionalOwnership: number | null;
}

export interface PricePoint {
  month: string;
  price: number;
}

// ─── Single quote ─────────────────────────────────────────────────

export async function getLiveQuote(ticker: string): Promise<YahooQuote> {
  const cached = priceCache.get(ticker);
  if (cached && Date.now() - cached.ts < PRICE_TTL) return cached.data;

  const q = await yf.quote(ticker);
  const data: YahooQuote = {
    ticker,
    price:               q.regularMarketPrice          ?? 0,
    change:              q.regularMarketChange         ?? 0,
    changePercent:       q.regularMarketChangePercent  ?? 0,
    volume:              q.regularMarketVolume         ?? 0,
    marketCap:           q.marketCap                   ?? 0,
    name:                q.shortName || q.longName     || ticker,
    pe:                  q.trailingPE                  ?? null,
    pb:                  q.priceToBook                 ?? null,
    dividendYield:       q.trailingAnnualDividendYield != null
                           ? Math.round(q.trailingAnnualDividendYield * 10000) / 100
                           : null,
    beta:                q.beta                        ?? null,
    week52High:          q.fiftyTwoWeekHigh            ?? null,
    week52Low:           q.fiftyTwoWeekLow             ?? null,
    week52ChangePercent: q.fiftyTwoWeekChangePercent  != null
                           ? Math.round(q.fiftyTwoWeekChangePercent * 10000) / 100
                           : null,
  };

  priceCache.set(ticker, { data, ts: Date.now() });
  return data;
}

// ─── Batch quotes (groups of 20) ──────────────────────────────────

export async function getLiveQuotes(tickers: string[]): Promise<(YahooQuote | null)[]> {
  const results: (YahooQuote | null)[] = [];
  for (let i = 0; i < tickers.length; i += 20) {
    const batch = tickers.slice(i, i + 20);
    const quotes = await Promise.all(batch.map(t => getLiveQuote(t).catch(() => null)));
    results.push(...quotes);
  }
  return results;
}

// ─── Full fundamentals via quoteSummary (cached 1hr) ──────────────

export async function getFundamentals(ticker: string): Promise<YahooFundamentals> {
  const cached = fundamentalCache.get(ticker);
  if (cached && Date.now() - cached.ts < FUNDAMENTAL_TTL) return cached.data;

  try {
    const summary = await yf.quoteSummary(ticker, {
      modules: ["financialData", "defaultKeyStatistics"],
    });
    const fd = summary.financialData        ?? {};
    const ks = summary.defaultKeyStatistics ?? {};

    const data: YahooFundamentals = {
      ticker,
      roe:                    fd.returnOnEquity          != null ? Math.round(fd.returnOnEquity          * 10000) / 100 : null,
      profitMargin:           fd.profitMargins           != null ? Math.round(fd.profitMargins           * 10000) / 100 : null,
      debtToEquity:           fd.debtToEquity            ?? null,
      revenueGrowth:          fd.revenueGrowth           != null ? Math.round(fd.revenueGrowth           * 10000) / 100 : null,
      earningsGrowth:         fd.earningsGrowth          != null ? Math.round(fd.earningsGrowth          * 10000) / 100 : null,
      insiderOwnership:       ks.heldPercentInsiders     != null ? Math.round(ks.heldPercentInsiders     * 10000) / 100 : null,
      institutionalOwnership: ks.heldPercentInstitutions != null ? Math.round(ks.heldPercentInstitutions * 10000) / 100 : null,
    };

    fundamentalCache.set(ticker, { data, ts: Date.now() });
    return data;
  } catch {
    const empty: YahooFundamentals = {
      ticker, roe: null, profitMargin: null, debtToEquity: null,
      revenueGrowth: null, earningsGrowth: null,
      insiderOwnership: null, institutionalOwnership: null,
    };
    fundamentalCache.set(ticker, { data: empty, ts: Date.now() });
    return empty;
  }
}

// ─── Return cached fundamentals without fetching ──────────────────

export function getCachedFundamentals(ticker: string): YahooFundamentals | null {
  const cached = fundamentalCache.get(ticker);
  if (cached && Date.now() - cached.ts < FUNDAMENTAL_TTL) return cached.data;
  return null;
}

// ─── Historical monthly prices for stock detail chart ─────────────

export async function getHistoricalPrices(ticker: string, months = 24): Promise<PricePoint[]> {
  const key = `${ticker}-${months}`;
  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.ts < HISTORY_TTL) return cached.data;

  const end   = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);

  try {
    const history = await yf.historical(ticker, {
      period1:  start.toISOString().split("T")[0],
      period2:  end.toISOString().split("T")[0],
      interval: "1mo",
    });

    const data: PricePoint[] = history
      .filter((h: any) => h.adjClose != null || h.close != null)
      .map((h: any) => ({
        month: new Date(h.date).toISOString().slice(0, 7),
        price: Math.round(((h.adjClose ?? h.close) as number) * 100) / 100,
      }));

    historyCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return [];
  }
}

// ─── Single cached quote for /api/quote/:ticker ───────────────────

export async function getCachedQuote(ticker: string): Promise<YahooQuote | null> {
  return getLiveQuote(ticker).catch(() => null);
}

// ─── Background pre-warm (runs on server startup, non-blocking) ───

export async function prewarmFundamentals(tickers: string[]): Promise<void> {
  for (let i = 0; i < tickers.length; i += 5) {
    const batch = tickers.slice(i, i + 5);
    await Promise.all(batch.map(t => getFundamentals(t).catch(() => null)));
    await new Promise(r => setTimeout(r, 600));
  }
}


