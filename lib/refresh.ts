import { getSecurities, syncActionHistory, updateRefreshFieldsForSecurity } from "./db";
import { getFx } from "./fx";
import type { Security } from "./types";
import { calculateAsset } from "./portfolio-engine";
import YahooFinance from "yahoo-finance2";

type PriceResult = {
  price: number;
  date: string;
  source: string;
  symbol?: string;
  week52Low?: number;
  week52High?: number;
  targetPrice?: number;
  targetSource?: string;
  targetAsOn?: string;
};

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const tickerOverrides: Record<string, string> = {
  "sap se|EUR": "SAP.DE",
  "dbs group holdings ltd|SGD": "D05.SI",
  "alphabet, inc.- class a|USD": "GOOGL",
  "alphabet inc class a|USD": "GOOGL",
  "visa inc-class a shares|USD": "V",
  "visa inc class a shares|USD": "V",
  "terumo corp|JPY": "4543.T",
  "rorze corp|JPY": "6323.T",
  "google|USD": "GOOGL",
  "microsoft|USD": "MSFT",
  "apple|USD": "AAPL",
  "amazon|USD": "AMZN",
  "nvidia|USD": "NVDA",
  "meta|USD": "META",
  "tesla|USD": "TSLA",
  "abbott|USD": "ABT",
  "abott|USD": "ABT",
  "softbank|JPY": "9984.T",
  "singtel|SGD": "Z74.SI",
  "singapore airlines|SGD": "C6L.SI",
  "sk hynix|EUR": "000660.KS",
};

const mfSchemeOverrides: Record<string, string> = {
  "axis focused 25-g": "117560",
  "axis focused fund - regular plan - growth option": "117560",
  "inf846k01ch7": "117560",
  "inf846k01cq8": "120468",
  "hdfc hybrid equity-g": "102948",
  "hdfc hybrid equity fund - growth plan": "102948",
  "inf179k01as4": "102948",
  "icici pru bluechip-g": "108466",
  "icici prudential bluechip fund - growth": "108466",
  "icici prudential large cap fund (erstwhile bluechip fund) - growth": "108466",
  "inf109k01bl4": "108466",
  "mirae asset large cap reg-g": "107578",
  "mirae asset large cap fund - growth plan": "107578",
  "inf769k01010": "107578",
  "uti flexi cap reg-g": "100669",
  "uti - flexi cap fund-growth option": "100669",
  "inf789f01513": "100669",
};

const exchangeSuffixes: Record<string, string> = {
  NSE: ".NS",
  BSE: ".BO",
  SGX: ".SI",
  SES: ".SI",
  LSE: ".L",
  TSE: ".T",
  JPX: ".T",
  HKEX: ".HK",
  ASX: ".AX",
  TSX: ".TO",
  XETRA: ".DE",
  FRA: ".DE",
  FWB: ".DE",
  Frankfurt: ".F",
  SIX: ".SW",
  "Borsa Italiana": ".MI",
  Madrid: ".MC",
  SSE: ".SS",
  SZSE: ".SZ",
  TSXV: ".V",
  NZX: ".NZ",
  "Euronext Dublin": ".IR",
  LuxSE: ".LU",
  "Nasdaq Stockholm": ".ST",
  Oslo: ".OL",
  "Nasdaq Copenhagen": ".CO",
  KRX: ".KS",
  TWSE: ".TW",
  TPEX: ".TWO",
  IDX: ".JK",
  "Bursa Malaysia": ".KL",
  SET: ".BK",
  PSE: ".PS",
  HOSE: ".VN",
  HNX: ".VN",
  B3: ".SA",
  BMV: ".MX",
  JSE: ".JO",
};

const countrySuffixes: Record<string, string> = {
  India: ".NS",
  Singapore: ".SI",
  "United Kingdom": ".L",
  Japan: ".T",
  "Hong Kong": ".HK",
  Australia: ".AX",
  Canada: ".TO",
  Germany: ".DE",
  France: ".PA",
  Netherlands: ".AS",
  Switzerland: ".SW",
  China: ".SS",
};

const currencySuffixes: Record<string, string[]> = {
  SGD: [".SI"],
  EUR: [".DE", ".PA", ".AS", ".MI", ".MC", ""],
  GBP: [".L"],
  JPY: [".T"],
  HKD: [".HK"],
  AUD: [".AX"],
  CAD: [".TO"],
  CHF: [".SW"],
  CNY: [".SS", ".SZ"],
};

const preferredQuoteTypes = new Set(["EQUITY", "ETF", "MUTUALFUND"]);

let mfCatalogueCache: any[] | null = null;

function parsePrice(value?: string | number | null) {
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value?: string | null) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function parseFlexibleDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  const direct = new Date(raw);
  if (Number.isFinite(direct.getTime())) return direct;
  return null;
}

function normaliseFundName(name: string) {
  let normalised = String(name || "");
  const replacements: Record<string, string> = {
    " Pru ": " Prudential ",
    "-G": " Growth",
    "Reg-G": "Regular Growth",
    "Large Cap Reg": "Large Cap Fund Regular",
    "Focused 25": "Focused Fund",
  };
  for (const [from, to] of Object.entries(replacements)) {
    normalised = normalised.replaceAll(from, to);
  }
  return normalised;
}

function bestMfMatch(matches: any[]) {
  function score(match: any) {
    const name = String(match.schemeName || "").toLowerCase();
    let points = 0;
    if (name.includes("growth")) points += 20;
    if (name.includes("regular") || name.includes("regular plan")) points += 10;
    if (name.includes("direct")) points -= 8;
    if (name.includes("idcw") || name.includes("dividend")) points -= 20;
    return points;
  }
  return [...matches].sort((a, b) => score(b) - score(a))[0];
}

async function fetchWithTimeout(url: string, init: any = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithAttempts(url: string, init: any = {}, attempts = 2, timeoutMs = 8000) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs);
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function yahooChartUrl(symbol: string) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
}

function parseYahooChart(data: any, symbol: string, source: string): PriceResult {
  if (data.chart?.error) throw new Error(data.chart.error.description || "Yahoo chart error");
  const result = data.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const timestamps = result?.timestamp || [];
  const marketPrice = Number(result?.meta?.regularMarketPrice);
  const marketTime = Number(result?.meta?.regularMarketTime);
  const marketDate = marketTime ? new Date(marketTime * 1000).toISOString().slice(0, 10) : "";
  const week52Low = parsePrice(result?.meta?.fiftyTwoWeekLow);
  const week52High = parsePrice(result?.meta?.fiftyTwoWeekHigh);

  for (let i = closes.length - 1; i >= 0; i--) {
    if (Number.isFinite(Number(closes[i])) && Number(closes[i]) > 0) {
      const closeDate = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      if (Number.isFinite(marketPrice) && marketPrice > 0 && marketDate && marketDate >= closeDate) {
        return {
          price: marketPrice,
          date: marketDate,
          source,
          symbol,
          week52Low: week52Low ?? undefined,
          week52High: week52High ?? undefined,
        };
      }
      return {
        price: Number(closes[i]),
        date: closeDate,
        source,
        symbol,
        week52Low: week52Low ?? undefined,
        week52High: week52High ?? undefined,
      };
    }
  }

  if (Number.isFinite(marketPrice) && marketPrice > 0) {
    return {
      price: marketPrice,
      date: marketTime ? new Date(marketTime * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      source,
      symbol,
      week52Low: week52Low ?? undefined,
      week52High: week52High ?? undefined,
    };
  }

  throw new Error(`No Yahoo price for ${symbol}`);
}

function parseJsonFromReader(text: string) {
  const chartStart = text.indexOf('{"chart"');
  const start = chartStart >= 0 ? chartStart : text.indexOf("{");
  if (start < 0) throw new Error("Yahoo fallback returned no chart data");

  const json = text.slice(start).trim();
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') inString = true;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(json.slice(0, i + 1));
    }
  }

  throw new Error("Yahoo fallback returned incomplete chart data");
}

async function yahooPrice(symbol: string) {
  const res = await fetchWithTimeout(yahooChartUrl(symbol), {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
    cache: "no-store",
  }, 4500);
  if (!res.ok) throw new Error(`Yahoo ${symbol} returned ${res.status}`);
  return parseYahooChart(await res.json(), symbol, "yahoo");
}

async function yahooFinance2Price(symbol: string): Promise<PriceResult> {
  const data = await yahooFinance.quoteSummary(symbol, {
    modules: ["financialData", "summaryDetail", "price"],
  });
  const price = parsePrice(data.price?.regularMarketPrice);
  if (!price) throw new Error(`No Yahoo Finance quote for ${symbol}`);
  const marketTime = data.price?.regularMarketTime;
  const date = marketTime instanceof Date
    ? marketTime.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const targetPrice = parsePrice(data.financialData?.targetMeanPrice);
  return {
    price,
    date,
    source: "yahoo-finance2",
    symbol,
    week52Low: parsePrice(data.summaryDetail?.fiftyTwoWeekLow) ?? undefined,
    week52High: parsePrice(data.summaryDetail?.fiftyTwoWeekHigh) ?? undefined,
    targetPrice: targetPrice ?? undefined,
    targetSource: targetPrice ? "yahoo-analyst-consensus" : undefined,
    targetAsOn: targetPrice ? new Date().toISOString().slice(0, 10) : undefined,
  };
}

async function yahooFallbackPrice(symbol: string) {
  const res = await fetchWithTimeout(`https://r.jina.ai/http://${yahooChartUrl(symbol)}`, {
    headers: {
      "Accept": "text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
    cache: "no-store",
  }, 4500);
  if (!res.ok) throw new Error(`Yahoo fallback ${symbol} returned ${res.status}`);
  return parseYahooChart(parseJsonFromReader(await res.text()), symbol, "yahoo-fallback");
}

async function fmpPrice(symbol: string): Promise<PriceResult> {
  const apiKey = String(process.env.FMP_API_KEY || "").trim();
  if (!apiKey) throw new Error("FMP key not configured");
  const data = await fetchJsonWithAttempts(
    `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}`,
    { headers: { "Accept": "application/json", "apikey": apiKey }, cache: "no-store" }, 1, 6000,
  );
  const quote = Array.isArray(data) ? data[0] : data;
  const price = parsePrice(quote?.price);
  if (!price) throw new Error(`No FMP quote for ${symbol}`);
  const timestamp = Number(quote?.timestamp);
  const date = Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return {
    price,
    date,
    source: "fmp",
    symbol: String(quote?.symbol || symbol),
    week52Low: parsePrice(quote?.yearLow ?? quote?.yearLowPrice) ?? undefined,
    week52High: parsePrice(quote?.yearHigh ?? quote?.yearHighPrice) ?? undefined,
  };
}

async function nasdaqPrice(symbol: string, assetType: string) {
  const clean = symbol.trim().replace(/\.(US|U)$/i, "");
  if (!clean || clean.includes(".")) throw new Error(`Nasdaq unsupported symbol ${symbol}`);
  const classes = assetType === "ETF" ? ["etf", "stocks"] : ["stocks", "etf"];
  const errors: string[] = [];
  for (const assetClass of classes) {
    try {
      const res = await fetchWithTimeout(`https://api.nasdaq.com/api/quote/${encodeURIComponent(clean)}/info?assetclass=${assetClass}`, {
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Origin": "https://www.nasdaq.com",
          "Referer": `https://www.nasdaq.com/market-activity/${assetClass}/${encodeURIComponent(clean.toLowerCase())}`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        },
        cache: "no-store",
      }, 4500);
      if (!res.ok) {
        errors.push(`Nasdaq ${assetClass} returned ${res.status}`);
        continue;
      }
      const data = await res.json();
      const primary = data.data?.primaryData;
      const price = parsePrice(primary?.lastSalePrice);
      if (price) {
        return {
          price,
          date: parseDate(primary?.lastTradeTimestamp),
          source: "nasdaq",
          symbol: clean,
        };
      }
      errors.push(data.status?.bCodeMessage?.[0]?.errorMessage || `No Nasdaq ${assetClass} price`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Nasdaq ${assetClass} failed`);
    }
  }
  throw new Error(errors.filter(Boolean).join("; ") || `No Nasdaq price for ${symbol}`);
}

async function nasdaqIntelligence(symbol: string, assetType: string): Promise<Partial<PriceResult>> {
  const clean = symbol.trim().replace(/\.(US|U)$/i, "");
  if (!clean || clean.includes(".")) return {};
  const assetClass = assetType === "ETF" ? "etf" : "stocks";
  const headers = {
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nasdaq.com",
    "Referer": `https://www.nasdaq.com/market-activity/${assetClass}/${encodeURIComponent(clean.toLowerCase())}`,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  };
  const [summaryResult, targetResult] = await Promise.allSettled([
    fetchJsonWithAttempts(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(clean)}/summary?assetclass=${assetClass}`,
      { headers, cache: "no-store" }, 1, 4500,
    ),
    assetClass === "stocks"
      ? fetchJsonWithAttempts(
          `https://api.nasdaq.com/api/analyst/${encodeURIComponent(clean)}/targetprice`,
          { headers, cache: "no-store" }, 1, 4500,
        )
      : Promise.resolve(null),
  ]);
  const summary = summaryResult.status === "fulfilled" ? summaryResult.value?.data?.summaryData : null;
  const rangeText = String(summary?.FiftTwoWeekHighLow?.value || "");
  const [rangeHigh, rangeLow] = rangeText.split("/").map((value) => parsePrice(value));
  const targetData = targetResult.status === "fulfilled" ? targetResult.value?.data?.consensusOverview : null;
  const targetPrice = parsePrice(targetData?.priceTarget) ?? parsePrice(summary?.OneYrTarget?.value);
  const today = new Date().toISOString().slice(0, 10);
  return {
    week52Low: rangeLow ?? undefined,
    week52High: rangeHigh ?? undefined,
    targetPrice: targetPrice ?? undefined,
    targetSource: targetPrice ? "nasdaq-analyst-consensus" : undefined,
    targetAsOn: targetPrice ? today : undefined,
  };
}

async function alphaVantageIntelligence(symbol: string): Promise<Partial<PriceResult>> {
  const apiKey = String(process.env.ALPHA_VANTAGE_API_KEY || "").trim();
  if (!apiKey) return {};
  const data = await fetchJsonWithAttempts(
    `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`,
    { cache: "no-store" }, 1, 6000,
  );
  if (data?.Note || data?.Information) throw new Error(data.Note || data.Information);
  const targetPrice = parsePrice(data?.AnalystTargetPrice);
  const week52Low = parsePrice(data?.["52WeekLow"]);
  const week52High = parsePrice(data?.["52WeekHigh"]);
  const today = new Date().toISOString().slice(0, 10);
  return {
    targetPrice: targetPrice ?? undefined,
    targetSource: targetPrice ? "alpha-vantage-analyst-target" : undefined,
    targetAsOn: targetPrice ? today : undefined,
    week52Low: week52Low ?? undefined,
    week52High: week52High ?? undefined,
  };
}

async function fmpIntelligence(symbol: string): Promise<Partial<PriceResult>> {
  const apiKey = String(process.env.FMP_API_KEY || "").trim();
  if (!apiKey) return {};
  const headers = { "Accept": "application/json", "apikey": apiKey };
  const targetResult = await fetchJsonWithAttempts(
    `https://financialmodelingprep.com/stable/price-target-consensus?symbol=${encodeURIComponent(symbol)}`,
    { headers, cache: "no-store" }, 1, 6000,
  );
  const targetPayload = Array.isArray(targetResult) ? targetResult[0] : targetResult;
  const targetPrice = parsePrice(
    targetPayload?.targetConsensus
    ?? targetPayload?.consensus
    ?? targetPayload?.targetMedian
    ?? targetPayload?.lastMonthAvgPriceTarget
    ?? targetPayload?.lastQuarterAvgPriceTarget,
  );
  const today = new Date().toISOString().slice(0, 10);
  return {
    targetPrice: targetPrice ?? undefined,
    targetSource: targetPrice ? "fmp-price-target-consensus" : undefined,
    targetAsOn: targetPrice ? today : undefined,
  };
}

async function twelveDataIntelligence(symbol: string, exchange?: string | null): Promise<Partial<PriceResult>> {
  const apiKey = String(process.env.TWELVE_DATA_API_KEY || "").trim();
  if (!apiKey) return {};
  const suffixPattern = /\.(NS|BO|SI|L|T|HK|AX|TO|DE|F|SW|MI|MC|SS|SZ|V|NZ|IR|LU|ST|OL|CO|KS|TW|TWO|JK|KL|BK|PS|VN|SA|MX|JO|PA|AS)$/i;
  const providerSymbol = exchange ? symbol.replace(suffixPattern, "") : symbol;
  const query = new URLSearchParams({ symbol: providerSymbol, apikey: apiKey });
  if (exchange && exchange !== "Other") query.set("exchange", exchange);
  const data = await fetchJsonWithAttempts(
    `https://api.twelvedata.com/price_target?${query.toString()}`,
    { cache: "no-store" }, 1, 6000,
  );
  if (data?.status === "error") throw new Error(data?.message || "Twelve Data target lookup failed.");
  const targetPrice = parsePrice(data?.price_target?.average ?? data?.price_target?.median);
  const today = new Date().toISOString().slice(0, 10);
  return {
    targetPrice: targetPrice ?? undefined,
    targetSource: targetPrice ? "twelve-data-analyst-average" : undefined,
    targetAsOn: targetPrice ? today : undefined,
  };
}

async function marketIntelligence(symbol: string, assetType: string, exchange?: string | null, needsRange = true): Promise<Partial<PriceResult>> {
  const providers = [
    { name: "yahoo-finance2", run: async () => {
      const result = await yahooFinance2Price(symbol);
      return {
        targetPrice: result.targetPrice,
        targetSource: result.targetSource,
        targetAsOn: result.targetAsOn,
        week52Low: result.week52Low,
        week52High: result.week52High,
      };
    } },
    { name: "fmp", run: () => fmpIntelligence(symbol) },
    { name: "nasdaq", run: () => nasdaqIntelligence(symbol, assetType) },
    { name: "twelve-data", run: () => twelveDataIntelligence(symbol, exchange) },
    { name: "alpha-vantage", run: () => alphaVantageIntelligence(symbol) },
  ];
  const intelligence: Partial<PriceResult> = {};
  for (const provider of providers) {
    try {
      const result = await provider.run();
      intelligence.targetPrice ??= result.targetPrice;
      intelligence.targetSource ??= result.targetSource;
      intelligence.targetAsOn ??= result.targetAsOn;
      intelligence.week52Low ??= result.week52Low;
      intelligence.week52High ??= result.week52High;
      const hasRequiredRange = !needsRange || Boolean(intelligence.week52Low && intelligence.week52High);
      if (intelligence.targetPrice && hasRequiredRange) break;
    } catch {
      // Move to the next provider. The first complete response wins.
    }
  }
  return intelligence;
}

async function yahooSearch(query: string) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  const headers = {
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  };
  try {
    const data = await fetchJsonWithAttempts(url, { headers, cache: "no-store" }, 2);
    return data.quotes || [];
  } catch {
    try {
      const res = await fetchWithTimeout(`https://r.jina.ai/http://${url}`, { headers, cache: "no-store" }, 10000);
      if (!res.ok) return [];
      const data = parseJsonFromReader(await res.text());
      return data.quotes || [];
    } catch {
      return [];
    }
  }
}

async function marketPrice(symbol: string, assetType: string): Promise<PriceResult> {
  const providers = [
    { name: "yahoo-finance2", run: () => yahooFinance2Price(symbol) },
    { name: "fmp", run: () => fmpPrice(symbol) },
    { name: "yahoo", run: () => yahooPrice(symbol) },
    { name: "nasdaq", run: () => nasdaqPrice(symbol, assetType) },
    { name: "yahoo-fallback", run: () => yahooFallbackPrice(symbol) },
  ];
  const results: PriceResult[] = [];
  const errors: string[] = [];

  function bestResult() {
    const ordered = [...results].sort((a, b) => {
      const aDate = parseFlexibleDate(a.date)?.getTime() || 0;
      const bDate = parseFlexibleDate(b.date)?.getTime() || 0;
      if (aDate !== bDate) return bDate - aDate;
      return ["yahoo-finance2", "fmp", "yahoo", "yahoo-fallback", "nasdaq"].indexOf(a.source) - ["yahoo-finance2", "fmp", "yahoo", "yahoo-fallback", "nasdaq"].indexOf(b.source);
    });
    const primary = ordered[0];
    const richest = ordered.find((item) => item.week52Low || item.week52High) || primary;
    return {
      ...primary,
      week52Low: primary.week52Low ?? richest.week52Low,
      week52High: primary.week52High ?? richest.week52High,
    };
  }

  const running = providers.map(async (provider) => {
    try {
      results.push(await provider.run());
    } catch (error) {
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : "failed"}`);
    }
  });

  await Promise.race([Promise.allSettled(running), sleep(1800)]);
  if (results.length) return bestResult();

  await Promise.allSettled(running);
  if (results.length) return bestResult();

  throw new Error(errors.join("; "));
}

function overrideSymbol(sec: Security) {
  return tickerOverrides[`${sec.name.trim().toLowerCase()}|${sec.currency.toUpperCase()}`];
}

function looksLikeIsin(value: string) {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value.trim().toUpperCase());
}

function addSuffixCandidates(candidates: Set<string>, raw: string, sec: Security) {
  if (raw.includes(".") || looksLikeIsin(raw)) return;
  const exchangeSuffix = sec.exchange ? exchangeSuffixes[sec.exchange] || exchangeSuffixes[sec.exchange.toUpperCase()] : "";
  const countrySuffix = countrySuffixes[sec.country];
  const suffixes = [
    exchangeSuffix,
    countrySuffix,
    ...(currencySuffixes[sec.currency.toUpperCase()] || []),
  ].filter((suffix, index, arr) => suffix !== undefined && arr.indexOf(suffix) === index);

  for (const suffix of suffixes) {
    candidates.add(`${raw}${suffix}`);
  }
}

function directPriceSymbols(sec: Security) {
  const candidates = new Set<string>();
  const override = overrideSymbol(sec);
  if (override) candidates.add(override);

  const rawSymbols = [sec.priceSymbol, sec.ticker]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const raw of rawSymbols) {
    if (!looksLikeIsin(raw)) candidates.add(raw);
    addSuffixCandidates(candidates, raw.toUpperCase(), sec);
  }

  return [...candidates];
}

async function searchedPriceSymbols(sec: Security) {
  const searches = [
    sec.name,
    sec.name.split(/\s+/).slice(0, 4).join(" "),
    sec.name.split(/\s+/).slice(0, 3).join(" "),
  ].map((item) => item.trim()).filter(Boolean);
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const query of searches) {
    const quotes = await yahooSearch(query);
    const currencyMatches: any[] = [];
    const otherMatches: any[] = [];
    for (const quote of quotes) {
      const symbol = String(quote.symbol || "").trim();
      const quoteType = String(quote.quoteType || "").toUpperCase();
      if (!symbol || !preferredQuoteTypes.has(quoteType)) continue;
      if (String(quote.currency || "").toUpperCase() === sec.currency.toUpperCase()) {
        currencyMatches.push(quote);
      } else {
        otherMatches.push(quote);
      }
    }
    for (const quote of [...currencyMatches, ...otherMatches]) {
      const symbol = String(quote.symbol || "").trim();
      if (!seen.has(symbol)) {
        seen.add(symbol);
        candidates.push(symbol);
      }
    }
  }

  const firstWord = sec.name.trim().split(/\s+/)[0]?.toUpperCase();
  if (firstWord) {
    for (const suffix of currencySuffixes[sec.currency.toUpperCase()] || []) {
      const symbol = `${firstWord}${suffix}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        candidates.push(symbol);
      }
    }
  }

  return candidates;
}

async function marketPriceForSecurity(sec: Security) {
  const errors: string[] = [];
  const seen = new Set<string>();

  async function trySymbols(symbols: string[]) {
    for (const symbol of symbols) {
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      try {
        return await marketPrice(symbol, sec.assetType);
      } catch (error) {
        errors.push(`${symbol}: ${error instanceof Error ? error.message : "refresh failed"}`);
      }
    }
    return null;
  }

  async function enrich(result: PriceResult) {
    if (!result.symbol || (result.targetPrice && result.week52Low && result.week52High)) return result;
    try {
      const intelligence = await marketIntelligence(
        result.symbol,
        sec.assetType,
        sec.exchange,
        !(result.week52Low && result.week52High),
      );
      return {
        ...result,
        week52Low: intelligence.week52Low ?? result.week52Low,
        week52High: intelligence.week52High ?? result.week52High,
        targetPrice: intelligence.targetPrice ?? result.targetPrice,
        targetSource: intelligence.targetSource ?? result.targetSource,
        targetAsOn: intelligence.targetAsOn ?? result.targetAsOn,
      };
    } catch {
      return result;
    }
  }

  const direct = await trySymbols(directPriceSymbols(sec));
  if (direct) return enrich(direct);

  const searched = await trySymbols(await searchedPriceSymbols(sec));
  if (searched) return enrich(searched);

  const firstWord = sec.name.trim().split(/\s+/)[0]?.toUpperCase();
  const fallbackSymbols = firstWord ? (currencySuffixes[sec.currency.toUpperCase()] || []).map((suffix) => `${firstWord}${suffix}`) : [];
  const suffixed = await trySymbols(fallbackSymbols);
  if (suffixed) return enrich(suffixed);

  throw new Error(errors.join("; ") || "Missing identifier.");
}

async function mfCatalogue(): Promise<any[]> {
  if (mfCatalogueCache) return mfCatalogueCache;
  mfCatalogueCache = await fetchJsonWithAttempts("https://api.mfapi.in/mf", { cache: "no-store" }, 2, 30000);
  return mfCatalogueCache || [];
}

async function mfSearch(name: string) {
  for (const query of [name, normaliseFundName(name), name.split(/\s+/).slice(0, 5).join(" "), name.split(/\s+/).slice(0, 4).join(" ")]) {
    const q = query.trim();
    if (!q) continue;
    try {
      const matches = await fetchJsonWithAttempts(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`, { cache: "no-store" }, 2, 12000);
      if (matches?.length) return String(bestMfMatch(matches).schemeCode);
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveMfScheme(sec: Security) {
  const candidates = [sec.priceSymbol, sec.ticker, sec.isin, sec.name, normaliseFundName(sec.name)]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (/^\d+$/.test(candidate)) return candidate;
    const override = mfSchemeOverrides[candidate.toLowerCase()];
    if (override) return override;
  }

  const isin = candidates.find((candidate) => candidate.toUpperCase().startsWith("INF"));
  if (isin) {
    try {
      const upper = isin.toUpperCase();
      for (const scheme of await mfCatalogue()) {
        if (upper === String(scheme.isinGrowth || "").toUpperCase() || upper === String(scheme.isinDivReinvestment || "").toUpperCase()) {
          return String(scheme.schemeCode);
        }
      }
    } catch {
      // Fall through to name search.
    }
  }

  return mfSearch(sec.name);
}

async function mfPrice(code: string): Promise<PriceResult> {
  const encoded = encodeURIComponent(code);
  let data: any;
  try {
    data = await fetchJsonWithAttempts(`https://api.mfapi.in/mf/${encoded}/latest`, { cache: "no-store" }, 2, 8000);
  } catch {
    data = await fetchJsonWithAttempts(`https://api.mfapi.in/mf/${encoded}`, { cache: "no-store" }, 1, 12000);
  }
  const nav = data.data?.[0];
  if (!nav) throw new Error("No NAV");
  const navDate = parseFlexibleDate(String(nav.date));
  return {
    price: Number(nav.nav),
    date: navDate ? navDate.toISOString().slice(0, 10) : String(nav.date),
    source: "mfapi",
    symbol: code,
  };
}

async function resolveMfSchemeByName(sec: Security) {
  for (const candidate of [sec.name, normaliseFundName(sec.name)]) {
    const override = mfSchemeOverrides[String(candidate || "").trim().toLowerCase()];
    if (override) return override;
  }
  return mfSearch(sec.name);
}

async function mfPriceForSecurity(sec: Security) {
  const code = await resolveMfScheme(sec);
  if (!code) throw new Error("No mfapi match found. Enter the MFAPI scheme code manually.");
  const latest = await mfPrice(code);
  const navDate = parseFlexibleDate(latest.date);
  if (navDate && Date.now() - navDate.getTime() > 10 * 24 * 60 * 60 * 1000) {
    const fallbackCode = await resolveMfSchemeByName(sec);
    if (fallbackCode && fallbackCode !== code) {
      const fallback = await mfPrice(fallbackCode);
      const fallbackDate = parseFlexibleDate(fallback.date);
      if (!fallbackDate || Date.now() - fallbackDate.getTime() <= 10 * 24 * 60 * 60 * 1000) return fallback;
    }
    throw new Error(`mfapi scheme ${code} matched but NAV is stale (${latest.date}).`);
  }
  return latest;
}

export async function latestPriceForInput(input: {
  name: string;
  assetType: Security["assetType"];
  currency: string;
  country: string;
  ticker?: string | null;
  exchange?: string | null;
  identifierType?: string | null;
}) {
  const identifier = String(input.ticker || "").trim();
  const sec = {
    ...calculateAsset({ currentPrice: null, targetPrice: null, week52Low: null, week52High: null, allocation: null, lots: [] }),
    id: 0,
    portfolioId: 0,
    name: input.name,
    assetType: input.assetType,
    currency: input.currency,
    value: 0,
    valueInr: 0,
    annualIncome: null,
    returnPct: null,
    quantity: 1,
    ticker: input.identifierType === "ISIN" ? null : identifier || null,
    isin: input.identifierType === "ISIN" ? identifier || null : null,
    priceSource: null,
    priceSymbol: identifier || null,
    latestPrice: null,
    priceAsOn: null,
    latestValue: null,
    latestValueInr: null,
    refreshStatus: null,
    refreshNote: null,
    refreshedAt: null,
    country: input.country,
    pricingMode: "auto",
    exchange: input.exchange || null,
    costPrice: null,
    purchaseDate: null,
    targetPrice: null,
    targetSource: null,
    targetAsOn: null,
    week52Low: null,
    week52High: null,
    marketDataSource: null,
    marketDataAsOn: null,
    allocation: null,
    lots: [],
    source: "Quote",
  } satisfies Security;
  return sec.assetType === "Mutual Fund" && sec.currency === "INR" ? mfPriceForSecurity(sec) : marketPriceForSecurity(sec);
}

function bucketName(result: string) {
  if (result === "updated") return "updated";
  if (result === "manual") return "manual";
  if (result === "failed") return "failed";
  if (result === "unchanged") return "unchanged";
  return "not_refreshed";
}

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function refreshPrices(userId: string) {
  const securities = await getSecurities(userId);
  const fx = await getFx();
  const summary: any = { updated: 0, unchanged: 0, manual: 0, not_refreshed: 0, failed: 0, total: securities.length, byType: {}, details: [] };

  async function mark(sec: Security, result: string) {
    const bucket = bucketName(result);
    summary[bucket] += 1;
    summary.byType[sec.assetType] ||= { updated: 0, unchanged: 0, manual: 0, not_refreshed: 0, failed: 0 };
    summary.byType[sec.assetType][bucket] += 1;
  }

  await mapWithConcurrency(securities, 6, async (sec) => {
    try {
      if (["Savings", "Bond", "Other"].includes(sec.assetType) || sec.pricingMode === "manual") {
        await updateRefreshFieldsForSecurity(userId, sec, {
          refreshStatus: "manual_value",
          refreshNote: "Manual asset. User controls value.",
          latestValue: sec.latestValue ?? sec.value,
          latestValueInr: sec.latestValueInr ?? sec.valueInr,
        });
        await mark(sec, "manual");
        return;
      }

      const latest = sec.assetType === "Mutual Fund" && sec.currency === "INR" ? await mfPriceForSecurity(sec) : await marketPriceForSecurity(sec);
      if (!sec.quantity) {
        await updateRefreshFieldsForSecurity(userId, sec, {
          latestPrice: latest.price,
          priceAsOn: latest.date,
          week52Low: latest.week52Low ?? sec.week52Low,
          week52High: latest.week52High ?? sec.week52High,
          marketDataSource: latest.source,
          marketDataAsOn: latest.date,
          targetPrice: latest.targetPrice ?? sec.targetPrice,
          targetSource: latest.targetSource ?? sec.targetSource,
          targetAsOn: latest.targetAsOn ?? sec.targetAsOn,
          refreshStatus: "needs_quantity",
          refreshNote: "Price found but quantity missing.",
          priceSymbol: latest.symbol,
        });
        await mark(sec, "not_refreshed");
        return;
      }

      const latestValue = latest.price * sec.quantity;
      const latestValueInr = sec.currency === "INR" ? latestValue : latestValue * (fx[sec.currency] || 1);
      const manualTarget = sec.targetSource === "manual" ? sec.targetPrice : null;
      const effectiveTarget = manualTarget ?? latest.targetPrice ?? sec.targetPrice;
      const targetMissing = ["Stock", "ETF"].includes(sec.assetType) && !effectiveTarget;
      await updateRefreshFieldsForSecurity(userId, sec, {
        latestPrice: latest.price,
        priceAsOn: latest.date,
        week52Low: latest.week52Low ?? sec.week52Low,
        week52High: latest.week52High ?? sec.week52High,
        marketDataSource: latest.source,
        marketDataAsOn: latest.date,
        targetPrice: effectiveTarget,
        targetSource: manualTarget ? "manual" : latest.targetSource ?? sec.targetSource,
        targetAsOn: manualTarget ? sec.targetAsOn : latest.targetAsOn ?? sec.targetAsOn,
        latestValue,
        latestValueInr,
        refreshStatus: targetMissing ? "needs_target" : "updated",
        refreshNote: targetMissing
          ? `Price updated via ${latest.source}; no analyst target was returned by the configured providers.`
          : `Updated via ${latest.source} price ${latest.price} on ${latest.date}.`,
        priceSource: latest.source,
        priceSymbol: latest.symbol,
      });
      if (targetMissing) {
        summary.details.push({ name: sec.name, status: "needs_target", note: "Configure a global target provider or add a reviewed target override." });
        await mark(sec, "not_refreshed");
      } else {
        await mark(sec, "updated");
      }
    } catch (error) {
      const note = error instanceof Error ? error.message : "Refresh failed.";
      await updateRefreshFieldsForSecurity(userId, sec, {
        refreshStatus: "failed",
        refreshNote: note,
        latestValue: sec.latestValue ?? sec.value,
        latestValueInr: sec.latestValueInr ?? sec.valueInr,
      });
      summary.details.push({ name: sec.name, status: "failed", note });
      await mark(sec, "failed");
    }
  });
  summary.actionChanges = await syncActionHistory(userId);
  return summary;
}
