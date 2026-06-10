import type { SearchResult } from "./types";

const searchCache = new Map<string, { at: number; results: SearchResult[] }>();
const yahooCache = new Map<string, { at: number; results: SearchResult[] }>();
const amfiCache = new Map<string, { at: number; results: SearchResult[] }>();
const CACHE_MS = 10 * 60 * 1000;
let amfiCatalogueCache: { at: number; funds: any[] } | null = null;
let amfiCataloguePromise: Promise<any[]> | null = null;
const AMFI_CATALOGUE_MS = 24 * 60 * 60 * 1000;

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

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function cached(map: Map<string, { at: number; results: SearchResult[] }>, key: string) {
  const hit = map.get(key);
  return hit && Date.now() - hit.at < CACHE_MS ? hit.results : null;
}

function remember(map: Map<string, { at: number; results: SearchResult[] }>, key: string, results: SearchResult[]) {
  map.set(key, { at: Date.now(), results });
  const oldest = map.keys().next().value;
  if (map.size > 100 && oldest) map.delete(oldest);
  return results;
}

function amfiResult(fund: any): SearchResult {
  return {
    label: `${fund.schemeName} · ${fund.schemeCode}`,
    name: fund.schemeName,
    assetType: "Mutual Fund",
    country: "India",
    ticker: String(fund.schemeCode),
    exchange: "",
    identifierType: "Scheme code",
  };
}

function likelyMutualFundQuery(query: string) {
  const q = query.toLowerCase();
  return [
    "fund", "mutual", "amfi", "scheme", "growth", "direct", "regular", "idcw", "dividend",
    "bluechip", "income", "liquid", "debt", "equity", "nifty", "index", "small", "mid",
    "large", "cap", "flexi", "hybrid", "gilt", "elss", "tax", "overnight", "arbitrage",
    "hdfc", "icici", "axis", "sbi", "uti", "mirae", "nippon", "kotak", "aditya",
    "birla", "canara", "dsp", "franklin", "quant", "parag", "tata", "motilal",
    "bandhan", "invesco", "edelweiss", "pgim", "lic", "sundaram", "baroda", "mahindra",
    "hsbc",
  ].some((token) => q.includes(token));
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
  const key = query.trim().toLowerCase();
  const hit = cached(yahooCache, key);
  if (hit) return hit;
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 300 } }, 2500);
    const data = await res.json();
    return remember(yahooCache, key, (data.quotes || [])
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
      .filter(Boolean) as SearchResult[]);
  } catch {
    return [];
  }
}

export async function searchAmfi(query: string): Promise<SearchResult[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  const hit = cached(amfiCache, key);
  if (hit) return hit;
  try {
    try {
      const res = await fetchWithTimeout(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 24 * 3600 } }, 3000);
      if (res.ok) {
        const matches = await res.json();
        if (Array.isArray(matches) && matches.length) return remember(amfiCache, key, matches.slice(0, 8).map(amfiResult));
      }
    } catch {
      // Fall back to the cached catalogue below.
    }
    let funds = amfiCatalogueCache && Date.now() - amfiCatalogueCache.at < AMFI_CATALOGUE_MS ? amfiCatalogueCache.funds : null;
    if (!funds) {
      amfiCataloguePromise ||= fetchWithTimeout("https://api.mfapi.in/mf", { next: { revalidate: 24 * 3600 } }, 12000)
        .then((res) => res.json())
        .then((funds) => {
          amfiCatalogueCache = { at: Date.now(), funds: funds || [] };
          amfiCataloguePromise = null;
          return amfiCatalogueCache.funds;
        })
        .catch((error) => {
          amfiCataloguePromise = null;
          throw error;
        });
      funds = await amfiCataloguePromise;
    }
    return remember(amfiCache, key, funds
      .filter((fund: any) => String(fund.schemeName || "").toLowerCase().includes(key))
      .slice(0, 8)
      .map(amfiResult));
  } catch {
    return [];
  }
}

export async function searchSecurities(query: string) {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  const hit = cached(searchCache, key);
  if (hit) return hit;
  const shouldSearchFunds = likelyMutualFundQuery(query);
  const yahoo = await searchYahoo(query);
  const amfi = shouldSearchFunds || yahoo.length === 0 ? await searchAmfi(query) : [];
  const seen = new Set<string>();
  return remember(searchCache, key, [...amfi, ...yahoo].filter((item) => {
    const key = `${item.assetType}|${item.ticker}|${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10));
}
