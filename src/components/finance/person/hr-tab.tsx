"use client";

// HR: who they are (the tracker's HR record), their days off, the talks and
// salary updates on record, and the full HR timeline.

import { ExternalLink } from "lucide-react";
import { Card, SectionTitle } from "@/components/finance/ui";
import { MONTH_SHORT } from "@/lib/finance/finance";
import { formatNum } from "@/lib/finance/format";
import { tenure } from "@/lib/finance/people";
import { TRACKER_URL, fmtDate, latestSlip, type HrNote, type PersonModel } from "./model";

const KIND_LABEL: Record<HrNote["kind"], string> = {
  start: "Started",
  end: "Left",
  raise: "Salary update",
  scope: "Job scope",
  review_3m: "3-month talk",
  review_half: "Half-year talk",
  review_year: "Yearly talk",
  note: "Note",
  comment: "Comment",
};

export function HrTab({ m }: { m: PersonModel }) {
  const { hr, notes } = m;
  const age = hr?.birth_date ? tenure(hr.birth_date, null)?.split("y")[0] : null;
  const address = hr
    ? [
        [hr.street, hr.house_no].filter(Boolean).join(" "),
        hr.floor && `floor ${hr.floor}`,
        hr.apartment && `apt ${hr.apartment}`,
        [hr.city, hr.zip].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const rows: [string, string | null][] = hr
    ? [
        ["ID", hr.national_id],
        ["Birthday", hr.birth_date ? `${fmtDate(hr.birth_date)}${age ? ` · age ${age}` : ""}` : null],
        ["Gender", hr.gender],
        ["Family", hr.marital_status],
        ["Address", address || null],
        ["Phone", hr.phone],
        ["Email", hr.personal_email],
        ["Emergency contact", [hr.emergency_contact_name, hr.emergency_contact_phone].filter(Boolean).join(" · ") || null],
      ]
    : [];
  const slip = latestSlip(m.slips);
  const latest = (kinds: HrNote["kind"][]) =>
    notes
      .filter((n) => n.date && kinds.includes(n.kind))
      .map((n) => n.date!)
      .sort()
      .at(-1) ?? null;
  const lastRaise = latest(["raise"]);
  const lastTalk = latest(["review_3m", "review_half", "review_year"]);
  const since = (iso: string | null) => (iso ? tenure(iso, null) : null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle info="The tracker's HR record — admin-only. Filled in by the employee at onboarding, or carried over from the old Asana HR cards.">
            Details
          </SectionTitle>
          {hr === undefined ? (
            <p className="text-sm text-faint">Loading…</p>
          ) : rows.some(([, v]) => v) ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {rows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="bidi-auto">{v}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <p className="text-sm text-faint">No HR details in the tracker.</p>
          )}
        </Card>

        <Card>
          <SectionTitle info="From their latest payslip. Requests, approvals and days already booked in the weekly plan are in the tracker's Vacation page.">
            Days off
          </SectionTitle>
          {slip?.vacationBalance != null ? (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Vacation left" value={`${formatNum(slip.vacationBalance, 1)} days`} danger={slip.vacationBalance < 0} />
              <Stat label="Sick days left" value={slip.sickBalance != null ? `${formatNum(slip.sickBalance, 1)} days` : "—"} />
              <p className="col-span-2 text-xs text-faint">
                On the {MONTH_SHORT[slip.month - 1]} {slip.year} payslip
              </p>
            </div>
          ) : (
            <p className="text-sm text-faint">No payslip yet.</p>
          )}
          <a
            href={`${TRACKER_URL}/vacation`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs text-brand hover:underline"
          >
            Requests in the tracker <ExternalLink size={11} />
          </a>
        </Card>

        <Card>
          <SectionTitle info="From the HR timeline below.">Talks &amp; salary updates</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Last salary update" value={lastRaise ? fmtDate(lastRaise)! : "None on record"} sub={since(lastRaise) ? `${since(lastRaise)} ago` : undefined} />
            <Stat label="Last review talk" value={lastTalk ? fmtDate(lastTalk)! : "None on record"} sub={since(lastTalk) ? `${since(lastTalk)} ago` : undefined} />
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle
          hint={notes.length ? `${notes.length} entries` : undefined}
          info="Dates, review talks and notes carried over from the studio's old Asana HR cards. Bank details, ID, address and salary amounts were left out."
        >
          HR timeline
        </SectionTitle>
        {notes.length ? (
          <ol className="space-y-3">
            {[...notes]
              .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
              .map((n) => {
                const author = n.kind === "comment" ? n.source.split("|")[1] : null;
                return (
                  <li key={n.id} className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
                    <div className="text-xs text-muted">
                      <div className="font-medium text-foreground">{KIND_LABEL[n.kind]}</div>
                      {n.date ? fmtDate(n.date) : "Undated"}
                    </div>
                    <div className="bidi-auto whitespace-pre-line">
                      {n.body || <span className="text-faint">—</span>}
                      {author && <div className="mt-0.5 text-xs text-faint">{author}</div>}
                    </div>
                  </li>
                );
              })}
          </ol>
        ) : (
          <p className="text-sm text-faint">Nothing on record.</p>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, danger = false }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${danger ? "text-danger" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  );
}
