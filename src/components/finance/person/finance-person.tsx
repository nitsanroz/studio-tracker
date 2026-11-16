"use client";

// A person's money side, as tabs of their one page (/team/[id] — Nitsan,
// 2026-11-15: "merge Profile and Pay & HR into tabs, one page"). The figures
// that matter sit above the tab — pay, cost, return, vacation — then one of
// Summary (what to do), Performance, Pay, History, HR. The tabs live beside
// this file; this loads the data and works it out once.
//
// ⚠️ FULL FINANCE ONLY. The person page draws it only for that tier, its server
// layout hands the hourly terms down only to that tier (team/[profileId]/
// layout.tsx), and every table here is read with the viewer's own session.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/finance/supabase-client";
import { forgetPeople, usePeople } from "@/lib/finance/people-data";
import { canSetOwnerPosition } from "@/lib/finance/finance-access";
import {
  POSITION_LABEL,
  efficiency,
  finishedThrough,
  grossPay,
  hoursAreOwnWork,
  hrAdvice,
  isFreelancer,
  isHourlySlip,
  jobShareOf,
  monthsEnding,
  monthsOf,
  payAdvice,
  studioMonths,
  raiseAdvice,
  supportedPayByMonth,
  tenure,
  valuePremium,
  type FactorLevels,
  type PayslipMonth,
  type Position,
  neededReturn,
} from "@/lib/finance/people";
import { fetchAll, mapPnl, type PnlRow } from "@/lib/finance/db";
import { LINE, MONTH_SHORT, type PnlMonthly } from "@/lib/finance/finance";
import { useCompanyFigures } from "@/components/finance/company-figures";
import { Loading, ErrorState } from "@/components/finance/ui";
import { formatILS, formatNum } from "@/lib/finance/format";
import { Kpi } from "./visuals";
import { OverviewTab } from "./overview-tab";
import { PersonAdvice } from "./person-advice";
import { PerformanceTab } from "./performance-tab";
import { PayTab } from "./pay-tab";
import { HistoryTab } from "./history-tab";
import { HrTab } from "./hr-tab";
import { fmtDate, latestSlip, type Factors, type Hr, type HrNote, type PeriodId, type PersonModel, type Recent } from "./model";

/** finance_payslips, as the page reads it (numerics may come back as strings). */
interface PayslipRow {
  year: number;
  month: number;
  salary_rate: number | string | null;
  salary_quantity: number | string | null;
  salary_paid: number | string | null;
  gross_total: number | string | null;
  vacation_balance: number | string | null;
  sick_balance: number | string | null;
  /** From reference/0009 on. */
  sick_used?: number | string | null;
}
const numOrNull = (v: number | string | null) => (v == null ? null : Number(v));

/** The money tabs of a person's page. "summary" is what was this page's Overview. */
export type FinanceTab = "summary" | "performance" | "pay" | "history" | "hr";

/** `only="advice"`: just &advice's card about them (`person-advice.tsx`), for
 *  the top of the person's Work tab; nothing while it loads. */
/** `adviceSlot`: where the page keeps &advice's column — a money tab draws the
 *  card there itself, so the column doesn't load this person a second time. */
export function FinancePerson({
  id,
  tab,
  onTab,
  only,
  adviceSlot,
}: {
  id: string;
  tab: FinanceTab;
  onTab: (t: FinanceTab) => void;
  only?: "advice";
  adviceSlot?: HTMLElement | null;
}) {
  const { hourlyTerms: HOURLY_TERMS } = useCompanyFigures();
  const { data, error, loading } = usePeople({ personId: id });
  const [hr, setHr] = useState<Hr | null | undefined>(undefined);
  const [notes, setNotes] = useState<HrNote[]>([]);
  const [pnl, setPnl] = useState<PnlMonthly[] | null>(null);
  const [slips, setSlips] = useState<PayslipMonth[]>([]);
  // What they bring beyond their hours, as the owner rates it (reference/0009).
  const [levels, setLevels] = useState<FactorLevels>({});
  const [factorState, setFactorState] = useState<Factors["state"]>("loading");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest levels, so two quick clicks both count (and both are saved).
  const levelsRef = useRef<FactorLevels>({});

  useEffect(() => {
    createClient()
      .from("finance_person_factors")
      .select("factors")
      .eq("profile_id", id)
      .maybeSingle()
      .then(({ data: row, error: e }) => {
        if (e) return setFactorState("missing");
        levelsRef.current = (row as { factors: FactorLevels } | null)?.factors ?? {};
        setLevels(levelsRef.current);
        setFactorState("ready");
      });
  }, [id]);

  function setFactor(factor: keyof FactorLevels, level: number) {
    // Before the stored grades arrive, a click would save this one grade over all the others.
    if (factorState === "loading") return;
    const next = { ...levelsRef.current, [factor]: level };
    levelsRef.current = next;
    setLevels(next);
    // Still plays without the table, just isn't kept.
    if (factorState === "missing") return;
    setFactorState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const sb = createClient();
      const { data: auth } = await sb.auth.getUser();
      const { error: e } = await sb
        .from("finance_person_factors")
        .upsert({ profile_id: id, factors: next, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null });
      setFactorState(e ? "error" : "saved");
    }, 600);
  }

  useEffect(() => {
    createClient()
      .from("member_hr")
      .select(
        "national_id, gender, birth_date, marital_status, street, house_no, floor, apartment, city, zip, phone, personal_email, emergency_contact_name, emergency_contact_phone",
      )
      .eq("profile_id", id)
      .maybeSingle()
      .then(({ data: row }) => setHr((row as Hr | null) ?? null));
    // Best-effort: until the table exists the timeline simply stays empty.
    createClient()
      .from("person_hr_notes")
      .select("id, kind, date, body, source")
      .eq("profile_id", id)
      .then(({ data: rows }) => setNotes((rows as HrNote[] | null) ?? []));
    // Best-effort too: their payslips (gross salary, vacation), once imported.
    createClient()
      .from("finance_payslips")
      // Every column, so one added later (sick_used) is read once it exists.
      .select("*")
      .eq("profile_id", id)
      .then(({ data: rows }) =>
        setSlips(
          ((rows as PayslipRow[] | null) ?? []).map((r) => ({
            year: r.year,
            month: r.month,
            salaryRate: numOrNull(r.salary_rate),
            salaryQuantity: numOrNull(r.salary_quantity),
            salaryPaid: numOrNull(r.salary_paid),
            grossTotal: numOrNull(r.gross_total),
            vacationBalance: numOrNull(r.vacation_balance),
            sickBalance: numOrNull(r.sick_balance),
            sickUsed: numOrNull(r.sick_used ?? null),
          })),
        ),
      );
  }, [id]);

  // The whole studio's history: the P&L's costs and revenue, and everyone's
  // pay and hours — to set this person's pay against, in any month they were
  // here. The same (cached) load as the People list.
  const upTo = finishedThrough();
  const team = usePeople();
  useEffect(() => {
    fetchAll<PnlRow>(createClient(), "finance_pnl_monthly", "year, month, line_item, value, state, source", (q) =>
      q.in("line_item", [LINE.totalExpenses, LINE.totalRevenues, LINE.salaries, LINE.freelance, LINE.daysInMonth]),
    )
      .then((rows) => setPnl(rows.map(mapPnl)))
      .catch(() => setPnl([]));
  }, []);
  const studio = useMemo(
    () =>
      pnl && team.data
        ? studioMonths(pnl, upTo, team.data.ledgers, new Map(team.data.people.map((p) => [p.id, p.position])))
        : team.error && pnl
          ? studioMonths(pnl, upTo)
          : null,
    [pnl, team.data, team.error, upTo],
  );

  const loaded = data?.people[0];
  // The position can be changed here; the page follows the change at once.
  const [position, setPosition] = useState<Position | null | undefined>(undefined);
  const person = useMemo(
    () => loaded && { ...loaded, position: position === undefined ? loaded.position : position },
    [loaded, position],
  );
  const own = hoursAreOwnWork(person?.position ?? null);
  const ledger = data?.ledgers.get(id);

  // Pay, efficiency and advice always look at the latest finished months.
  const recent = useMemo<Recent | null>(() => {
    if (!studio || !person) return null;
    const windowOf = (pid: PeriodId, label: string, n: number) => {
      const keys = monthsEnding(upTo, n);
      const pay = payAdvice(ledger, keys, studio, own);
      return { id: pid, label, keys, eff: efficiency(ledger, keys, studio, own), pay, gross: grossPay(slips, ledger, pay) };
    };
    const periods = { last: windowOf("last", "Last month", 1), last3: windowOf("last3", "Last 3 months", 3), last12: windowOf("last12", "Last 12 months", 12) };
    const earlier = efficiency(ledger, periods.last12.keys.slice(0, 9), studio, own);
    const freelancer = isFreelancer(ledger, periods.last3.keys);
    const jobShare = jobShareOf(slips, periods.last3.keys);
    const advice = hrAdvice({
      active: person.active,
      ownWork: own,
      position: person.position,
      freelancer,
      startDate: person.startDate,
      notes,
      slips,
      pay: periods.last3.pay,
      gross: periods.last3.gross,
      jobShare,
      terms: HOURLY_TERMS[id],
      recent: periods.last3.eff,
      earlier,
    });
    const paidMonths = [...(ledger ?? [])].filter(([k, x]) => k <= upTo && x.salary + x.freelance > 0).map(([k]) => k).sort();
    const supported = supportedPayByMonth(slips, ledger, studio, paidMonths, own);
    const raise = raiseAdvice({
      active: person.active,
      ownWork: own,
      position: person.position,
      freelancer,
      startDate: person.startDate,
      notes,
      slips,
      last3: { ...periods.last3, jobShare },
      last12: { ...periods.last12, jobShare: jobShareOf(slips, periods.last12.keys) },
      premium: valuePremium(levels),
    });
    return { periods, earlier, freelancer, jobShare, advice, supported, raise };
  }, [studio, person, ledger, upTo, own, slips, notes, id, levels]);

  // Who is looking: only the owner may give or take the `owner` position (lib/finance-access.ts).
  const [canOwner, setCanOwner] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);
  useEffect(() => {
    const sb = createClient();
    void sb.auth.getUser().then(async ({ data: auth }) => {
      if (!auth.user) return;
      const { data: viewer } = await sb.from("profiles").select("role, position, finance_full_access").eq("id", auth.user.id).maybeSingle();
      setCanOwner(canSetOwnerPosition(viewer));
    });
  }, []);

  async function savePosition(next: Position | null) {
    if ((next === "owner" || person?.position === "owner") && !canOwner) {
      setPositionError("Only the owner can give or take the Owner position.");
      return;
    }
    const before = position;
    setPosition(next);
    setPositionError(null);
    const { error: e } = await createClient().from("profiles").update({ position: next }).eq("id", id);
    if (e) {
      setPosition(before);
      setPositionError(`Position not saved: ${e.message}`);
      return;
    }
    // The People list keeps its load for 5 minutes; without this it showed the old position.
    forgetPeople();
  }

  // &advice's card on them — drawn alone (`only`) or portalled into the page's column (`adviceSlot`).
  const card =
    person && recent ? (
      <PersonAdvice name={person.name} advice={recent.advice} owner={person.position === "owner"} onOpen={() => onTab("summary")} />
    ) : null;
  if (only === "advice") return card;
  if (loading) return <Loading label="Loading person" />;
  if (error) return <ErrorState message={error} />;
  if (!person) return <ErrorState message="No such person in the tracker." />;

  const m: PersonModel = {
    id,
    person,
    own,
    ledger,
    upTo,
    slips,
    notes,
    hr,
    recent,
    terms: HOURLY_TERMS[id],
    factors: { levels, state: factorState, set: setFactor },
  };
  // Performance reads hours as their own work; for anyone else it has nothing to say.
  const shown: FinanceTab = tab === "performance" && !own ? "summary" : tab;

  // ── the figures above the tabs ──────────────────────────────────────────
  const slip = latestSlip(slips);
  const paid = monthsOf(ledger, null)
    .filter((x) => x.salary + x.freelance > 0 && `${x.year}-${String(x.month).padStart(2, "0")}` <= upTo)
    .at(-1);
  const hourlySlip = isHourlySlip(slip);
  const p3 = recent?.periods.last3;
  const ret = p3?.eff.summary.returnRatio ?? null;
  const needed = neededReturn(p3?.pay);
  const monthOf = (y: number, mo: number) => `${MONTH_SHORT[mo - 1]} ${y}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>Position</span>
        <select
          value={person.position ?? ""}
          onChange={(e) => savePosition((e.target.value || null) as Position | null)}
          disabled={person.position === "owner" && !canOwner}
          title="Their position — a project manager's or office manager's hours aren't counted as their own work"
          className="rounded-lg bg-surface px-3 py-1.5 text-sm text-foreground shadow-card"
        >
          <option value="">—</option>
          {(Object.keys(POSITION_LABEL) as Position[]).map((p) => (
            <option key={p} value={p} disabled={p === "owner" && !canOwner}>
              {POSITION_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      {positionError && <p className="-mt-2 mb-3 text-sm text-danger">{positionError}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {slip?.salaryRate != null ? (
          <Kpi
            label={hourlySlip ? "Hourly rate (gross)" : "Gross salary"}
            value={hourlySlip ? `₪${formatNum(slip.salaryRate)}/h` : formatILS(Math.round(slip.salaryRate))}
            sub={`${monthOf(slip.year, slip.month)} payslip${slip.salaryQuantity != null && !hourlySlip && slip.salaryQuantity < 1 ? ` · full time, on ${Math.round(slip.salaryQuantity * 100)}%` : ""}`}
          />
        ) : (
          <Kpi
            label={recent?.freelancer ? "Freelance pay" : "Monthly cost"}
            value={paid ? formatILS(Math.round(recent?.freelancer ? paid.freelance : paid.salary + paid.freelance)) : "—"}
            sub={paid ? `${monthOf(paid.year, paid.month)}${recent?.freelancer && paid.hours >= 1 ? ` · ₪${formatNum(paid.freelance / paid.hours)}/h` : ""}` : undefined}
          />
        )}
        <Kpi
          label="Costs the studio"
          value={paid ? formatILS(Math.round(paid.salary + paid.freelance)) : "—"}
          sub={paid ? `${monthOf(paid.year, paid.month)} · ${paid.salary > 0 ? "gross + employer's share" : "freelance payments"}` : undefined}
          info="What finance books for them that month: gross pay plus the employer's pension, severance and National Insurance (or freelance payments)."
        />
        {own ? (
          <Kpi
            label="Return · 3 months"
            value={ret != null ? `${ret.toFixed(1)}×` : "—"}
            sub={ret == null ? undefined : ret < 1 ? "below their pay" : needed != null && ret < needed ? `needs ${needed.toFixed(1)}× to carry its share` : "carries their share"}
            tone={ret == null ? undefined : ret < 1 ? "danger" : needed != null && ret < needed ? "warning" : "success"}
            info="Revenue from their hours ÷ the part of their pay that went to client work. See Performance."
          />
        ) : (
          <Kpi label="In the studio" value={tenure(person.startDate, person.endDate) ?? "—"} sub={person.startDate ? `since ${fmtDate(person.startDate)}` : undefined} />
        )}
        <Kpi
          label="Vacation left"
          value={slip?.vacationBalance != null ? `${formatNum(slip.vacationBalance, 1)} days` : "—"}
          sub={slip?.vacationBalance != null ? `${monthOf(slip.year, slip.month)} payslip` : recent?.freelancer ? "freelance — no balance" : "no payslip yet"}
          tone={slip?.vacationBalance != null && slip.vacationBalance < 0 ? "danger" : undefined}
        />
      </div>

      {shown === "summary" && <OverviewTab m={m} onOpen={onTab} />}
      {shown === "performance" && <PerformanceTab m={m} />}
      {shown === "pay" && <PayTab m={m} />}
      {shown === "history" && <HistoryTab m={m} />}
      {shown === "hr" && <HrTab m={m} />}
      {adviceSlot && card && createPortal(card, adviceSlot)}
    </div>
  );
}
