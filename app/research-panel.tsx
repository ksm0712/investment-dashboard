"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CircleHelp, ExternalLink, FileCheck2, FileSearch, Save, Square } from "lucide-react";
import type { ResearchClaim, ResearchRecord, ResearchRun, ThesisCheck } from "@/lib/ai-research-types";
import type { Security } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { thesisQuality } from "@/lib/thesis-quality";
import { RESEARCH_PIPELINE_VERSION } from "@/lib/research-version";
import { extractThesisFacets } from "@/lib/research-retrieval";

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
  return <span className="citation-badges">{ids.map((id) => <a key={id} href={`#research-source-${id}`} onClick={() => {
    const source = document.getElementById(`research-source-${id}`);
    const details = source?.closest("details");
    if (details) details.open = true;
  }} aria-label={`Jump to source ${id}`}>{id}</a>)}</span>;
}

function ClaimList({ title, claims, tone }: { title: string; claims: ResearchClaim[]; tone: "positive" | "risk" }) {
  return (
    <section className={`research-claim-group ${tone}`}>
      <h4>{title}</h4>
      {claims.length ? (
        <ul>{claims.map((claim, index) => <li key={`${claim.claim}-${index}`}><span>{claim.claim}</span><CitationBadges ids={claim.citationIds} /></li>)}</ul>
      ) : <p>{tone === "positive" ? "No thesis-relevant positive evidence was found." : "No thesis-relevant risk was found in this source."}</p>}
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
  const evidenceGaps = result.evidenceGaps || [];
  const monitoringQuestions = result.monitoringQuestions || [];
  const coverage = result.coverage || {
    totalClaims: result.thesisChecks.length,
    supported: result.thesisChecks.filter((check) => check.status === "supported").length,
    contradicted: result.thesisChecks.filter((check) => check.status === "contradicted").length,
    unclear: result.thesisChecks.filter((check) => check.status === "unclear").length,
    citedClaims: result.thesisChecks.filter((check) => check.citationIds.length > 0).length,
  };
  const sourceCount = run.sources?.length || 1;
  const implication = result.evidenceSignal === "supports"
    ? "Every material claim was supported by direct evidence. Keep the cited metrics on your monitoring list."
    : result.evidenceSignal === "contradicts"
      ? "At least one material claim conflicts with direct filing evidence. Revisit that assumption before relying on the thesis."
      : "The filings do not answer every material claim. Treat the gaps below as work to do, not as confirmation.";
  return (
    <div className="research-result">
      <div className="dual-signal">
        <div><span>Numerical engine</span><strong>{run.numericalAction}</strong><small>Calculated from price, target, allocation, and lots</small></div>
        <div className={`evidence-${result.evidenceSignal}`}><span>Evidence verdict</span><strong>{signalLabel(result.evidenceSignal)}</strong><small>Business outlook: {result.businessOutlook} · Thesis risk: {result.riskLevel}</small></div>
      </div>
      <div className="research-coverage" aria-label="Evidence coverage">
        <div><span>Claims checked</span><strong>{coverage.totalClaims}</strong></div>
        <div className="supported"><span>Supported</span><strong>{coverage.supported}</strong></div>
        <div className="contradicted"><span>Contradicted</span><strong>{coverage.contradicted}</strong></div>
        <div className="unclear"><span>Still unclear</span><strong>{coverage.unclear}</strong></div>
        <div><span>With citations</span><strong>{coverage.citedClaims}/{coverage.totalClaims}</strong></div>
      </div>
      {result.evidenceQuality && <div className={`research-quality research-quality-${result.evidenceQuality.rating}`}>
        <div><span>Evidence quality</span><strong>{result.evidenceQuality.rating}</strong></div>
        <p>{result.evidenceQuality.directlyAnswered} of {coverage.totalClaims} claims directly answered · {result.evidenceQuality.citationRate}% cited · {result.evidenceQuality.sourceCount} first-party source{result.evidenceQuality.sourceCount === 1 ? "" : "s"}{result.evidenceQuality.freshestSourceDate ? ` · newest ${fmtDate(result.evidenceQuality.freshestSourceDate)}` : ""}</p>
      </div>}
      <p className="research-summary">{result.summary}</p>
      <div className={`research-implication ${result.evidenceSignal}`}><strong>What this means</strong><span>{implication}</span></div>
      <div className="research-claims-grid">
        <ClaimList title="Supported positives" claims={result.positiveEvidence} tone="positive" />
        <ClaimList title="Evidence-based risks" claims={result.risks} tone="risk" />
      </div>
      <ThesisChecks checks={result.thesisChecks} />
      {(evidenceGaps.length > 0 || monitoringQuestions.length > 0) && <section className="research-next-steps">
        <div className="research-next-steps-title"><CircleHelp size={15} /><div><h4>What would make this answer stronger?</h4><p>Use these checks in the next filing or earnings update.</p></div></div>
        {evidenceGaps.length > 0 && <div className="evidence-gaps">{evidenceGaps.map((gap, index) => <div key={`${gap.claim}-${index}`}><strong>{gap.claim}</strong><p>{gap.neededEvidence}</p></div>)}</div>}
        {monitoringQuestions.length > 0 && <ul>{monitoringQuestions.map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}</ul>}
      </section>}
      {result.limitations.length > 0 && <div className="research-limitations"><AlertTriangle size={14} /><span><b>Limits:</b> {result.limitations.join(" ")}</span></div>}
      <details className="research-citations">
        <summary><span>Source evidence</span><small>{run.citations.length} passage{run.citations.length === 1 ? "" : "s"} · {sourceCount} filing{sourceCount === 1 ? "" : "s"}</small></summary>
        <div className="citation-list">{run.citations.map((citation) => <div className="research-citation" id={`research-source-${citation.chunkId}`} key={citation.chunkId}>
          <b>{citation.chunkId}</b>
          <div><p>{citation.excerpt}{citation.excerpt.length >= 520 ? "…" : ""}</p><span>{citation.heading ? `${citation.heading} · ` : ""}{citation.sourceTitle}{citation.sourceDate ? ` · ${fmtDate(citation.sourceDate)}` : ""}</span></div>
          {citation.sourceUrl && <a href={citation.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open source for ${citation.chunkId}`}><ExternalLink size={14} /></a>}
        </div>)}</div>
      </details>
      <details className="research-run-details">
        <summary>Review details</summary>
        {run.sources && <ul className="research-source-list">{run.sources.map((source) => <li key={`${source.url}-${source.title}`}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}{source.date ? <span>{fmtDate(source.date)}</span> : null}</li>)}</ul>}
        <div className="research-run-meta">
          <span>{run.provider} · {run.model}</span>
          <span>{run.retrievalMethod} retrieval</span>
          <span>{run.cached ? "cached response" : `${run.latencyMs} ms processing`}</span>
          {(run.inputTokens !== null || run.outputTokens !== null) && <span>{(run.inputTokens || 0) + (run.outputTokens || 0)} tokens</span>}
          <span>{fmtDate(run.createdAt)}</span>
          {run.sources && <span>{run.sources.length} source filing{run.sources.length === 1 ? "" : "s"}</span>}
        </div>
      </details>
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
  const [error, setError] = useState<{ message: string; retryable?: boolean } | null>(null);
  const [analysisStage, setAnalysisStage] = useState(0);
  const analysisController = useRef<AbortController | null>(null);
  const sourceDraftKey = `thesis:research-source:${security.id}`;

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
      .catch((loadError) => active && setError({ message: loadError instanceof Error ? loadError.message : "Could not load research." }));
    return () => { active = false; };
  }, [security.id]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(sourceDraftKey);
      if (!saved) return;
      const draft = JSON.parse(saved) as { sourceTitle?: string; sourceUrl?: string; sourceDate?: string; documentText?: string };
      setSourceTitle(draft.sourceTitle || "");
      setSourceUrl(draft.sourceUrl || "");
      setSourceDate(draft.sourceDate || "");
      setDocumentText(draft.documentText || "");
    } catch {
      window.localStorage.removeItem(sourceDraftKey);
    }
  }, [sourceDraftKey]);

  useEffect(() => {
    const hasDraft = sourceTitle || sourceUrl || sourceDate || documentText;
    if (!hasDraft) return;
    window.localStorage.setItem(sourceDraftKey, JSON.stringify({ sourceTitle, sourceUrl, sourceDate, documentText }));
  }, [documentText, sourceDate, sourceDraftKey, sourceTitle, sourceUrl]);

  function clearSourceDraft() {
    setSourceTitle("");
    setSourceUrl("");
    setSourceDate("");
    setDocumentText("");
    window.localStorage.removeItem(sourceDraftKey);
  }

  useEffect(() => {
    if (!analyzing) {
      setAnalysisStage(0);
      return;
    }
    const interval = window.setInterval(() => setAnalysisStage((current) => Math.min(current + 1, 2)), 2_800);
    return () => window.clearInterval(interval);
  }, [analyzing]);

  useEffect(() => () => analysisController.current?.abort(), []);

  async function saveThesis() {
    setError(null);
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
      setError({ message: saveError instanceof Error ? saveError.message : "Could not save thesis." });
    } finally {
      setSaving(false);
    }
  }

  async function analyze() {
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    setError(null);
    setMessage("");
    setAnalyzing(true);
    try {
      const response = await fetch(`/api/investments/${security.id}/research/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesis, documentText, sourceTitle, sourceUrl, sourceDate }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        const failure = new Error(data.error || "Could not analyze this report.") as Error & { retryable?: boolean };
        failure.retryable = Boolean(data.retryable);
        throw failure;
      }
      setPayload((current) => current ? { ...current, thesis, analysis: data.run } : current);
      const remaining = Number.isFinite(data.usage?.limit) && Number.isFinite(data.usage?.used) ? Math.max(0, data.usage.limit - data.usage.used) : null;
      setMessage(data.run.cached ? "Loaded the matching evidence review." : `Evidence review completed.${remaining === null ? "" : ` ${remaining} check${remaining === 1 ? "" : "s"} remaining today.`}`);
    } catch (analyzeError) {
      if (controller.signal.aborted) {
        setMessage("Evidence review cancelled.");
        return;
      }
      const failure = analyzeError as Error & { retryable?: boolean };
      setError({ message: analyzeError instanceof Error ? analyzeError.message : "Could not analyze this report.", retryable: Boolean(failure?.retryable) });
    } finally {
      if (analysisController.current === controller) analysisController.current = null;
      setAnalyzing(false);
    }
  }

  function cancelAnalysis() {
    analysisController.current?.abort();
  }

  const automatic = Boolean(payload?.automaticSourceAvailable && !documentText.trim());
  const sourceReady = automatic || documentText.trim().length >= 100;
  const savedThesis = payload?.thesis.trim() || "";
  const thesisChanged = thesis.trim() !== savedThesis;
  const analysisMatchesThesis = Boolean(payload?.analysis && payload.analysis.thesis.trim() === thesis.trim());
  const analysisUsesCurrentMethod = payload?.analysis?.pipelineVersion === RESEARCH_PIPELINE_VERSION;
  const analysisIsCurrent = Boolean(analysisMatchesThesis && analysisUsesCurrentMethod);
  const quality = useMemo(() => thesisQuality(thesis), [thesis]);
  const thesisClaims = useMemo(() => extractThesisFacets(thesis), [thesis]);
  const thesisReady = thesis.trim().length >= 10 && quality.score >= 50;
  const analysisStages = ["Collecting company filings…", "Finding evidence for each claim…", "Validating verdicts and citations…"];
  return (
    <section className="ai-research-panel" aria-label={`Thesis evidence for ${security.name}`}>
      <div className="research-panel-head">
        <div><div className="eyebrow"><FileCheck2 size={13} /> Thesis evidence</div><h3>Test your thesis against the filing.</h3><p>Each claim is checked against first-party evidence. Your portfolio action stays independent and fully deterministic.</p></div>
        <span className="research-boundary">Source-grounded</span>
      </div>

      <div className="research-input-grid">
        <div className="research-thesis-editor">
          <div className="thesis-editor-head"><label htmlFor={`thesis-${security.id}`}>Your investment thesis</label><span className={`thesis-score ${quality.score >= 75 ? "ready" : "needs-work"}`}>{quality.score}% ready</span></div>
          <textarea id={`thesis-${security.id}`} value={thesis} maxLength={2_000} onChange={(event) => { setThesis(event.target.value); setMessage(""); }} placeholder="Example: Recurring revenue should grow over the next year while gross margin remains above 60%. The main risk is customer concentration." />
          <div className="thesis-quality-list">
            {quality.checks.map((check) => <span className={check.passed ? "passed" : ""} key={check.id} title={check.guidance}><i>{check.passed ? <Check size={10} /> : "·"}</i>{check.label}</span>)}
          </div>
          {thesisClaims.length > 0 && <div className="research-claim-preview"><span>Claims this review will test</span><ol>{thesisClaims.map((claim) => <li key={claim}>{claim}</li>)}</ol></div>}
          {quality.score < 75 && thesis.trim().length >= 10 && <p className="research-thesis-tip">{quality.checks.find((check) => !check.passed)?.guidance}</p>}
          <div className="research-editor-actions"><span>{thesis.length}/2,000{thesisChanged ? " · Unsaved changes" : ""}</span><button className="table-btn" onClick={saveThesis} disabled={saving || !thesisChanged || thesis.trim().length < 10}><Save size={13} /> {saving ? "Saving…" : thesisChanged || !savedThesis ? "Save thesis" : "Saved"}</button></div>
        </div>
        <details className="research-source-editor">
          <summary><FileSearch size={14} /> {payload?.automaticSourceAvailable ? "Use pasted report text instead" : "Paste company report evidence"}</summary>
          <div className="research-source-fields">
            <input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="Source title (for example, Q2 earnings release)" />
            <div><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://source-url.com" /><input type="date" value={sourceDate} onChange={(event) => setSourceDate(event.target.value)} /></div>
            <textarea value={documentText} maxLength={250_000} onChange={(event) => setDocumentText(event.target.value)} placeholder="Paste at least 100 characters from a filing, earnings release, or company report…" />
            {(sourceTitle || sourceUrl || sourceDate || documentText) && <div className="research-source-draft"><span>Draft saved in this browser</span><button type="button" onClick={clearSourceDraft}>Clear draft</button></div>}
          </div>
        </details>
      </div>

      <div className="research-action-row">
        <button className="research-run-button" onClick={analyze} disabled={analyzing || !payload?.providerConfigured || !thesisReady || !sourceReady}>
          <FileCheck2 size={15} /> {analyzing ? analysisStages[analysisStage] : automatic ? "Run evidence check" : "Check supplied report"}
        </button>
        {analyzing && <button type="button" className="research-cancel-button" onClick={cancelAnalysis}><Square size={12} /> Cancel</button>}
        {!payload?.providerConfigured && payload && <span className="research-config-note">The research engine is not configured on this deployment.</span>}
        {automatic && <span className="research-config-note">Reviews the latest complementary quarterly and annual SEC filings, with citations to the exact source passage.</span>}
        {payload && !payload.automaticSourceAvailable && documentText.trim().length < 100 && <span className="research-config-note">Paste at least 100 characters of first-party report evidence to run the check.</span>}
        {thesis.trim().length >= 10 && quality.score < 50 && <span className="research-config-note">Add a measurable driver and expected direction before running the check.</span>}
        {message && <span className="research-message">{message}</span>}
      </div>
      {error && <div className="research-error"><AlertTriangle size={15} /><span>{error.message}</span>{error.retryable && <button type="button" onClick={analyze} disabled={analyzing}>Try again</button>}</div>}
      {payload?.analysis && !analysisIsCurrent && <div className="research-stale"><AlertTriangle size={14} /><span>{analysisMatchesThesis ? "This review used an older analysis method. Run it again before relying on the result." : "This result belongs to the previously saved thesis. Run a new evidence check before relying on it."}</span></div>}
      {payload?.analysis ? <div className={analysisIsCurrent ? "" : "research-result-stale"}><AnalysisResult run={payload.analysis} /></div> : <div className="research-empty"><strong>No evidence check yet</strong><span>Write a measurable thesis, then run the latest filing or paste a first-party report.</span></div>}
    </section>
  );
}
