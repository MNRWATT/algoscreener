import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import ScreenerPage from "@/pages/screener";
import StockDetailPage from "@/pages/stock-detail";
import WatchlistPage from "@/pages/watchlist";
import HeatmapPage from "@/pages/heatmap";
import BacktestPage from "@/pages/backtest";
import PortfolioPage from "@/pages/portfolio";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={ScreenerPage} />
      <Route path="/stock/:ticker" component={StockDetailPage} />
      <Route path="/watchlist" component={WatchlistPage} />
      <Route path="/heatmap" component={HeatmapPage} />
      <Route path="/backtest" component={BacktestPage} />
      <Route path="/portfolio" component={PortfolioPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
