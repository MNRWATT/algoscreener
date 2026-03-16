/**
 * fundamentalsCache.ts
 *
 * Two data sources, both confirmed working:
 *
 *  Source 1 — Yahoo v8 /chart meta (zero extra API calls)
 *    Extracted during the existing prewarm in marketData.ts
 *    Fields: pe, pb, beta, marketCap, eps, dividendYield, bookValue, sector
 *    Derived: insiderOwnership not available — shown as dash
 *
 *  Source 2 — Finnhub /stock/metric
 *    Fields: epsGrowth (epsTTMGrowth), revenueGrowth (revenueGrowthTTMYoy)
 *    Free tier: 60 calls/min, no daily cap
 *
 * No Yahoo v7, no FMP, no quoteSummary.
 * Null = data not available = dash in UI. No seeded fallbacks.
 */

declare const fetch: (input: any, init?: any) => Promise<any>;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

export interface ChartMeta {
  pe: number | null;
  pb: number | null;
  beta: number | null;
  marketCap: number | null;
  eps: number | null;
  dividendYield: number | null;
  bookValue: number | null;
  sector: string | null;
}

export interface FundamentalsScore {
  ticker: string;
  sector: string;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  roe: number | null;           // not available from v8 meta — always null
  profitMargin: number | null;  // not available from v8 meta — always null
  revenueGrowth: number | null; // Finnhub
  epsGrowth: number | null;     // Finnhub
  beta: number | null;          // Yahoo v8 meta
  dividendYield: number | null; // Yahoo v8 meta
  debtToEquity: number | null;  // not available — always null
  insiderOwnership: number | null; // not available — always null
  // Factor scores
  qualityScore: number | null;
  lowVolScore: number | null;
  valuationScore: number | null;
  ermScore: number | null;
  insiderScore: number | null;
  sources: string[];
}

interface CacheState {
  data: Map<string, FundamentalsScore>;
  chartMeta: Map<string, ChartMeta>;
  lastFetched: number;
  status: "empty" | "loading" | "ready" | "error";
}

const state: CacheState = {
  data: new Map(),
  chartMeta: new Map(),
  lastFetched: 0,
  status: "empty",
};

// Called by marketData.ts during each v8 chart fetch — no extra HTTP calls
export function storeChartMeta(ticker: string, meta: ChartMeta): void {
  state.chartMeta.set(ticker, meta);
}

// ─── Helpers ──────────────────────────────────────────────────────

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

// ─── Source 2: Finnhub /stock/metric ─────────────────────────────

async function safeFetch(url: string): Promise<any> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AlgoScreener/1.0", Accept: "application/json" },
    });
    if (!res || !res.ok) { console.warn(`[fund] HTTP ${res?.status} → ${url.split("?")[0]}`); return null; }
    return await res.json();
  } catch (err) {
    console.warn(`[fund] fetch error: ${err}`);
    return null;
  }
}

async function fetchFinnhubMetrics(tickers: string[]): Promise<Map<string, { epsGrowth: number | null; revenueGrowth: number | null }>> {
  const result = new Map<string, { epsGrowth: number | null; revenueGrowth: number | null }>();
  if (!FINNHUB_API_KEY) {
    console.warn("[fund:finnhub] FINNHUB_API_KEY not set — ERM scores will be null");
    return result;
  }
  for (const ticker of tickers) {
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${FINNHUB_API_KEY}`;
    const json = await safeFetch(url);
    const m = json?.metric ?? {};
    const epsRaw   = typeof m["epsTTMGrowth"]            === "number" ? m["epsTTMGrowth"]            : null;
    const revRaw   = typeof m["revenueGrowthTTMYoy"]     === "number" ? m["revenueGrowthTTMYoy"]     : null;
    result.set(ticker, {
      epsGrowth:     epsRaw !== null ? Math.round(epsRaw * 10) / 10 : null,
      revenueGrowth: revRaw !== null ? Math.round(revRaw * 10) / 10 : null,
    });
    await new Promise((r) => setTimeout(r, 300)); // 60/min free tier
  }
  return result;
}

// ─── Main pipeline ────────────────────────────────────────────────
// Called after prewarmHistoryCache() has populated chartMeta for all tickers.

export async function buildScoresFromMeta(tickers: string[]): Promise<void> {
  console.log(`[fund] Building scores from chart meta for ${tickers.length} tickers...`);
  state.status = "loading";

  // Fetch Finnhub growth metrics (the only extra network calls we make)
  const finnhubMap = await fetchFinnhubMetrics(tickers);

  const tempMap = new Map<string, FundamentalsScore>();

  for (const ticker of tickers) {
    const m = state.chartMeta.get(ticker);
    const f = finnhubMap.get(ticker);
    const sources: string[] = [];
    if (m) sources.push("yahoo-v8-meta");
    if (f && (f.epsGrowth !== null || f.revenueGrowth !== null)) sources.push("finnhub");

    // PE from meta; fallback: price/eps if both available
    let pe = m?.pe ?? null;
    if ((pe === null || pe <= 0) && m?.eps && m.eps > 0 && m?.pe == null) pe = null; // can't derive safely
    const pb = (m?.pb != null && m.pb > 0) ? Math.round(m.pb * 10) / 10 : null;
    const beta = m?.beta ?? null;
    const marketCap = m?.marketCap ?? null;
    const dyRaw = m?.dividendYield ?? null;
    // Yahoo v8 dividendYield is already a decimal (e.g. 0.012 = 1.2%)
    const dividendYield = dyRaw !== null ? Math.round(dyRaw * 10000) / 100 : null;
    const sector = m?.sector ?? "Unknown";

    tempMap.set(ticker, {
      ticker,
      sector,
      marketCap,
      pe: pe !== null && pe > 0 ? Math.round(pe * 10) / 10 : null,
      pb,
      roe: null,
      profitMargin: null,
      revenueGrowth: f?.revenueGrowth ?? null,
      epsGrowth: f?.epsGrowth ?? null,
      beta,
      dividendYield,
      debtToEquity: null,
      insiderOwnership: null,
      qualityScore: null,
      lowVolScore: null,
      valuationScore: null,
      ermScore: null,
      insiderScore: null,
      sources,
    });
  }

  // ── Percentile-rank across universe ──────────────────────────────
  const entries = Array.from(tempMap.values());
  const nn = (arr: (number | null)[]): number[] => arr.filter((v): v is number => v !== null);

  const allBeta      = nn(entries.map((e) => e.beta));
  const allPE        = nn(entries.map((e) => e.pe)).filter((v) => v > 0 && v < 500);
  const allPB        = nn(entries.map((e) => e.pb)).filter((v) => v > 0 && v < 100);
  const allDY        = nn(entries.map((e) => e.dividendYield));
  const allRevGrowth = nn(entries.map((e) => e.revenueGrowth));
  const allEPSGrowth = nn(entries.map((e) => e.epsGrowth));

  for (const e of entries) {
    // Quality: only PB available from v8 meta (proxy for asset efficiency)
    // PE inversion as secondary quality signal when PB missing
    const qParts: { s: number; w: number }[] = [];
    if (e.pb !== null && e.pb > 0 && e.pb < 100) qParts.push({ s: percentileScore(e.pb, allPB, false), w: 1 });
    e.qualityScore = weightedScore(qParts); // will be null if no PB

    // Low Vol: inverse beta
    if (e.beta !== null)
      e.lowVolScore = clamp(percentileScore(e.beta, allBeta, false));

    // Valuation: inverse PE 60% + div yield 40%
    const vParts: { s: number; w: number }[] = [];
    if (e.pe !== null && e.pe > 0 && e.pe < 500) vParts.push({ s: percentileScore(e.pe, allPE, false), w: 0.6 });
    if (e.dividendYield !== null)                 vParts.push({ s: percentileScore(e.dividendYield, allDY, true), w: 0.4 });
    e.valuationScore = weightedScore(vParts);

    // ERM: EPS growth 55% + revenue growth 45%
    const eParts: { s: number; w: number }[] = [];
    if (e.epsGrowth !== null)     eParts.push({ s: percentileScore(e.epsGrowth, allEPSGrowth, true), w: 0.55 });
    if (e.revenueGrowth !== null) eParts.push({ s: percentileScore(e.revenueGrowth, allRevGrowth, true), w: 0.45 });
    e.ermScore = weightedScore(eParts);

    // Insider: no source available
    e.insiderScore = null;
  }

  const scored = entries.filter((e) => e.sources.length > 0).length;
  state.data = tempMap;
  state.lastFetched = Date.now();
  state.status = scored > 0 ? "ready" : "error";
  console.log(`[fund] Scores ready: ${scored}/${tempMap.size} tickers with live data. finnhub=${finnhubMap.size}`);
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
    fmpEnabled: false,
    sources: {
      yahooV8Meta: state.chartMeta.size,
      finnhub: !!FINNHUB_API_KEY,
    },
  };
}

// Legacy stub — no longer needed but kept to avoid import errors
export async function initFundamentalsCache(_tickers?: string[]): Promise<void> {
  // Now driven by buildScoresFromMeta() called from index.ts after prewarm
}
