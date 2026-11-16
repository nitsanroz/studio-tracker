import { describe, expect, it } from "vitest";
import { pageContext, splitByPage, tilesFor } from "./context";

const items = [
  { id: 1, signal: "report-due", clientId: "a" },
  { id: 2, signal: "unpaid", clientId: "b" },
  { id: 3, signal: "pace", clientId: null },
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
    expect(ids(splitByPage(more, pageContext("/plan", "")))).toEqual([[3, 5], [1, 2, 4, 6]]); // the pace says where the plan can win hours back
    expect(pageContext("/plan", "").label).toBe("Weekly Plan");
    expect(ids(splitByPage(more, pageContext("/clients", "")))[0]).toEqual([6]);
    expect(ids(splitByPage(more, pageContext("/settings", "")))[0]).toEqual([]);
  });
});

describe("tilesFor", () => {
  const tiles = [
    { id: "income", scope: "money", clientId: null },
    { id: "plan", scope: "plan", clientId: null },
    { id: "a-hours", scope: "client", clientId: "a" },
  ];
  const of = (path: string, search = "") => tilesFor(tiles, pageContext(path, search)).map((t) => t.id);

  it("each page gets its own figures, and Home never the plan's or a client's", () => {
    expect(of("/")).toEqual(["income"]);
    expect(of("/plan")).toEqual(["plan"]);
    expect(of("/clients/a")).toEqual(["a-hours"]);
    expect(of("/client-reports", "?client=a")).toEqual(["a-hours"]);
    expect(of("/my-tasks")).toEqual([]);
  });
});

describe("finance's pages (one pane since the finance merge)", () => {
  const money = [
    { id: 1, signal: "pace", clientId: null },
    { id: 2, signal: "unfiled", clientId: null },
    { id: 3, signal: "no-rate", clientId: "a" },
    { id: 4, signal: "plan-gaps", clientId: null },
    { id: 5, signal: "idea", clientId: null },
  ];

  it("the Overview takes everything about money and folds the studio's own", () => {
    expect(ids(splitByPage(money, pageContext("/finance", "")))).toEqual([[1, 2, 3, 5], [4]]);
  });

  it("a finance page puts its own signals first", () => {
    expect(ids(splitByPage(money, pageContext("/finance/expenses", "")))).toEqual([[2], [1, 3, 4, 5]]);
    expect(pageContext("/finance/plan", "").label).toBe("Plan");
    expect(pageContext("/plan", "").label).toBe("Weekly Plan");
  });

  it("has nothing on finance's Settings, and a person's page is People", () => {
    expect(splitByPage(money, pageContext("/finance/settings", "")).here).toEqual([]);
    expect(pageContext("/finance/people/abc", "").label).toBe("People");
  });

  it("shows the money side's figures only on finance's pages", () => {
    const tiles = [
      { scope: "money", clientId: null },
      { scope: "fin:money", clientId: null },
      { scope: "fin:filing", clientId: null },
    ];
    expect(tilesFor(tiles, pageContext("/", "")).map((t) => t.scope)).toEqual(["money"]);
    expect(tilesFor(tiles, pageContext("/finance", "")).map((t) => t.scope)).toEqual(["fin:money"]);
    expect(tilesFor(tiles, pageContext("/finance/expenses", "")).map((t) => t.scope)).toEqual(["fin:filing"]);
  });

  it("the rules that read both sides have a home on each side", () => {
    expect(pageContext("/clients", "").signals?.has("scope")).toBe(true);
    expect(pageContext("/freelancers", "").signals?.has("freelancer-margin")).toBe(true);
    expect(pageContext("/finance/freelance", "").signals?.has("freelancer-margin")).toBe(true);
    expect(pageContext("/client-reports", "").signals?.has("debt")).toBe(true);
  });
});

describe("the Scenarios tab of /advice (2026-11-16)", () => {
  it("keeps Scenarios' own context", () => {
    expect(pageContext("/advice", "?tab=scenarios").label).toBe("Scenarios");
    expect(pageContext("/advice", "").label).not.toBe("Scenarios");
  });
});
