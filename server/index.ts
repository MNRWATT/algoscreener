import express from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { prewarmCache, prewarmHistoryCache } from "./marketData";
import { buildScoresFromMeta } from "./fundamentalsCache";
import { getAllStocks } from "./stockData";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve static frontend in production
if (process.env.NODE_ENV === "production") {
  const path = await import("path");
  const { fileURLToPath } = await import("url");
  const __dirname = path.default.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.default.join(__dirname, "../dist/public")));
  app.get("*", (_req: any, res: any) => {
    res.sendFile(path.default.join(__dirname, "../dist/public/index.html"));
  });
}

const httpServer = createServer(app);
await registerRoutes(httpServer, app);

const PORT = parseInt(process.env.PORT || "5000", 10);
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[express] serving on port ${PORT}`);
});

// Boot sequence:
// 1. Finnhub quote prewarm (top 50 tickers, fast)
// 2. Yahoo v8 chart prewarm — fetches price history AND stores chart meta
// 3. Build factor scores from chart meta + Finnhub growth metrics

(async () => {
  try {
    prewarmCache(); // non-blocking, Finnhub quotes

    console.log("[boot] Starting Yahoo price history + chart meta prewarm...");
    await prewarmHistoryCache(); // blocking — we need meta before scoring

    console.log("[boot] Building fundamentals scores from chart meta...");
    const tickers = getAllStocks().map((s) => s.ticker);
    await buildScoresFromMeta(tickers);

    console.log("[boot] All data ready.");
  } catch (err) {
    console.warn("[boot] Non-fatal startup error:", err);
  }
})();
