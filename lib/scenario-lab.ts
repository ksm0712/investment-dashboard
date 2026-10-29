import { calculateAsset, type AssetCalculation } from "./portfolio-engine.ts";
import type { Security } from "./types.ts";

export type ScenarioOverrides = {
  currentPrice: number;
  targetPrice: number;
  week52High: number;
  allocation: number | null;
};

export type ScenarioResult = AssetCalculation & {
  overrides: ScenarioOverrides;
  changedFields: Array<keyof ScenarioOverrides>;
};

export type DecisionRange = {
  action: AssetCalculation["action"];
  from: number;
  to: number;
};

export type DecisionMap = {
  minPrice: number;
  maxPrice: number;
  ranges: DecisionRange[];
};

export type ScenarioComparison = {
  actionChanged: boolean;
  priceChangePct: number;
  marketValueDelta: number | null;
  gainLossDelta: number | null;
  allocationRemainingDelta: number | null;
};

export type ScenarioPreset = {
  id: "pullback" | "base" | "upside";
  label: string;
  description: string;
  overrides: ScenarioOverrides;
};

function finitePositive(value: number | null | undefined, fallback: number) {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function defaultScenario(security: Security): ScenarioOverrides {
  const reference = finitePositive(security.latestPrice, finitePositive(security.averagePurchasePrice, 100));
  return {
    currentPrice: reference,
    targetPrice: finitePositive(security.targetPrice, reference),
    week52High: finitePositive(security.week52High, reference),
    allocation: security.allocation,
  };
}

export function evaluateScenario(security: Security, overrides: Partial<ScenarioOverrides> = {}): ScenarioResult {
  const baseline = defaultScenario(security);
  const normalized: ScenarioOverrides = {
    currentPrice: finitePositive(overrides.currentPrice, baseline.currentPrice),
    targetPrice: finitePositive(overrides.targetPrice, baseline.targetPrice),
    week52High: finitePositive(overrides.week52High, baseline.week52High),
    allocation: overrides.allocation === undefined
      ? baseline.allocation
      : overrides.allocation !== null && Number.isFinite(overrides.allocation) && overrides.allocation >= 0
        ? overrides.allocation
        : null,
  };
  const calculation = calculateAsset({
    currentPrice: normalized.currentPrice,
    targetPrice: normalized.targetPrice,
    week52Low: security.week52Low,
    week52High: normalized.week52High,
    allocation: normalized.allocation,
    lots: security.lots,
  });
  const changedFields = (Object.keys(normalized) as Array<keyof ScenarioOverrides>)
    .filter((field) => normalized[field] !== baseline[field]);
  return { ...calculation, overrides: normalized, changedFields };
}

export function buildDecisionMap(security: Security, overrides: Partial<ScenarioOverrides> = {}, steps = 180): DecisionMap {
  const scenario = evaluateScenario(security, overrides).overrides;
  const anchors = [scenario.currentPrice, scenario.targetPrice, scenario.week52High, security.week52Low, security.lowestPurchasePrice]
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  const minPrice = Math.max(0.01, Math.min(...anchors) * 0.6);
  const maxPrice = Math.max(...anchors) * 1.2;
  const safeSteps = Math.max(40, Math.min(400, Math.round(steps)));
  const increment = (maxPrice - minPrice) / safeSteps;
  const ranges: DecisionRange[] = [];
  for (let index = 0; index <= safeSteps; index += 1) {
    const price = index === safeSteps ? maxPrice : minPrice + increment * index;
    const action = evaluateScenario(security, { ...scenario, currentPrice: price }).action;
    const previous = ranges[ranges.length - 1];
    if (previous?.action === action) previous.to = price;
    else ranges.push({ action, from: price, to: price });
  }
  for (let index = 0; index < ranges.length - 1; index += 1) {
    const boundary = (ranges[index].to + ranges[index + 1].from) / 2;
    ranges[index].to = boundary;
    ranges[index + 1].from = boundary;
  }
  return { minPrice, maxPrice, ranges };
}

export function compareScenario(security: Security, result: ScenarioResult): ScenarioComparison {
  const baseline = evaluateScenario(security);
  const delta = (scenario: number | null, current: number | null) => scenario === null || current === null ? null : scenario - current;
  return {
    actionChanged: result.action !== baseline.action,
    priceChangePct: (result.overrides.currentPrice - baseline.overrides.currentPrice) / baseline.overrides.currentPrice,
    marketValueDelta: delta(result.marketValue, baseline.marketValue),
    gainLossDelta: delta(result.gainLoss, baseline.gainLoss),
    allocationRemainingDelta: delta(result.allocationRemaining, baseline.allocationRemaining),
  };
}

export function scenarioPresets(security: Security): ScenarioPreset[] {
  const baseline = defaultScenario(security);
  const price = (multiplier: number) => Math.round(baseline.currentPrice * multiplier * 100) / 100;
  return [
    { id: "pullback", label: "Pullback", description: "Price −20%", overrides: { ...baseline, currentPrice: price(0.8) } },
    { id: "base", label: "Current", description: "Saved inputs", overrides: baseline },
    { id: "upside", label: "Upside", description: "Price +15%", overrides: { ...baseline, currentPrice: price(1.15) } },
  ];
}

export function scenarioBrief(security: Security, result: ScenarioResult) {
  const amount = (value: number | null) => value === null ? "not available" : `${security.currency} ${Number(value.toFixed(2)).toLocaleString("en-US")}`;
  return [
    `${security.name} — what-if scenario`,
    `Hypothetical price: ${amount(result.overrides.currentPrice)}`,
    `Target: ${amount(result.overrides.targetPrice)}`,
    `52-week high: ${amount(result.overrides.week52High)}`,
    `Allocation limit: ${amount(result.overrides.allocation)}`,
    `Scenario action: ${result.action} (current action: ${security.action})`,
    `Scenario market value: ${amount(result.marketValue)}`,
    `Scenario gain/loss: ${amount(result.gainLoss)}`,
    `Reason: ${result.actionReasons.join(" ")}`,
    "Private simulation only — saved portfolio data was not changed.",
  ].join("\n");
}
