"use client";

import { useMemo, useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { fmt, fmtPct, fmtUnit } from "@/lib/format";
import { compareScenario, defaultScenario, evaluateScenario, type ScenarioOverrides } from "@/lib/scenario-lab";
import type { Security } from "@/lib/types";

function actionClass(action: string) {
  return action.toLowerCase().replaceAll(" ", "-");
}

export default function ScenarioLab({ security }: { security: Security }) {
  const baseline = useMemo(() => defaultScenario(security), [security]);
  const [inputs, setInputs] = useState<ScenarioOverrides>(baseline);
  const result = useMemo(() => evaluateScenario(security, inputs), [inputs, security]);
  const comparison = useMemo(() => compareScenario(security, result), [result, security]);
  const changed = result.changedFields.length > 0;

  function update(field: keyof ScenarioOverrides, value: string) {
    const parsed = value === "" ? 0 : Number(value);
    setInputs((current) => ({ ...current, [field]: Number.isFinite(parsed) ? parsed : current[field] }));
  }

  return (
    <section className="scenario-lab" aria-label={`What-if lab for ${security.name}`}>
      <header className="scenario-head">
        <div><span><SlidersHorizontal size={14} /> Private simulation</span><h3>What if the assumptions change?</h3><p>Move the inputs and see the same portfolio rules recalculate instantly. Nothing here is saved.</p></div>
        <button type="button" onClick={() => setInputs(baseline)} disabled={!changed}><RotateCcw size={13} /> Reset</button>
      </header>
      <div className="scenario-inputs">
        <label>Hypothetical price<div><span>{security.currency}</span><input aria-label="Hypothetical price" type="number" min="0.01" step="0.01" value={inputs.currentPrice} onChange={(event) => update("currentPrice", event.target.value)} /></div><small>Now {fmtUnit(security.latestPrice, security.currency)}</small></label>
        <label>Target price<div><span>{security.currency}</span><input aria-label="Scenario target price" type="number" min="0.01" step="0.01" value={inputs.targetPrice} onChange={(event) => update("targetPrice", event.target.value)} /></div><small>Saved {fmtUnit(security.targetPrice, security.currency)}</small></label>
        <label>52-week high<div><span>{security.currency}</span><input aria-label="Scenario 52-week high" type="number" min="0.01" step="0.01" value={inputs.week52High} onChange={(event) => update("week52High", event.target.value)} /></div><small>Saved {fmtUnit(security.week52High, security.currency)}</small></label>
        <label>Allocation limit<div><span>{security.currency}</span><input aria-label="Scenario allocation limit" type="number" min="0" step="1" value={inputs.allocation ?? ""} onChange={(event) => update("allocation", event.target.value)} /></div><small>Saved {security.allocation === null ? "not set" : fmt(security.allocation, security.currency)}</small></label>
      </div>
      <div className="scenario-verdict" aria-live="polite">
        <div><span>Scenario action</span><strong className={`action-badge large ${actionClass(result.action)}`}>{result.action}</strong></div>
        <div><span>Market value</span><strong>{fmt(result.marketValue, security.currency)}</strong><small>{fmtPct(result.gainPct, true)} return</small></div>
        <div><span>Allocation left</span><strong>{fmt(result.allocationRemaining, security.currency)}</strong><small>{result.allocationRemaining !== null && result.allocationRemaining < 0 ? "Over the scenario limit" : "Available in this scenario"}</small></div>
        <p>{result.actionReasons.join(" ")}</p>
      </div>
      <div className={`scenario-comparison ${comparison.actionChanged ? "changed" : ""}`}>
        <div><span>Compared with today</span><strong>{comparison.actionChanged ? `${security.action} → ${result.action}` : `Still ${result.action}`}</strong></div>
        <div><span>Price move</span><strong className={comparison.priceChangePct >= 0 ? "good" : "bad"}>{fmtPct(comparison.priceChangePct, true)}</strong></div>
        <div><span>Value change</span><strong className={(comparison.marketValueDelta ?? 0) >= 0 ? "good" : "bad"}>{comparison.marketValueDelta === null ? "—" : fmt(comparison.marketValueDelta, security.currency)}</strong></div>
        <div><span>P&amp;L change</span><strong className={(comparison.gainLossDelta ?? 0) >= 0 ? "good" : "bad"}>{comparison.gainLossDelta === null ? "—" : fmt(comparison.gainLossDelta, security.currency)}</strong></div>
      </div>
    </section>
  );
}
