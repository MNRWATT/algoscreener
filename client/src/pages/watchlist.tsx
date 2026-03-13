import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Star, Eye, TrendingUp } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { StockScore, WatchlistItem } from "@shared/schema";

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-emerald-500" :
    score >= 60 ? "bg-teal-500" :
    score >= 40 ? "bg-amber-500" :
    score >= 20 ? "bg-orange-500" :
    "bg-red-500";

  return (
    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
      <div
        className={`h-1.5 ${color} rounded-full transition-all duration-500`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

export default function WatchlistPage() {
  const { data: watchlist = [], isLoading: watchlistLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/watchlist");
      return res.json();
    },
  });

  const { data: screenerData, isLoading: screenerLoading } = useQuery<{ stocks: StockScore[] }>({
    queryKey: ["/api/screener", "momentum=30&quality=25&lowVol=20&valuation=10&erm=10&insider=5"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/screener?momentum=30&quality=25&lowVol=20&valuation=10&erm=10&insider=5");
      return res.json();
    },
  });

  const watchedStocks = useMemo(() => {
    if (!screenerData?.stocks || watchlist.length === 0) return [];
    const tickerSet = new Set(watchlist.map((w) => w.ticker));
    return screenerData.stocks.filter((s) => tickerSet.has(s.ticker));
  }, [screenerData, watchlist]);

  const removeFromWatchlist = useMutation({
    mutationFn: async (ticker: string) => {
      await apiRequest("DELETE", `/api/watchlist/${ticker}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });

  const isLoading = watchlistLoading || screenerLoading;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-[1200px] mx-auto px-4 h-12 flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="back-from-watchlist">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold">Watchlist</span>
            {watchlist.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{watchlist.length}</Badge>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 py-5">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : watchedStocks.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <Star className="w-10 h-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">No stocks in your watchlist yet</p>
            <p className="text-xs text-muted-foreground/70">Click the star icon on any stock to add it</p>
            <Link href="/">
              <Button variant="outline" size="sm" className="mt-2">
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Back to Screener
              </Button>
            </Link>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5">Ticker</th>
                    <th className="text-right text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5">Price</th>
                    <th className="text-right text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5">Chg%</th>
                    <th className="text-center text-[10px] font-semibold uppercase tracking-wider px-2 py-2.5 hidden sm:table-cell">Mom</th>
                    <th className="text-center text-[10px] font-semibold uppercase tracking-wider px-2 py-2.5 hidden sm:table-cell">Qua</th>
                    <th className="text-center text-[10px] font-semibold uppercase tracking-wider px-2 py-2.5 hidden sm:table-cell">LVo</th>
                    <th className="text-center text-[10px] font-semibold uppercase tracking-wider px-2 py-2.5 hidden sm:table-cell">Val</th>
                    <th className="text-center text-[10px] font-semibold uppercase tracking-wider px-2 py-2.5 hidden sm:table-cell">ERM</th>
                    <th className="text-center text-[10px] font-semibold uppercase tracking-wider px-2 py-2.5 hidden sm:table-cell">Ins</th>
                    <th className="text-center text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5">Score</th>
                    <th className="w-8 px-2" />
                  </tr>
                </thead>
                <tbody>
                  {watchedStocks.map((stock) => {
                    const changeColor = stock.change1d >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400";
                    const compositeColor =
                      stock.composite >= 70 ? "text-emerald-600 dark:text-emerald-400" :
                      stock.composite >= 50 ? "text-foreground" :
                      "text-muted-foreground";

                    return (
                      <tr key={stock.ticker} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`watchlist-row-${stock.ticker}`}>
                        <td className="px-3 py-2.5">
                          <Link href={`/stock/${stock.ticker}`}>
                            <div className="cursor-pointer">
                              <span className="text-sm font-semibold tabular-nums text-primary hover:underline">{stock.ticker}</span>
                              <span className="text-[10px] text-muted-foreground block truncate max-w-[160px]">{stock.name}</span>
                            </div>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm tabular-nums font-medium">${stock.price.toLocaleString()}</td>
                        <td className={`px-3 py-2.5 text-right text-sm tabular-nums font-medium ${changeColor}`}>
                          {stock.change1d >= 0 ? "+" : ""}{stock.change1d}%
                        </td>
                        {(["momentum", "quality", "lowVol", "valuation", "erm", "insider"] as const).map((f) => (
                          <td key={f} className="px-2 py-2.5 hidden sm:table-cell">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[10px] tabular-nums font-medium">{stock[f]}</span>
                              <div className="w-10">
                                <ScoreBar score={stock[f]} />
                              </div>
                            </div>
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-sm tabular-nums font-bold ${compositeColor}`}>
                            {stock.composite}
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          <button
                            onClick={() => removeFromWatchlist.mutate(stock.ticker)}
                            className="text-amber-500 hover:text-amber-600 transition-colors"
                            data-testid={`remove-watchlist-${stock.ticker}`}
                          >
                            <Star className="w-3.5 h-3.5 fill-current" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>


    </div>
  );
}
