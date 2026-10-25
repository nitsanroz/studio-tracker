import { describe, expect, it } from "vitest";
import { studioDate } from "../format";
import {
  capFilling,
  clientQuiet,
  concentration,
  dueUnassigned,
  estimateBudget,
  incomeVsCosts,
  outOfScope,
  paceBehind,
  periodUnpaid,
  pulse,
  reportDue,
  words,
  workdayCount,
  type AdviceData,
  candidatesQuiet,
  freelancerLogs,
  intakePending,
  leadsWaiting,
  missingHours,
  myOverdue,
  overdueTasks,
  planGaps,
  vacationPending,
} from "./signals";

// Thursday 22 October 2026 is "today" throughout.
const base = (over: Partial<AdviceData> = {}): AdviceData => ({
  today: "2026-10-22",
  clients: [
    { id: "lumen", name: "Lumen Health", billable: true, archived: false, hourCap: 100, keysTaskId: "lumen-keys" },
    { id: "studio", name: "Studio", billable: false, archived: false, hourCap: null, keysTaskId: null },
  ],
  tasks: [
    { id: "t1", clientId: "lumen", sectionId: "s1", groupId: null, title: "Homepage", billable: true },
    { id: "t2", clientId: "lumen", sectionId: "s1", groupId: null, title: "Investor deck", billable: true },
    { id: "lumen-keys", clientId: "lumen", sectionId: null, groupId: null, title: "Lumen Keys", billable: false },
    { id: "st", clientId: "studio", sectionId: null, groupId: null, title: "Website", billable: true },
  ],
  sections: [{ id: "s1", name: "Website" }],
  groups: [],
  entries: [],
  periods: [],
  reportLinks: [],
  estimates: [],
  pnl: [],
  pace: null,
  ...over,
});
const e = (taskId: string, date: string, hours: number) => ({ taskId, date, minutes: hours * 60 });

describe("studioDate", () => {
  it("turns a timestamp into its Israel date and leaves a plain date alone", () => {
    expect(studioDate("2026-10-14T22:30:00Z")).toBe("2026-10-15");
    expect(studioDate("2026-10-14")).toBe("2026-10-14");
  });
});

describe("workdayCount", () => {
  it("counts Sun–Thu only", () => {
    expect(workdayCount("2026-10-18", "2026-10-24")).toBe(5); // Sun 18 → Sat 24
  });
});

describe("reportDue", () => {
  // Thursday 22 Oct: the report day is Sunday 18 Oct, for the week 11–17 Oct.
  const link = (publishedAt: string | null) => [{ clientId: "lumen", publishedAt, throughDate: null }];

  it("is due when last week had hours and nothing was published since 3 days before Sunday", () => {
    const f = reportDue(base({ reportLinks: link("2026-10-11T09:00:00Z"), entries: [e("t1", "2026-10-13", 3), e("t1", "2026-10-20", 5)] }));
    expect(f).toHaveLength(1);
    expect(f[0].facts).toMatchObject({ weekStart: "2026-10-11", weekEnd: "2026-10-17", hours: 3, daysSince: 11 });
    expect(f[0].key).toBe("report-due:lumen:2026-10-18");
    expect(f[0].severity).toBe(2); // Thursday: four days late
  });

  it("is not due for a week with no hours", () => {
    expect(reportDue(base({ reportLinks: link("2026-10-04"), entries: [e("t1", "2026-10-20", 5)] }))).toEqual([]);
  });

  it("counts a publish from Thursday before the Sunday on as sent", () => {
    expect(reportDue(base({ reportLinks: link("2026-10-15T16:00:00Z"), entries: [e("t1", "2026-10-13", 3)] }))).toEqual([]);
    expect(reportDue(base({ reportLinks: link("2026-10-14T16:00:00Z"), entries: [e("t1", "2026-10-13", 3)] }))).toHaveLength(1);
  });

  it("is not due when a billing period ended near that Sunday (the monthly report went instead)", () => {
    const periods = [{ clientId: "lumen", label: "20 Sep – 19 Oct", dateFrom: "2026-09-20", dateTo: "2026-10-19", hourCap: null, paid: false }];
    expect(reportDue(base({ reportLinks: link("2026-10-04"), periods, entries: [e("t1", "2026-10-13", 3)] }))).toEqual([]);
  });

  it("reads the publish time in Israel: 01:30 Thursday is Thursday, not Wednesday UTC", () => {
    // 2026-10-15 01:30 Israel (UTC+3) = 2026-10-14T22:30Z
    expect(reportDue(base({ reportLinks: link("2026-10-14T22:30:00Z"), entries: [e("t1", "2026-10-13", 3)] }))).toEqual([]);
  });

  it("needs a report link at all", () => {
    expect(reportDue(base({ entries: [e("t1", "2026-10-13", 3)] }))).toEqual([]);
  });
});

describe("capFilling", () => {
  const period = { clientId: "lumen", label: "October 2026", dateFrom: "2026-10-01", dateTo: "2026-10-31", hourCap: null, paid: false };

  it("reads used % from billable hours, keys task excluded", () => {
    const f = capFilling(base({ periods: [period], entries: [e("t1", "2026-10-05", 85), e("lumen-keys", "2026-10-06", 30)] }));
    expect(f[0].facts.usedPct).toBe(85);
  });

  it("escalates with the share used", () => {
    const sev = (h: number) => capFilling(base({ periods: [period], entries: [e("t1", "2026-10-05", h)] }))[0]?.severity ?? 0;
    expect(sev(50)).toBe(0); // 50% by day 16 of 22 → closes at ~69%
    expect(sev(82)).toBe(2); // projected past 100%
    expect(sev(105)).toBe(3);
    expect(sev(125)).toBe(4);
  });

  it("uses the period's own cap when the client has none", () => {
    const f = capFilling(
      base({
        clients: [{ id: "lumen", name: "Lumen Health", billable: true, archived: false, hourCap: null, keysTaskId: null }],
        periods: [{ ...period, hourCap: 10 }],
        entries: [e("t1", "2026-10-05", 9)],
      }),
    );
    expect(f[0].facts.usedPct).toBe(90);
  });
});

describe("periodUnpaid", () => {
  const p = (label: string, dateFrom: string, dateTo: string, paid = false) => ({ clientId: "lumen", label, dateFrom, dateTo, hourCap: null, paid });

  it("flags only the client's last ended period, unpaid, with hours", () => {
    const f = periodUnpaid(
      base({
        periods: [p("August 2026", "2026-08-01", "2026-08-31"), p("September 2026", "2026-09-01", "2026-09-30"), p("October 2026", "2026-10-01", "2026-10-31")],
        entries: [e("t1", "2026-08-10", 4), e("t1", "2026-09-10", 4)],
      }),
    );
    expect(f.map((x) => x.facts.period)).toEqual(["September 2026"]);
    expect(f[0].facts).toMatchObject({ dueDate: "2026-10-14", daysLate: 8 });
    expect(f[0].severity).toBe(2); // 8 days past its payment date
  });

  it("counts the report's hours: billable tasks only, so a keys write-down isn't billed twice", () => {
    const f = periodUnpaid(
      base({ periods: [p("September 2026", "2026-09-01", "2026-09-30")], entries: [e("t1", "2026-09-10", 81), e("lumen-keys", "2026-09-11", 17.5)] }),
    );
    expect(f[0].facts.hours).toBe(81);
  });

  it("is quiet when the last one is paid, inside the 14-day terms, or 60+ days after it ended", () => {
    const run = (periods: ReturnType<typeof p>[]) => periodUnpaid(base({ periods, entries: [e("t1", "2026-07-10", 4), e("t1", "2026-10-10", 4), e("t1", "2026-09-10", 4)] }));
    expect(run([p("August", "2026-08-01", "2026-08-31"), p("September", "2026-09-01", "2026-09-30", true)])).toEqual([]);
    expect(run([p("To 12 Oct", "2026-09-13", "2026-10-12")])).toEqual([]); // 10 days: not due yet
    expect(run([p("To 8 Oct", "2026-09-09", "2026-10-08")])).toEqual([]); // due today: still on time
    expect(run([p("To 7 Oct", "2026-09-08", "2026-10-07")])).toHaveLength(1); // a day late
    expect(run([p("July", "2026-07-01", "2026-07-31")])).toEqual([]); // 83 days
  });

  it("says how much has been logged since — work on credit makes it worse", () => {
    const periods = [p("September 2026", "2026-09-01", "2026-09-30")];
    const plain = periodUnpaid(base({ periods, entries: [e("t1", "2026-09-10", 10)] }))[0];
    const credit = periodUnpaid(base({ periods, entries: [e("t1", "2026-09-10", 10), e("t1", "2026-10-12", 12)] }))[0];
    expect(credit.severity).toBe(plain.severity + 1);
    expect(credit.body).toMatch(/logged 12h for them since/);
  });
});

describe("estimateBudget", () => {
  it("measures billable hours since publishing against the top of the estimate's range", () => {
    const f = estimateBudget(
      base({
        estimates: [{ clientId: "lumen", publishedAt: "2026-09-01", names: [], taskIds: [], hours: { min: 40, max: 50 } }],
        entries: [e("t1", "2026-08-20", 30), e("t1", "2026-09-10", 46), e("lumen-keys", "2026-09-11", 10)],
      }),
    );
    expect(f[0].facts).toMatchObject({ usedPct: 92, estimated: "40–50h" });
    expect(f[0].severity).toBe(2);
  });

  it("is quiet under 80%", () => {
    expect(estimateBudget(base({ estimates: [{ clientId: "lumen", publishedAt: "2026-09-01", names: [], taskIds: [], hours: { min: 50, max: 50 } }], entries: [e("t1", "2026-09-10", 30)] }))).toEqual([]);
  });
});

describe("outOfScope", () => {
  it("counts hours on tasks sharing no word with the estimate", () => {
    const f = outOfScope(
      base({
        estimates: [{ clientId: "lumen", publishedAt: "2026-09-01T10:00:00Z", names: ["Website", "Homepage and inner pages"], taskIds: [], hours: { min: 0, max: 0 } }],
        tasks: [
          { id: "t1", clientId: "lumen", sectionId: null, groupId: null, title: "Homepage", billable: true },
          { id: "t2", clientId: "lumen", sectionId: null, groupId: null, title: "Investor deck", billable: true },
        ],
        entries: [e("t1", "2026-09-10", 20), e("t2", "2026-09-12", 8), e("t2", "2026-08-01", 50)],
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0].facts).toMatchObject({ outsidePct: 29, outsideHours: 8 });
    expect(f[0].kind).toBe("now");
  });

  it("counts a task in scope through its section's name", () => {
    const f = outOfScope(
      base({
        estimates: [{ clientId: "lumen", publishedAt: "2026-09-01", names: ["Website"], taskIds: [], hours: { min: 0, max: 0 } }],
        entries: [e("t1", "2026-09-10", 20), e("t2", "2026-09-12", 8)], // both in section "Website"
      }),
    );
    expect(f).toEqual([]);
  });

  it("counts a task made from an estimate line as in scope, whatever its name", () => {
    const f = outOfScope(
      base({
        estimates: [{ clientId: "lumen", publishedAt: "2026-09-01", names: ["Homepage"], taskIds: ["t2"], hours: { min: 0, max: 0 } }],
        tasks: [
          { id: "t1", clientId: "lumen", sectionId: null, groupId: null, title: "Homepage", billable: true },
          { id: "t2", clientId: "lumen", sectionId: null, groupId: null, title: "Investor deck", billable: true },
        ],
        entries: [e("t1", "2026-09-10", 20), e("t2", "2026-09-12", 8)],
      }),
    );
    expect(f).toEqual([]);
  });

  it("skips clients without a published estimate", () => {
    expect(outOfScope(base({ entries: [e("t2", "2026-09-12", 40)] }))).toEqual([]);
  });

  it("splits Hebrew and English names into words", () => {
    expect(words("Logo — לוגו ראשי")).toEqual(["logo", "לוגו", "ראשי"]);
  });
});

describe("paceBehind", () => {
  it("fires under 90% of the expected pace", () => {
    expect(paceBehind(base({ pace: { soFar: 85, expectedByNow: 100 } }))[0].severity).toBe(1);
    expect(paceBehind(base({ pace: { soFar: 95, expectedByNow: 100 } }))).toEqual([]);
  });
});

describe("incomeVsCosts", () => {
  const months = (ratios: number[]) => ratios.map((r, i) => ({ year: 2026, month: 6 + i, revenues: 100 * r, expenses: 100 }));

  it("ignores the current (incomplete) month and says only percentages", () => {
    const f = incomeVsCosts(base({ pnl: [...months([1.2, 1.2, 1.2, 0.95]), { year: 2026, month: 10, revenues: 1, expenses: 100 }] }));
    expect(f[0].facts).toMatchObject({ month: "2026-09", coverPct: 95, averagePct: 120 });
    expect(JSON.stringify(f)).not.toMatch(/₪|\$|revenues|expenses/);
  });

  it("is quiet while income covers costs at the usual level", () => {
    expect(incomeVsCosts(base({ pnl: months([1.2, 1.2, 1.2, 1.18]) }))).toEqual([]);
  });
});

describe("pulse", () => {
  it("drops the over-cap tile when no client is capped", () => {
    expect(pulse(base({ clients: [{ id: "lumen", name: "Lumen", billable: true, archived: false, hourCap: null, keysTaskId: null }] })).map((t) => t.label)).not.toContain("Over cap");
  });

  it("shows the over-cap figure as a count", () => {
    const tiles = pulse(
      base({
        periods: [{ clientId: "lumen", label: "October 2026", dateFrom: "2026-10-01", dateTo: "2026-10-31", hourCap: null, paid: false }],
        entries: [e("t1", "2026-10-05", 110)],
      }),
    );
    expect(tiles.find((t) => t.label === "Over cap")).toMatchObject({ value: 1, unit: "" });
  });
});

/* ── one thing for every page ───────────────────────────────────────────── */

const team = {
  people: [
    { id: "p1", name: "Aki Levi" },
    { id: "p2", name: "Dana Cohen" },
  ],
  planColumns: [
    { id: "c1", profileId: "p1" },
    { id: "c2", profileId: "p2" },
  ],
};

describe("planGaps", () => {
  // Thursday 22: the next two workdays are Sun 25 and Mon 26 — the studio plans a day or two ahead.
  it("looks only at the next two workdays", () => {
    const planEntries = ["2026-10-25", "2026-10-26"].map((date) => ({ date, columnId: "c1" }));
    const f = planGaps(base({ ...team, planEntries: [...planEntries, { date: "2026-10-25", columnId: "c2" }] }));
    expect(f[0].title).toBe("Nothing planned Mon for Dana");
    expect(f[0].kind).toBe("heads");
    expect(planGaps(base({ ...team, planEntries: [...planEntries, ...planEntries.map((x) => ({ ...x, columnId: "c2" }))] }))).toEqual([]);
  });

  it("the next workday open is a do-now, with the person's due tasks", () => {
    const tasks = [{ id: "d", clientId: "lumen", sectionId: null, groupId: null, title: "Deck", billable: true, assigneeId: "p2", dueDate: "2026-10-26", status: "todo" }];
    const f = planGaps(base({ ...team, tasks, planEntries: ["2026-10-25", "2026-10-26"].map((date) => ({ date, columnId: "c1" })) }));
    expect(f[0]).toMatchObject({ kind: "now", title: "Nothing planned Sun for Dana" });
    expect(f[0].body).toMatch(/^Dana — Sun, Mon \(1 task due this week\)\./);
  });

  it("doesn't count a holiday as open, nor an hourly freelancer", () => {
    expect(planGaps(base({ ...team, planEntries: [], dayStates: [{ dateFrom: "2026-10-25", dateTo: "2026-11-05" }] }))).toEqual([]);
    expect(planGaps(base({ ...team, planEntries: [], hourly: ["p1", "p2"] }))).toEqual([]);
  });
});

describe("missingHours", () => {
  it("counts workdays in the last week with no hours and no planned absence", () => {
    // Thu 22: the days are Thu 15, Sun 18 – Wed 21.
    const entries = ["2026-10-15", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"].map((date) => ({ taskId: "t1", date, minutes: 60, userId: "p1" }));
    const f = missingHours(
      base({ ...team, entries: [...entries, { taskId: "t1", date: "2026-10-15", minutes: 60, userId: "p2" }], absences: [{ date: "2026-10-18", columnId: "c2" }] }),
    );
    expect(f[0].title).toBe("Hours missing: Dana 3 days");
    expect(f[0].body).toMatch(/^Workdays from 15 Oct to 21 Oct with nothing logged and no absence in the plan\./);
  });

  it("skips hourly freelancers, and keys on who — so a dismiss holds for the same people", () => {
    const f = missingHours(base({ ...team, hourly: ["p1"] }));
    expect(f[0].title).toBe("Hours missing: Dana 5 days");
    const both = missingHours(base({ ...team }));
    expect(both[0].key).not.toBe(f[0].key);
  });
});

describe("myOverdue", () => {
  it("counts the owner's open tasks past due", () => {
    const tasks = [
      { id: "a", clientId: "lumen", sectionId: null, groupId: null, title: "Logo", billable: true, assigneeId: "me", dueDate: "2026-10-20", status: "todo" },
      { id: "b", clientId: "lumen", sectionId: null, groupId: null, title: "Deck", billable: true, assigneeId: "me", dueDate: "2026-10-19", status: "done" },
      { id: "c", clientId: "lumen", sectionId: null, groupId: null, title: "Site", billable: true, assigneeId: "other", dueDate: "2026-10-19", status: "todo" },
    ];
    expect(myOverdue(base({ ownerId: "me", tasks }))[0].title).toBe("1 of your tasks is past due");
  });
});

describe("overdueTasks", () => {
  it("counts open tasks due in the last 60 days, by client", () => {
    const t = (id: string, dueDate: string, status = "todo") => ({ id, clientId: "lumen", sectionId: null, groupId: null, title: id, billable: true, dueDate, status });
    const f = overdueTasks(base({ tasks: [t("a", "2026-10-01"), t("b", "2026-10-21"), t("c", "2026-10-10", "done"), t("d", "2026-07-01"), t("e", "2026-10-30")] }));
    expect(f[0].title).toBe("2 tasks are past due across 1 client");
    expect(f[0].body).toMatch(/^Lumen Health 2\./);
    expect(f[0].list?.map((l) => l.taskId)).toEqual(["a", "b"]);
  });

  it("reads a pattern: most of them on one person", () => {
    const t = (id: string, assigneeId: string) => ({ id, clientId: "lumen", sectionId: null, groupId: null, title: id, billable: true, dueDate: "2026-10-10", status: "todo", assigneeId });
    const f = overdueTasks(base({ ...team, tasks: [t("a", "p1"), t("b", "p1"), t("c", "p1"), t("d", "p2")] }));
    expect(f[0].body).toMatch(/3 of them are Aki's/);
  });
});

describe("dueUnassigned", () => {
  it("lists tasks due in the next week with nobody on them", () => {
    const t = (id: string, dueDate: string, assigneeId: string | null = null) => ({ id, clientId: "lumen", sectionId: null, groupId: null, title: id, billable: true, dueDate, status: "todo", assigneeId });
    const f = dueUnassigned(base({ tasks: [t("a", "2026-10-23"), t("b", "2026-10-28"), t("c", "2026-10-24", "p1"), t("d", "2026-11-10")] }));
    expect(f[0]).toMatchObject({ kind: "now", title: "2 tasks due this week have nobody on them" });
    expect(f[0].list?.map((l) => l.taskId)).toEqual(["a", "b"]);
  });
});

describe("insights", () => {
  const clients = [
    { id: "lumen", name: "Lumen Health", billable: true, archived: false, hourCap: null, keysTaskId: null },
    { id: "halo", name: "Halo", billable: true, archived: false, hourCap: null, keysTaskId: null },
    { id: "orb", name: "Orb", billable: true, archived: false, hourCap: null, keysTaskId: null },
  ];
  const tasks = [
    { id: "t1", clientId: "lumen", sectionId: null, groupId: null, title: "Site", billable: true },
    { id: "h1", clientId: "halo", sectionId: null, groupId: null, title: "Deck", billable: true },
    { id: "o1", clientId: "orb", sectionId: null, groupId: null, title: "App", billable: true },
  ];

  it("concentration: one client over 40% of 90 days' billable hours, read with the open leads", () => {
    const f = concentration(base({ clients, tasks, leadsOpen: 2, entries: [e("t1", "2026-09-10", 80), e("h1", "2026-09-11", 40)] }));
    expect(f[0]).toMatchObject({ kind: "idea", clientId: "lumen", title: "Lumen Health is 67% of the studio's billable work" });
    expect(f[0].body).toMatch(/2 leads are open/);
    expect(concentration(base({ clients, tasks, entries: [e("t1", "2026-09-10", 40), e("h1", "2026-09-11", 40), e("o1", "2026-09-12", 40)] }))).toEqual([]);
  });

  it("client-quiet: 15h+ a month before, under 40% of that in the last 30 days", () => {
    const entries = [e("h1", "2026-07-01", 30), e("h1", "2026-08-01", 30), e("h1", "2026-09-01", 30), e("h1", "2026-10-10", 3)];
    const f = clientQuiet(base({ clients, tasks, entries }));
    expect(f.map((x) => x.clientId)).toEqual(["halo"]);
    expect(clientQuiet(base({ clients, tasks, entries: [...entries, e("h1", "2026-10-12", 20)] }))).toEqual([]);
  });
});

describe("waiting lists", () => {
  it("vacation and intake count what waits, by its oldest", () => {
    expect(vacationPending(base({ vacationPending: [{ createdAt: "2026-10-19T08:00:00Z" }] }))[0]).toMatchObject({ kind: "now", body: "The oldest was sent 3 days ago." });
    expect(intakePending(base({ intakePending: [] }))).toEqual([]);
  });

  it("leads: replies owed 2+ days and next steps past due", () => {
    const f = leadsWaiting(
      base({
        leadsWaiting: [
          { company: "Tidewater", replyOwedSince: "2026-10-18T10:00:00Z", stepDue: null },
          { company: "Kinetic", replyOwedSince: "2026-10-22T10:00:00Z", stepDue: "2026-10-20" },
        ],
      }),
    );
    expect(f[0].title).toBe("2 leads wait on you");
    expect(f[0].body).toBe("1 reply owed for 2+ days, 1 next step overdue: Tidewater, Kinetic.");
  });

  it("a new request makes a new key, so ticking the old one done can't hide it", () => {
    const a = vacationPending(base({ vacationPending: [{ createdAt: "2026-10-19T08:00:00Z" }] }))[0].key;
    const b = vacationPending(base({ vacationPending: [{ createdAt: "2026-10-19T08:00:00Z" }, { createdAt: "2026-10-21T09:00:00Z" }] }))[0].key;
    expect(a).not.toBe(b);
  });

  it("candidates: counts only, no names", () => {
    const f = candidatesQuiet(base({ candidates: [{ lastActivityAt: "2026-10-01T00:00:00Z" }, { lastActivityAt: "2026-10-20T00:00:00Z" }] }));
    expect(f[0].title).toBe("1 candidate has gone quiet");
  });

  it("freelancers: hours waiting for review", () => {
    const f = freelancerLogs(base({ freelancerPending: [{ date: "2026-10-12", minutes: 180 }, { date: "2026-10-20", minutes: 90 }] }));
    expect(f[0]).toMatchObject({ kind: "now", title: "2 freelancer logs wait for review" });
    expect(f[0].facts.hours).toBe(4.5);
  });
});
