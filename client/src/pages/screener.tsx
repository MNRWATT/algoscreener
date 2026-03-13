import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight,
  Search, SlidersHorizontal, RotateCcw, TrendingUp, Shield,
  BarChart3, DollarSign, LineChart, Users, Moon, Sun, Filter, X,
  Rocket, Scale, Wallet, Crosshair, Sparkles, Activity,
  Star, Eye, Grid3x3, Bell, Check, Briefcase,
} from "lucide-react";
import type { StockScore, FactorWeights, MarketRegime, PresetStrategy, WatchlistItem, Alert } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ─── Weights URL Helper ───────────────────────────────────────────

function weightsToParams(w: FactorWeights): string {
  return `momentum=${w.momentum}&quality=${w.quality}&lowVol=${w.lowVol}&valuation=${w.valuation}&erm=${w.erm}&insider=${w.insider}`;
}

// ─── Theme Toggle ────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  }, []);

  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", dark);
  }

  return (
    <Button size="icon" variant="ghost" onClick={toggle} data-testid="theme-toggle">
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

// ─── Alerts Dropdown ─────────────────────────────────────────────

function AlertsDropdown() {
  const [open, setOpen] = useState(false);

  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/alerts");
      return res.json();
    },
    staleTime: 10000,
  });

  const unreadCount = alerts.filter((a) => !a.read).length;

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/alerts/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/alerts/read/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
    },
  });

  return (
    <div className="relative">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setOpen(!open)}
        className="relative"
        data-testid="alerts-button"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[9px] rounded-full flex items-center justify-center font-bold">
            {unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-72 sm:w-80 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden" data-testid="alerts-panel">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold">Alerts</span>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="text-[10px] text-primary hover:underline"
                  data-testid="mark-all-read"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto">
              {alerts.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  No alerts yet
                </div>
              ) : (
                alerts.slice(0, 10).map((alert) => (
                  <div
                    key={alert.id}
                    className={`px-3 py-2 border-b border-border/50 text-xs cursor-pointer hover:bg-muted/30 transition-colors ${
                      !alert.read ? "bg-primary/5" : ""
                    }`}
                    onClick={() => {
                      if (!alert.read) markRead.mutate(alert.id);
                    }}
                    data-testid={`alert-${alert.id}`}
                  >
                    <div className="flex items-start gap-2">
                      {!alert.read && (
                        <span className="w-1.5 h-1.5 bg-primary rounded-full mt-1 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`leading-relaxed ${!alert.read ? "font-medium" : "text-muted-foreground"}`}>
                          {alert.message}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(alert.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Factor Sliders Panel ────────────────────────────────────────

interface FactorConfig {
  key: keyof FactorWeights;
  label: string;
  shortLabel: string;
  icon: typeof TrendingUp;
  color: string;
  description: string;
  longDescription: string;
}

const FACTORS: FactorConfig[] = [
  {
    key: "momentum", label: "Momentum", shortLabel: "Mom", icon: TrendingUp, color: "bg-chart-1",
    description: "12M/6M/3M price returns",
    longDescription: "Momentum measures recent price performance over 12, 6, and 3 months. High momentum stocks have strong price trends, which research shows tend to persist in the short to medium term.",
  },
  {
    key: "quality", label: "Quality", shortLabel: "Qua", icon: Shield, color: "bg-chart-5",
    description: "ROE, margins, debt health",
    longDescription: "Quality captures profitability and financial health using Return on Equity (ROE), profit margins, and debt-to-equity ratio. High quality companies are well-managed with sustainable earnings.",
  },
  {
    key: "lowVol", label: "Low Vol", shortLabel: "Low", icon: BarChart3, color: "bg-chart-3",
    description: "Beta & 52W volatility",
    longDescription: "Low Volatility measures price stability using beta (sensitivity to market moves) and 52-week realized volatility. Low-vol stocks historically deliver better risk-adjusted returns.",
  },
  {
    key: "valuation", label: "Valuation", shortLabel: "Val", icon: DollarSign, color: "bg-chart-4",
    description: "P/E, P/B, dividend yield",
    longDescription: "Valuation assesses how cheaply a stock is priced relative to fundamentals using Price/Earnings, Price/Book, and dividend yield. Deep value stocks are statistically underpriced.",
  },
  {
    key: "erm", label: "ERM", shortLabel: "ERM", icon: LineChart, color: "bg-chart-2",
    description: "EPS & revenue growth",
    longDescription: "Earnings Revision Model (ERM) tracks EPS growth and revenue growth momentum. Stocks with accelerating earnings tend to outperform as analysts revise estimates upward.",
  },
  {
    key: "insider", label: "Insider", shortLabel: "Ins", icon: Users, color: "bg-chart-1",
    description: "Insider & institutional ownership",
    longDescription: "Insider measures ownership conviction — how much company insiders and institutional investors hold. High insider ownership aligns management interests with shareholders.",
  },
];

const DEFAULT_WEIGHTS: FactorWeights = {
  momentum: 30,
  quality: 25,
  lowVol: 20,
  valuation: 10,
  erm: 10,
  insider: 5,
};

function FactorSliders({
  weights,
  onWeightsChange,
}: {
  weights: FactorWeights;
  onWeightsChange: (w: FactorWeights) => void;
}) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  const reset = () => onWeightsChange({ ...DEFAULT_WEIGHTS });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Factor Weights</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs tabular-nums ${total === 100 ? "text-muted-foreground" : "text-destructive font-medium"}`}>
            {total}/100
          </span>
          <Button size="sm" variant="ghost" onClick={reset} data-testid="reset-weights">
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {FACTORS.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.key} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">{f.label}</span>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground font-medium w-8 text-right">
                  {weights[f.key]}%
                </span>
              </div>
              <Slider
                value={[weights[f.key]]}
                max={100}
                step={5}
                onValueChange={([v]) => onWeightsChange({ ...weights, [f.key]: v })}
                data-testid={`slider-${f.key}`}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Preset Icon Map ─────────────────────────────────────────────

const PRESET_ICONS: Record<string, typeof Rocket> = {
  rocket: Rocket,
  scale: Scale,
  shield: Shield,
  "search-dollar": Crosshair,
  wallet: Wallet,
  "trending-up": TrendingUp,
};

// ─── Suggested Mix Card (Top) ────────────────────────────────────

function SuggestedMixCard({
  regime,
  isActive,
  onApply,
  isLoading,
}: {
  regime: MarketRegime | undefined;
  isActive: boolean;
  onApply: () => void;
  isLoading: boolean;
}) {
  if (isLoading || !regime) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-16 w-full mb-2" />
        <Skeleton className="h-8 w-full" />
      </Card>
    );
  }

  const vixColor =
    regime.vixLabel === "High" ? "text-red-500" :
    regime.vixLabel === "Elevated" ? "text-amber-500" :
    regime.vixLabel === "Moderate" ? "text-yellow-500" :
    "text-emerald-500";

  const riskColor =
    regime.geopoliticalRisk === "High" ? "text-red-500" :
    regime.geopoliticalRisk === "Elevated" ? "text-amber-500" :
    "text-emerald-500";

  return (
    <Card className={`p-4 transition-all duration-200 ${
      isActive
        ? "ring-1 ring-primary/50 bg-primary/[0.03] dark:bg-primary/[0.06]"
        : ""
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Suggested Mix</span>
        </div>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-medium">
          {regime.regimeName}
        </Badge>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
        {regime.regimeDescription}
      </p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-3">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-muted-foreground">VIX</span>
          <span className={`text-[11px] tabular-nums font-semibold ${vixColor}`}>
            {regime.vix} ({regime.vixLabel})
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-muted-foreground">Yield 10Y-2Y</span>
          <span className="text-[11px] tabular-nums font-semibold">
            {regime.yieldSpread10y2y > 0 ? "+" : ""}{regime.yieldSpread10y2y}%
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-muted-foreground">Fed Rate</span>
          <span className="text-[11px] tabular-nums font-medium">{regime.fedRate}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-muted-foreground">S&P YTD</span>
          <span className={`text-[11px] tabular-nums font-semibold ${regime.sp500Ytd >= 0 ? "text-emerald-500" : "text-red-500"}`}>
            {regime.sp500Ytd >= 0 ? "+" : ""}{regime.sp500Ytd}%
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-muted-foreground">Recession</span>
          <span className="text-[11px] tabular-nums font-medium">{regime.recessionProb}%</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-muted-foreground">Geo Risk</span>
          <span className={`text-[11px] font-semibold ${riskColor}`}>{regime.geopoliticalRisk}</span>
        </div>
      </div>

      <div className="space-y-1 mb-3">
        {FACTORS.map((f) => {
          const w = regime.suggestedWeights[f.key];
          return (
            <div key={f.key} className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-12 shrink-0">{f.label}</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary/70 rounded-full transition-all duration-300"
                  style={{ width: `${w}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums font-medium w-6 text-right">{w}%</span>
            </div>
          );
        })}
      </div>

      <Button
        size="sm"
        className={`w-full text-xs h-8 ${
          isActive
            ? "bg-primary/20 text-primary hover:bg-primary/30 dark:bg-primary/25"
            : ""
        }`}
        variant={isActive ? "ghost" : "default"}
        onClick={onApply}
        data-testid="apply-suggested-mix"
      >
        <Activity className="w-3 h-3 mr-1.5" />
        {isActive ? "Applied" : "Apply Suggested Mix"}
      </Button>
    </Card>
  );
}

// ─── Preset Strategy Buttons + Create Portfolio ──────────────────

function PresetStrategies({
  presets,
  activePreset,
  onSelect,
  isLoading,
  onCreatePortfolio,
}: {
  presets: PresetStrategy[];
  activePreset: string | null;
  onSelect: (preset: PresetStrategy) => void;
  isLoading: boolean;
  onCreatePortfolio: () => void;
}) {
  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[52px]" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Strategies</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {presets.map((p) => {
          const Icon = PRESET_ICONS[p.icon] || Scale;
          const isActive = activePreset === p.id;
          return (
            <TooltipProvider key={p.id} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onSelect(p)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-left transition-all duration-150 ${
                      isActive
                        ? "bg-primary/10 border-primary text-primary dark:bg-primary/15"
                        : "border-border hover:border-primary/40 hover:bg-muted/50 text-foreground"
                    }`}
                    data-testid={`preset-${p.id}`}
                  >
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="text-[11px] font-medium leading-tight truncate">{p.name}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <p className="text-xs">{p.description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>

      {/* Create Portfolio Button */}
      <Button
        size="sm"
        className="w-full mt-3 text-xs h-9 gap-1.5"
        onClick={onCreatePortfolio}
        data-testid="create-portfolio-btn"
      >
        <Briefcase className="w-3.5 h-3.5" />
        Create Portfolio
      </Button>
    </Card>
  );
}

// ─── Score bar component ─────────────────────────────────────────

function ScoreBar({ score, size = "sm" }: { score: number; size?: "sm" | "md" }) {
  const h = size === "md" ? "h-2" : "h-1.5";
  const color =
    score >= 80 ? "bg-emerald-500" :
    score >= 60 ? "bg-teal-500" :
    score >= 40 ? "bg-amber-500" :
    score >= 20 ? "bg-orange-500" :
    "bg-red-500";

  return (
    <div className={`${h} w-full bg-muted rounded-full overflow-hidden`}>
      <div
        className={`${h} ${color} rounded-full score-bar`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

// ─── Stock Detail Card ───────────────────────────────────────────

function StockDetailCard({ stock }: { stock: StockScore }) {
  const m = stock.metrics;

  const metricGroups = [
    {
      label: "Momentum", score: stock.momentum,
      items: [
        { label: "12M Return", value: `${m.return12m > 0 ? "+" : ""}${m.return12m}%` },
        { label: "6M Return", value: `${m.return6m > 0 ? "+" : ""}${m.return6m}%` },
        { label: "3M Return", value: `${m.return3m > 0 ? "+" : ""}${m.return3m}%` },
      ],
    },
    {
      label: "Quality", score: stock.quality,
      items: [
        { label: "ROE", value: `${m.roe}%` },
        { label: "Profit Margin", value: `${m.profitMargin}%` },
        { label: "Debt/Equity", value: `${m.debtToEquity}x` },
      ],
    },
    {
      label: "Low Volatility", score: stock.lowVol,
      items: [
        { label: "Beta", value: `${m.beta}` },
        { label: "52W Volatility", value: `${m.volatility52w}%` },
      ],
    },
    {
      label: "Valuation", score: stock.valuation,
      items: [
        { label: "P/E Ratio", value: m.pe > 0 ? `${m.pe}x` : "N/A" },
        { label: "P/B Ratio", value: `${m.pb}x` },
        { label: "Div Yield", value: `${m.dividendYield}%` },
      ],
    },
    {
      label: "ERM", score: stock.erm,
      items: [
        { label: "EPS Growth", value: `${m.epsGrowth > 0 ? "+" : ""}${m.epsGrowth}%` },
        { label: "Rev Growth", value: `${m.revenueGrowth > 0 ? "+" : ""}${m.revenueGrowth}%` },
      ],
    },
    {
      label: "Insider", score: stock.insider,
      items: [
        { label: "Insider Own.", value: `${m.insiderOwnership}%` },
        { label: "Institutional", value: `${m.institutionalOwnership}%` },
      ],
    },
  ];

  return (
    <div className="stock-detail-enter px-4 py-4 bg-muted/30 border-t border-border">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {metricGroups.map((group) => (
          <div key={group.label} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{group.label}</span>
              <span className="text-xs tabular-nums font-medium">{group.score}</span>
            </div>
            <ScoreBar score={group.score} size="md" />
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <div key={item.label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="tabular-nums font-medium">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sort types ──────────────────────────────────────────────────

type SortField = "composite" | "ticker" | "price" | "change1d" | "marketCap" | "momentum" | "quality" | "lowVol" | "valuation" | "erm" | "insider";
type SortDir = "asc" | "desc";

// ─── Factor Column Header Tooltip ────────────────────────────────

function FactorColumnHeader({
  factor,
  sortField,
  sortDir,
  onSort,
}: {
  factor: FactorConfig;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const isActive = sortField === factor.key;
  const SortIconEl = isActive
    ? sortDir === "asc" ? ArrowUp : ArrowDown
    : ArrowUpDown;

  return (
    <th
      className="text-center text-[10px] font-semibold uppercase tracking-wider px-2 py-2.5 cursor-pointer select-none whitespace-nowrap hidden sm:table-cell"
      onClick={() => onSort(factor.key as SortField)}
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center justify-center gap-0.5">
              {factor.shortLabel}
              <SortIconEl className={`w-3 h-3 ${isActive ? "text-primary" : "opacity-30"}`} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[240px] p-3">
            <p className="text-xs font-semibold mb-1">{factor.label}</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{factor.longDescription}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </th>
  );
}

// ─── Main Screener Page ──────────────────────────────────────────

export default function ScreenerPage() {
  const [, navigate] = useLocation();
  const [weights, setWeights] = useState<FactorWeights>({ ...DEFAULT_WEIGHTS });
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("composite");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [exchangeFilter, setExchangeFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>("balanced");

  // Fetch watchlist
  const { data: watchlist = [] } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/watchlist");
      return res.json();
    },
  });

  const watchlistTickers = useMemo(() => new Set(watchlist.map((w) => w.ticker)), [watchlist]);

  const toggleWatchlist = useMutation({
    mutationFn: async (ticker: string) => {
      if (watchlistTickers.has(ticker)) {
        await apiRequest("DELETE", `/api/watchlist/${ticker}`);
      } else {
        await apiRequest("POST", `/api/watchlist/${ticker}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });

  // Fetch presets
  const { data: presets, isLoading: presetsLoading } = useQuery<PresetStrategy[]>({
    queryKey: ["/api/presets"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/presets");
      return res.json();
    },
    staleTime: Infinity,
  });

  // Fetch market regime
  const { data: regime, isLoading: regimeLoading } = useQuery<MarketRegime>({
    queryKey: ["/api/market-regime"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/market-regime");
      return res.json();
    },
    staleTime: 60000,
  });

  const weightsMatch = useCallback((a: FactorWeights, b: FactorWeights) => {
    return a.momentum === b.momentum && a.quality === b.quality && a.lowVol === b.lowVol &&
      a.valuation === b.valuation && a.erm === b.erm && a.insider === b.insider;
  }, []);

  const isSuggestedActive = regime ? weightsMatch(weights, regime.suggestedWeights) : false;

  const detectedPreset = useMemo(() => {
    if (!presets) return null;
    if (isSuggestedActive) return null;
    const match = presets.find((p) => weightsMatch(weights, p.weights));
    return match?.id ?? null;
  }, [presets, weights, isSuggestedActive, weightsMatch]);

  const handlePresetSelect = useCallback((preset: PresetStrategy) => {
    setWeights({ ...preset.weights });
    setActivePreset(preset.id);
  }, []);

  const handleSuggestedApply = useCallback(() => {
    if (regime) {
      setWeights({ ...regime.suggestedWeights });
      setActivePreset(null);
    }
  }, [regime]);

  const handleWeightsChange = useCallback((w: FactorWeights) => {
    setWeights(w);
    setActivePreset(null);
  }, []);

  const handleCreatePortfolio = useCallback(() => {
    navigate(`/portfolio?${weightsToParams(weights)}`);
  }, [weights, navigate]);

  const queryParams = new URLSearchParams({
    momentum: String(weights.momentum),
    quality: String(weights.quality),
    lowVol: String(weights.lowVol),
    valuation: String(weights.valuation),
    erm: String(weights.erm),
    insider: String(weights.insider),
  }).toString();

  const { data, isLoading } = useQuery<{ stocks: StockScore[]; lastUpdated: string }>({
    queryKey: ["/api/screener", queryParams],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/screener?${queryParams}`);
      return res.json();
    },
    staleTime: 30000,
  });

  const filteredStocks = useMemo(() => {
    if (!data?.stocks) return [];
    let stocks = data.stocks;

    if (search) {
      const q = search.toLowerCase();
      stocks = stocks.filter(
        (s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );
    }

    if (sectorFilter) {
      stocks = stocks.filter((s) => s.sector === sectorFilter);
    }

    if (exchangeFilter) {
      stocks = stocks.filter((s) => s.exchange === exchangeFilter);
    }

    stocks = [...stocks].sort((a, b) => {
      const av = a[sortField] as number;
      const bv = b[sortField] as number;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    return stocks;
  }, [data, search, sortField, sortDir, sectorFilter, exchangeFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 ml-1 text-primary" />
    ) : (
      <ArrowDown className="w-3 h-3 ml-1 text-primary" />
    );
  };

  const sectors = useMemo(() => {
    if (!data?.stocks) return [];
    return [...new Set(data.stocks.map((s) => s.sector))].sort();
  }, [data]);

  const exchanges = useMemo(() => {
    if (!data?.stocks) return [];
    return [...new Set(data.stocks.map((s) => s.exchange))].sort();
  }, [data]);

  const activeFilters = (sectorFilter ? 1 : 0) + (exchangeFilter ? 1 : 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-[1440px] mx-auto px-4 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-label="AlgoScreener logo">
              <rect x="2" y="18" width="6" height="12" rx="1.5" fill="currentColor" opacity="0.4" />
              <rect x="10" y="12" width="6" height="18" rx="1.5" fill="currentColor" opacity="0.6" />
              <rect x="18" y="6" width="6" height="24" rx="1.5" fill="currentColor" opacity="0.8" />
              <rect x="26" y="2" width="6" height="28" rx="1.5" fill="hsl(var(--primary))" />
            </svg>
            <span className="text-sm font-bold tracking-tight">AlgoScreener</span>
          </div>

          {/* Navigation */}
          <nav className="hidden sm:flex items-center gap-1">
            <Link href="/watchlist">
              <Button variant="ghost" size="sm" className="text-xs h-8 gap-1.5" data-testid="nav-watchlist">
                <Eye className="w-3.5 h-3.5" />
                Watchlist
                {watchlist.length > 0 && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-0.5">{watchlist.length}</Badge>
                )}
              </Button>
            </Link>
            <Link href="/heatmap">
              <Button variant="ghost" size="sm" className="text-xs h-8 gap-1.5" data-testid="nav-heatmap">
                <Grid3x3 className="w-3.5 h-3.5" />
                Heatmap
              </Button>
            </Link>
            <Link href={`/portfolio?${weightsToParams(weights)}`}>
              <Button variant="ghost" size="sm" className="text-xs h-8 gap-1.5" data-testid="nav-portfolio">
                <Briefcase className="w-3.5 h-3.5" />
                Portfolio
              </Button>
            </Link>
            <Link href={`/backtest?${weightsToParams(weights)}`}>
              <Button variant="ghost" size="sm" className="text-xs h-8 gap-1.5" data-testid="nav-backtest">
                <TrendingUp className="w-3.5 h-3.5" />
                Backtest
              </Button>
            </Link>
          </nav>

          <div className="flex items-center gap-1">
            {data && (
              <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:inline">
                {filteredStocks.length} stocks
              </span>
            )}
            <AlertsDropdown />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-4 py-4">
        {/* Mobile nav */}
        <div className="flex sm:hidden gap-1.5 mb-3 overflow-x-auto pb-1">
          <Link href="/watchlist">
            <Button variant="outline" size="sm" className="text-[11px] h-7 gap-1 shrink-0">
              <Eye className="w-3 h-3" /> Watchlist
            </Button>
          </Link>
          <Link href="/heatmap">
            <Button variant="outline" size="sm" className="text-[11px] h-7 gap-1 shrink-0">
              <Grid3x3 className="w-3 h-3" /> Heatmap
            </Button>
          </Link>
          <Link href={`/portfolio?${weightsToParams(weights)}`}>
            <Button variant="outline" size="sm" className="text-[11px] h-7 gap-1 shrink-0">
              <Briefcase className="w-3 h-3" /> Portfolio
            </Button>
          </Link>
          <Link href={`/backtest?${weightsToParams(weights)}`}>
            <Button variant="outline" size="sm" className="text-[11px] h-7 gap-1 shrink-0">
              <TrendingUp className="w-3 h-3" /> Backtest
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Left panel: Factor weights */}
          <aside className="space-y-3">
            {/* Suggested Mix FIRST */}
            <SuggestedMixCard
              regime={regime}
              isActive={isSuggestedActive}
              onApply={handleSuggestedApply}
              isLoading={regimeLoading}
            />

            {/* Strategies SECOND with Create Portfolio button */}
            <PresetStrategies
              presets={presets || []}
              activePreset={detectedPreset ?? activePreset}
              onSelect={handlePresetSelect}
              isLoading={presetsLoading}
              onCreatePortfolio={handleCreatePortfolio}
            />

            <FactorSliders weights={weights} onWeightsChange={handleWeightsChange} />

            {/* Search + filters */}
            <Card className="p-3 space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search ticker or name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                  data-testid="search-input"
                />
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between text-xs"
                onClick={() => setShowFilters(!showFilters)}
                data-testid="toggle-filters"
              >
                <span className="flex items-center gap-1.5">
                  <Filter className="w-3 h-3" />
                  Filters
                  {activeFilters > 0 && (
                    <Badge variant="default" className="text-[10px] px-1 py-0 ml-1">{activeFilters}</Badge>
                  )}
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
              </Button>

              {showFilters && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sector</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {sectors.map((s) => (
                        <button
                          key={s}
                          onClick={() => setSectorFilter(sectorFilter === s ? null : s)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                            sectorFilter === s
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:border-primary/50"
                          }`}
                          data-testid={`sector-${s}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Exchange</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {exchanges.map((e) => (
                        <button
                          key={e}
                          onClick={() => setExchangeFilter(exchangeFilter === e ? null : e)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                            exchangeFilter === e
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:border-primary/50"
                          }`}
                          data-testid={`exchange-${e}`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                  {activeFilters > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs w-full"
                      onClick={() => { setSectorFilter(null); setExchangeFilter(null); }}
                      data-testid="clear-filters"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Clear filters
                    </Button>
                  )}
                </div>
              )}
            </Card>
          </aside>

          {/* Right panel: Screener table */}
          <div className="min-w-0">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="w-8 px-1.5" />
                      <th className="text-left text-[10px] font-semibold uppercase tracking-wider px-2 py-2.5 w-8">#</th>
                      <th
                        className="text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5 cursor-pointer select-none whitespace-nowrap"
                        onClick={() => handleSort("ticker")}
                      >
                        <span className="flex items-center">Ticker <SortIcon field="ticker" /></span>
                      </th>
                      <th
                        className="text-right text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5 cursor-pointer select-none whitespace-nowrap"
                        onClick={() => handleSort("price")}
                      >
                        <span className="flex items-center justify-end">Price <SortIcon field="price" /></span>
                      </th>
                      <th
                        className="text-right text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5 cursor-pointer select-none whitespace-nowrap"
                        onClick={() => handleSort("change1d")}
                      >
                        <span className="flex items-center justify-end">Chg% <SortIcon field="change1d" /></span>
                      </th>
                      <th
                        className="text-right text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5 cursor-pointer select-none whitespace-nowrap hidden md:table-cell"
                        onClick={() => handleSort("marketCap")}
                      >
                        <span className="flex items-center justify-end">MCap <SortIcon field="marketCap" /></span>
                      </th>
                      {FACTORS.map((f) => (
                        <FactorColumnHeader
                          key={f.key}
                          factor={f}
                          sortField={sortField}
                          sortDir={sortDir}
                          onSort={handleSort}
                        />
                      ))}
                      <th
                        className="text-center text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5 cursor-pointer select-none whitespace-nowrap"
                        onClick={() => handleSort("composite")}
                      >
                        <span className="flex items-center justify-center">Score <SortIcon field="composite" /></span>
                      </th>
                      <th className="w-8 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading
                      ? Array.from({ length: 20 }).map((_, i) => (
                          <tr key={i} className="border-b border-border/50">
                            <td className="px-1.5 py-2"><Skeleton className="h-4 w-4" /></td>
                            <td className="px-2 py-2"><Skeleton className="h-4 w-4" /></td>
                            <td className="px-3 py-2"><Skeleton className="h-4 w-24" /></td>
                            <td className="px-3 py-2"><Skeleton className="h-4 w-16" /></td>
                            <td className="px-3 py-2"><Skeleton className="h-4 w-12" /></td>
                            <td className="px-3 py-2 hidden md:table-cell"><Skeleton className="h-4 w-14" /></td>
                            {FACTORS.map((f) => (
                              <td key={f.key} className="px-2 py-2 hidden sm:table-cell"><Skeleton className="h-4 w-8 mx-auto" /></td>
                            ))}
                            <td className="px-3 py-2"><Skeleton className="h-4 w-10 mx-auto" /></td>
                            <td className="px-2 py-2"><Skeleton className="h-4 w-4" /></td>
                          </tr>
                        ))
                      : filteredStocks.map((stock, idx) => {
                          const isExpanded = expandedTicker === stock.ticker;
                          const isWatched = watchlistTickers.has(stock.ticker);
                          return (
                            <StockRow
                              key={stock.ticker}
                              stock={stock}
                              rank={idx + 1}
                              isExpanded={isExpanded}
                              isWatched={isWatched}
                              onToggle={() =>
                                setExpandedTicker(isExpanded ? null : stock.ticker)
                              }
                              onWatchlistToggle={() => toggleWatchlist.mutate(stock.ticker)}
                            />
                          );
                        })}
                  </tbody>
                </table>
              </div>
              {!isLoading && filteredStocks.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No stocks match your filters
                </div>
              )}
            </Card>
          </div>
        </div>
      </main>


    </div>
  );
}

// ─── Table Row ───────────────────────────────────────────────────

function StockRow({
  stock,
  rank,
  isExpanded,
  isWatched,
  onToggle,
  onWatchlistToggle,
}: {
  stock: StockScore;
  rank: number;
  isExpanded: boolean;
  isWatched: boolean;
  onToggle: () => void;
  onWatchlistToggle: () => void;
}) {
  const changeColor = stock.change1d >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";

  const compositeColor =
    stock.composite >= 70 ? "text-emerald-600 dark:text-emerald-400" :
    stock.composite >= 50 ? "text-foreground" :
    "text-muted-foreground";

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
        data-testid={`stock-row-${stock.ticker}`}
      >
        <td className="px-1.5 py-2">
          <button
            onClick={(e) => { e.stopPropagation(); onWatchlistToggle(); }}
            className={`transition-colors ${isWatched ? "text-amber-500" : "text-muted-foreground/30 hover:text-amber-400"}`}
            data-testid={`star-${stock.ticker}`}
          >
            <Star className={`w-3.5 h-3.5 ${isWatched ? "fill-current" : ""}`} />
          </button>
        </td>
        <td className="px-2 py-2 text-xs text-muted-foreground tabular-nums">{rank}</td>
        <td className="px-3 py-2 cursor-pointer" onClick={onToggle}>
          <div className="flex flex-col">
            <Link href={`/stock/${stock.ticker}`} onClick={(e) => e.stopPropagation()}>
              <span className="text-sm font-semibold tabular-nums text-primary hover:underline">{stock.ticker}</span>
            </Link>
            <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">{stock.name}</span>
          </div>
        </td>
        <td className="px-3 py-2 text-right text-sm tabular-nums font-medium cursor-pointer" onClick={onToggle}>${stock.price.toLocaleString()}</td>
        <td className={`px-3 py-2 text-right text-sm tabular-nums font-medium cursor-pointer ${changeColor}`} onClick={onToggle}>
          {stock.change1d >= 0 ? "+" : ""}{stock.change1d}%
        </td>
        <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground hidden md:table-cell cursor-pointer" onClick={onToggle}>
          ${stock.marketCap.toFixed(1)}B
        </td>
        {FACTORS.map((f) => {
          const val = stock[f.key as keyof StockScore] as number;
          return (
            <td key={f.key} className="px-2 py-2 hidden sm:table-cell cursor-pointer" onClick={onToggle}>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] tabular-nums font-medium">{val}</span>
                <div className="w-10">
                  <ScoreBar score={val} />
                </div>
              </div>
            </td>
          );
        })}
        <td className="px-3 py-2 text-center cursor-pointer" onClick={onToggle}>
          <span className={`text-sm tabular-nums font-bold ${compositeColor}`}>
            {stock.composite}
          </span>
        </td>
        <td className="px-2 py-2 cursor-pointer" onClick={onToggle}>
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={100}>
            <StockDetailCard stock={stock} />
          </td>
        </tr>
      )}
    </>
  );
}
