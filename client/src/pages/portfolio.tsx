import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Briefcase, ArrowUpRight, ArrowDownRight,
  ChevronDown, ChevronUp, PieChart, TrendingUp, Info,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { PortfolioSummary, BacktestResult, FactorWeights, PresetStrategy, MarketRegime } from "@shared/schema";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip as RechartsTooltip, CartesianGrid, Legend,
  BarChart, Bar, Cell,
} from "recharts";

// ─── Parse weights from hash query params ─────────────────────────

const DEFAULT_WEIGHTS: FactorWeights = {
  momentum: 30, quality: 25, lowVol: 20, valuation: 10, erm: 10, insider: 5,
};

function parseParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseWeightsFromHash(): FactorWeights {
  try {
    // Weights can be in hash (e.g. #/portfolio?momentum=40) or search (?momentum=40#/portfolio)
    const hash = window.location.hash;
    const search = window.location.search;
    let paramStr = "";
    const qIndex = hash.indexOf("?");
    if (qIndex !== -1) {
      paramStr = hash.slice(qIndex + 1);
    } else if (search) {
      paramStr = search.slice(1);
    }
    if (!paramStr) return { ...DEFAULT_WEIGHTS };
    const params = new URLSearchParams(paramStr);
    return {
      momentum: parseParam(params, "momentum", DEFAULT_WEIGHTS.momentum),
      quality: parseParam(params, "quality", DEFAULT_WEIGHTS.quality),
      lowVol: parseParam(params, "lowVol", DEFAULT_WEIGHTS.lowVol),
      valuation: parseParam(params, "valuation", DEFAULT_WEIGHTS.valuation),
      erm: parseParam(params, "erm", DEFAULT_WEIGHTS.erm),
      insider: parseParam(params, "insider", DEFAULT_WEIGHTS.insider),
    };
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

function weightsToParams(w: FactorWeights): string {
  return `momentum=${w.momentum}&quality=${w.quality}&lowVol=${w.lowVol}&valuation=${w.valuation}&erm=${w.erm}&insider=${w.insider}`;
}

function weightsMatch(a: FactorWeights, b: FactorWeights): boolean {
  return a.momentum === b.momentum && a.quality === b.quality && a.lowVol === b.lowVol &&
    a.valuation === b.valuation && a.erm === b.erm && a.insider === b.insider;
}

const FACTOR_LABELS: Record<keyof FactorWeights, string> = {
  momentum: "Momentum",
  quality: "Quality",
  lowVol: "Low Vol",
  valuation: "Valuation",
  erm: "ERM",
  insider: "Insider",
};

// ─── Sector colors ────────────────────────────────────────────────

const SECTOR_COLORS: Record<string, string> = {
  "Technology": "#20808D",
  "Financials": "#A84B2F",
  "Health Care": "#1B474D",
  "Consumer Staples": "#BCE2E7",
  "Energy": "#944454",
  "Industrials": "#FFC553",
  "Consumer Discretionary": "#848456",
  "Materials": "#6E522B",
  "Utilities": "#4F98A3",
  "Communication Services": "#D163A7",
  "Real Estate": "#BB653B",
};

type SortField = "weight" | "compositeScore" | "price" | "change1d";

export default function PortfolioPage() {
  const [showAllHoldings, setShowAllHoldings] = useState(false);
  const [sortField, setSortField] = useState<SortField>("weight");
  const [sortAsc, setSortAsc] = useState(false);

  const weights = useMemo(() => parseWeightsFromHash(), []);

  const queryParams = weightsToParams(weights);

  // Detect active strategy name
  const { data: presets } = useQuery<PresetStrategy[]>({
    queryKey: ["/api/presets"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/presets");
      return res.json();
    },
    staleTime: Infinity,
  });

  const { data: regime } = useQuery<MarketRegime>({
    queryKey: ["/api/market-regime"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/market-regime");
      return res.json();
    },
    staleTime: 60000,
  });

  const activeStrategyName = useMemo(() => {
    if (regime && weightsMatch(weights, regime.suggestedWeights)) {
      return `Suggested Mix · ${regime.regimeName}`;
    }
    if (presets) {
      const match = presets.find((p) => weightsMatch(weights, p.weights));
      if (match) return match.name;
    }
    return "Custom";
  }, [weights, presets, regime]);

  const { data: portfolio, isLoading } = useQuery<PortfolioSummary>({
    queryKey: ["/api/portfolio", queryParams],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/portfolio?${queryParams}`);
      return res.json();
    },
  });

  // Also fetch 1Y backtest for the performance chart
  const backtestParams = `${queryParams}&period=1y`;
  const { data: backtest } = useQuery<BacktestResult>({
    queryKey: ["/api/backtest", backtestParams],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/backtest?${backtestParams}`);
      return res.json();
    },
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const sortedHoldings = portfolio?.holdings
    ? [...portfolio.holdings].sort((a, b) => {
        const aVal = (a[sortField] ?? 0) as number;
        const bVal = (b[sortField] ?? 0) as number;
        return sortAsc ? aVal - bVal : bVal - aVal;
      })
    : [];

  const displayedHoldings = showAllHoldings ? sortedHoldings : sortedHoldings.slice(0, 10);

  const SortHeader = ({ field, label, className = "" }: { field: SortField; label: string; className?: string }) => (
    <th
      className={`text-[10px] text-muted-foreground uppercase tracking-wider font-medium py-2 px-2 cursor-pointer hover:text-foreground transition-colors select-none ${className}`}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-0.5">
        {label}
        {sortField === field && (
          sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        )}
      </div>
    </th>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-[1200px] mx-auto px-4 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="back-from-portfolio">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold">Portfolio</span>
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0" data-testid="portfolio-strategy-badge">
                {activeStrategyName}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/backtest?${queryParams}`}>
              <Button variant="outline" size="sm" className="text-[11px] h-7 gap-1">
                <TrendingUp className="w-3 h-3" />
                Backtest
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 py-5 space-y-4">
        {isLoading || !portfolio ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-72" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            {/* Portfolio Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="p-3">
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Holdings</div>
                  <div className="text-lg font-bold tabular-nums">{portfolio.holdingCount}</div>
                  <div className="text-[11px] text-muted-foreground">Score-weighted</div>
                </div>
              </Card>
              <Card className="p-3">
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Composite</div>
                  <div className="text-lg font-bold tabular-nums">{portfolio.avgComposite}</div>
                  <div className="text-[11px] text-muted-foreground">Top 5: {portfolio.top5Weight}%</div>
                </div>
              </Card>
              <Card className="p-3">
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Wtd Beta</div>
                  <div className="text-lg font-bold tabular-nums">{portfolio.weightedBeta}</div>
                  <div className={`text-[11px] ${portfolio.weightedBeta > 1 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {portfolio.weightedBeta > 1 ? "Above market" : "Below market"}
                  </div>
                </div>
              </Card>
              <Card className="p-3">
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Wtd P/E</div>
                  <div className="text-lg font-bold tabular-nums">{portfolio.weightedPE}x</div>
                  <div className="text-[11px] text-muted-foreground">Div Yield: {portfolio.weightedDividendYield}%</div>
                </div>
              </Card>
            </div>

            {/* Performance Chart (1Y) */}
            {backtest && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold">1Y Performance vs S&P 500</span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${
                        backtest.alpha > 0
                          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                          : "border-red-500/40 text-red-600 dark:text-red-400"
                      }`}
                    >
                      Alpha: {backtest.alpha > 0 ? "+" : ""}{backtest.alpha}%
                    </Badge>
                    <Link href={`/backtest?${queryParams}`}>
                      <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2 gap-1" data-testid="portfolio-to-backtest">
                        Full Backtest
                        <ArrowUpRight className="w-3 h-3" />
                      </Button>
                    </Link>
                  </div>
                </div>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={backtest.points}>
                      <defs>
                        <linearGradient id="pGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        interval="preserveStartEnd"
                        minTickGap={50}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
                        width={48}
                        domain={["auto", "auto"]}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 11,
                        }}
                        formatter={(v: number, name: string) => [
                          `$${v.toLocaleString()}`,
                          name === "portfolioValue" ? "Portfolio" : "S&P 500",
                        ]}
                      />
                      <Legend
                        formatter={(value: string) => (
                          <span className="text-[11px]">
                            {value === "portfolioValue" ? "Portfolio" : "S&P 500"}
                          </span>
                        )}
                      />
                      <Area
                        type="monotone"
                        dataKey="portfolioValue"
                        stroke="hsl(var(--primary))"
                        fill="url(#pGrad)"
                        strokeWidth={2}
                        name="portfolioValue"
                      />
                      <Area
                        type="monotone"
                        dataKey="benchmarkValue"
                        stroke="hsl(var(--muted-foreground))"
                        fill="transparent"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        name="benchmarkValue"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 mt-2 text-[11px] tabular-nums text-muted-foreground">
                  <span>Portfolio: <span className={backtest.totalReturn >= 0 ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>{backtest.totalReturn > 0 ? "+" : ""}{backtest.totalReturn}%</span></span>
                  <span>S&P 500: <span className="font-medium text-foreground">{backtest.benchmarkReturn > 0 ? "+" : ""}{backtest.benchmarkReturn}%</span></span>
                  <span>Sharpe: <span className="font-medium text-foreground">{backtest.sharpeRatio}</span></span>
                  <span>Max DD: <span className="font-medium text-foreground">-{backtest.maxDrawdown}%</span></span>
                </div>
              </Card>
            )}

            {/* Sector Allocation Bar Chart + Exchange */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <PieChart className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Sector Allocation</span>
                </div>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={portfolio.sectorBreakdown} layout="vertical" margin={{ left: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => `${v}%`} />
                      <YAxis
                        type="category"
                        dataKey="sector"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        width={110}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 11,
                        }}
                        formatter={(v: number, _: string, props: any) => [
                          `${v}% (${props.payload.count} stocks)`,
                          "Weight",
                        ]}
                      />
                      <Bar dataKey="weight" radius={[0, 4, 4, 0]}>
                        {portfolio.sectorBreakdown.map((entry) => (
                          <Cell key={entry.sector} fill={SECTOR_COLORS[entry.sector] || "#888"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Portfolio Characteristics</span>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground uppercase">Weighting</div>
                      <div className="text-sm font-semibold">Score-Weighted</div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground uppercase">Top Holding</div>
                      <div className="text-sm font-semibold">{portfolio.topHolding.ticker} ({portfolio.topHolding.weight}%)</div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground uppercase">Top 5 Concentration</div>
                      <div className="text-sm font-semibold tabular-nums">{portfolio.top5Weight}%</div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground uppercase">Wtd Dividend</div>
                      <div className="text-sm font-semibold tabular-nums">{portfolio.weightedDividendYield}%</div>
                    </div>
                  </div>
                  <div className="border-t border-border pt-3 space-y-2">
                    <div className="text-[10px] text-muted-foreground uppercase">Exchange Split</div>
                    {portfolio.exchangeBreakdown.map((e) => (
                      <div key={e.exchange} className="flex items-center justify-between">
                        <span className="text-xs font-medium">{e.exchange} <span className="text-muted-foreground">({e.count})</span></span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${e.weight}%` }} />
                          </div>
                          <span className="text-[11px] tabular-nums text-muted-foreground w-10 text-right">{e.weight}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>

            {/* Holdings Table */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold">All Holdings</span>
                <span className="text-[11px] text-muted-foreground">Notional portfolio: $10,000</span>
              </div>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full min-w-[700px]" data-testid="portfolio-holdings-table">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium py-2 px-2 text-left">#</th>
                      <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium py-2 px-2 text-left">Stock</th>
                      <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium py-2 px-2 text-left hidden sm:table-cell">Sector</th>
                      <SortHeader field="weight" label="Weight" className="text-right" />
                      <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium py-2 px-2 text-right hidden sm:table-cell">Shares</th>
                      <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium py-2 px-2 text-right hidden sm:table-cell">Value</th>
                      <SortHeader field="price" label="Price" className="text-right" />
                      <SortHeader field="change1d" label="1D Chg" className="text-right" />
                      <SortHeader field="compositeScore" label="Score" className="text-right" />
                    </tr>
                  </thead>
                  <tbody>
                    {displayedHoldings.map((h, idx) => {
                      const change = h.change1d;
                      const changeColor =
                        change == null
                          ? "text-muted-foreground"
                          : change >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400";

                      return (
                        <tr
                          key={h.ticker}
                          className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                          data-testid={`portfolio-holding-${h.ticker}`}
                        >
                          <td className="text-[11px] text-muted-foreground tabular-nums py-2 px-2">{idx + 1}</td>
                          <td className="py-2 px-2">
                            <Link href={`/stock/${h.ticker}`}>
                              <div className="cursor-pointer hover:underline">
                                <div className="text-xs font-semibold">{h.ticker}</div>
                                <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{h.name}</div>
                              </div>
                            </Link>
                          </td>
                          <td className="text-[11px] text-muted-foreground py-2 px-2 hidden sm:table-cell">
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 font-normal">{h.sector}</Badge>
                          </td>
                          <td className="text-right py-2 px-2">
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
                                <div
                                  className="h-full bg-primary/60 rounded-full"
                                  style={{ width: `${Math.min(h.weight * 2.5, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs font-semibold tabular-nums">{h.weight}%</span>
                            </div>
                          </td>
                          <td className="text-[11px] text-right tabular-nums py-2 px-2 hidden sm:table-cell text-muted-foreground">{h.shares.toFixed(2)}</td>
                          <td className="text-[11px] text-right tabular-nums py-2 px-2 hidden sm:table-cell">${h.marketValue.toLocaleString()}</td>
                          <td className="text-xs text-right tabular-nums py-2 px-2">
                            {h.price == null ? "-" : `$${h.price.toFixed(2)}`}
                          </td>
                          <td className={`text-xs text-right tabular-nums font-medium py-2 px-2 ${changeColor}`}>
                            {change == null ? "-" : `${change > 0 ? "+" : ""}${change}%`}
                          </td>
                          <td className="text-xs text-right tabular-nums font-medium py-2 px-2">{h.compositeScore}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {sortedHoldings.length > 10 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 text-xs text-muted-foreground h-8"
                  onClick={() => setShowAllHoldings(!showAllHoldings)}
                  data-testid="portfolio-toggle-all"
                >
                  {showAllHoldings ? (
                    <>Show Top 10 <ChevronUp className="w-3 h-3 ml-1" /></>
                  ) : (
                    <>Show All {sortedHoldings.length} Holdings <ChevronDown className="w-3 h-3 ml-1" /></>
                  )}
                </Button>
              )}
            </Card>

            {/* Factor Weights */}
            <Card className="p-4">
              <span className="text-sm font-semibold mb-2 block">Factor Weights Used</span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(FACTOR_LABELS) as (keyof FactorWeights)[]).map((key) => (
                  <Badge key={key} variant="secondary" className="text-[11px] px-2 py-0.5">
                    {FACTOR_LABELS[key]}: {weights[key]}%
                  </Badge>
                ))}
              </div>
            </Card>
          </>
        )}
      </main>


    </div>
  );
}
