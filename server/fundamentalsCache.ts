/**
 * fundamentalsCache.ts
 *
 * Fetches real fundamental data from Financial Modeling Prep (FMP) free tier.
 * Caches results in memory and refreshes every 24 hours.
 *
 * Factor scores are computed from real data when available,
 * falling back to the seeded-random scores in stockData.ts if FMP is unavailable.
 *
 * FMP Free tier: 250 requests/day
 *   - /api/v3/stock-screener  → 1 call for full NYSE+NASDAQ universe
 *   - /api/v3/key-metrics-ttm → 1 call per ticker for ROE, P/E, P/B, etc.
 *
 * To enable: set FMP_API_KEY environment variable in Render.
 * Sign up free at https://financialmodelingprep.com
 */

declare const fetch: (input: any, init?: any) => Promise<any>;

const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const FMP_API_KEY = process.env.FMP_API_KEY;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface FundamentalsScore {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
  marketCap: number | null;
  // Raw metrics
  pe: number | null;
  pb: number | null;
  roe: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  epsGrowth: number | null;
  beta: number | null;
  dividendYield: number | null;
  debtToEquity: number | null;
  // Factor scores (0-100), null = not yet computed
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

// ─── FMP API helpers ────────────────────────────────────────────

async function fmpGet(endpoint: string): Promise<any> {
  if (!FMP_API_KEY) return null;
  const url = `${FMP_BASE}${endpoint}&apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[fmp] HTTP ${res.status} for ${endpoint}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[fmp] fetch failed for ${endpoint}:`, err);
    return null;
  }
}

// ─── Score normalization helpers ────────────────────────────────

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Percentile-rank a value against an array and return a 0-100 score.
 * higherIsBetter=true means higher raw values → higher scores.
 */
function percentileScore(value: number, allValues: number[], higherIsBetter = true): number {
  if (allValues.length === 0) return 50;
  const sorted = [...allValues].sort((a, b) => a - b);
  let rank = sorted.filter((v) => v < value).length;
  const score = (rank / (sorted.length - 1 || 1)) * 100;
  return clamp(Math.round(higherIsBetter ? score : 100 - score));
}

// ─── Main fetch + score pipeline ────────────────────────────────

async function buildFundamentalsCache(): Promise<void> {
  if (!FMP_API_KEY) {
    console.warn("[fmp] FMP_API_KEY not set — real fundamentals disabled. Using seeded scores.");
    state.status = "error";
    return;
  }

  console.log("[fmp] Starting fundamentals fetch...");
  state.status = "loading";

  // Step 1: Stock screener — get full NYSE + NASDAQ universe with key metrics
  // One API call returns up to 1000 companies with marketCap, beta, sector, etc.
  const screenerData = await fmpGet(
    `/stock-screener?marketCapMoreThan=500000000&exchange=NYSE,NASDAQ&limit=1000&`
  );

  if (!screenerData || !Array.isArray(screenerData) || screenerData.length === 0) {
    console.warn("[fmp] Screener returned no data");
    state.status = "error";
    return;
  }

  console.log(`[fmp] Screener returned ${screenerData.length} companies`);

  // Step 2: Build initial map from screener data
  const tempMap = new Map<string, FundamentalsScore>();
  for (const row of screenerData) {
    if (!row.symbol) continue;
    tempMap.set(row.symbol, {
      ticker: row.symbol,
      name: row.companyName ?? row.symbol,
      sector: row.sector ?? "Unknown",
      exchange: row.exchangeShortName ?? "NYSE",
      marketCap: typeof row.marketCap === "number" ? row.marketCap : null,
      pe: typeof row.price === "number" && typeof row.eps === "number" && row.eps > 0
        ? Math.round((row.price / row.eps) * 10) / 10
        : null,
      pb: null,
      roe: null,
      profitMargin: typeof row.netProfitMargin === "number" ? row.netProfitMargin * 100 : null,
      revenueGrowth: null,
      epsGrowth: null,
      beta: typeof row.beta === "number" ? row.beta : null,
      dividendYield: typeof row.lastAnnualDividend === "number" && typeof row.price === "number" && row.price > 0
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

  // Step 3: Fetch key metrics TTM for top 200 by market cap (uses ~200 of our 250 daily calls)
  // Sort by market cap descending and take top 200
  const topTickers = Array.from(tempMap.values())
    .filter((s) => s.marketCap !== null)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, 200)
    .map((s) => s.ticker);

  // FMP supports batch key-metrics via comma-separated symbols in some endpoints.
  // To stay within free tier, fetch in batches of 5 with a small delay.
  let fetched = 0;
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 300;

  for (let i = 0; i < topTickers.length; i += BATCH_SIZE) {
    const batch = topTickers.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (ticker) => {
        const data = await fmpGet(`/key-metrics-ttm/${ticker}?`);
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

  console.log(`[fmp] Fetched key metrics for ${fetched} tickers`);

  // Step 4: Compute factor scores via percentile ranking across universe
  const entries = Array.from(tempMap.values());

  const get = (arr: (number | null)[]): number[] => arr.filter((v): v is number => v !== null);

  const allROE = get(entries.map((e) => e.roe));
  const allMargin = get(entries.map((e) => e.profitMargin));
  const allDE = get(entries.map((e) => e.debtToEquity));
  const allBeta = get(entries.map((e) => e.beta));
  const allPE = get(entries.map((e) => e.pe));
  const allPB = get(entries.map((e) => e.pb));
  const allDY = get(entries.map((e) => e.dividendYield));
  const allRevGrowth = get(entries.map((e) => e.revenueGrowth));
  const allEPSGrowth = get(entries.map((e) => e.epsGrowth));

  for (const entry of entries) {
    // Quality: ROE (40%) + margin (35%) + low debt (25%)
    const qScores: number[] = [];
    if (entry.roe !== null) qScores.push(percentileScore(entry.roe, allROE, true) * 0.4);
    if (entry.profitMargin !== null) qScores.push(percentileScore(entry.profitMargin, allMargin, true) * 0.35);
    if (entry.debtToEquity !== null) qScores.push(percentileScore(entry.debtToEquity, allDE, false) * 0.25);
    entry.qualityScore = qScores.length > 0 ? clamp(Math.round(qScores.reduce((a, b) => a + b, 0) / (qScores.length / (qScores.length > 0 ? 1 : 1)) * (1 / 1))) : null;
    // Simplified: just average the available component scores
    if (qScores.length > 0) {
      const weights = [0.4, 0.35, 0.25].slice(0, qScores.length);
      const wSum = weights.reduce((a, b) => a + b, 0);
      entry.qualityScore = clamp(Math.round(qScores.reduce((a, b) => a + b, 0) / wSum));
    }

    // Low Vol: inverse beta (60%) + (we don't have 52w vol from screener, use beta only)
    if (entry.beta !== null) {
      entry.lowVolScore = clamp(percentileScore(entry.beta, allBeta, false));
    }

    // Valuation: inverse PE (40%) + inverse PB (35%) + dividend yield (25%)
    const vScores: { s: number; w: number }[] = [];
    if (entry.pe !== null && entry.pe > 0) vScores.push({ s: percentileScore(entry.pe, allPE.filter(p => p > 0), false), w: 0.4 });
    if (entry.pb !== null && entry.pb > 0) vScores.push({ s: percentileScore(entry.pb, allPB.filter(p => p > 0), false), w: 0.35 });
    if (entry.dividendYield !== null) vScores.push({ s: percentileScore(entry.dividendYield, allDY, true), w: 0.25 });
    if (vScores.length > 0) {
      const wSum = vScores.reduce((a, b) => a + b.w, 0);
      entry.valuationScore = clamp(Math.round(vScores.reduce((a, b) => a + b.s * b.w, 0) / wSum));
    }

    // ERM: EPS growth (55%) + revenue growth (45%)
    const eScores: { s: number; w: number }[] = [];
    if (entry.epsGrowth !== null) eScores.push({ s: percentileScore(entry.epsGrowth, allEPSGrowth, true), w: 0.55 });
    if (entry.revenueGrowth !== null) eScores.push({ s: percentileScore(entry.revenueGrowth, allRevGrowth, true), w: 0.45 });
    if (eScores.length > 0) {
      const wSum = eScores.reduce((a, b) => a + b.w, 0);
      entry.ermScore = clamp(Math.round(eScores.reduce((a, b) => a + b.s * b.w, 0) / wSum));
    }

    // Momentum: no historical price data from free screener — will be set by live Finnhub % change overlay
    // Leave momentumScore null here; stockData.ts will use its seeded momentum as fallback

    // Insider: not available on FMP free tier — leave null (stockData seeded fallback)
    entry.insiderScore = null;
  }

  // Commit to state
  state.data = tempMap;
  state.lastFetched = Date.now();
  state.status = "ready";
  console.log(`[fmp] Fundamentals cache ready: ${tempMap.size} stocks scored`);
}

// ─── Public API ─────────────────────────────────────────────────

/** Returns the cached fundamentals for a ticker, or null if not available. */
export function getFundamentals(ticker: string): FundamentalsScore | null {
  return state.data.get(ticker) ?? null;
}

/** Returns all cached entries. */
export function getAllFundamentals(): FundamentalsScore[] {
  return Array.from(state.data.values());
}

/** Returns the cache status. */
export function getCacheStatus() {
  return {
    status: state.status,
    count: state.data.size,
    lastFetched: state.lastFetched,
    fmpEnabled: !!FMP_API_KEY,
  };
}

/**
 * Initialize the fundamentals cache. Called on server startup.
 * Refreshes every 24 hours via setInterval.
 */
export async function initFundamentalsCache(): Promise<void> {
  await buildFundamentalsCache();

  // Schedule daily refresh
  setInterval(() => {
    buildFundamentalsCache().catch((err) =>
      console.warn("[fmp] Daily refresh failed (non-fatal):", err)
    );
  }, CACHE_TTL_MS);
}
