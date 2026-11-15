"use client";

// Scenarios (v1.29.0) — the owner's what-if page (Nitsan, 2026-11-11): stack
// decisions (big, small, personal) with the month each lands, run them against
// three demand futures, see profit AND cash for 12 months, save and compare,
// and ask the advisor. Owner only (scenarios/layout.tsx, reference/0023).
//
// ⚠️ It writes NO finance table — only its own (finance_scenarios,
// finance_scenario_settings, finance_scenario_advice). A saved scenario is
// decisions + a name; it always re-runs on today's live data.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Columns3, Copy, Plus, Save, Trash2 } from "lucide-react";
import { ConfirmDialog, ErrorState, Loading, PageHeader } from "@/components/finance/ui";
import { ADVICE_VIEWS, PageViews } from "@/components/page-views";
import { Segmented } from "@/components/finance/person/visuals";
import { DecisionBoard } from "@/components/finance/scenarios/board";
import { DemandCard, FactsCard, StripCard } from "@/components/finance/scenarios/futures";
import { Hover } from "@/components/finance/scenarios/hover";
import { LangSwitch, useT } from "@/components/finance/scenarios/lang";
import { AllFigures, AllScenarios, Outcome, Timeline, Tips } from "@/components/finance/scenarios/results";
import { FoldButton, SplitLayout, TabbedCard, usePane } from "@/components/finance/scenarios/pane";
import { ScenarioChart, type ScenarioSeries } from "@/components/finance/scenarios/scenario-chart";
import { Advisor, type StoredAdvice } from "@/components/finance/scenarios/advisor";
import { createClient } from "@/lib/finance/supabase-client";
import { useFinanceCore } from "@/lib/finance/finance-data";
import { usePeople } from "@/lib/finance/people-data";
import { getGoalInputs } from "@/lib/finance/actions";
import type { FormulaFreelancer } from "@/lib/finance/overview";
import type { PayslipMonth } from "@/lib/finance/people";
import { formatILSShort } from "@/lib/finance/format";
import { buildBaseline } from "@/lib/finance/scenarios/baseline";
import { boardFor, groupIdOf, roleOf } from "@/lib/finance/scenarios/board";
import { cleanDecision, newId, type Decision } from "@/lib/finance/scenarios/decisions";
import { cashFloorOf, HORIZON, monthMoney, runScenario, stateAt, type ScenarioResult } from "@/lib/finance/scenarios/engine";
import { factsFrom } from "@/lib/finance/scenarios/facts-shared";
import { useCompanyFigures, useDefaultFacts } from "@/components/finance/company-figures";
import { adviceInput, briefOf, refsOf, type Advice, type AdviceKind } from "@/lib/finance/scenarios/advise-prompt";
import { defaultDemand, demandFrom, futuresFrom, starters, type Demand } from "@/lib/finance/scenarios/starters";
import { tipsFor } from "@/lib/finance/scenarios/tips";
import { addMonths } from "@/lib/finance/scenarios/decisions";
import type { CompanyFacts } from "@/lib/finance/scenarios/types";

interface Scenario {
  /** A uuid once saved; "today" for the live baseline; "draft:…" before saving. */
  id: string;
  name: string;
  decisions: Decision[];
  saved: boolean;
}

interface ScenarioRow {
  id: string;
  name: string;
  decisions: unknown;
  archived: boolean;
  updated_at: string;
}

const TODAY: Scenario = { id: "today", name: "Today", decisions: [], saved: false };
// One colour per scenario, by its place in the list — the same on every chart and in the table.
const COLORS = ["var(--brand)", "#e0662b", "#0f9d78", "#9b4dca", "#d4a017", "#e04f7a", "#2b9fd9", "#6b7280"];
type Store = "loading" | "ready" | "missing";
type Mode = "profit" | "cash";
type View = "build" | "compare";
type LeftTab = "decisions" | "demand" | "studio" | "facts";
type RightTab = "summary" | "chart" | "tips" | "timeline";

const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export default function ScenariosPage() {
  const { t, lang } = useT();
  const core = useFinanceCore();
  const people = usePeople();
  const [formula, setFormula] = useState<FormulaFreelancer[] | null>(null);
  const [slips, setSlips] = useState<PayslipMonth[] | null>(null);
  const [store, setStore] = useState<Store>("loading");
  const [rows, setRows] = useState<ScenarioRow[]>([]);
  const [settings, setSettings] = useState<{ facts?: unknown; demand?: unknown } | null>(null);
  const [lastAdvice, setLastAdvice] = useState<StoredAdvice | null>(null);

  // Tracker freelancers on sliding rates (AB, Milica, Dima) — as the hours goal reads them.
  useEffect(() => {
    const [y, m] = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).split("-").map(Number);
    getGoalInputs(y, m)
      .then((g) => setFormula(g.formulaFreelancers ?? []))
      .catch(() => setFormula([]));
  }, []);

  // The owner's payslips: gross salary, for the salary lever.
  const ownerId = people.data?.people.find((p) => p.position === "owner")?.id ?? null;
  useEffect(() => {
    if (!people.data) return;
    if (!ownerId) return setSlips([]);
    createClient()
      .from("finance_payslips")
      .select("year, month, salary_rate, salary_quantity, salary_paid, gross_total")
      .eq("profile_id", ownerId)
      .then(({ data }) =>
        setSlips(
          ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
            year: Number(r.year),
            month: Number(r.month),
            salaryRate: numOrNull(r.salary_rate),
            salaryQuantity: numOrNull(r.salary_quantity),
            salaryPaid: numOrNull(r.salary_paid),
            grossTotal: numOrNull(r.gross_total),
            vacationBalance: null,
            sickBalance: null,
          })),
        ),
      );
  }, [people.data, ownerId]);

  // The page's own tables (reference/0023) — it still plays before they exist.
  useEffect(() => {
    const sb = createClient();
    Promise.all([
      sb.from("finance_scenarios").select("id, name, decisions, archived, updated_at").eq("archived", false).order("created_at"),
      sb.from("finance_scenario_settings").select("settings").eq("id", 1).maybeSingle(),
      sb.from("finance_scenario_advice").select("kind, run_at, result").not("result", "is", null).order("run_at", { ascending: false }).limit(1).maybeSingle(),
    ]).then(([s, st, adv]) => {
      if (s.error || st.error) return setStore("missing");
      setRows((s.data as ScenarioRow[]) ?? []);
      setSettings(((st.data as { settings: { facts?: unknown; demand?: unknown } } | null)?.settings) ?? {});
      const a = adv.data as { kind: AdviceKind; run_at: string; result: Advice } | null;
      if (a) setLastAdvice({ kind: a.kind, runAt: a.run_at, advice: a.result });
      setStore("ready");
    });
  }, []);

  const defaultFacts = useDefaultFacts();
  const { nicknames } = useCompanyFigures();
  const facts = useMemo(() => factsFrom(settings?.facts, defaultFacts), [settings, defaultFacts]);
  const [factsLocal, setFactsLocal] = useState<CompanyFacts | null>(null);
  const factsNow = factsLocal ?? facts;

  const baseline = useMemo(() => {
    if (!core.data || !people.data || formula == null || slips == null) return null;
    return buildBaseline({ pnl: core.data.pnl, people: people.data.people, ledgers: people.data.ledgers, formula, ownerSlips: slips, fx: core.data.fx, facts: factsNow });
  }, [core.data, people.data, formula, slips, factsNow]);

  // ── Scenarios in play ────────────────────────────────────────────────────
  const [scenarios, setScenarios] = useState<Scenario[]>([TODAY]);
  const [selected, setSelected] = useState("today");
  const [compare, setCompare] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("profit");
  const [view, setView] = useState<View>("build");
  const [leftTab, setLeftTab] = useState<LeftTab>("decisions");
  const [rightTab, setRightTab] = useState<RightTab>("summary");
  const pane = usePane();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const loadedRows = useRef(false);

  useEffect(() => {
    if (!baseline || store !== "ready" || loadedRows.current) return;
    loadedRows.current = true;
    const saved = rows.map((r) => ({
      id: r.id,
      name: r.name,
      decisions: (Array.isArray(r.decisions) ? r.decisions : []).map((d) => cleanDecision(d, baseline.team) ?? null).filter((d): d is Decision => d !== null),
      saved: true,
    }));
    setScenarios([TODAY, ...saved]);
    if (saved[0]) setSelected(saved[0].id);
  }, [baseline, store, rows]);

  // Demand: the middle and how wide the range is (settings, else the last 3 months ±25%).
  const [demandLocal, setDemandLocal] = useState<Demand | null>(null);
  const demand = demandLocal ?? demandFrom(settings?.demand) ?? (baseline ? defaultDemand(baseline) : null);
  const futures = useMemo(() => (demand ? futuresFrom(demand) : null), [demand]);

  // Settings are saved a moment after the last change.
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSettings = useCallback(
    (next: { facts: CompanyFacts; demand: Demand | null }) => {
      if (store !== "ready") return;
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
      settingsTimer.current = setTimeout(() => {
        void createClient()
          .from("finance_scenario_settings")
          .upsert({ id: 1, settings: { facts: next.facts, demand: next.demand }, updated_at: new Date().toISOString() });
      }, 700);
    },
    [store],
  );
  const changeFacts = (f: CompanyFacts) => {
    setFactsLocal(f);
    saveSettings({ facts: f, demand: demandLocal ?? demandFrom(settings?.demand) });
  };
  const changeDemand = (d: Demand | null) => {
    setDemandLocal(d);
    saveSettings({ facts: factsNow, demand: d });
  };

  const results = useMemo(() => {
    const out = new Map<string, ScenarioResult>();
    if (!baseline || !futures) return out;
    for (const s of scenarios) out.set(s.id, runScenario(baseline, s.decisions, futures, factsNow));
    return out;
  }, [baseline, futures, scenarios, factsNow]);

  const board = useMemo(() => (baseline ? boardFor(baseline, t) : []), [baseline, t]);
  const current = scenarios.find((s) => s.id === selected) ?? TODAY;
  const result = results.get(current.id);

  // What each group's ticks do to the middle future's 12-month profit.
  const impact = useMemo(() => {
    const out = new Map<string, number>();
    if (!baseline || !futures || !result) return out;
    const ids = new Set(current.decisions.map((d) => groupIdOf(d, board)).filter((g): g is string => !!g));
    for (const g of ids) {
      const without = runScenario(baseline, current.decisions.filter((d) => groupIdOf(d, board) !== g), futures, factsNow);
      out.set(g, result.futures.mid.profit - without.futures.mid.profit);
    }
    return out;
  }, [baseline, futures, result, current, board, factsNow]);

  // Saved scenarios are written a moment after each change.
  const scenarioTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function update(next: Scenario) {
    setScenarios((all) => all.map((s) => (s.id === next.id ? next : s)));
    if (!next.saved || store !== "ready") return;
    setSaveState("saving");
    if (scenarioTimer.current) clearTimeout(scenarioTimer.current);
    scenarioTimer.current = setTimeout(async () => {
      const { error } = await createClient()
        .from("finance_scenarios")
        .update({ name: next.name, decisions: next.decisions, updated_at: new Date().toISOString() })
        .eq("id", next.id);
      setSaveState(error ? "error" : "saved");
    }, 600);
  }

  function addScenario(name: string, decisions: Decision[]) {
    const s: Scenario = { id: `draft:${newId()}`, name, decisions: decisions.map((d) => ({ ...d, id: newId() })), saved: false };
    setScenarios((all) => [...all, s]);
    setSelected(s.id);
  }

  async function save(s: Scenario) {
    if (store !== "ready") return;
    setSaveState("saving");
    const { data, error } = await createClient().from("finance_scenarios").insert({ name: s.name, decisions: s.decisions }).select("id").single();
    if (error || !data) return setSaveState("error");
    const id = (data as { id: string }).id;
    setScenarios((all) => all.map((x) => (x.id === s.id ? { ...x, id, saved: true } : x)));
    setCompare((c) => c.map((x) => (x === s.id ? id : x)));
    setSelected(id);
    setSaveState("saved");
  }

  async function remove(s: Scenario) {
    setConfirmDelete(false);
    if (s.saved) {
      const { error } = await createClient().from("finance_scenarios").update({ archived: true }).eq("id", s.id);
      if (error) return setSaveState("error");
    }
    setScenarios((all) => all.filter((x) => x.id !== s.id));
    setCompare((c) => c.filter((x) => x !== s.id));
    setSelected("today");
  }

  const toggleCompare = (id: string) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 3 ? [...c.slice(1), id] : [...c, id]));

  if (core.error || people.error) return <ErrorState message={core.error ?? people.error ?? t("Failed to load")} />;
  if (!baseline || !futures || !demand || !result || store === "loading") return <Loading label={t("Working out today's studio…")} />;

  const team = baseline.team;
  const refs = refsOf(team);
  // "Today" is the page's own name — shown in the page's language.
  const nameOf = (s: Scenario) => (s.id === "today" ? t("Today") : s.name);
  const colorOf = (s: Scenario) => COLORS[Math.max(0, scenarios.indexOf(s)) % COLORS.length];
  const cashFloor = cashFloorOf(baseline, factsNow);
  const shown = (compare.length ? compare : current.id === "today" ? ["today"] : ["today", current.id])
    .map((id) => scenarios.find((s) => s.id === id))
    .filter((s): s is Scenario => !!s);
  const months = Array.from({ length: HORIZON }, (_, i) => addMonths(baseline.start, i));
  // Compare all charts every scenario; Build charts the ones picked (or today + this one).
  const series: ScenarioSeries[] = (view === "compare" ? scenarios : shown).map((s) => {
    const r = results.get(s.id)!;
    const pick = (id: "bad" | "mid" | "good") => r.futures[id].months.map((m) => (mode === "profit" ? m.cumProfit : m.cash));
    return { name: nameOf(s), color: colorOf(s), bad: pick("bad"), mid: pick("mid"), good: pick("good") };
  });
  // "Today" at the last 3 months' demand, set against what the P&L booked — the model's honesty check.
  const check = monthMoney(baseline, stateAt(baseline, [], baseline.start, factsNow), baseline.soldHours, 0);

  const buildInput = (kind: AdviceKind) => {
    const list = kind === "compare" ? (compare.length >= 2 ? shown : scenarios) : kind === "advise" ? [current] : scenarios;
    return adviceInput(kind, baseline, factsNow, cashFloor, futures, list.map((s) => briefOf(s.name, s.decisions, results.get(s.id)!, team, refs, nicknames)), refs, lang);
  };

  const chartBody = (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Segmented<Mode> value={mode} options={[{ id: "profit", label: t("Profit") }, { id: "cash", label: t("Cash") }]} onChange={setMode} />
        <Hover title={t("Next 12 months")}>
          {t("The middle future as a line; the band runs from the bad future (dashed) to the good one. Click the dots on the scenario pills to choose which to show.")}
        </Hover>
      </div>
      <ScenarioChart months={months} series={series} floor={mode === "cash" ? cashFloor : 0} floorLabel={t("cash floor")} />
    </div>
  );
  const tips = tipsFor(baseline, result, futures, factsNow, t);
  const warnings = tips.filter((x) => x.tone !== "good").length;

  // Ticking on "Today" starts a new scenario from it.
  const changeDecisions = (next: Decision[]) => {
    if (current.id === "today") return addScenario(t("New scenario"), next);
    update({ ...current, decisions: next });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* &advice | Scenarios — the what-if page is a tab of the advisor. */}
      <PageViews views={ADVICE_VIEWS} className="self-start" />
      <PageHeader title={t("Scenarios")} actions={<LangSwitch />} />
      <p className="-mt-5 max-w-[80ch] text-[15px] leading-6 text-muted">
        {t("Tick what you'd change, set how much work you expect, and see what happens over the next 12 months. The past is a reference, not a forecast.")}
        {store === "missing" ? (
          <span className="block text-[var(--warning)]">{t("Not saving yet — run reference/0023 in Supabase.")}</span>
        ) : saveState !== "idle" ? (
          <span className={`ms-2 ${saveState === "error" ? "text-danger" : "text-faint"}`}>{saveState === "saving" ? t("Saving…") : saveState === "saved" ? t("Saved") : t("Couldn't save")}</span>
        ) : null}
      </p>

      <Advisor
        build={buildInput}
        scenarioIds={(kind) => (kind === "advise" ? [current.id] : shown.map((s) => s.id)).filter((id) => !id.startsWith("draft:") && id !== "today")}
        team={team}
        refs={refs}
        last={lastAdvice}
        onResult={setLastAdvice}
        onTry={(name, ds) => {
          addScenario(name, ds);
          setView("build");
        }}
        canCompare={scenarios.length >= 2}
      />

      {/* View + scenarios: one toolbar. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface p-2 shadow-card">
        {scenarios.map((s) => {
          const color = compare.includes(s.id) ? colorOf(s) : "var(--border-strong)";
          const on = s.id === selected && view === "build";
          return (
            <span key={s.id} className={`flex items-center rounded-full text-[15px] ${on ? "bg-foreground text-background" : "bg-[var(--strip)] text-foreground hover:bg-brand-soft"}`}>
              <button
                onClick={() => {
                  setSelected(s.id);
                  setView("build");
                }}
                className="py-1.5 pe-2 ps-3.5"
              >
                {nameOf(s)}
                {!s.saved && s.id !== "today" && <span className="ms-1.5 text-[12px] text-[var(--warning)]">{t("unsaved")}</span>}
              </button>
              <button
                onClick={() => toggleCompare(s.id)}
                title={compare.includes(s.id) ? t("On the chart — click to take it off") : t("Put it on the chart")}
                className="me-2 size-3.5 rounded-full border-2"
                style={{ borderColor: compare.includes(s.id) ? color : colorOf(s), background: compare.includes(s.id) ? color : "transparent" }}
                aria-label={t("Show on the chart")}
              />
            </span>
          );
        })}
        <button onClick={() => addScenario(t("New scenario"), [])} className="flex items-center gap-1 rounded-full border border-dashed border-border-strong px-3 py-1.5 text-[15px] text-muted hover:border-brand hover:text-brand">
          <Plus size={15} /> {t("New")}
        </button>
        <Starters
          onPick={(name, ds) => {
            addScenario(name, ds);
            setView("build");
          }}
          list={starters(baseline, factsNow, t)}
        />
        <Hover title={t("Scenarios")}>{t("Each pill is a scenario. Click to open it; click its dot to put it on the chart (up to 3). Starters are the ones we worked out by hand — open one and adjust.")}</Hover>
        <button
          onClick={() => setView(view === "compare" ? "build" : "compare")}
          aria-pressed={view === "compare"}
          className={`ms-auto flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[15px] font-medium ${view === "compare" ? "bg-foreground text-background" : "bg-brand text-white hover:bg-brand-dark"}`}
        >
          <Columns3 size={16} /> {t("Compare all")}
        </button>
      </div>

      {view === "compare" ? (
        // Every scenario, full width: the table, and below it the chart — full width, so it reads large.
        <div className="grid gap-3">
          <AllScenarios
            items={scenarios.map((s) => ({ id: s.id, name: nameOf(s), color: colorOf(s), result: results.get(s.id)! }))}
            futures={futures}
            selected={current.id}
            onSelect={(id) => {
              setSelected(id);
              setView("build");
            }}
          />
          <section className="rounded-3xl bg-surface p-4 shadow-card">{chartBody}</section>
        </div>
      ) : (
        <SplitLayout
          pane={pane}
          railSummary={`${nameOf(current)} · ${formatILSShort(result.futures.mid.profit)}`}
          left={
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-2.5 shadow-card">
                {current.id === "today" ? (
                  <p className="flex-1 text-[17px] font-medium">
                    {t("Today")} <span className="ms-2 text-[15px] font-normal text-muted">{t("The studio as it is. Tick a decision to start a scenario.")}</span>
                  </p>
                ) : (
                  <>
                    <input
                      value={current.name}
                      onChange={(e) => update({ ...current, name: e.target.value })}
                      aria-label={t("Scenario name")}
                      className="min-w-0 flex-1 rounded-lg bg-transparent px-1 text-[19px] font-medium hover:bg-[var(--strip)] focus:bg-[var(--strip)] focus:outline-none"
                    />
                    {!current.saved && (
                      <button onClick={() => save(current)} disabled={store !== "ready"} className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">
                        <Save size={15} /> {t("Save")}
                      </button>
                    )}
                    <button onClick={() => addScenario(t("{name} (copy)", { name: current.name }), current.decisions)} className="rounded-full p-2 text-faint hover:bg-[var(--strip)] hover:text-foreground" aria-label={t("Copy this scenario")} title={t("Copy")}>
                      <Copy size={18} />
                    </button>
                    <button onClick={() => setConfirmDelete(true)} className="rounded-full p-2 text-faint hover:bg-[var(--strip)] hover:text-danger" aria-label={t("Delete this scenario")} title={t("Delete")}>
                      <Trash2 size={18} />
                    </button>
                  </>
                )}
              </div>
              <TabbedCard<LeftTab>
                value={leftTab}
                onChange={setLeftTab}
                tabs={[
                  { id: "decisions", label: t("Decisions"), badge: current.decisions.length },
                  { id: "demand", label: t("Work coming in") },
                  { id: "studio", label: t("Today's studio") },
                  { id: "facts", label: t("Company facts") },
                ]}
              >
                {leftTab === "decisions" && (
                  <DecisionBoard board={board} decisions={current.decisions} baseline={baseline} team={team} impact={impact} onChange={changeDecisions} scenarioId={current.id} />
                )}
                {leftTab === "demand" && <DemandCard bare demand={demand} baseline={baseline} onChange={changeDemand} onReset={() => changeDemand(null)} />}
                {leftTab === "studio" && <TodayStudio bare baseline={baseline} check={check} />}
                {leftTab === "facts" && <FactsCard bare facts={factsNow} cashFloor={cashFloor} onChange={changeFacts} saved={store === "ready"} />}
              </TabbedCard>
            </div>
          }
          right={
            <TabbedCard<RightTab>
              value={rightTab}
              onChange={setRightTab}
              end={<FoldButton onFold={() => pane.setFolded(true)} />}
              tabs={[
                { id: "summary", label: t("Summary") },
                { id: "chart", label: t("Chart") },
                { id: "tips", label: t("Worth knowing"), badge: warnings, tone: "warning" },
                ...(current.decisions.length ? [{ id: "timeline" as const, label: t("When it lands") }] : []),
              ]}
            >
              {rightTab === "summary" && (
                <div className="flex flex-col gap-3">
                  <Outcome result={result} futures={futures} />
                  <AllFigures result={result} />
                </div>
              )}
              {rightTab === "chart" && chartBody}
              {rightTab === "tips" && <Tips tips={tips} />}
              {rightTab === "timeline" && <Timeline decisions={current.decisions} team={team} facts={factsNow} start={baseline.start} />}
            </TabbedCard>
          }
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t("Delete “{name}”?", { name: current.name })}
          body={t("The scenario and its decisions go from this page. Nothing in the finance data changes.")}
          confirmLabel={t("Delete")}
          danger
          onConfirm={() => remove(current)}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

function Starters({ list, onPick }: { list: ReturnType<typeof starters>; onPick: (name: string, ds: Decision[]) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-[16px] text-foreground shadow-card hover:bg-brand-soft">
        {t("Starters")} <ChevronDown size={16} />
      </button>
      {open && (
        <div className="absolute start-0 z-30 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-2xl bg-surface p-2 shadow-[0_12px_32px_rgba(6,17,47,0.16)] ring-1 ring-border">
          {list.map((s) => (
            <button
              key={s.name}
              onClick={() => {
                onPick(s.name, s.decisions);
                setOpen(false);
              }}
              className="block w-full rounded-xl px-3 py-2.5 text-start hover:bg-[var(--strip)]"
            >
              <span className="text-[17px] font-medium">{s.name}</span>
              <span className="block text-[15px] leading-6 text-muted">{s.why}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Who and what the engine starts from — and how close "Today" comes to what the P&L booked. */
function TodayStudio({ baseline: b, check, bare }: { baseline: NonNullable<ReturnType<typeof buildBaseline>>; check: ReturnType<typeof monthMoney>; bare?: boolean }) {
  const { t } = useT();
  const k = formatILSShort;
  const off = Math.abs(check.profit - b.actual.profit);
  return (
    <StripCard
      bare={bare}
      title={t("Today's studio")}
      info={t("What every scenario starts from: the last 3 finished months' people, costs and hours (someone not paid last month has left). Capacity is the client hours someone can take a month: 90% of an employee's logged hours; a freelancer takes as much as the work needs.")}
      right={<span className="text-[16px] tabular-nums text-muted">{t("₪{rate} an hour · Keys {pct}%", { rate: Math.round(b.rate), pct: Math.round(b.keysShare * 100) })}</span>}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {b.team.map((m) => (
          <div key={m.id} className="rounded-2xl bg-[var(--strip)] p-4">
            <p className="text-[17px] font-medium">{m.name}</p>
            <p className="text-[15px] text-muted">{roleOf(m.kind, t)}</p>
            <p className="mt-2 text-[16px] tabular-nums">
              {m.price ? (m.price.kind === "flat" ? `₪${Math.round(m.price.rate)}/h` : `₪${Math.round(m.price.terms.rateHigh)}→${Math.round(m.price.terms.rateLow)}/h`) : t("{amount} a month", { amount: k(m.monthlyCost) })}
            </p>
            <p className="text-[15px] tabular-nums text-muted">
              {t("{hours}h billed", { hours: Math.round(m.billable) })}
              {m.keys >= 1 ? ` · ${t("{hours}h written down", { hours: Math.round(m.keys) })}` : ""}
              {m.capacity ? ` · ${t("can take {hours}h", { hours: m.capacity })}` : ""}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[16px] leading-6 tabular-nums text-muted">
        {t("Office {office} · other costs {other}", { office: k(b.office), other: k(b.otherFixed) })}
        {b.otherPayroll > 0 && ` · ${t("other payroll {amount}", { amount: k(b.otherPayroll) })}`}
        {` · ${t("you + Michal {hours}h a month for clients", { hours: b.ownerHours + b.staffHours })}`}
      </p>
      <p className={`mt-2 flex items-center gap-1.5 text-[16px] tabular-nums ${off > 10_000 ? "text-[var(--warning)]" : "text-muted"}`}>
        {t("Check: at the last 3 months' {hours}h the model makes {model} a month; the P&L booked {booked}.", { hours: Math.round(b.soldHours), model: k(check.profit), booked: k(b.actual.profit) })}
        <Hover title={t("The model's check")}>
          {t("The model prices freelancers by their hours and keeps costs at today's run-rate, so it won't match a booked month exactly. A big gap means something is missing here — say so before trusting a scenario.")}
        </Hover>
      </p>
    </StripCard>
  );
}
