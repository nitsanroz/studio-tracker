import { describe, expect, it } from "vitest";
import { canSetOwnerPosition, deriveFinanceAccess } from "./finance-access";

describe("canSetOwnerPosition", () => {
  it("is the owner's alone: admin + position owner + full finance", () => {
    expect(canSetOwnerPosition({ role: "admin", position: "owner", finance_full_access: true })).toBe(true);
  });

  it("refuses a full-finance admin who isn't the owner", () => {
    expect(canSetOwnerPosition({ role: "admin", position: "project_manager", finance_full_access: true })).toBe(false);
    expect(canSetOwnerPosition({ role: "admin", position: null, finance_full_access: true })).toBe(false);
  });

  it("refuses an owner position without admin or full finance", () => {
    expect(canSetOwnerPosition({ role: "admin", position: "owner", finance_full_access: false })).toBe(false);
    expect(canSetOwnerPosition({ role: "member", position: "owner", finance_full_access: true })).toBe(false);
  });

  it("refuses an unknown viewer (still loading)", () => {
    expect(canSetOwnerPosition(null)).toBe(false);
  });
});

describe("deriveFinanceAccess", () => {
  it("full finance needs both admin and the flag; admin alone is expenses-only", () => {
    expect(deriveFinanceAccess({ role: "admin", finance_full_access: true })).toEqual({ isAdmin: true, expensesOnly: false });
    expect(deriveFinanceAccess({ role: "admin", finance_full_access: false })).toEqual({ isAdmin: false, expensesOnly: true });
    expect(deriveFinanceAccess({ role: "member", finance_full_access: true })).toEqual({ isAdmin: false, expensesOnly: false });
    expect(deriveFinanceAccess(null)).toEqual({ isAdmin: false, expensesOnly: false });
  });
});
