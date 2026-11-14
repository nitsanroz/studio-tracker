import { describe, expect, it } from "vitest";
import { atLeast, canOpenFinance, financeTierFor, tierOf } from "./access";

describe("tierOf", () => {
  it("reads the four tiers", () => {
    expect(tierOf({ role: "admin", position: "owner", finance_full_access: true })).toBe("owner");
    expect(tierOf({ role: "admin", position: "manager", finance_full_access: true })).toBe("finance");
    expect(tierOf({ role: "admin", position: "manager", finance_full_access: false })).toBe("admin");
    expect(tierOf({ role: "designer", position: null, finance_full_access: false })).toBe("member");
  });

  it("gives nothing to a missing profile", () => {
    expect(tierOf(null)).toBe("member");
    expect(tierOf(undefined)).toBe("member");
    expect(tierOf({})).toBe("member");
  });

  it("never lets the flag or the position stand in for role admin", () => {
    expect(tierOf({ role: "designer", finance_full_access: true })).toBe("member");
    expect(tierOf({ role: "designer", position: "owner", finance_full_access: true })).toBe("member");
  });

  it("keeps an owner without the finance flag at admin", () => {
    // The database's is_finance_owner() asks for all three; so does this.
    expect(tierOf({ role: "admin", position: "owner", finance_full_access: false })).toBe("admin");
    expect(tierOf({ role: "admin", position: "owner", finance_full_access: null })).toBe("admin");
  });
});

describe("atLeast", () => {
  it("orders member < admin < finance < owner", () => {
    expect(atLeast("owner", "finance")).toBe(true);
    expect(atLeast("finance", "owner")).toBe(false);
    expect(atLeast("admin", "admin")).toBe(true);
    expect(atLeast("member", "admin")).toBe(false);
  });
});

describe("finance paths", () => {
  it("is silent about paths outside finance", () => {
    expect(financeTierFor("/my-tasks")).toBeNull();
    expect(financeTierFor("/financex")).toBeNull();
    expect(canOpenFinance("member", "/my-tasks")).toBe(true);
  });

  it("opens only Expenses to an admin without full finance", () => {
    expect(canOpenFinance("admin", "/finance/expenses")).toBe(true);
    expect(canOpenFinance("admin", "/api/finance/mail/receipts")).toBe(true);
    expect(canOpenFinance("admin", "/api/finance/mail/receipts/abc")).toBe(true);
    for (const p of ["/finance", "/finance/plan", "/finance/salaries", "/finance/people/1", "/finance/rates"]) {
      expect(canOpenFinance("admin", p), p).toBe(false);
    }
  });

  it("keeps the owner's pages from everyone else", () => {
    for (const p of ["/finance/scenarios", "/api/finance/scenarios/advise", "/api/finance/mail", "/api/finance/mail/scan"]) {
      expect(canOpenFinance("finance", p), p).toBe(false);
      expect(canOpenFinance("admin", p), p).toBe(false);
      expect(canOpenFinance("owner", p), p).toBe(true);
    }
  });

  it("gives a member no finance path at all", () => {
    for (const p of ["/finance", "/finance/expenses", "/finance/scenarios", "/api/finance/mail/receipts"]) {
      expect(canOpenFinance("member", p), p).toBe(false);
    }
  });

  it("gives full finance everything but the owner's pages", () => {
    for (const p of ["/finance", "/finance/plan", "/finance/expenses", "/finance/people/1"]) {
      expect(canOpenFinance("finance", p), p).toBe(true);
    }
  });
});
