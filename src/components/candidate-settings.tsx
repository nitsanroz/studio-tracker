"use client";

// Settings → Hiring: the board's columns, the role tags, and the scoring
// vocabulary.
//
// ⚠️ ITS OWN TAB RATHER THAN THREE MORE CARDS UNDER "Studio setup", for the same
// reason the Intake form got one: that tab is about how the studio's own WORK is
// labelled — task types, statuses, occasions — and this is about hiring, which
// two admins touch a few times a year. Folding them together would put a control
// that renames a client-facing task type beside one that retires a question you
// ask a stranger in an interview.

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { loadVocabulary, type Vocabulary } from "@/lib/candidates/data";
import {
  addParam,
  addRole,
  addStage,
  addSubject,
  removeRole,
  removeStage,
  renameParam,
  renameStage,
  reorderStages,
  retireParam,
  retireSubject,
  roleUsage,
  updateRole,
} from "@/lib/candidates/actions";

/** Spread around the wheel so two roles in a filter are tellable apart, and
 *  drawn from the brand family the rest of the app uses. */
const ROLE_COLORS = ["#0b43ed", "#7c3aed", "#0891b2", "#15803d", "#c2410c", "#be123c", "#6b7280"];

const CARD = "rounded-xl border border-border bg-surface p-4 shadow-card";
const HEAD = "text-sm font-semibold";
const NOTE = "mt-1 text-xs leading-relaxed text-muted";
const FIELD =
  "min-h-11 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm sm:min-h-0";

/** A name you can edit in place, committing on blur and on Enter. */
function EditableName({
  value,
  onCommit,
  className = "",
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
}) {
  return (
    <input
      defaultValue={value}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== value) onCommit(v);
        else e.target.value = value;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-border focus:border-border focus:bg-surface focus:outline-none ${className}`}
    />
  );
}

export function CandidateSettings() {
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newStage, setNewStage] = useState("");
  const [newRole, setNewRole] = useState("");
  /** Roles a remove has already been warned about — a ref, so asking again
   *  does not re-render the card and lose the notice that prompted it. */
  const confirmedRemove = useRef<Set<string>>(new Set());
  const [newSubject, setNewSubject] = useState("");
  const [newParam, setNewParam] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const v = await loadVocabulary();
      setVocab(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the hiring settings.");
    }
  }, []);

  // ⚠️ The fetch sits inside the effect and every setState is behind an await —
  // the `react-hooks/set-state-in-effect` rule, and the same shape both
  // candidate pages use.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const v = await loadVocabulary();
        if (alive) setVocab(v);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load the hiring settings.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      setNotice(null);
      try {
        await fn();
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That change could not be saved.");
      }
    },
    [reload],
  );

  if (!vocab) {
    return <p className="text-sm text-muted">{error ?? "Loading…"}</p>;
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {(error || notice) && (
        <div
          className={`lg:col-span-2 rounded-lg px-3 py-2 text-sm ${
            error
              ? "border border-danger/30 bg-danger/5 text-danger"
              : "border border-border bg-background text-muted"
          }`}
        >
          {error ?? notice}
        </div>
      )}

      {/* ── stages ── */}
      <div className={CARD}>
        <h3 className={HEAD}>Board columns</h3>
        <p className={NOTE}>
          The steps a candidate moves through. Drag to reorder.{" "}
          <strong className="font-medium text-foreground">
            On hold and the archive are not here
          </strong>{" "}
          — they are states a candidate is in, not steps they pass through, which is what keeps
          rejected people off the board.
        </p>

        <div className="mt-3 flex flex-col gap-1">
          {vocab.stages.map((s) => (
            <div
              key={s.id}
              draggable
              onDragStart={() => setDragId(s.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId && dragId !== s.id) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!dragId || dragId === s.id) return;
                const ids = vocab.stages.map((x) => x.id).filter((x) => x !== dragId);
                ids.splice(ids.indexOf(s.id), 0, dragId);
                setDragId(null);
                void run(() => reorderStages(ids));
              }}
              className="group flex items-center gap-1 rounded-lg border border-transparent px-1 py-0.5 hover:border-border"
            >
              <GripVertical
                size={14}
                className="shrink-0 cursor-grab text-faint opacity-0 group-hover:opacity-100"
                aria-hidden
              />
              <EditableName
                value={s.name}
                onCommit={(v) => void run(() => renameStage(s.id, v))}
                className="bidi-auto"
              />
              <button
                onClick={() =>
                  void run(async () => {
                    const res = await removeStage(s.id);
                    if (!res.ok) {
                      setNotice(
                        `"${s.name}" still has ${res.occupied} candidate${res.occupied === 1 ? "" : "s"} in it. Move them first — deleting the column would drop them off the board into no column at all.`,
                      );
                    }
                  })
                }
                title={`Remove "${s.name}"`}
                aria-label={`Remove ${s.name}`}
                className="shrink-0 rounded p-1.5 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={14} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = newStage.trim();
            if (!name) return;
            setNewStage("");
            void run(() =>
              addStage(name, Math.max(0, ...vocab.stages.map((s) => s.position)) + 1),
            );
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={newStage}
            onChange={(e) => setNewStage(e.target.value)}
            placeholder="Add a column — e.g. Negotiation"
            className={FIELD}
          />
          <button
            type="submit"
            disabled={!newStage.trim()}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-brand px-3 text-[13px] font-medium text-white disabled:opacity-40"
          >
            <Plus size={15} strokeWidth={2} /> Add
          </button>
        </form>
      </div>

      {/* ── roles ── */}
      <div className={CARD}>
        <h3 className={HEAD}>Roles</h3>
        <p className={NOTE}>
          The tag on a candidate, and the filter chips above the board. One pool of people with a
          role each, rather than a separate board per opening — so a good CV from two years ago
          stays findable when a similar role opens.
        </p>
        <div className="mt-3 flex flex-col gap-1">
          {vocab.roles.map((r) => (
            <div
              key={r.id}
              className="group flex items-center gap-1 rounded-lg border border-transparent px-1 py-0.5 hover:border-border"
            >
              {/* A native colour input: one control, no popover to position, and
                  the OS picker is better than anything worth hand-rolling for a
                  swatch somebody sets once. */}
              <input
                type="color"
                value={r.color}
                onChange={(e) => void run(() => updateRole(r.id, { color: e.target.value }))}
                aria-label={`Colour for ${r.name}`}
                title={`Colour for ${r.name}`}
                className="size-5 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border [&::-webkit-color-swatch]:border-border"
              />
              <EditableName
                value={r.name}
                onCommit={(v) => void run(() => updateRole(r.id, { name: v }))}
                className="bidi-auto"
              />
              <button
                onClick={() =>
                  void run(async () => {
                    const used = await roleUsage(r.id);
                    if (used > 0 && !confirmedRemove.current.has(r.id)) {
                      confirmedRemove.current.add(r.id);
                      setNotice(
                        used === 1
                          ? `1 candidate carries "${r.name}". Removing it untags them — it deletes nobody. Press remove again to go ahead.`
                          : `${used} candidates carry "${r.name}". Removing it untags them — it deletes nobody. Press remove again to go ahead.`,
                      );
                      return;
                    }
                    confirmedRemove.current.delete(r.id);
                    await removeRole(r.id);
                  })
                }
                title={`Remove "${r.name}"`}
                aria-label={`Remove ${r.name}`}
                className="shrink-0 rounded p-1.5 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={14} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = newRole.trim();
            if (!name) return;
            setNewRole("");
            void run(() =>
              addRole(
                name,
                // Next colour off the palette, so two roles added in a row are
                // never the same swatch.
                ROLE_COLORS[vocab.roles.length % ROLE_COLORS.length],
                Math.max(0, ...vocab.roles.map((r) => r.position)) + 1,
              ),
            );
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="Add a role"
            className={FIELD}
          />
          <button
            type="submit"
            disabled={!newRole.trim()}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-brand px-3 text-[13px] font-medium text-white disabled:opacity-40"
          >
            <Plus size={15} strokeWidth={2} /> Add
          </button>
        </form>

        <p className="mt-3 text-xs text-faint">
          A candidate does not need one. Removing a role untags whoever had it and deletes nobody —
          unlike a board column, which people would fall off.
        </p>
      </div>

      {/* ── scoring ── */}
      <div className={`${CARD} lg:col-span-2`}>
        <h3 className={HEAD}>Interview scoring</h3>
        <p className={NOTE}>
          Each subject is a COLUMN on a scorecard and holds 3&ndash;8 parameters, scored 1&ndash;10.
          Every interview gets its own card, so Michal&rsquo;s reading and yours sit side by side
          instead of overwriting each other.
        </p>

        <div className="mt-4 grid items-start gap-5 md:grid-cols-2 lg:grid-cols-3">
          {vocab.subjects.map((s) => (
            <div key={s.id} className={s.active ? "" : "opacity-50"}>
              <div className="mb-2 flex items-center gap-1 border-b border-border pb-1.5">
                <span className="text-[10.5px] font-medium uppercase tracking-wider text-faint">
                  {s.name}
                </span>
                <span className="text-[10.5px] text-faint">
                  {s.params.filter((p) => p.active).length}
                </span>
                <button
                  onClick={() => void run(() => retireSubject(s.id, !s.active))}
                  className="ml-auto rounded p-1 text-faint hover:text-foreground"
                  title={
                    s.active
                      ? "Retire this subject — historical scores keep showing"
                      : "Use this subject again"
                  }
                  aria-label={s.active ? `Retire ${s.name}` : `Restore ${s.name}`}
                >
                  {s.active ? <X size={13} /> : <RotateCcw size={13} />}
                </button>
              </div>

              {s.params.map((p) => (
                <div
                  key={p.id}
                  className={`group flex items-center gap-1 ${p.active ? "" : "opacity-45"}`}
                >
                  <EditableName
                    value={p.name}
                    onCommit={(v) => void run(() => renameParam(p.id, v))}
                  />
                  <button
                    onClick={() => void run(() => retireParam(p.id, !p.active))}
                    className="shrink-0 rounded p-1 text-faint opacity-0 hover:text-foreground group-hover:opacity-100"
                    title={
                      p.active
                        ? "Remove from new scorecards — every score already given still shows"
                        : "Ask this again"
                    }
                    aria-label={p.active ? `Remove ${p.name}` : `Restore ${p.name}`}
                  >
                    {p.active ? <X size={13} /> : <RotateCcw size={13} />}
                  </button>
                </div>
              ))}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = (newParam[s.id] ?? "").trim();
                  if (!name) return;
                  setNewParam((prev) => ({ ...prev, [s.id]: "" }));
                  void run(() =>
                    addParam(s.id, name, Math.max(0, ...s.params.map((p) => p.position)) + 1),
                  );
                }}
                className="mt-2"
              >
                <input
                  value={newParam[s.id] ?? ""}
                  onChange={(e) => setNewParam((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  placeholder={
                    s.params.filter((p) => p.active).length >= 8
                      ? "8 is the layout's limit"
                      : "Add a parameter"
                  }
                  disabled={s.params.filter((p) => p.active).length >= 8}
                  className="w-full rounded border border-transparent px-1.5 py-1 text-[12.5px] text-muted hover:border-border focus:border-border focus:bg-surface focus:outline-none disabled:opacity-50"
                />
              </form>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = newSubject.trim();
            if (!name) return;
            setNewSubject("");
            void run(() =>
              addSubject(name, Math.max(0, ...vocab.subjects.map((s) => s.position)) + 1),
            );
          }}
          className="mt-5 flex max-w-md gap-2 border-t border-border pt-4"
        >
          <input
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            placeholder="Add a subject — e.g. Culture"
            className={FIELD}
          />
          <button
            type="submit"
            disabled={!newSubject.trim()}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-brand px-3 text-[13px] font-medium text-white disabled:opacity-40"
          >
            <Plus size={15} strokeWidth={2} /> Add
          </button>
        </form>

        {/* ⚠️ Stated out loud because "remove" reads as "delete" and here it is
            deliberately not: a hard delete would cascade to candidate_scores and
            rewrite what somebody actually thought of a candidate in 2024. */}
        <p className="mt-3 text-xs text-faint">
          Removing a subject or a parameter stops it being offered on new scorecards. Scores already
          given keep showing on the interviews that recorded them — nothing you have written about a
          candidate is ever rewritten by a change here.
        </p>
      </div>
    </div>
  );
}
