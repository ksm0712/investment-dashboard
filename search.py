"""
Search module for investment autofill.
- Indian MFs: uses AMFI directly (cached locally), fuzzy word matching
- Global stocks/ETFs: Yahoo Finance search
"""
import os
import json
import requests
import streamlit as st
from datetime import datetime

AMFI_URL        = "https://www.amfiindia.com/spages/NAVAll.txt"
AMFI_CACHE_FILE = ".amfi_cache.json"
AMFI_CACHE_DAYS = 1  # refresh daily

# ── Exchange → (country, currency, exchange_name) ────────────────────────────
EXCHANGE_MAP = {
    "NSI": ("India",         "INR", "NSE"),
    "BSE": ("India",         "INR", "BSE"),
    "NMS": ("United States", "USD", "NASDAQ"),
    "NYQ": ("United States", "USD", "NYSE"),
    "NGM": ("United States", "USD", "NASDAQ"),
    "PCX": ("United States", "USD", "NYSE"),
    "NIM": ("United States", "USD", "AMEX"),
    "SGX": ("Singapore",     "SGD", "SGX"),
    "SES": ("Singapore",     "SGD", "SGX"),
    "LSE": ("United Kingdom","GBP", "LSE"),
    "IOB": ("United Kingdom","GBP", "LSE"),
    "JPX": ("Japan",         "JPY", "TSE"),
    "TYO": ("Japan",         "JPY", "TSE"),
    "HKG": ("Hong Kong",     "HKD", "HKEX"),
    "ASX": ("Australia",     "AUD", "ASX"),
    "TOR": ("Canada",        "CAD", "TSX"),
    "VAN": ("Canada",        "CAD", "TSXV"),
    "FRA": ("Germany",       "EUR", "Frankfurt"),
    "ETR": ("Germany",       "EUR", "XETRA"),
    "GER": ("Germany",       "EUR", "XETRA"),
    "EPA": ("France",        "EUR", "Euronext"),
    "AMS": ("Netherlands",   "EUR", "Euronext"),
    "MCE": ("Spain",         "EUR", "Madrid"),
    "MIL": ("Italy",         "EUR", "Borsa Italiana"),
    "SWX": ("Switzerland",   "CHF", "SIX"),
    "EBS": ("Switzerland",   "CHF", "SIX"),
    "KSC": ("South Korea",   "USD", "KRX"),
    "KOE": ("South Korea",   "USD", "KRX"),
    "TWO": ("Taiwan",        "USD", "TWSE"),
    "TAI": ("Taiwan",        "USD", "TWSE"),
    "JKT": ("Indonesia",     "USD", "IDX"),
    "KLS": ("Malaysia",      "USD", "Bursa Malaysia"),
    "BKK": ("Thailand",      "USD", "SET"),
    "SAO": ("Brazil",        "USD", "B3"),
    "JSE": ("South Africa",  "USD", "JSE"),
    "DFM": ("UAE",           "AED", "DFM"),
    "ADX": ("UAE",           "AED", "ADX"),
    "NZE": ("New Zealand",   "NZD", "NZX"),
    "STU": ("Germany",       "EUR", "Frankfurt"),
    "OSL": ("Norway",        "NOK", "Oslo"),
    "STO": ("Sweden",        "SEK", "Nasdaq Stockholm"),
    "CPH": ("Denmark",       "DKK", "Nasdaq Copenhagen"),
}

QUOTE_TYPE_MAP = {
    "EQUITY":     "Stock",
    "ETF":        "ETF",
    "MUTUALFUND": "Mutual Fund",
    "BOND":       "Bond",
}


# ── AMFI: Indian Mutual Funds ─────────────────────────────────────────────────

def _load_amfi_cache():
    """Return cached AMFI fund list if fresh, else None."""
    if os.path.exists(AMFI_CACHE_FILE):
        try:
            age = datetime.now().timestamp() - os.path.getmtime(AMFI_CACHE_FILE)
            if age < AMFI_CACHE_DAYS * 86400:
                with open(AMFI_CACHE_FILE) as f:
                    return json.load(f)
        except Exception:
            pass
    return None


def _download_amfi():
    """Download AMFI NAV list and return parsed fund entries."""
    r = requests.get(AMFI_URL, timeout=20)
    r.raise_for_status()
    entries = []
    for line in r.text.split("\n"):
        line = line.strip()
        if not line or ";" not in line:
            continue
        parts = line.split(";")
        if len(parts) >= 4 and parts[0].strip().isdigit():
            entries.append({
                "code": parts[0].strip(),
                "name": parts[3].strip(),
            })
    return entries


def _get_amfi_funds():
    """Get AMFI fund list (cached locally)."""
    cached = _load_amfi_cache()
    if cached:
        return cached
    try:
        entries = _download_amfi()
        with open(AMFI_CACHE_FILE, "w") as f:
            json.dump(entries, f)
        return entries
    except Exception:
        return []


# Common compound investment terms
COMPOUND_EXPANSIONS = {
    "bluechip": "blue chip", "midcap": "mid cap", "largecap": "large cap",
    "smallcap": "small cap", "multicap": "multi cap", "flexicap": "flexi cap",
    "microcap": "micro cap", "focusedfund": "focused fund",
}

def _expand_query(query: str) -> str:
    """Expand compound words like bluechip → blue chip."""
    q = query.lower()
    for compound, expanded in COMPOUND_EXPANSIONS.items():
        q = q.replace(compound, expanded)
    return q

def _score_fund(query_words, fund_name):
    """
    Word-level scoring to avoid false positives (e.g. 'uti' in 'distribution').
    - Exact word match:               +4
    - Query word is prefix of name word: +3  ('Pru' → 'Prudential')
    - Name word is prefix of query word: +2  ('India' ~ 'Indian')
    Tie-break: penalise extra words in fund name (-0.1 each).
    """
    name_words = fund_name.lower().split()
    score = 0
    matched = 0
    for qw in query_words:
        if len(qw) < 2:
            continue
        if qw in name_words:
            score += 4; matched += 1
        elif any(nw.startswith(qw) for nw in name_words):
            score += 3; matched += 1
        elif any(qw.startswith(nw) for nw in name_words if len(nw) >= 3):
            score += 2; matched += 1
    if score > 0:
        # Tiebreaker: shorter names rank higher for same base score
        score -= 0.1 * (len(name_words) - matched)
    return score


def search_amfi(query: str):
    """Search Indian MFs from locally cached AMFI list with fuzzy matching."""
    funds = _get_amfi_funds()
    if not funds:
        return []

    query_words = [w for w in _expand_query(query).split() if len(w) >= 2]
    if not query_words:
        return []

    # Score all funds
    scored = [(score, f) for f in funds
              if (score := _score_fund(query_words, f["name"])) > 0]
    scored.sort(key=lambda x: -x[0])

    # Deduplicate by base name (remove plan/option variants, keep top 8 unique base names)
    seen_bases = {}
    results = []
    for score, f in scored:
        name = f["name"]
        # Base name: first 4 words
        base = " ".join(name.lower().split()[:4])
        if base not in seen_bases:
            seen_bases[base] = True
            results.append({
                "label":           f"{name} ({f['code']})",
                "name":            name,
                "asset_type":      "Mutual Fund",
                "ticker":          f["code"],
                "country":         "India",
                "currency":        "INR",
                "exchange":        "MFAPI",
                "identifier_type": "Scheme code",
                "source":          "amfi",
            })
        if len(results) >= 8:
            break
    return results


# ── Yahoo Finance: global stocks & ETFs ──────────────────────────────────────

@st.cache_data(ttl=300, show_spinner=False)
def _search_yahoo(query: str):
    try:
        r = requests.get(
            "https://query1.finance.yahoo.com/v1/finance/search",
            params={"q": query, "quotesCount": 8, "newsCount": 0},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=6,
        )
        quotes = r.json().get("quotes", [])
    except Exception:
        return []

    results = []
    for q in quotes:
        qtype = q.get("quoteType", "")
        if qtype not in QUOTE_TYPE_MAP:
            continue
        # Skip Indian MFs from Yahoo (wrong identifiers for our price system)
        exchange = q.get("exchange", "")
        country, currency, exch_name = EXCHANGE_MAP.get(
            exchange, ("United States", "USD", exchange or "Other")
        )
        if qtype == "MUTUALFUND" and country == "India":
            continue
        name = q.get("longname") or q.get("shortname") or q.get("symbol", "")
        ticker = q.get("symbol", "")
        results.append({
            "label":           f"{name} ({ticker})",
            "name":            name,
            "asset_type":      QUOTE_TYPE_MAP[qtype],
            "ticker":          ticker,
            "country":         country,
            "currency":        currency,
            "exchange":        exch_name,
            "identifier_type": "Ticker",
            "source":          "yfinance",
        })
    return results


# ── Combined search ───────────────────────────────────────────────────────────

def search_securities(query: str):
    """
    Search across AMFI (Indian MFs) + Yahoo Finance (global stocks/ETFs).
    AMFI results come first since they use direct AMFI data for price refresh.
    """
    q = query.strip()
    if len(q) < 2:
        return []

    amfi_results  = search_amfi(q)
    yahoo_results = _search_yahoo(q)

    return amfi_results + yahoo_results
