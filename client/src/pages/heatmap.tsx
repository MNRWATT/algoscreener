import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowLeft, Grid3x3 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { HeatmapSector } from "@shared/schema";

type ColorMode = "composite" | "change1d";

function getCompositeColor(score: number): string {
  if (score >= 75) return "bg-emerald-600 text-white";
  if (score >= 65) return "bg-emerald-500 text-white";
  if (score >= 55) return "bg-teal-500 text-white";
  if (score >= 50) return "bg-teal-400/80 text-white";
  if (score >= 45) return "bg-amber-400/80 text-foreground";
  if (score >= 35) return "bg-orange-500 text-white";
  return "bg-red-500 text-white";
}

function getChangeColor(change: number): string {
  if (change >= 3) return "bg-emerald-600 text-white";
  if (change >= 1.5) return "bg-emerald-500 text-white";
  if (change >= 0.5) return "bg-emerald-400/80 text-white";
  if (change >= 0) return "bg-emerald-300/60 text-foreground";
  if (change >= -0.5) return "bg-red-300/60 text-foreground";
  if (change >= -1.5) return "bg-red-400/80 text-white";
  if (change >= -3) return "bg-red-500 text-white";
  return "bg-red-600 text-white";
}

export default function HeatmapPage() {
  const [colorMode, setColorMode] = useState<ColorMode>("composite");

  const { data: heatmap, isLoading } = useQuery<HeatmapSector[]>({
    queryKey: ["/api/heatmap", "momentum=30&quality=25&lowVol=20&valuation=10&erm=10&insider=5"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/heatmap?momentum=30&quality=25&lowVol=20&valuation=10&erm=10&insider=5");
      return res.json();
    },
  });

  // Compute total market cap for sizing
  const totalMcap = useMemo(() => {
    if (!heatmap) return 1;
    return heatmap.reduce((sum, s) => sum + s.stocks.reduce((a, c) => a + c.marketCap, 0), 0);
  }, [heatmap]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-[1440px] mx-auto px-4 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="back-from-heatmap">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Grid3x3 className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold">Sector Heatmap</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={colorMode === "composite" ? "default" : "outline"}
              className="text-[11px] h-7 px-2"
              onClick={() => setColorMode("composite")}
              data-testid="heatmap-mode-composite"
            >
              Score
            </Button>
            <Button
              size="sm"
              variant={colorMode === "change1d" ? "default" : "outline"}
              className="text-[11px] h-7 px-2"
              onClick={() => setColorMode("change1d")}
              data-testid="heatmap-mode-change"
            >
              Daily Chg
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-4 py-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : heatmap && heatmap.length > 0 ? (
          <div className="space-y-2">
            {heatmap.map((sector) => {
              const sectorMcap = sector.stocks.reduce((a, c) => a + c.marketCap, 0);
              return (
                <div key={sector.sector}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold">{sector.sector}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      Avg: {sector.avgComposite}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-[2px]" data-testid={`heatmap-sector-${sector.sector}`}>
                    {sector.stocks.map((cell) => {
                      // Size cells relative to market cap within sector
                      const relSize = Math.max(cell.marketCap / sectorMcap * 100, 4);
                      const colorClass = colorMode === "composite"
                        ? getCompositeColor(cell.composite)
                        : getChangeColor(cell.change1d);

                      return (
                        <TooltipProvider key={cell.ticker} delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link href={`/stock/${cell.ticker}`}>
                                <div
                                  className={`rounded-sm cursor-pointer transition-all hover:ring-1 hover:ring-foreground/30 flex flex-col items-center justify-center p-1 ${colorClass}`}
                                  style={{
                                    width: `${Math.max(relSize * 3, 48)}px`,
                                    height: `${Math.max(relSize * 1.8, 36)}px`,
                                    minWidth: "48px",
                                    minHeight: "36px",
                                  }}
                                  data-testid={`heatmap-cell-${cell.ticker}`}
                                >
                                  <span className="text-[9px] font-bold leading-none truncate max-w-full">{cell.ticker}</span>
                                  <span className="text-[8px] tabular-nums font-medium leading-none mt-0.5">
                                    {colorMode === "composite" ? cell.composite : `${cell.change1d >= 0 ? "+" : ""}${cell.change1d}%`}
                                  </span>
                                </div>
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[220px]">
                              <div className="space-y-0.5">
                                <p className="text-xs font-semibold">{cell.name}</p>
                                <p className="text-[10px] text-muted-foreground">{cell.sector}</p>
                                <div className="grid grid-cols-2 gap-x-3 text-[10px] mt-1">
                                  <span>Score: <b className="tabular-nums">{cell.composite}</b></span>
                                  <span>Chg: <b className={`tabular-nums ${cell.change1d >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                    {cell.change1d >= 0 ? "+" : ""}{cell.change1d}%
                                  </b></span>
                                  <span>MCap: <b className="tabular-nums">${cell.marketCap.toFixed(1)}B</b></span>
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No heatmap data available
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 flex items-center justify-center gap-4">
          {colorMode === "composite" ? (
            <>
              <span className="text-[10px] text-muted-foreground">Score:</span>
              {[
                { label: "≥75", cls: "bg-emerald-600" },
                { label: "65", cls: "bg-emerald-500" },
                { label: "55", cls: "bg-teal-500" },
                { label: "45", cls: "bg-amber-400/80" },
                { label: "35", cls: "bg-orange-500" },
                { label: "<35", cls: "bg-red-500" },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-1">
                  <div className={`w-3 h-3 rounded-sm ${l.cls}`} />
                  <span className="text-[10px] text-muted-foreground">{l.label}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <span className="text-[10px] text-muted-foreground">Change:</span>
              {[
                { label: "≥3%", cls: "bg-emerald-600" },
                { label: "1.5%", cls: "bg-emerald-500" },
                { label: "0%", cls: "bg-emerald-300/60" },
                { label: "-1.5%", cls: "bg-red-400/80" },
                { label: "≤-3%", cls: "bg-red-600" },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-1">
                  <div className={`w-3 h-3 rounded-sm ${l.cls}`} />
                  <span className="text-[10px] text-muted-foreground">{l.label}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </main>


    </div>
  );
}
