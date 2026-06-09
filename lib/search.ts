import type { SearchResult } from "./types";

const yahooExchanges: Record<string, string> = {
  NSI: "NSE",
  BSE: "BSE",
  NMS: "NASDAQ",
  NYQ: "NYSE",
  NGM: "NASDAQ",
  PCX: "NYSE",
  NIM: "AMEX",
  ASE: "AMEX",
  SGX: "SGX",
  SES: "SGX",
  LSE: "LSE",
  IOB: "LSE",
  JPX: "TSE",
  TYO: "TSE",
  HKG: "HKEX",
  ASX: "ASX",
  TOR: "TSX",
  VAN: "TSXV",
  FRA: "Frankfurt",
  ETR: "XETRA",
  GER: "XETRA",
  EPA: "Euronext",
  AMS: "Euronext",
  MCE: "Madrid",
  MIL: "Borsa Italiana",
  SWX: "SIX",
  EBS: "SIX",
  KSC: "KRX",
  KOE: "KRX",
  TWO: "TWSE",
  TAI: "TWSE",
  JKT: "IDX",
  KLS: "Bursa Malaysia",
  BKK: "SET",
  SAO: "B3",
  JSE: "JSE",
  DFM: "DFM",
  ADX: "ADX",
  NZE: "NZX",
  STU: "Frankfurt",
  OSL: "Oslo",
  STO: "Nasdaq Stockholm",
  CPH: "Nasdaq Copenhagen",
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function inferCountry(symbol = "", exchange = "") {
  if (symbol.endsWith(".NS") || symbol.endsWith(".BO") || exchange === "NSI" || exchange === "BSE") return "India";
  if (symbol.endsWith(".SI") || ["SGX", "SES"].includes(exchange)) return "Singapore";
  if (symbol.endsWith(".L") || ["LSE", "IOB"].includes(exchange)) return "United Kingdom";
  if (symbol.endsWith(".T") || ["JPX", "TYO"].includes(exchange)) return "Japan";
  if (symbol.endsWith(".HK") || exchange === "HKG") return "Hong Kong";
  if (symbol.endsWith(".AX") || exchange === "ASX") return "Australia";
  if (symbol.endsWith(".TO") || ["TOR", "VAN"].includes(exchange)) return "Canada";
  if (symbol.endsWith(".DE") || ["FRA", "ETR", "GER", "STU"].includes(exchange)) return "Germany";
  if (symbol.endsWith(".PA") || exchange === "EPA") return "France";
  if (symbol.endsWith(".AS") || exchange === "AMS") return "Netherlands";
  if (symbol.endsWith(".SW") || ["SWX", "EBS"].includes(exchange)) return "Switzerland";
  if (["NMS", "NYQ", "NGM", "PCX", "NIM", "ASE"].includes(exchange)) return "United States";
  return "United States";
}

export async function searchYahoo(query: string): Promise<SearchResult[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 300 } });
    const data = await res.json();
    return (data.quotes || [])
      .filter((q: any) => q.symbol && q.shortname)
      .slice(0, 6)
      .map((q: any) => {
        const type = String(q.quoteType || "").toUpperCase();
        const assetType = type.includes("ETF") ? "ETF" : type.includes("MUTUAL") ? "Mutual Fund" : "Stock";
        const country = inferCountry(q.symbol, q.exchange);
        if (assetType === "Mutual Fund" && country === "India") return null;
        return {
          label: `${q.shortname} · ${q.symbol}`,
          name: q.shortname,
          assetType,
          country,
          ticker: q.symbol,
          exchange: yahooExchanges[q.exchange] || q.exchange || "Other",
          identifierType: "Ticker",
        } as SearchResult;
      })
      .filter(Boolean) as SearchResult[];
  } catch {
    return [];
  }
}

export async function searchAmfi(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetchWithTimeout("https://api.mfapi.in/mf", { next: { revalidate: 24 * 3600 } });
    const funds = await res.json();
    const q = query.toLowerCase();
    return (funds || [])
      .filter((fund: any) => String(fund.schemeName || "").toLowerCase().includes(q))
      .slice(0, 8)
      .map((fund: any) => ({
        label: `${fund.schemeName} · ${fund.schemeCode}`,
        name: fund.schemeName,
        assetType: "Mutual Fund",
        country: "India",
        ticker: String(fund.schemeCode),
        exchange: "",
        identifierType: "Scheme code",
      }));
  } catch {
    return [];
  }
}

export async function searchSecurities(query: string) {
  if (!query.trim()) return [];
  const [amfi, yahoo] = await Promise.all([searchAmfi(query), searchYahoo(query)]);
  const seen = new Set<string>();
  return [...amfi, ...yahoo].filter((item) => {
    const key = `${item.assetType}|${item.ticker}|${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}
