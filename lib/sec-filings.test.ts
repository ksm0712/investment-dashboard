import assert from "node:assert/strict";
import test from "node:test";
import { fetchLatestSecFiling, filingHtmlToText, SecFilingError } from "./sec-filings.ts";

test("filingHtmlToText removes executable markup and decodes entities", () => {
  const result = filingHtmlToText("<html><style>.x{}</style><script>alert(1)</script><p>Revenue &amp; demand&nbsp;grew.</p></html>");
  assert.equal(result, "Revenue & demand grew.");
});

test("fetchLatestSecFiling resolves ticker, submission, and primary document", async () => {
  const calls: string[] = [];
  const report = `<html><body><h1>Risk factors</h1><p>${"Enterprise demand increased while customer concentration remained a material risk. ".repeat(8)}</p></body></html>`;
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("company_tickers.json")) {
      return Response.json({ 0: { cik_str: 1234, ticker: "TEST", title: "Test Systems" } });
    }
    if (url.includes("submissions")) {
      return Response.json({
        name: "Test Systems, Inc.",
        filings: { recent: {
          accessionNumber: ["0000001234-26-000001"],
          filingDate: ["2026-08-01"],
          form: ["10-Q"],
          primaryDocument: ["test-20260801.htm"],
        } },
      });
    }
    return new Response(report, { status: 200, headers: { "content-type": "text/html" } });
  };
  const document = await fetchLatestSecFiling("test", fetchImpl);
  assert.equal(document.title, "Test Systems, Inc. 10-Q filed 2026-08-01");
  assert.match(document.text, /customer concentration/);
  assert.equal(calls.length, 3);
  assert.match(document.url || "", /Archives\/edgar\/data\/1234\/000000123426000001\/test-20260801.htm$/);
});

test("fetchLatestSecFiling returns an explicit unsupported error", async () => {
  const fetchImpl = async () => Response.json({ 0: { cik_str: 1234, ticker: "OTHER", title: "Other" } });
  await assert.rejects(() => fetchLatestSecFiling("TEST", fetchImpl), (error: unknown) => {
    assert.ok(error instanceof SecFilingError);
    assert.equal(error.code, "unsupported");
    return true;
  });
});
