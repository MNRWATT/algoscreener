import type { StockScore, BacktestPoint, BacktestResult, BacktestHolding, HeatmapSector, HeatmapCell, PricePoint, PeerComparison, StockDetail, FactorWeights, PortfolioHolding, PortfolioSummary } from "@shared/schema";

// Deterministic pseudo-random number generator (seeded by ticker string)
function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h = (h * 16807 + 0) % 2147483647;
    return (h & 0x7fffffff) / 2147483647;
  };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// Round to n decimal places
function round(v: number, n: number = 2): number {
  const f = Math.pow(10, n);
  return Math.round(v * f) / f;
}

// ─── Stock Universe ───────────────────────────────────────────────

interface StockDef {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
}

const TSX_STOCKS: StockDef[] = [
  { ticker: "RY.TO", name: "Royal Bank of Canada", sector: "Financials", exchange: "TSX" },
  { ticker: "TD.TO", name: "Toronto-Dominion Bank", sector: "Financials", exchange: "TSX" },
  { ticker: "BNS.TO", name: "Bank of Nova Scotia", sector: "Financials", exchange: "TSX" },
  { ticker: "BMO.TO", name: "Bank of Montreal", sector: "Financials", exchange: "TSX" },
  { ticker: "CM.TO", name: "Canadian Imperial Bank", sector: "Financials", exchange: "TSX" },
  { ticker: "ENB.TO", name: "Enbridge Inc", sector: "Energy", exchange: "TSX" },
  { ticker: "CNR.TO", name: "Canadian National Railway", sector: "Industrials", exchange: "TSX" },
  { ticker: "CP.TO", name: "Canadian Pacific Kansas City", sector: "Industrials", exchange: "TSX" },
  { ticker: "SU.TO", name: "Suncor Energy", sector: "Energy", exchange: "TSX" },
  { ticker: "CNQ.TO", name: "Canadian Natural Resources", sector: "Energy", exchange: "TSX" },
  { ticker: "MFC.TO", name: "Manulife Financial", sector: "Financials", exchange: "TSX" },
  { ticker: "SLF.TO", name: "Sun Life Financial", sector: "Financials", exchange: "TSX" },
  { ticker: "TRP.TO", name: "TC Energy", sector: "Energy", exchange: "TSX" },
  { ticker: "ATD.TO", name: "Alimentation Couche-Tard", sector: "Consumer Staples", exchange: "TSX" },
  { ticker: "CSU.TO", name: "Constellation Software", sector: "Technology", exchange: "TSX" },
  { ticker: "SHOP.TO", name: "Shopify Inc", sector: "Technology", exchange: "TSX" },
  { ticker: "QSR.TO", name: "Restaurant Brands Intl", sector: "Consumer Discretionary", exchange: "TSX" },
  { ticker: "FTS.TO", name: "Fortis Inc", sector: "Utilities", exchange: "TSX" },
  { ticker: "T.TO", name: "Telus Corp", sector: "Communication Services", exchange: "TSX" },
  { ticker: "BCE.TO", name: "BCE Inc", sector: "Communication Services", exchange: "TSX" },
  { ticker: "GIB-A.TO", name: "CGI Inc", sector: "Technology", exchange: "TSX" },
  { ticker: "WCN.TO", name: "Waste Connections", sector: "Industrials", exchange: "TSX" },
  { ticker: "IFC.TO", name: "Intact Financial", sector: "Financials", exchange: "TSX" },
  { ticker: "L.TO", name: "Loblaw Companies", sector: "Consumer Staples", exchange: "TSX" },
  { ticker: "ABX.TO", name: "Barrick Gold", sector: "Materials", exchange: "TSX" },
  { ticker: "NTR.TO", name: "Nutrien Ltd", sector: "Materials", exchange: "TSX" },
  { ticker: "FM.TO", name: "First Quantum Minerals", sector: "Materials", exchange: "TSX" },
  { ticker: "WPM.TO", name: "Wheaton Precious Metals", sector: "Materials", exchange: "TSX" },
  { ticker: "DOL.TO", name: "Dollarama Inc", sector: "Consumer Discretionary", exchange: "TSX" },
  { ticker: "BAM.TO", name: "Brookfield Asset Mgmt", sector: "Financials", exchange: "TSX" },
  { ticker: "BN.TO", name: "Brookfield Corp", sector: "Financials", exchange: "TSX" },
  { ticker: "GWO.TO", name: "Great-West Lifeco", sector: "Financials", exchange: "TSX" },
  { ticker: "POW.TO", name: "Power Corporation", sector: "Financials", exchange: "TSX" },
  { ticker: "IMO.TO", name: "Imperial Oil", sector: "Energy", exchange: "TSX" },
  { ticker: "CCO.TO", name: "Cameco Corp", sector: "Energy", exchange: "TSX" },
  { ticker: "AEM.TO", name: "Agnico Eagle Mines", sector: "Materials", exchange: "TSX" },
  { ticker: "MG.TO", name: "Magna International", sector: "Consumer Discretionary", exchange: "TSX" },
  { ticker: "FFH.TO", name: "Fairfax Financial", sector: "Financials", exchange: "TSX" },
  { ticker: "TIH.TO", name: "Toromont Industries", sector: "Industrials", exchange: "TSX" },
  { ticker: "EMA.TO", name: "Emera Inc", sector: "Utilities", exchange: "TSX" },
  { ticker: "CAR-UN.TO", name: "Canadian Apartment Properties", sector: "Real Estate", exchange: "TSX" },
  { ticker: "GFL.TO", name: "GFL Environmental", sector: "Industrials", exchange: "TSX" },
  { ticker: "TFII.TO", name: "TFI International", sector: "Industrials", exchange: "TSX" },
  { ticker: "SAP.TO", name: "Saputo Inc", sector: "Consumer Staples", exchange: "TSX" },
  { ticker: "MRU.TO", name: "Metro Inc", sector: "Consumer Staples", exchange: "TSX" },
  { ticker: "OTEX.TO", name: "Open Text Corp", sector: "Technology", exchange: "TSX" },
  { ticker: "CCL-B.TO", name: "CCL Industries", sector: "Materials", exchange: "TSX" },
  { ticker: "DSG.TO", name: "Descartes Group", sector: "Technology", exchange: "TSX" },
  { ticker: "KXS.TO", name: "Kinaxis Inc", sector: "Technology", exchange: "TSX" },
  { ticker: "LSPD.TO", name: "Lightspeed Commerce", sector: "Technology", exchange: "TSX" },
  { ticker: "X.TO", name: "TMX Group", sector: "Financials", exchange: "TSX" },
  { ticker: "RBA.TO", name: "RB Global Inc", sector: "Industrials", exchange: "TSX" },
  { ticker: "STN.TO", name: "Stantec Inc", sector: "Industrials", exchange: "TSX" },
  { ticker: "TRI.TO", name: "Thomson Reuters", sector: "Technology", exchange: "TSX" },
  { ticker: "WSP.TO", name: "WSP Global", sector: "Industrials", exchange: "TSX" },
  { ticker: "CAE.TO", name: "CAE Inc", sector: "Industrials", exchange: "TSX" },
  { ticker: "CPX.TO", name: "Capital Power Corp", sector: "Utilities", exchange: "TSX" },
  { ticker: "PKI.TO", name: "Parkland Corp", sector: "Energy", exchange: "TSX" },
  { ticker: "EFN.TO", name: "Element Fleet Mgmt", sector: "Industrials", exchange: "TSX" },
  { ticker: "RCI-B.TO", name: "Rogers Communications", sector: "Communication Services", exchange: "TSX" },
];

const SP500_STOCKS: StockDef[] = [
  { ticker: "AAPL", name: "Apple Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "MSFT", name: "Microsoft Corp", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "AMZN", name: "Amazon.com Inc", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "NVDA", name: "NVIDIA Corp", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "GOOGL", name: "Alphabet Inc A", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "META", name: "Meta Platforms", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "BRK-B", name: "Berkshire Hathaway B", sector: "Financials", exchange: "NYSE" },
  { ticker: "TSLA", name: "Tesla Inc", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "UNH", name: "UnitedHealth Group", sector: "Health Care", exchange: "NYSE" },
  { ticker: "JNJ", name: "Johnson & Johnson", sector: "Health Care", exchange: "NYSE" },
  { ticker: "V", name: "Visa Inc", sector: "Financials", exchange: "NYSE" },
  { ticker: "XOM", name: "Exxon Mobil", sector: "Energy", exchange: "NYSE" },
  { ticker: "JPM", name: "JPMorgan Chase", sector: "Financials", exchange: "NYSE" },
  { ticker: "WMT", name: "Walmart Inc", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "MA", name: "Mastercard Inc", sector: "Financials", exchange: "NYSE" },
  { ticker: "PG", name: "Procter & Gamble", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "HD", name: "Home Depot", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "CVX", name: "Chevron Corp", sector: "Energy", exchange: "NYSE" },
  { ticker: "MRK", name: "Merck & Co", sector: "Health Care", exchange: "NYSE" },
  { ticker: "LLY", name: "Eli Lilly", sector: "Health Care", exchange: "NYSE" },
  { ticker: "ABBV", name: "AbbVie Inc", sector: "Health Care", exchange: "NYSE" },
  { ticker: "PEP", name: "PepsiCo Inc", sector: "Consumer Staples", exchange: "NASDAQ" },
  { ticker: "KO", name: "Coca-Cola Co", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "COST", name: "Costco Wholesale", sector: "Consumer Staples", exchange: "NASDAQ" },
  { ticker: "AVGO", name: "Broadcom Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "TMO", name: "Thermo Fisher Scientific", sector: "Health Care", exchange: "NYSE" },
  { ticker: "MCD", name: "McDonald's Corp", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "CSCO", name: "Cisco Systems", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "ACN", name: "Accenture plc", sector: "Technology", exchange: "NYSE" },
  { ticker: "ABT", name: "Abbott Laboratories", sector: "Health Care", exchange: "NYSE" },
  { ticker: "DHR", name: "Danaher Corp", sector: "Health Care", exchange: "NYSE" },
  { ticker: "CRM", name: "Salesforce Inc", sector: "Technology", exchange: "NYSE" },
  { ticker: "LIN", name: "Linde plc", sector: "Materials", exchange: "NYSE" },
  { ticker: "ORCL", name: "Oracle Corp", sector: "Technology", exchange: "NYSE" },
  { ticker: "AMD", name: "Advanced Micro Devices", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "NFLX", name: "Netflix Inc", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "NKE", name: "Nike Inc", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "TXN", name: "Texas Instruments", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "PM", name: "Philip Morris Intl", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "INTC", name: "Intel Corp", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "NEE", name: "NextEra Energy", sector: "Utilities", exchange: "NYSE" },
  { ticker: "QCOM", name: "QUALCOMM Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "HON", name: "Honeywell Intl", sector: "Industrials", exchange: "NASDAQ" },
  { ticker: "UNP", name: "Union Pacific", sector: "Industrials", exchange: "NYSE" },
  { ticker: "LOW", name: "Lowe's Companies", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "IBM", name: "IBM Corp", sector: "Technology", exchange: "NYSE" },
  { ticker: "AMGN", name: "Amgen Inc", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "SPGI", name: "S&P Global", sector: "Financials", exchange: "NYSE" },
  { ticker: "GE", name: "General Electric", sector: "Industrials", exchange: "NYSE" },
  { ticker: "CAT", name: "Caterpillar Inc", sector: "Industrials", exchange: "NYSE" },
  { ticker: "BA", name: "Boeing Co", sector: "Industrials", exchange: "NYSE" },
  { ticker: "DE", name: "Deere & Co", sector: "Industrials", exchange: "NYSE" },
  { ticker: "GS", name: "Goldman Sachs", sector: "Financials", exchange: "NYSE" },
  { ticker: "MS", name: "Morgan Stanley", sector: "Financials", exchange: "NYSE" },
  { ticker: "BLK", name: "BlackRock Inc", sector: "Financials", exchange: "NYSE" },
  { ticker: "AXP", name: "American Express", sector: "Financials", exchange: "NYSE" },
  { ticker: "ISRG", name: "Intuitive Surgical", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "MDT", name: "Medtronic plc", sector: "Health Care", exchange: "NYSE" },
  { ticker: "SYK", name: "Stryker Corp", sector: "Health Care", exchange: "NYSE" },
  { ticker: "GILD", name: "Gilead Sciences", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "REGN", name: "Regeneron Pharma", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "BKNG", name: "Booking Holdings", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "DIS", name: "Walt Disney Co", sector: "Communication Services", exchange: "NYSE" },
  { ticker: "CMCSA", name: "Comcast Corp", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "T", name: "AT&T Inc", sector: "Communication Services", exchange: "NYSE" },
  { ticker: "VZ", name: "Verizon Communications", sector: "Communication Services", exchange: "NYSE" },
  { ticker: "PFE", name: "Pfizer Inc", sector: "Health Care", exchange: "NYSE" },
  { ticker: "RTX", name: "RTX Corp", sector: "Industrials", exchange: "NYSE" },
  { ticker: "AMAT", name: "Applied Materials", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "LRCX", name: "Lam Research", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "MU", name: "Micron Technology", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "KLAC", name: "KLA Corp", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "NOW", name: "ServiceNow Inc", sector: "Technology", exchange: "NYSE" },
  { ticker: "PANW", name: "Palo Alto Networks", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "ADBE", name: "Adobe Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "INTU", name: "Intuit Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "SNOW", name: "Snowflake Inc", sector: "Technology", exchange: "NYSE" },
  { ticker: "SQ", name: "Block Inc", sector: "Financials", exchange: "NYSE" },
  { ticker: "PYPL", name: "PayPal Holdings", sector: "Financials", exchange: "NASDAQ" },
  { ticker: "COIN", name: "Coinbase Global", sector: "Financials", exchange: "NASDAQ" },
  { ticker: "UBER", name: "Uber Technologies", sector: "Industrials", exchange: "NYSE" },
  { ticker: "ABNB", name: "Airbnb Inc", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "SHOP", name: "Shopify Inc (US)", sector: "Technology", exchange: "NYSE" },
  { ticker: "ZM", name: "Zoom Video Comms", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "PLTR", name: "Palantir Technologies", sector: "Technology", exchange: "NYSE" },
  { ticker: "CRWD", name: "CrowdStrike Holdings", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "NET", name: "Cloudflare Inc", sector: "Technology", exchange: "NYSE" },
  { ticker: "DDOG", name: "Datadog Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "ZS", name: "Zscaler Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "WM", name: "Waste Management", sector: "Industrials", exchange: "NYSE" },
  { ticker: "RSG", name: "Republic Services", sector: "Industrials", exchange: "NYSE" },
  { ticker: "ETN", name: "Eaton Corp", sector: "Industrials", exchange: "NYSE" },
  { ticker: "EMR", name: "Emerson Electric", sector: "Industrials", exchange: "NYSE" },
  { ticker: "FDX", name: "FedEx Corp", sector: "Industrials", exchange: "NYSE" },
  { ticker: "MMM", name: "3M Company", sector: "Industrials", exchange: "NYSE" },
  { ticker: "CL", name: "Colgate-Palmolive", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "EL", name: "Estée Lauder", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "MDLZ", name: "Mondelez International", sector: "Consumer Staples", exchange: "NASDAQ" },
  { ticker: "GIS", name: "General Mills", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "SJM", name: "J.M. Smucker Co", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "SO", name: "Southern Company", sector: "Utilities", exchange: "NYSE" },
  { ticker: "DUK", name: "Duke Energy", sector: "Utilities", exchange: "NYSE" },
  { ticker: "AEP", name: "American Electric Power", sector: "Utilities", exchange: "NASDAQ" },
  { ticker: "D", name: "Dominion Energy", sector: "Utilities", exchange: "NYSE" },
  { ticker: "AMT", name: "American Tower Corp", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "PLD", name: "Prologis Inc", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "CCI", name: "Crown Castle Intl", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "EQIX", name: "Equinix Inc", sector: "Real Estate", exchange: "NASDAQ" },
  { ticker: "O", name: "Realty Income Corp", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "FCX", name: "Freeport-McMoRan", sector: "Materials", exchange: "NYSE" },
  { ticker: "NEM", name: "Newmont Corp", sector: "Materials", exchange: "NYSE" },
  { ticker: "APD", name: "Air Products & Chem", sector: "Materials", exchange: "NYSE" },
  { ticker: "ECL", name: "Ecolab Inc", sector: "Materials", exchange: "NYSE" },
  { ticker: "SHW", name: "Sherwin-Williams", sector: "Materials", exchange: "NYSE" },
  { ticker: "MCK", name: "McKesson Corp", sector: "Health Care", exchange: "NYSE" },
  { ticker: "CI", name: "The Cigna Group", sector: "Health Care", exchange: "NYSE" },
  { ticker: "ELV", name: "Elevance Health", sector: "Health Care", exchange: "NYSE" },
  { ticker: "HUM", name: "Humana Inc", sector: "Health Care", exchange: "NYSE" },
  { ticker: "CVS", name: "CVS Health Corp", sector: "Health Care", exchange: "NYSE" },
  { ticker: "ICE", name: "Intercontinental Exchange", sector: "Financials", exchange: "NYSE" },
  { ticker: "CME", name: "CME Group", sector: "Financials", exchange: "NASDAQ" },
  { ticker: "SCHW", name: "Charles Schwab", sector: "Financials", exchange: "NYSE" },
  { ticker: "CB", name: "Chubb Limited", sector: "Financials", exchange: "NYSE" },
  { ticker: "AON", name: "Aon plc", sector: "Financials", exchange: "NYSE" },
  { ticker: "PGR", name: "Progressive Corp", sector: "Financials", exchange: "NYSE" },
  { ticker: "TRV", name: "Travelers Companies", sector: "Financials", exchange: "NYSE" },
  { ticker: "AIG", name: "American Intl Group", sector: "Financials", exchange: "NYSE" },
  { ticker: "C", name: "Citigroup Inc", sector: "Financials", exchange: "NYSE" },
  { ticker: "BAC", name: "Bank of America", sector: "Financials", exchange: "NYSE" },
  { ticker: "WFC", name: "Wells Fargo & Co", sector: "Financials", exchange: "NYSE" },
  { ticker: "USB", name: "U.S. Bancorp", sector: "Financials", exchange: "NYSE" },
  { ticker: "PNC", name: "PNC Financial Services", sector: "Financials", exchange: "NYSE" },
  { ticker: "SBUX", name: "Starbucks Corp", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "TJX", name: "TJX Companies", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "ROST", name: "Ross Stores", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "ORLY", name: "O'Reilly Automotive", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "AZO", name: "AutoZone Inc", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "GM", name: "General Motors", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "F", name: "Ford Motor Co", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "LMT", name: "Lockheed Martin", sector: "Industrials", exchange: "NYSE" },
  { ticker: "NOC", name: "Northrop Grumman", sector: "Industrials", exchange: "NYSE" },
  { ticker: "GD", name: "General Dynamics", sector: "Industrials", exchange: "NYSE" },
];

const ALL_STOCKS: StockDef[] = [...TSX_STOCKS, ...SP500_STOCKS];

// ─── Factor scoring with realistic distributions ────────────────

// Sector risk profiles affect factor distributions
const SECTOR_PROFILES: Record<string, { betaBase: number; qualityBias: number; volBias: number; valueBias: number }> = {
  "Technology": { betaBase: 1.25, qualityBias: 10, volBias: -15, valueBias: -10 },
  "Financials": { betaBase: 1.1, qualityBias: 5, volBias: 5, valueBias: 10 },
  "Health Care": { betaBase: 0.95, qualityBias: 15, volBias: 10, valueBias: -5 },
  "Consumer Staples": { betaBase: 0.65, qualityBias: 10, volBias: 25, valueBias: 5 },
  "Energy": { betaBase: 1.3, qualityBias: -5, volBias: -20, valueBias: 15 },
  "Industrials": { betaBase: 1.05, qualityBias: 5, volBias: 5, valueBias: 0 },
  "Consumer Discretionary": { betaBase: 1.15, qualityBias: 0, volBias: -5, valueBias: -5 },
  "Materials": { betaBase: 1.2, qualityBias: -5, volBias: -10, valueBias: 10 },
  "Utilities": { betaBase: 0.55, qualityBias: 5, volBias: 30, valueBias: 15 },
  "Communication Services": { betaBase: 0.9, qualityBias: 5, volBias: 10, valueBias: 5 },
  "Real Estate": { betaBase: 0.8, qualityBias: 0, volBias: 15, valueBias: 10 },
};

function generateStockScore(def: StockDef): StockScore {
  const rng = seededRandom(def.ticker);
  const profile = SECTOR_PROFILES[def.sector] || { betaBase: 1.0, qualityBias: 0, volBias: 0, valueBias: 0 };

  // Price generation (realistic ranges)
  const priceBase = def.exchange === "TSX" ? 40 + rng() * 160 : 50 + rng() * 450;
  const price = round(priceBase);
  const change1d = round((rng() - 0.48) * 6, 2); // Slight positive bias

  // Market cap (billions)
  const mcBase = def.exchange === "TSX" ? 5 + rng() * 80 : 10 + rng() * 800;
  const marketCap = round(mcBase, 1);

  // ─── Raw metrics ───
  const return12m = round((rng() - 0.3) * 80); // -24% to +56%
  const return6m = round((rng() - 0.35) * 50); // -17% to +32%
  const return3m = round((rng() - 0.4) * 30); // -12% to +18%

  const roe = round(5 + rng() * 35 + profile.qualityBias * 0.3);
  const profitMargin = round(3 + rng() * 35 + profile.qualityBias * 0.4);
  const debtToEquity = round(0.1 + rng() * 2.5 - profile.qualityBias * 0.02);

  const beta = round(profile.betaBase + (rng() - 0.5) * 0.6, 2);
  const volatility52w = round(15 + rng() * 40 - profile.volBias * 0.3);

  const pe = round(8 + rng() * 45 - profile.valueBias * 0.3);
  const pb = round(0.8 + rng() * 12 - profile.valueBias * 0.1);
  const dividendYield = round(Math.max(0, rng() * 5 + profile.valueBias * 0.05), 2);

  const epsGrowth = round((rng() - 0.3) * 60);
  const revenueGrowth = round((rng() - 0.25) * 40);

  const insiderOwnership = round(rng() * 15, 1);
  const institutionalOwnership = round(40 + rng() * 55, 1);

  // ─── Factor scores (0-100) ───

  // Momentum: weighted combination of returns
  const momRaw = return12m * 0.5 + return6m * 0.3 + return3m * 0.2;
  const momentum = clamp(Math.round(50 + momRaw * 1.2), 0, 100);

  // Quality: ROE + margin + debt health
  const qualRaw = (roe / 40) * 40 + (profitMargin / 35) * 30 + ((2.5 - debtToEquity) / 2.5) * 30;
  const quality = clamp(Math.round(qualRaw + profile.qualityBias), 0, 100);

  // Low Volatility: inverse beta + low vol
  const lvRaw = ((2 - beta) / 2) * 50 + ((60 - volatility52w) / 60) * 50;
  const lowVol = clamp(Math.round(lvRaw + profile.volBias), 0, 100);

  // Valuation: inverse PE + inverse PB + yield
  const valRaw = ((50 - pe) / 50) * 35 + ((12 - pb) / 12) * 35 + (dividendYield / 5) * 30;
  const valuation = clamp(Math.round(50 + valRaw + profile.valueBias), 0, 100);

  // ERM: earnings + revenue growth
  const ermRaw = (epsGrowth / 60) * 50 + (revenueGrowth / 40) * 50;
  const erm = clamp(Math.round(50 + ermRaw * 0.8), 0, 100);

  // Insider: ownership levels
  const insRaw = (insiderOwnership / 15) * 60 + (institutionalOwnership / 95) * 40;
  const insider = clamp(Math.round(insRaw), 0, 100);

  return {
    ticker: def.ticker,
    name: def.name,
    sector: def.sector,
    exchange: def.exchange,
    price,
    change1d,
    marketCap,
    momentum,
    quality,
    lowVol,
    valuation,
    erm,
    insider,
    composite: 0, // computed with weights
    metrics: {
      return12m, return6m, return3m,
      roe, profitMargin, debtToEquity,
      beta, volatility52w,
      pe, pb, dividendYield,
      epsGrowth, revenueGrowth,
      insiderOwnership, institutionalOwnership,
    },
  };
}

// Pre-generate all stock data
let cachedStocks: StockScore[] | null = null;

export function getAllStocks(): StockScore[] {
  if (!cachedStocks) {
    cachedStocks = ALL_STOCKS.map(generateStockScore);
  }
  return cachedStocks;
}

export function computeComposite(
  stock: StockScore,
  weights: { momentum: number; quality: number; lowVol: number; valuation: number; erm: number; insider: number }
): number {
  const total = weights.momentum + weights.quality + weights.lowVol + weights.valuation + weights.erm + weights.insider;
  if (total === 0) return 0;
  const score =
    (stock.momentum * weights.momentum +
      stock.quality * weights.quality +
      stock.lowVol * weights.lowVol +
      stock.valuation * weights.valuation +
      stock.erm * weights.erm +
      stock.insider * weights.insider) / total;
  return Math.round(score * 10) / 10;
}

export function getScreenedStocks(weights: {
  momentum: number;
  quality: number;
  lowVol: number;
  valuation: number;
  erm: number;
  insider: number;
}): StockScore[] {
  const stocks = getAllStocks().map((s) => ({
    ...s,
    composite: computeComposite(s, weights),
  }));
  stocks.sort((a, b) => b.composite - a.composite);
  return stocks;
}

export const SECTORS = [
  "Technology",
  "Financials",
  "Health Care",
  "Consumer Staples",
  "Energy",
  "Industrials",
  "Consumer Discretionary",
  "Materials",
  "Utilities",
  "Communication Services",
  "Real Estate",
];

export const EXCHANGES = ["TSX", "NYSE", "NASDAQ"];

// ─── Price History Generator (deterministic) ────────────────────

export function generatePriceHistory(ticker: string, months: number = 24): PricePoint[] {
  const rng = seededRandom(ticker + "-price-history");
  const points: PricePoint[] = [];
  const baseStock = getAllStocks().find((s) => s.ticker === ticker);
  const currentPrice = baseStock?.price ?? 100;

  // Work backwards from current price
  const now = new Date();
  let price = currentPrice;
  const monthlyPrices: { date: Date; price: number }[] = [{ date: now, price }];

  for (let i = 1; i <= months; i++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    // Monthly return between -8% and +10%
    const monthlyReturn = (rng() - 0.45) * 0.18;
    price = price / (1 + monthlyReturn);
    monthlyPrices.unshift({ date: d, price: round(price, 2) });
  }

  for (const mp of monthlyPrices) {
    points.push({
      date: mp.date.toISOString().slice(0, 10),
      price: mp.price,
    });
  }

  return points;
}

// ─── Peer Comparison ────────────────────────────────────────────

export function getPeers(ticker: string, weights: FactorWeights): PeerComparison[] {
  const stock = getAllStocks().find((s) => s.ticker === ticker);
  if (!stock) return [];

  const sectorStocks = getAllStocks()
    .filter((s) => s.sector === stock.sector && s.ticker !== ticker)
    .map((s) => ({
      ...s,
      composite: computeComposite(s, weights),
    }))
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 5);

  return sectorStocks.map((s) => ({
    ticker: s.ticker,
    name: s.name,
    composite: s.composite,
    momentum: s.momentum,
    quality: s.quality,
    lowVol: s.lowVol,
    valuation: s.valuation,
    erm: s.erm,
    insider: s.insider,
  }));
}

// ─── Stock Detail ───────────────────────────────────────────────

const STOCK_DESCRIPTIONS: Record<string, string> = {
  "AAPL": "Consumer electronics, software, and services. Known for iPhone, Mac, iPad, and Services ecosystem.",
  "MSFT": "Enterprise software, cloud computing (Azure), gaming (Xbox), and productivity tools (Office 365).",
  "NVDA": "GPU and AI chip leader. Dominates data center AI training and inference market.",
  "TSLA": "Electric vehicles, energy storage, and solar. Pioneer in autonomous driving technology.",
  "AMZN": "E-commerce, cloud computing (AWS), digital advertising, and streaming (Prime Video).",
  "GOOGL": "Search, digital advertising, cloud (GCP), Android OS, and Waymo autonomous vehicles.",
  "META": "Social media (Facebook, Instagram, WhatsApp), digital advertising, and metaverse (Reality Labs).",
  "RY.TO": "Canada's largest bank by market cap. Full-service banking, wealth management, and capital markets.",
  "TD.TO": "Major Canadian bank with significant US presence. Retail and commercial banking across North America.",
  "SHOP.TO": "E-commerce platform enabling merchants worldwide. SaaS-based with payments, shipping, and fulfillment.",
  "ENB.TO": "Largest energy infrastructure company in North America. Pipelines, gas distribution, and renewables.",
};

export function getStockDetail(ticker: string, weights: FactorWeights): StockDetail | null {
  const stock = getAllStocks().find((s) => s.ticker === ticker);
  if (!stock) return null;

  const withComposite = {
    ...stock,
    composite: computeComposite(stock, weights),
  };

  return {
    ...withComposite,
    priceHistory: generatePriceHistory(ticker, 24),
    peers: getPeers(ticker, weights),
    description: STOCK_DESCRIPTIONS[ticker] || `${stock.name} operates in the ${stock.sector} sector, listed on ${stock.exchange}.`,
  };
}

// ─── Backtesting Engine (Stock-Level Portfolio Construction) ────

const TOP_N = 25; // Select top 25 stocks by composite score

/**
 * Build a score-weighted portfolio from the top N stocks.
 * Weight = stock's composite score / sum of all top-N composite scores.
 */
function buildPortfolioWeights(weights: FactorWeights): { ticker: string; name: string; sector: string; exchange: string; composite: number; weight: number }[] {
  const scored = getScreenedStocks(weights).slice(0, TOP_N);
  const totalScore = scored.reduce((s, st) => s + st.composite, 0);
  return scored.map((st) => ({
    ticker: st.ticker,
    name: st.name,
    sector: st.sector,
    exchange: st.exchange,
    composite: st.composite,
    weight: totalScore > 0 ? round((st.composite / totalScore) * 100, 2) : round(100 / TOP_N, 2),
  }));
}

export function runBacktest(weights: FactorWeights, period: "1y" | "3y" | "5y"): BacktestResult {
  const months = period === "1y" ? 12 : period === "3y" ? 36 : 60;

  // Build portfolio: top 25 stocks weighted by composite score
  const portfolio = buildPortfolioWeights(weights);

  // Generate per-stock monthly price series for the period
  const stockPrices: Map<string, number[]> = new Map();
  for (const h of portfolio) {
    const priceHistory = generatePriceHistory(h.ticker, months);
    stockPrices.set(h.ticker, priceHistory.map((p) => p.price));
  }

  // Generate benchmark (S&P 500) series
  const benchmarkRng = seededRandom("SP500-benchmark-" + period);
  const benchmarkPrices: number[] = [10000];
  for (let i = 1; i <= months; i++) {
    const monthlyReturn = 0.008 + (benchmarkRng() - 0.5) * 0.08;
    benchmarkPrices.push(round(benchmarkPrices[i - 1] * (1 + monthlyReturn), 2));
  }

  // Calculate portfolio value month by month using weighted stock returns
  const points: BacktestPoint[] = [];
  const now = new Date();
  let portfolioValue = 10000;
  let maxPortfolio = portfolioValue;
  let maxDrawdown = 0;

  // Track per-stock cumulative return for contribution calculation
  const stockCumulativeReturn: Map<string, number> = new Map();
  for (const h of portfolio) {
    stockCumulativeReturn.set(h.ticker, 0);
  }

  for (let i = 0; i <= months; i++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (months - i));

    if (i === 0) {
      points.push({ month: d.toISOString().slice(0, 7), portfolioValue: 10000, benchmarkValue: 10000 });
      continue;
    }

    // Weighted portfolio return for this month
    let weightedReturn = 0;
    for (const h of portfolio) {
      const prices = stockPrices.get(h.ticker)!;
      const prevPrice = prices[i - 1];
      const curPrice = prices[i];
      const stockReturn = prevPrice > 0 ? (curPrice - prevPrice) / prevPrice : 0;
      weightedReturn += (h.weight / 100) * stockReturn;
    }

    portfolioValue = round(portfolioValue * (1 + weightedReturn), 2);
    maxPortfolio = Math.max(maxPortfolio, portfolioValue);
    const dd = (maxPortfolio - portfolioValue) / maxPortfolio;
    maxDrawdown = Math.max(maxDrawdown, dd);

    points.push({
      month: d.toISOString().slice(0, 7),
      portfolioValue,
      benchmarkValue: benchmarkPrices[i],
    });
  }

  // Per-stock total return over entire period
  const holdings: BacktestHolding[] = portfolio.map((h) => {
    const prices = stockPrices.get(h.ticker)!;
    const startPrice = prices[0];
    const endPrice = prices[prices.length - 1];
    const totalStockReturn = startPrice > 0 ? round(((endPrice - startPrice) / startPrice) * 100, 2) : 0;
    const returnContribution = round((h.weight / 100) * totalStockReturn, 2);
    return {
      ticker: h.ticker,
      name: h.name,
      sector: h.sector,
      exchange: h.exchange,
      weight: h.weight,
      compositeScore: h.composite,
      returnContribution,
      totalReturn: totalStockReturn,
    };
  });

  // Sort holdings by weight descending
  holdings.sort((a, b) => b.weight - a.weight);

  // Aggregate metrics
  const totalReturn = round(((portfolioValue - 10000) / 10000) * 100, 2);
  const benchFinal = benchmarkPrices[benchmarkPrices.length - 1];
  const benchmarkReturn = round(((benchFinal - 10000) / 10000) * 100, 2);
  const years = months / 12;
  const annualizedReturn = round((Math.pow(portfolioValue / 10000, 1 / years) - 1) * 100, 2);
  const benchmarkAnnualized = round((Math.pow(benchFinal / 10000, 1 / years) - 1) * 100, 2);

  const monthlyReturns = points.slice(1).map((p, i) =>
    (p.portfolioValue - points[i].portfolioValue) / points[i].portfolioValue
  );
  const avgMonthly = monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length;
  const stdMonthly = Math.sqrt(
    monthlyReturns.reduce((a, b) => a + (b - avgMonthly) ** 2, 0) / monthlyReturns.length
  );
  const sharpe = stdMonthly > 0 ? round((avgMonthly * 12 - 0.04) / (stdMonthly * Math.sqrt(12)), 2) : 0;

  // Sector & exchange breakdown
  const sectorMap = new Map<string, number>();
  const exchangeMap = new Map<string, number>();
  for (const h of holdings) {
    sectorMap.set(h.sector, (sectorMap.get(h.sector) || 0) + h.weight);
    exchangeMap.set(h.exchange, (exchangeMap.get(h.exchange) || 0) + h.weight);
  }
  const sectorBreakdown = Array.from(sectorMap).map(([sector, weight]) => ({ sector, weight: round(weight, 1) })).sort((a, b) => b.weight - a.weight);
  const exchangeBreakdown = Array.from(exchangeMap).map(([exchange, weight]) => ({ exchange, weight: round(weight, 1) })).sort((a, b) => b.weight - a.weight);

  return {
    period,
    weights,
    points,
    totalReturn,
    benchmarkReturn,
    annualizedReturn,
    benchmarkAnnualized,
    maxDrawdown: round(maxDrawdown * 100, 2),
    sharpeRatio: sharpe,
    alpha: round(annualizedReturn - benchmarkAnnualized, 2),
    holdings,
    holdingCount: TOP_N,
    weightingMethod: "score-weighted",
    rebalanceFrequency: "monthly",
    sectorBreakdown,
    exchangeBreakdown,
  };
}

// ─── Portfolio Builder ──────────────────────────────────────────

export function buildPortfolio(weights: FactorWeights): PortfolioSummary {
  const scored = getScreenedStocks(weights).slice(0, TOP_N);
  const totalScore = scored.reduce((s, st) => s + st.composite, 0);
  const portfolioValue = 10000; // Notional $10k portfolio

  const holdings: PortfolioHolding[] = scored.map((st) => {
    const weight = totalScore > 0 ? round((st.composite / totalScore) * 100, 2) : round(100 / TOP_N, 2);
    const marketValue = round(portfolioValue * (weight / 100), 2);
    const shares = round(marketValue / st.price, 4);
    return {
      ticker: st.ticker,
      name: st.name,
      sector: st.sector,
      exchange: st.exchange,
      price: st.price,
      change1d: st.change1d,
      compositeScore: st.composite,
      weight,
      shares,
      marketValue,
      momentum: st.momentum,
      quality: st.quality,
      lowVol: st.lowVol,
      valuation: st.valuation,
      erm: st.erm,
      insider: st.insider,
    };
  });

  // Portfolio-level aggregated metrics
  const avgComposite = round(holdings.reduce((s, h) => s + h.compositeScore, 0) / holdings.length, 1);
  const weightedBeta = round(
    holdings.reduce((s, h) => {
      const stock = getAllStocks().find((st) => st.ticker === h.ticker);
      return s + (h.weight / 100) * (stock?.metrics.beta ?? 1);
    }, 0),
    2
  );
  const weightedDividendYield = round(
    holdings.reduce((s, h) => {
      const stock = getAllStocks().find((st) => st.ticker === h.ticker);
      return s + (h.weight / 100) * (stock?.metrics.dividendYield ?? 0);
    }, 0),
    2
  );
  const weightedPE = round(
    holdings.reduce((s, h) => {
      const stock = getAllStocks().find((st) => st.ticker === h.ticker);
      return s + (h.weight / 100) * (stock?.metrics.pe ?? 20);
    }, 0),
    1
  );

  // Sector breakdown
  const sectorAgg = new Map<string, { weight: number; count: number }>();
  for (const h of holdings) {
    const existing = sectorAgg.get(h.sector) || { weight: 0, count: 0 };
    existing.weight += h.weight;
    existing.count += 1;
    sectorAgg.set(h.sector, existing);
  }
  const sectorBreakdown = Array.from(sectorAgg).map(([sector, v]) => ({
    sector, weight: round(v.weight, 1), count: v.count,
  })).sort((a, b) => b.weight - a.weight);

  // Exchange breakdown
  const exchAgg = new Map<string, { weight: number; count: number }>();
  for (const h of holdings) {
    const existing = exchAgg.get(h.exchange) || { weight: 0, count: 0 };
    existing.weight += h.weight;
    existing.count += 1;
    exchAgg.set(h.exchange, existing);
  }
  const exchangeBreakdown = Array.from(exchAgg).map(([exchange, v]) => ({
    exchange, weight: round(v.weight, 1), count: v.count,
  })).sort((a, b) => b.weight - a.weight);

  const sortedByWeight = [...holdings].sort((a, b) => b.weight - a.weight);
  const topHolding = { ticker: sortedByWeight[0].ticker, weight: sortedByWeight[0].weight };
  const top5Weight = round(sortedByWeight.slice(0, 5).reduce((s, h) => s + h.weight, 0), 1);

  return {
    holdings,
    totalValue: portfolioValue,
    holdingCount: TOP_N,
    weightingMethod: "score-weighted",
    avgComposite,
    weightedBeta,
    weightedDividendYield,
    weightedPE,
    sectorBreakdown,
    exchangeBreakdown,
    topHolding,
    top5Weight,
  };
}

// ─── Sector Heatmap ─────────────────────────────────────────────

export function getSectorHeatmap(weights: FactorWeights): HeatmapSector[] {
  const stocks = getScreenedStocks(weights);

  const sectorMap = new Map<string, HeatmapCell[]>();

  for (const s of stocks) {
    const cell: HeatmapCell = {
      ticker: s.ticker,
      name: s.name,
      sector: s.sector,
      composite: s.composite,
      change1d: s.change1d,
      marketCap: s.marketCap,
    };
    if (!sectorMap.has(s.sector)) sectorMap.set(s.sector, []);
    sectorMap.get(s.sector)!.push(cell);
  }

  const result: HeatmapSector[] = [];
  for (const [sector, cells] of sectorMap) {
    // Sort by market cap (largest first for visual weight)
    cells.sort((a, b) => b.marketCap - a.marketCap);
    const avgComposite = round(cells.reduce((a, c) => a + c.composite, 0) / cells.length, 1);
    result.push({ sector, stocks: cells, avgComposite });
  }

  // Sort sectors by average composite
  result.sort((a, b) => b.avgComposite - a.avgComposite);
  return result;
}
