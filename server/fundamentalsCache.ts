/**
 * fundamentalsCache.ts
 *
 * Layered data strategy — all free tier, no limits exceeded:
 *
 *  Source 1 — Yahoo Finance v7 /finance/quote (batch up to 10 symbols)
 *    Fields: pe, pb, beta, marketCap, dividendYield, heldPercentInsiders
 *    No auth required. ~25 batch calls for 250 tickers.
 *
 *  Source 2 — Finnhub /stock/metric
 *    Fields: epsGrowth (EPS5Y), revenueGrowth (revenueGrowthTTMYoy)
 *    Free: 60 calls/min, no daily cap. 250 calls @ 300ms = ~75s.
 *
 *  Source 3 — FMP /ratios-ttm/{ticker}
 *    Fields: roe, profitMargin, debtToEquity
 *    Free tier: 250 calls/day — exactly our universe size.
 *
 * If a source fails or returns null for a field → that field stays null.
 * NO seeded/synthetic fallbacks. Null = dash in the UI.
 */

declare const fetch: (input: any, init?: any) => Promise<any>;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const FMP_API_KEY = process.env.FMP_API_KEY;

export interface FundamentalsScore {
  ticker: string;
  sector: string;
  marketCap: number | null;
  // Raw metrics (null = data not available from any source)
  pe: number | null;
  pb: number | null;
  roe: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  epsGrowth: number | null;
  beta: number | null;
  dividendYield: number | null;
  debtToEquity: number | null;
  insiderOwnership: number | null;
  // Factor scores (null = insufficient data to compute)
  qualityScore: number | null;
  lowVolScore: number | null;
  valuationScore: number | null;
  ermScore: number | null;
  insiderScore: number | null;
  // Sources that successfully returned data
  sources: string[];
}

interface CacheState {
  data: Map<string, FundamentalsScore>;
  lastFetched: number;
  status: "empty" | "loading" | "ready" | "error";
}

const state: CacheState = {
  data: new Map(),
  lastFetched: 0,
  status: "empty",
};

// ─── Helpers ─────────────────────────────────────────────────────

function n(val: any): number | null {
  if (val && typeof val === "object" && "raw" in val) val = val.raw;
  return typeof val === "number" && isFinite(val) ? val : null;
}

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function percentileScore(value: number, all: number[], higherIsBetter = true): number {
  if (all.length === 0) return 50;
  const sorted = [...all].sort((a, b) => a - b);
  const rank = sorted.filter((v) => v < value).length;
  const score = (rank / Math.max(sorted.length - 1, 1)) * 100;
  return clamp(Math.round(higherIsBetter ? score : 100 - score));
}

function weightedScore(parts: { s: number; w: number }[]): number | null {
  if (parts.length === 0) return null;
  const wSum = parts.reduce((a, b) => a + b.w, 0);
  if (wSum === 0) return null;
  return clamp(Math.round(parts.reduce((a, b) => a + b.s * b.w, 0) / wSum));
}

async function safeFetch(url: string, headers: Record<string, string> = {}): Promise<any> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "AlgoScreener/1.0", Accept: "application/json", ...headers } });
    if (!res || !res.ok) { console.warn(`[fund] HTTP ${res?.status} → ${url.split("?")[0]}`); return null; }
    const json = await res.json();
    if (json?.["Error Message"]) { console.warn(`[fund] API error: ${json["Error Message"]}`); return null; }
    return json;
  } catch (err) {
    console.warn(`[fund] fetch error: ${err}`);
    return null;
  }
}

// ─── Source 1: Yahoo v7 /finance/quote (batch 10) ────────────────
// Returns: pe, pb, beta, marketCap, dividendYield, insiderOwnership

async function fetchYahooQuoteBatch(tickers: string[]): Promise<Map<string, Partial<FundamentalsScore>>> {
  const result = new Map<string, Partial<FundamentalsScore>>();
  const BATCH = 10;
  const DELAY = 300;

  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    const symbols = batch.map((t) => t.replace(".", "-")).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=trailingPE,priceToBook,beta,marketCap,dividendYield,heldPercentInsiders,sector`;
    const json = await safeFetch(url);
    const quotes: any[] = json?.quoteResponse?.result ?? [];
    for (const q of quotes) {
      const ticker = (q.symbol ?? "").replace("-", ".");
      const pe = n(q.trailingPE);
      const pb = n(q.priceToBook);
      const beta = n(q.beta);
      const marketCap = n(q.marketCap);
      const dyRaw = n(q.dividendYield);
      const dividendYield = dyRaw !== null ? Math.round(dyRaw * 10000) / 100 : null;
      const insRaw = n(q.heldPercentInsiders);
      const insiderOwnership = insRaw !== null ? Math.round(insRaw * 1000) / 10 : null;
      const sector = typeof q.sector === "string" ? q.sector : null;
      result.set(ticker, {
        pe: pe !== null && pe > 0 ? Math.round(pe * 10) / 10 : null,
        pb: pb !== null && pb > 0 ? Math.round(pb * 10) / 10 : null,
        beta,
        marketCap,
        dividendYield,
        insiderOwnership,
        ...(sector ? { sector } : {}),
      });
    }
    if (i + BATCH < tickers.length) await new Promise((r) => setTimeout(r, DELAY));
  }
  return result;
}

// ─── Source 2: Finnhub /stock/metric ─────────────────────────────
// Returns: epsGrowth (epsTTMGrowth), revenueGrowth (revenueGrowthTTMYoy)

async function fetchFinnhubMetrics(tickers: string[]): Promise<Map<string, Partial<FundamentalsScore>>> {
  const result = new Map<string, Partial<FundamentalsScore>>();
  if (!FINNHUB_API_KEY) {
    console.warn("[fund:finnhub] FINNHUB_API_KEY not set — skipping growth metrics");
    return result;
  }
  const DELAY = 300; // 60 calls/min free tier = 1/s; 300ms gives headroom
  for (const ticker of tickers) {
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${FINNHUB_API_KEY}`;
    const json = await safeFetch(url);
    const m = json?.metric ?? {};
    const epsRaw = n(m["epsTTMGrowth"] ?? m["epsGrowth5Y"]);
    const revRaw = n(m["revenueGrowthTTMYoy"] ?? m["revenueGrowth5Y"]);
    result.set(ticker, {
      epsGrowth: epsRaw !== null ? Math.round(epsRaw * 10) / 10 : null,
      revenueGrowth: revRaw !== null ? Math.round(revRaw * 10) / 10 : null,
    });
    await new Promise((r) => setTimeout(r, DELAY));
  }
  return result;
}

// ─── Source 3: FMP /ratios-ttm/{ticker} ──────────────────────────
// Returns: roe, profitMargin, debtToEquity

async function fetchFMPRatios(tickers: string[]): Promise<Map<string, Partial<FundamentalsScore>>> {
  const result = new Map<string, Partial<FundamentalsScore>>();
  if (!FMP_API_KEY) {
    console.warn("[fund:fmp] FMP_API_KEY not set — skipping quality ratios");
    return result;
  }
  const BATCH = 5;
  const DELAY = 350;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    await Promise.all(batch.map(async (ticker) => {
      const url = `https://financialmodelingprep.com/api/v3/ratios-ttm/${ticker}?apikey=${FMP_API_KEY}`;
      const json = await safeFetch(url);
      if (!Array.isArray(json) || json.length === 0) return;
      const r = json[0];
      const roeRaw = n(r.returnOnEquityTTM);
      const marginRaw = n(r.netProfitMarginTTM);
      const deRaw = n(r.debtEquityRatioTTM);
      result.set(ticker, {
        roe: roeRaw !== null ? Math.round(roeRaw * 1000) / 10 : null,
        profitMargin: marginRaw !== null ? Math.round(marginRaw * 1000) / 10 : null,
        debtToEquity: deRaw !== null ? Math.round(deRaw * 100) / 100 : null,
      });
    }));
    if (i + BATCH < tickers.length) await new Promise((r) => setTimeout(r, DELAY));
  }
  return result;
}

// ─── Main pipeline ────────────────────────────────────────────────

async function buildFundamentalsCache(tickers: string[]): Promise<void> {
  console.log(`[fund] Starting multi-source fetch for ${tickers.length} tickers...`);
  state.status = "loading";

  // Run all three sources in parallel
  const [yahooMap, finnhubMap, fmpMap] = await Promise.all([
    fetchYahooQuoteBatch(tickers),
    fetchFinnhubMetrics(tickers),
    fetchFMPRatios(tickers),
  ]);

  const tempMap = new Map<string, FundamentalsScore>();

  for (const ticker of tickers) {
    const y = yahooMap.get(ticker) ?? {};
    const f = finnhubMap.get(ticker) ?? {};
    const p = fmpMap.get(ticker) ?? {};

    const sources: string[] = [];
    if (Object.values(y).some((v) => v !== null && v !== undefined)) sources.push("yahoo-v7");
    if (Object.values(f).some((v) => v !== null && v !== undefined)) sources.push("finnhub");
    if (Object.values(p).some((v) => v !== null && v !== undefined)) sources.push("fmp");

    tempMap.set(ticker, {
      ticker,
      sector: (y as any).sector ?? "Unknown",
      marketCap: y.marketCap ?? null,
      // Valuation (Yahoo v7)
      pe: y.pe ?? null,
      pb: y.pb ?? null,
      beta: y.beta ?? null,
      dividendYield: y.dividendYield ?? null,
      insiderOwnership: y.insiderOwnership ?? null,
      // Growth (Finnhub)
      epsGrowth: f.epsGrowth ?? null,
      revenueGrowth: f.revenueGrowth ?? null,
      // Quality (FMP)
      roe: p.roe ?? null,
      profitMargin: p.profitMargin ?? null,
      debtToEquity: p.debtToEquity ?? null,
      // Scores computed below
      qualityScore: null,
      lowVolScore: null,
      valuationScore: null,
      ermScore: null,
      insiderScore: null,
      sources,
    });
  }

  // ── Percentile-rank across universe ───────────────────────────
  const entries = Array.from(tempMap.values());
  const nn = (arr: (number | null)[]): number[] => arr.filter((v): v is number => v !== null);

  const allROE       = nn(entries.map((e) => e.roe));
  const allMargin    = nn(entries.map((e) => e.profitMargin));
  const allDE        = nn(entries.map((e) => e.debtToEquity));
  const allBeta      = nn(entries.map((e) => e.beta));
  const allPE        = nn(entries.map((e) => e.pe)).filter((v) => v > 0);
  const allPB        = nn(entries.map((e) => e.pb)).filter((v) => v > 0);
  const allDY        = nn(entries.map((e) => e.dividendYield));
  const allRevGrowth = nn(entries.map((e) => e.revenueGrowth));
  const allEPSGrowth = nn(entries.map((e) => e.epsGrowth));
  const allInsider   = nn(entries.map((e) => e.insiderOwnership));

  for (const e of entries) {
    // Quality: ROE 40% + margin 35% + low D/E 25%
    const qParts: { s: number; w: number }[] = [];
    if (e.roe !== null)          qParts.push({ s: percentileScore(e.roe, allROE, true), w: 0.4 });
    if (e.profitMargin !== null) qParts.push({ s: percentileScore(e.profitMargin, allMargin, true), w: 0.35 });
    if (e.debtToEquity !== null) qParts.push({ s: percentileScore(e.debtToEquity, allDE, false), w: 0.25 });
    e.qualityScore = weightedScore(qParts);

    // Low Vol: inverse beta
    if (e.beta !== null)
      e.lowVolScore = clamp(percentileScore(e.beta, allBeta, false));

    // Valuation: inverse PE 40% + inverse PB 35% + div yield 25%
    const vParts: { s: number; w: number }[] = [];
    if (e.pe !== null && e.pe > 0) vParts.push({ s: percentileScore(e.pe, allPE, false), w: 0.4 });
    if (e.pb !== null && e.pb > 0) vParts.push({ s: percentileScore(e.pb, allPB, false), w: 0.35 });
    if (e.dividendYield !== null)  vParts.push({ s: percentileScore(e.dividendYield, allDY, true), w: 0.25 });
    e.valuationScore = weightedScore(vParts);

    // ERM: EPS growth 55% + revenue growth 45%
    const eParts: { s: number; w: number }[] = [];
    if (e.epsGrowth !== null)     eParts.push({ s: percentileScore(e.epsGrowth, allEPSGrowth, true), w: 0.55 });
    if (e.revenueGrowth !== null) eParts.push({ s: percentileScore(e.revenueGrowth, allRevGrowth, true), w: 0.45 });
    e.ermScore = weightedScore(eParts);

    // Insider: percentile of insider ownership %
    if (e.insiderOwnership !== null)
      e.insiderScore = clamp(percentileScore(e.insiderOwnership, allInsider, true));
  }

  const scored = Array.from(tempMap.values()).filter((e) => e.sources.length > 0).length;
  state.data = tempMap;
  state.lastFetched = Date.now();
  state.status = scored > 0 ? "ready" : "error";
  console.log(`[fund] Cache ready: ${tempMap.size} tickers, ${scored} with live data. Sources: yahoo-v7=${yahooMap.size} finnhub=${finnhubMap.size} fmp=${fmpMap.size}`);
}

// ─── Public API ───────────────────────────────────────────────────

export function getFundamentals(ticker: string): FundamentalsScore | null {
  return state.data.get(ticker) ?? null;
}

export function getAllFundamentals(): FundamentalsScore[] {
  return Array.from(state.data.values());
}

export function getCacheStatus() {
  return {
    status: state.status,
    count: state.data.size,
    lastFetched: state.lastFetched,
    fmpEnabled: !!FMP_API_KEY,
    sources: {
      yahooV7: true,
      finnhub: !!FINNHUB_API_KEY,
      fmp: !!FMP_API_KEY,
    },
  };
}

export async function initFundamentalsCache(tickers?: string[]): Promise<void> {
  const { getAllStocks } = await import("./stockData");
  const allTickers = tickers ?? getAllStocks().map((s) => s.ticker);
  await buildFundamentalsCache(allTickers);
  setInterval(
    () => buildFundamentalsCache(allTickers).catch((err) => console.warn("[fund] Daily refresh failed:", err)),
    CACHE_TTL_MS
  );
}
