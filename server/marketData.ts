import yahooFinance from "yahoo-finance2";
export async function getLiveQuote(ticker: string) {
const quote = await yahooFinance.quote(ticker);
return {
price: quote.regularMarketPrice,
change: quote.regularMarketChange,
changePercent: quote.regularMarketChangePercent,
volume: quote.regularMarketVolume,
marketCap: quote.marketCap,
name: quote.shortName || quote.longName,
};
}
export async function getLiveQuotes(tickers: string[]) {
// Fetch in batches of 20 to avoid rate limits
const results = [];
for (let i = 0; i < tickers.length; i += 20) {
const batch = tickers.slice(i, i + 20);
const quotes = await Promise.all(
batch.map(t => getLiveQuote(t).catch(() => null))
);
results.push(...quotes);
}
return results;
}