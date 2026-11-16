import { describe, expect, it } from "vitest";
import { financeHostTarget } from "./finance-host";

describe("the old finance address", () => {
  it("sends each finance page to the same page under /finance", () => {
    expect(financeHostTarget("finance.nmore.co", "/", "")).toBe("https://tracker.studionmore.com/finance");
    expect(financeHostTarget("finance.nmore.co", "/plan", "?year=2026")).toBe("https://tracker.studionmore.com/finance/plan?year=2026");
    expect(financeHostTarget("Finance.nmore.co:443", "/expenses", "")).toBe("https://tracker.studionmore.com/finance/expenses");
  });
  it("keeps sign-in where it is", () => {
    expect(financeHostTarget("finance.nmore.co", "/login", "")).toBe("https://tracker.studionmore.com/login");
  });
  it("sends the tracker.nmore.co alias to the same page on the main address", () => {
    expect(financeHostTarget("tracker.nmore.co", "/plan", "?week=2")).toBe("https://tracker.studionmore.com/plan?week=2");
    expect(financeHostTarget("tracker.nmore.co", "/", "")).toBe("https://tracker.studionmore.com/");
  });
  it("leaves every other host alone", () => {
    expect(financeHostTarget("tracker.studionmore.com", "/plan", "")).toBeNull();
    expect(financeHostTarget("localhost:3000", "/", "")).toBeNull();
    expect(financeHostTarget(null, "/", "")).toBeNull();
  });
});
