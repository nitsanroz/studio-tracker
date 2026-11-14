import { describe, expect, it } from "vitest";
import { receivables } from "./receivables";
import type { ClientMonthly } from "./finance";

const cm = (over: Partial<ClientMonthly>): ClientMonthly => ({
  year: 2026,
  month: 9,
  clientId: null,
  clientCanon: "Lumen",
  discipline: null,
  subAccount: "",
  hours: 10,
  rate: 300,
  revenueGross: 3000,
  state: "final",
  comment: "",
  paidAt: null,
  invoicedAt: null,
  ...over,
});

describe("receivables", () => {
  it("lists final unpaid client months with VAT, due 14 days after the month ends", () => {
    const [r, ...rest] = receivables([cm({})], [], "2026-10-31");
    expect(rest).toEqual([]);
    expect(r).toMatchObject({ kind: "hours", name: "Lumen", month: 9, amount: 3000, withVat: 3540, step: "final", due: "2026-10-15", daysLate: 16 });
  });

  it("an invoiced month is due from its invoice date", () => {
    const [r] = receivables([cm({ invoicedAt: "2026-10-20T09:00:00Z" })], [], "2026-10-31");
    expect(r).toMatchObject({ step: "invoiced", due: "2026-11-03", daysLate: -3 });
  });

  it("counts from the invoice's day in Tel Aviv, not its UTC date", () => {
    // 22:30 UTC on 19 Oct is 01:30 on the 20th in Tel Aviv
    const [r] = receivables([cm({ invoicedAt: "2026-10-19T22:30:00Z" })], [], "2026-10-31");
    expect(r).toMatchObject({ step: "invoiced", due: "2026-11-03" });
  });

  it("leaves out paid, not-final, ₪0 and Studio rows", () => {
    const rows = [
      cm({ paidAt: "2026-10-10T00:00:00Z" }),
      cm({ clientCanon: "Orbit", state: "actual" }),
      cm({ clientCanon: "Nova", revenueGross: 0 }),
      cm({ clientCanon: "Studio" }),
    ];
    expect(receivables(rows, [], "2026-10-31")).toEqual([]);
  });

  it("sums a month's sub-accounts into one line, open only while every part is", () => {
    const parts = [cm({ subAccount: "Corporate", revenueGross: 1000 }), cm({ subAccount: "HR", revenueGross: 500 })];
    expect(receivables(parts, [], "2026-10-31")[0].amount).toBe(1500);
    expect(receivables([parts[0], { ...parts[1], paidAt: "2026-10-10T00:00:00Z" }], [], "2026-10-31")).toEqual([]);
  });

  it("adds project income by name and month, most overdue first", () => {
    const income = [
      { date: "2026-08-10", description: "Brand book", amount: 2000, state: "final" as const },
      { date: "2026-08-20", description: "Brand book", amount: "1000", state: "final" as const },
    ];
    const list = receivables([cm({})], income, "2026-10-31");
    expect(list.map((r) => [r.name, r.amount])).toEqual([
      ["Brand book", 3000],
      ["Lumen", 3000],
    ]);
  });

  it("counts each client's own terms, by id or by the Plan's name", () => {
    const net30 = { days: 30, net: true, invoiceDay: 20 };
    // invoiced 20 Oct on net+30 → paid in the run by 5 Dec
    const byId = receivables([cm({ clientId: "c1", invoicedAt: "2026-10-20T09:00:00Z" })], [], "2026-10-31", new Map([["c1", net30]]));
    expect(byId[0]).toMatchObject({ due: "2026-12-05", termsLabel: "Net+30" });
    // not invoiced yet: counted from the invoice day in the month after (20 Oct) → 5 Dec
    const byName = receivables([cm({ clientId: null })], [], "2026-10-31", new Map([["Lumen", net30]]));
    expect(byName[0]).toMatchObject({ due: "2026-12-05", termsLabel: "Net+30" });
    // NoTraffic-style: invoice day 15, 14 days → September due 29 Oct
    const nt = receivables([cm({})], [], "2026-10-31", new Map([["Lumen", { days: 14, net: false, invoiceDay: 15 }]]));
    expect(nt[0]).toMatchObject({ due: "2026-10-29", termsLabel: "14-day", daysLate: 2 });
    // a client the map doesn't know keeps the usual 14 from the 1st
    expect(receivables([cm({})], [], "2026-10-31", new Map())[0]).toMatchObject({ due: "2026-10-15", termsLabel: "14-day" });
  });
});
