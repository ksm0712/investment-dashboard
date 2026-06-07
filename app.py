from pypdf import PdfReader
from pydantic import BaseModel, Field
from typing import List, Optional
import io

class Security(BaseModel):
    name: str = Field(description="Name of the security.")
    asset_type: str = Field(description="'Mutual Fund', 'Bond', 'Stock', 'ETF', 'Savings', or 'Other'")
    currency: str = Field(description="Currency: INR, USD, SGD, EUR, GBP, JPY")
    value: float = Field(description="Current market value in the security's own currency.")
    value_inr: float = Field(description="Current market value converted to INR.")
    quantity: Optional[float] = Field(default=None, description="Number of units, shares, or bond quantity if shown, else null.")
    latest_price: Optional[float] = Field(default=None, description="Latest unit price, NAV, clean price, or market price if shown or available.")
    ticker: Optional[str] = Field(default=None, description="Exchange ticker or symbol if shown or obvious, else null.")
    isin: Optional[str] = Field(default=None, description="ISIN if shown, else null.")
    price_source: Optional[str] = Field(default=None, description="One of 'mfapi', 'yfinance', 'manual', or null.")
    price_symbol: Optional[str] = Field(default=None, description="Scheme code, ticker, ISIN, or source-specific price identifier if known, else null.")
    annual_income: Optional[float] = Field(default=None, description="Annual income if mentioned, else null.")
    return_pct: Optional[float] = Field(default=None, description="Return % as a number e.g. 5.2, or null.")

class Portfolio(BaseModel):
    name: str = Field(description="Institution, bank, broker, platform, or organisation that issued this portfolio statement. Do not use the account holder name unless no institution is shown.")
    date: str = Field(description="Report date as DD-MMM-YYYY e.g. 21-Apr-2026.")
    securities: List[Security]

def extract_text(file):
    reader = PdfReader(io.BytesIO(file.read()))
    text = ""
    for page in reader.pages:
        text += page.extract_text()
    return text
