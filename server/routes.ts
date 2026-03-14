import type { Express } from "express";
import { createServer, type Server } from "http";
import { getAllStocks, SECTORS, EXCHANGES, runBacktest } from "./stockData";
import type { FactorWeights, MarketRegime, PresetStrategy, WatchlistItem, Alert, AlertRule } from "@shared/schema";
import { randomUUID } from "crypto";
import {
  getLiveQuotes, getFundamentals, getCachedFundamentals,
  getCachedQuote, getHistoricalPrices, prewarmFundamentals,
  type YahooQuote, type YahooFundamentals,
} from "./marketData";

// ─── Scoring ──────────────────────────────────────────────────────

function cap(v: number) { return Math.max(0, Math.min(100, Math.round(v))); }
function r2(v: number)  { return Math.round(v * 100) / 100; }

function scoreStock(
  q: YahooQuote | null,
  f: YahooFundamentals | null,
  weights: FactorWeights,
) {
  const r12       = q?.week52ChangePercent ?? 0;
  const momentum  = cap(50 + r12 * 0.8);

  const roe       = f?.roe          ?? 12;
  const margin    = f?.profitMargin ?? 10;
  const quality   = cap((cap(roe * 2.0) + cap(margin * 2.5)) / 2);

  const beta      = q?.beta ?? 1.0;
  const lowVol    = cap((2.0 - beta) / 2.0 * 100);

  const pe        = q?.pe           ?? 25;
  const pb        = q?.pb           ?? 3;
  const div       = q?.dividendYield ?? 0;
  const valuation = cap((cap(100 - pe * 1.5) + cap(100 - pb * 7) + cap(div * 20)) / 3);

  const epsG      = f?.earningsGrowth ?? 5;
  const revG      = f?.revenueGrowth  ?? 5;
  const erm       = cap((cap(50 + epsG * 1.5) + cap(50 + revG * 2.0)) / 2);

  const insOwn    = f?.insiderOwnership ?? 3;
  const insider   = cap(insOwn * 5);

  const total = weights.momentum + weights.quality + weights.lowVol +
                weights.valuation + weights.erm + weights.insider;
  const composite = total > 0
    ? r2((momentum * weights.momentum + quality   * weights.quality +
          lowVol   * weights.lowVol   + valuation * weights.valuation +
          erm      * weights.erm      + insider   * weights.insider) / total)
    : 0;

  const metrics = {
    return12m:             r2(r12),
    return6m:              null as number | null,
    return3m:              null as number | null,
    roe:                   f?.roe                    ?? null,
    profitMargin:          f?.profitMargin           ?? null,
    debtToEquity:          f?.debtToEquity           ?? null,
    beta:                  q?.beta                   ?? null,
    volatility52w:         q?.beta != null ? r2(Math.abs(q.beta) * 18) : null,
    pe:                    q?.pe                     ?? null,
    pb:                    q?.pb                     ?? null,
    dividendYield:         q?.dividendYield          ?? null,
    epsGrowth:             f?.earningsGrowth         ?? null,
    revenueGrowth:         f?.revenueGrowth          ?? null,
    insiderOwnership:      f?.insiderOwnership       ?? null,
    institutionalOwnership: f?.institutionalOwnership ?? null,
  };

  return { momentum, quality, lowVol, valuation, erm, insider, composite, metrics };
}

// ─── Build screener from real Yahoo data ──────────────────────────

async function buildRealScreener(weights: FactorWeights) {
  const defs    = getAllStocks();
  const tickers = defs.map(d => d.ticker);
  const quotes  = await getLiveQuotes(tickers);

  return defs
    .map((def, i) => {
      const q = quotes[i];
      const f = getCachedFundamentals(def.ticker);
      const scores = scoreStock(q, f, weights);
      return {
        ticker:    def.ticker,
        name:      q?.name ?? def.name,
        sector:    def.sector,
        exchange:  def.exchange,
        price:     q?.price     ?? null,
        change1d:  q?.changePercent ?? null,
        marketCap: q?.marketCap != null ? r2(q.marketCap / 1e9) : null,
        week52High:    q?.week52High    ?? null,
        week52Low:     q?.week52Low     ?? null,
        beta:          q?.beta          ?? null,
        pe:            q?.pe            ?? null,
        dividendYield: q?.dividendYield ?? null,
        ...scores,
      };
    })
    .sort((a, b) => b.composite - a.composite);
}

// ─── Preset Strategies ────────────────────────────────────────────

const PRESETS: PresetStrategy[] = [
  { id: "aggressive-growth", name: "Aggr. Growth",  description: "Max momentum & earnings growth. High-conviction, high-volatility bets.",              icon: "rocket",       weights: { momentum: 40, quality: 10, lowVol: 0,  valuation: 5,  erm: 40, insider: 5  } },
  { id: "balanced",          name: "Balanced",       description: "Even-weighted exposure across all factors. Default starting point.",                   icon: "scale",        weights: { momentum: 30, quality: 25, lowVol: 20, valuation: 10, erm: 10, insider: 5  } },
  { id: "defensive",         name: "Defensive",      description: "Prioritize low volatility and quality. Capital preservation focus.",                   icon: "shield",       weights: { momentum: 5,  quality: 35, lowVol: 35, valuation: 15, erm: 5,  insider: 5  } },
  { id: "value-hunter",      name: "Value Hunter",   description: "Deep value with quality filter. Contrarian, patient capital.",                         icon: "search-dollar",weights: { momentum: 5,  quality: 25, lowVol: 10, valuation: 40, erm: 10, insider: 10 } },
  { id: "income",            name: "Income",         description: "High yield + stability. Dividend-focused with low volatility tilt.",                   icon: "wallet",       weights: { momentum: 5,  quality: 20, lowVol: 25, valuation: 35, erm: 5,  insider: 10 } },
  { id: "momentum-pure",     name: "Momentum",       description: "Trend-following with insider confirmation. Ride the winners.",                         icon: "trending-up",  weights: { momentum: 55, quality: 10, lowVol: 0,  valuation: 0,  erm: 20, insider: 15 } },
];

// ─── Market Regime ────────────────────────────────────────────────

function getMarketRegime(): MarketRegime {
  const vix = 25.75, yieldSpread10y2y = 0.56, sp500Ytd = -2.28, recessionProb = 27, inflationRate = 2.4, gdpGrowth = 1.4;
  const vixLabel = vix < 15 ? "Low" as const : vix < 20 ? "Moderate" as const : vix < 30 ? "Elevated" as const : "High" as const;
  const yieldCurveLabel = yieldSpread10y2y < -0.2 ? "Inverted" as const : yieldSpread10y2y < 0.1 ? "Flat" as const : yieldSpread10y2y < 1.0 ? "Normal" as const : "Steep" as const;

  let suggestedWeights = { momentum: 15, quality: 30, lowVol: 25, valuation: 15, erm: 10, insider: 5 };
  let regimeName = "Cautious";
  let regimeDescription = "Elevated volatility with moderate recession risk. Yield curve normalizing post-inversion. Favor quality and stability over aggressive growth.";

  if (vix >= 30) {
    suggestedWeights = { momentum: 5, quality: 30, lowVol: 35, valuation: 15, erm: 5, insider: 10 };
    regimeName = "Risk-Off"; regimeDescription = "High volatility regime. Maximum defensive positioning with quality and low-volatility tilt.";
  } else if (vix < 15 && sp500Ytd > 5) {
    suggestedWeights = { momentum: 35, quality: 20, lowVol: 10, valuation: 10, erm: 20, insider: 5 };
    regimeName = "Risk-On"; regimeDescription = "Low volatility, positive trend. Lean into momentum and growth with quality backstop.";
  } else if (yieldSpread10y2y < -0.2) {
    suggestedWeights = { momentum: 10, quality: 30, lowVol: 25, valuation: 20, erm: 5, insider: 10 };
    regimeName = "Late Cycle"; regimeDescription = "Inverted yield curve signals slowdown ahead. Defensive quality + value positioning.";
  }

  return { vix, vixLabel, yieldSpread10y2y, yieldCurveLabel, fedRate: "3.50–3.75%", fedOutlook: "On hold, 1–2 cuts expected by year-end", sp500Ytd, recessionProb, inflationRate, gdpGrowth, geopoliticalRisk: "Elevated", regimeName, regimeDescription, suggestedWeights, lastUpdated: new Date().toISOString() };
}

// ─── In-Memory Storage ────────────────────────────────────────────

const watchlist:  Map<string, WatchlistItem> = new Map();
const alerts:     Alert[]     = [];
const alertRules: AlertRule[] = [];

function seedDemoAlerts() {
  const regime = getMarketRegime();
  alerts.push({ id: randomUUID(), type: "regime_change", message: `Market regime: ${regime.regimeName} — ${regime.vixLabel} VIX at ${regime.vix}`, createdAt: new Date(Date.now() - 3600000).toISOString(), read: false });
}
seedDemoAlerts();

// ─── Helpers ──────────────────────────────────────────────────────

function parseWeights(query: Record<string, string>): FactorWeights {
  return { momentum: Number(query.momentum ?? 30), quality: Number(query.quality ?? 25), lowVol: Number(query.lowVol ?? 20), valuation: Number(query.valuation ?? 10), erm: Number(query.erm ?? 10), insider: Number(query.insider ?? 5) };
}

// ─── Routes ───────────────────────────────────────────────────────

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // Start background fundamentals pre-warm (non-blocking)
  const allTickers = getAllStocks().map(s => s.ticker);
  prewarmFundamentals(allTickers).catch(() => null);

  // ─── Screener ────────────────────────────────────────────────

  app.get("/api/screener", async (req, res) => {
    const weights = parseWeights(req.query as Record<string, string>);
    const stocks  = await buildRealScreener(weights);
    res.json({ stocks, lastUpdated: new Date().toISOString(), universe: "TSX + S&P 500 + NASDAQ 100 + DOW 30" });
  });

  // ─── Sectors / Exchanges ─────────────────────────────────────

  app.get("/api/sectors",   (_req, res) => res.json(SECTORS));
  app.get("/api/exchanges", (_req, res) => res.json(EXCHANGES));

  // ─── Market Regime ───────────────────────────────────────────

  app.get("/api/market-regime", (_req, res) => res.json(getMarketRegime()));

  // ─── Presets ─────────────────────────────────────────────────

  app.get("/api/presets", (_req, res) => res.json(PRESETS));

  // ─── Stock Detail ────────────────────────────────────────────

  app.get("/api/stock/:ticker", async (req, res) => {
    const { ticker } = req.params;
    const weights    = parseWeights(req.query as Record<string, string>);
    const def        = getAllStocks().find(s => s.ticker === ticker);
    if (!def) { res.status(404).json({ error: "Stock not found" }); return; }

    const [q, f, priceHistory] = await Promise.all([
      getCachedQuote(ticker),
      getFundamentals(ticker),
      getHistoricalPrices(ticker, 24),
    ]);

    if (!q) { res.status(502).json({ error: `Live quote unavailable for ${ticker}` }); return; }

    const scores = scoreStock(q, f, weights);

    // Peers: top 4 from same sector, excluding self
    const allScored    = await buildRealScreener(weights);
    const peers        = allScored
      .filter(s => s.sector === def.sector && s.ticker !== ticker)
      .slice(0, 4)
      .map(s => ({ ticker: s.ticker, name: s.name, momentum: s.momentum, quality: s.quality, lowVol: s.lowVol, valuation: s.valuation, erm: s.erm, insider: s.insider, composite: s.composite }));

    const description = `${q.name} operates in the ${def.sector} sector, listed on ${def.exchange}. ` +
      (q.marketCap ? `Market cap: $${r2(q.marketCap / 1e9)}B. ` : "") +
      (q.pe        ? `Trailing P/E: ${r2(q.pe)}. `              : "") +
      (f.roe       ? `Return on equity: ${r2(f.roe)}%.`         : "");

    res.json({
      ticker: def.ticker, name: q.name, sector: def.sector, exchange: def.exchange,
      price: q.price, change1d: q.changePercent,
      marketCap: q.marketCap ? r2(q.marketCap / 1e9) : null,
      ...scores,
      priceHistory,
      peers,
      description,
    });
  });

  // ─── Live Quote ──────────────────────────────────────────────

  app.get("/api/quote/:ticker", async (req, res) => {
    try {
      const quote = await getCachedQuote(req.params.ticker);
      if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }
      res.json(quote);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch quote" });
    }
  });

  // ─── Backtesting ─────────────────────────────────────────────

  app.get("/api/backtest", (req, res) => {
    const weights = parseWeights(req.query as Record<string, string>);
    const period  = (req.query.period as string) || "1y";
    if (!["1y", "3y", "5y"].includes(period)) { res.status(400).json({ error: "Invalid period. Use 1y, 3y, or 5y" }); return; }
    res.json(runBacktest(weights, period as "1y" | "3y" | "5y"));
  });

  // ─── Portfolio ───────────────────────────────────────────────

  app.get("/api/portfolio", async (req, res) => {
    const weights    = parseWeights(req.query as Record<string, string>);
    const allScored  = await buildRealScreener(weights);
    const top25      = allScored.filter(s => s.price != null && s.price > 0).slice(0, 25);
    const totalScore = top25.reduce((s, st) => s + st.composite, 0);
    const portValue  = 10000;

    const holdings = top25.map(st => {
      const weight      = totalScore > 0 ? r2((st.composite / totalScore) * 100) : r2(100 / top25.length);
      const marketValue = r2(portValue * weight / 100);
      const shares      = r2(marketValue / st.price!);
      return { ticker: st.ticker, name: st.name, sector: st.sector, exchange: st.exchange, price: st.price, change1d: st.change1d, compositeScore: st.composite, weight, shares, marketValue, momentum: st.momentum, quality: st.quality, lowVol: st.lowVol, valuation: st.valuation, erm: st.erm, insider: st.insider };
    });

    const avgComposite         = r2(holdings.reduce((s, h) => s + h.compositeScore, 0) / holdings.length);
    const weightedBeta         = r2(holdings.reduce((s, h) => s + (h.weight / 100) * (top25.find(t => t.ticker === h.ticker)?.beta ?? 1), 0));
    const weightedDividendYield = r2(holdings.reduce((s, h) => s + (h.weight / 100) * (top25.find(t => t.ticker === h.ticker)?.dividendYield ?? 0), 0));
    const weightedPE            = r2(holdings.reduce((s, h) => s + (h.weight / 100) * (top25.find(t => t.ticker === h.ticker)?.pe ?? 20), 0));

    const sectorAgg = new Map<string, { weight: number; count: number }>();
    for (const h of holdings) { const e = sectorAgg.get(h.sector) ?? { weight: 0, count: 0 }; e.weight += h.weight; e.count++; sectorAgg.set(h.sector, e); }
    const sectorBreakdown = Array.from(sectorAgg).map(([sector, v]) => ({ sector, weight: r2(v.weight), count: v.count })).sort((a, b) => b.weight - a.weight);

    const exchAgg = new Map<string, { weight: number; count: number }>();
    for (const h of holdings) { const e = exchAgg.get(h.exchange) ?? { weight: 0, count: 0 }; e.weight += h.weight; e.count++; exchAgg.set(h.exchange, e); }
    const exchangeBreakdown = Array.from(exchAgg).map(([exchange, v]) => ({ exchange, weight: r2(v.weight), count: v.count })).sort((a, b) => b.weight - a.weight);

    const sorted     = [...holdings].sort((a, b) => b.weight - a.weight);
    const topHolding = { ticker: sorted[0].ticker, weight: sorted[0].weight };
    const top5Weight = r2(sorted.slice(0, 5).reduce((s, h) => s + h.weight, 0));

    res.json({ holdings, totalValue: portValue, holdingCount: top25.length, weightingMethod: "score-weighted", avgComposite, weightedBeta, weightedDividendYield, weightedPE, sectorBreakdown, exchangeBreakdown, topHolding, top5Weight });
  });

  // ─── Sector Heatmap ──────────────────────────────────────────

  app.get("/api/heatmap", async (req, res) => {
    const weights   = parseWeights(req.query as Record<string, string>);
    const stocks    = await buildRealScreener(weights);
    const sectorMap = new Map<string, typeof stocks>();
    for (const s of stocks) { if (!sectorMap.has(s.sector)) sectorMap.set(s.sector, []); sectorMap.get(s.sector)!.push(s); }

    const heatmap = Array.from(sectorMap).map(([sector, cells]) => {
      const sorted       = [...cells].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
      const avgComposite = r2(cells.reduce((s, c) => s + c.composite, 0) / cells.length);
      return { sector, stocks: sorted.map(s => ({ ticker: s.ticker, name: s.name, sector: s.sector, composite: s.composite, change1d: s.change1d, marketCap: s.marketCap })), avgComposite };
    }).sort((a, b) => b.avgComposite - a.avgComposite);

    res.json(heatmap);
  });

  // ─── Watchlist ───────────────────────────────────────────────

  app.get("/api/watchlist", (_req, res) => res.json(Array.from(watchlist.values())));

  app.post("/api/watchlist/:ticker", (req, res) => {
    const { ticker } = req.params;
    const def = getAllStocks().find(s => s.ticker === ticker);
    if (!def) { res.status(404).json({ error: "Stock not found" }); return; }
    if (watchlist.has(ticker)) { res.json({ message: "Already in watchlist" }); return; }
    watchlist.set(ticker, { ticker, addedAt: new Date().toISOString() });
    res.json({ message: "Added to watchlist", item: watchlist.get(ticker) });
  });

  app.delete("/api/watchlist/:ticker", (req, res) => {
    watchlist.delete(req.params.ticker);
    res.json({ message: "Removed from watchlist" });
  });

  // ─── Alerts ──────────────────────────────────────────────────

  app.get("/api/alerts", (_req, res) => res.json(alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())));

  app.post("/api/alerts/read/:id", (req, res) => {
    const alert = alerts.find(a => a.id === req.params.id);
    if (alert) alert.read = true;
    res.json({ message: "Alert marked as read" });
  });

  app.post("/api/alerts/read-all", (_req, res) => {
    for (const a of alerts) a.read = true;
    res.json({ message: "All alerts marked as read" });
  });

  app.delete("/api/alerts/:id", (req, res) => {
    const idx = alerts.findIndex(a => a.id === req.params.id);
    if (idx >= 0) alerts.splice(idx, 1);
    res.json({ message: "Alert deleted" });
  });

  // ─── Alert Rules ─────────────────────────────────────────────

  app.get("/api/alert-rules", (_req, res) => res.json(alertRules));

  app.post("/api/alert-rules", (req, res) => {
    const rule: AlertRule = { id: randomUUID(), type: req.body.type || "score_above", ticker: req.body.ticker, threshold: req.body.threshold || 70, enabled: true };
    alertRules.push(rule);
    res.json(rule);
  });

  app.delete("/api/alert-rules/:id", (req, res) => {
    const idx = alertRules.findIndex(r => r.id === req.params.id);
    if (idx >= 0) alertRules.splice(idx, 1);
    res.json({ message: "Rule deleted" });
  });

  return httpServer;
}
