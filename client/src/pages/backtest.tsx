import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, TrendingUp, ArrowUpRight, ArrowDownRight,
  ChevronDown, ChevronUp, Briefcase, PieChart,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { BacktestResult, FactorWeights, PresetStrategy, MarketRegime } from "@shared/schema";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip as RechartsTooltip, CartesianGrid, Legend,
  PieChart as RPieChart, Pie, Cell,
} from "recharts";

type Period = "1y" | "3y" | "5y";

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
    // Weights can be in hash (e.g. #/backtest?momentum=40) or search (?momentum=40#/backtest)
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

function KpiCard({ label, value, delta, isPositive }: {
  label: string;
  value: string;
  delta?: string;
  isPositive?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {delta && (
        <div className={`text-[11px] tabular-nums font-medium flex items-center gap-0.5 ${
          isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
        }`}>
          {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {delta}
        </div>
      )}
    </div>
  );
}

type SortField = "weight" | "compositeScore" | "totalReturn" | "returnContribution";

export default function BacktestPage() {
  const [period, setPeriod] = useState<Period>("3y");
  const [showAllHoldings, setShowAllHoldings] = useState(false);
  const [sortField, setSortField] = useState<SortField>("weight");
  const [sortAsc, setSortAsc] = useState(false);

  const weights = useMemo(() => parseWeightsFromHash(), []);

  const weightParams = weightsToParams(weights);
  const queryParams = `${weightParams}&period=${period}`;

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

  const { data: result, isLoading } = useQuery<BacktestResult>({
    queryKey: ["/api/backtest", queryParams],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/backtest?${queryParams}`);
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

  const sortedHoldings = result?.holdings
    ? [...result.holdings].sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
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
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="back-from-backtest">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold">Backtest</span>
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0" data-testid="backtest-strategy-badge">
                {activeStrategyName}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/portfolio?${weightParams}`}>
              <Button variant="outline" size="sm" className="text-[11px] h-7 gap-1">
                <Briefcase className="w-3 h-3" />
                Portfolio
              </Button>
            </Link>
            <div className="flex items-center gap-1">
              {(["1y", "3y", "5y"] as Period[]).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={period === p ? "default" : "outline"}
                  className="text-[11px] h-7 px-2.5"
                  onClick={() => setPeriod(p)}
                  data-testid={`backtest-period-${p}`}
                >
                  {p.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 py-5 space-y-4">
        {/* Disclaimer */}
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Backtested using top 25 stocks by composite score, weighted proportionally by score, with monthly rebalancing. Past performance does not guarantee future results. Simulated data for educational purposes only.
          </p>
        </Card>

        {isLoading || !result ? (
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
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="p-3">
                <KpiCard
                  label="Total Return"
                  value={`${result.totalReturn > 0 ? "+" : ""}${result.totalReturn}%`}
                  delta={`vs S&P ${result.benchmarkReturn > 0 ? "+" : ""}${result.benchmarkReturn}%`}
                  isPositive={result.totalReturn > result.benchmarkReturn}
                />
              </Card>
              <Card className="p-3">
                <KpiCard
                  label="Annualized"
                  value={`${result.annualizedReturn > 0 ? "+" : ""}${result.annualizedReturn}%`}
                  delta={`Alpha: ${result.alpha > 0 ? "+" : ""}${result.alpha}%`}
                  isPositive={result.alpha > 0}
                />
              </Card>
              <Card className="p-3">
                <KpiCard
                  label="Sharpe Ratio"
                  value={`${result.sharpeRatio}`}
                />
              </Card>
              <Card className="p-3">
                <KpiCard
                  label="Max Drawdown"
                  value={`-${result.maxDrawdown}%`}
                />
              </Card>
            </div>

            {/* Performance Chart */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold">Portfolio vs S&P 500</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{result.holdingCount} stocks · Monthly rebalance</Badge>
              </div>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={result.points}>
                    <defs>
                      <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="benchmarkGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.1} />
                        <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      interval="preserveStartEnd"
                      minTickGap={60}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                      width={50}
                      domain={["auto", "auto"]}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      formatter={(v: number, name: string) => [
                        `$${v.toLocaleString()}`,
                        name === "portfolioValue" ? "Portfolio" : "S&P 500",
                      ]}
                    />
                    <Legend
                      formatter={(value: string) => (
                        <span className="text-xs">
                          {value === "portfolioValue" ? "Portfolio" : "S&P 500"}
                        </span>
                      )}
                    />
                    <Area
                      type="monotone"
                      dataKey="portfolioValue"
                      stroke="hsl(var(--primary))"
                      fill="url(#portfolioGrad)"
                      strokeWidth={2}
                      name="portfolioValue"
                    />
                    <Area
                      type="monotone"
                      dataKey="benchmarkValue"
                      stroke="hsl(var(--muted-foreground))"
                      fill="url(#benchmarkGrad)"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      name="benchmarkValue"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Sector & Exchange Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <PieChart className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Sector Allocation</span>
                </div>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RPieChart>
                      <Pie
                        data={result.sectorBreakdown}
                        dataKey="weight"
                        nameKey="sector"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        innerRadius={35}
                        strokeWidth={1}
                        stroke="hsl(var(--background))"
                      >
                        {result.sectorBreakdown.map((entry) => (
                          <Cell key={entry.sector} fill={SECTOR_COLORS[entry.sector] || "#888"} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 11,
                        }}
                        formatter={(v: number, name: string) => [`${v}%`, name]}
                      />
                    </RPieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {result.sectorBreakdown.map((s) => (
                    <Badge key={s.sector} variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: SECTOR_COLORS[s.sector] || "#888" }} />
                      {s.sector}: {s.weight}%
                    </Badge>
                  ))}
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Briefcase className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Portfolio Breakdown</span>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground uppercase">Holdings</div>
                      <div className="text-lg font-bold tabular-nums">{result.holdingCount}</div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground uppercase">Weighting</div>
                      <div className="text-lg font-bold">Score</div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground uppercase">Rebalance</div>
                      <div className="text-lg font-bold">Monthly</div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground uppercase">Period</div>
                      <div className="text-lg font-bold">{period.toUpperCase()}</div>
                    </div>
                  </div>
                  <div className="border-t border-border pt-3 space-y-2">
                    <div className="text-[10px] text-muted-foreground uppercase">Exchange Split</div>
                    {result.exchangeBreakdown.map((e) => (
                      <div key={e.exchange} className="flex items-center justify-between">
                        <span className="text-xs font-medium">{e.exchange}</span>
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
                <span className="text-sm font-semibold">Portfolio Holdings</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">{result.holdingCount} positions</span>
              </div>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full min-w-[640px]" data-testid="backtest-holdings-table">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium py-2 px-2 text-left">#</th>
                      <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium py-2 px-2 text-left">Stock</th>
                      <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium py-2 px-2 text-left hidden sm:table-cell">Sector</th>
                      <SortHeader field="weight" label="Weight" className="text-right" />
                      <SortHeader field="compositeScore" label="Score" className="text-right" />
                      <SortHeader field="totalReturn" label="Return" className="text-right" />
                      <SortHeader field="returnContribution" label="Contribution" className="text-right" />
                    </tr>
                  </thead>
                  <tbody>
                    {displayedHoldings.map((h, idx) => (
                      <tr
                        key={h.ticker}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                        data-testid={`backtest-holding-${h.ticker}`}
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
                        <td className="text-[11px] text-muted-foreground py-2 px-2 hidden sm:table-cell">{h.sector}</td>
                        <td className="text-right py-2 px-2">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
                              <div
                                className="h-full bg-primary/60 rounded-full"
                                style={{ width: `${Math.min(h.weight * 2.5, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium tabular-nums">{h.weight}%</span>
                          </div>
                        </td>
                        <td className="text-xs text-right tabular-nums font-medium py-2 px-2">{h.compositeScore}</td>
                        <td className={`text-xs text-right tabular-nums font-medium py-2 px-2 ${
                          h.totalReturn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                        }`}>
                          {h.totalReturn > 0 ? "+" : ""}{h.totalReturn}%
                        </td>
                        <td className={`text-xs text-right tabular-nums font-medium py-2 px-2 ${
                          h.returnContribution >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                        }`}>
                          {h.returnContribution > 0 ? "+" : ""}{h.returnContribution}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sortedHoldings.length > 10 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 text-xs text-muted-foreground h-8"
                  onClick={() => setShowAllHoldings(!showAllHoldings)}
                  data-testid="toggle-all-holdings"
                >
                  {showAllHoldings ? (
                    <>Show Top 10 <ChevronUp className="w-3 h-3 ml-1" /></>
                  ) : (
                    <>Show All {sortedHoldings.length} Holdings <ChevronDown className="w-3 h-3 ml-1" /></>
                  )}
                </Button>
              )}
            </Card>

            {/* Factor Weights Used */}
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
