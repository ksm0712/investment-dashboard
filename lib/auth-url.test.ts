import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppUrl } from "./auth-url.ts";

test("uses the stable branch URL for preview OAuth callbacks", () => {
  assert.equal(resolveAppUrl({
    APP_URL: "https://investment-dashboard-ox99.vercel.app",
    VERCEL_ENV: "preview",
    VERCEL_BRANCH_URL: "investment-dashboard-git-feature.example.vercel.app",
  }), "https://investment-dashboard-git-feature.example.vercel.app");
});

test("keeps the configured live URL in production", () => {
  assert.equal(resolveAppUrl({
    APP_URL: "https://investments.example.com/",
    VERCEL_ENV: "production",
    VERCEL_URL: "generated-deployment.vercel.app",
  }), "https://investments.example.com");
});

test("defaults to localhost outside Vercel", () => {
  assert.equal(resolveAppUrl({}), "http://localhost:3000");
});
