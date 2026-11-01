"use client";

// The real freelancer page over fixture data. `fetch` is stubbed for this one
// token only, so the component runs unchanged — its loading, month stepping and
// layout are the production code. Writes answer 200 and change nothing.

import { FreelancerLogView } from "@/app/log/[token]/log-view";

const TOKEN = "design-lab-fixture";

const CLIENTS = [
  { id: "c1", name: "NoTraffic", color: "#3b82f6", icon: null, iconUrl: null },
  { id: "c2", name: "Visitt", color: "#1f7a4d", icon: null, iconUrl: null },
];

function month(period: string) {
  const current = period === "2026-11";
  const logs = current
    ? [
        { d: "2026-11-01", c: 0, t: "Sensor 3.0 Video", h: 6.5, x: "Edit v3, sound pass", e: true },
        { d: "2026-10-30", c: 1, t: "Lobby page motion", h: 2, x: "Two loops for the hero", e: false },
      ]
    : [
        { d: `${period}-05`, c: 0, t: "Sensor 3.0 Video", h: 10.5, x: "Edit v2", e: false },
        { d: `${period}-06`, c: 1, t: "Lobby page motion", h: 2.5, x: "Revisions after review", e: false },
        { d: `${period}-12`, c: 0, t: "Sensor 3.0 Video", h: 8, x: "Colour and titles", e: false },
      ];
  const hours = logs.reduce((s, l) => s + l.h, 0);
  return {
    name: "Daniel",
    today: "2026-11-01",
    earliest: "2026-11-01",
    period,
    firstPeriod: "2026-08",
    clients: CLIENTS,
    tasks: [
      { id: "t1", title: "Sensor 3.0 Video", clientId: "c1" },
      { id: "t2", title: "Lobby page motion", clientId: "c2" },
    ],
    summary: { hours, rate: 55, hoursBill: hours * 55, extras: current ? 150 : 0, otherExtras: [], total: hours * 55 + (current ? 150 : 0), currency: "EUR" },
    terms: { rateHigh: 55, rateLow: 45, hoursLow: 50, hoursHigh: 150 },
    months: [
      { period: "2026-11", hours: 8.5, rate: 55, total: 617.5, extras: 150, otherExtras: [] },
      { period: "2026-10", hours: 21, rate: 55, total: 1155, extras: 0, otherExtras: [] },
      { period: "2026-09", hours: 155.75, rate: 45, total: 7008.75, extras: 0, otherExtras: [] },
      { period: "2026-08", hours: 7.5, rate: 55, total: 412.5, extras: 0, otherExtras: [] },
    ],
    logs: logs.map((l, i) => ({
      id: `l${i}`,
      date: l.d,
      hours: l.h,
      client: CLIENTS[l.c],
      task: l.t,
      taskHint: null,
      description: l.x,
      editable: l.e,
      clientId: CLIENTS[l.c].id,
      taskId: null,
    })),
    charges: current
      ? [{ id: "ch1", date: "2026-11-01", title: "Sound design — Amir", amount: 150, currency: "EUR", note: "Brought in for the v3 mix", editable: true }]
      : [],
    deliverables: [
      { id: "dl1", title: "Sensor 3.0 — v3 renders", url: "https://example.com/renders", date: "2026-11-01" },
      { id: "dl2", title: "Shared folder", url: "https://example.com/folder", date: "2026-10-12" },
    ],
  };
}

if (typeof window !== "undefined" && !(window as { __logLabStub?: boolean }).__logLabStub) {
  (window as { __logLabStub?: boolean }).__logLabStub = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes(`/api/log/${TOKEN}`)) return real(input, init);
    if (init?.method && init.method !== "GET") return new Response("{}", { status: 200 });
    const m = new URL(url, window.location.origin).searchParams.get("month") ?? "2026-11";
    return new Response(JSON.stringify(month(m)), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

export function LogLab() {
  return <FreelancerLogView token={TOKEN} />;
}
