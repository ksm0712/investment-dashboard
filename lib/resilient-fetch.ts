export class ProviderHttpError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitOpenError extends Error {
  constructor(provider: string) {
    super(`Circuit open for ${provider} — serving cache/other providers instead of calling it.`);
    this.name = "CircuitOpenError";
  }
}

/** Retry-After can be delay-seconds or an HTTP-date; only delay-seconds is common from these
 * providers, but both are handled since the header format isn't ours to assume. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderHttpError) return error.status === 429 || error.status >= 500;
  // No HTTP status at all — a network error, a timeout, or (for yahoo-finance2, which we don't
  // control the transport of) an internal client error. Treated as transient rather than
  // discarded, since we can't tell a real 4xx apart from a timeout here. See ENGINEERING_LOG.md
  // Phase 3 for why that's a deliberate tradeoff, not an oversight.
  return true;
}

type CircuitState = { failures: number; openedAt: number | null };
const circuits = new Map<string, CircuitState>();

function circuitFor(provider: string): CircuitState {
  let state = circuits.get(provider);
  if (!state) {
    state = { failures: 0, openedAt: null };
    circuits.set(provider, state);
  }
  return state;
}

function circuitThreshold() {
  return Number(process.env.CIRCUIT_FAILURE_THRESHOLD || 5);
}

function circuitCooldownMs() {
  return Number(process.env.CIRCUIT_COOLDOWN_MS || 60_000);
}

/** Open -> refuse calls. After the cooldown, half-open: let exactly one probe through (by
 * clearing openedAt here) and let the caller's success/failure decide whether it closes or
 * reopens. */
function isCircuitOpen(provider: string): boolean {
  const state = circuitFor(provider);
  if (state.openedAt === null) return false;
  if (Date.now() - state.openedAt < circuitCooldownMs()) return true;
  state.openedAt = null;
  state.failures = circuitThreshold() - 1;
  return false;
}

function recordFailure(provider: string) {
  const state = circuitFor(provider);
  state.failures += 1;
  if (state.failures >= circuitThreshold() && state.openedAt === null) {
    state.openedAt = Date.now();
  }
}

function recordSuccess(provider: string) {
  const state = circuitFor(provider);
  state.failures = 0;
  state.openedAt = null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps one provider call with retry (exponential backoff + jitter, capped attempts and a
 * ceiling), honoring Retry-After when a ProviderHttpError carries one, and a circuit breaker
 * that opens after CIRCUIT_FAILURE_THRESHOLD consecutive *exhausted* calls (not raw attempts —
 * one call retried 5 times internally counts as one failure toward the breaker, not five).
 */
export async function withResilience<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  if (isCircuitOpen(provider)) throw new CircuitOpenError(provider);

  const maxAttempts = Number(process.env.RETRY_MAX_ATTEMPTS || 5);
  const baseMs = Number(process.env.RETRY_BASE_MS || 300);
  const ceilingMs = Number(process.env.RETRY_CEILING_MS || 30_000);
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn();
      recordSuccess(provider);
      return result;
    } catch (error) {
      lastError = error;
      const elapsed = Date.now() - start;
      if (!isRetryable(error) || attempt === maxAttempts - 1 || elapsed >= ceilingMs) break;

      const backoff = Math.min(2 ** attempt * baseMs, ceilingMs);
      const jitter = Math.random() * backoff * 0.5;
      const retryAfterMs = error instanceof ProviderHttpError ? error.retryAfterMs : undefined;
      const delay = Math.max(0, Math.min(retryAfterMs ?? backoff + jitter, ceilingMs - elapsed));
      if (delay > 0) await sleep(delay);
    }
  }

  recordFailure(provider);
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}
