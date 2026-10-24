import { describe, expect, it } from "vitest";
import { pageContext, splitByPage } from "./context";

const items = [
  { id: 1, signal: "report-due", clientId: "a" },
  { id: 2, signal: "unpaid", clientId: "b" },
  { id: 3, signal: "billable", clientId: null },
  { id: 4, signal: "idea", clientId: null },
];
const ids = (s: { here: { id: number }[]; elsewhere: { id: number }[] }) => [s.here.map((i) => i.id), s.elsewhere.map((i) => i.id)];

describe("pageContext + splitByPage", () => {
  it("Home owns everything", () => {
    expect(ids(splitByPage(items, pageContext("/", "")))).toEqual([[1, 2, 3, 4], []]);
  });

  it("a client's page and its Client Reports tab show that client first", () => {
    expect(ids(splitByPage(items, pageContext("/clients/b", "")))).toEqual([[2], [1, 3, 4]]);
    expect(ids(splitByPage(items, pageContext("/client-reports", "?client=a")))).toEqual([[1], [2, 3, 4]]);
  });

  it("Client Reports with no tab picked shows the client-money items", () => {
    expect(ids(splitByPage(items, pageContext("/client-reports", "")))).toEqual([[1, 2], [3, 4]]);
  });

  it("Reports shows the studio figures", () => {
    expect(ids(splitByPage(items, pageContext("/reports", "")))).toEqual([[3], [1, 2, 4]]);
  });

  it("other pages take their own signals; Settings has none", () => {
    const more = [...items, { id: 5, signal: "plan-gaps", clientId: null }, { id: 6, signal: "overdue", clientId: null }];
    expect(ids(splitByPage(more, pageContext("/plan", "")))).toEqual([[5], [1, 2, 3, 4, 6]]);
    expect(pageContext("/plan", "").label).toBe("Weekly Plan");
    expect(ids(splitByPage(more, pageContext("/clients", "")))[0]).toEqual([6]);
    expect(ids(splitByPage(more, pageContext("/settings", "")))[0]).toEqual([]);
  });
});
