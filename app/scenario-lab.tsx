"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { fmt, fmtPct, fmtUnit } from "@/lib/format";
import { buildDecisionMap, compareScenario, defaultScenario, evaluateScenario, scenarioPresets, type ScenarioOverrides } from "@/lib/scenario-lab";
import type { Security } from "@/lib/types";

function actionClass(action: string) {
  return action.toLowerCase().replaceAll(" ", "-");
}

export default function ScenarioLab({ security }: { security: Security }) {
  const baseline = useMemo(() => defaultScenario(security), [security]);
  const [inputs, setInputs] = useState<ScenarioOverrides>(baseline);
  const skipNextSave = useRef(true);
  const storageKey = `thesis:scenario:${security.id}`;
  const result = useMemo(() => evaluateScenario(security, inputs), [inputs, security]);
  const comparison = useMemo(() => compareScenario(security, result), [result, security]);
  const decisionMap = useMemo(() => buildDecisionMap(security, inputs), [inputs, security]);
  const presets = useMemo(() => scenarioPresets(security), [security]);
  const changed = result.changedFields.length > 0;

  useEffect(() => {
    skipNextSave.current = true;
    try {
      const stored = window.localStorage.getItem(storageKey);
      setInputs(stored ? evaluateScenario(security, JSON.parse(stored) as Partial<ScenarioOverrides>).overrides : defaultScenario(security));
    } catch {
      window.localStorage.removeItem(storageKey);
      setInputs(defaultScenario(security));
    }
  }, [security, storageKey]);

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (changed) window.localStorage.setItem(storageKey, JSON.stringify(inputs));
    else window.localStorage.removeItem(storageKey);
  }, [changed, inputs, storageKey]);

  function update(field: keyof ScenarioOverrides, value: string) {
    const parsed = value === "" ? 0 : Number(value);
    setInputs((current) => ({ ...current, [field]: Number.isFinite(parsed) ? parsed : current[field] }));
  }

  function reset() {
    skipNextSave.current = true;
    window.localStorage.removeItem(storageKey);
    setInputs(baseline);
  }

  return (
    <section className="scenario-lab" aria-label={`What-if lab for ${security.name}`}>
      <header className="scenario-head">
        <div><span><SlidersHorizontal size={14} /> Private simulation</span><h3>What if the assumptions change?</h3><p>Move the inputs and see the same portfolio rules recalculate instantly. Nothing here is saved.</p></div>
        <div className="scenario-head-actions">{changed && <span>Draft saved locally</span>}<button type="button" onClick={reset} disabled={!changed}><RotateCcw size={13} /> Reset</button></div>
      </header>
      <div className="scenario-presets" aria-label="Scenario presets">{presets.map((preset) => <button type="button" className={inputs.currentPrice === preset.overrides.currentPrice && inputs.targetPrice === preset.overrides.targetPrice ? "active" : ""} onClick={() => setInputs(preset.overrides)} key={preset.id}><strong>{preset.label}</strong><span>{preset.description}</span></button>)}</div>
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
      <section className="scenario-map" aria-label="Recommendation regions by hypothetical price">
        <div className="scenario-map-head"><div><span>Decision map</span><strong>Recommendation by hypothetical price</strong></div><small>{fmtUnit(decisionMap.minPrice, security.currency)} – {fmtUnit(decisionMap.maxPrice, security.currency)}</small></div>
        <div className="scenario-map-track">
          {decisionMap.ranges.map((range, index) => {
            const width = 100 * (range.to - range.from) / (decisionMap.maxPrice - decisionMap.minPrice);
            return <div className={`scenario-range ${actionClass(range.action)}`} style={{ width: `${width}%` }} title={`${range.action}: ${fmtUnit(range.from, security.currency)} to ${fmtUnit(range.to, security.currency)}`} key={`${range.action}-${index}`}>{width >= 13 ? <span>{range.action.replace("Continue to ", "")}</span> : null}</div>;
          })}
          <i className="scenario-marker current" style={{ left: `${100 * (baseline.currentPrice - decisionMap.minPrice) / (decisionMap.maxPrice - decisionMap.minPrice)}%` }}><span>Today</span></i>
          <i className="scenario-marker hypothetical" style={{ left: `${100 * (result.overrides.currentPrice - decisionMap.minPrice) / (decisionMap.maxPrice - decisionMap.minPrice)}%` }}><span>Scenario</span></i>
        </div>
        <div className="scenario-map-scale"><span>{fmtUnit(decisionMap.minPrice, security.currency)}</span><span>{fmtUnit(decisionMap.maxPrice, security.currency)}</span></div>
      </section>
    </section>
  );
}
