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
import { liftDrag } from "@/lib/drag-lift";
import { useRouter } from "next/navigation";
import {
  Archive,
  List,
  Mail,
  PauseCircle,
  Plus,
  Search,
  SquareKanban,
  UserSearch,
  Users,
  X,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { startOfWeek, toISODate } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { Avatar, NameAvatar, Tabs } from "@/components/ui";
import { loadBoard, loadVocabulary, type BoardCounts, type Vocabulary } from "@/lib/candidates/data";
import { createCandidate, moveToStage } from "@/lib/candidates/actions";
import { importApplicationEmail } from "@/lib/candidates/import-email";
import { toast } from "@/lib/toast";
import {
  APPLICATION_REVIEW_KIND,
  formatScore,
  NEW_CANDIDATE_NAME,
  NEW_CANDIDATE_PARAM,
  scoreTone,
  type Candidate,
  type CandidateStatus,
} from "@/lib/candidates/types";
import { SkeletonCard } from "@/components/skeleton";
import { EmptyState } from "@/components/empty-state";

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

function ScorePill({ value, table = false }: { value: number | null; table?: boolean }) {
  const tone = scoreTone(value);
  return (
    <span
      /* ⚠️ DOUBLE SIZE ON A PHONE, and it has to move with the name — Nitsan,
         2026-09-29, asked for both at 200%. They are the two things you scan a
         list of candidates by, and at 11.5px beside a 15px name they read as
         footnotes on a screen you hold at arm's length. Above `md` the card is
         a 224px board column where those sizes are already right. */
      className={`inline-flex shrink-0 items-center justify-center font-semibold tabular-nums ${
        table ? "h-7 min-w-11 rounded-lg px-2 text-[13px]" : "h-10 rounded-md px-1.5 text-[23px] md:h-5 md:text-[12px]"
      } ${TONE[tone]}`}
      title={value === null ? "Not scored yet" : "Every reading so far, the later ones counting more"}
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
      onDragStart={(e) => {
        liftDrag(e);
        onDragStart();
      }}
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

/** Initials on a colour picked from the name, so a person keeps their colour. */
/** How far along the stages someone is: one short bar per stage. */
function StageProgress({ at, of }: { at: number; of: number }) {
  return (
    <span className="mt-1.5 flex gap-1" aria-label={`Stage ${at + 1} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={`h-1.5 w-4 rounded-full ${i <= at ? "bg-brand" : "bg-track"}`} />
      ))}
    </span>
  );
}

/** "Phone interview" → "Phone": the column has room for the word that differs. */
const shortKind = (kind: string) =>
  kind === APPLICATION_REVIEW_KIND ? "Application" : kind.replace(/ (interview|day)$/i, "");

const SCORE_TEXT: Record<string, string> = {
  high: "text-success",
  mid: "text-[#855800]",
  low: "text-danger",
  none: "text-faint",
};

/** Every scorecard so far, oldest first — the list's answer to "how did each go". */
function Readings({ readings }: { readings: Candidate["readings"] }) {
  if (readings.length === 0) return <span className="text-faint">None yet</span>;
  // The application always reads first — it is where every candidacy starts,
  // even when its card is dated after a call (the date is when they applied,
  // and that is sometimes typed in late). Only the DISPLAY order; the score's
  // weighting still goes by date.
  const shown = [...readings].sort((a, b) => Number(b.kind === APPLICATION_REVIEW_KIND) - Number(a.kind === APPLICATION_REVIEW_KIND));
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
      {shown.map((r, i) => (
        <span key={i} className="whitespace-nowrap">
          <span className="bidi-auto">{shortKind(r.kind)}</span>{" "}
          <b className={`font-medium tabular-nums ${SCORE_TEXT[scoreTone(r.avg)]}`}>{formatScore(r.avg)}</b>
        </span>
      ))}
    </span>
  );
}

const EMPTY_TAB: Record<CandidateStatus, string> = {
  active: "Nobody in the pipeline right now.",
  on_hold: "Nobody on hold.",
  archived: "Nobody archived yet.",
};

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

  // ⚠️ Why the list is empty decides what it offers: with people on this tab,
  // only the search and the role can be hiding them, so clearing those is the
  // way back; with nobody on the tab there is nothing to clear.
  const noMatch = (compact = false) =>
    rows.length > 0 ? (
      <EmptyState
        compact={compact}
        icon={UserSearch}
        text="Nobody matches that."
        action={{
          label: "Clear search and role",
          onClick: () => {
            setQuery("");
            setRoleFilter(null);
          },
        }}
      />
    ) : (
      <EmptyState compact={compact} icon={UserSearch} text={EMPTY_TAB[view]} />
    );

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

  /**
   * Saved applicant emails → candidates. Dropped anywhere on the page, or
   * picked with the Import email button.
   *
   * ONE email opens the candidate, like Add candidate does — you want to check
   * what was read. SEVERAL stay on the board and say what happened, because
   * being bounced to the first of five is losing the other four.
   */
  const emailInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const importEmails = useCallback(
    async (picked: File[]) => {
      if (!vocab || importing) return;
      const emails = picked.filter((f) => /\.eml$/i.test(f.name) || f.type === "message/rfc822");
      if (emails.length === 0) {
        setError("That isn't a saved email. In Gmail: ⋮ → Download message, then drop the .eml file here.");
        return;
      }
      setError(null);
      const done: { id: string; created: boolean }[] = [];
      try {
        for (const [i, file] of emails.entries()) {
          setImporting(emails.length > 1 ? `Importing ${i + 1} of ${emails.length}…` : "Importing…");
          const r = await importApplicationEmail(
            file,
            vocab.stages[0]?.id ?? null,
            currentUserId,
            vocab.roles,
          );
          done.push({ id: r.candidateId, created: r.created });
          const files = r.files ? ` with ${r.files} file${r.files === 1 ? "" : "s"}` : "";
          toast(r.created ? `Added ${r.name}${files}` : `${r.name} was already here — added to their card`);
          if (r.skipped.length) {
            toast(`Couldn't store ${r.skipped.join(", ")} — add it on their page`, { tone: "info", ms: 8000 });
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "That email could not be imported.");
      } finally {
        setImporting(null);
      }
      if (done.length === 1 && emails.length === 1) {
        router.push(`/candidates/${done[0].id}`);
      } else if (done.length) {
        const b = await loadBoard(view).catch(() => null);
        if (b) {
          setRows(b.candidates);
          setCounts(b.counts);
        }
      }
    },
    [vocab, importing, currentUserId, router, view],
  );

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="page-title">Candidates</h1>
        <p className="mt-3 text-sm text-muted">
          Hiring is admin-only — it holds applicants&rsquo; contact details and the studio&rsquo;s
          notes about them.
        </p>
      </div>
    );
  }

  const stages = vocab?.stages ?? [];

  // Interviews held this week (Sun–Thu) across the people in this view — the
  // one forward-looking fact the summary line can carry.
  const weekStart = toISODate(startOfWeek(new Date()));
  const interviewsThisWeek = rows.reduce(
    (n, c) => n + c.readings.filter((r) => r.kind !== APPLICATION_REVIEW_KIND && r.at.slice(0, 10) >= weekStart).length,
    0,
  );

  // ⚠️ ONLY A DRAG CARRYING FILES. A card being dragged between columns also
  // fires these, and must not light the whole page up as a drop target.
  const carriesFiles = (e: React.DragEvent) => !dragged.current && e.dataTransfer.types.includes("Files");

  return (
    <div
      className="relative mx-auto max-w-[1500px]"
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        if (!fileOver) setFileOver(true);
      }}
      onDragLeave={(e) => {
        // Leaving into a child is not leaving the page.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false);
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        setFileOver(false);
        void importEmails(Array.from(e.dataTransfer.files));
      }}
    >
      {fileOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center rounded-2xl bg-brand-soft/80 outline-2 outline-dashed outline-brand">
          <div className="mt-32 flex items-center gap-2 rounded-xl bg-surface px-4 py-3 text-sm font-medium text-brand-dark shadow-card">
            <Mail size={20} strokeWidth={1.75} />
            Drop the applicant&rsquo;s email to add them
          </div>
        </div>
      )}
      {/* ── the page's anatomy, as everywhere else (2026-10-23, List A): title
          and summary on the left, the one primary action on the right, then a
          toolbar row of its own — which view, filters, search, layout. */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Candidates</h1>
          <p className="mt-1 text-sm text-muted">
            {counts.active} in play
            {counts.onHold > 0 && ` · ${counts.onHold} on hold`}
            {view === "active" && interviewsThisWeek > 0 &&
              ` · ${interviewsThisWeek} interview${interviewsThisWeek === 1 ? "" : "s"} this week`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={emailInput}
            type="file"
            accept=".eml,message/rfc822"
            multiple
            hidden
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              void importEmails(picked);
            }}
          />
          <button
            onClick={() => emailInput.current?.click()}
            disabled={!!importing || !vocab}
            title="Add a candidate from a saved email (.eml) — or drop one anywhere on this page"
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-surface px-3 text-sm font-medium text-foreground shadow-card hover:bg-background disabled:opacity-50 md:h-10 md:px-4"
          >
            <Mail size={16} strokeWidth={1.75} />
            <span className="hidden md:inline">{importing ?? "Import email"}</span>
          </button>
          <button
            onClick={() => void addCandidate()}
            disabled={adding || !vocab}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50 md:h-10"
          >
            <Plus size={16} strokeWidth={2} />
            <span className="md:hidden">{adding ? "Adding…" : "Add"}</span>
            <span className="hidden md:inline">{adding ? "Adding…" : "Add candidate"}</span>
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {/* ⚠️ On hold and Archive are STATUS views, not columns. On the Asana
            board "To Reject" was a column holding 140 of 271 cards — the
            widest thing on screen was the one nobody wanted to read. They are
            one control now, with In play, rather than two loose toggle chips:
            you are always looking at exactly one of the three. */}
        <div className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:w-auto md:px-0">
          <Tabs<CandidateStatus>
            value={view}
            onChange={switchView}
            variant="segmented"
            ariaLabel="Which candidates"
            className="w-max"
            items={[
              { value: "active", label: "In play", icon: Users, count: counts.active },
              { value: "on_hold", label: "On hold", icon: PauseCircle, count: counts.onHold },
              { value: "archived", label: "Archive", icon: Archive, count: counts.archived },
            ]}
          />
        </div>
        {/* ⚠️ ONE DROPDOWN, NOT A ROW OF CHIPS. A role here is a TAG — the
            studio hires designers and rarely two kinds at once — so it gets the
            quietest control. It turns brand-tinted while it is actually hiding
            somebody, because a filter you cannot see is how a board comes to
            look emptier than it is. */}
        <select
          value={roleFilter ?? "all"}
          onChange={(e) => setRoleFilter(e.target.value === "all" ? null : e.target.value)}
          aria-label="Filter by role"
          className={`h-11 shrink-0 cursor-pointer rounded-xl px-3 text-sm shadow-card md:h-10 ${
            roleFilter === null ? "bg-surface text-muted" : "bg-brand-soft font-medium text-brand-dark"
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
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-surface px-3.5 shadow-card md:ml-auto md:h-10 md:w-72 md:flex-none">
          <Search size={16} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, email, source"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear the search">
              <X size={14} className="text-faint" />
            </button>
          )}
        </label>
        {/* ⚠️ Hidden on a phone rather than disabled: offering "Board" and
            then refusing it is worse than not offering it, and the list is
            not a fallback here — it is the phone's real shape. */}
        <div className="hidden md:block">
          <Tabs
            value={layout}
            onChange={(k) => {
              setLayout(k);
              storeLayout(k, view);
            }}
            variant="segmented"
            ariaLabel="Layout"
            items={[
              { value: "board" as const, label: "Board", icon: SquareKanban },
              { value: "list" as const, label: "List", icon: List },
            ]}
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {busy && <SkeletonCard rows={6} className="mt-5" />}

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
              noMatch(true)
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
          {sorted.length === 0 && noMatch(true)}
        </div>
      )}

      {!busy && effectiveLayout === "list" && !isNarrow && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-left text-[13px]">
            <thead>
              <tr>
                {(
                  [
                    ["name", "Candidate", "w-[320px] pl-5"],
                    ["stage", view === "active" ? "Stage" : "Left at", "w-[190px]"],
                    [null, "Owner", "w-[150px]"],
                    [null, "Readings", ""],
                    ["score", "Score", "w-[90px] text-right"],
                    ["activity", "Last activity", "w-[130px] pr-5 text-right"],
                  ] as const
                ).map(([key, label, w]) => (
                  <th
                    key={label}
                    className={`${w} px-3 pb-3 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted`}
                  >
                    {key ? (
                      /* ⚠️ `uppercase tracking-wide` is REPEATED on the button, not
                         just on the <th>. A button carries the user agent's own
                         `text-transform: none`, which beats an inherited value. */
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
                            name and stage low-to-high. */}
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
                const stageAt = stage ? stages.findIndex((x) => x.id === stage.id) : -1;
                return (
                  <tr key={c.id} className="group/row cursor-pointer hover:bg-background/70" onClick={() => router.push(`/candidates/${c.id}`)}>
                    <td className="border-t border-border py-3 pl-5 pr-3">
                      <Link
                        href={`/candidates/${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-3"
                      >
                        <NameAvatar name={c.name} size={34} />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="bidi-auto truncate text-sm font-medium group-hover/row:text-brand">{c.name}</span>
                            {role && (
                              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-background px-2 py-0.5 text-xs text-muted">
                                <span className="size-1.5 rounded-full" style={{ backgroundColor: role.color }} aria-hidden />
                                {role.name}
                              </span>
                            )}
                          </span>
                          {c.email && <span className="block truncate text-[13px] text-muted">{c.email}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="border-t border-border px-3 py-3">
                      <span className="bidi-auto block">{stage?.name ?? "—"}</span>
                      {stageAt >= 0 && <StageProgress at={stageAt} of={stages.length} />}
                    </td>
                    <td className="border-t border-border px-3 py-3">
                      {owner ? (
                        <span className="flex items-center gap-2">
                          <Avatar profile={owner} size={22} />
                          <span className="truncate">{owner.name.split(" ")[0]}</span>
                        </span>
                      ) : (
                        <span className="text-faint">Unassigned</span>
                      )}
                    </td>
                    <td className="border-t border-border px-3 py-3">
                      <Readings readings={c.readings} />
                    </td>
                    <td className="border-t border-border px-3 py-3 text-right">
                      <ScorePill value={c.avgScore} table />
                    </td>
                    <td className="border-t border-border py-3 pl-3 pr-5 text-right text-muted">
                      {ago(c.lastActivityAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sorted.length === 0 && (
            noMatch()
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
