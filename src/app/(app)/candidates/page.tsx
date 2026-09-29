"use client";

// The board — where hiring starts.
//
// ⚠️ ADMIN-ONLY, AND THE GATE IS THE DATABASE, NOT THIS FILE. Every table
// behind this page carries `admin all` and nothing else (0039), so a designer
// reaching this URL gets empty arrays rather than other people's phone numbers.
// The check below is UX: it says why the page is blank instead of showing a
// board with nothing on it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, PauseCircle, Plus, Search, X } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { useIsNarrow } from "@/lib/use-is-narrow";
import type { Profile } from "@/lib/types";
import { Avatar } from "@/components/ui";
import { loadBoard, loadVocabulary, type BoardCounts, type Vocabulary } from "@/lib/candidates/data";
import { createCandidate, moveToStage } from "@/lib/candidates/actions";
import {
  formatScore,
  NEW_CANDIDATE_NAME,
  NEW_CANDIDATE_PARAM,
  scoreTone,
  type Candidate,
  type CandidateStatus,
} from "@/lib/candidates/types";

const TONE: Record<string, string> = {
  high: "bg-[#eaf6ee] text-[#12693d]",
  mid: "bg-[#fdf3e3] text-[#8a5a09]",
  low: "bg-[#fdecec] text-danger",
  none: "bg-background text-faint font-normal",
};

/**
 * Column headings are set in Latin small-caps style — `uppercase` plus
 * letter-spacing — and ⚠️ BOTH ARE WRONG FOR HEBREW. Hebrew has no case, so
 * `uppercase` silently does nothing, while `tracking-wide` pulls apart letters
 * that are meant to sit tight; among four uppercased Latin headings the Hebrew
 * one then reads as a different kind of label rather than the same kind in
 * another script. The studio's own stage "התנסות בסטודיו" is exactly this case.
 */
const HAS_HEBREW = /[\u0590-\u05FF]/;
const headingClass = (label: string) =>
  HAS_HEBREW.test(label)
    ? "text-[12px] font-medium text-muted"
    : "text-[12px] font-medium uppercase tracking-wide text-muted";

type SortKey = "activity" | "name" | "score" | "stage";

/** Which way each column reads. Fixed per column — the questions these answer
 *  only have one useful direction ("who scored best", "who has gone quiet"). */
const SORT_DIR: Record<SortKey, "asc" | "desc"> = {
  activity: "desc",
  name: "asc",
  score: "desc",
  stage: "asc",
};

const LAYOUT_KEY = "candidates.layout";

/**
 * How he likes looking at the LIVE board, or "board" if nothing is stored.
 *
 * ⚠️ ONE READER, because there are two callers — the mount restore and the
 * return from Archive — and they were separate copies with the fallback
 * spelled out twice. Change the key or add a third layout, update one of them,
 * and coming back from the archive quietly discards a saved preference that a
 * fresh page load still honours.
 *
 * ⚠️ NEVER CALL THIS DURING RENDER: localStorage does not exist on the
 * server, and reading it while rendering is what produces a hydration
 * mismatch. An effect or an event handler only.
 */
function storedLayout(): "board" | "list" {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === "list" || v === "board") return v;
  } catch {
    // A private window or blocked site data. The default is fine.
  }
  return "board";
}

/**
 * ⚠️ THE WRITER LIVES BESIDE THE READER, and only the LIVE board's choice is
 * ever written. Picking list while reading the archive is about the archive;
 * storing it would quietly change how the board opens tomorrow — which is the
 * same argument the reader makes, and the reason both halves belong together.
 * Split across the file, a change to the key or the value set fixes one and
 * silently strands the other.
 */
function storeLayout(next: "board" | "list", view: CandidateStatus): void {
  if (view !== "active") return;
  try {
    localStorage.setItem(LAYOUT_KEY, next);
  } catch {
    // Not worth telling anybody about; the choice just won't stick.
  }
}

/** How long ago, in the shorthand the board reads in. */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo` : `${Math.round(days / 365)}y`;
}

function ScorePill({ value }: { value: number | null }) {
  const tone = scoreTone(value);
  return (
    <span
      /* ⚠️ DOUBLE SIZE ON A PHONE, and it has to move with the name — Nitsan,
         2026-09-29, asked for both at 200%. They are the two things you scan a
         list of candidates by, and at 11.5px beside a 15px name they read as
         footnotes on a screen you hold at arm's length. Above `md` the card is
         a 224px board column where those sizes are already right. */
      className={`inline-flex h-10 shrink-0 items-center rounded-md px-1.5 text-[23px] font-semibold md:h-5 md:text-[11.5px] ${TONE[tone]}`}
      title={value === null ? "Not scored yet" : `Average of every score so far`}
    >
      {formatScore(value)}
    </span>
  );
}

function CandidateCard({
  c,
  roleName,
  roleColor,
  ownerName,
  ownerPhoto,
  stageName,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  c: Candidate;
  roleName: string | null;
  roleColor: string;
  ownerName: string | null;
  ownerPhoto: Profile | null;
  /**
   * ⚠️ ONLY THE PHONE LIST PASSES THIS. On the board the column heading IS the
   * stage, so printing it on every card would repeat the heading twenty times
   * down a column; in a flat list there is no heading and it is the one thing
   * missing from the card.
   */
  stageName?: string | null;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <Link
      href={`/candidates/${c.id}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="group flex flex-col gap-2 rounded-lg border border-border bg-surface p-2.5 shadow-[0_1px_2px_rgba(6,17,47,.04)] transition-colors hover:border-brand"
    >
      {/* ⚠️ NO DRAG HANDLE, DELIBERATELY. The card is still draggable — the whole
          card always was, the grip was only an affordance — but a 14px icon plus
          its gap indented every name by 22px to explain a gesture nobody needs
          telling about on a board. The names line up now. */}
      <div className="flex items-start gap-2">
        <span className="bidi-auto min-w-0 flex-1 text-[30px] font-medium leading-tight md:text-[15px]">
          {c.name}
        </span>
        <ScorePill value={c.avgScore} />
      </div>

      {/* ⚠️ ROLE LEFT, STAGE RIGHT, ONE LINE, ONE HEIGHT — Nitsan, 2026-09-29.
          The stage still reads as sitting under the grade because it is
          right-aligned to the same edge; what changed is that the role came up
          to join it instead of holding a line of its own. They are the two
          TAGS on the card, so they are set as a matched pair — the role used to
          be a bare dot and a word, which beside a bordered chip read as a
          different kind of thing rather than the same kind. */}
      {(roleName || stageName) && (
        <div className="flex items-center gap-2">
          {roleName && (
            <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: roleColor }}
                aria-hidden
              />
              <span className="truncate">{roleName}</span>
            </span>
          )}
          {stageName && (
            <span className="bidi-auto ml-auto shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
              {stageName}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[11px] text-faint">
        {ownerPhoto ? (
          <>
            <Avatar profile={ownerPhoto} size={18} />
            <span className="truncate">{ownerName}</span>
          </>
        ) : (
          <span>Unassigned</span>
        )}
        <span className="ml-auto shrink-0">{ago(c.lastActivityAt)}</span>
      </div>
    </Link>
  );
}

export default function CandidatesPage() {
  const isAdmin = useIsAdmin();
  const { profiles, currentUserId } = useData();
  const router = useRouter();

  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [rows, setRows] = useState<Candidate[]>([]);
  const [counts, setCounts] = useState<BoardCounts>({ active: 0, onHold: 0, archived: 0 });
  const [view, setView] = useState<CandidateStatus>("active");
  /**
   * Board or list, remembered per browser.
   *
   * ⚠️ localStorage, not a column on `profiles`. It is a per-viewer UI
   * preference — the convention this app set in v1.1.0 — and 0021's trigger
   * lets a member write only name/avatar/photo anyway, so a stored layout
   * would need either an amended trigger or a service-role route to save
   * which way somebody likes looking at a board.
   */
  const [layout, setLayout] = useState<"board" | "list">("board");
  /**
   * ⚠️ A PHONE IS ALWAYS THE LIST, AND IT MUST NOT WRITE THE STORED KEY.
   * The board is columns of cards side by side with dragging between them —
   * neither of which a 375px screen can offer — so `effectiveLayout` overrides
   * the preference for the render WITHOUT touching it, exactly as the archive
   * and on-hold views do (v1.52.1). Someone who likes the board on their laptop
   * still gets it there after looking something up on their phone.
   */
  const isNarrow = useIsNarrow();
  const effectiveLayout = isNarrow ? "list" : layout;
  const [sort, setSort] = useState<SortKey>("activity");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // ⚠️ The dragged id is a REF, not state. The element deciding whether to
  // accept a drop is a different component from the one being dragged, and
  // `dataTransfer.getData()` is unreadable during `dragover` — the same reason
  // `client-view/shared.ts` keeps its `drag` object at module scope.
  const dragged = useRef<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);

  /**
   * ⚠️ THE FETCH LIVES INSIDE THE EFFECT, AND EVERY setState SITS BEHIND AN
   * `await`. Calling one synchronously on the way in is what
   * `react-hooks/set-state-in-effect` is warning about, and the codebase has
   * been here before (v1.42.0 factored the CSP viewer's fetch out for exactly
   * this). `alive` is the other half: switching view twice quickly must not let
   * the first response land after the second and repaint the old list.
   */
  /**
   * Read in an effect, never during render: localStorage is unavailable on the
   * server, and reading it while rendering is what produces a hydration
   * mismatch. Lazy `useState` initialisation has the same fault.
   *
   * ⚠️ This costs ONE `react-hooks/set-state-in-effect` warning, and it is the
   * same advisory shape `useColWidths` (resizable.tsx) and the Settings tab
   * restore already carry — the rule objects to a synchronous setState on the
   * way into an effect, which is unavoidable when the value comes from
   * localStorage. Traced rather than banked: 36 → 37.
   */
  useEffect(() => {
    setLayout(storedLayout());
  }, []);

  /**
   * ⚠⚠ THE VOCABULARY IS FETCHED ONCE PER VISIT, NOT ONCE PER VIEW. It used
   * to share the board's effect, which is keyed on `view` — so every
   * Active ↔ On hold ↔ Archive click re-read stages, roles, subjects AND
   * parameters, four selects that cannot vary by view, for five round trips
   * where one was needed.
   *
   * ⚠️ EGRESS IS THIS PROJECT'S TIGHTEST CONSTRAINT (CLAUDE.md: 200% of the
   * allowance and a hard 402 that took the client report links down). Toggling
   * a filter is a thing somebody does idly, a dozen times in a sitting, which
   * makes "small and per-click" exactly the shape that got us there.
   */
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      try {
        const v = await loadVocabulary();
        if (!alive) return;
        setVocab(v);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Could not load the board.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      try {
        const b = await loadBoard(view);
        if (!alive) return;
        setRows(b.candidates);
        setCounts(b.counts);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Could not load the board.");
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin, view]);

  const roleById = useMemo(
    () => new Map((vocab?.roles ?? []).map((r) => [r.id, r])),
    [vocab],
  );
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const stageById = useMemo(
    () => new Map((vocab?.stages ?? []).map((s) => [s.id, s])),
    [vocab],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((c) => {
      if (roleFilter === "none") {
        if (c.roleId) return false;
      } else if (roleFilter && c.roleId !== roleFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.source ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, roleFilter, query]);

  /**
   * ⚠️ SORTING PUTS UNSCORED PEOPLE LAST WHATEVER THE DIRECTION, rather than
   * treating a missing score as 0. Somebody nobody has written up yet is not
   * the studio's worst candidate, and a list that says so is a list that gets
   * read the wrong way round.
   */
  const sorted = useMemo(() => {
    const stagePos = new Map((vocab?.stages ?? []).map((s) => [s.id, s.position]));
    return [...visible].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "score") {
        if (a.avgScore === null && b.avgScore === null) return 0;
        if (a.avgScore === null) return 1;
        if (b.avgScore === null) return -1;
        return b.avgScore - a.avgScore;
      }
      if (sort === "stage") {
        const pa = a.stageId ? (stagePos.get(a.stageId) ?? 99) : 99;
        const pb = b.stageId ? (stagePos.get(b.stageId) ?? 99) : 99;
        return pa - pb || a.name.localeCompare(b.name);
      }
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    });
  }, [visible, sort, vocab]);

  const byStage = useMemo(() => {
    const m = new Map<string, Candidate[]>();
    for (const c of visible) {
      const key = c.stageId ?? "";
      const list = m.get(key) ?? [];
      list.push(c);
      m.set(key, list);
    }
    return m;
  }, [visible]);

  const drop = useCallback(
    async (stageId: string, stageName: string) => {
      const id = dragged.current;
      dragged.current = null;
      setDropStage(null);
      if (!id) return;
      const row = rows.find((c) => c.id === id);
      if (!row || row.stageId === stageId) return;
      // Optimistic: the card jumps columns now, and a failure puts it back.
      setRows((prev) => prev.map((c) => (c.id === id ? { ...c, stageId } : c)));
      try {
        await moveToStage(id, stageId, stageName, currentUserId);
      } catch (e) {
        setRows((prev) => prev.map((c) => (c.id === id ? { ...c, stageId: row.stageId } : c)));
        setError(e instanceof Error ? e.message : "Could not move the candidate.");
      }
    },
    [rows, currentUserId],
  );

  /**
   * ⚠️ ARCHIVE AND ON HOLD OPEN AS A LIST — Nitsan, 2026-09-28. The board is
   * for candidates still moving through it; the archive is 270 people and a
   * grid of 270 cards is a wall, not a view. The list shows stage, owner,
   * score and last activity in one line each and can be sorted, which is what
   * you actually want when you are looking somebody up months later.
   *
   * ⚠️ IT ONLY SETS THE LAYOUT, NEVER STORES IT — see `storeLayout`. Coming
   * back to Active restores whatever is saved, so the override lasts exactly as
   * long as the detour does.
   */
  const switchView = (next: CandidateStatus) => {
    setView(next);
    setLayout(next === "active" ? storedLayout() : "list");
  };

  /**
   * ⚠️ STRAIGHT TO THEIR PAGE, NOT INTO A DIALOG — Nitsan offered either and
   * left the choice to me. The dossier ALREADY holds every field a new
   * candidate needs: phone, mail, role, where they came from, links, the CV,
   * the application text. A popup would be a second, smaller copy of it that
   * still dumps you on the page afterwards, and two places to type the same
   * facts is how the two drift apart.
   *
   * ⚠️ THE ROW IS CREATED FIRST AND NAMED "New candidate". Everything on that
   * page saves against an id, so there has to be a row before there is a page.
   * The cost is honest: abandon it and a card called "New candidate" is sitting
   * on the board where you can see it and delete it — not a silent empty row.
   */
  const addCandidate = useCallback(async () => {
    if (!vocab || adding) return;
    setAdding(true);
    try {
      const id = await createCandidate(
        { name: NEW_CANDIDATE_NAME, stageId: vocab.stages[0]?.id ?? null },
        currentUserId,
      );
      // The flag is what tells their page to put the cursor in the name field.
      router.push(`/candidates/${id}?${NEW_CANDIDATE_PARAM}=1`);
    } catch (e) {
      setAdding(false);
      setError(e instanceof Error ? e.message : "Could not add the candidate.");
    }
  }, [vocab, adding, currentUserId, router]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="font-serif-accent text-2xl">Candidates</h1>
        <p className="mt-3 text-sm text-muted">
          Hiring is admin-only — it holds applicants&rsquo; contact details and the studio&rsquo;s
          notes about them.
        </p>
      </div>
    );
  }

  const stages = vocab?.stages ?? [];

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-serif-accent text-2xl">Candidates</h1>
          <p className="mt-0.5 text-sm text-muted">
            {counts.active} in play
            {counts.onHold > 0 && ` · ${counts.onHold} on hold`}
          </p>
        </div>

        {/* ⚠️ TWO GROUPS BELOW `md`, ONE FLAT ROW ABOVE IT. The wrappers carry
            `md:contents`, so from md up they leave the layout entirely and the
            original single wrapping row is byte-identical — the same trick
            `MyWeek` and the plan's entry modal use. At 375px a single
            `flex-wrap` row put the search between two chips and stranded the
            divider on a line of its own. */}
        <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">
          <div className="flex w-full gap-2 overflow-x-auto md:contents">
          {/* ⚠️ ONE DROPDOWN, NOT A ROW OF CHIPS. A role here is a TAG — the
              studio hires designers and rarely two kinds at once — so five
              chips permanently across the top spent the loudest row on the page
              on a control almost nobody touches.

              ⚠️ IT IS AN OUTLINE CHIP AT REST — Nitsan, 2026-09-28. It used to
              be borderless until you hovered it, which made it the only control
              in a row of chips with no edge of its own: next to "On hold" and
              "Archive" it read as a stray word rather than something you could
              press. Same shape and resting colours as those two now; the brand
              tint still means it is ACTUALLY hiding somebody, because a filter
              you cannot see is how a board comes to look emptier than it is. */}
          <select
            value={roleFilter ?? "all"}
            onChange={(e) => setRoleFilter(e.target.value === "all" ? null : e.target.value)}
            aria-label="Filter by role"
            className={`h-11 shrink-0 cursor-pointer rounded-full border px-2 text-[11.5px] md:h-7 ${
              roleFilter === null
                ? "border-border bg-surface text-muted"
                : "border-[#c9d6fb] bg-brand-soft font-medium text-brand-dark"
            }`}
          >
            <option value="all">All roles</option>
            {/* Plenty of candidates never get a role, so "no role" has to be
                reachable — otherwise they are the one group the filter cannot
                find. */}
            <option value="none">No role</option>
            {(vocab?.roles ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          {/* ⚠️ On hold and Archive are STATUS views, not columns. On the Asana
              board "To Reject" was a column holding 140 of 271 cards — the
              widest thing on screen was the one nobody wanted to read. */}
          <button
            onClick={() => switchView(view === "on_hold" ? "active" : "on_hold")}
            aria-pressed={view === "on_hold"}
            className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] md:h-7 ${
              view === "on_hold"
                ? "border-[#c9d6fb] bg-brand-soft font-medium text-brand-dark"
                : "border-border bg-surface text-muted"
            }`}
          >
            <PauseCircle size={13} strokeWidth={1.75} /> On hold · {counts.onHold}
          </button>
          <button
            onClick={() => switchView(view === "archived" ? "active" : "archived")}
            aria-pressed={view === "archived"}
            className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] md:h-7 ${
              view === "archived"
                ? "border-[#c9d6fb] bg-brand-soft font-medium text-brand-dark"
                : "border-border bg-surface text-muted"
            }`}
          >
            <Archive size={13} strokeWidth={1.75} /> Archive · {counts.archived}
          </button>

          </div>

          <span className="mx-1 hidden h-5 w-px bg-border md:block" aria-hidden />

          <div className="flex w-full gap-2 md:contents">
          <label className="flex h-11 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 md:h-8 md:flex-none">
            <Search size={15} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, email, source"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint md:w-40"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear the search">
                <X size={13} className="text-faint" />
              </button>
            )}
          </label>

          {/* ⚠️ Hidden on a phone rather than disabled: offering "Board" and
              then refusing it is worse than not offering it, and the list is
              not a fallback here — it is the phone's real shape. */}
          <div className="hidden overflow-hidden rounded-lg border border-border bg-surface text-[12.5px] md:flex">
            {(["board", "list"] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setLayout(k);
                  storeLayout(k, view);
                }}
                aria-pressed={layout === k}
                className={`px-3 py-1.5 capitalize ${
                  layout === k ? "bg-brand font-medium text-white" : "text-muted"
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          <button
            onClick={() => void addCandidate()}
            disabled={adding || !vocab}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white disabled:opacity-50 md:h-8"
          >
            <Plus size={16} strokeWidth={2} />{" "}
            <span className="md:hidden">{adding ? "Adding…" : "Add"}</span>
            <span className="hidden md:inline">{adding ? "Adding…" : "Add candidate"}</span>
          </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {busy && <p className="mt-8 text-sm text-muted">Loading…</p>}

      {!busy && view !== "active" && effectiveLayout === "board" && (
        <div className="mt-5">
          <p className="mb-3 text-sm text-muted">
            {view === "archived"
              ? "Decided and off the board. Still searchable — that is what the archive is for."
              : "Parked: good, wrong moment. Move one back to a stage to put them in play again."}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visible.map((c) => (
              <CandidateCard
                key={c.id}
                c={c}
                roleName={c.roleId ? (roleById.get(c.roleId)?.name ?? null) : null}
                roleColor={c.roleId ? (roleById.get(c.roleId)?.color ?? "#6b7280") : "#6b7280"}
                ownerName={c.ownerId ? (profileById.get(c.ownerId)?.name ?? null) : null}
                ownerPhoto={c.ownerId ? (profileById.get(c.ownerId) ?? null) : null}
                draggable={false}
                onDragStart={() => {}}
                onDragEnd={() => {}}
              />
            ))}
            {visible.length === 0 && (
              <p className="text-sm text-faint">Nobody here.</p>
            )}
          </div>
        </div>
      )}

      {!busy && view === "active" && effectiveLayout === "board" && (
        <div className="mt-5 flex items-start gap-3 overflow-x-auto pb-4">
          {stages.map((s) => {
            const list = byStage.get(s.id) ?? [];
            return (
              <div key={s.id} className="w-56 shrink-0">
                <div className="flex items-center gap-1.5 px-1 pb-2">
                  <span className={`bidi-auto ${headingClass(s.name)}`}>{s.name}</span>
                  <span className="text-[11px] text-faint">{list.length}</span>
                </div>
                <div
                  onDragOver={(e) => {
                    if (!dragged.current) return;
                    e.preventDefault();
                    setDropStage(s.id);
                  }}
                  onDragLeave={() => setDropStage((p) => (p === s.id ? null : p))}
                  onDrop={(e) => {
                    e.preventDefault();
                    void drop(s.id, s.name);
                  }}
                  className={`flex min-h-32 flex-col gap-2 rounded-xl p-2 transition-colors ${
                    dropStage === s.id
                      ? "bg-brand-soft outline outline-1 outline-brand"
                      : "bg-foreground/[0.035]"
                  }`}
                >
                  {list.map((c) => (
                    <CandidateCard
                      key={c.id}
                      c={c}
                      roleName={c.roleId ? (roleById.get(c.roleId)?.name ?? null) : null}
                      roleColor={c.roleId ? (roleById.get(c.roleId)?.color ?? "#6b7280") : "#6b7280"}
                      ownerName={c.ownerId ? (profileById.get(c.ownerId)?.name ?? null) : null}
                      ownerPhoto={c.ownerId ? (profileById.get(c.ownerId) ?? null) : null}
                      draggable
                      onDragStart={() => {
                        dragged.current = c.id;
                      }}
                      onDragEnd={() => {
                        dragged.current = null;
                        setDropStage(null);
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Candidates whose stage was cleared — a stage removed underneath
              them, or an import that could not place one. They would otherwise
              be invisible on the board while still counting as active. */}
          {(byStage.get("") ?? []).length > 0 && (
            <div className="w-56 shrink-0">
              <div className="flex items-center gap-1.5 px-1 pb-2">
                <span className="text-[12px] font-medium uppercase tracking-wide text-warning">
                  No stage
                </span>
                <span className="text-[11px] text-faint">{(byStage.get("") ?? []).length}</span>
              </div>
              <div className="flex min-h-32 flex-col gap-2 rounded-xl bg-warning/10 p-2">
                {(byStage.get("") ?? []).map((c) => (
                  <CandidateCard
                    key={c.id}
                    c={c}
                    roleName={c.roleId ? (roleById.get(c.roleId)?.name ?? null) : null}
                    roleColor={c.roleId ? (roleById.get(c.roleId)?.color ?? "#6b7280") : "#6b7280"}
                    ownerName={c.ownerId ? (profileById.get(c.ownerId)?.name ?? null) : null}
                    ownerPhoto={c.ownerId ? (profileById.get(c.ownerId) ?? null) : null}
                    draggable
                    onDragStart={() => {
                      dragged.current = c.id;
                    }}
                    onDragEnd={() => {
                      dragged.current = null;
                      setDropStage(null);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}


      {/* ── the list ────────────────────────────────────────────────────────
          ⚠️ The board answers WHERE everyone is; only this answers WHICH. With
          271 candidates in the archive, "every Motion Designer who scored above
          8" is a question a column of cards cannot be asked at all. */}
      {/* ── the phone list ──
          ⚠️ IT REUSES `CandidateCard`, IT IS NOT A SECOND ROW MARKUP. The board
          card already holds exactly what a phone row wants — name, score, role,
          who is holding them, how long since anything happened — and a separate
          narrow row would be one more place for those five facts to drift. The
          table below is 860px of fixed columns, which on a 375px screen is a
          sideways scroll through five columns to read one person. */}
      {!busy && effectiveLayout === "list" && isNarrow && (
        <div className="mt-4 flex flex-col gap-2">
          {/* The table sorts from its own headings; a card stack has none, so
              the sort has to become a control of its own or a phone is stuck
              with whatever order the last desktop visit chose. */}
          <label className="flex items-center gap-2 text-[12px] text-muted">
            Sort by
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="min-h-11 flex-1 rounded-lg border border-border bg-surface px-2 text-[13px]"
            >
              <option value="activity">Last activity</option>
              <option value="name">Name</option>
              <option value="score">Score</option>
              <option value="stage">Stage</option>
            </select>
          </label>
          {sorted.map((c) => (
            <CandidateCard
              key={c.id}
              c={c}
              roleName={c.roleId ? (roleById.get(c.roleId)?.name ?? null) : null}
              roleColor={c.roleId ? (roleById.get(c.roleId)?.color ?? "#6b7280") : "#6b7280"}
              ownerName={c.ownerId ? (profileById.get(c.ownerId)?.name ?? null) : null}
              ownerPhoto={c.ownerId ? (profileById.get(c.ownerId) ?? null) : null}
              stageName={c.stageId ? (stageById.get(c.stageId)?.name ?? null) : null}
              draggable={false}
              onDragStart={() => {}}
              onDragEnd={() => {}}
            />
          ))}
          {sorted.length === 0 && <p className="py-6 text-sm text-faint">Nobody matches that.</p>}
        </div>
      )}

      {!busy && effectiveLayout === "list" && !isNarrow && (
        <div className="mt-5 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-[13px]">
            <thead>
              <tr>
                {(
                  [
                    ["name", "Candidate", "w-[280px]"],
                    ["stage", view === "active" ? "Stage" : "Left at", "w-[170px]"],
                    [null, "Owner", "w-[130px]"],
                    ["score", "Score", "w-[90px]"],
                    ["activity", "Last activity", "w-[130px]"],
                  ] as const
                ).map(([key, label, w]) => (
                  <th
                    key={label}
                    className={`${w} border-b border-border px-3 pb-2 pt-3 text-[11px] font-medium uppercase tracking-wide text-faint`}
                  >
                    {key ? (
                      /* ⚠️ `uppercase tracking-wide` is REPEATED on the button, not
                         just on the <th>. A button carries the user agent's own
                         `text-transform: none`, which beats an inherited value —
                         so without this the four sortable headings render in
                         sentence case beside an uppercase "OWNER". */
                      <button
                        onClick={() => setSort(key)}
                        className={`uppercase tracking-wide hover:text-foreground ${
                          sort === key ? "text-brand" : ""
                        }`}
                        title="Click to sort"
                      >
                        {label}
                        {/* The arrow states the direction rather than merely
                            marking the column: score and activity run high-to-low,
                            name and stage low-to-high, and a caret that always
                            pointed down would be wrong half the time. */}
                        {sort === key && (SORT_DIR[key] === "desc" ? " \u25be" : " \u25b4")}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const role = c.roleId ? roleById.get(c.roleId) : null;
                const owner = c.ownerId ? profileById.get(c.ownerId) : null;
                const stage = c.stageId ? stageById.get(c.stageId) : null;
                return (
                  <tr key={c.id} className="hover:bg-brand-soft/40">
                    <td className="border-b border-border px-3 py-2.5">
                      <Link href={`/candidates/${c.id}`} className="flex items-center gap-2.5">
                        <span className="min-w-0">
                          <span className="bidi-auto block truncate font-medium">{c.name}</span>
                          {c.email && (
                            <span className="block truncate text-[11.5px] text-faint">
                              {c.email}
                            </span>
                          )}
                        </span>
                        {role && (
                          <span
                            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted"
                            title={role.name}
                          >
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: role.color }}
                              aria-hidden
                            />
                            {role.name}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="border-b border-border px-3 py-2.5">
                      <span className="bidi-auto text-muted">{stage?.name ?? "—"}</span>
                    </td>
                    <td className="border-b border-border px-3 py-2.5">
                      {owner ? (
                        <span className="flex items-center gap-1.5">
                          <Avatar profile={owner} size={18} />
                          <span className="truncate text-muted">{owner.name}</span>
                        </span>
                      ) : (
                        <span className="text-faint">Unassigned</span>
                      )}
                    </td>
                    <td className="border-b border-border px-3 py-2.5">
                      <ScorePill value={c.avgScore} />
                    </td>
                    <td className="border-b border-border px-3 py-2.5 text-muted">
                      {ago(c.lastActivityAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <p className="px-3 py-6 text-sm text-faint">Nobody matches that.</p>
          )}
        </div>
      )}

      {!busy && view === "active" && effectiveLayout === "board" && counts.active === 0 && (
        <p className="mt-8 text-sm text-faint">
          Nobody in play. Add a candidate, or bring the Asana history across.
        </p>
      )}
    </div>
  );
}
