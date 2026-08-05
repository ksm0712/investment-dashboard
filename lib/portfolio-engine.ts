export type InvestmentLot = {
  id?: number;
  quantity: number;
  costPrice: number;
  purchaseDate?: string | null;
  fees?: number;
};

export type PortfolioAction =
  | "Sell"
  | "Review to Sell"
  | "Buy"
  | "Review to Buy"
  | "Continue to Monitor"
  | "Insufficient Data";

export type AssetCalculationInput = {
  currentPrice: number | null;
  targetPrice: number | null;
  week52Low: number | null;
  week52High: number | null;
  allocation: number | null;
  lots: InvestmentLot[];
};

export type AssetCalculation = {
  sharesHeld: number;
  investedCost: number;
  averagePurchasePrice: number | null;
  lowestPurchasePrice: number | null;
  marketValue: number | null;
  gainLoss: number | null;
  gainPct: number | null;
  pctAbove52WeekLow: number | null;
  pctBelow52WeekHigh: number | null;
  priceToTarget: number | null;
  pctAboveLowestPurchase: number | null;
  allocationRemaining: number | null;
  aggressiveSellTrigger: number | null;
  pctAboveAggressiveTrigger: number | null;
  conservativeSellTrigger: number | null;
  pctAboveConservativeTrigger: number | null;
  action: PortfolioAction;
  actionReasons: string[];
};

function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function ratio(numerator: number, denominator: number | null) {
  return positive(denominator) ? numerator / denominator : null;
}

/**
 * Reproduces the decision logic in Global Stocks Portfolio.xlsx.
 * Percentages are returned as decimal ratios: 0.25 means 25%.
 */
export function calculateAsset(input: AssetCalculationInput): AssetCalculation {
  const validLots = input.lots.filter(
    (lot) => Number.isFinite(lot.quantity) && lot.quantity > 0 && Number.isFinite(lot.costPrice) && lot.costPrice >= 0,
  );
  const sharesHeld = validLots.reduce((sum, lot) => sum + lot.quantity, 0);
  const investedCost = validLots.reduce(
    (sum, lot) => sum + lot.quantity * lot.costPrice + (Number.isFinite(lot.fees) ? lot.fees || 0 : 0),
    0,
  );
  const averagePurchasePrice = sharesHeld > 0 ? investedCost / sharesHeld : null;
  const lowestPurchasePrice = validLots.length ? Math.min(...validLots.map((lot) => lot.costPrice)) : null;
  const marketValue = positive(input.currentPrice) ? input.currentPrice * sharesHeld : null;
  const gainLoss = marketValue === null ? null : marketValue - investedCost;
  const gainPct = gainLoss === null || investedCost <= 0 ? null : gainLoss / investedCost;

  // These denominator choices intentionally match the spreadsheet exactly.
  const pctAbove52WeekLow = positive(input.currentPrice) && positive(input.week52Low)
    ? (input.currentPrice - input.week52Low) / input.week52Low
    : null;
  const pctBelow52WeekHigh = positive(input.currentPrice) && positive(input.week52High)
    ? (input.week52High - input.currentPrice) / input.week52High
    : null;
  const priceToTarget = positive(input.currentPrice) && positive(input.targetPrice)
    ? (input.targetPrice - input.currentPrice) / input.targetPrice
    : null;
  const pctAboveLowestPurchase = positive(input.currentPrice) && positive(lowestPurchasePrice)
    ? (input.currentPrice - lowestPurchasePrice) / lowestPurchasePrice
    : null;
  const allocationRemaining = input.allocation === null || !Number.isFinite(input.allocation)
    ? null
    : input.allocation - investedCost;
  const aggressiveSellTrigger = positive(input.targetPrice) && positive(input.week52High)
    ? Math.max(input.targetPrice, input.week52High)
    : null;
  const conservativeSellTrigger = positive(input.targetPrice) && positive(input.week52High)
    ? Math.min(input.targetPrice, input.week52High)
    : null;
  const pctAboveAggressiveTrigger = positive(input.currentPrice) && aggressiveSellTrigger !== null
    ? (input.currentPrice - aggressiveSellTrigger) / input.currentPrice
    : null;
  const pctAboveConservativeTrigger = positive(input.currentPrice) && conservativeSellTrigger !== null
    ? (input.currentPrice - conservativeSellTrigger) / input.currentPrice
    : null;
  const atOrBelowLowestPurchase = lowestPurchasePrice === null
    || (positive(input.currentPrice) && input.currentPrice <= lowestPurchasePrice);

  let action: PortfolioAction = "Continue to Monitor";
  const actionReasons: string[] = [];
  if (
    !positive(input.currentPrice)
    || !positive(input.targetPrice)
    || !positive(input.week52High)
    || pctBelow52WeekHigh === null
    || priceToTarget === null
    || pctAboveAggressiveTrigger === null
  ) {
    action = "Insufficient Data";
    if (!positive(input.currentPrice)) actionReasons.push("Current price is unavailable.");
    if (!positive(input.targetPrice)) actionReasons.push("Target price is unavailable.");
    if (!positive(input.week52High)) actionReasons.push("52-week high is unavailable.");
  } else if (pctAboveAggressiveTrigger >= -0.05) {
    action = "Sell";
    actionReasons.push("Price is at or within 5% below the aggressive sell trigger.");
  } else if (pctAboveAggressiveTrigger >= -0.1) {
    action = "Review to Sell";
    actionReasons.push("Price is between 5% and 10% below the aggressive sell trigger.");
  } else {
    const hasAllocation = allocationRemaining !== null && allocationRemaining > 0;
    if (pctBelow52WeekHigh > 0.25 && priceToTarget > 0.25 && atOrBelowLowestPurchase && hasAllocation) {
      action = "Buy";
      actionReasons.push("Price is more than 25% below both the 52-week high and target.");
      actionReasons.push(lowestPurchasePrice === null ? "There are no prior purchase lots." : "Price is at or below the lowest purchase price.");
      actionReasons.push("Allocation remains available.");
    } else if (pctBelow52WeekHigh >= 0.18 && priceToTarget >= 0.18 && atOrBelowLowestPurchase && hasAllocation) {
      action = "Review to Buy";
      actionReasons.push("Price is at least 18% below both the 52-week high and target.");
      actionReasons.push(lowestPurchasePrice === null ? "There are no prior purchase lots." : "Price is at or below the lowest purchase price.");
      actionReasons.push("Allocation remains available.");
    } else {
      actionReasons.push("No buy or sell threshold is currently satisfied.");
      if (!hasAllocation) actionReasons.push("No remaining allocation is available.");
      if (!atOrBelowLowestPurchase) actionReasons.push("Price is above the lowest purchase price.");
    }
  }

  return {
    sharesHeld,
    investedCost,
    averagePurchasePrice,
    lowestPurchasePrice,
    marketValue,
    gainLoss,
    gainPct,
    pctAbove52WeekLow,
    pctBelow52WeekHigh,
    priceToTarget,
    pctAboveLowestPurchase,
    allocationRemaining,
    aggressiveSellTrigger,
    pctAboveAggressiveTrigger,
    conservativeSellTrigger,
    pctAboveConservativeTrigger,
    action,
    actionReasons,
  };
}
