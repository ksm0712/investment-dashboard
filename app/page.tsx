"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, Plus, RotateCw, Trash2, X } from "lucide-react";
import type { ActionHistoryEntry, AddInvestmentInput, AssetType, SearchResult, Security, User } from "@/lib/types";
import { currencies, marketCurrency, marketExchanges, markets } from "@/lib/constants";
import { fmt, fmtDate, fmtPct, fmtPlain, fmtUnit, fromInr } from "@/lib/format";

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
      <div className="login-card">
        <div className="login-title">Investments</div>
        <div className="login-subtitle">Portfolio Tracker</div>
        <a className="google-login-btn" href="/api/auth/google">
          {googleIcon()}
          Continue with Google
        </a>
        <div className="login-note">
          Your data is private to your account.<br />Sign in to access your portfolio.
        </div>
      </div>
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

function AddInvestmentModal({ fx, onClose, onSaved }: { fx: Record<string, number>; onClose: () => void; onSaved: () => void }) {
  useLockBodyScroll(true);
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
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const localSearchCache = useRef<Record<string, SearchResult[]>>({});
  const quoteCache = useRef<Record<string, Record<string, unknown>>>({});
  const quoteRequestId = useRef(0);
  const suppressNextSearch = useRef(false);

  const exchanges = marketExchanges[country] || ["Other"];

  useEffect(() => {
    if (!exchanges.includes(exchange)) setExchange(exchanges[0]);
  }, [country, exchanges, exchange]);

  useEffect(() => {
    if (suppressNextSearch.current) {
      suppressNextSearch.current = false;
      return;
    }
    if (name.trim().length < 2) {
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
    try {
      setBusy(true);
      const res = await fetch(`/api/search?q=${encodeURIComponent(name.trim())}`);
      const data = await res.json();
      const results = data.results || [];
      localSearchCache.current[key] = results;
      setMatchIndex("");
      setMatches(results);
      setSearchNotice(results.length ? "" : `No matches found for "${name.trim()}". Try the ticker or full asset name.`);
    } catch {
      setMatches([]);
      setSearchNotice("");
      setError("Search could not load results. Try again.");
    } finally {
      setBusy(false);
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
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">Add Investment</div>
          <button className="x-btn" onClick={onClose} aria-label="Close"><X size={26} /></button>
        </div>
        <div className="slabel">Add Investment</div>
        <div className="form-section-title">Asset</div>
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
        {busy && <div className="busy-note">Searching...</div>}
        {!busy && searchNotice && <div className="search-note">{searchNotice}</div>}
        {quoteBusy && <div className="busy-note">Fetching current price...</div>}
        {matchIndex !== "" && <div className="form-hint">Autofilled — edit any field below if needed</div>}
        <div className="form-grid grid-3" style={{ marginTop: 18 }}>
          <div className="field">
            <label>Asset type</label>
            <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>{assetTypes.map((type) => <option key={type}>{type}</option>)}</select>
          </div>
          <div className="field">
            <label>Market / country</label>
            <select value={country} onChange={(e) => setCountry(e.target.value)}>{markets.map((market) => <option key={market}>{market}</option>)}</select>
          </div>
          <div className="field">
            <label>Currency</label>
            <input value={marketCurrency[country] || "USD"} readOnly />
          </div>
        </div>
        <div className="form-section-title">Identifier</div>
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
        <div className="form-section-title">Position</div>
        <div className="form-grid grid-4">
          <div className="field"><label>Quantity bought</label><input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="1.000000" /></div>
          <div className="field"><label>Cost price</label><input value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="100.00" /></div>
          <div className="field"><label>Date bought</label><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></div>
          <div className="field"><label>Current price</label><input value={currentPrice} onChange={(e) => { setCurrentPrice(e.target.value); setPriceSource("manual"); setPriceAsOn(new Date().toISOString().slice(0, 10)); }} placeholder="150.00" /></div>
        </div>
        <div className="form-section-title">Decision inputs</div>
        <div className="form-grid grid-4">
          <div className="field">
            <label>Allocation limit (required)</label>
            <input value={allocation} onChange={(e) => setAllocation(e.target.value)} placeholder="50000" />
          </div>
          <div className="field"><label>Analyst target</label><input value={targetPrice} onChange={(e) => { setTargetPrice(e.target.value); setTargetSource("manual"); setTargetAsOn(new Date().toISOString().slice(0, 10)); }} placeholder={quoteBusy ? "Fetching…" : "Auto-filled when available"} /></div>
          <div className="field"><label>52-week low</label><input value={week52Low} readOnly placeholder="Auto-filled" /></div>
          <div className="field"><label>52-week high</label><input value={week52High} readOnly placeholder="Auto-filled" /></div>
        </div>
        <div className="form-hint alloc-hint">The most you're willing to invest in this asset. Buy and Review to Buy never trigger without it.</div>
        {targetPrice && <div className="provider-note">Target source: {targetSource || "manual"}{targetAsOn ? ` · ${fmtDate(targetAsOn)}` : ""}</div>}
        {error && <div className="bad" style={{ marginTop: 14, fontWeight: 700 }}>{error}</div>}
        <button type="button" className="save-btn" style={{ marginTop: 20, width: 190 }} onClick={save}>Save Investment</button>
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
      <button className="icon-btn alerts-bell" onClick={toggle} aria-label="Recommendation alerts">
        <Bell size={17} />
        {unread > 0 && <span className="alerts-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="alerts-backdrop" onClick={() => setOpen(false)} />
          <div className="alerts-panel" role="dialog" aria-label="Recent recommendation changes">
            <div className="alerts-panel-head">Recommendation changes</div>
            {changes.length === 0 && (
              <div className="alerts-empty">No recommendation changes yet. You&apos;ll see updates here the moment a holding&apos;s action changes, like Continue to Monitor flipping to Buy.</div>
            )}
            <div className="alerts-list">
              {changes.slice(0, 25).map((entry) => (
                <button key={entry.id} className="alert-item" onClick={() => { onSelect(entry.securityId); setOpen(false); }}>
                  <div className="alert-item-top"><strong>{entry.securityName}</strong><span className="alert-time">{fmtDate(entry.recordedAt)}</span></div>
                  <div className="alert-item-transition">
                    <span className={`action-badge small ${(entry.previousAction || "").toLowerCase().replaceAll(" ", "-")}`}>{entry.previousAction}</span>
                    <ArrowRight size={11} />
                    <span className={`action-badge small ${entry.action.toLowerCase().replaceAll(" ", "-")}`}>{entry.action}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Holdings({ securities, totalInr, reload, focusId, emptyMessage }: {
  securities: Security[];
  totalInr: number;
  reload: () => void;
  focusId: number | null;
  emptyMessage: string;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editorAsset, setEditorAsset] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [lotDraft, setLotDraft] = useState<Record<string, string>>({ purchaseDate: new Date().toISOString().slice(0, 10) });
  const [editingLot, setEditingLot] = useState<number | null>(null);
  const [allocationDraft, setAllocationDraft] = useState<Record<number, string>>({});
  const [marketDraft, setMarketDraft] = useState<Record<number, { target?: string; low?: string; high?: string }>>({});
  const [message, setMessage] = useState<Record<number, string>>({});
  useLockBodyScroll(editorAsset !== null);
  const rows = [...securities].sort((a, b) => {
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

  async function removeAsset(id: number) {
    await fetch(`/api/investments/${id}`, { method: "DELETE" });
    setDeleting(null);
    await reload();
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
    const low = Number(draft.low ?? String(item.week52Low ?? ""));
    const high = Number(draft.high ?? String(item.week52High ?? ""));
    const body: Record<string, unknown> = {};
    if (Number.isFinite(target) && target > 0) {
      body.targetPrice = target;
      body.targetSource = "manual";
      body.targetAsOn = new Date().toISOString().slice(0, 10);
    }
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
      setMessage((current) => ({ ...current, [item.id]: "Purchase lot deleted and totals recalculated." }));
      await reload();
    }
  }

  function beginLotEdit(lot: Security["lots"][number]) {
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
    <div className="asset-register">
      <div className="holding-row holding-row-head" aria-hidden="true">
        <span className="holding-name-cell">Asset</span>
        <span className="holding-num-cell">Target</span>
        <span className="holding-num-cell">Price</span>
        <span className="holding-num-cell">Change</span>
        <span className="holding-num-cell">Above 52W Low</span>
        <span className="holding-num-cell">Below 52W High</span>
        <span className="holding-num-cell">Purchase Price</span>
        <span className="holding-num-cell">Gain / Loss</span>
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
        const allocationPhrase = item.allocation === null
          ? "Not set"
          : (item.allocationRemaining ?? 0) >= 0
            ? `${fmt(item.allocationRemaining, item.currency)} of ${fmt(item.allocation, item.currency)} still available`
            : `${fmt(Math.abs(item.allocationRemaining ?? 0), item.currency)} over your ${fmt(item.allocation, item.currency)} limit`;
        const detailFacts: Array<[string, string, string?]> = [
          ["Shares held", fmtPlain(item.sharesHeld, 4)],
          ["Market value", fmt(item.marketValue, item.currency)],
          ["Invested cost", fmt(item.investedCost, item.currency)],
          ["52-week range", item.week52Low === null || item.week52High === null ? "—" : `${fmtUnit(item.week52Low, item.currency)} – ${fmtUnit(item.week52High, item.currency)}`],
          ["Allocation", allocationPhrase, (item.allocationRemaining ?? 0) < 0 ? "bad" : ""],
        ];
        return (
          <article className={`asset-row-shell action-${actionClass}`} key={item.id} id={`holding-${item.id}`}>
            <button className={`holding-row ${isDetailsOpen ? "open" : ""}`} onClick={() => toggleDetails(item.id)} aria-expanded={isDetailsOpen}>
              <span className="holding-name-cell">
                <i className={`row-chevron ${isDetailsOpen ? "open" : ""}`}>›</i>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.priceSymbol || item.ticker || item.exchange || item.assetType} · {pct.toFixed(1)}% of portfolio</small>
                </span>
              </span>
              <span className="holding-num-cell" data-label="Target">{fmtUnit(item.targetPrice, item.currency)}</span>
              <span className="holding-num-cell" data-label="Price">{fmtUnit(item.latestPrice, item.currency)}</span>
              <span className={`holding-num-cell ${item.changePercent === null ? "" : item.changePercent >= 0 ? "good" : "bad"}`} data-label="Change">{item.changePercent === null ? "—" : fmtPct(item.changePercent, true)}</span>
              <span className="holding-num-cell" data-label="Above 52W Low">{ratio(item.pctAbove52WeekLow, true)}</span>
              <span className="holding-num-cell" data-label="Below 52W High">{ratio(item.pctBelow52WeekHigh)}</span>
              <span className="holding-num-cell" data-label="Purchase Price">{fmtUnit(item.averagePurchasePrice, item.currency)}</span>
              <span className={`holding-num-cell ${(item.gainLoss || 0) >= 0 ? "good" : "bad"}`} data-label="Gain / Loss">
                {fmt(item.gainLoss, item.currency)}<small>{ratio(item.gainPct, true)}</small>
              </span>
              <span className="holding-action-cell">
                <span className={`action-badge ${actionClass}`}>{item.action}</span>
              </span>
            </button>

            {isDetailsOpen && <div className="asset-expanded">
              <div className="expanded-summary-head">
                <div><strong>{item.action}</strong><p>{item.actionReasons.join(" ")}</p></div>
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
                <div className="fact-list">{detailFacts.map(([label, value, tone]) => <div className="fact-row" key={label}><span>{label}</span><strong className={tone}>{value}</strong></div>)}</div>
              </div>
              {deleting === item.id && <div className="delete-panel"><b>Delete {item.name} and all its purchase lots?</b> This cannot be undone. <button className="table-btn danger" style={{ width: 90, marginLeft: 12 }} onClick={() => removeAsset(item.id)}>Delete</button> <button className="table-btn" style={{ width: 90 }} onClick={() => setDeleting(null)}>Cancel</button></div>}
            </div>
            }
            {isEditorOpen && (
              <div className="asset-editor-backdrop" role="dialog" aria-modal="true" aria-label={`Lots and allocation for ${item.name}`}>
              <div className="asset-editor">
                <div className="editor-title"><div><h3>Lots, allocation &amp; targets</h3><p>{item.name} · purchases are combined into the asset totals.</p></div><button className="icon-btn" aria-label="Close editor" onClick={() => setEditorAsset(null)}><X size={16} /></button></div>
                <div className="editor-allocation">
                  <div className="compact-form">
                    <label>Allocation amount ({item.currency})<input value={allocation} onChange={(e) => setAllocationDraft((current) => ({ ...current, [item.id]: e.target.value }))} placeholder="Not set" /></label>
                    <button className="table-btn save-inline" onClick={() => saveAllocation(item)}>Save allocation</button>
                  </div>
                </div>
                <div className="editor-allocation">
                  <div className="detail-section-head"><div><h3>Target &amp; 52-week range</h3><p>Set these manually when a live provider can&apos;t supply them (common for ETFs), so Buy/Sell signals can activate.</p></div></div>
                  <div className="compact-form">
                    <label>Analyst target ({item.currency})<input value={marketDraft[item.id]?.target ?? String(item.targetPrice ?? "")} onChange={(e) => setMarketDraft((current) => ({ ...current, [item.id]: { ...current[item.id], target: e.target.value } }))} placeholder="Not set" /></label>
                    <label>52-week low ({item.currency})<input value={marketDraft[item.id]?.low ?? String(item.week52Low ?? "")} onChange={(e) => setMarketDraft((current) => ({ ...current, [item.id]: { ...current[item.id], low: e.target.value } }))} placeholder="Not set" /></label>
                    <label>52-week high ({item.currency})<input value={marketDraft[item.id]?.high ?? String(item.week52High ?? "")} onChange={(e) => setMarketDraft((current) => ({ ...current, [item.id]: { ...current[item.id], high: e.target.value } }))} placeholder="Not set" /></label>
                    <button className="table-btn save-inline" onClick={() => saveMarketInputs(item)}>Save target &amp; range</button>
                  </div>
                </div>
                <div className="editor-lots">
                  <div className="detail-section-head"><div><h3>Purchase lots</h3></div><span>{item.lots.length} lot{item.lots.length === 1 ? "" : "s"}</span></div>
                  <div className="lots-table">
                    <div className="lot-row lot-head"><span>Date</span><span>Quantity</span><span>Cost price</span><span>Fees</span><span>Cost value</span><span /><span /></div>
                    {item.lots.map((lot) => <div className="lot-row" key={lot.id}><span>{fmtDate(lot.purchaseDate)}</span><span>{fmtPlain(lot.quantity, 4)}</span><span>{fmtUnit(lot.costPrice, item.currency)}</span><span>{fmtUnit(lot.fees, item.currency)}</span><strong>{fmt(lot.quantity * lot.costPrice + lot.fees, item.currency)}</strong><button className="table-btn" onClick={() => beginLotEdit(lot)}>Edit</button><button className="icon-btn danger" aria-label="Delete purchase lot" onClick={() => removeLot(item, lot.id)}><Trash2 size={14} /></button></div>)}
                    {!item.lots.length && <div className="empty-lots">No purchase lots yet. Add the first purchase below.</div>}
                  </div>
                  <div className="compact-form lot-form">
                    <label>Purchase date<input type="date" value={lotDraft.purchaseDate || ""} onChange={(e) => setLotDraft({ ...lotDraft, purchaseDate: e.target.value })} /></label>
                    <label>Quantity<input value={lotDraft.quantity || ""} onChange={(e) => setLotDraft({ ...lotDraft, quantity: e.target.value })} placeholder="10" /></label>
                    <label>Cost price<input value={lotDraft.costPrice || ""} onChange={(e) => setLotDraft({ ...lotDraft, costPrice: e.target.value })} placeholder="100.00" /></label>
                    <label>Fees<input value={lotDraft.fees || ""} onChange={(e) => setLotDraft({ ...lotDraft, fees: e.target.value })} placeholder="0.00" /></label>
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
  const autoRefreshAttempted = useRef(false);

  async function load() {
    try {
      const res = await fetch("/api/portfolio", { cache: "no-store" });
      if (res.status === 401) {
        writePortfolioCache(null);
        setData(null);
        setLoginChecked(true);
        return;
      }
      const next = await res.json();
      writePortfolioCache(next);
      setData(next);
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
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    writePortfolioCache(null);
    setData(null);
  }

  async function refresh() {
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
    } catch (error) {
      const note = error instanceof Error ? error.message : "Could not refresh prices.";
      setSummary({ updated: 0, unchanged: 0, manual: 0, not_refreshed: 0, failed: 1, details: [{ name: "Refresh", status: "failed", note }] });
    } finally {
      setLoading(false);
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
    setFocusId(id);
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

  if (!loginChecked) return <main className="login-page"><div className="login-card"><div className="login-title">Investments</div></div></main>;
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
    <main className="page">
      <nav className="topnav">
        <div className="brand"><div className="brand-name">Investments</div></div>
        <div className="actions">
          <AlertsBell actionHistory={data.actionHistory} onSelect={focusSecurity} />
          <button className="primary-btn" onClick={() => setModalOpen(true)}>＋ Add Investment</button>
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

      {securities.length === 0 ? (
        <div className="empty"><div className="empty-icon">📂</div><div className="empty-title">No investments yet</div><div className="empty-sub">Click <b style={{ color: "#2563eb" }}>＋ Add Investment</b> above to get started</div></div>
      ) : (
        <>
          <section className="portfolio-toolbar">
            <div className="control-row">
              <button className="icon-btn refresh-icon-btn" onClick={refresh} disabled={loading} aria-label="Refresh prices now" title="Refresh prices now">
                <RotateCw size={15} className={loading ? "spin" : ""} />
              </button>
              <span className={`refresh-results ${refreshText ? "done" : ""}`}>{refreshText ? `${refreshText}${refreshDetails ? ` (${refreshDetails})` : ""}` : "Prices update automatically every 5 minutes"}</span>
            </div>
            <div className="tabs">{["All", ...countries].map((item) => <button key={item} className={`tab ${tab === item ? "on" : ""}`} onClick={() => setTab(item)}>{item}</button>)}</div>
            <div className="select-wrap"><label>Currency</label><select value={currentCurrency} onChange={(e) => setCurrency({ ...currency, [tab]: e.target.value })}>{currencies.map((cur) => <option key={cur}>{cur}</option>)}</select></div>
          </section>
          <section className="register-strip">
            <div className="register-metric"><div className="register-metric-label">{tab === "All" ? "Total Portfolio" : "Market Value"}</div><div className="register-metric-value">{fmt(fromInr(stats.totalInr, currentCurrency, fx), currentCurrency)}</div></div>
            <div className="register-metric"><div className="register-metric-label">Total Cost</div><div className="register-metric-value">{stats.costInr ? fmt(fromInr(stats.costInr, currentCurrency, fx), currentCurrency) : "—"}</div></div>
            <div className="register-metric"><div className="register-metric-label">Gain / Loss</div><div className={`register-metric-value ${(stats.gainPct || 0) >= 0 ? "good" : "bad"}`}>{stats.costInr ? fmt(fromInr(stats.gainInr, currentCurrency, fx), currentCurrency) : "—"}</div></div>
            <div className="register-metric"><div className="register-metric-label">Return</div><div className={`register-metric-value ${(stats.gainPct || 0) >= 0 ? "good" : "bad"}`}>{fmtPct(stats.gainPct)}</div></div>
          </section>
          <section className="action-filter-row" aria-label="Filter holdings by recommended action">
            {ACTION_FILTERS.map((action) => {
              const count = action === "All" ? searchMatched.length : (actionCounts[action] || 0);
              if (action !== "All" && count === 0 && actionFilter !== action) return null;
              const cls = action === "All" ? "all" : action.toLowerCase().replaceAll(" ", "-");
              return (
                <button key={action} className={`action-filter-chip ${cls} ${actionFilter === action ? "on" : ""}`} onClick={() => setActionFilter(action)}>
                  {action}<strong>{count}</strong>
                </button>
              );
            })}
          </section>
          <section className="holdings-toolbar">
            <div className="slabel register-title-row"><span>Holdings <span className="result-count">{visible.length} of {countryVisible.length}</span></span></div>
            <input className="holding-search" aria-label="Search holdings" placeholder="Search holdings" value={holdingQuery} onChange={(event) => setHoldingQuery(event.target.value)} />
          </section>
          <Holdings
            securities={visible}
            totalInr={stats.totalInr}
            reload={load}
            focusId={focusId}
            emptyMessage={actionFilter === "All" ? "No holdings match your search." : `Nothing is currently flagged ${actionFilter}.`}
          />
        </>
      )}
      {modalOpen && <AddInvestmentModal fx={fx} onClose={() => setModalOpen(false)} onSaved={load} />}
    </main>
  );
}
