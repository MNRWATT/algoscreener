import type { Express } from "express";
import { createServer, type Server } from "http";
import { getScreenedStocks, SECTORS, EXCHANGES, getStockDetail, runBacktest, getSectorHeatmap, getAllStocks, computeComposite, buildPortfolio } from "./stockData";
import type { MarketRegime, PresetStrategy, WatchlistItem, Alert, AlertRule, FactorWeights } from "@shared/schema";
import { randomUUID } from "crypto";
import { getLiveQuotes, getCachedQuote } from "./marketData";

// ─── Preset Strategies ─────────────────────────────────────────────

const PRESETS: PresetStrategy[] = [
  {
    id: "aggressive-growth",
    name: "Aggr. Growth",
    description: "Max momentum & earnings growth. High-conviction, high-volatility bets.",
    icon: "rocket",
    weights: { momentum: 40, quality: 10, lowVol: 0, valuation: 5, erm: 40, insider: 5 },
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Even-weighted exposure across all factors. Default starting point.",
    icon: "scale",
    weights: { momentum: 30, quality: 25, lowVol: 20, valuation: 10, erm: 10, insider: 5 },
  },
  {
    id: "defensive",
    name: "Defensive",
    description: "Prioritize low volatility and quality. Capital preservation focus.",
    icon: "shield",
    weights: { momentum: 5, quality: 35, lowVol: 35, valuation: 15, erm: 5, insider: 5 },
  },
  {
    id: "value-hunter",
    name: "Value Hunter",
    description: "Deep value with quality filter. Contrarian, patient capital.",
    icon: "search-dollar",
    weights: { momentum: 5, quality: 25, lowVol: 10, valuation: 40, erm: 10, insider: 10 },
  },
  {
    id: "income",
    name: "Income",
    description: "High yield + stability. Dividend-focused with low volatility tilt.",
    icon: "wallet",
    weights: { momentum: 5, quality: 20, lowVol: 25, valuation: 35, erm: 5, insider: 10 },
  },
  {
    id: "momentum-pure",
    name: "Momentum",
    description: "Trend-following with insider confirmation. Ride the winners.",
    icon: "trending-up",
    weights: { momentum: 55, quality: 10, lowVol: 0, valuation: 0, erm: 20, insider: 15 },
  },
];

// ─── Market Regime Logic ───────────────────────────────────────────

function getMarketRegime(): MarketRegime {
  const vix = 25.75;
  const yieldSpread10y2y = 0.56;
  const sp500Ytd = -2.28;
  const recessionProb = 27;
  const inflationRate = 2.4;
  const gdpGrowth = 1.4;

  const vixLabel = vix < 15 ? "Low" as const : vix < 20 ? "Moderate" as const : vix < 30 ? "Elevated" as const : "High" as const;
  const yieldCurveLabel = yieldSpread10y2y < -0.2 ? "Inverted" as const : yieldSpread10y2y < 0.1 ? "Flat" as const : yieldSpread10y2y < 1.0 ? "Normal" as const : "Steep" as const;

  let suggestedWeights = { momentum: 15, quality: 30, lowVol: 25, valuation: 15, erm: 10, insider: 5 };
  let regimeName = "Cautious";
  let regimeDescription = "Elevated volatility with moderate recession risk. Yield curve normalizing post-inversion. Favor quality and stability over aggressive growth.";

  if (vix >= 30) {
    suggestedWeights = { momentum: 5, quality: 30, lowVol: 35, valuation: 15, erm: 5, insider: 10 };
    regimeName = "Risk-Off";
    regimeDescription = "High volatility regime. Maximum defensive positioning with quality and low-volatility tilt.";
  } else if (vix < 15 && sp500Ytd > 5) {
    suggestedWeights = { momentum: 35, quality: 20, lowVol: 10, valuation: 10, erm: 20, insider: 5 };
    regimeName = "Risk-On";
    regimeDescription = "Low volatility, positive trend. Lean into momentum and growth with quality backstop.";
  } else if (yieldSpread10y2y < -0.2) {
    suggestedWeights = { momentum: 10, quality: 30, lowVol: 25, valuation: 20, erm: 5, insider: 10 };
    regimeName = "Late Cycle";
    regimeDescription = "Inverted yield curve signals slowdown ahead. Defensive quality + value positioning.";
  }

  return {
    vix,
    vixLabel,
    yieldSpread10y2y,
    yieldCurveLabel,
    fedRate: "3.50–3.75%",
    fedOutlook: "On hold, 1–2 cuts expected by year-end",
    sp500Ytd,
    recessionProb,
    inflationRate,
    gdpGrowth,
    geopoliticalRisk: "Elevated",
    regimeName,
    regimeDescription,
    suggestedWeights,
    lastUpdated: new Date().toISOString(),
  };
}

// ─── In-Memory Storage ─────────────────────────────────────────────

const watchlist: Map<string, WatchlistItem> = new Map();
const alerts: Alert[] = [];
const alertRules: AlertRule[] = [];

function seedDemoAlerts() {
  const defaultWeights: FactorWeights = { momentum: 30, quality: 25, lowVol: 20, valuation: 10, erm: 10, insider: 5 };
  const stocks = getScreenedStocks(defaultWeights);
  const top = stocks[0];
  const regime = getMarketRegime();

  alerts.push({
    id: randomUUID(),
    type: "regime_change",
    message: `Market regime: ${regime.regimeName} — ${regime.vixLabel} VIX at ${regime.vix}`,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    read: false,
  });

  if (top) {
    alerts.push({
      id: randomUUID(),
      type: "score_above",
      ticker: top.ticker,
      threshold: 70,
      message: `${top.ticker} composite score reached ${top.composite} (threshold: 70)`,
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      read: false,
    });
  }
}

seedDemoAlerts();

// ─── Parse Weights Helper ──────────────────────────────────────────

function parseWeights(query: Record<string, string>): FactorWeights {
  return {
    momentum: Number(query.momentum ?? 30),
    quality: Number(query.quality ?? 25),
    lowVol: Number(query.lowVol ?? 20),
    valuation: Number(query.valuation ?? 10),
    erm: Number(query.erm ?? 10),
    insider: Number(query.insider ?? 5),
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Screener ──────────────────────────────────────────────────

  app.get("/api/screener", async (req, res) => {
    const weights = parseWeights(req.query as Record<string, string>);
    const stocks = getScreenedStocks(weights);
    const tickers = stocks.map((s) => s.ticker);

    const liveQuotes = await getLiveQuotes(tickers);

    const enriched = stocks.map((stock, i) => {
      const live = liveQuotes[i];
      if (!live) {
        return { ...stock, price: null, change1d: null, error: "Yahoo fetch failed" };
      }
      return {
        ...stock,
        price: live.price,
        change1d: live.changePercent,
      };
    });

    res.json({
      stocks: enriched,
      lastUpdated: new Date().toISOString(),
      universe: "TSX + S&P 500 + NASDAQ 100 + DOW 30",
    });
  });

  // ─── Sectors / Exchanges ───────────────────────────────────────

  app.get("/api/sectors", (_req, res) => {
    res.json(SECTORS);
  });

  app.get("/api/exchanges", (_req, res) => {
    res.json(EXCHANGES);
  });

  // ─── Market Regime ─────────────────────────────────────────────

  app.get("/api/market-regime", (_req, res) => {
    res.json(getMarketRegime());
  });

  // ─── Presets ───────────────────────────────────────────────────

  app.get("/api/presets", (_req, res) => {
    res.json(PRESETS);
  });

  // ─── Stock Detail ──────────────────────────────────────────────

  app.get("/api/stock/:ticker", async (req, res) => {
    const { ticker } = req.params;
    const weights = parseWeights(req.query as Record<string, string>);
    const detail = getStockDetail(ticker, weights);
    if (!detail) {
      res.status(404).json({ error: "Stock not found" });
      return;
    }

    const live = await getCachedQuote(ticker);
    if (!live) {
      res.status(502).json({ error: `Live quote unavailable for ${ticker}` });
      return;
    }

    detail.price = live.price;
    detail.change1d = live.changePercent;

    res.json(detail);
  });

  // ─── Live Quote ────────────────────────────────────────────────

  app.get("/api/quote/:ticker", async (req, res) => {
    try {
      const { ticker } = req.params;
      const quote = await getCachedQuote(ticker);
      if (!quote) {
        res.status(404).json({ error: "Quote not found" });
        return;
      }
      res.json(quote);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch quote" });
    }
  });

  // ─── Backtesting ───────────────────────────────────────────────

  app.get("/api/backtest", (req, res) => {
    const weights = parseWeights(req.query as Record<string, string>);
    const period = (req.query.period as string) || "1y";
    if (!["1y", "3y", "5y"].includes(period)) {
      res.status(400).json({ error: "Invalid period. Use 1y, 3y, or 5y" });
      return;
    }
    const result = runBacktest(weights, period as "1y" | "3y" | "5y");
    res.json(result);
  });

  // ─── Portfolio ─────────────────────────────────────────────────

  app.get("/api/portfolio", (req, res) => {
    const weights = parseWeights(req.query as Record<string, string>);
    const portfolio = buildPortfolio(weights);
    res.json(portfolio);
  });

  // ─── Sector Heatmap ────────────────────────────────────────────

  app.get("/api/heatmap", (req, res) => {
    const weights = parseWeights(req.query as Record<string, string>);
    const heatmap = getSectorHeatmap(weights);
    res.json(heatmap);
  });

  // ─── Watchlist ─────────────────────────────────────────────────

  app.get("/api/watchlist", (_req, res) => {
    const items = Array.from(watchlist.values());
    res.json(items);
  });

  app.post("/api/watchlist/:ticker", (req, res) => {
    const { ticker } = req.params;
    const stock = getAllStocks().find((s) => s.ticker === ticker);
    if (!stock) {
      res.status(404).json({ error: "Stock not found" });
      return;
    }
    if (watchlist.has(ticker)) {
      res.json({ message: "Already in watchlist" });
      return;
    }
    watchlist.set(ticker, { ticker, addedAt: new Date().toISOString() });
    res.json({ message: "Added to watchlist", item: watchlist.get(ticker) });
  });

  app.delete("/api/watchlist/:ticker", (req, res) => {
    const { ticker } = req.params;
    watchlist.delete(ticker);
    res.json({ message: "Removed from watchlist" });
  });

  // ─── Alerts ────────────────────────────────────────────────────

  app.get("/api/alerts", (_req, res) => {
    res.json(alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  });

  app.post("/api/alerts/read/:id", (req, res) => {
    const alert = alerts.find((a) => a.id === req.params.id);
    if (alert) alert.read = true;
    res.json({ message: "Alert marked as read" });
  });

  app.post("/api/alerts/read-all", (_req, res) => {
    for (const a of alerts) a.read = true;
    res.json({ message: "All alerts marked as read" });
  });

  app.delete("/api/alerts/:id", (req, res) => {
    const idx = alerts.findIndex((a) => a.id === req.params.id);
    if (idx >= 0) alerts.splice(idx, 1);
    res.json({ message: "Alert deleted" });
  });

  // ─── Alert Rules ───────────────────────────────────────────────

  app.get("/api/alert-rules", (_req, res) => {
    res.json(alertRules);
  });

  app.post("/api/alert-rules", (req, res) => {
    const rule: AlertRule = {
      id: randomUUID(),
      type: req.body.type || "score_above",
      ticker: req.body.ticker,
      threshold: req.body.threshold || 70,
      enabled: true,
    };
    alertRules.push(rule);

    if (rule.type === "score_above" && rule.ticker && rule.threshold) {
      const defaultWeights: FactorWeights = { momentum: 30, quality: 25, lowVol: 20, valuation: 10, erm: 10, insider: 5 };
      const stock = getAllStocks().find((s) => s.ticker === rule.ticker);
      if (stock) {
        const composite = computeComposite(stock, defaultWeights);
        if (composite >= rule.threshold) {
          alerts.push({
            id: randomUUID(),
            type: "score_above",
            ticker: rule.ticker,
            threshold: rule.threshold,
            message: `${rule.ticker} composite score is ${composite} (threshold: ${rule.threshold})`,
            createdAt: new Date().toISOString(),
            read: false,
          });
        }
      }
    }

    res.json(rule);
  });

  app.delete("/api/alert-rules/:id", (req, res) => {
    const idx = alertRules.findIndex((r) => r.id === req.params.id);
    if (idx >= 0) alertRules.splice(idx, 1);
    res.json({ message: "Rule deleted" });
  });

  return httpServer;
}