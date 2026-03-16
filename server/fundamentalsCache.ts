/**
 * fundamentalsCache.ts
 *
 * Fetches real fundamental data from Financial Modeling Prep (FMP) free tier.
 * Caches results in memory and refreshes every 24 hours.
 *
 * To enable: set FMP_API_KEY environment variable in Render.
 * Sign up free at https://financialmodelingprep.com
 */

declare const fetch: (input: any, init?: any) => Promise<any>;

const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const FMP_API_KEY = process.env.FMP_API_KEY;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface FundamentalsScore {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  epsGrowth: number | null;
  beta: number | null;
  dividendYield: number | null;
  debtToEquity: number | null;
  momentumScore: number | null;
  qualityScore: number | null;
  lowVolScore: number | null;
  valuationScore: number | null;
  ermScore: number | null;
  insiderScore: number | null;
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

// ─── FMP API helper ─────────────────────────────────────────────

async function fmpGet(path: string, params: Record<string, string> = {}): Promise<any> {
  if (!FMP_API_KEY) return null;
  const qs = new URLSearchParams({ ...params, apikey: FMP_API_KEY }).toString();
  const url = `${FMP_BASE}${path}?${qs}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[fmp] HTTP ${res.status} for ${path}`);
      return null;
    }
    const json = await res.json();
    // FMP returns {"Error Message": "..."} on bad key / plan limit
    if (json && typeof json === "object" && !Array.isArray(json) && json["Error Message"]) {
      console.warn(`[fmp] API error for ${path}:`, json["Error Message"]);
      return null;
    }
    return json;
  } catch (err) {
    console.warn(`[fmp] fetch failed for ${path}:`, err);
    return null;
  }
}

// ─── Score normalization ────────────────────────────────────────

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function percentileScore(value: number, allValues: number[], higherIsBetter = true): number {
  if (allValues.length === 0) return 50;
  const sorted = [...allValues].sort((a, b) => a - b);
  const rank = sorted.filter((v) => v < value).length;
  const score = (rank / Math.max(sorted.length - 1, 1)) * 100;
  return clamp(Math.round(higherIsBetter ? score : 100 - score));
}

// ─── Main fetch + score pipeline ─────────────────────────────────

async function buildFundamentalsCache(): Promise<void> {
  if (!FMP_API_KEY) {
    console.warn("[fmp] FMP_API_KEY not set — real fundamentals disabled. Using seeded scores.");
    state.status = "error";
    return;
  }

  console.log("[fmp] Starting fundamentals fetch...");
  state.status = "loading";

  // Step 1: Fetch screener for NYSE and NASDAQ separately to avoid comma-param issues
  // then merge. Each call returns up to 1000 rows.
  const [nyseData, nasdaqData] = await Promise.all([
    fmpGet("/stock-screener", {
      marketCapMoreThan: "500000000",
      exchange: "NYSE",
      limit: "1000",
    }),
    fmpGet("/stock-screener", {
      marketCapMoreThan: "500000000",
      exchange: "NASDAQ",
      limit: "1000",
    }),
  ]);

  const screenerRows: any[] = [
    ...(Array.isArray(nyseData) ? nyseData : []),
    ...(Array.isArray(nasdaqData) ? nasdaqData : []),
  ];

  if (screenerRows.length === 0) {
    console.warn("[fmp] Screener returned no data for NYSE or NASDAQ");
    state.status = "error";
    return;
  }

  console.log(`[fmp] Screener returned ${screenerRows.length} companies (NYSE + NASDAQ)`);

  // Step 2: Build initial map
  const tempMap = new Map<string, FundamentalsScore>();
  for (const row of screenerRows) {
    if (!row.symbol) continue;
    // Deduplicate (symbol may appear in both exchanges occasionally)
    if (tempMap.has(row.symbol)) continue;
    tempMap.set(row.symbol, {
      ticker: row.symbol,
      name: row.companyName ?? row.symbol,
      sector: row.sector ?? "Unknown",
      exchange: row.exchangeShortName ?? "NYSE",
      marketCap: typeof row.marketCap === "number" ? row.marketCap : null,
      pe:
        typeof row.price === "number" && typeof row.eps === "number" && row.eps > 0
          ? Math.round((row.price / row.eps) * 10) / 10
          : null,
      pb: null,
      roe: null,
      profitMargin: typeof row.netProfitMargin === "number" ? Math.round(row.netProfitMargin * 1000) / 10 : null,
      revenueGrowth: null,
      epsGrowth: null,
      beta: typeof row.beta === "number" ? row.beta : null,
      dividendYield:
        typeof row.lastAnnualDividend === "number" && typeof row.price === "number" && row.price > 0
          ? Math.round((row.lastAnnualDividend / row.price) * 1000) / 10
          : null,
      debtToEquity: null,
      momentumScore: null,
      qualityScore: null,
      lowVolScore: null,
      valuationScore: null,
      ermScore: null,
      insiderScore: null,
    });
  }

  // Step 3: Fetch key-metrics-ttm for top 200 by market cap
  const topTickers = Array.from(tempMap.values())
    .filter((s) => s.marketCap !== null)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, 200)
    .map((s) => s.ticker);

  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 300;
  let fetched = 0;

  for (let i = 0; i < topTickers.length; i += BATCH_SIZE) {
    const batch = topTickers.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (ticker) => {
        const data = await fmpGet(`/key-metrics-ttm/${ticker}`);
        if (!data || !Array.isArray(data) || data.length === 0) return;
        const m = data[0];
        const entry = tempMap.get(ticker);
        if (!entry) return;
        if (typeof m.roeTTM === "number") entry.roe = Math.round(m.roeTTM * 1000) / 10;
        if (typeof m.pbRatioTTM === "number") entry.pb = Math.round(m.pbRatioTTM * 10) / 10;
        if (typeof m.peRatioTTM === "number") entry.pe = Math.round(m.peRatioTTM * 10) / 10;
        if (typeof m.netProfitMarginTTM === "number") entry.profitMargin = Math.round(m.netProfitMarginTTM * 1000) / 10;
        if (typeof m.revenueGrowthTTM === "number") entry.revenueGrowth = Math.round(m.revenueGrowthTTM * 1000) / 10;
        if (typeof m.epsgrowthTTM === "number") entry.epsGrowth = Math.round(m.epsgrowthTTM * 1000) / 10;
        if (typeof m.debtToEquityTTM === "number") entry.debtToEquity = Math.round(m.debtToEquityTTM * 100) / 100;
        if (typeof m.dividendYieldTTM === "number") entry.dividendYield = Math.round(m.dividendYieldTTM * 10000) / 100;
        fetched++;
      })
    );
    if (i + BATCH_SIZE < topTickers.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`[fmp] Fetched key metrics for ${fetched} / ${topTickers.length} tickers`);

  // Step 4: Percentile-rank factor scores across the full universe
  const entries = Array.from(tempMap.values());

  const nums = (arr: (number | null)[]): number[] => arr.filter((v): v is number => v !== null);

  const allROE = nums(entries.map((e) => e.roe));
  const allMargin = nums(entries.map((e) => e.profitMargin));
  const allDE = nums(entries.map((e) => e.debtToEquity));
  const allBeta = nums(entries.map((e) => e.beta));
  const allPE = nums(entries.map((e) => e.pe)).filter((v) => v > 0);
  const allPB = nums(entries.map((e) => e.pb)).filter((v) => v > 0);
  const allDY = nums(entries.map((e) => e.dividendYield));
  const allRevGrowth = nums(entries.map((e) => e.revenueGrowth));
  const allEPSGrowth = nums(entries.map((e) => e.epsGrowth));

  for (const entry of entries) {
    // Quality: ROE 40% + margin 35% + low D/E 25%
    const qParts: { s: number; w: number }[] = [];
    if (entry.roe !== null) qParts.push({ s: percentileScore(entry.roe, allROE, true), w: 0.4 });
    if (entry.profitMargin !== null) qParts.push({ s: percentileScore(entry.profitMargin, allMargin, true), w: 0.35 });
    if (entry.debtToEquity !== null) qParts.push({ s: percentileScore(entry.debtToEquity, allDE, false), w: 0.25 });
    if (qParts.length > 0) {
      const wSum = qParts.reduce((a, b) => a + b.w, 0);
      entry.qualityScore = clamp(Math.round(qParts.reduce((a, b) => a + b.s * b.w, 0) / wSum));
    }

    // Low Vol: inverse beta 100% (52W vol added when Yahoo history available)
    if (entry.beta !== null) {
      entry.lowVolScore = clamp(percentileScore(entry.beta, allBeta, false));
    }

    // Valuation: inverse PE 40% + inverse PB 35% + div yield 25%
    const vParts: { s: number; w: number }[] = [];
    if (entry.pe !== null && entry.pe > 0) vParts.push({ s: percentileScore(entry.pe, allPE, false), w: 0.4 });
    if (entry.pb !== null && entry.pb > 0) vParts.push({ s: percentileScore(entry.pb, allPB, false), w: 0.35 });
    if (entry.dividendYield !== null) vParts.push({ s: percentileScore(entry.dividendYield, allDY, true), w: 0.25 });
    if (vParts.length > 0) {
      const wSum = vParts.reduce((a, b) => a + b.w, 0);
      entry.valuationScore = clamp(Math.round(vParts.reduce((a, b) => a + b.s * b.w, 0) / wSum));
    }

    // ERM: EPS growth 55% + revenue growth 45%
    const eParts: { s: number; w: number }[] = [];
    if (entry.epsGrowth !== null) eParts.push({ s: percentileScore(entry.epsGrowth, allEPSGrowth, true), w: 0.55 });
    if (entry.revenueGrowth !== null) eParts.push({ s: percentileScore(entry.revenueGrowth, allRevGrowth, true), w: 0.45 });
    if (eParts.length > 0) {
      const wSum = eParts.reduce((a, b) => a + b.w, 0);
      entry.ermScore = clamp(Math.round(eParts.reduce((a, b) => a + b.s * b.w, 0) / wSum));
    }

    // Momentum: derived from Yahoo price history in stockData.ts — leave null here
    // Insider: not on FMP free tier — leave null
  }

  state.data = tempMap;
  state.lastFetched = Date.now();
  state.status = "ready";
  console.log(`[fmp] Fundamentals cache ready: ${tempMap.size} stocks scored`);
}

// ─── Public API ──────────────────────────────────────────────────

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
  };
}

export async function initFundamentalsCache(): Promise<void> {
  await buildFundamentalsCache();
  setInterval(() => {
    buildFundamentalsCache().catch((err) =>
      console.warn("[fmp] Daily refresh failed (non-fatal):", err)
    );
  }, CACHE_TTL_MS);
}
