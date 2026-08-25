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
3. The document is cleaned, split into stable citation chunks, and ranked against the thesis and a financial-risk query.
4. When a local embedding model is available, semantic similarity and BM25-style lexical relevance are combined. Lexical retrieval remains the zero-dependency fallback.
5. Only the highest-ranked passages, the thesis, and the existing numerical action are sent to the configured language model.
6. Model output is parsed into a strict application schema. Unknown citations, missing evidence, and invalid enum values fail validation.
7. The validated result and selected source excerpts are stored under the owning user and holding. Identical inputs return the cached analysis.

## Provider and cost policy

Local development and evaluation use Ollama. Production can use an OpenAI-compatible hosted provider configured with server-only environment variables. No model secret is sent to the browser. If no provider is configured, the UI reports that AI analysis is unavailable instead of presenting deterministic text as model output.

## Evaluation policy

The labeled evaluation set contains at least 30 synthetic company-report cases. The benchmark reports retrieval Recall@5, evidence-signal accuracy, risk-level accuracy, citation precision, structured-output validity, tokens, and p50/p95 end-to-end latency. Results are recorded only after executing the benchmark; unmeasured values are never estimated.
