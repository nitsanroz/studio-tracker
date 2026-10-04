"use client";

// Won lead → client page, in three steps: the client, what to bring, review.
// Nothing is written until "Create client page" on the review step.
//
// The estimate's hierarchy carries across as-is: phase → section,
// group → task group, item → task (0049). Each piece can be left out or renamed,
// each task's hour budget comes from its range (top / middle / bottom) or a
// figure typed over it, and the lead's contacts and the estimate's Overview
// (notes, links) come too.
//
// ⚠️ A NEW CLIENT IS MADE THROUGH THE STORE'S `addClient` — the Clients page's
// own call — so it gets its Keys task and shows everywhere at once. Everything
// after that is `convertToClient`.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Folder, FolderTree, Layers } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { Button, Field, Input, Select } from "@/components/primitives";
import { CLIENT_COLORS } from "@/components/client-mark-picker";
import { loadLead } from "@/lib/leads/data";
import { convertToClient, type ConvertSection, type ConvertTask } from "@/lib/leads/actions";
import { loadEstimate, loadEstimates, type EstimateDetail, type EstimateSummary } from "@/lib/leads/estimates-data";
import { counts, fmtHours, groupWinners, phaseLayout, totals, type EstimateLine } from "@/lib/leads/estimate";
import type { LeadDetail } from "@/lib/leads/types";

type Rule = "top" | "middle" | "bottom";
interface DTask {
  lineId: string;
  title: string;
  on: boolean;
  min: number;
  max: number;
  /** A figure typed over the rule, or null to follow it. */
  budget: number | null;
  brief: string | null;
  /** Why it starts unticked — it was never sold. */
  note: "optional extra" | "not chosen" | null;
}
interface DGroup {
  id: string;
  name: string;
  on: boolean;
  tasks: DTask[];
}
interface DSection {
  id: string;
  name: string;
  on: boolean;
  groups: DGroup[];
  tasks: DTask[];
}

const CARD = "rounded-2xl border border-border bg-surface p-4 shadow-card";
const STEPS = ["Client", "What to bring", "Review"] as const;

const round = (n: number) => Math.round(n * 100) / 100;
function ruleBudget(t: Pick<DTask, "min" | "max">, rule: Rule): number {
  if (rule === "bottom") return round(t.min);
  if (rule === "middle") return round((t.min + t.max) / 2);
  return round(t.max);
}

/** The estimate as an editable tree. Optional extras and options not chosen start unticked — they were not sold. */
function draftFrom(d: EstimateDetail): DSection[] {
  const t = totals(d.lines, d.estimate.rate, d.estimate.vatPercent, d.estimate.discountPercent);
  const winners = groupWinners(d.lines);
  const task = (l: EstimateLine): DTask => {
    const h = t.hours.get(l.id) ?? { min: 0, max: 0 };
    const sold = counts(l, winners);
    return {
      lineId: l.id,
      title: l.name,
      on: sold,
      min: h.min,
      max: h.max,
      budget: null,
      brief: l.description,
      note: sold ? null : l.optional ? "optional extra" : "not chosen",
    };
  };
  return [...d.phases]
    .sort((a, b) => a.position - b.position)
    .map((p) => {
      const lay = phaseLayout(p.id, d.groups, d.lines);
      return {
        id: p.id,
        name: p.name,
        on: true,
        groups: lay.groups.map(({ group, lines }) => ({ id: group.id, name: group.name, on: true, tasks: lines.map(task) })),
        tasks: lay.loose.map(task),
      };
    });
}

export default function ConvertPage() {
  const isAdmin = useIsAdmin();
  const { clients, addClient, refresh, currentUserId } = useData();
  const router = useRouter();
  const { leadId } = useParams<{ leadId: string }>();

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [estimates, setEstimates] = useState<EstimateSummary[]>([]);
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<EstimateDetail | null>(null);
  const [draft, setDraft] = useState<DSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // step 1
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [color, setColor] = useState(CLIENT_COLORS[1]);
  const [clientId, setClientId] = useState("");
  // step 2
  const [rule, setRule] = useState<Rule>("top");
  const [briefs, setBriefs] = useState(true);
  const [contactIds, setContactIds] = useState<Set<string>>(new Set());
  const [bringNotes, setBringNotes] = useState(true);
  const [linkOn, setLinkOn] = useState<Set<number>>(new Set());
  /** Without an estimate: the one section the work starts under. */
  const [plainSection, setPlainSection] = useState("");

  const live = useMemo(() => clients.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name)), [clients]);

  const pickEstimate = useCallback(async (id: string | null) => {
    setEstimateId(id);
    if (!id) {
      setEstimate(null);
      setDraft([]);
      setLinkOn(new Set());
      return;
    }
    const d = await loadEstimate(id);
    setEstimate(d);
    setDraft(d ? draftFrom(d) : []);
    setLinkOn(new Set(d ? d.estimate.links.map((_, i) => i) : []));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      try {
        const [l, ests] = await Promise.all([loadLead(leadId), loadEstimates(leadId)]);
        if (!alive) return;
        setLead(l);
        setEstimates(ests);
        if (l) {
          setName(l.lead.company);
          setPlainSection((l.lead.askedFor ?? "").split("\n")[0].slice(0, 80));
          setContactIds(new Set(l.contacts.map((c) => c.id)));
        }
        const pick = ests.find((e) => e.status === "approved") ?? ests[0] ?? null;
        await pickEstimate(pick?.id ?? null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load the lead.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin, leadId, pickEstimate]);

  // A returning client, or a lead already linked to one, starts on "existing".
  const [modeChosen, setModeChosen] = useState(false);
  const suggested = useMemo(() => {
    if (!lead) return null;
    if (lead.lead.clientId) return lead.lead.clientId;
    const company = lead.lead.company.trim().toLowerCase();
    return live.find((c) => c.name.trim().toLowerCase() === company)?.id ?? null;
  }, [lead, live]);
  const effMode = modeChosen ? mode : suggested || lead?.lead.source === "past_client" ? "existing" : "new";
  const effClientId = clientId || (effMode === "existing" ? (suggested ?? "") : "");

  // ── tree edits ──
  const editSection = (sid: string, f: (s: DSection) => DSection) => setDraft((d) => d.map((s) => (s.id === sid ? f(s) : s)));
  const editTask = (lineId: string, f: (t: DTask) => DTask) =>
    setDraft((d) =>
      d.map((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.lineId === lineId ? f(t) : t)),
        groups: s.groups.map((g) => ({ ...g, tasks: g.tasks.map((t) => (t.lineId === lineId ? f(t) : t)) })),
      })),
    );
  const editGroup = (gid: string, f: (g: DGroup) => DGroup) =>
    setDraft((d) => d.map((s) => ({ ...s, groups: s.groups.map((g) => (g.id === gid ? f(g) : g)) })));

  // ── the plan ──
  const sections: ConvertSection[] = useMemo(() => {
    const toTask = (t: DTask): ConvertTask => ({
      lineId: t.lineId,
      title: t.title,
      budget: t.budget ?? ruleBudget(t, rule),
      brief: briefs ? t.brief : null,
    });
    if (!estimate || draft.length === 0) {
      return plainSection.trim() ? [{ name: plainSection.trim(), groups: [], tasks: [] }] : [];
    }
    return draft
      .filter((s) => s.on)
      .map((s) => ({
        name: s.name,
        groups: s.groups.filter((g) => g.on).map((g) => ({ name: g.name, tasks: g.tasks.filter((t) => t.on).map(toTask) })),
        tasks: s.tasks.filter((t) => t.on).map(toTask),
      }));
  }, [draft, estimate, rule, briefs, plainSection]);

  const allTasks = sections.flatMap((s) => [...s.tasks, ...s.groups.flatMap((g) => g.tasks)]);
  const budgetTotal = allTasks.reduce((a, t) => a + (t.budget ?? 0), 0);
  const groupCount = sections.reduce((a, s) => a + s.groups.length, 0);
  const notes = bringNotes ? (estimate?.estimate.notes ?? null) : null;
  const links = (estimate?.estimate.links ?? []).filter((_, i) => linkOn.has(i));
  const pickedContacts = (lead?.contacts ?? []).filter((c) => contactIds.has(c.id));
  const targetName = effMode === "new" ? name.trim() : (live.find((c) => c.id === effClientId)?.name ?? "");
  const clientOk = effMode === "new" ? name.trim().length > 0 : Boolean(effClientId);

  async function convert() {
    if (!lead || !clientOk) return;
    setBusy(true);
    setError(null);
    try {
      let target: { id: string; name: string; created: boolean; billable: boolean };
      if (effMode === "new") {
        const c = await addClient(name.trim(), color);
        if (!c) throw new Error("The client could not be created.");
        target = { id: c.id, name: c.name, created: true, billable: c.billable };
      } else {
        const c = live.find((x) => x.id === effClientId);
        if (!c) throw new Error("Pick the client.");
        target = { id: c.id, name: c.name, created: false, billable: c.billable };
      }
      await convertToClient(
        {
          leadId: lead.lead.id,
          clientId: target.id,
          clientName: target.name,
          created: target.created,
          billable: target.billable,
          sections,
          contactIds: pickedContacts.map((c) => c.id),
          notes,
          links,
        },
        currentUserId,
      );
      // Sections and tasks were written outside the store; pull them in now.
      refresh();
      router.push(`/clients/${target.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the client page.");
      setBusy(false);
    }
  }

  if (!isAdmin) return <p className="py-16 text-center text-sm text-muted">Leads are for Nitsan and Michal only.</p>;
  if (loading) return <p className="py-10 text-sm text-muted">Loading…</p>;
  if (!lead) return <p className="py-10 text-sm text-danger">{error ?? "That lead no longer exists."}</p>;

  const taskRow = (t: DTask, disabled: boolean, indent: string) => (
    <div key={t.lineId} className={`flex items-center gap-2 py-1 ${indent} ${disabled || !t.on ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={t.on}
        disabled={disabled}
        onChange={(e) => editTask(t.lineId, (x) => ({ ...x, on: e.target.checked }))}
        aria-label={`Bring ${t.title}`}
      />
      <input
        value={t.title}
        disabled={disabled}
        onChange={(e) => editTask(t.lineId, (x) => ({ ...x, title: e.target.value }))}
        className="bidi-auto min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] hover:border-border focus:border-border focus:outline-none"
      />
      {t.note && <span className="shrink-0 text-[11px] text-faint">{t.note}</span>}
      <span className="shrink-0 text-[11.5px] tabular-nums text-faint">{fmtHours({ min: t.min, max: t.max })}</span>
      <input
        type="number"
        min={0}
        step={0.5}
        disabled={disabled}
        value={t.budget ?? ruleBudget(t, rule)}
        onChange={(e) => {
          const raw = e.target.value.trim();
          editTask(t.lineId, (x) => ({ ...x, budget: raw === "" ? null : Number(raw) }));
        }}
        aria-label={`Budget for ${t.title}`}
        title="Budget (h) — typed figures beat the rule"
        className={`w-16 shrink-0 rounded border bg-surface px-1 py-0.5 text-right text-[12.5px] tabular-nums ${
          t.budget !== null ? "border-brand" : "border-border"
        }`}
      />
      <span className="shrink-0 text-[11.5px] text-faint">h</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href={`/leads/${leadId}`} className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-foreground">
        <ChevronLeft size={14} strokeWidth={1.75} /> {lead.lead.company}
      </Link>
      <h1 className="font-serif-accent text-[28px] leading-tight">Create client page</h1>
      <p className="mt-1 text-[13px] text-muted">Pick what comes across from this lead, check it, then create. Nothing is written until the last step.</p>

      {!lead.lead.wonAt && (
        <div className="mt-3 rounded-lg border border-[#f3dfb8] bg-[#fdf3e3] px-3 py-2 text-[13px] text-[#8a5a09]">
          This lead isn&rsquo;t marked as won yet. You can still create its client page.
        </div>
      )}
      {lead.lead.clientId && (
        <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-muted">
          This lead already has a client page. Creating again adds new sections to the client you pick — nothing there is replaced.
        </div>
      )}

      <ol className="mt-5 flex gap-2 text-[12.5px]">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              onClick={() => (i < step || clientOk ? setStep(i) : undefined)}
              className={`rounded-full px-3 py-1 ${
                i === step ? "bg-brand font-medium text-white" : i < step ? "bg-brand-soft text-brand" : "bg-background text-muted"
              }`}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>}

      {step === 0 && (
        <section className={`${CARD} mt-4 flex max-w-lg flex-col gap-3`}>
          <div className="flex overflow-hidden rounded-lg border border-border text-[12.5px]">
            {(
              [
                ["new", "New client"],
                ["existing", "Existing client"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setModeChosen(true);
                  setMode(k);
                }}
                aria-pressed={effMode === k}
                className={`flex-1 px-3 py-1.5 ${effMode === k ? "bg-brand font-medium text-white" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {effMode === "new" ? (
            <>
              <Field label="Client name">
                <Input value={name} onChange={(e) => setName(e.target.value)} className="bidi-auto" autoFocus />
              </Field>
              <div className="flex flex-col gap-1">
                <span className="text-ui-label text-muted">Colour</span>
                <div className="flex flex-wrap gap-1.5">
                  {CLIENT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      aria-label={`Colour ${c}`}
                      aria-pressed={color === c}
                      className={`size-6 rounded-full ${color === c ? "ring-2 ring-brand ring-offset-2" : ""}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <Field label="Client" hint="The work lands as new sections after the ones it already has.">
              <Select value={effClientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Pick a client…</option>
                {live.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="flex justify-end">
            <Button disabled={!clientOk} onClick={() => setStep(1)}>
              Next
            </Button>
          </div>
        </section>
      )}

      {step === 1 && (
        <div className="mt-4 grid items-start gap-5 lg:grid-cols-[7fr_3fr]">
          <section className={CARD}>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold">Sections, groups and tasks</h2>
              {estimates.length > 0 && (
                <select
                  value={estimateId ?? ""}
                  onChange={(e) => void pickEstimate(e.target.value || null)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[12.5px]"
                  aria-label="From estimate"
                >
                  {estimates.map((e) => (
                    <option key={e.id} value={e.id}>
                      Estimate v{e.version} · {e.status === "in_review" ? "in review" : e.status}
                    </option>
                  ))}
                  <option value="">No estimate</option>
                </select>
              )}
            </div>

            {!estimate || draft.length === 0 ? (
              <Field label="Section" hint="No estimate to bring — name one section to start the work under, or leave it blank.">
                <Input value={plainSection} onChange={(e) => setPlainSection(e.target.value)} className="bidi-auto" />
              </Field>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
                  <span className="text-muted">Hour budget from each range:</span>
                  {(["top", "middle", "bottom"] as const).map((r) => (
                    <label key={r} className="flex items-center gap-1">
                      <input type="radio" name="rule" checked={rule === r} onChange={() => setRule(r)} />
                      {r === "top" ? "Top" : r === "middle" ? "Middle" : "Bottom"}
                    </label>
                  ))}
                  <label className="ml-auto flex items-center gap-1">
                    <input type="checkbox" checked={briefs} onChange={(e) => setBriefs(e.target.checked)} />
                    Item descriptions become task briefs
                  </label>
                </div>
                <p className="mt-1 text-[11.5px] text-faint">
                  Unticking a section or group leaves out everything under it. A budget you type (blue outline) beats the rule.
                </p>
                <div className="mt-3 flex flex-col divide-y divide-border/60">
                  {draft.map((s) => (
                    <div key={s.id} className="py-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={s.on}
                          onChange={(e) => editSection(s.id, (x) => ({ ...x, on: e.target.checked }))}
                          aria-label={`Bring ${s.name}`}
                        />
                        <Layers size={14} className="text-faint" />
                        <input
                          value={s.name}
                          onChange={(e) => editSection(s.id, (x) => ({ ...x, name: e.target.value }))}
                          className="bidi-auto min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[14px] font-semibold hover:border-border focus:border-border focus:outline-none"
                        />
                        <span className="text-[11px] uppercase tracking-wide text-faint">Section</span>
                      </div>
                      {s.groups.map((g) => (
                        <div key={g.id} className={!s.on ? "opacity-50" : ""}>
                          <div className="flex items-center gap-2 py-1 pl-6">
                            <input
                              type="checkbox"
                              checked={g.on}
                              disabled={!s.on}
                              onChange={(e) => editGroup(g.id, (x) => ({ ...x, on: e.target.checked }))}
                              aria-label={`Bring ${g.name}`}
                            />
                            <Folder size={13} className="text-faint" />
                            <input
                              value={g.name}
                              disabled={!s.on}
                              onChange={(e) => editGroup(g.id, (x) => ({ ...x, name: e.target.value }))}
                              className="bidi-auto min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-semibold hover:border-border focus:border-border focus:outline-none"
                            />
                            <span className="text-[11px] uppercase tracking-wide text-faint">Group</span>
                          </div>
                          {g.tasks.map((t) => taskRow(t, !s.on || !g.on, "pl-12"))}
                        </div>
                      ))}
                      {s.tasks.map((t) => taskRow(t, !s.on, "pl-6"))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <div className="flex flex-col gap-4">
            <section className={CARD}>
              <h2 className="mb-2 text-sm font-semibold">Contacts</h2>
              {lead.contacts.length === 0 ? (
                <p className="text-[13px] text-faint">No contacts on this lead.</p>
              ) : (
                lead.contacts.map((c) => (
                  <label key={c.id} className="flex items-start gap-2 py-1 text-[13px]">
                    <input
                      type="checkbox"
                      checked={contactIds.has(c.id)}
                      onChange={(e) =>
                        setContactIds((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(c.id);
                          else n.delete(c.id);
                          return n;
                        })
                      }
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="bidi-auto block font-medium">{c.name}</span>
                      <span className="block truncate text-[11.5px] text-muted">{[c.title, c.email].filter(Boolean).join(" · ")}</span>
                    </span>
                  </label>
                ))
              )}
            </section>
            <section className={CARD}>
              <h2 className="mb-2 text-sm font-semibold">Overview</h2>
              {estimate?.estimate.notes ? (
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" checked={bringNotes} onChange={(e) => setBringNotes(e.target.checked)} className="mt-0.5" />
                  <span className="bidi-auto line-clamp-3 whitespace-pre-wrap text-muted">{estimate.estimate.notes}</span>
                </label>
              ) : (
                <p className="text-[13px] text-faint">No notes on the estimate&rsquo;s Overview.</p>
              )}
              {(estimate?.estimate.links ?? []).map((l, i) => (
                <label key={`${l.url}-${i}`} className="mt-1 flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={linkOn.has(i)}
                    onChange={(e) =>
                      setLinkOn((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(i);
                        else n.delete(i);
                        return n;
                      })
                    }
                  />
                  <span className="bidi-auto truncate">{l.title}</span>
                </label>
              ))}
            </section>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button onClick={() => setStep(2)}>Review</Button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-4 grid items-start gap-5 lg:grid-cols-[7fr_3fr]">
          <section className={CARD}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <FolderTree size={15} className="text-faint" /> What the client page will get
            </h2>
            {sections.length === 0 ? (
              <p className="text-[13px] text-faint">No sections — only the client, contacts and Overview.</p>
            ) : (
              sections.map((s, i) => (
                <div key={i} className="border-t border-border/60 py-2 first:border-0">
                  <div className="bidi-auto text-[14px] font-semibold">{s.name}</div>
                  {s.groups.map((g, j) => (
                    <div key={j} className="pl-5">
                      <div className="bidi-auto py-0.5 text-[13px] font-semibold">{g.name}</div>
                      {g.tasks.map((t, k) => (
                        <div key={k} className="flex justify-between gap-3 pl-5 text-[13px]">
                          <span className="bidi-auto truncate">{t.title}</span>
                          <span className="shrink-0 tabular-nums text-muted">{t.budget ?? "—"}h</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {s.tasks.map((t, k) => (
                    <div key={k} className="flex justify-between gap-3 pl-5 text-[13px]">
                      <span className="bidi-auto truncate">{t.title}</span>
                      <span className="shrink-0 tabular-nums text-muted">{t.budget ?? "—"}h</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </section>
          <div className="flex flex-col gap-4">
            <section className={CARD}>
              <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[13px]">
                <dt className="text-muted">Client</dt>
                <dd className="bidi-auto text-right font-medium">
                  {targetName} <span className="font-normal text-faint">({effMode === "new" ? "new" : "existing"})</span>
                </dd>
                <dt className="text-muted">Sections</dt>
                <dd className="text-right tabular-nums">{sections.length}</dd>
                <dt className="text-muted">Groups</dt>
                <dd className="text-right tabular-nums">{groupCount}</dd>
                <dt className="text-muted">Tasks</dt>
                <dd className="text-right tabular-nums">{allTasks.length}</dd>
                <dt className="text-muted">Budget</dt>
                <dd className="text-right tabular-nums">{round(budgetTotal)}h</dd>
                <dt className="text-muted">Contacts</dt>
                <dd className="text-right tabular-nums">{pickedContacts.length}</dd>
                <dt className="text-muted">Notes · links</dt>
                <dd className="text-right tabular-nums">
                  {notes ? "yes" : "no"} · {links.length}
                </dd>
              </dl>
            </section>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button disabled={busy || !clientOk} onClick={() => void convert()}>
                {busy ? "Creating…" : "Create client page"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
