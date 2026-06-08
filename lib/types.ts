export type AssetType = "Stock" | "ETF" | "Mutual Fund" | "Bond" | "Savings" | "Other";

export type Security = {
  id: number;
  portfolioId: number;
  name: string;
  assetType: AssetType;
  currency: string;
  value: number;
  valueInr: number;
  annualIncome: number | null;
  returnPct: number | null;
  quantity: number | null;
  ticker: string | null;
  isin: string | null;
  priceSource: string | null;
  priceSymbol: string | null;
  latestPrice: number | null;
  priceAsOn: string | null;
  latestValue: number | null;
  latestValueInr: number | null;
  refreshStatus: string | null;
  refreshNote: string | null;
  refreshedAt: string | null;
  country: string;
  pricingMode: "auto" | "manual";
  exchange: string | null;
  costPrice: number | null;
  purchaseDate: string | null;
  source: string;
};

export type Portfolio = {
  id: number;
  name: string;
  date: string;
  userId: string;
};

export type User = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};

export type AddInvestmentInput = {
  name: string;
  assetType: AssetType;
  country: string;
  currency: string;
  pricingMode: "auto" | "manual";
  quantity: number;
  costPrice: number;
  currentPrice: number;
  priceSymbol?: string;
  exchange?: string;
  purchaseDate: string;
};

export type SearchResult = {
  label: string;
  name: string;
  assetType: AssetType;
  country: string;
  ticker: string;
  exchange: string;
  identifierType: "Ticker" | "ISIN" | "Scheme code";
};
