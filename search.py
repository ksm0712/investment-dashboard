import requests
import streamlit as st

# Map Yahoo Finance exchange codes → (country, currency, exchange_name)
EXCHANGE_MAP = {
    "NSI": ("India", "INR", "NSE"),
    "BSE": ("India", "INR", "BSE"),
    "NMS": ("United States", "USD", "NASDAQ"),
    "NYQ": ("United States", "USD", "NYSE"),
    "NGM": ("United States", "USD", "NASDAQ"),
    "PCX": ("United States", "USD", "NYSE"),
    "NIM": ("United States", "USD", "AMEX"),
    "SGX": ("Singapore", "SGD", "SGX"),
    "SES": ("Singapore", "SGD", "SGX"),
    "LSE": ("United Kingdom", "GBP", "LSE"),
    "IOB": ("United Kingdom", "GBP", "LSE"),
    "JPX": ("Japan", "JPY", "TSE"),
    "TYO": ("Japan", "JPY", "TSE"),
    "HKG": ("Hong Kong", "HKD", "HKEX"),
    "ASX": ("Australia", "AUD", "ASX"),
    "TOR": ("Canada", "CAD", "TSX"),
    "VAN": ("Canada", "CAD", "TSXV"),
    "FRA": ("Germany", "EUR", "Frankfurt"),
    "ETR": ("Germany", "EUR", "XETRA"),
    "GER": ("Germany", "EUR", "XETRA"),
    "EPA": ("France", "EUR", "Euronext"),
    "AMS": ("Netherlands", "EUR", "Euronext"),
    "MCE": ("Spain", "EUR", "Madrid"),
    "MIL": ("Italy", "EUR", "Borsa Italiana"),
    "SWX": ("Switzerland", "CHF", "SIX"),
    "EBS": ("Switzerland", "CHF", "SIX"),
    "KSC": ("South Korea", "USD", "KRX"),
    "KOE": ("South Korea", "USD", "KRX"),
    "TWO": ("Taiwan", "USD", "TWSE"),
    "TAI": ("Taiwan", "USD", "TWSE"),
    "JKT": ("Indonesia", "USD", "IDX"),
    "KLS": ("Malaysia", "USD", "Bursa Malaysia"),
    "BKK": ("Thailand", "USD", "SET"),
    "SAO": ("Brazil", "USD", "B3"),
    "JSE": ("South Africa", "USD", "JSE"),
    "DFM": ("UAE", "AED", "DFM"),
    "ADX": ("UAE", "AED", "ADX"),
    "NZE": ("New Zealand", "NZD", "NZX"),
    "STU": ("Germany", "EUR", "Frankfurt"),
    "HAM": ("Germany", "EUR", "Frankfurt"),
    "MUN": ("Germany", "EUR", "Frankfurt"),
    "DUS": ("Germany", "EUR", "Frankfurt"),
    "BER": ("Germany", "EUR", "Frankfurt"),
    "VIE": ("Europe", "EUR", "Other"),
    "BRU": ("Europe", "EUR", "Euronext"),
    "LIS": ("Europe", "EUR", "Euronext"),
    "OSL": ("Norway", "NOK", "Oslo"),
    "STO": ("Sweden", "SEK", "Nasdaq Stockholm"),
    "HEL": ("Europe", "EUR", "Other"),
    "CPH": ("Denmark", "DKK", "Nasdaq Copenhagen"),
}

QUOTE_TYPE_MAP = {
    "EQUITY": "Stock",
    "ETF": "ETF",
    "MUTUALFUND": "Mutual Fund",
    "BOND": "Bond",
}

@st.cache_data(ttl=300, show_spinner=False)
def search_yahoo(query: str):
    try:
        r = requests.get(
            "https://query1.finance.yahoo.com/v1/finance/search",
            params={"q": query, "quotesCount": 8, "newsCount": 0, "enableFuzzyQuery": False},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=5,
        )
        quotes = r.json().get("quotes", [])
    except Exception:
        return []

    results = []
    for q in quotes:
        qtype = q.get("quoteType", "")
        if qtype not in QUOTE_TYPE_MAP:
            continue
        exchange = q.get("exchange", "")
        country, currency, exch_name = EXCHANGE_MAP.get(exchange, ("United States", "USD", exchange or "Other"))
        name = q.get("longname") or q.get("shortname") or q.get("symbol", "")
        ticker = q.get("symbol", "")
        results.append({
            "label": f"{name} ({ticker})",
            "name": name,
            "asset_type": QUOTE_TYPE_MAP[qtype],
            "ticker": ticker,
            "country": country,
            "currency": currency,
            "exchange": exch_name,
            "identifier_type": "Ticker",
            "source": "yfinance",
        })
    return results

@st.cache_data(ttl=300, show_spinner=False)
def search_mfapi(query: str):
    try:
        r = requests.get(
            f"https://api.mfapi.in/mf/search?q={query}",
            timeout=5,
        )
        data = r.json()
    except Exception:
        return []

    results = []
    for mf in data[:6]:
        name = mf.get("schemeName", "")
        code = str(mf.get("schemeCode", ""))
        results.append({
            "label": f"{name} ({code})",
            "name": name,
            "asset_type": "Mutual Fund",
            "ticker": code,
            "country": "India",
            "currency": "INR",
            "exchange": "MFAPI",
            "identifier_type": "Scheme code",
            "source": "mfapi",
        })
    return results

def search_securities(query: str):
    """Search Yahoo Finance + MFAPI. MFAPI first (correct scheme codes).
    Yahoo Finance Indian MF results excluded to avoid wrong identifiers."""
    if len(query.strip()) < 2:
        return []
    mfapi  = search_mfapi(query)
    yahoo  = [r for r in search_yahoo(query)
              if not (r["asset_type"] == "Mutual Fund" and r["country"] == "India")]
    return mfapi + yahoo
