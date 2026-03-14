import { z } from "zod";

// V2 Factor weights schema
export const factorWeightsSchema = z.object({
  momentum: z.number().min(0).max(100).default(30),
  quality: z.number().min(0).max(100).default(25),
  lowVol: z.number().min(0).max(100).default(20),
  valuation: z.number().min(0).max(100).default(10),
  erm: z.number().min(0).max(100).default(10),
  insider: z.number().min(0).max(100).default(5),
});

export type FactorWeights = z.infer<typeof factorWeightsSchema>;

// Individual stock data with factor scores
export interface StockScore {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
  price: number | null;
  change1d: number | null;
  marketCap: number | null;
  // Raw factor scores (0-100)
  momentum: number;
  quality: number;
  lowVol: number;
  valuation: number;
  erm: number;
  insider: number;
  // Composite
  composite: number;
  // Detail metrics
  metrics: {
    // Momentum
    return12m: number;
    return6m: number;
    return3m: number;
    // Quality
    roe: number;
    profitMargin: number;
    debtToEquity: number;
    // Low Vol
    beta: number;
    volatility52w: number;
    // Valuation
    pe: number;
    pb: number;
    dividendYield: number;
    // ERM
    epsGrowth: number;
    revenueGrowth: number;
    // Insider
    insiderOwnership: number;
    institutionalOwnership: number;
  };
}

// API response
export interface ScreenerResponse {
  stocks: StockScore[];
  lastUpdated: string;
  universe: string;
}

// Market regime data for suggested mix
export interface MarketRegime {
  vix: number;
  vixLabel: "Low" | "Moderate" | "Elevated" | "High";
  yieldSpread10y2y: number;
  yieldCurveLabel: "Inverted" | "Flat" | "Normal" | "Steep";
  fedRate: string;
  fedOutlook: string;
  sp500Ytd: number;
  recessionProb: number;
  inflationRate: number;
  gdpGrowth: number;
  geopoliticalRisk: "Low" | "Moderate" | "Elevated" | "High";
  regimeName: string;
  regimeDescription: string;
  suggestedWeights: FactorWeights;
  lastUpdated: string;
}

// Preset strategy definition
export interface PresetStrategy {
  id: string;
  name: string;
  description: string;
  icon: string;
  weights: FactorWeights;
}

// ─── Watchlist ─────────────────────────────────────────────────

export interface WatchlistItem {
  ticker: string;
  addedAt: string;
}

// ─── Backtesting ──────────────────────────────────────────────

export interface BacktestPoint {
  month: string;
  portfolioValue: number;
  benchmarkValue: number;
}

export interface BacktestHolding {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
  weight: number;
  compositeScore: number;
  returnContribution: number;
  totalReturn: number;
}

export interface BacktestResult {
  period: "1y" | "3y" | "5y";
  weights: FactorWeights;
  points: BacktestPoint[];
  totalReturn: number;
  benchmarkReturn: number;
  annualizedReturn: number;
  benchmarkAnnualized: number;
  maxDrawdown: number;
  sharpeRatio: number;
  alpha: number;
  holdings: BacktestHolding[];
  holdingCount: number;
  weightingMethod: "score-weighted";
  rebalanceFrequency: "monthly";
  sectorBreakdown: { sector: string; weight: number }[];
  exchangeBreakdown: { exchange: string; weight: number }[];
}

// ─── Portfolio ─────────────────────────────────────────────────

export interface PortfolioHolding {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
  price: number | null;
  change1d: number | null;
  compositeScore: number;
  weight: number;
  shares: number;
  marketValue: number;
  momentum: number;
  quality: number;
  lowVol: number;
  valuation: number;
  erm: number;
  insider: number;
}

export interface PortfolioSummary {
  holdings: PortfolioHolding[];
  totalValue: number;
  holdingCount: number;
  weightingMethod: "score-weighted";
  avgComposite: number;
  weightedBeta: number;
  weightedDividendYield: number;
  weightedPE: number;
  sectorBreakdown: { sector: string; weight: number; count: number }[];
  exchangeBreakdown: { exchange: string; weight: number; count: number }[];
  topHolding: { ticker: string; weight: number };
  top5Weight: number;
}

// ─── Sector Heatmap ───────────────────────────────────────────

export interface HeatmapCell {
  ticker: string;
  name: string;
  sector: string;
  composite: number;
  change1d: number | null;
  marketCap: number | null;
}

export interface HeatmapSector {
  sector: string;
  stocks: HeatmapCell[];
  avgComposite: number;
}

// ─── Alerts ───────────────────────────────────────────────────

export type AlertType = "score_above" | "score_below" | "regime_change";

export interface Alert {
  id: string;
  type: AlertType;
  ticker?: string;
  threshold?: number;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface AlertRule {
  id: string;
  type: AlertType;
  ticker?: string;
  threshold?: number;
  enabled: boolean;
}

// ─── Stock Detail (full page) ─────────────────────────────────

export interface PricePoint {
  date: string;
  price: number;
}

export interface PeerComparison {
  ticker: string;
  name: string;
  composite: number;
  momentum: number;
  quality: number;
  lowVol: number;
  valuation: number;
  erm: number;
  insider: number;
}

export interface StockDetail extends StockScore {
  priceHistory: PricePoint[];
  peers: PeerComparison[];
  description: string;
}

export interface User {
  id: string;
  username: string;
  password: string;
}
export interface InsertUser {
  username: string;
  password: string;
}
