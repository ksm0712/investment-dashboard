import assert from "node:assert/strict";
import test from "node:test";
import { monitoringChecklistText, researchRunToMarkdown } from "./research-export.ts";
import type { ResearchRun } from "./ai-research-types.ts";

test("research export preserves the thesis, verdict, checks, and source links", () => {
  const run = {
    pipelineVersion: 4, securityId: 1, thesis: "Revenue grows next year.", numericalAction: "Monitor", provider: "test", model: "test", retrievalMethod: "lexical", latencyMs: 10, inputTokens: null, outputTokens: null, cached: false, createdAt: "2026-10-28T10:00:00.000Z", sourceTitle: "10-Q", sourceUrl: "https://example.com/10q", sourceDate: "2026-09-30", sources: [],
    analysis: { businessOutlook: "positive", riskLevel: "medium", evidenceSignal: "supports", summary: "Guidance supports the claim.", positiveEvidence: [], risks: [], evidenceGaps: [], monitoringQuestions: ["Did guidance change?"], limitations: [], thesisChecks: [{ statement: "Revenue grows next year", status: "supported", explanation: "Guidance calls for growth.", citationIds: ["C1"] }] },
    citations: [{ chunkId: "C1", excerpt: "Management expects revenue growth.", sourceTitle: "10-Q", sourceUrl: "https://example.com/10q" }],
  } satisfies ResearchRun;
  const markdown = researchRunToMarkdown(run, "Example Co.");
  assert.match(markdown, /Example Co\. — Thesis evidence review/);
  assert.match(markdown, /SUPPORTED — Revenue grows next year/);
  assert.match(markdown, /\[Open source\]\(https:\/\/example.com\/10q\)/);
  assert.match(markdown, /pipeline v4/);
  assert.equal(monitoringChecklistText(run), "1. Did guidance change?");
});
