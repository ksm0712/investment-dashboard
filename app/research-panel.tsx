"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, FileSearch, Save, Sparkles } from "lucide-react";
import type { ResearchClaim, ResearchRecord, ResearchRun, ThesisCheck } from "@/lib/ai-research-types";
import type { Security } from "@/lib/types";
import { fmtDate } from "@/lib/format";

type ResearchPayload = ResearchRecord & {
  providerConfigured: boolean;
  automaticSourceAvailable: boolean;
};

function signalLabel(signal: ResearchRun["analysis"]["evidenceSignal"]) {
  if (signal === "supports") return "Supports your thesis";
  if (signal === "contradicts") return "Contradicts your thesis";
  return "Evidence is unclear";
}

function CitationBadges({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return <span className="citation-badges">{ids.map((id) => <b key={id}>{id}</b>)}</span>;
}

function ClaimList({ title, claims, tone }: { title: string; claims: ResearchClaim[]; tone: "positive" | "risk" }) {
  return (
    <section className={`research-claim-group ${tone}`}>
      <h4>{title}</h4>
      {claims.length ? (
        <ul>{claims.map((claim, index) => <li key={`${claim.claim}-${index}`}><span>{claim.claim}</span><CitationBadges ids={claim.citationIds} /></li>)}</ul>
      ) : <p>No supported claims were found.</p>}
    </section>
  );
}

function ThesisChecks({ checks }: { checks: ThesisCheck[] }) {
  if (!checks.length) return null;
  return (
    <section className="thesis-checks">
      <h4>Thesis checks</h4>
      {checks.map((check, index) => <div className="thesis-check" key={`${check.statement}-${index}`}>
        <span className={`check-status ${check.status}`}>{check.status}</span>
        <div><strong>{check.statement}</strong><p>{check.explanation} <CitationBadges ids={check.citationIds} /></p></div>
      </div>)}
    </section>
  );
}

function AnalysisResult({ run }: { run: ResearchRun }) {
  const result = run.analysis;
  return (
    <div className="research-result">
      <div className="dual-signal">
        <div><span>Numerical engine</span><strong>{run.numericalAction}</strong><small>Calculated from price, target, allocation, and lots</small></div>
        <div className={`evidence-${result.evidenceSignal}`}><span>AI evidence signal</span><strong>{signalLabel(result.evidenceSignal)}</strong><small>Business outlook: {result.businessOutlook} · Risk: {result.riskLevel}</small></div>
      </div>
      <p className="research-summary">{result.summary}</p>
      <div className="research-claims-grid">
        <ClaimList title="Supported positives" claims={result.positiveEvidence} tone="positive" />
        <ClaimList title="Evidence-based risks" claims={result.risks} tone="risk" />
      </div>
      <ThesisChecks checks={result.thesisChecks} />
      {result.limitations.length > 0 && <div className="research-limitations"><AlertTriangle size={14} /><span><b>Limits:</b> {result.limitations.join(" ")}</span></div>}
      <section className="research-citations">
        <h4>Source evidence</h4>
        {run.citations.map((citation) => <div className="research-citation" key={citation.chunkId}>
          <b>{citation.chunkId}</b>
          <div><p>{citation.excerpt}{citation.excerpt.length >= 420 ? "…" : ""}</p><span>{citation.sourceTitle}</span></div>
          {citation.sourceUrl && <a href={citation.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open source for ${citation.chunkId}`}><ExternalLink size={14} /></a>}
        </div>)}
      </section>
      <div className="research-run-meta">
        <span>{run.provider} · {run.model}</span>
        <span>{run.retrievalMethod} retrieval</span>
        <span>{run.cached ? "cached response" : `${run.latencyMs} ms model latency`}</span>
        {(run.inputTokens !== null || run.outputTokens !== null) && <span>{(run.inputTokens || 0) + (run.outputTokens || 0)} tokens</span>}
        <span>{fmtDate(run.createdAt)}</span>
      </div>
    </div>
  );
}

export default function ResearchPanel({ security }: { security: Security }) {
  const [payload, setPayload] = useState<ResearchPayload | null>(null);
  const [thesis, setThesis] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceDate, setSourceDate] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/investments/${security.id}/research`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load research.");
        if (active) {
          setPayload(data);
          setThesis(data.thesis || "");
        }
      })
      .catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : "Could not load research."));
    return () => { active = false; };
  }, [security.id]);

  async function saveThesis() {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const response = await fetch(`/api/investments/${security.id}/research`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesis }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save thesis.");
      setPayload((current) => current ? { ...current, thesis: data.thesis, analysis: current.thesis === data.thesis ? current.analysis : null } : current);
      setMessage("Investment thesis saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save thesis.");
    } finally {
      setSaving(false);
    }
  }

  async function analyze() {
    setError("");
    setMessage("");
    setAnalyzing(true);
    try {
      const response = await fetch(`/api/investments/${security.id}/research/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesis, documentText, sourceTitle, sourceUrl, sourceDate }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not analyze this report.");
      setPayload((current) => current ? { ...current, thesis, analysis: data.run } : current);
      setMessage(data.run.cached ? "Loaded the matching cached analysis." : "AI research completed.");
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : "Could not analyze this report.");
    } finally {
      setAnalyzing(false);
    }
  }

  const automatic = Boolean(payload?.automaticSourceAvailable && !documentText.trim());
  return (
    <section className="ai-research-panel" aria-label={`AI research for ${security.name}`}>
      <div className="research-panel-head">
        <div><div className="eyebrow"><Sparkles size={13} /> AI evidence research</div><h3>Does the business evidence support your thesis?</h3><p>The numerical action stays unchanged. AI reads report text and checks it against your reason for owning this asset.</p></div>
        <span className="research-boundary">Research only · not financial advice</span>
      </div>

      <div className="research-input-grid">
        <div className="research-thesis-editor">
          <label htmlFor={`thesis-${security.id}`}>Your investment thesis</label>
          <textarea id={`thesis-${security.id}`} value={thesis} maxLength={2_000} onChange={(event) => setThesis(event.target.value)} placeholder="Example: I expect recurring revenue to grow while margins remain stable. The main risk is customer concentration." />
          <div className="research-editor-actions"><span>{thesis.length}/2,000</span><button className="table-btn" onClick={saveThesis} disabled={saving}><Save size={13} /> {saving ? "Saving" : "Save thesis"}</button></div>
        </div>
        <details className="research-source-editor">
          <summary><FileSearch size={14} /> {payload?.automaticSourceAvailable ? "Use pasted report text instead" : "Paste company report evidence"}</summary>
          <div className="research-source-fields">
            <input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="Source title (for example, Q2 earnings release)" />
            <div><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://source-url.com" /><input type="date" value={sourceDate} onChange={(event) => setSourceDate(event.target.value)} /></div>
            <textarea value={documentText} maxLength={250_000} onChange={(event) => setDocumentText(event.target.value)} placeholder="Paste at least 100 characters from a filing, earnings release, or company report…" />
          </div>
        </details>
      </div>

      <div className="research-action-row">
        <button className="research-run-button" onClick={analyze} disabled={analyzing || !payload?.providerConfigured || thesis.trim().length < 10}>
          <Sparkles size={15} /> {analyzing ? "Reading and checking evidence…" : automatic ? "Analyze latest SEC filing" : "Analyze supplied report"}
        </button>
        {!payload?.providerConfigured && payload && <span className="research-config-note">AI provider is not configured on this deployment.</span>}
        {automatic && <span className="research-config-note">Automatically uses the latest SEC 10-K, 10-Q, 20-F, or 40-F.</span>}
        {message && <span className="research-message">{message}</span>}
      </div>
      {error && <div className="research-error">{error}</div>}
      {payload?.analysis ? <AnalysisResult run={payload.analysis} /> : <div className="research-empty">Save a thesis, then analyze an SEC filing or pasted company report. The AI signal will appear here beside <b>{security.action}</b>.</div>}
    </section>
  );
}
