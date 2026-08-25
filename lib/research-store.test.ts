import assert from "node:assert/strict";
import test from "node:test";
import { AiRateLimitError, consumeAiRequest, getCachedResearchRun, getResearchRecord, saveResearchRun, saveResearchThesis } from "./research-store.ts";
import type { ResearchRun } from "./ai-research-types.ts";

test("memory research store invalidates analysis when the thesis changes", async () => {
  const userId = `store-${Date.now()}`;
  const securityId = 42;
  const run = {
    securityId, thesis: "Recurring revenue will grow.", numericalAction: "Buy",
    analysis: { businessOutlook: "positive", riskLevel: "low", evidenceSignal: "supports", summary: "Supported.", positiveEvidence: [], risks: [], thesisChecks: [], limitations: [] },
    citations: [], sourceTitle: "Report", sourceUrl: null, sourceDate: null, provider: "test", model: "test",
    retrievalMethod: "lexical", latencyMs: 10, inputTokens: 2, outputTokens: 2, cached: false, createdAt: new Date().toISOString(),
  } satisfies ResearchRun;
  await saveResearchThesis(userId, securityId, run.thesis);
  await saveResearchRun(userId, securityId, "hash-one", run);
  assert.equal((await getCachedResearchRun(userId, securityId, "hash-one"))?.cached, true);
  await saveResearchThesis(userId, securityId, "A different thesis about margins.");
  assert.equal((await getResearchRecord(userId, securityId)).analysis, null);
});

test("daily request limiter rejects requests beyond its configured limit", async () => {
  const previous = process.env.AI_DAILY_REQUEST_LIMIT;
  process.env.AI_DAILY_REQUEST_LIMIT = "2";
  const userId = `limit-${Date.now()}`;
  await consumeAiRequest(userId, 1, 1_000_000);
  await consumeAiRequest(userId, 1, 1_000_001);
  await assert.rejects(() => consumeAiRequest(userId, 1, 1_000_002), AiRateLimitError);
  if (previous === undefined) delete process.env.AI_DAILY_REQUEST_LIMIT;
  else process.env.AI_DAILY_REQUEST_LIMIT = previous;
});
