# AI research architecture

## Product boundary

The existing portfolio engine remains the only component allowed to produce Buy, Review, Continue, or Sell actions. The AI feature reads narrative evidence and returns a separate evidence signal: `supports`, `unclear`, or `contradicts`.

```text
Deterministic market inputs -> portfolio action
Financial report passages  -> AI evidence signal
                                      |
                                      v
                         displayed together, never merged
```

The model must not predict a price or replace the portfolio action. This boundary makes incorrect model output detectable and keeps every financial calculation reproducible.

## Request flow

1. The authenticated user saves an investment thesis for a holding.
2. The server obtains a company filing or accepts report text supplied by the user.
3. The document is cleaned while preserving filing section boundaries, then split into stable citation chunks.
4. The thesis is split into independently testable claims. Each claim gets its own expanded retrieval query, and the result set reserves evidence for every claim instead of allowing a broad risk section to dominate.
5. When a local embedding model is available, semantic similarity and BM25-style lexical relevance are combined. Claim-aware lexical retrieval remains the zero-dependency fallback.
6. Only the highest-ranked passages and the thesis are sent to the configured language model. The numerical action is deliberately excluded from the prompt so it cannot bias the evidence verdict.
7. Model output is parsed into a strict application schema. Unknown citations, missing evidence, and invalid enum values fail validation. A second grounding pass removes claims whose cited text is unrelated to the thesis and converts unsupported citations to `unclear`.
8. The result preserves partial support, identifies evidence gaps, and produces concrete questions for the next filing. It is stored under the owning user and holding; a pipeline version in the cache key prevents stale analysis formats from being reused after an upgrade.

## Provider and cost policy

Local development and evaluation use Ollama. Production can use an OpenAI-compatible hosted provider configured with server-only environment variables. No model secret is sent to the browser. If no provider is configured, the UI reports that AI analysis is unavailable instead of presenting deterministic text as model output.

## Evaluation policy

The labeled evaluation set contains at least 30 synthetic company-report cases. The benchmark reports retrieval Recall@5, evidence-signal accuracy, risk-level accuracy, citation precision, structured-output validity, tokens, and p50/p95 end-to-end latency. Results are recorded only after executing the benchmark; unmeasured values are never estimated.
