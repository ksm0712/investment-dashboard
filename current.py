import requests
import yfinance as yf
import sqlite3


def get_stock_price(ticker):
    stock = yf.Ticker(ticker)
    return stock.info['currentPrice']

def get_mf_nav(scheme_code):
    url = f"https://api.mfapi.in/mf/{scheme_code}"
    response = requests.get(url)
    data = response.json()
    return float(data["data"][0]["nav"])

def get_current_price(price_source, price_symbol):
    if price_source == "yfinance":
        return get_stock_price(price_symbol)
    elif price_source == "mfapi":
        return get_mf_nav(price_symbol)
    else:
        return None
