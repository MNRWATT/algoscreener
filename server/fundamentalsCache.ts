/**
 * fundamentalsCache.ts
 *
 * Fetches real fundamental data from Yahoo Finance (free, no API key).
 * Uses the unofficial quoteSummary v10 endpoint — same host we use for
 * price history, so no new dependencies or environment variables.
 *
 * Modules fetched per ticker (single request):
 *   defaultKeyStatistics → beta, trailingPE, priceToBook, earningsQuarterlyGrowth
 *   financialData        → returnOnEquity, profitMargins, revenueGrowth, debtToEquity
 *   summaryDetail        → marketCap, dividendYield, trailingPE (fallback)
 *   assetProfile         → sector, industry
 *
 * No API key required. No daily call limit.
 * All ~250 tickers fetched at boot with 300ms stagger (≈75s total).
 */

declare const fetch: (input: any, init?: any) => Promise<any>;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const YAHOO_MODULES = [
  "defaultKeyStatistics",
  "financialData",
  "summaryDetail",
  "assetProfile",
].join("%2C");

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

// ─── Yahoo quoteSummary fetch ────────────────────────────────────────

function num(val: any): number | null {
  if (val && typeof val === "object" && "raw" in val) val = val.raw;
  return typeof val === "number" && isFinite(val) ? val : null;
}

async function fetchYahooFundamentals(ticker: string): Promise<FundamentalsScore | null> {
  const symbol = ticker.replace(".", "-");
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${YAHOO_MODULES}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AlgoScreener/1.0)",
        Accept: "application/json",
      },
    });
    if (!res || !res.ok) {
      console.warn(`[yahoo-fund] HTTP ${res?.status} for ${ticker}`);
      return null;
    }
    const json = await res.json() as any;
    const result = json?.quoteSummary?.result?.[0];
    if (!result) {
      console.warn(`[yahoo-fund] no result for ${ticker}`);
      return null;
    }

    const ks  = result.defaultKeyStatistics ?? {};
    const fd  = result.financialData ?? {};
    const sd  = result.summaryDetail ?? {};
    const ap  = result.assetProfile ?? {};

    // P/E: prefer trailingPE from summaryDetail (more reliable), fallback to keyStats
    const pe = num(sd.trailingPE) ?? num(ks.trailingPE);
    // P/B
    const pb = num(ks.priceToBook);
    // ROE comes as decimal e.g. 0.25 → convert to %
    const roeRaw = num(fd.returnOnEquity);
    const roe = roeRaw !== null ? Math.round(roeRaw * 1000) / 10 : null;
    // Profit margin: decimal → %
    const marginRaw = num(fd.profitMargins);
    const profitMargin = marginRaw !== null ? Math.round(marginRaw * 1000) / 10 : null;
    // Revenue growth: decimal → %
    const revRaw = num(fd.revenueGrowth);
    const revenueGrowth = revRaw !== null ? Math.round(revRaw * 1000) / 10 : null;
    // EPS growth (quarterly YoY): decimal → %
    const epsRaw = num(ks.earningsQuarterlyGrowth);
    const epsGrowth = epsRaw !== null ? Math.round(epsRaw * 1000) / 10 : null;
    // D/E ratio
    const deRaw = num(fd.debtToEquity);
    // Yahoo returns D/E as e.g. 150 (meaning 1.5x) — normalise to same scale as FMP (0–10 range)
    const debtToEquity = deRaw !== null ? Math.round((deRaw / 100) * 100) / 100 : null;
    // Dividend yield: decimal → %
    const dyRaw = num(sd.dividendYield) ?? num(sd.trailingAnnualDividendYield);
    const dividendYield = dyRaw !== null ? Math.round(dyRaw * 10000) / 100 : null;
    // Beta
    const beta = num(ks.beta) ?? num(sd.beta);
    // Market cap (raw number, in dollars)
    const marketCap = num(sd.marketCap);
    // Sector
    const sector = typeof ap.sector === "string" ? ap.sector : "Unknown";

    return {
      ticker,
      name: ticker, // name comes from stockData, not needed here
      sector,
      exchange: "NYSE", // exchange comes from stockData too
      marketCap,
      pe: pe !== null && pe > 0 ? Math.round(pe * 10) / 10 : null,
      pb: pb !== null && pb > 0 ? Math.round(pb * 10) / 10 : null,
      roe,
      profitMargin,
      revenueGrowth,
      epsGrowth,
      beta,
      dividendYield,
      debtToEquity,
      momentumScore: null,
      qualityScore: null,
      lowVolScore: null,
      valuationScore: null,
      ermScore: null,
      insiderScore: null,
    };
  } catch (err) {
    console.warn(`[yahoo-fund] fetch failed for ${ticker}:`, err);
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

async function buildFundamentalsCache(tickers: string[]): Promise<void> {
  console.log(`[yahoo-fund] Starting fundamentals fetch for ${tickers.length} tickers...`);
  state.status = "loading";

  const tempMap = new Map<string, FundamentalsScore>();
  let success = 0;
  let failed = 0;

  const BATCH = 5;
  const DELAY = 300;

  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (ticker) => {
        const entry = await fetchYahooFundamentals(ticker);
        if (entry) {
          tempMap.set(ticker, entry);
          success++;
        } else {
          failed++;
        }
      })
    );
    if (i + BATCH < tickers.length) {
      await new Promise((r) => setTimeout(r, DELAY));
    }
  }

  console.log(`[yahoo-fund] Fetched: ${success} ok, ${failed} failed`);

  if (success === 0) {
    console.warn("[yahoo-fund] All fetches failed — keeping seeded fallbacks");
    state.status = "error";
    return;
  }

  // ── Percentile-rank factor scores across the fetched universe ────────
  const entries = Array.from(tempMap.values());
  const nums2 = (arr: (number | null)[]): number[] => arr.filter((v): v is number => v !== null);

  const allROE       = nums2(entries.map((e) => e.roe));
  const allMargin    = nums2(entries.map((e) => e.profitMargin));
  const allDE        = nums2(entries.map((e) => e.debtToEquity));
  const allBeta      = nums2(entries.map((e) => e.beta));
  const allPE        = nums2(entries.map((e) => e.pe)).filter((v) => v > 0);
  const allPB        = nums2(entries.map((e) => e.pb)).filter((v) => v > 0);
  const allDY        = nums2(entries.map((e) => e.dividendYield));
  const allRevGrowth = nums2(entries.map((e) => e.revenueGrowth));
  const allEPSGrowth = nums2(entries.map((e) => e.epsGrowth));

  for (const e of entries) {
    // Quality: ROE 40% + margin 35% + low D/E 25%
    const qParts: { s: number; w: number }[] = [];
    if (e.roe !== null)          qParts.push({ s: percentileScore(e.roe, allROE, true), w: 0.4 });
    if (e.profitMargin !== null) qParts.push({ s: percentileScore(e.profitMargin, allMargin, true), w: 0.35 });
    if (e.debtToEquity !== null) qParts.push({ s: percentileScore(e.debtToEquity, allDE, false), w: 0.25 });
    e.qualityScore = weightedScore(qParts);

    // Low Vol: inverse beta (Yahoo beta = same 5Y monthly beta as most providers)
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
  console.log(`[yahoo-fund] Fundamentals cache ready: ${tempMap.size} tickers scored`);
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
    fmpEnabled: false, // no longer used
  };
}

/**
 * Called on server startup. Fetches Yahoo fundamentals for all tickers.
 * Refreshes every 24 hours.
 */
export async function initFundamentalsCache(tickers?: string[]): Promise<void> {
  const { getAllStocks } = await import("./stockData");
  const allTickers = tickers ?? getAllStocks().map((s) => s.ticker);

  await buildFundamentalsCache(allTickers);

  setInterval(
    () =>
      buildFundamentalsCache(allTickers).catch((err) =>
        console.warn("[yahoo-fund] Daily refresh failed (non-fatal):", err)
      ),
    CACHE_TTL_MS
  );
}
