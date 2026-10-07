"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, Check, CheckCircle2, ChevronRight, CircleAlert, ClipboardCheck, Database, Download, Globe2, LayoutDashboard, List, Plus, RotateCw, Search, ShieldCheck, SlidersHorizontal, Trash2, TrendingUp, X } from "lucide-react";
import type { ActionHistoryEntry, AddInvestmentInput, AssetType, SearchResult, Security, User } from "@/lib/types";
import { currencies, marketCurrency, marketExchanges, markets } from "@/lib/constants";
import { fmt, fmtDate, fmtDateTime, fmtPct, fmtPlain, fmtRelativeTime, fmtUnit, fromInr } from "@/lib/format";
import { portfolioAttention, portfolioHealthScore } from "@/lib/portfolio-insights";
import { portfolioCsv } from "@/lib/portfolio-export";
import ResearchPanel from "./research-panel";

function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width, overflow: body.style.overflow };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}

function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onEscape]);
}

type PortfolioPayload = {
  user: User;
  securities: Security[];
  fx: Record<string, number>;
  actionHistory: ActionHistoryEntry[];
};

type RefreshSummary = {
  updated: number;
  unchanged: number;
  manual: number;
  not_refreshed: number;
  failed: number;
  details?: Array<{ name: string; status: string; note: string }>;
  byType?: Record<string, Record<string, number>>;
};

const PORTFOLIO_CACHE_KEY = "investment-dashboard:portfolio:v2";
const WORKSPACE_PREFERENCES_KEY = "investment-dashboard:workspace:v1";
function readPortfolioCache(): PortfolioPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PORTFOLIO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user || !Array.isArray(parsed?.securities) || !parsed?.fx) return null;
    return parsed as PortfolioPayload;
  } catch {
    return null;
  }
}

function writePortfolioCache(payload: PortfolioPayload | null) {
  if (typeof window === "undefined") return;
  try {
    if (payload) window.sessionStorage.setItem(PORTFOLIO_CACHE_KEY, JSON.stringify(payload));
    else window.sessionStorage.removeItem(PORTFOLIO_CACHE_KEY);
  } catch {
    // The live API remains the source of truth if browser storage is unavailable.
  }
}

const assetTypes: AssetType[] = ["Stock", "ETF", "Mutual Fund", "Bond", "Savings", "Other"];

function ProductMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`product-mark ${small ? "small" : ""}`} aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

function googleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function Login() {
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand-lockup login-brand">
          <ProductMark />
          <div><strong>THESIS</strong><span>Portfolio intelligence</span></div>
        </div>
        <div className="login-story-copy">
          <div className="eyebrow light">Decision-grade portfolio tracking</div>
          <h1>Know what changed.<br /><em>Know what to do.</em></h1>
          <p>Live global market data, purchase-lot accounting, and a transparent decision engine—built into one calm portfolio register.</p>
        </div>
        <div className="login-capabilities">
          <div><Globe2 size={17} /><span><b>Global coverage</b>US and international holdings</span></div>
          <div><Database size={17} /><span><b>Lot-level accuracy</b>Every purchase stays auditable</span></div>
          <div><TrendingUp size={17} /><span><b>Action signals</b>Excel logic, continuously updated</span></div>
        </div>
        <div className="login-gridlines" aria-hidden="true" />
      </section>
      <section className="login-access">
        <div className="login-card">
          <div className="access-seal"><ShieldCheck size={18} /></div>
          <div className="eyebrow">Private workspace</div>
          <h2>Welcome to Thesis</h2>
          <p>Your portfolio, calculations, and recommendation history are isolated to your account.</p>
          <a className="google-login-btn" href="/api/auth/google">
            {googleIcon()}
            Continue with Google
          </a>
          <div className="login-note">Secure Google authentication · No passwords stored</div>
        </div>
      </section>
    </main>
  );
}

function metricStats(securities: Security[], fx: Record<string, number>) {
  const totalInr = securities.reduce((sum, s) => sum + (s.latestValueInr ?? s.valueInr ?? 0), 0);
  const costInr = securities.reduce((sum, s) => sum + ((s.investedCost || 0) * (fx[s.currency] || 1)), 0);
  const gainInr = totalInr - costInr;
  const gainPct = costInr ? (gainInr / costInr) * 100 : null;
  return { totalInr, costInr, gainInr, gainPct };
}

function PortfolioOverview({
  securities,
  stats,
  currentCurrency,
  fx,
  marketLabel,
  onSelect,
}: {
  securities: Security[];
  stats: ReturnType<typeof metricStats>;
  currentCurrency: string;
  fx: Record<string, number>;
  marketLabel: string;
  onSelect: (id: number) => void;
}) {
  const attention = portfolioAttention(securities);
  const health = portfolioHealthScore(securities);
  const queue = attention.actionable.length ? attention.actionable : [...attention.incomplete, ...attention.stale.filter((item) => !attention.incomplete.some((entry) => entry.id === item.id))];
  const setupCount = attention.incomplete.length;
  const staleCount = attention.stale.length;

  return (
    <section className="overview-grid" id="overview" aria-label="Portfolio overview">
      <div className="portfolio-summary-card">
        <div className="summary-card-head">
          <div>
            <span className="section-label">{marketLabel}</span>
            <h1>{fmt(fromInr(stats.totalInr, currentCurrency, fx), currentCurrency)}</h1>
            <p>Market value across {securities.length} position{securities.length === 1 ? "" : "s"}</p>
          </div>
          <div className={`return-pill ${(stats.gainPct || 0) >= 0 ? "positive" : "negative"}`}>
            <span>Total return</span>
            <strong>{fmtPct(stats.gainPct, true)}</strong>
          </div>
        </div>
        <div className="summary-stat-row">
          <div><span>Invested</span><strong>{stats.costInr ? fmt(fromInr(stats.costInr, currentCurrency, fx), currentCurrency) : "—"}</strong></div>
          <div><span>Unrealized P&amp;L</span><strong className={(stats.gainPct || 0) >= 0 ? "good" : "bad"}>{stats.costInr ? fmt(fromInr(stats.gainInr, currentCurrency, fx), currentCurrency) : "—"}</strong></div>
          <div><span>Needs a decision</span><strong>{attention.actionable.length}</strong></div>
          <div><span>Portfolio health</span><strong>{health}<small>/100</small></strong></div>
        </div>
        <div className="health-track" aria-label={`Portfolio health ${health} out of 100`}><span style={{ width: `${health}%` }} /></div>
        <div className="summary-foot">
          <span>{setupCount ? `${setupCount} position${setupCount === 1 ? "" : "s"} need setup` : "Every position has decision inputs"}</span>
          <span>{staleCount ? `${staleCount} market price${staleCount === 1 ? " is" : "s are"} stale` : "Market data is current"}</span>
          <span>Largest position {fmtPct(attention.largestWeight * 100)}</span>
        </div>
      </div>

      <aside className="attention-card" id="decisions">
        <div className="attention-card-head">
          <div><span className="section-label">Decision queue</span><h2>{queue.length ? `${queue.length} item${queue.length === 1 ? "" : "s"} to review` : "You’re up to date"}</h2></div>
          <span className={`queue-status ${queue.length ? "active" : "clear"}`}>{queue.length ? "Open" : <><Check size={12} /> Clear</>}</span>
        </div>
        <div className="attention-list">
          {queue.slice(0, 4).map((item) => {
            const needsSetup = item.action === "Insufficient Data" || item.allocation === null || !item.targetPrice;
            return (
              <button key={item.id} onClick={() => onSelect(item.id)}>
                <span className={`queue-dot ${item.action.toLowerCase().replaceAll(" ", "-")}`} />
                <span><strong>{item.name}</strong><small>{needsSetup ? "Complete missing decision inputs" : item.actionReasons[0] || "Review the current signal"}</small></span>
                <span className="queue-action">{needsSetup ? "Set up" : item.action}<ChevronRight size={14} /></span>
              </button>
            );
          })}
          {!queue.length && <div className="queue-empty"><Check size={17} /><span><strong>No immediate follow-up</strong><small>Signals and market data are current.</small></span></div>}
        </div>
        {queue.length > 4 && <div className="queue-more">+{queue.length - 4} more in the holdings register</div>}
      </aside>
    </section>
  );
}

function Toast({ message, tone, onClose }: { message: string; tone: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 5_000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);
  return (
    <div className={`app-toast ${tone}`} role="status">
      {tone === "success" ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
      <span>{message}</span>
      <button onClick={onClose} aria-label="Dismiss notification"><X size={14} /></button>
    </div>
  );
}

function AddInvestmentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> | void }) {
  useLockBodyScroll(true);
  useEscapeKey(true, onClose);
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("Stock");
  const [country, setCountry] = useState("India");
  const [identifierType, setIdentifierType] = useState("Ticker");
  const [ticker, setTicker] = useState("");
  const [exchange, setExchange] = useState("NSE");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [allocation, setAllocation] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [targetSource, setTargetSource] = useState("");
  const [targetAsOn, setTargetAsOn] = useState("");
  const [week52Low, setWeek52Low] = useState("");
  const [week52High, setWeek52High] = useState("");
  const [priceSource, setPriceSource] = useState("");
  const [priceAsOn, setPriceAsOn] = useState("");
  const [matches, setMatches] = useState<SearchResult[]>([]);
  const [matchIndex, setMatchIndex] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const localSearchCache = useRef<Record<string, SearchResult[]>>({});
  const quoteCache = useRef<Record<string, Record<string, unknown>>>({});
  const quoteRequestId = useRef(0);
  const suppressNextSearch = useRef(false);
  const searchRequestId = useRef(0);

  const exchanges = marketExchanges[country] || ["Other"];
  const formCurrency = marketCurrency[country] || "USD";
  const positionPreview = useMemo(() => {
    const q = Number(quantity);
    const cost = Number(costPrice);
    const price = Number(currentPrice);
    const limit = Number(allocation);
    if (!(q > 0) || !(cost > 0)) return null;
    const invested = q * cost;
    const marketValue = price > 0 ? q * price : null;
    const gain = marketValue === null ? null : marketValue - invested;
    const gainPct = gain === null || invested <= 0 ? null : (gain / invested) * 100;
    return { invested, marketValue, gain, gainPct, remaining: limit > 0 ? limit - invested : null };
  }, [quantity, costPrice, currentPrice, allocation]);

  useEffect(() => {
    if (suppressNextSearch.current) {
      suppressNextSearch.current = false;
      return;
    }
    if (name.trim().length < 2) {
      searchRequestId.current += 1;
      setMatches([]);
      setSearchNotice("");
      return;
    }
    const timer = setTimeout(() => { search(); }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  async function search() {
    const key = name.trim().toLowerCase();
    if (!key) {
      setMatches([]);
      setSearchNotice("");
      return;
    }
    if (localSearchCache.current[key]) {
      const cachedResults = localSearchCache.current[key];
      setMatches(cachedResults);
      setMatchIndex("");
      setSearchNotice(cachedResults.length ? "" : `No matches found for "${name.trim()}". Try the ticker or full asset name.`);
      return;
    }
    setError("");
    setSearchNotice("");
    const requestId = ++searchRequestId.current;
    try {
      setSearching(true);
      const res = await fetch(`/api/search?q=${encodeURIComponent(name.trim())}`);
      const data = await res.json();
      if (requestId !== searchRequestId.current) return;
      if (!res.ok) throw new Error(data.error || "Search could not load results.");
      const results = data.results || [];
      localSearchCache.current[key] = results;
      setMatchIndex("");
      setMatches(results);
      setSearchNotice(results.length ? "" : `No matches found for "${name.trim()}". Try the ticker or full asset name.`);
    } catch {
      if (requestId !== searchRequestId.current) return;
      setMatches([]);
      setSearchNotice("");
      setError("Search could not load results. Try again.");
    } finally {
      if (requestId === searchRequestId.current) setSearching(false);
    }
  }

  async function fetchCurrentPrice(match: SearchResult) {
    if (!["Stock", "ETF", "Mutual Fund"].includes(match.assetType)) return;
    const currency = marketCurrency[match.country] || "USD";
    const key = `${match.assetType}|${match.ticker}|${currency}`;
    function applyQuote(quote: Record<string, unknown>) {
      const price = Number(quote.price);
      if (Number.isFinite(price) && price > 0) setCurrentPrice(String(Number(price.toFixed(6))));
      const target = Number(quote.targetPrice);
      setTargetPrice(Number.isFinite(target) && target > 0 ? String(Number(target.toFixed(6))) : "");
      setTargetSource(String(quote.targetSource || ""));
      setTargetAsOn(String(quote.targetAsOn || ""));
      const low = Number(quote.week52Low);
      const high = Number(quote.week52High);
      setWeek52Low(Number.isFinite(low) && low > 0 ? String(Number(low.toFixed(6))) : "");
      setWeek52High(Number.isFinite(high) && high > 0 ? String(Number(high.toFixed(6))) : "");
      setPriceSource(String(quote.source || ""));
      setPriceAsOn(String(quote.date || ""));
    }
    if (quoteCache.current[key]) {
      applyQuote(quoteCache.current[key]);
      return;
    }
    const requestId = ++quoteRequestId.current;
    try {
      setQuoteBusy(true);
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: match.name,
          assetType: match.assetType,
          country: match.country,
          currency,
          ticker: match.ticker,
          exchange: match.exchange,
          identifierType: match.identifierType,
        }),
      });
      const data = await res.json();
      if (res.ok && data.quote) {
        quoteCache.current[key] = data.quote;
        if (requestId === quoteRequestId.current) applyQuote(data.quote);
      }
    } finally {
      if (requestId === quoteRequestId.current) setQuoteBusy(false);
    }
  }

  function applyMatch(indexValue: string) {
    const match = matches[Number(indexValue)];
    if (!match) return;
    setMatchIndex(indexValue);
    searchRequestId.current += 1;
    setSearching(false);
    suppressNextSearch.current = true;
    setName(match.name);
    setMatches([]);
    setSearchNotice("");
    setAssetType(match.assetType);
    setCountry(match.country);
    setTicker(match.ticker);
    setExchange(match.exchange || (marketExchanges[match.country] || ["Other"])[0]);
    setIdentifierType(match.identifierType);
    setCurrentPrice("");
    setTargetPrice("");
    setTargetSource("");
    setTargetAsOn("");
    setWeek52Low("");
    setWeek52High("");
    setPriceSource("");
    setPriceAsOn("");
    fetchCurrentPrice(match);
  }

  async function save() {
    setError("");
    const q = Number(quantity);
    const c = Number(costPrice);
    const p = Number(currentPrice);
    if (!name.trim() || !country.trim()) return setError("Add the asset name and market / country.");
    if (["Stock", "ETF", "Mutual Fund"].includes(assetType) && !ticker.trim()) return setError("Add the identifier for this asset.");
    if (!q || q <= 0) return setError("Add quantity bought.");
    if (!c || c <= 0) return setError("Add cost price.");
    if (!p || p <= 0) return setError("Add current price.");
    const alloc = Number(allocation);
    if (!alloc || alloc <= 0) return setError("Add an allocation limit. Buy and Review to Buy signals stay off for this asset until it has one.");
    const currency = marketCurrency[country] || "USD";
    const input: AddInvestmentInput = {
      name: name.trim(),
      assetType,
      country,
      currency,
      pricingMode: ["Stock", "ETF", "Mutual Fund"].includes(assetType) ? "auto" : "manual",
      quantity: q,
      costPrice: c,
      currentPrice: p,
      priceSymbol: ticker.trim(),
      priceSource: priceSource || null,
      priceAsOn: priceAsOn || null,
      exchange: ticker.trim() ? exchange : undefined,
      purchaseDate,
      allocation: allocation ? Number(allocation) : null,
      targetPrice: targetPrice ? Number(targetPrice) : null,
      targetSource: targetSource || (targetPrice ? "manual" : null),
      targetAsOn: targetAsOn || (targetPrice ? new Date().toISOString().slice(0, 10) : null),
      week52Low: week52Low ? Number(week52Low) : null,
      week52High: week52High ? Number(week52High) : null,
    };
    try {
      setBusy(true);
      const res = await fetch("/api/investments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return setError(data?.error || "Could not save investment. Please try again.");
      }
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save investment. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-investment-title">
        <div className="modal-head">
          <div><div className="eyebrow">Portfolio entry</div><div className="modal-title" id="add-investment-title">Add an investment</div><p>Search a security, confirm your purchase, and Thesis will build the live position.</p></div>
          <button className="x-btn" onClick={onClose} aria-label="Close"><X size={26} /></button>
        </div>
        <div className="form-section-title"><span>01</span>Asset</div>
        <div className="field autocomplete-field">
          <label>Asset name</label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setMatches([]); setMatchIndex(""); setSearchNotice(""); }}
            placeholder="Apple Inc, UTI Nifty 50 Index Fund, DBS Savings"
            autoComplete="off"
          />
          {matches.length > 0 && (
            <div className="autocomplete-dropdown" role="listbox">
              {matches.map((match, index) => (
                <button type="button" key={`${match.ticker}-${index}`} className="autocomplete-option" onClick={() => applyMatch(String(index))}>
                  {match.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {searching && <div className="busy-note">Searching…</div>}
        {!searching && searchNotice && <div className="search-note">{searchNotice}</div>}
        {quoteBusy && <div className="busy-note">Fetching current price...</div>}
        {matchIndex !== "" && <div className="form-hint">Autofilled — edit any field below if needed</div>}
        <div className="form-grid grid-3" style={{ marginTop: 18 }}>
          <div className="field">
            <label>Asset type</label>
            <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>{assetTypes.map((type) => <option key={type}>{type}</option>)}</select>
          </div>
          <div className="field">
            <label>Market / country</label>
            <select value={country} onChange={(e) => { const nextCountry = e.target.value; setCountry(nextCountry); setExchange((marketExchanges[nextCountry] || ["Other"])[0]); }}>{markets.map((market) => <option key={market}>{market}</option>)}</select>
          </div>
          <div className="field">
            <label>Currency</label>
            <input value={formCurrency} readOnly />
          </div>
        </div>
        <div className="form-section-title"><span>02</span>Identifier</div>
        {["Stock", "ETF", "Mutual Fund", "Bond"].includes(assetType) ? (
          <div className="form-grid grid-3">
            <div className="field">
              <label>Identifier type</label>
              <select value={identifierType} onChange={(e) => setIdentifierType(e.target.value)}>
                {(assetType === "Mutual Fund" ? ["Scheme code", "ISIN"] : assetType === "Bond" ? ["None", "ISIN"] : ["Ticker", "ISIN"]).map((type) => <option key={type}>{type}</option>)}
              </select>
            </div>
            <div className="field">
              <label>{identifierType}</label>
              <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder={identifierType === "Ticker" ? "AAPL, VOO, D05" : "US0378331005"} />
            </div>
            <div className="field">
              <label>Exchange</label>
              <select value={exchange} onChange={(e) => setExchange(e.target.value)}>{exchanges.map((item) => <option key={item}>{item}</option>)}</select>
            </div>
          </div>
        ) : <div className="alloc-meta">No ticker or scheme code needed for this asset type.</div>}
        <div className="form-section-title"><span>03</span>Position</div>
        <div className="form-grid grid-4">
          <div className="field"><label>Quantity bought</label><input type="number" inputMode="decimal" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="1.000000" /></div>
          <div className="field"><label>Cost price</label><input type="number" inputMode="decimal" min="0" step="any" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="100.00" /></div>
          <div className="field"><label>Date bought</label><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></div>
          <div className="field"><label>Current price</label><input type="number" inputMode="decimal" min="0" step="any" value={currentPrice} onChange={(e) => { setCurrentPrice(e.target.value); setPriceSource("manual"); setPriceAsOn(new Date().toISOString().slice(0, 10)); }} placeholder="150.00" /></div>
        </div>
        <div className="form-section-title"><span>04</span>Decision inputs</div>
        <div className="form-grid grid-4">
          <div className="field">
            <label>Allocation limit (required)</label>
            <input type="number" inputMode="decimal" min="0" step="any" value={allocation} onChange={(e) => setAllocation(e.target.value)} placeholder="50000" />
          </div>
          <div className="field"><label>Analyst target</label><input type="number" inputMode="decimal" min="0" step="any" value={targetPrice} onChange={(e) => { setTargetPrice(e.target.value); setTargetSource("manual"); setTargetAsOn(new Date().toISOString().slice(0, 10)); }} placeholder={quoteBusy ? "Fetching…" : "Auto-filled when available"} /></div>
          <div className="field"><label>52-week low</label><input value={week52Low} readOnly placeholder="Auto-filled" /></div>
          <div className="field"><label>52-week high</label><input value={week52High} readOnly placeholder="Auto-filled" /></div>
        </div>
        <div className="form-hint alloc-hint">The most you&apos;re willing to invest in this asset. Buy and Review to Buy never trigger without it.</div>
        {targetPrice && <div className="provider-note">Target source: {targetSource || "manual"}{targetAsOn ? ` · ${fmtDate(targetAsOn)}` : ""}</div>}
        <section className="position-preview" aria-label="New position preview">
          <div className="position-preview-head"><span className="section-label">Position preview</span><strong>{name.trim() || "New investment"}</strong></div>
          {positionPreview ? <div className="position-preview-grid">
            <div><span>Invested cost</span><strong>{fmt(positionPreview.invested, formCurrency)}</strong></div>
            <div><span>Market value</span><strong>{positionPreview.marketValue === null ? "Add current price" : fmt(positionPreview.marketValue, formCurrency)}</strong></div>
            <div><span>Current return</span><strong className={(positionPreview.gain || 0) >= 0 ? "good" : "bad"}>{positionPreview.gainPct === null ? "—" : fmtPct(positionPreview.gainPct, true)}</strong></div>
            <div><span>Allocation left</span><strong className={(positionPreview.remaining ?? 0) < 0 ? "bad" : ""}>{positionPreview.remaining === null ? "Set a limit" : fmt(positionPreview.remaining, formCurrency)}</strong></div>
          </div> : <p>Add quantity and cost price to preview the position before saving.</p>}
        </section>
        {error && <div className="bad" style={{ marginTop: 14, fontWeight: 700 }}>{error}</div>}
        <div className="modal-footer">
          <span>Market data refreshes automatically after saving.</span>
          <button type="button" className="save-btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Add to portfolio"}<ArrowRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function marketFreshness(item: Security) {
  const raw = item.marketDataAsOn || item.priceAsOn || item.refreshedAt;
  const timestamp = raw ? new Date(raw).getTime() : NaN;
  const ageDays = Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 86_400_000) : Infinity;
  return { stale: ageDays > 7, date: raw };
}

const ACTION_PRIORITY: Record<string, number> = {
  Sell: 0,
  "Review to Sell": 1,
  Buy: 2,
  "Review to Buy": 3,
  "Insufficient Data": 4,
  "Continue to Monitor": 5,
};

const ACTION_FILTERS = ["All", "Sell", "Review to Sell", "Buy", "Review to Buy", "Continue to Monitor", "Insufficient Data"];


const ALERTS_SEEN_KEY = "investment-dashboard:alerts:lastSeen";
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function AlertsBell({ actionHistory, onSelect }: { actionHistory: ActionHistoryEntry[]; onSelect: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState("");

  useEffect(() => {
    setLastSeen(window.localStorage.getItem(ALERTS_SEEN_KEY) || "");
  }, []);

  const changes = useMemo(() => actionHistory.filter((entry) => entry.previousAction), [actionHistory]);
  const unread = changes.filter((entry) => !lastSeen || entry.recordedAt > lastSeen).length;
  useEscapeKey(open, () => setOpen(false));

  function toggle() {
    setOpen((current) => {
      const next = !current;
      if (next) {
        const now = new Date().toISOString();
        window.localStorage.setItem(ALERTS_SEEN_KEY, now);
        setLastSeen(now);
      }
      return next;
    });
  }

  return (
    <div className="alerts-wrap">
      <button className="icon-btn alerts-bell" onClick={toggle} aria-label="Recommendation alerts" aria-expanded={open} aria-haspopup="dialog">
        <Bell size={17} />
        {unread > 0 && <span className="alerts-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="alerts-backdrop" onClick={() => setOpen(false)} />
          <div className="alerts-panel" role="dialog" aria-label="Recent recommendation changes">
            <div className="alerts-panel-head"><span>Recommendation changes</span><small>{changes.length} recorded</small></div>
            {changes.length === 0 && (
              <div className="alerts-empty">No recommendation changes yet. You&apos;ll see updates here the moment a holding&apos;s action changes, like Continue to Monitor flipping to Buy.</div>
            )}
            <div className="alerts-list">
              {changes.slice(0, 25).map((entry) => (
                <button key={entry.id} className="alert-item" onClick={() => { onSelect(entry.securityId); setOpen(false); }}>
                  <div className="alert-item-top"><strong>{entry.securityName}</strong><span className="alert-time" title={fmtDateTime(entry.recordedAt)}>{fmtRelativeTime(entry.recordedAt)}</span></div>
                  <div className="alert-item-transition">
                    <span className={`action-badge small ${(entry.previousAction || "").toLowerCase().replaceAll(" ", "-")}`}>{entry.previousAction}</span>
                    <ArrowRight size={11} />
                    <span className={`action-badge small ${entry.action.toLowerCase().replaceAll(" ", "-")}`}>{entry.action}</span>
                  </div>
                  {entry.reasons[0] && <p className="alert-reason">{entry.reasons[0]}</p>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Holdings({ securities, totalInr, fx, displayCurrency, reload, onDelete, focusId, emptyMessage, density, actionHistory }: {
  securities: Security[];
  totalInr: number;
  fx: Record<string, number>;
  displayCurrency: string;
  reload: () => void;
  onDelete: (id: number) => void;
  focusId: number | null;
  emptyMessage: string;
  density: "comfortable" | "compact";
  actionHistory: ActionHistoryEntry[];
}) {
  type SortKey = "priority" | "value" | "return" | "change" | "name";
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editorAsset, setEditorAsset] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [lotDraft, setLotDraft] = useState<Record<string, string>>({ purchaseDate: new Date().toISOString().slice(0, 10) });
  const [editingLot, setEditingLot] = useState<number | null>(null);
  const [deletingLot, setDeletingLot] = useState<number | null>(null);
  const [allocationDraft, setAllocationDraft] = useState<Record<number, string>>({});
  const [marketDraft, setMarketDraft] = useState<Record<number, { target?: string; secondaryTarget?: string; low?: string; high?: string }>>({});
  const [message, setMessage] = useState<Record<number, string>>({});
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  useLockBodyScroll(editorAsset !== null);
  useEscapeKey(editorAsset !== null, () => setEditorAsset(null));
  const rows = [...securities].sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name);
    if (sortKey === "value") return (b.latestValueInr ?? b.valueInr) - (a.latestValueInr ?? a.valueInr);
    if (sortKey === "return") return (b.gainPct ?? -Infinity) - (a.gainPct ?? -Infinity);
    if (sortKey === "change") return (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity);
    const rank = (ACTION_PRIORITY[a.action] ?? 9) - (ACTION_PRIORITY[b.action] ?? 9);
    if (rank !== 0) return rank;
    return (b.latestValueInr ?? b.valueInr) - (a.latestValueInr ?? a.valueInr);
  });

  function ratio(value: number | null, signed = false) {
    return fmtPct(value === null ? null : value * 100, signed);
  }

  function toggleDetails(id: number) {
    setExpanded((current) => current.has(id) ? new Set() : new Set([id]));
  }

  useEffect(() => {
    if (focusId === null) return;
    setExpanded(new Set([focusId]));
    const el = document.getElementById(`holding-${focusId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId]);

  function openEditor(id: number) {
    setEditorAsset(id);
    setEditingLot(null);
    setLotDraft({ purchaseDate: new Date().toISOString().slice(0, 10) });
  }

  function removeAsset(id: number) {
    setDeleting(null);
    onDelete(id);
  }

  async function saveAllocation(item: Security) {
    const draft = allocationDraft[item.id] ?? String(item.allocation ?? "");
    const allocation = Number(draft);
    const res = await fetch(`/api/investments/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allocation: Number.isFinite(allocation) && allocation >= 0 ? allocation : undefined,
      }),
    });
    setMessage((current) => ({ ...current, [item.id]: res.ok ? "Allocation saved." : "Could not save allocation." }));
    if (res.ok) await reload();
  }

  async function saveMarketInputs(item: Security) {
    const draft = marketDraft[item.id] || {};
    const target = Number(draft.target ?? String(item.targetPrice ?? ""));
    const secondaryTarget = Number(draft.secondaryTarget ?? String(item.secondaryTargetPrice ?? ""));
    const low = Number(draft.low ?? String(item.week52Low ?? ""));
    const high = Number(draft.high ?? String(item.week52High ?? ""));
    const body: Record<string, unknown> = {};
    if (Number.isFinite(target) && target > 0) {
      body.targetPrice = target;
      body.targetSource = "manual";
      body.targetAsOn = new Date().toISOString().slice(0, 10);
    }
    if (Number.isFinite(secondaryTarget) && secondaryTarget > 0) body.secondaryTargetPrice = secondaryTarget;
    if (Number.isFinite(low) && low > 0) body.week52Low = low;
    if (Number.isFinite(high) && high > 0) body.week52High = high;
    if (!Object.keys(body).length) {
      setMessage((current) => ({ ...current, [item.id]: "Enter a target price or 52-week range first." }));
      return;
    }
    const res = await fetch(`/api/investments/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setMessage((current) => ({ ...current, [item.id]: res.ok ? "Target and range saved." : "Could not save target and range." }));
    if (res.ok) await reload();
  }

  async function saveLot(item: Security) {
    const quantity = Number(lotDraft.quantity);
    const costPrice = Number(lotDraft.costPrice);
    const fees = Number(lotDraft.fees || 0);
    if (!(quantity > 0) || !(costPrice >= 0) || !(fees >= 0)) {
      setMessage((current) => ({ ...current, [item.id]: "Enter a positive quantity and valid cost values." }));
      return;
    }
    const url = editingLot ? `/api/lots/${editingLot}` : `/api/investments/${item.id}/lots`;
    const res = await fetch(url, {
      method: editingLot ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity, costPrice, fees, purchaseDate: lotDraft.purchaseDate || null }),
    });
    if (res.ok) {
      setEditingLot(null);
      setLotDraft({ purchaseDate: new Date().toISOString().slice(0, 10) });
      setMessage((current) => ({ ...current, [item.id]: "Purchase lots updated and asset totals recalculated." }));
      await reload();
    } else {
      const data = await res.json().catch(() => null);
      setMessage((current) => ({ ...current, [item.id]: data?.error || "Could not save purchase lot." }));
    }
  }

  async function removeLot(item: Security, lotId: number) {
    const res = await fetch(`/api/lots/${lotId}`, { method: "DELETE" });
    if (res.ok) {
      setDeletingLot(null);
      setMessage((current) => ({ ...current, [item.id]: "Purchase lot deleted and totals recalculated." }));
      await reload();
    } else {
      setMessage((current) => ({ ...current, [item.id]: "Could not delete this purchase lot. Nothing was changed." }));
    }
  }

  function beginLotEdit(lot: Security["lots"][number]) {
    setDeletingLot(null);
    setEditingLot(lot.id);
    setLotDraft({
      quantity: String(lot.quantity),
      costPrice: String(lot.costPrice),
      fees: String(lot.fees || ""),
      purchaseDate: lot.purchaseDate || "",
    });
  }

  if (!rows.length) return <div className="alloc-meta empty-holdings-note">{emptyMessage}</div>;
  return (
    <div className={`asset-register density-${density}`}>
      <div className="register-sort-row">
        <span>{rows.length} result{rows.length === 1 ? "" : "s"}</span>
        <label>Sort by<select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
          <option value="priority">Decision priority</option>
          <option value="value">Position value</option>
          <option value="return">Total return</option>
          <option value="change">Today&apos;s move</option>
          <option value="name">Name</option>
        </select></label>
      </div>
      <div className="holding-row holding-row-head" aria-hidden="true">
        <span className="holding-name-cell">Asset</span>
        <span className="holding-num-cell">Market value</span>
        <span className="holding-num-cell">Price</span>
        <span className="holding-num-cell">Today</span>
        <span className="holding-num-cell">Average cost</span>
        <span className="holding-num-cell">Total return</span>
        <span className="holding-action-cell">Action</span>
      </div>
      {rows.map((item) => {
        const isDetailsOpen = expanded.has(item.id);
        const isEditorOpen = editorAsset === item.id;
        const valueInr = item.latestValueInr ?? item.valueInr;
        const pct = totalInr ? (valueInr / totalInr) * 100 : 0;
        const allocation = allocationDraft[item.id] ?? String(item.allocation ?? "");
        const actionClass = item.action.toLowerCase().replaceAll(" ", "-");
        const freshness = marketFreshness(item);
        const convertedMarketValue = fromInr(valueInr, displayCurrency, fx);
        const investedCostInr = item.investedCost * (fx[item.currency] || 1);
        const itemHistory = actionHistory.filter((entry) => entry.securityId === item.id).slice(0, 6);
        const detailGroups: Array<{ title: string; subtitle: string; facts: Array<[string, string, string?]> }> = [
          {
            title: "Market & valuation",
            subtitle: "Live market data and the workbook valuation fields.",
            facts: [
              ["Market price", fmtUnit(item.latestPrice, item.currency)],
              ["Daily change", item.changePercent === null ? "—" : fmtPct(item.changePercent, true), item.changePercent === null ? "" : item.changePercent >= 0 ? "good" : "bad"],
              ["Analyst target", fmtUnit(item.targetPrice, item.currency)],
              ["Secondary target", fmtUnit(item.secondaryTargetPrice, item.currency)],
              ["Price to target", ratio(item.priceToTarget, true)],
              ["52-week low", fmtUnit(item.week52Low, item.currency)],
              ["Above 52-week low", ratio(item.pctAbove52WeekLow, true)],
              ["52-week high", fmtUnit(item.week52High, item.currency)],
              ["Below 52-week high", ratio(item.pctBelow52WeekHigh)],
              ["P/E (TTM)", fmtPlain(item.trailingPe, 2)],
              ["Forward P/E", fmtPlain(item.forwardPe, 2)],
              ["PEG ratio", fmtPlain(item.pegRatio, 2)],
            ],
          },
          {
            title: "Your position",
            subtitle: "Every purchase lot combined into one asset position.",
            facts: [
              ["Shares held", fmtPlain(item.sharesHeld, 4)],
              ["Average purchase", fmtUnit(item.averagePurchasePrice, item.currency)],
              ["Price to average", ratio(item.pctAboveAveragePurchase, true)],
              ["Lowest purchase", fmtUnit(item.lowestPurchasePrice, item.currency)],
              ["Above lowest purchase", ratio(item.pctAboveLowestPurchase, true)],
              ["Market value", fmt(item.marketValue, item.currency)],
              ["Invested cost", fmt(item.investedCost, item.currency)],
              ["Gain / loss", fmt(item.gainLoss, item.currency), (item.gainLoss ?? 0) >= 0 ? "good" : "bad"],
              ["Gain %", ratio(item.gainPct, true), (item.gainPct ?? 0) >= 0 ? "good" : "bad"],
              [`Value in ${displayCurrency}`, fmt(convertedMarketValue, displayCurrency)],
              [`Cost in ${displayCurrency}`, fmt(fromInr(investedCostInr, displayCurrency, fx), displayCurrency)],
            ],
          },
          {
            title: "Decision checks",
            subtitle: "The same trigger calculations and action hierarchy as the workbook.",
            facts: [
              ["Allocation", item.allocation === null ? "—" : fmt(item.allocation, item.currency)],
              ["To go", item.allocationRemaining === null ? "—" : fmt(item.allocationRemaining, item.currency), (item.allocationRemaining ?? 0) < 0 ? "bad" : ""],
              ["Aggressive sell trigger", fmtUnit(item.aggressiveSellTrigger, item.currency)],
              ["Above aggressive trigger", ratio(item.pctAboveAggressiveTrigger, true)],
              ["Conservative sell trigger", fmtUnit(item.conservativeSellTrigger, item.currency)],
              ["Above conservative trigger", ratio(item.pctAboveConservativeTrigger, true)],
              ["Current action", item.action],
            ],
          },
        ];
        return (
          <article className={`asset-row-shell action-${actionClass}`} key={item.id} id={`holding-${item.id}`}>
            <button className={`holding-row ${isDetailsOpen ? "open" : ""}`} onClick={() => toggleDetails(item.id)} aria-expanded={isDetailsOpen}>
              <span className="holding-name-cell">
                <i className={`row-chevron ${isDetailsOpen ? "open" : ""}`}>›</i>
                <span>
                  <strong>{item.name}</strong>
                  <small><b>{item.priceSymbol || item.ticker || item.exchange || item.assetType}</b><span>{item.assetType}</span><span>{pct.toFixed(1)}% weight</span></small>
                </span>
              </span>
              <span className="holding-num-cell" data-label="Market value">{fmt(item.marketValue, item.currency)}<small>{pct.toFixed(1)}% of portfolio</small></span>
              <span className="holding-num-cell" data-label="Price">{fmtUnit(item.latestPrice, item.currency)}</span>
              <span className={`holding-num-cell ${item.changePercent === null ? "" : item.changePercent >= 0 ? "good" : "bad"}`} data-label="Change">{item.changePercent === null ? "—" : fmtPct(item.changePercent, true)}</span>
              <span className="holding-num-cell" data-label="Average cost">{fmtUnit(item.averagePurchasePrice, item.currency)}</span>
              <span className={`holding-num-cell ${(item.gainLoss || 0) >= 0 ? "good" : "bad"}`} data-label="Total return">
                {fmt(item.gainLoss, item.currency)}<small>{ratio(item.gainPct, true)}</small>
              </span>
              <span className="holding-action-cell">
                <span className={`action-badge ${actionClass}`}>{item.action}</span>
              </span>
            </button>

            {isDetailsOpen && <div className="asset-expanded">
              <div className="expanded-summary-head">
                <div><div className="eyebrow">Position intelligence</div><strong>{item.name}</strong><p>{[item.sector, item.industry, item.country].filter(Boolean).join(" · ") || item.assetType}</p><p className="decision-rationale">{item.actionReasons.join(" ")}</p></div>
                <div className="asset-card-actions">
                  <div className="card-updated" title={`Market: ${item.marketDataSource || item.priceSource || "—"} · Target: ${item.targetSource || "not available"}`}>
                    {freshness.stale && <span className="freshness-warning">Price may be outdated</span>}
                    <span>Updated {fmtDate(freshness.date)}</span>
                  </div>
                  <button className="table-btn" onClick={() => openEditor(item.id)}>Lots &amp; allocation</button>
                  <button className="icon-btn danger" aria-label={`Delete ${item.name}`} onClick={() => setDeleting(deleting === item.id ? null : item.id)}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="asset-insight-layout" aria-label={`${item.name} portfolio details`}>
                {detailGroups.map((group) => <section className="detail-group" key={group.title}>
                  <div className="detail-group-head"><h3>{group.title}</h3><p>{group.subtitle}</p></div>
                  <div className="fact-list">{group.facts.map(([label, value, tone]) => <div className="fact-row" key={label}><span>{label}</span><strong className={tone}>{value}</strong></div>)}</div>
                </section>)}
                <div className="data-provenance">
                  <span><b>Currency</b> {item.currency}</span>
                  <span><b>Market source</b> {item.marketDataSource || item.priceSource || "—"}</span>
                  <span><b>Target source</b> {item.targetSource || "—"}</span>
                  <span><b>Data date</b> {fmtDate(item.marketDataAsOn || item.priceAsOn)}</span>
                </div>
              </div>
              {itemHistory.length > 0 && <section className="signal-history" aria-label={`Signal history for ${item.name}`}>
                <div className="signal-history-head"><div><span className="section-label">Decision history</span><h3>How the signal changed</h3></div><span>{itemHistory.length} recent update{itemHistory.length === 1 ? "" : "s"}</span></div>
                <div className="signal-history-list">{itemHistory.map((entry) => <div className="signal-history-item" key={entry.id}>
                  <span className="history-line"><i /></span>
                  <div><strong>{entry.previousAction ? `${entry.previousAction} → ${entry.action}` : entry.action}</strong><p>{entry.reasons.join(" ") || "Signal recalculated from the latest portfolio inputs."}</p></div>
                  <time title={fmtDateTime(entry.recordedAt)}>{fmtRelativeTime(entry.recordedAt)}</time>
                </div>)}</div>
              </section>}
              <ResearchPanel security={item} />
              {deleting === item.id && <div className="delete-panel"><div><b>Delete {item.name} and all its purchase lots?</b><span>This cannot be undone.</span></div><div><button className="table-btn danger" onClick={() => removeAsset(item.id)}>Delete investment</button><button className="table-btn" onClick={() => setDeleting(null)}>Cancel</button></div></div>}
            </div>
            }
            {isEditorOpen && (
              <div className="asset-editor-backdrop" role="dialog" aria-modal="true" aria-label={`Lots and allocation for ${item.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorAsset(null); }}>
              <div className="asset-editor">
                <div className="editor-title"><div><h3>Lots, allocation &amp; targets</h3><p>{item.name} · purchases are combined into the asset totals.</p></div><button className="icon-btn" aria-label="Close editor" onClick={() => setEditorAsset(null)}><X size={16} /></button></div>
                <div className="editor-allocation">
                  <div className="compact-form">
                    <label>Allocation amount ({item.currency})<input type="number" inputMode="decimal" min="0" step="any" value={allocation} onChange={(e) => setAllocationDraft((current) => ({ ...current, [item.id]: e.target.value }))} placeholder="Not set" /></label>
                    <button className="table-btn save-inline" onClick={() => saveAllocation(item)}>Save allocation</button>
                  </div>
                </div>
                <div className="editor-allocation">
                  <div className="detail-section-head"><div><h3>Target &amp; 52-week range</h3><p>Set these manually when a live provider can&apos;t supply them (common for ETFs), so Buy/Sell signals can activate.</p></div></div>
                  <div className="compact-form">
                    <label>Analyst target ({item.currency})<input type="number" inputMode="decimal" min="0" step="any" value={marketDraft[item.id]?.target ?? String(item.targetPrice ?? "")} onChange={(e) => setMarketDraft((current) => ({ ...current, [item.id]: { ...current[item.id], target: e.target.value } }))} placeholder="Not set" /></label>
                    <label>Secondary target ({item.currency})<input type="number" inputMode="decimal" min="0" step="any" value={marketDraft[item.id]?.secondaryTarget ?? String(item.secondaryTargetPrice ?? "")} onChange={(e) => setMarketDraft((current) => ({ ...current, [item.id]: { ...current[item.id], secondaryTarget: e.target.value } }))} placeholder="Optional" /></label>
                    <label>52-week low ({item.currency})<input type="number" inputMode="decimal" min="0" step="any" value={marketDraft[item.id]?.low ?? String(item.week52Low ?? "")} onChange={(e) => setMarketDraft((current) => ({ ...current, [item.id]: { ...current[item.id], low: e.target.value } }))} placeholder="Not set" /></label>
                    <label>52-week high ({item.currency})<input type="number" inputMode="decimal" min="0" step="any" value={marketDraft[item.id]?.high ?? String(item.week52High ?? "")} onChange={(e) => setMarketDraft((current) => ({ ...current, [item.id]: { ...current[item.id], high: e.target.value } }))} placeholder="Not set" /></label>
                    <button className="table-btn save-inline" onClick={() => saveMarketInputs(item)}>Save target &amp; range</button>
                  </div>
                </div>
                <div className="editor-lots">
                  <div className="detail-section-head"><div><h3>Purchase lots</h3></div><span>{item.lots.length} lot{item.lots.length === 1 ? "" : "s"}</span></div>
                  <div className="lots-table">
                    <div className="lot-row lot-head"><span>Date</span><span>Quantity</span><span>Cost price</span><span>Fees</span><span>Cost value</span><span /><span /></div>
                    {item.lots.map((lot) => <div className={`lot-row ${deletingLot === lot.id ? "confirming-delete" : ""}`} key={lot.id}><span>{fmtDate(lot.purchaseDate)}</span><span>{fmtPlain(lot.quantity, 4)}</span><span>{fmtUnit(lot.costPrice, item.currency)}</span><span>{fmtUnit(lot.fees, item.currency)}</span><strong>{fmt(lot.quantity * lot.costPrice + lot.fees, item.currency)}</strong>{deletingLot === lot.id ? <><button className="table-btn danger" onClick={() => removeLot(item, lot.id)}>Confirm</button><button className="icon-btn" aria-label="Cancel purchase lot deletion" onClick={() => setDeletingLot(null)}><X size={14} /></button></> : <><button className="table-btn" onClick={() => beginLotEdit(lot)}>Edit</button><button className="icon-btn danger" aria-label="Delete purchase lot" onClick={() => setDeletingLot(lot.id)}><Trash2 size={14} /></button></>}</div>)}
                    {!item.lots.length && <div className="empty-lots">No purchase lots yet. Add the first purchase below.</div>}
                  </div>
                  <div className="compact-form lot-form">
                    <label>Purchase date<input type="date" value={lotDraft.purchaseDate || ""} onChange={(e) => setLotDraft({ ...lotDraft, purchaseDate: e.target.value })} /></label>
                    <label>Quantity<input type="number" inputMode="decimal" min="0" step="any" value={lotDraft.quantity || ""} onChange={(e) => setLotDraft({ ...lotDraft, quantity: e.target.value })} placeholder="10" /></label>
                    <label>Cost price<input type="number" inputMode="decimal" min="0" step="any" value={lotDraft.costPrice || ""} onChange={(e) => setLotDraft({ ...lotDraft, costPrice: e.target.value })} placeholder="100.00" /></label>
                    <label>Fees<input type="number" inputMode="decimal" min="0" step="any" value={lotDraft.fees || ""} onChange={(e) => setLotDraft({ ...lotDraft, fees: e.target.value })} placeholder="0.00" /></label>
                    <button className="table-btn save-inline" onClick={() => saveLot(item)}><Plus size={14} /> {editingLot ? "Update lot" : "Add lot"}</button>
                    {editingLot && <button className="table-btn" onClick={() => { setEditingLot(null); setLotDraft({ purchaseDate: new Date().toISOString().slice(0, 10) }); }}>Cancel</button>}
                  </div>
                </div>
                {message[item.id] && <div className="inline-message">{message[item.id]}</div>}
              </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export default function Page() {
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [loginChecked, setLoginChecked] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("All");
  const [currency, setCurrency] = useState<Record<string, string>>({ All: "USD" });
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<RefreshSummary | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [holdingQuery, setHoldingQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("All");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [portfolioError, setPortfolioError] = useState("");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const autoRefreshAttempted = useRef(false);
  const refreshInFlight = useRef(false);

  async function load() {
    try {
      const res = await fetch("/api/portfolio", { cache: "no-store" });
      if (res.status === 401) {
        writePortfolioCache(null);
        setData(null);
        setPortfolioError("");
        setLoginChecked(true);
        return;
      }
      if (!res.ok) throw new Error("The portfolio service is temporarily unavailable.");
      const next = await res.json();
      if (!next?.user || !Array.isArray(next?.securities)) throw new Error("The portfolio response was incomplete.");
      writePortfolioCache(next);
      setData(next);
      setPortfolioError("");
    } catch (error) {
      setPortfolioError(error instanceof Error ? error.message : "Could not load your portfolio.");
    } finally {
      setLoginChecked(true);
    }
  }

  useEffect(() => {
    const cached = readPortfolioCache();
    if (cached) {
      setData(cached);
      setLoginChecked(true);
    }
    load();
    try {
      const saved = JSON.parse(window.localStorage.getItem(WORKSPACE_PREFERENCES_KEY) || "{}");
      if (saved.density === "compact" || saved.density === "comfortable") setDensity(saved.density);
      if (typeof saved.actionFilter === "string" && ACTION_FILTERS.includes(saved.actionFilter)) setActionFilter(saved.actionFilter);
      if (typeof saved.currency === "object" && saved.currency) setCurrency(saved.currency);
    } catch {
      // Workspace preferences are optional; defaults remain usable.
    }
  }, []);

  useEffect(() => {
    if (!loginChecked) return;
    try {
      window.localStorage.setItem(WORKSPACE_PREFERENCES_KEY, JSON.stringify({ density, actionFilter, currency }));
    } catch {
      // Ignore browsers where persistent storage is unavailable.
    }
  }, [density, actionFilter, currency, loginChecked]);

  async function removeAsset(id: number) {
    const previous = data;
    setData((prev) => (prev ? { ...prev, securities: prev.securities.filter((s) => s.id !== id) } : prev));
    try {
      const res = await fetch(`/api/investments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      writePortfolioCache(previous ? { ...previous, securities: previous.securities.filter((s) => s.id !== id) } : previous);
      setToast({ message: "Investment removed from your portfolio.", tone: "success" });
    } catch {
      setData(previous);
      setToast({ message: "The investment could not be removed. Your portfolio was restored.", tone: "error" });
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    writePortfolioCache(null);
    setData(null);
  }

  async function refresh() {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setLoading(true);
    setSummary(null);
    try {
      const res = await fetch(`/api/refresh?ts=${Date.now()}`, { method: "POST", cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not refresh prices.");
      setSummary(json.summary);
      setLastRefreshedAt(new Date().toISOString());
      if (json.securities && data) {
        setData((prev) => {
          const next = prev ? { ...prev, securities: json.securities, fx: json.fx || prev.fx, actionHistory: json.actionHistory || prev.actionHistory || [] } : prev;
          writePortfolioCache(next);
          return next;
        });
      } else {
        await load();
      }
      setToast({ message: `Market data refreshed. ${json.summary?.updated || 0} position${json.summary?.updated === 1 ? "" : "s"} updated.`, tone: "success" });
    } catch (error) {
      const note = error instanceof Error ? error.message : "Could not refresh prices.";
      setSummary({ updated: 0, unchanged: 0, manual: 0, not_refreshed: 0, failed: 1, details: [{ name: "Refresh", status: "failed", note }] });
      setToast({ message: note, tone: "error" });
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  }

  const securities = data?.securities || [];
  const fx = data?.fx || { INR: 1, USD: 83.5 };
  const countries = useMemo(() => [...new Set(securities.map((s) => s.country))].sort(), [securities]);
  const countryVisible = tab === "All" ? securities : securities.filter((s) => s.country === tab);
  const searchMatched = countryVisible.filter((security) => {
    const needle = holdingQuery.trim().toLowerCase();
    return !needle || [security.name, security.priceSymbol, security.ticker, security.assetType, security.country, security.action]
      .some((value) => String(value || "").toLowerCase().includes(needle));
  });
  const actionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const security of searchMatched) counts[security.action] = (counts[security.action] || 0) + 1;
    return counts;
  }, [searchMatched]);
  const visible = actionFilter === "All" ? searchMatched : searchMatched.filter((security) => security.action === actionFilter);
  const stats = metricStats(countryVisible, fx);
  const currentCurrency = currency[tab] || (tab === "All" ? "USD" : marketCurrency[tab] || countryVisible[0]?.currency || "USD");

  function focusSecurity(id: number) {
    setTab("All");
    setHoldingQuery("");
    setFocusId(null);
    window.requestAnimationFrame(() => setFocusId(id));
  }

  function exportPortfolio() {
    const csv = portfolioCsv(visible);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `thesis-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setToast({ message: `Exported ${visible.length} visible position${visible.length === 1 ? "" : "s"}.`, tone: "success" });
  }

  useEffect(() => {
    if (!data || autoRefreshAttempted.current) return;
    const needsIntelligence = data.securities.some((security) =>
      ["Stock", "ETF"].includes(security.assetType)
      && (!security.targetPrice || !security.week52Low || !security.week52High || security.changePercent === null),
    );
    if (needsIntelligence) {
      autoRefreshAttempted.current = true;
      refresh();
    }
  }, [data]);

  useEffect(() => {
    if (tab !== "All" && !currency[tab]) setCurrency((prev) => ({ ...prev, [tab]: marketCurrency[tab] || countryVisible[0]?.currency || "USD" }));
  }, [tab, currency, countryVisible]);

  useEffect(() => {
    if (!data) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(data)]);

  useEffect(() => {
    if (!data) return;
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      const last = lastRefreshedAt ? new Date(lastRefreshedAt).getTime() : 0;
      if (Date.now() - last > AUTO_REFRESH_MS) refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(data), lastRefreshedAt]);

  useEffect(() => {
    if (!data) return;
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches("input, textarea, select, [contenteditable='true']");
      if (isEditing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("holding-search")?.focus();
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setModalOpen(true);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [Boolean(data)]);

  if (!loginChecked) return <main className="loading-page"><ProductMark /><span>Preparing your portfolio</span></main>;
  if (!data && portfolioError) return <main className="load-error-page"><div className="load-error-card"><CircleAlert size={22} /><div className="eyebrow">Connection issue</div><h1>Your portfolio is still safe.</h1><p>{portfolioError} Check your connection and try again.</p><button className="primary-btn" onClick={load}>Try again</button></div></main>;
  if (!data) return <Login />;

  const refreshedAtText = lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
  const refreshText = summary ? [
    `Prices refreshed${refreshedAtText ? ` at ${refreshedAtText}` : ""}`,
    `${summary.updated || 0} updated`,
    summary.unchanged ? `${summary.unchanged} unchanged` : "",
    summary.manual ? `${summary.manual} manual` : "",
    summary.not_refreshed ? `${summary.not_refreshed} need setup` : "",
    summary.failed ? `${summary.failed} failed` : "",
  ].filter(Boolean).join(" · ") : "";
  const refreshDetails = summary?.details?.length ? summary.details.map((item) => `${item.name}: ${item.note}`).join(" · ") : "";

  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-lockup sidebar-brand">
          <ProductMark />
          <div><strong>THESIS</strong><span>Portfolio intelligence</span></div>
        </div>
        <nav className="sidebar-nav" aria-label="Workspace navigation">
          <a href="#overview" className="active"><LayoutDashboard size={18} /><span>Overview</span></a>
          <a href="#decisions"><ClipboardCheck size={18} /><span>Decisions</span></a>
          <a href="#holdings"><List size={18} /><span>Holdings</span></a>
        </nav>
        <div className="sidebar-note"><span>Decision system</span><p>Numerical actions stay separate from filing evidence.</p></div>
        <div className="sidebar-user">
          <div className="profile-chip" title={data.user.email || data.user.name || "Signed in user"}>
            {data.user.picture ? <img className="profile-pic" src={data.user.picture} alt={data.user.name || data.user.email || "Signed in user"} referrerPolicy="no-referrer" /> : <div className="profile-fallback">{(data.user.name || data.user.email || "U").charAt(0).toUpperCase()}</div>}
          </div>
          <div><strong>{data.user.name || "Your workspace"}</strong><span>{data.user.email || "Private portfolio"}</span></div>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      <div className="page workspace-main">
      <nav className="topnav">
        <div className="topnav-left">
          <div className="brand-lockup mobile-brand">
            <ProductMark small />
            <div><strong>THESIS</strong></div>
          </div>
          <div className="workspace-heading"><span>Personal portfolio</span><strong>Overview</strong></div>
        </div>
        <div className="actions">
          <AlertsBell actionHistory={data.actionHistory} onSelect={focusSecurity} />
          <button className="primary-btn" onClick={() => setModalOpen(true)}><Plus size={15} /> Add investment <kbd>N</kbd></button>
          <div className="profile-chip" title={data.user.email || data.user.name || "Signed in user"}>
            {data.user.picture ? (
              <img className="profile-pic" src={data.user.picture} alt={data.user.name || data.user.email || "Signed in user"} referrerPolicy="no-referrer" />
            ) : (
              <div className="profile-fallback">{(data.user.name || data.user.email || "U").charAt(0).toUpperCase()}</div>
            )}
          </div>
          <button className="ghost-btn" onClick={logout}>Sign out</button>
        </div>
      </nav>

      {portfolioError && <div className="app-status-banner" role="status"><CircleAlert size={15} /><span>{portfolioError} Showing the last available portfolio snapshot.</span><button onClick={load}>Retry</button></div>}

      {securities.length === 0 ? (
        <section className="empty">
          <div className="empty-graphic" aria-hidden="true"><span /><span /><span /><i /></div>
          <div className="eyebrow">Your register is ready</div>
          <h1>Build your first live position.</h1>
          <p>Add one holding and Thesis will connect its price, targets, 52-week range, purchase lots, and action signal.</p>
          <button className="primary-btn" onClick={() => setModalOpen(true)}><Plus size={15} /> Add first investment</button>
        </section>
      ) : (
        <>
          <PortfolioOverview
            securities={countryVisible}
            stats={stats}
            currentCurrency={currentCurrency}
            fx={fx}
            marketLabel={tab === "All" ? `All markets · ${countries.length || 1} region${countries.length === 1 ? "" : "s"}` : tab}
            onSelect={focusSecurity}
          />
          <section className="workspace-toolbar">
            <div className="tabs" aria-label="Filter by market">{["All", ...countries].map((item) => <button key={item} className={`tab ${tab === item ? "on" : ""}`} onClick={() => setTab(item)}>{item === "All" ? "All markets" : item}</button>)}</div>
            <div className="workspace-status">
              <button className="refresh-button" onClick={refresh} disabled={loading} aria-label="Refresh prices now" title="Refresh prices now"><RotateCw size={14} className={loading ? "spin" : ""} />{loading ? "Refreshing" : "Refresh prices"}</button>
              <button className="refresh-button export-button" onClick={exportPortfolio} aria-label="Export visible holdings as CSV" title="Export visible holdings as CSV"><Download size={14} />Export</button>
              <span className={`refresh-results ${refreshText ? "done" : ""}`} title={refreshDetails} aria-live="polite">{refreshText || "Auto-updates every 5 min"}</span>
              <div className="select-wrap"><label htmlFor="portfolio-currency">View in</label><select id="portfolio-currency" value={currentCurrency} onChange={(e) => setCurrency({ ...currency, [tab]: e.target.value })}>{currencies.map((cur) => <option key={cur}>{cur}</option>)}</select></div>
            </div>
          </section>
          <section className="holdings-panel" id="holdings">
            <header className="holdings-toolbar">
              <div><div className="eyebrow">Portfolio register</div><h2>Holdings</h2><p>{visible.length} of {countryVisible.length} positions shown</p></div>
              <div className="holdings-tools">
                <label className="holding-search"><Search size={15} /><input id="holding-search" aria-label="Search holdings" placeholder="Search name or ticker" value={holdingQuery} onChange={(event) => setHoldingQuery(event.target.value)} /><kbd>/</kbd></label>
                <button className="density-toggle" onClick={() => setDensity((current) => current === "compact" ? "comfortable" : "compact")} aria-label={`Switch to ${density === "compact" ? "comfortable" : "compact"} rows`} title={`Switch to ${density === "compact" ? "comfortable" : "compact"} rows`}><SlidersHorizontal size={14} /><span>{density === "compact" ? "Compact" : "Comfortable"}</span></button>
              </div>
            </header>
            <div className="action-filter-row" aria-label="Filter holdings by recommended action">
              {ACTION_FILTERS.map((action) => {
                const count = action === "All" ? searchMatched.length : (actionCounts[action] || 0);
                if (action !== "All" && count === 0 && actionFilter !== action) return null;
                const cls = action === "All" ? "all" : action.toLowerCase().replaceAll(" ", "-");
                return (
                  <button key={action} className={`action-filter-chip ${cls} ${actionFilter === action ? "on" : ""}`} onClick={() => setActionFilter(action)}>
                    {action === "All" ? "All actions" : action}<strong>{count}</strong>
                  </button>
                );
              })}
            </div>
            <Holdings
              securities={visible}
              totalInr={stats.totalInr}
              fx={fx}
              displayCurrency={currentCurrency}
              reload={load}
              onDelete={removeAsset}
              focusId={focusId}
              emptyMessage={actionFilter === "All" ? "No holdings match your search." : `Nothing is currently flagged ${actionFilter}.`}
              density={density}
              actionHistory={data.actionHistory || []}
            />
          </section>
        </>
      )}
      {modalOpen && <AddInvestmentModal onClose={() => setModalOpen(false)} onSaved={async () => { await load(); setToast({ message: "Investment added and portfolio totals recalculated.", tone: "success" }); }} />}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
      </div>
    </main>
  );
}
