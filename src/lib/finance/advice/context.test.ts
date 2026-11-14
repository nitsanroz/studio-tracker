import { describe, expect, it } from "vitest";
import { pageContext, splitByPage } from "./context";
import { SIGNALS } from "./signals";

const items = [
  { signal: "pace", id: 1 },
  { signal: "unfiled", id: 2 },
  { signal: "no-rate", id: 3 },
];

describe("pageContext", () => {
  it("gives the Overview everything", () => {
    expect(splitByPage(items, pageContext("/finance"))).toEqual({ here: items, elsewhere: [] });
  });

  it("puts a page's own signals first and folds the rest", () => {
    const { here, elsewhere } = splitByPage(items, pageContext("/finance/expenses"));
    expect(here.map((i) => i.id)).toEqual([2]);
    expect(elsewhere.map((i) => i.id)).toEqual([1, 3]);
  });

  it("has nothing on Settings, and a person's page is People", () => {
    expect(splitByPage(items, pageContext("/finance/settings")).here).toEqual([]);
    expect(pageContext("/finance/people/abc").label).toBe("People");
  });

  it("lists only signals that exist", () => {
    // The signal names a check writes are the function's `signal` field; a typo
    // here would leave an item homeless on its page. Every listed one is real.
    const real = new Set(["pace", "loss", "year", "unpaid", "no-rate", "concentration", "client-quiet", "salaries", "freelance", "expense", "unfiled", "close", "paid", "payslips", "fx", "renewal", "overlap", "price-up", "fx-fee", "mail", "tax-reserve", "dividend-window", "books-gap"]);
    // "tools" is the tools review's (review.ts), written by Claude's run, not a rule.
    const fromClaude = new Set(["tools"]);
    // monthUnpaid and olderUnpaid both write "paid", mailNotice, receiptsWaiting and receiptMismatch "mail": one name, several checks.
    expect(SIGNALS).toHaveLength(real.size + 3);
    for (const path of ["/finance/plan", "/finance/salaries", "/finance/freelance", "/finance/people", "/finance/expenses", "/finance/rates"])
      for (const s of pageContext(path).signals) expect(real.has(s) || fromClaude.has(s)).toBe(true);
  });
});
