import { getSecurities, updateRefreshFieldsForSecurity } from "./db";
import { getFx } from "./fx";
import type { Security } from "./types";

type PriceResult = {
  price: number;
  date: string;
  source: string;
  symbol?: string;
};

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

function parsePrice(value?: string | null) {
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
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
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

function yahooChartUrl(symbol: string) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
}

function parseYahooChart(data: any, symbol: string, source: string): PriceResult {
  if (data.chart?.error) throw new Error(data.chart.error.description || "Yahoo chart error");
  const result = data.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const timestamps = result?.timestamp || [];

  for (let i = closes.length - 1; i >= 0; i--) {
    if (Number.isFinite(Number(closes[i])) && Number(closes[i]) > 0) {
      return {
        price: Number(closes[i]),
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        source,
        symbol,
      };
    }
  }

  const marketPrice = Number(result?.meta?.regularMarketPrice);
  const marketTime = Number(result?.meta?.regularMarketTime);
  if (Number.isFinite(marketPrice) && marketPrice > 0) {
    return {
      price: marketPrice,
      date: marketTime ? new Date(marketTime * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      source,
      symbol,
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
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} returned ${res.status}`);
  return parseYahooChart(await res.json(), symbol, "yahoo");
}

async function yahooFallbackPrice(symbol: string) {
  const res = await fetchWithTimeout(`https://r.jina.ai/http://${yahooChartUrl(symbol)}`, {
    headers: {
      "Accept": "text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo fallback ${symbol} returned ${res.status}`);
  return parseYahooChart(parseJsonFromReader(await res.text()), symbol, "yahoo-fallback");
}

async function nasdaqPrice(symbol: string, assetType: string) {
  const clean = symbol.trim().replace(/\.(US|U)$/i, "");
  if (!clean || clean.includes(".")) throw new Error(`Nasdaq unsupported symbol ${symbol}`);
  const classes = assetType === "ETF" ? ["etf", "stocks"] : ["stocks", "etf"];
  const errors: string[] = [];
  for (const assetClass of classes) {
    try {
      const res = await fetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(clean)}/info?assetclass=${assetClass}`, {
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Origin": "https://www.nasdaq.com",
          "Referer": `https://www.nasdaq.com/market-activity/${assetClass}/${encodeURIComponent(clean.toLowerCase())}`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        },
        cache: "no-store",
      });
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
  const errors: string[] = [];
  try {
    return await yahooPrice(symbol);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Yahoo failed");
  }
  try {
    return await nasdaqPrice(symbol, assetType);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Nasdaq failed");
  }
  try {
    return await yahooFallbackPrice(symbol);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Yahoo fallback failed");
  }
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

  const direct = await trySymbols(directPriceSymbols(sec));
  if (direct) return direct;

  const searched = await trySymbols(await searchedPriceSymbols(sec));
  if (searched) return searched;

  const firstWord = sec.name.trim().split(/\s+/)[0]?.toUpperCase();
  const fallbackSymbols = firstWord ? (currencySuffixes[sec.currency.toUpperCase()] || []).map((suffix) => `${firstWord}${suffix}`) : [];
  const suffixed = await trySymbols(fallbackSymbols);
  if (suffixed) return suffixed;

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
  const data = await fetchJsonWithAttempts(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`, { cache: "no-store" }, 3, 25000);
  const nav = data.data?.[0];
  if (!nav) throw new Error("No NAV");
  return {
    price: Number(nav.nav),
    date: String(nav.date),
    source: "mfapi",
    symbol: code,
  };
}

async function mfPriceForSecurity(sec: Security) {
  const code = await resolveMfScheme(sec);
  if (!code) throw new Error("No mfapi match found. Enter the MFAPI scheme code manually.");
  const latest = await mfPrice(code);
  const navDate = parseFlexibleDate(latest.date);
  if (navDate && Date.now() - navDate.getTime() > 10 * 24 * 60 * 60 * 1000) {
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
          refreshStatus: "needs_quantity",
          refreshNote: "Price found but quantity missing.",
          priceSymbol: latest.symbol,
        });
        await mark(sec, "not_refreshed");
        return;
      }

      const latestValue = latest.price * sec.quantity;
      const latestValueInr = sec.currency === "INR" ? latestValue : latestValue * (fx[sec.currency] || 1);
      await updateRefreshFieldsForSecurity(userId, sec, {
        latestPrice: latest.price,
        priceAsOn: latest.date,
        latestValue,
        latestValueInr,
        refreshStatus: "updated",
        refreshNote: `Updated via ${latest.source} price ${latest.price} on ${latest.date}.`,
        priceSource: latest.source,
        priceSymbol: latest.symbol,
      });
      await mark(sec, "updated");
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
  return summary;
}
