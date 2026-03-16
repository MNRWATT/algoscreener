import type { StockScore, BacktestPoint, BacktestResult, BacktestHolding, HeatmapSector, HeatmapCell, PricePoint, PeerComparison, StockDetail, FactorWeights, PortfolioHolding, PortfolioSummary } from "@shared/schema";
import { getFundamentals, getCacheStatus } from "./fundamentalsCache";
import { getHistoryMetrics, registerStockCacheInvalidator } from "./marketData";

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

const ALL_STOCKS: StockDef[] = [
  // Technology
  { ticker: "AAPL", name: "Apple Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "MSFT", name: "Microsoft Corp", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "NVDA", name: "NVIDIA Corp", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "AVGO", name: "Broadcom Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "ORCL", name: "Oracle Corp", sector: "Technology", exchange: "NYSE" },
  { ticker: "AMD", name: "Advanced Micro Devices", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "CSCO", name: "Cisco Systems", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "ACN", name: "Accenture plc", sector: "Technology", exchange: "NYSE" },
  { ticker: "IBM", name: "IBM Corp", sector: "Technology", exchange: "NYSE" },
  { ticker: "TXN", name: "Texas Instruments", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "INTC", name: "Intel Corp", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "QCOM", name: "QUALCOMM Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "NOW", name: "ServiceNow Inc", sector: "Technology", exchange: "NYSE" },
  { ticker: "AMAT", name: "Applied Materials", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "LRCX", name: "Lam Research", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "MU", name: "Micron Technology", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "KLAC", name: "KLA Corp", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "PANW", name: "Palo Alto Networks", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "ADBE", name: "Adobe Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "INTU", name: "Intuit Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "CRM", name: "Salesforce Inc", sector: "Technology", exchange: "NYSE" },
  { ticker: "SNOW", name: "Snowflake Inc", sector: "Technology", exchange: "NYSE" },
  { ticker: "CRWD", name: "CrowdStrike Holdings", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "NET", name: "Cloudflare Inc", sector: "Technology", exchange: "NYSE" },
  { ticker: "DDOG", name: "Datadog Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "ZS", name: "Zscaler Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "PLTR", name: "Palantir Technologies", sector: "Technology", exchange: "NYSE" },
  { ticker: "SHOP", name: "Shopify Inc", sector: "Technology", exchange: "NYSE" },
  { ticker: "ZM", name: "Zoom Video Comms", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "HPQ", name: "HP Inc", sector: "Technology", exchange: "NYSE" },
  { ticker: "HPE", name: "Hewlett Packard Enterprise", sector: "Technology", exchange: "NYSE" },
  { ticker: "DELL", name: "Dell Technologies", sector: "Technology", exchange: "NYSE" },
  { ticker: "STX", name: "Seagate Technology", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "WDC", name: "Western Digital", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "NTAP", name: "NetApp Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "CDNS", name: "Cadence Design Systems", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "SNPS", name: "Synopsys Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "ANSS", name: "ANSYS Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "FTNT", name: "Fortinet Inc", sector: "Technology", exchange: "NASDAQ" },
  { ticker: "OKTA", name: "Okta Inc", sector: "Technology", exchange: "NASDAQ" },
  // Communication Services
  { ticker: "GOOGL", name: "Alphabet Inc A", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "META", name: "Meta Platforms", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "NFLX", name: "Netflix Inc", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "DIS", name: "Walt Disney Co", sector: "Communication Services", exchange: "NYSE" },
  { ticker: "CMCSA", name: "Comcast Corp", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "T", name: "AT&T Inc", sector: "Communication Services", exchange: "NYSE" },
  { ticker: "VZ", name: "Verizon Communications", sector: "Communication Services", exchange: "NYSE" },
  { ticker: "TMUS", name: "T-Mobile US", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "CHTR", name: "Charter Communications", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "PSKY", name: "Paramount Skydance Corp", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "WBD", name: "Warner Bros Discovery", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "EA", name: "Electronic Arts", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "TTWO", name: "Take-Two Interactive", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "MTCH", name: "Match Group", sector: "Communication Services", exchange: "NASDAQ" },
  { ticker: "PINS", name: "Pinterest Inc", sector: "Communication Services", exchange: "NYSE" },
  { ticker: "SNAP", name: "Snap Inc", sector: "Communication Services", exchange: "NYSE" },
  // Consumer Discretionary
  { ticker: "AMZN", name: "Amazon.com Inc", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "TSLA", name: "Tesla Inc", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "HD", name: "Home Depot", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "MCD", name: "McDonald's Corp", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "NKE", name: "Nike Inc", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "LOW", name: "Lowe's Companies", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "SBUX", name: "Starbucks Corp", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "TJX", name: "TJX Companies", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "ROST", name: "Ross Stores", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "BKNG", name: "Booking Holdings", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "ORLY", name: "O'Reilly Automotive", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "AZO", name: "AutoZone Inc", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "GM", name: "General Motors", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "F", name: "Ford Motor Co", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "ABNB", name: "Airbnb Inc", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "UBER", name: "Uber Technologies", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "LYFT", name: "Lyft Inc", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "DPZ", name: "Domino's Pizza", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "YUM", name: "Yum! Brands", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "CMG", name: "Chipotle Mexican Grill", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "HLT", name: "Hilton Worldwide", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "MAR", name: "Marriott International", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "RCL", name: "Royal Caribbean Group", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "CCL", name: "Carnival Corp", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "EXPE", name: "Expedia Group", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "LVS", name: "Las Vegas Sands", sector: "Consumer Discretionary", exchange: "NYSE" },
  { ticker: "WYNN", name: "Wynn Resorts", sector: "Consumer Discretionary", exchange: "NASDAQ" },
  { ticker: "MGM", name: "MGM Resorts", sector: "Consumer Discretionary", exchange: "NYSE" },
  // Consumer Staples
  { ticker: "WMT", name: "Walmart Inc", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "PG", name: "Procter & Gamble", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "KO", name: "Coca-Cola Co", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "PEP", name: "PepsiCo Inc", sector: "Consumer Staples", exchange: "NASDAQ" },
  { ticker: "COST", name: "Costco Wholesale", sector: "Consumer Staples", exchange: "NASDAQ" },
  { ticker: "PM", name: "Philip Morris Intl", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "MO", name: "Altria Group", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "CL", name: "Colgate-Palmolive", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "EL", name: "Estee Lauder", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "MDLZ", name: "Mondelez International", sector: "Consumer Staples", exchange: "NASDAQ" },
  { ticker: "GIS", name: "General Mills", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "KLG", name: "WK Kellogg Co", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "HRL", name: "Hormel Foods", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "CPB", name: "Campbell Soup Co", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "CAG", name: "Conagra Brands", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "KHC", name: "Kraft Heinz Co", sector: "Consumer Staples", exchange: "NASDAQ" },
  { ticker: "KR", name: "Kroger Co", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "SYY", name: "Sysco Corp", sector: "Consumer Staples", exchange: "NYSE" },
  { ticker: "TSN", name: "Tyson Foods", sector: "Consumer Staples", exchange: "NYSE" },
  // Health Care
  { ticker: "UNH", name: "UnitedHealth Group", sector: "Health Care", exchange: "NYSE" },
  { ticker: "JNJ", name: "Johnson & Johnson", sector: "Health Care", exchange: "NYSE" },
  { ticker: "LLY", name: "Eli Lilly", sector: "Health Care", exchange: "NYSE" },
  { ticker: "MRK", name: "Merck & Co", sector: "Health Care", exchange: "NYSE" },
  { ticker: "ABBV", name: "AbbVie Inc", sector: "Health Care", exchange: "NYSE" },
  { ticker: "TMO", name: "Thermo Fisher Scientific", sector: "Health Care", exchange: "NYSE" },
  { ticker: "ABT", name: "Abbott Laboratories", sector: "Health Care", exchange: "NYSE" },
  { ticker: "DHR", name: "Danaher Corp", sector: "Health Care", exchange: "NYSE" },
  { ticker: "AMGN", name: "Amgen Inc", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "ISRG", name: "Intuitive Surgical", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "MDT", name: "Medtronic plc", sector: "Health Care", exchange: "NYSE" },
  { ticker: "SYK", name: "Stryker Corp", sector: "Health Care", exchange: "NYSE" },
  { ticker: "GILD", name: "Gilead Sciences", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "REGN", name: "Regeneron Pharma", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "PFE", name: "Pfizer Inc", sector: "Health Care", exchange: "NYSE" },
  { ticker: "MCK", name: "McKesson Corp", sector: "Health Care", exchange: "NYSE" },
  { ticker: "CI", name: "The Cigna Group", sector: "Health Care", exchange: "NYSE" },
  { ticker: "ELV", name: "Elevance Health", sector: "Health Care", exchange: "NYSE" },
  { ticker: "HUM", name: "Humana Inc", sector: "Health Care", exchange: "NYSE" },
  { ticker: "CVS", name: "CVS Health Corp", sector: "Health Care", exchange: "NYSE" },
  { ticker: "BSX", name: "Boston Scientific", sector: "Health Care", exchange: "NYSE" },
  { ticker: "BDX", name: "Becton Dickinson", sector: "Health Care", exchange: "NYSE" },
  { ticker: "ZBH", name: "Zimmer Biomet", sector: "Health Care", exchange: "NYSE" },
  { ticker: "HOLX", name: "Hologic Inc", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "IDXX", name: "IDEXX Laboratories", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "IQV", name: "IQVIA Holdings", sector: "Health Care", exchange: "NYSE" },
  { ticker: "A", name: "Agilent Technologies", sector: "Health Care", exchange: "NYSE" },
  { ticker: "BAX", name: "Baxter International", sector: "Health Care", exchange: "NYSE" },
  { ticker: "BIIB", name: "Biogen Inc", sector: "Health Care", exchange: "NASDAQ" },
  { ticker: "VRTX", name: "Vertex Pharmaceuticals", sector: "Health Care", exchange: "NASDAQ" },
  // Financials
  { ticker: "BRK-B", name: "Berkshire Hathaway B", sector: "Financials", exchange: "NYSE" },
  { ticker: "JPM", name: "JPMorgan Chase", sector: "Financials", exchange: "NYSE" },
  { ticker: "V", name: "Visa Inc", sector: "Financials", exchange: "NYSE" },
  { ticker: "MA", name: "Mastercard Inc", sector: "Financials", exchange: "NYSE" },
  { ticker: "GS", name: "Goldman Sachs", sector: "Financials", exchange: "NYSE" },
  { ticker: "MS", name: "Morgan Stanley", sector: "Financials", exchange: "NYSE" },
  { ticker: "BLK", name: "BlackRock Inc", sector: "Financials", exchange: "NYSE" },
  { ticker: "AXP", name: "American Express", sector: "Financials", exchange: "NYSE" },
  { ticker: "SPGI", name: "S&P Global", sector: "Financials", exchange: "NYSE" },
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
  { ticker: "SQ", name: "Block Inc", sector: "Financials", exchange: "NYSE" },
  { ticker: "PYPL", name: "PayPal Holdings", sector: "Financials", exchange: "NASDAQ" },
  { ticker: "COIN", name: "Coinbase Global", sector: "Financials", exchange: "NASDAQ" },
  { ticker: "COF", name: "Capital One Financial", sector: "Financials", exchange: "NYSE" },
  { ticker: "DFS", name: "Discover Financial", sector: "Financials", exchange: "NYSE" },
  { ticker: "SYF", name: "Synchrony Financial", sector: "Financials", exchange: "NYSE" },
  { ticker: "BK", name: "Bank of New York Mellon", sector: "Financials", exchange: "NYSE" },
  { ticker: "STT", name: "State Street Corp", sector: "Financials", exchange: "NYSE" },
  { ticker: "TROW", name: "T. Rowe Price Group", sector: "Financials", exchange: "NASDAQ" },
  { ticker: "IVZ", name: "Invesco Ltd", sector: "Financials", exchange: "NYSE" },
  { ticker: "RF", name: "Regions Financial", sector: "Financials", exchange: "NYSE" },
  { ticker: "FITB", name: "Fifth Third Bancorp", sector: "Financials", exchange: "NASDAQ" },
  { ticker: "KEY", name: "KeyCorp", sector: "Financials", exchange: "NYSE" },
  { ticker: "HBAN", name: "Huntington Bancshares", sector: "Financials", exchange: "NASDAQ" },
  { ticker: "CFG", name: "Citizens Financial Group", sector: "Financials", exchange: "NYSE" },
  { ticker: "MTB", name: "M&T Bank Corp", sector: "Financials", exchange: "NYSE" },
  { ticker: "FDS", name: "FactSet Research Systems", sector: "Financials", exchange: "NASDAQ" },
  { ticker: "MSCI", name: "MSCI Inc", sector: "Financials", exchange: "NYSE" },
  { ticker: "MCO", name: "Moody's Corp", sector: "Financials", exchange: "NYSE" },
  // Industrials
  { ticker: "GE", name: "GE Aerospace", sector: "Industrials", exchange: "NYSE" },
  { ticker: "CAT", name: "Caterpillar Inc", sector: "Industrials", exchange: "NYSE" },
  { ticker: "BA", name: "Boeing Co", sector: "Industrials", exchange: "NYSE" },
  { ticker: "HON", name: "Honeywell Intl", sector: "Industrials", exchange: "NASDAQ" },
  { ticker: "UNP", name: "Union Pacific", sector: "Industrials", exchange: "NYSE" },
  { ticker: "DE", name: "Deere & Co", sector: "Industrials", exchange: "NYSE" },
  { ticker: "LMT", name: "Lockheed Martin", sector: "Industrials", exchange: "NYSE" },
  { ticker: "NOC", name: "Northrop Grumman", sector: "Industrials", exchange: "NYSE" },
  { ticker: "GD", name: "General Dynamics", sector: "Industrials", exchange: "NYSE" },
  { ticker: "RTX", name: "RTX Corp", sector: "Industrials", exchange: "NYSE" },
  { ticker: "ETN", name: "Eaton Corp", sector: "Industrials", exchange: "NYSE" },
  { ticker: "EMR", name: "Emerson Electric", sector: "Industrials", exchange: "NYSE" },
  { ticker: "FDX", name: "FedEx Corp", sector: "Industrials", exchange: "NYSE" },
  { ticker: "UPS", name: "United Parcel Service", sector: "Industrials", exchange: "NYSE" },
  { ticker: "MMM", name: "3M Company", sector: "Industrials", exchange: "NYSE" },
  { ticker: "WM", name: "Waste Management", sector: "Industrials", exchange: "NYSE" },
  { ticker: "RSG", name: "Republic Services", sector: "Industrials", exchange: "NYSE" },
  { ticker: "CSX", name: "CSX Corp", sector: "Industrials", exchange: "NASDAQ" },
  { ticker: "NSC", name: "Norfolk Southern", sector: "Industrials", exchange: "NYSE" },
  { ticker: "DAL", name: "Delta Air Lines", sector: "Industrials", exchange: "NYSE" },
  { ticker: "UAL", name: "United Airlines Holdings", sector: "Industrials", exchange: "NASDAQ" },
  { ticker: "AAL", name: "American Airlines Group", sector: "Industrials", exchange: "NASDAQ" },
  { ticker: "LUV", name: "Southwest Airlines", sector: "Industrials", exchange: "NYSE" },
  { ticker: "LDOS", name: "Leidos Holdings", sector: "Industrials", exchange: "NYSE" },
  { ticker: "CACI", name: "CACI International", sector: "Industrials", exchange: "NYSE" },
  { ticker: "PWR", name: "Quanta Services", sector: "Industrials", exchange: "NYSE" },
  { ticker: "FAST", name: "Fastenal Co", sector: "Industrials", exchange: "NASDAQ" },
  { ticker: "GWW", name: "W.W. Grainger", sector: "Industrials", exchange: "NYSE" },
  { ticker: "PCAR", name: "PACCAR Inc", sector: "Industrials", exchange: "NASDAQ" },
  { ticker: "IR", name: "Ingersoll Rand", sector: "Industrials", exchange: "NYSE" },
  { ticker: "PH", name: "Parker-Hannifin", sector: "Industrials", exchange: "NYSE" },
  { ticker: "ROK", name: "Rockwell Automation", sector: "Industrials", exchange: "NYSE" },
  { ticker: "AME", name: "AMETEK Inc", sector: "Industrials", exchange: "NYSE" },
  { ticker: "XYL", name: "Xylem Inc", sector: "Industrials", exchange: "NYSE" },
  { ticker: "VRSK", name: "Verisk Analytics", sector: "Industrials", exchange: "NASDAQ" },
  { ticker: "BR", name: "Broadridge Financial", sector: "Industrials", exchange: "NYSE" },
  // Energy
  { ticker: "XOM", name: "Exxon Mobil", sector: "Energy", exchange: "NYSE" },
  { ticker: "CVX", name: "Chevron Corp", sector: "Energy", exchange: "NYSE" },
  { ticker: "COP", name: "ConocoPhillips", sector: "Energy", exchange: "NYSE" },
  { ticker: "EOG", name: "EOG Resources", sector: "Energy", exchange: "NYSE" },
  { ticker: "SLB", name: "SLB (Schlumberger)", sector: "Energy", exchange: "NYSE" },
  { ticker: "OXY", name: "Occidental Petroleum", sector: "Energy", exchange: "NYSE" },
  { ticker: "PSX", name: "Phillips 66", sector: "Energy", exchange: "NYSE" },
  { ticker: "MPC", name: "Marathon Petroleum", sector: "Energy", exchange: "NYSE" },
  { ticker: "VLO", name: "Valero Energy", sector: "Energy", exchange: "NYSE" },
  { ticker: "HES", name: "Hess Corp", sector: "Energy", exchange: "NYSE" },
  { ticker: "DVN", name: "Devon Energy", sector: "Energy", exchange: "NYSE" },
  { ticker: "FANG", name: "Diamondback Energy", sector: "Energy", exchange: "NASDAQ" },
  { ticker: "BKR", name: "Baker Hughes Co", sector: "Energy", exchange: "NASDAQ" },
  { ticker: "HAL", name: "Halliburton Co", sector: "Energy", exchange: "NYSE" },
  { ticker: "MRO", name: "Marathon Oil Corp", sector: "Energy", exchange: "NYSE" },
  { ticker: "APA", name: "APA Corp", sector: "Energy", exchange: "NASDAQ" },
  { ticker: "KMI", name: "Kinder Morgan", sector: "Energy", exchange: "NYSE" },
  { ticker: "WMB", name: "Williams Companies", sector: "Energy", exchange: "NYSE" },
  { ticker: "OKE", name: "ONEOK Inc", sector: "Energy", exchange: "NYSE" },
  { ticker: "LNG", name: "Cheniere Energy", sector: "Energy", exchange: "NYSE" },
  // Materials
  { ticker: "LIN", name: "Linde plc", sector: "Materials", exchange: "NYSE" },
  { ticker: "APD", name: "Air Products & Chem", sector: "Materials", exchange: "NYSE" },
  { ticker: "SHW", name: "Sherwin-Williams", sector: "Materials", exchange: "NYSE" },
  { ticker: "ECL", name: "Ecolab Inc", sector: "Materials", exchange: "NYSE" },
  { ticker: "FCX", name: "Freeport-McMoRan", sector: "Materials", exchange: "NYSE" },
  { ticker: "NEM", name: "Newmont Corp", sector: "Materials", exchange: "NYSE" },
  { ticker: "NUE", name: "Nucor Corp", sector: "Materials", exchange: "NYSE" },
  { ticker: "STLD", name: "Steel Dynamics", sector: "Materials", exchange: "NASDAQ" },
  { ticker: "CF", name: "CF Industries", sector: "Materials", exchange: "NYSE" },
  { ticker: "MOS", name: "The Mosaic Co", sector: "Materials", exchange: "NYSE" },
  { ticker: "ALB", name: "Albemarle Corp", sector: "Materials", exchange: "NYSE" },
  { ticker: "PPG", name: "PPG Industries", sector: "Materials", exchange: "NYSE" },
  { ticker: "IP", name: "International Paper", sector: "Materials", exchange: "NYSE" },
  { ticker: "PKG", name: "Packaging Corp of America", sector: "Materials", exchange: "NYSE" },
  { ticker: "AVY", name: "Avery Dennison", sector: "Materials", exchange: "NYSE" },
  // Utilities
  { ticker: "NEE", name: "NextEra Energy", sector: "Utilities", exchange: "NYSE" },
  { ticker: "SO", name: "Southern Company", sector: "Utilities", exchange: "NYSE" },
  { ticker: "DUK", name: "Duke Energy", sector: "Utilities", exchange: "NYSE" },
  { ticker: "AEP", name: "American Electric Power", sector: "Utilities", exchange: "NASDAQ" },
  { ticker: "D", name: "Dominion Energy", sector: "Utilities", exchange: "NYSE" },
  { ticker: "EXC", name: "Exelon Corp", sector: "Utilities", exchange: "NASDAQ" },
  { ticker: "SRE", name: "Sempra Energy", sector: "Utilities", exchange: "NYSE" },
  { ticker: "PCG", name: "PG&E Corp", sector: "Utilities", exchange: "NYSE" },
  { ticker: "XEL", name: "Xcel Energy", sector: "Utilities", exchange: "NASDAQ" },
  { ticker: "ED", name: "Consolidated Edison", sector: "Utilities", exchange: "NYSE" },
  { ticker: "WEC", name: "WEC Energy Group", sector: "Utilities", exchange: "NYSE" },
  { ticker: "AWK", name: "American Water Works", sector: "Utilities", exchange: "NYSE" },
  { ticker: "ES", name: "Eversource Energy", sector: "Utilities", exchange: "NYSE" },
  { ticker: "ETR", name: "Entergy Corp", sector: "Utilities", exchange: "NYSE" },
  { ticker: "PPL", name: "PPL Corp", sector: "Utilities", exchange: "NYSE" },
  { ticker: "EIX", name: "Edison International", sector: "Utilities", exchange: "NYSE" },
  // Real Estate
  { ticker: "AMT", name: "American Tower Corp", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "PLD", name: "Prologis Inc", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "CCI", name: "Crown Castle Intl", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "EQIX", name: "Equinix Inc", sector: "Real Estate", exchange: "NASDAQ" },
  { ticker: "O", name: "Realty Income Corp", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "WELL", name: "Welltower Inc", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "AVB", name: "AvalonBay Communities", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "EQR", name: "Equity Residential", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "SPG", name: "Simon Property Group", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "VTR", name: "Ventas Inc", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "DLR", name: "Digital Realty Trust", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "PSA", name: "Public Storage", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "EXR", name: "Extra Space Storage", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "ARE", name: "Alexandria Real Estate", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "BXP", name: "Boston Properties", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "HST", name: "Host Hotels & Resorts", sector: "Real Estate", exchange: "NASDAQ" },
  { ticker: "KIM", name: "Kimco Realty", sector: "Real Estate", exchange: "NYSE" },
  { ticker: "REG", name: "Regency Centers", sector: "Real Estate", exchange: "NASDAQ" },
];

// ─── Sector risk profiles ─────────────────────────────────────────

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

  const priceBase = 50 + rng() * 450;
  const price = round(priceBase);
  const change1d = round((rng() - 0.48) * 6, 2);
  const mcBase = 10 + rng() * 800;
  const marketCap = round(mcBase, 1);

  // Seeded fallback returns (used only when Yahoo history not yet cached)
  const seededReturn12m = round((rng() - 0.3) * 80);
  const seededReturn6m = round((rng() - 0.35) * 50);
  const seededReturn3m = round((rng() - 0.4) * 30);

  // ── Use real Yahoo history metrics if available ──────────────────
  const histMetrics = getHistoryMetrics(def.ticker);
  const return12m = histMetrics?.return12m ?? seededReturn12m;
  const return6m = histMetrics?.return6m ?? seededReturn6m;
  const return3m = histMetrics?.return3m ?? seededReturn3m;

  const roe = round(5 + rng() * 35 + profile.qualityBias * 0.3);
  const profitMargin = round(3 + rng() * 35 + profile.qualityBias * 0.4);
  const debtToEquity = round(0.1 + rng() * 2.5 - profile.qualityBias * 0.02);
  const beta = round(profile.betaBase + (rng() - 0.5) * 0.6, 2);

  // Use real 52W volatility from Yahoo history if available, else seeded
  const seededVol = round(15 + rng() * 40 - profile.volBias * 0.3);
  const volatility52w = histMetrics?.volatility52w ?? seededVol;

  const pe = round(8 + rng() * 45 - profile.valueBias * 0.3);
  const pb = round(0.8 + rng() * 12 - profile.valueBias * 0.1);
  const dividendYield = round(Math.max(0, rng() * 5 + profile.valueBias * 0.05), 2);
  const epsGrowth = round((rng() - 0.3) * 60);
  const revenueGrowth = round((rng() - 0.25) * 40);
  const insiderOwnership = round(rng() * 15, 1);
  const institutionalOwnership = round(40 + rng() * 55, 1);

  // Try to get real FMP scores first
  const fmp = getFundamentals(def.ticker);
  const cacheReady = getCacheStatus().status === "ready";

  // ── Factor scores ────────────────────────────────────────────────
  // Momentum: always computed from real returns (Yahoo if cached, seeded fallback)
  const momRaw = return12m * 0.5 + return6m * 0.3 + return3m * 0.2;
  const momentum = clamp(Math.round(50 + momRaw * 1.2), 0, 100);

  const quality = (cacheReady && fmp?.qualityScore != null)
    ? fmp.qualityScore
    : clamp(Math.round((roe / 40) * 40 + (profitMargin / 35) * 30 + ((2.5 - debtToEquity) / 2.5) * 30 + profile.qualityBias), 0, 100);

  // Low volatility: use real vol52w in score formula
  const lowVol = (cacheReady && fmp?.lowVolScore != null)
    ? fmp.lowVolScore
    : clamp(Math.round(((2 - beta) / 2) * 50 + ((60 - volatility52w) / 60) * 50 + profile.volBias), 0, 100);

  const valuation = (cacheReady && fmp?.valuationScore != null)
    ? fmp.valuationScore
    : clamp(Math.round(50 + ((50 - pe) / 50) * 35 + ((12 - pb) / 12) * 35 + (dividendYield / 5) * 30 + profile.valueBias), 0, 100);

  const erm = (cacheReady && fmp?.ermScore != null)
    ? fmp.ermScore
    : clamp(Math.round(50 + ((epsGrowth / 60) * 50 + (revenueGrowth / 40) * 50) * 0.8), 0, 100);

  const insRaw = (insiderOwnership / 15) * 60 + (institutionalOwnership / 95) * 40;
  const insider = clamp(Math.round(insRaw), 0, 100);

  // Override raw metrics with FMP real values where available
  const finalROE = (cacheReady && fmp?.roe != null) ? fmp.roe : roe;
  const finalProfitMargin = (cacheReady && fmp?.profitMargin != null) ? fmp.profitMargin : profitMargin;
  const finalDebtToEquity = (cacheReady && fmp?.debtToEquity != null) ? fmp.debtToEquity : debtToEquity;
  const finalBeta = (cacheReady && fmp?.beta != null) ? fmp.beta : beta;
  const finalPE = (cacheReady && fmp?.pe != null) ? fmp.pe : pe;
  const finalPB = (cacheReady && fmp?.pb != null) ? fmp.pb : pb;
  const finalDY = (cacheReady && fmp?.dividendYield != null) ? fmp.dividendYield : dividendYield;
  const finalEPSGrowth = (cacheReady && fmp?.epsGrowth != null) ? fmp.epsGrowth : epsGrowth;
  const finalRevGrowth = (cacheReady && fmp?.revenueGrowth != null) ? fmp.revenueGrowth : revenueGrowth;

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
    composite: 0,
    metrics: {
      return12m,
      return6m,
      return3m,
      roe: finalROE,
      profitMargin: finalProfitMargin,
      debtToEquity: finalDebtToEquity,
      beta: finalBeta,
      volatility52w,
      pe: finalPE,
      pb: finalPB,
      dividendYield: finalDY,
      epsGrowth: finalEPSGrowth,
      revenueGrowth: finalRevGrowth,
      insiderOwnership,
      institutionalOwnership,
    },
  };
}

// ─── Stock score cache ────────────────────────────────────────────
// Invalidated when: (a) FMP cache becomes ready, (b) Yahoo history prewarm completes

let cachedStocks: StockScore[] | null = null;
let lastCacheStatus = "empty";

export function invalidateStockScoreCache() {
  cachedStocks = null;
  console.log("[stockData] Score cache invalidated — will regenerate on next request");
}

// Register invalidator with marketData so it's called after history prewarm
registerStockCacheInvalidator(invalidateStockScoreCache);

export function getAllStocks(): StockScore[] {
  const currentStatus = getCacheStatus().status;
  // Regenerate if cache cleared or FMP just became ready
  if (!cachedStocks || (currentStatus === "ready" && lastCacheStatus !== "ready")) {
    cachedStocks = ALL_STOCKS.map(generateStockScore);
    lastCacheStatus = currentStatus;
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

const SCREENER_TOP_N = 50;
const PORTFOLIO_TOP_N = 25;

export function getScreenedStocks(weights: {
  momentum: number; quality: number; lowVol: number; valuation: number; erm: number; insider: number;
}): StockScore[] {
  const stocks = getAllStocks().map((s) => ({
    ...s,
    composite: computeComposite(s, weights),
  }));
  stocks.sort((a, b) => b.composite - a.composite);
  return stocks.slice(0, SCREENER_TOP_N);
}

export const SECTORS = [
  "Technology", "Financials", "Health Care", "Consumer Staples",
  "Energy", "Industrials", "Consumer Discretionary", "Materials",
  "Utilities", "Communication Services", "Real Estate",
];

export const EXCHANGES = ["NYSE", "NASDAQ"];

// ─── Price History ────────────────────────────────────────────────
// NOTE: generatePriceHistory is only used for backtest simulation.
// Stock detail pages use real Yahoo history via getPriceHistory24M in routes.ts.

export function generatePriceHistory(ticker: string, months: number = 24): PricePoint[] {
  const rng = seededRandom(ticker + "-price-history");
  const points: PricePoint[] = [];
  const baseStock = getAllStocks().find((s) => s.ticker === ticker);
  const currentPrice = baseStock?.price ?? 100;
  const now = new Date();
  let price = currentPrice;
  const monthlyPrices: { date: Date; price: number }[] = [{ date: now, price }];
  for (let i = 1; i <= months; i++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    const monthlyReturn = (rng() - 0.45) * 0.18;
    price = price / (1 + monthlyReturn);
    monthlyPrices.unshift({ date: d, price: round(price, 2) });
  }
  for (const mp of monthlyPrices) {
    points.push({ date: mp.date.toISOString().slice(0, 10), price: mp.price });
  }
  return points;
}

// ─── Peer Comparison ─────────────────────────────────────────────

export function getPeers(ticker: string, weights: FactorWeights): PeerComparison[] {
  const stock = getAllStocks().find((s) => s.ticker === ticker);
  if (!stock) return [];
  const sectorStocks = getAllStocks()
    .filter((s) => s.sector === stock.sector && s.ticker !== ticker)
    .map((s) => ({ ...s, composite: computeComposite(s, weights) }))
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 5);
  return sectorStocks.map((s) => ({
    ticker: s.ticker, name: s.name, composite: s.composite,
    momentum: s.momentum, quality: s.quality, lowVol: s.lowVol,
    valuation: s.valuation, erm: s.erm, insider: s.insider,
  }));
}

// ─── Stock Detail ─────────────────────────────────────────────────

const STOCK_DESCRIPTIONS: Record<string, string> = {
  "AAPL": "Consumer electronics, software, and services. Known for iPhone, Mac, iPad, and Services ecosystem.",
  "MSFT": "Enterprise software, cloud computing (Azure), gaming (Xbox), and productivity tools (Office 365).",
  "NVDA": "GPU and AI chip leader. Dominates data center AI training and inference market.",
  "TSLA": "Electric vehicles, energy storage, and solar. Pioneer in autonomous driving technology.",
  "AMZN": "E-commerce, cloud computing (AWS), digital advertising, and streaming (Prime Video).",
  "GOOGL": "Search, digital advertising, cloud (GCP), Android OS, and Waymo autonomous vehicles.",
  "META": "Social media (Facebook, Instagram, WhatsApp), digital advertising, and metaverse (Reality Labs).",
  "JPM": "Largest US bank by assets. Investment banking, consumer banking, and asset management.",
  "V": "Global payments technology. Processes over 200 billion transactions annually.",
  "XOM": "Integrated oil & gas. Upstream exploration, downstream refining, and chemicals.",
  "LLY": "Pharmaceutical leader in diabetes (Mounjaro/Ozempic competitor), oncology, and immunology.",
  "UNH": "Largest US health insurer. UnitedHealthcare insurance + Optum health services platform.",
};

export function getStockDetail(ticker: string, weights: FactorWeights): StockDetail | null {
  const stock = getAllStocks().find((s) => s.ticker === ticker);
  if (!stock) return null;
  const withComposite = { ...stock, composite: computeComposite(stock, weights) };
  return {
    ...withComposite,
    priceHistory: generatePriceHistory(ticker, 24),
    peers: getPeers(ticker, weights),
    description: STOCK_DESCRIPTIONS[ticker] || `${stock.name} operates in the ${stock.sector} sector, listed on ${stock.exchange}.`,
  };
}

// ─── Portfolio Builder ────────────────────────────────────────────

function buildPortfolioWeights(weights: FactorWeights) {
  const scored = getAllStocks()
    .map((s) => ({ ...s, composite: computeComposite(s, weights) }))
    .sort((a, b) => b.composite - a.composite)
    .slice(0, PORTFOLIO_TOP_N);
  const totalScore = scored.reduce((s, st) => s + st.composite, 0);
  return scored.map((st) => ({
    ticker: st.ticker, name: st.name, sector: st.sector, exchange: st.exchange,
    composite: st.composite,
    weight: totalScore > 0 ? round((st.composite / totalScore) * 100, 2) : round(100 / PORTFOLIO_TOP_N, 2),
  }));
}

export function runBacktest(weights: FactorWeights, period: "1y" | "3y" | "5y"): BacktestResult {
  const months = period === "1y" ? 12 : period === "3y" ? 36 : 60;
  const portfolio = buildPortfolioWeights(weights);
  const stockPrices: Map<string, number[]> = new Map();
  for (const h of portfolio) {
    const priceHistory = generatePriceHistory(h.ticker, months);
    stockPrices.set(h.ticker, priceHistory.map((p) => p.price));
  }
  const benchmarkRng = seededRandom("SP500-benchmark-" + period);
  const benchmarkPrices: number[] = [10000];
  for (let i = 1; i <= months; i++) {
    const monthlyReturn = 0.008 + (benchmarkRng() - 0.5) * 0.08;
    benchmarkPrices.push(round(benchmarkPrices[i - 1] * (1 + monthlyReturn), 2));
  }
  const points: BacktestPoint[] = [];
  const now = new Date();
  let portfolioValue = 10000;
  let maxPortfolio = portfolioValue;
  let maxDrawdown = 0;
  for (let i = 0; i <= months; i++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (months - i));
    if (i === 0) { points.push({ month: d.toISOString().slice(0, 7), portfolioValue: 10000, benchmarkValue: 10000 }); continue; }
    let weightedReturn = 0;
    for (const h of portfolio) {
      const prices = stockPrices.get(h.ticker)!;
      const stockReturn = prices[i - 1] > 0 ? (prices[i] - prices[i - 1]) / prices[i - 1] : 0;
      weightedReturn += (h.weight / 100) * stockReturn;
    }
    portfolioValue = round(portfolioValue * (1 + weightedReturn), 2);
    maxPortfolio = Math.max(maxPortfolio, portfolioValue);
    maxDrawdown = Math.max(maxDrawdown, (maxPortfolio - portfolioValue) / maxPortfolio);
    points.push({ month: d.toISOString().slice(0, 7), portfolioValue, benchmarkValue: benchmarkPrices[i] });
  }
  const holdings: BacktestHolding[] = portfolio.map((h) => {
    const prices = stockPrices.get(h.ticker)!;
    const totalStockReturn = prices[0] > 0 ? round(((prices[prices.length - 1] - prices[0]) / prices[0]) * 100, 2) : 0;
    return { ticker: h.ticker, name: h.name, sector: h.sector, exchange: h.exchange, weight: h.weight, compositeScore: h.composite, returnContribution: round((h.weight / 100) * totalStockReturn, 2), totalReturn: totalStockReturn };
  });
  holdings.sort((a, b) => b.weight - a.weight);
  const totalReturn = round(((portfolioValue - 10000) / 10000) * 100, 2);
  const benchFinal = benchmarkPrices[benchmarkPrices.length - 1];
  const benchmarkReturn = round(((benchFinal - 10000) / 10000) * 100, 2);
  const years = months / 12;
  const annualizedReturn = round((Math.pow(portfolioValue / 10000, 1 / years) - 1) * 100, 2);
  const benchmarkAnnualized = round((Math.pow(benchFinal / 10000, 1 / years) - 1) * 100, 2);
  const monthlyReturns = points.slice(1).map((p, i) => (p.portfolioValue - points[i].portfolioValue) / points[i].portfolioValue);
  const avgMonthly = monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length;
  const stdMonthly = Math.sqrt(monthlyReturns.reduce((a, b) => a + (b - avgMonthly) ** 2, 0) / monthlyReturns.length);
  const sharpe = stdMonthly > 0 ? round((avgMonthly * 12 - 0.04) / (stdMonthly * Math.sqrt(12)), 2) : 0;
  const sectorMap = new Map<string, number>(); const exchangeMap = new Map<string, number>();
  for (const h of holdings) { sectorMap.set(h.sector, (sectorMap.get(h.sector) || 0) + h.weight); exchangeMap.set(h.exchange, (exchangeMap.get(h.exchange) || 0) + h.weight); }
  return {
    period, weights, points, totalReturn, benchmarkReturn, annualizedReturn, benchmarkAnnualized,
    maxDrawdown: round(maxDrawdown * 100, 2), sharpeRatio: sharpe, alpha: round(annualizedReturn - benchmarkAnnualized, 2),
    holdings, holdingCount: PORTFOLIO_TOP_N, weightingMethod: "score-weighted", rebalanceFrequency: "monthly",
    sectorBreakdown: Array.from(sectorMap).map(([sector, weight]) => ({ sector, weight: round(weight, 1) })).sort((a, b) => b.weight - a.weight),
    exchangeBreakdown: Array.from(exchangeMap).map(([exchange, weight]) => ({ exchange, weight: round(weight, 1) })).sort((a, b) => b.weight - a.weight),
  };
}

export function buildPortfolio(weights: FactorWeights): PortfolioSummary {
  const scored = getAllStocks()
    .map((s) => ({ ...s, composite: computeComposite(s, weights) }))
    .sort((a, b) => b.composite - a.composite)
    .slice(0, PORTFOLIO_TOP_N);
  const totalScore = scored.reduce((s, st) => s + st.composite, 0);
  const portfolioValue = 10000;
  const holdings: PortfolioHolding[] = scored.map((st) => {
    const weight = totalScore > 0 ? round((st.composite / totalScore) * 100, 2) : round(100 / PORTFOLIO_TOP_N, 2);
    const marketValue = round(portfolioValue * (weight / 100), 2);
    return { ticker: st.ticker, name: st.name, sector: st.sector, exchange: st.exchange, price: st.price, change1d: st.change1d, compositeScore: st.composite, weight, shares: round(marketValue / st.price, 4), marketValue, momentum: st.momentum, quality: st.quality, lowVol: st.lowVol, valuation: st.valuation, erm: st.erm, insider: st.insider };
  });
  const avgComposite = round(holdings.reduce((s, h) => s + h.compositeScore, 0) / holdings.length, 1);
  const allS = getAllStocks();
  const weightedBeta = round(holdings.reduce((s, h) => { const st = allS.find((x) => x.ticker === h.ticker); return s + (h.weight / 100) * (st?.metrics.beta ?? 1); }, 0), 2);
  const weightedDividendYield = round(holdings.reduce((s, h) => { const st = allS.find((x) => x.ticker === h.ticker); return s + (h.weight / 100) * (st?.metrics.dividendYield ?? 0); }, 0), 2);
  const weightedPE = round(holdings.reduce((s, h) => { const st = allS.find((x) => x.ticker === h.ticker); return s + (h.weight / 100) * (st?.metrics.pe ?? 20); }, 0), 1);
  const sectorAgg = new Map<string, { weight: number; count: number }>();
  const exchAgg = new Map<string, { weight: number; count: number }>();
  for (const h of holdings) {
    const se = sectorAgg.get(h.sector) || { weight: 0, count: 0 }; se.weight += h.weight; se.count += 1; sectorAgg.set(h.sector, se);
    const ee = exchAgg.get(h.exchange) || { weight: 0, count: 0 }; ee.weight += h.weight; ee.count += 1; exchAgg.set(h.exchange, ee);
  }
  const sortedByWeight = [...holdings].sort((a, b) => b.weight - a.weight);
  return {
    holdings, totalValue: portfolioValue, holdingCount: PORTFOLIO_TOP_N, weightingMethod: "score-weighted",
    avgComposite, weightedBeta, weightedDividendYield, weightedPE,
    sectorBreakdown: Array.from(sectorAgg).map(([sector, v]) => ({ sector, weight: round(v.weight, 1), count: v.count })).sort((a, b) => b.weight - a.weight),
    exchangeBreakdown: Array.from(exchAgg).map(([exchange, v]) => ({ exchange, weight: round(v.weight, 1), count: v.count })).sort((a, b) => b.weight - a.weight),
    topHolding: { ticker: sortedByWeight[0].ticker, weight: sortedByWeight[0].weight },
    top5Weight: round(sortedByWeight.slice(0, 5).reduce((s, h) => s + h.weight, 0), 1),
  };
}

export function getSectorHeatmap(weights: FactorWeights): HeatmapSector[] {
  const stocks = getAllStocks().map((s) => ({ ...s, composite: computeComposite(s, weights) }));
  const sectorMap = new Map<string, HeatmapCell[]>();
  for (const s of stocks) {
    const cell: HeatmapCell = { ticker: s.ticker, name: s.name, sector: s.sector, composite: s.composite, change1d: s.change1d, marketCap: s.marketCap };
    if (!sectorMap.has(s.sector)) sectorMap.set(s.sector, []);
    sectorMap.get(s.sector)!.push(cell);
  }
  const result: HeatmapSector[] = [];
  for (const [sector, cells] of sectorMap) {
    cells.sort((a, b) => b.marketCap - a.marketCap);
    result.push({ sector, stocks: cells, avgComposite: round(cells.reduce((a, c) => a + c.composite, 0) / cells.length, 1) });
  }
  result.sort((a, b) => b.avgComposite - a.avgComposite);
  return result;
}
