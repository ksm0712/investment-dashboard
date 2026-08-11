export type AssetType = "Stock" | "ETF" | "Mutual Fund" | "Bond" | "Savings" | "Other";

import type { AssetCalculation, InvestmentLot, PortfolioAction } from "./portfolio-engine";

export type Lot = InvestmentLot & {
  id: number;
  securityId: number;
  purchaseDate: string | null;
  fees: number;
};

export type Security = AssetCalculation & {
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
  changePercent: number | null;
  sector: string | null;
  industry: string | null;
  trailingPe: number | null;
  forwardPe: number | null;
  pegRatio: number | null;
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
  targetPrice: number | null;
  secondaryTargetPrice: number | null;
  targetSource: string | null;
  targetAsOn: string | null;
  week52Low: number | null;
  week52High: number | null;
  marketDataSource: string | null;
  marketDataAsOn: string | null;
  allocation: number | null;
  lots: Lot[];
  action: PortfolioAction;
  source: string;
};

export type Portfolio = {
  id: number;
  name: string;
  date: string;
  userId: string;
};

export type ActionHistoryEntry = {
  id: number;
  securityId: number;
  securityName: string;
  action: PortfolioAction;
  previousAction: PortfolioAction | null;
  currentPrice: number | null;
  targetPrice: number | null;
  source: string | null;
  reasons: string[];
  recordedAt: string;
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
  changePercent?: number | null;
  priceSymbol?: string;
  priceSource?: string | null;
  priceAsOn?: string | null;
  exchange?: string;
  purchaseDate: string;
  allocation?: number | null;
  targetPrice?: number | null;
  secondaryTargetPrice?: number | null;
  targetSource?: string | null;
  targetAsOn?: string | null;
  week52Low?: number | null;
  week52High?: number | null;
  sector?: string | null;
  industry?: string | null;
  trailingPe?: number | null;
  forwardPe?: number | null;
  pegRatio?: number | null;
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
