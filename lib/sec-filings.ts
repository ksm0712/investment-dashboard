import type { ResearchDocument } from "./ai-research-types.ts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SUPPORTED_FORMS = new Set(["10-K", "10-Q", "20-F", "40-F"]);
const MAX_FILING_BYTES = 4_000_000;

export class SecFilingError extends Error {
  readonly code: "unsupported" | "not_found" | "upstream";

  constructor(message: string, code: "unsupported" | "not_found" | "upstream") {
    super(message);
    this.name = "SecFilingError";
    this.code = code;
  }
}

function secHeaders() {
  return {
    Accept: "application/json,text/html;q=0.9,text/plain;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "User-Agent": process.env.SEC_USER_AGENT || "Thesis portfolio research app admin@example.com",
  };
}

async function fetchSecJson<T>(url: string, fetchImpl: FetchLike): Promise<T> {
  const response = await fetchImpl(url, { headers: secHeaders(), signal: AbortSignal.timeout(10_000), cache: "force-cache" });
  if (!response.ok) throw new SecFilingError(`SEC request failed with ${response.status}.`, "upstream");
  return response.json() as Promise<T>;
}

function normalizedTicker(ticker: string) {
  return ticker.trim().toUpperCase().replace(/[.-]/g, "");
}

function decodeHtmlEntities(text: string) {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", hellip: "…", ldquo: "“", lsquo: "‘", lt: "<", nbsp: " ",
    ndash: "–", quot: "\"", rdquo: "”", rsquo: "’", trade: "™",
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? match;
  });
}

export function filingHtmlToText(html: string) {
  return decodeHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<ix:header\b[^>]*>[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type CompanyTickerEntry = { cik_str: number; ticker: string; title: string };
type CompanySubmissions = {
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
      primaryDocument?: string[];
    };
  };
};

export async function fetchLatestSecFiling(ticker: string, fetchImpl: FetchLike = fetch): Promise<ResearchDocument> {
  const cleanTicker = normalizedTicker(ticker);
  if (!cleanTicker) throw new SecFilingError("A ticker is required for SEC research.", "unsupported");

  const tickerMap = await fetchSecJson<Record<string, CompanyTickerEntry>>(SEC_TICKERS_URL, fetchImpl);
  const company = Object.values(tickerMap).find((entry) => normalizedTicker(entry.ticker) === cleanTicker);
  if (!company) throw new SecFilingError(`${ticker} is not mapped to an SEC registrant. Paste report text instead.`, "unsupported");

  const cik = String(company.cik_str).padStart(10, "0");
  const submissions = await fetchSecJson<CompanySubmissions>(`https://data.sec.gov/submissions/CIK${cik}.json`, fetchImpl);
  const recent = submissions.filings?.recent;
  const forms = recent?.form || [];
  const index = forms.findIndex((form) => SUPPORTED_FORMS.has(form));
  const accession = recent?.accessionNumber?.[index];
  const primaryDocument = recent?.primaryDocument?.[index];
  const filingDate = recent?.filingDate?.[index] || null;
  if (index < 0 || !accession || !primaryDocument) {
    throw new SecFilingError(`No recent 10-K, 10-Q, 20-F, or 40-F was found for ${ticker}.`, "not_found");
  }

  const accessionPath = accession.replaceAll("-", "");
  const url = `https://www.sec.gov/Archives/edgar/data/${company.cik_str}/${accessionPath}/${primaryDocument}`;
  const response = await fetchImpl(url, { headers: secHeaders(), signal: AbortSignal.timeout(15_000), cache: "force-cache" });
  if (!response.ok) throw new SecFilingError(`SEC filing download failed with ${response.status}.`, "upstream");
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_FILING_BYTES) throw new SecFilingError("The SEC filing is too large to analyze safely.", "upstream");
  const html = (await response.text()).slice(0, MAX_FILING_BYTES);
  const text = filingHtmlToText(html);
  if (text.length < 200) throw new SecFilingError("The SEC filing did not contain enough readable text.", "upstream");

  return {
    title: `${submissions.name || company.title} ${forms[index]} filed ${filingDate || "recently"}`,
    text,
    url,
    date: filingDate,
  };
}
