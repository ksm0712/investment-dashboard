import assert from "node:assert/strict";
import test from "node:test";
import { withResilience, ProviderHttpError, CircuitOpenError, parseRetryAfter } from "./resilient-fetch.ts";

function fastRetryEnv() {
  process.env.RETRY_BASE_MS = "1";
  process.env.RETRY_CEILING_MS = "200";
  process.env.RETRY_MAX_ATTEMPTS = "5";
  process.env.CIRCUIT_FAILURE_THRESHOLD = "5";
  process.env.CIRCUIT_COOLDOWN_MS = "50";
}

test("parseRetryAfter reads delay-seconds", () => {
  assert.equal(parseRetryAfter("2"), 2000);
});

test("parseRetryAfter returns undefined for a missing header", () => {
  assert.equal(parseRetryAfter(null), undefined);
});

test("retries a 429 and succeeds once the transient failure clears", async () => {
  fastRetryEnv();
  let calls = 0;
  const result = await withResilience(`retry-succeeds-${Math.random()}`, async () => {
    calls += 1;
    if (calls < 3) throw new ProviderHttpError(429, "too many requests");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 3, "should have retried twice before succeeding on the third attempt");
});

test("does not retry a non-429/5xx HTTP error", async () => {
  fastRetryEnv();
  let calls = 0;
  await assert.rejects(
    withResilience(`no-retry-4xx-${Math.random()}`, async () => {
      calls += 1;
      throw new ProviderHttpError(404, "not found");
    }),
  );
  assert.equal(calls, 1, "a plain 404 should fail fast, not retry");
});

test("retries a 5xx and gives up after RETRY_MAX_ATTEMPTS", async () => {
  fastRetryEnv();
  let calls = 0;
  await assert.rejects(
    withResilience(`exhausts-retries-${Math.random()}`, async () => {
      calls += 1;
      throw new ProviderHttpError(503, "server error");
    }),
  );
  assert.equal(calls, 5, "should attempt exactly RETRY_MAX_ATTEMPTS times");
});

test("circuit opens after CIRCUIT_FAILURE_THRESHOLD consecutive exhausted requests, then short-circuits", async () => {
  fastRetryEnv();
  process.env.RETRY_MAX_ATTEMPTS = "1"; // isolate: one failure per withResilience call, not one per internal retry
  const provider = `circuit-opens-${Math.random()}`;
  let realCalls = 0;

  for (let i = 0; i < 5; i++) {
    await assert.rejects(withResilience(provider, async () => {
      realCalls += 1;
      throw new ProviderHttpError(503, "down");
    }));
  }
  assert.equal(realCalls, 5, "5 consecutive failed requests should have actually called fn 5 times");

  await assert.rejects(
    withResilience(provider, async () => {
      realCalls += 1;
      return "should not run";
    }),
    (error: unknown) => error instanceof CircuitOpenError,
  );
  assert.equal(realCalls, 5, "once open, the circuit must short-circuit without calling fn again");
});

test("circuit half-opens after the cooldown and closes again on a successful probe", async () => {
  fastRetryEnv();
  process.env.RETRY_MAX_ATTEMPTS = "1";
  process.env.CIRCUIT_COOLDOWN_MS = "30";
  const provider = `circuit-half-opens-${Math.random()}`;

  for (let i = 0; i < 5; i++) {
    await assert.rejects(withResilience(provider, async () => {
      throw new ProviderHttpError(503, "down");
    }));
  }
  await assert.rejects(withResilience(provider, async () => "unreachable"), (e: unknown) => e instanceof CircuitOpenError);

  await new Promise((resolve) => setTimeout(resolve, 40)); // past the 30ms cooldown

  const result = await withResilience(provider, async () => "recovered");
  assert.equal(result, "recovered", "the half-open probe should be allowed through and can succeed");

  // A closed circuit should allow normal calls again, not stay half-open forever.
  const again = await withResilience(provider, async () => "still fine");
  assert.equal(again, "still fine");
});

test("a non-status error (network/timeout) is treated as transient and retried", async () => {
  fastRetryEnv();
  let calls = 0;
  const result = await withResilience(`network-error-retries-${Math.random()}`, async () => {
    calls += 1;
    if (calls < 2) throw new Error("socket hang up");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});
