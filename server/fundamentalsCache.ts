/**
 * fundamentalsCache.ts
 *
 * Fetches real fundamental data from Financial Modeling Prep (FMP) free tier.
 *
 * FREE TIER endpoints used (no /stock-screener — that requires paid plan):
 *   GET /api/v3/profile/{ticker}          → name, sector, exchange, marketCap, beta, price
 *   GET /api/v3/ratios-ttm/{ticker}       → PE, PB, ROE, margins, D/E, div yield, growth
 *
 * We iterate over our known ~250 tickers in batches of 5 with 300ms between
 * batches. Total API calls ≈ 500, split over two nights if on 250/day limit.
 * On the free "Developer" key the limit is actually 250 calls/day total, so
 * we cap to 120 tickers (~240 calls) which covers the most important names.
 *
 * To enable: set FMP_API_KEY environment variable in Render.
 */

declare const fetch: (input: any, init?: any) => Promise<any>;

const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const FMP_API_KEY = process.env.FMP_API_KEY;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Max tickers to enrich per boot (2 calls each = 2 × MAX_TICKERS API calls).
// Free tier = 250 calls/day → safe cap is 120 tickers (240 calls).
const MAX_TICKERS = 120;

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

// ─── FMP helper ───────────────────────────────────────────────────

async function fmpGet(path: string): Promise<any> {
  if (!FMP_API_KEY) return null;
  const url = `${FMP_BASE}${path}?apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AlgoScreener/1.0", Accept: "application/json" },
    });
    if (!res || !res.ok) {
      console.warn(`[fmp] HTTP ${res?.status} for ${path}`);
      return null;
    }
    const json = await res.json();
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

// ─── Score normalization ──────────────────────────────────────────

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

function weightedScore(parts: { s: number; w: number }[]): number | null {
  if (parts.length === 0) return null;
  const wSum = parts.reduce((a, b) => a + b.w, 0);
  if (wSum === 0) return null;
  return clamp(Math.round(parts.reduce((a, b) => a + b.s * b.w, 0) / wSum));
}

// ─── Main pipeline ────────────────────────────────────────────────

async function buildFundamentalsCache(
  tickers: string[]
): Promise<void> {
  if (!FMP_API_KEY) {
    console.warn("[fmp] FMP_API_KEY not set — real fundamentals disabled.");
    state.status = "error";
    return;
  }

  console.log(`[fmp] Starting fundamentals fetch for ${tickers.length} tickers...`);
  state.status = "loading";

  const tempMap = new Map<string, FundamentalsScore>();

  // Initialise map with empty entries so we have something even if API fails
  for (const ticker of tickers) {
    tempMap.set(ticker, {
      ticker, name: ticker, sector: "Unknown", exchange: "NYSE",
      marketCap: null, pe: null, pb: null, roe: null, profitMargin: null,
      revenueGrowth: null, epsGrowth: null, beta: null, dividendYield: null,
      debtToEquity: null, momentumScore: null, qualityScore: null,
      lowVolScore: null, valuationScore: null, ermScore: null, insiderScore: null,
    });
  }

  const BATCH = 5;
  const DELAY = 350; // ms between batches
  let profileOk = 0;
  let ratiosOk = 0;

  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (ticker) => {
        const entry = tempMap.get(ticker)!;

        // ── /profile/{ticker} ──────────────────────────────────────
        const profileData = await fmpGet(`/profile/${ticker}`);
        if (Array.isArray(profileData) && profileData.length > 0) {
          const p = profileData[0];
          if (p.companyName) entry.name = p.companyName;
          if (p.sector) entry.sector = p.sector;
          if (p.exchangeShortName) entry.exchange = p.exchangeShortName;
          if (typeof p.mktCap === "number") entry.marketCap = p.mktCap;
          if (typeof p.beta === "number") entry.beta = p.beta;
          profileOk++;
        }

        // ── /ratios-ttm/{ticker} ───────────────────────────────────
        const ratioData = await fmpGet(`/ratios-ttm/${ticker}`);
        if (Array.isArray(ratioData) && ratioData.length > 0) {
          const r = ratioData[0];
          // PE — use positive values only
          if (typeof r.peRatioTTM === "number" && r.peRatioTTM > 0)
            entry.pe = Math.round(r.peRatioTTM * 10) / 10;
          if (typeof r.priceToBookRatioTTM === "number" && r.priceToBookRatioTTM > 0)
            entry.pb = Math.round(r.priceToBookRatioTTM * 10) / 10;
          // ROE comes as a decimal (e.g. 0.25 = 25%)
          if (typeof r.returnOnEquityTTM === "number")
            entry.roe = Math.round(r.returnOnEquityTTM * 1000) / 10;
          if (typeof r.netProfitMarginTTM === "number")
            entry.profitMargin = Math.round(r.netProfitMarginTTM * 1000) / 10;
          if (typeof r.revenueGrowthTTM === "number")
            entry.revenueGrowth = Math.round(r.revenueGrowthTTM * 1000) / 10;
          if (typeof r.epsGrowthTTM === "number")
            entry.epsGrowth = Math.round(r.epsGrowthTTM * 1000) / 10;
          if (typeof r.debtEquityRatioTTM === "number")
            entry.debtToEquity = Math.round(r.debtEquityRatioTTM * 100) / 100;
          if (typeof r.dividendYieldTTM === "number")
            entry.dividendYield = Math.round(r.dividendYieldTTM * 10000) / 100;
          ratiosOk++;
        }
      })
    );
    if (i + BATCH < tickers.length) {
      await new Promise((r) => setTimeout(r, DELAY));
    }
  }

  console.log(`[fmp] profiles: ${profileOk}/${tickers.length}, ratios: ${ratiosOk}/${tickers.length}`);

  // ── Percentile-rank scores across universe ───────────────────────
  const entries = Array.from(tempMap.values());
  const nums = (arr: (number | null)[]): number[] => arr.filter((v): v is number => v !== null);

  const allROE      = nums(entries.map((e) => e.roe));
  const allMargin   = nums(entries.map((e) => e.profitMargin));
  const allDE       = nums(entries.map((e) => e.debtToEquity));
  const allBeta     = nums(entries.map((e) => e.beta));
  const allPE       = nums(entries.map((e) => e.pe)).filter((v) => v > 0);
  const allPB       = nums(entries.map((e) => e.pb)).filter((v) => v > 0);
  const allDY       = nums(entries.map((e) => e.dividendYield));
  const allRevGrowth = nums(entries.map((e) => e.revenueGrowth));
  const allEPSGrowth = nums(entries.map((e) => e.epsGrowth));

  for (const e of entries) {
    // Quality: ROE 40% + margin 35% + low D/E 25%
    const qParts: { s: number; w: number }[] = [];
    if (e.roe !== null)          qParts.push({ s: percentileScore(e.roe, allROE, true), w: 0.4 });
    if (e.profitMargin !== null) qParts.push({ s: percentileScore(e.profitMargin, allMargin, true), w: 0.35 });
    if (e.debtToEquity !== null) qParts.push({ s: percentileScore(e.debtToEquity, allDE, false), w: 0.25 });
    e.qualityScore = weightedScore(qParts);

    // Low Vol: inverse beta (52W vol blended in by stockData once Yahoo history ready)
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

    // Momentum + Insider: derived elsewhere, leave null
  }

  state.data = tempMap;
  state.lastFetched = Date.now();
  state.status = "ready";
  console.log(`[fmp] Fundamentals cache ready: ${tempMap.size} tickers scored`);
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
  };
}

/**
 * Called on server startup. Passes the top MAX_TICKERS tickers (by position
 * in our universe list, which is roughly market-cap ordered) to the pipeline.
 * Refreshes every 24 hours.
 */
export async function initFundamentalsCache(
  tickers?: string[]
): Promise<void> {
  // Lazy-import getAllStocks to avoid circular dep at module load time
  const { getAllStocks } = await import("./stockData");
  const allTickers = (tickers ?? getAllStocks().map((s) => s.ticker)).slice(0, MAX_TICKERS);

  await buildFundamentalsCache(allTickers);

  setInterval(
    () =>
      buildFundamentalsCache(allTickers).catch((err) =>
        console.warn("[fmp] Daily refresh failed (non-fatal):", err)
      ),
    CACHE_TTL_MS
  );
}
