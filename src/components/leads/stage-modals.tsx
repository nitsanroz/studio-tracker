"use client";

// The two stage moves that need more than a drop: losing (why?) and winning
// (into which client?). Shared by the board and the lead page so the two can
// never ask different questions about the same move.

import { useEffect, useMemo, useState } from "react";
import { Trophy, XCircle } from "lucide-react";
import { useData } from "@/lib/store";
import { Modal, ModalClose } from "@/components/ui";
import { Button, Field, Input, Select, Textarea } from "@/components/primitives";
import { CLIENT_COLORS } from "@/components/client-mark-picker";
import { markWon, moveLead } from "@/lib/leads/actions";
import type { Lead, LeadStage, LostReason } from "@/lib/leads/types";
import { estimateToWork, latestApproved, type EstimateSummary } from "@/lib/leads/estimates-data";
import { fmtHours } from "@/lib/leads/estimate";

export function LostModal({
  lead,
  from,
  to,
  reasons,
  onClose,
  onDone,
}: {
  lead: Lead;
  from: LeadStage | null;
  to: LeadStage;
  reasons: LostReason[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { currentUserId } = useData();
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await moveLead(lead.id, from, to, currentUserId, {
        reasonId: reasonId || null,
        reasonName: reasons.find((r) => r.id === reasonId)?.name ?? null,
        note: note.trim() || null,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move the lead.");
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} width="sm" labelledBy="lost-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-center gap-2">
          <XCircle size={18} strokeWidth={1.75} className="text-danger" />
          <h3 id="lost-title" className="bidi-auto min-w-0 flex-1 truncate text-sm font-medium">
            {lead.company} — lost
          </h3>
          <ModalClose onClose={onClose} />
        </div>
        <Field label="Why">
          <Select value={reasonId} onChange={(e) => setReasonId(e.target.value)} autoFocus>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="">Other / not recorded</option>
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="bidi-auto" />
        </Field>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy ? "Saving…" : `Move to ${to.name}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * "Mark as won" — the lead becomes work in the tracker.
 *
 * ⚠️ A NEW COMPANY GETS A NEW CLIENT; A RETURNING ONE GETS A NEW SECTION under
 * the client it already is (Nitsan, 2026-10-02). The modal guesses which from
 * the lead — "Past client" as the source, or a client whose name matches the
 * company — and lets you change it.
 *
 * ⚠️ THE NEW CLIENT IS MADE THROUGH THE STORE'S `addClient`, the same call the
 * Clients page uses, so it gets its Keys task and lands in everybody's client
 * list straight away. Everything after that is `markWon`.
 */
export function WinModal({
  lead,
  from,
  wonStage,
  onClose,
  onDone,
}: {
  lead: Lead;
  from: LeadStage | null;
  wonStage: LeadStage;
  onClose: () => void;
  onDone: (clientId: string) => void;
}) {
  const { clients, addClient, refresh, currentUserId } = useData();
  const live = useMemo(
    () => clients.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );
  const match = useMemo(() => {
    const company = lead.company.trim().toLowerCase();
    return live.find((c) => c.name.trim().toLowerCase() === company) ?? null;
  }, [live, lead.company]);

  const [mode, setMode] = useState<"new" | "existing">(
    match || lead.source === "past_client" ? "existing" : "new",
  );
  const [name, setName] = useState(lead.company);
  const [color, setColor] = useState(CLIENT_COLORS[1]);
  const [clientId, setClientId] = useState(match?.id ?? "");
  const [section, setSection] = useState((lead.askedFor ?? "").split("\n")[0].slice(0, 80));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The approved estimate this deal was sold on, if there is one (Phase 4). */
  const [estimate, setEstimate] = useState<EstimateSummary | null>(null);
  const [fromEstimate, setFromEstimate] = useState(true);
  useEffect(() => {
    let alive = true;
    void latestApproved(lead.id)
      .then((e) => alive && setEstimate(e))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lead.id]);
  const useEstimate = Boolean(estimate) && fromEstimate;

  const canSubmit =
    !busy &&
    (mode === "new" ? name.trim().length > 0 : Boolean(clientId) && (useEstimate || section.trim().length > 0));

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      let target: { id: string; name: string; created: boolean; billable: boolean };
      if (mode === "new") {
        const c = await addClient(name.trim(), color);
        if (!c) throw new Error("The client could not be created.");
        target = { id: c.id, name: c.name, created: true, billable: c.billable };
      } else {
        const c = live.find((x) => x.id === clientId);
        if (!c) throw new Error("Pick the client.");
        target = { id: c.id, name: c.name, created: false, billable: c.billable };
      }
      await markWon(
        lead.id,
        wonStage,
        from,
        {
          clientId: target.id,
          clientName: target.name,
          // With an estimate, its phases become the sections instead.
          sectionName: useEstimate ? null : section.trim() || null,
          created: target.created,
        },
        currentUserId,
      );
      if (useEstimate && estimate) await estimateToWork(estimate.id, target.id, target.billable);
      // The section was written outside the store; pull it in now rather than
      // leave the client page missing it until the next timed refresh.
      refresh();
      onDone(target.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark the lead as won.");
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} width="md" labelledBy="won-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-center gap-2">
          <Trophy size={18} strokeWidth={1.75} className="text-brand" />
          <h3 id="won-title" className="bidi-auto min-w-0 flex-1 truncate text-sm font-medium">
            {lead.company} — won
          </h3>
          <ModalClose onClose={onClose} />
        </div>

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
              onClick={() => setMode(k)}
              aria-pressed={mode === k}
              className={`flex-1 px-3 py-1.5 ${mode === k ? "bg-brand font-medium text-white" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "new" ? (
          <>
            <Field label="Client name">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="bidi-auto" />
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
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)} autoFocus>
              <option value="">Pick a client…</option>
              {live.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {estimate && (
          <label className="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={fromEstimate}
              onChange={(e) => setFromEstimate(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Create the work from <b>estimate v{estimate.version}</b> ({fmtHours(estimate.hours)}): each phase
              becomes a section, each line a task budgeted at the top of its range.
            </span>
          </label>
        )}

        {!useEstimate && (
        <Field
          label={mode === "new" ? "First section (optional)" : "New section"}
          hint={
            mode === "new"
              ? "The client gets its Keys task either way. Name a section to start the work under."
              : "The work lands as a new section under this client."
          }
        >
          <Input value={section} onChange={(e) => setSection(e.target.value)} className="bidi-auto" />
        </Field>
        )}

        <p className="text-[12px] text-muted">
          The lead&rsquo;s contacts are copied to the client, where the team can see them.
        </p>

        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {busy ? "Saving…" : "Mark as won"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
