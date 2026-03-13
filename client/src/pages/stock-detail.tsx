import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Star, TrendingUp, Shield, BarChart3,
  DollarSign, LineChart, Users, ExternalLink,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { StockDetail, WatchlistItem } from "@shared/schema";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip as RechartsTooltip, CartesianGrid,
} from "recharts";

function ScoreBar({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const h = size === "lg" ? "h-3" : size === "md" ? "h-2" : "h-1.5";
  const color =
    score >= 80 ? "bg-emerald-500" :
    score >= 60 ? "bg-teal-500" :
    score >= 40 ? "bg-amber-500" :
    score >= 20 ? "bg-orange-500" :
    "bg-red-500";

  return (
    <div className={`${h} w-full bg-muted rounded-full overflow-hidden`}>
      <div
        className={`${h} ${color} rounded-full transition-all duration-500`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

const FACTOR_CONFIG = [
  { key: "momentum" as const, label: "Momentum", icon: TrendingUp },
  { key: "quality" as const, label: "Quality", icon: Shield },
  { key: "lowVol" as const, label: "Low Vol", icon: BarChart3 },
  { key: "valuation" as const, label: "Valuation", icon: DollarSign },
  { key: "erm" as const, label: "ERM", icon: LineChart },
  { key: "insider" as const, label: "Insider", icon: Users },
];

export default function StockDetailPage() {
  const params = useParams<{ ticker: string }>();
  const ticker = params.ticker || "";

  const { data: stock, isLoading } = useQuery<StockDetail>({
    queryKey: ["/api/stock", ticker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stock/${ticker}?momentum=30&quality=25&lowVol=20&valuation=10&erm=10&insider=5`);
      return res.json();
    },
    enabled: !!ticker,
  });

  const { data: watchlist = [] } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/watchlist");
      return res.json();
    },
  });

  const isWatched = useMemo(() => watchlist.some((w) => w.ticker === ticker), [watchlist, ticker]);

  const toggleWatch = useMutation({
    mutationFn: async () => {
      if (isWatched) {
        await apiRequest("DELETE", `/api/watchlist/${ticker}`);
      } else {
        await apiRequest("POST", `/api/watchlist/${ticker}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
          <div className="max-w-[1200px] mx-auto px-4 h-12 flex items-center gap-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-5 w-32" />
          </div>
        </header>
        <main className="max-w-[1200px] mx-auto px-4 py-6 space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </main>
      </div>
    );
  }

  if (!stock) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">Stock not found</p>
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
              Back to Screener
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const changeColor = stock.change1d >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  const compositeColor =
    stock.composite >= 70 ? "text-emerald-600 dark:text-emerald-400" :
    stock.composite >= 50 ? "text-foreground" :
    "text-muted-foreground";

  const m = stock.metrics;

  const metricGroups = [
    {
      label: "Momentum", score: stock.momentum, icon: TrendingUp,
      items: [
        { label: "12M Return", value: `${m.return12m > 0 ? "+" : ""}${m.return12m}%` },
        { label: "6M Return", value: `${m.return6m > 0 ? "+" : ""}${m.return6m}%` },
        { label: "3M Return", value: `${m.return3m > 0 ? "+" : ""}${m.return3m}%` },
      ],
    },
    {
      label: "Quality", score: stock.quality, icon: Shield,
      items: [
        { label: "ROE", value: `${m.roe}%` },
        { label: "Profit Margin", value: `${m.profitMargin}%` },
        { label: "Debt/Equity", value: `${m.debtToEquity}x` },
      ],
    },
    {
      label: "Low Volatility", score: stock.lowVol, icon: BarChart3,
      items: [
        { label: "Beta", value: `${m.beta}` },
        { label: "52W Volatility", value: `${m.volatility52w}%` },
      ],
    },
    {
      label: "Valuation", score: stock.valuation, icon: DollarSign,
      items: [
        { label: "P/E Ratio", value: m.pe > 0 ? `${m.pe}x` : "N/A" },
        { label: "P/B Ratio", value: `${m.pb}x` },
        { label: "Div Yield", value: `${m.dividendYield}%` },
      ],
    },
    {
      label: "ERM", score: stock.erm, icon: LineChart,
      items: [
        { label: "EPS Growth", value: `${m.epsGrowth > 0 ? "+" : ""}${m.epsGrowth}%` },
        { label: "Rev Growth", value: `${m.revenueGrowth > 0 ? "+" : ""}${m.revenueGrowth}%` },
      ],
    },
    {
      label: "Insider", score: stock.insider, icon: Users,
      items: [
        { label: "Insider Own.", value: `${m.insiderOwnership}%` },
        { label: "Institutional", value: `${m.institutionalOwnership}%` },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-[1200px] mx-auto px-4 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="back-to-screener">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tabular-nums">{stock.ticker}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{stock.exchange}</Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{stock.sector}</Badge>
            </div>
          </div>
          <Button
            size="sm"
            variant={isWatched ? "default" : "outline"}
            onClick={() => toggleWatch.mutate()}
            className="text-xs h-8"
            data-testid="watchlist-toggle-detail"
          >
            <Star className={`w-3.5 h-3.5 mr-1 ${isWatched ? "fill-current" : ""}`} />
            {isWatched ? "Watching" : "Watch"}
          </Button>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 py-5 space-y-4">
        {/* Top: Name, Price, Composite */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">{stock.name}</h1>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{stock.description}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xl font-bold tabular-nums">${stock.price.toLocaleString()}</div>
              <div className={`text-sm tabular-nums font-medium ${changeColor}`}>
                {stock.change1d >= 0 ? "+" : ""}{stock.change1d}%
              </div>
            </div>
            <div className="text-center px-3 py-1.5 rounded-lg bg-muted/50 border border-border">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Composite</div>
              <div className={`text-2xl font-bold tabular-nums ${compositeColor}`}>
                {stock.composite}
              </div>
            </div>
          </div>
        </div>

        {/* Price Chart */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold">Price History (24M)</span>
            <span className="text-[10px] text-muted-foreground">MCap: ${stock.marketCap.toFixed(1)}B</span>
          </div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stock.priceHistory}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: string) => v.slice(0, 7)}
                  interval="preserveStartEnd"
                  minTickGap={60}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                  width={55}
                  domain={["auto", "auto"]}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  labelFormatter={(v: string) => v}
                  formatter={(v: number) => [`$${v.toFixed(2)}`, "Price"]}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="hsl(var(--primary))"
                  fill="url(#priceGrad)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Factor Scores Grid */}
        <Card className="p-4">
          <span className="text-sm font-semibold mb-3 block">Factor Breakdown</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {metricGroups.map((group) => {
              const Icon = group.icon;
              return (
                <div key={group.label} className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold">{group.label}</span>
                    <span className="text-xs tabular-nums font-bold ml-auto">{group.score}</span>
                  </div>
                  <ScoreBar score={group.score} size="md" />
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <div key={item.label} className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="tabular-nums font-medium">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Sector Peers */}
        {stock.peers.length > 0 && (
          <Card className="p-4">
            <span className="text-sm font-semibold mb-3 block">Sector Peers — {stock.sector}</span>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-[10px] font-semibold uppercase tracking-wider px-2 py-2">Ticker</th>
                    {FACTOR_CONFIG.map((f) => (
                      <th key={f.key} className="text-center text-[10px] font-semibold uppercase tracking-wider px-2 py-2">{f.label.slice(0, 3)}</th>
                    ))}
                    <th className="text-center text-[10px] font-semibold uppercase tracking-wider px-2 py-2">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Current stock row */}
                  <tr className="border-b border-border bg-primary/5">
                    <td className="px-2 py-1.5">
                      <span className="text-xs font-bold">{stock.ticker}</span>
                    </td>
                    {FACTOR_CONFIG.map((f) => (
                      <td key={f.key} className="px-2 py-1.5 text-center">
                        <span className="text-[10px] tabular-nums font-medium">{stock[f.key]}</span>
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center">
                      <span className="text-xs font-bold tabular-nums">{stock.composite}</span>
                    </td>
                  </tr>
                  {/* Peer rows */}
                  {stock.peers.map((peer) => (
                    <tr key={peer.ticker} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-2 py-1.5">
                        <Link href={`/stock/${peer.ticker}`}>
                          <span className="text-xs font-semibold text-primary hover:underline cursor-pointer" data-testid={`peer-${peer.ticker}`}>
                            {peer.ticker}
                          </span>
                        </Link>
                      </td>
                      {FACTOR_CONFIG.map((f) => (
                        <td key={f.key} className="px-2 py-1.5 text-center">
                          <span className="text-[10px] tabular-nums">{peer[f.key]}</span>
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center">
                        <span className="text-xs font-semibold tabular-nums">{peer.composite}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Key Financials */}
        <Card className="p-4">
          <span className="text-sm font-semibold mb-3 block">Key Financials</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Market Cap", value: `$${stock.marketCap.toFixed(1)}B` },
              { label: "P/E Ratio", value: m.pe > 0 ? `${m.pe}x` : "N/A" },
              { label: "P/B Ratio", value: `${m.pb}x` },
              { label: "Div Yield", value: `${m.dividendYield}%` },
              { label: "Beta", value: `${m.beta}` },
              { label: "ROE", value: `${m.roe}%` },
              { label: "Profit Margin", value: `${m.profitMargin}%` },
              { label: "D/E Ratio", value: `${m.debtToEquity}x` },
            ].map((item) => (
              <div key={item.label} className="space-y-0.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</div>
                <div className="text-sm font-semibold tabular-nums">{item.value}</div>
              </div>
            ))}
          </div>
        </Card>
      </main>


    </div>
  );
}
