import express from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { prewarmCache, prewarmHistoryCache } from "./marketData";
import { buildScoresFromMeta } from "./fundamentalsCache";
import { getAllStocks } from "./stockData";
import path from "path";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve static frontend in production
if (process.env.NODE_ENV === "production") {
  const distPublic = path.join(__dirname, "../dist/public");
  app.use(express.static(distPublic));
  app.get("*", (_req: any, res: any) => {
    res.sendFile(path.join(distPublic, "index.html"));
  });
}

const httpServer = createServer(app);

// Boot sequence — all async work inside a single IIFE (CJS compatible)
(async () => {
  try {
    await registerRoutes(httpServer, app);

    const PORT = parseInt(process.env.PORT || "5000", 10);
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`[express] serving on port ${PORT}`);
    });

    // 1. Finnhub quote prewarm (non-blocking, top 50 tickers)
    prewarmCache();

    // 2. Yahoo v8 chart prewarm — fetches price history AND stores chart meta
    console.log("[boot] Starting Yahoo price history + chart meta prewarm...");
    await prewarmHistoryCache();

    // 3. Build factor scores from chart meta + Finnhub growth metrics
    console.log("[boot] Building fundamentals scores from chart meta...");
    const tickers = getAllStocks().map((s) => s.ticker);
    await buildScoresFromMeta(tickers);

    console.log("[boot] All data ready.");
  } catch (err) {
    console.warn("[boot] Non-fatal startup error:", err);
  }
})();
