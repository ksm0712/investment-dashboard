import type { SearchResult } from "./types";

const yahooExchanges: Record<string, string> = {
  NSI: "NSE",
  BSE: "BSE",
  NMS: "NASDAQ",
  NYQ: "NYSE",
  ASE: "AMEX",
  SES: "SGX",
  LSE: "LSE",
  JPX: "TSE",
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
  if (symbol.endsWith(".SI") || exchange === "SES") return "Singapore";
  if (symbol.endsWith(".L") || exchange === "LSE") return "United Kingdom";
  if (symbol.endsWith(".T") || exchange === "JPX") return "Japan";
  if (symbol.endsWith(".HK")) return "Hong Kong";
  if (symbol.endsWith(".AX")) return "Australia";
  if (symbol.endsWith(".TO")) return "Canada";
  if (["NMS", "NYQ", "ASE"].includes(exchange)) return "United States";
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
        return {
          label: `${q.shortname} · ${q.symbol}`,
          name: q.shortname,
          assetType,
          country,
          ticker: q.symbol,
          exchange: yahooExchanges[q.exchange] || q.exchange || "Other",
          identifierType: "Ticker",
        } as SearchResult;
      });
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
