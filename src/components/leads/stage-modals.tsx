"use client";

// The two stage moves that need more than a drop: losing (why?) and winning
// (into which client?). Shared by the board and the lead page so the two can
// never ask different questions about the same move.

import { useState } from "react";
import { Trophy, XCircle } from "lucide-react";
import { useData } from "@/lib/store";
import { Modal, ModalClose } from "@/components/ui";
import { Button, Field, Select, Textarea } from "@/components/primitives";
import { markWon, moveLead } from "@/lib/leads/actions";
import type { Lead, LeadStage, LostReason } from "@/lib/leads/types";

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
 * "Mark as won" RECORDS THE WIN ONLY (Nitsan, 2026-10-04). The client page is
 * a separate, reviewed step — "Create client page" on the won lead
 * (`/leads/[id]/convert`), where the client, the sections and tasks, contacts
 * and Overview are picked before anything is written.
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
  onDone: () => void;
}) {
  const { currentUserId } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await markWon(lead.id, wonStage, from, currentUserId);
      onDone();
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
        <p className="text-[13px] text-muted">
          This records the win. Next, “Create client page” on the lead lets you pick the client, the tasks, contacts
          and notes to bring, and review them before anything is created.
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy} autoFocus>
            {busy ? "Saving…" : "Mark as won"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
