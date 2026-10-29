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
