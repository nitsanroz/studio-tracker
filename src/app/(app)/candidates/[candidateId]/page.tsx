"use client";

// One candidate, read top to bottom as a story: what they sent, what each
// interviewer heard, what the two of you said to each other, what was decided.
//
// ⚠️ THE SCORECARDS ARE THE POINT OF THIS PAGE, and they are SEPARATE per
// interview on purpose. Michal's phone screen and Nitsan's own interview each
// get their own card, so where the two of them disagreed survives — a single
// shared scorecard would let whoever typed last overwrite the other's reading.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Archive,
  ChevronLeft,
  ExternalLink,
  FileText,
  Link2,
  Mail,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { Avatar } from "@/components/ui";
import { hostLabel, isSafeUrl, normalizeUrl } from "@/lib/links";
import { formatDate } from "@/lib/format";
import { loadCandidate, loadVocabulary, type Vocabulary } from "@/lib/candidates/data";
import {
  addComment,
  addInterview,
  addLink,
  deleteCandidate,
  moveToStage,
  removeInterview,
  removeLink,
  setScore,
  setStatus,
  updateCandidate,
  updateInterview,
} from "@/lib/candidates/actions";
import {
  formatScore,
  interviewAverage,
  overallScore,
  scoreTone,
  subjectAverage,
  type CandidateDetail,
  type CandidateLinkKind,
  type Interview,
  type ScoreSubject,
} from "@/lib/candidates/types";

/**
 * What kind of meeting a scorecard describes.
 *
 * ⚠️ "Application review" IS ONE OF THEM, and that is the whole reason the list
 * exists rather than a free-text box. Reading a CV, a portfolio and a covering
 * mail is a moment where somebody forms a judgement and can score it — the same
 * shape as an interview, so it reuses the same card instead of growing a second
 * scoring mechanism beside it. It also lands first in the timeline by itself,
 * because it happens first.
 *
 * ⚠️ The column is TEXT, not an enum, and the picker tolerates a value it does
 * not know: the Asana import writes the board's own column names as the kind,
 * and a `<select>` that silently dropped an unrecognised one would rewrite the
 * label on an interview that happened two years ago.
 */
const INTERVIEW_KINDS = [
  "Application review",
  "Phone interview",
  "Zoom interview",
  "Physical interview",
  "Tryout day",
  "Other",
];

const TONE: Record<string, string> = {
  high: "text-[#12693d]",
  mid: "text-[#8a5a09]",
  low: "text-danger",
  none: "text-faint",
};


/**
 * One scorecard column: a subject, its average, and its 3–8 parameters.
 *
 * ⚠️ RETIRED PARAMETERS STILL RENDER IF THEY WERE SCORED. Somebody removing
 * "Typography" in Settings next year must not silently rewrite what an
 * interviewer recorded this year — so the filter is "active OR has a value",
 * never "active".
 */
function SubjectColumn({
  subject,
  interview,
  onSet,
}: {
  subject: ScoreSubject;
  interview: Interview;
  onSet: (paramId: string, value: number | null) => void;
}) {
  const avg = subjectAverage(subject, interview.scores);
  const params = subject.params.filter(
    (p) => p.active || typeof interview.scores[p.id] === "number",
  );
  if (params.length === 0) return null;
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline gap-2 border-b border-border pb-1.5">
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-faint">
          {subject.name}
        </span>
        <span className={`ml-auto text-sm font-semibold ${TONE[scoreTone(avg)]}`}>
          {formatScore(avg)}
        </span>
      </div>
      {params.map((p) => {
        const v = interview.scores[p.id];
        return (
          <div key={p.id} className="flex items-center gap-2 py-0.5 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-muted" title={p.name}>
              {p.name}
            </span>
            <select
              value={typeof v === "number" ? String(v) : ""}
              onChange={(e) => onSet(p.id, e.target.value ? Number(e.target.value) : null)}
              aria-label={`${subject.name} — ${p.name}`}
              className={`w-11 cursor-pointer appearance-none rounded bg-transparent py-0.5 text-right text-[12.5px] font-semibold hover:bg-background ${
                TONE[scoreTone(typeof v === "number" ? v : null)]
              }`}
            >
              <option value="">—</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One row of the ⋯ menu: icon and title on one line, the note under it.
 *
 * ⚠️ `items-start` AND `text-left` ARE BOTH LOAD-BEARING. As a plain
 * `flex items-center` row the icon took its own column and the title sat
 * centred in whatever was left, with the note centred under it on a second
 * line — three ragged axes in a menu of three items. The note is indented to
 * the title rather than to the icon, so each row reads as one block.
 */
const MENU_ITEM = "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-background";
const MENU_TITLE = "flex items-center gap-2 text-[13px] leading-none";
/** 14px icon + the 8px gap above it, so the note starts under the title. */
const MENU_NOTE = "pl-[22px] text-[11px] leading-snug text-faint";

/**
 * A date field whose picker glyph sits next to the number rather than adrift
 * from it, and stays out of sight until you reach for it.
 *
 * ⚠️ THE GAP WAS THE GLYPH'S OWN MARGIN, NOT SLACK IN THE FIELD — and I got
 * that wrong first time round. I measured the date text with a canvas (67px),
 * compared it to the input's 123px and concluded there were ~48px going spare,
 * so I pinned the width to 94px. That clipped the last digit, because a canvas
 * measure is not how a browser lays out date SEGMENTS: asked directly, it wants
 * **119px** for this font. So there was only ever 4px of slack, and zeroing
 * `::-webkit-calendar-picker-indicator`'s margin and padding is the whole fix.
 *
 * ⚠️ NO EXPLICIT WIDTH. It would have to be re-tuned for every font size and
 * date locale this field ever renders in, and being one pixel short crops a
 * digit — which is exactly what happened.
 */
const DATE_FIELD =
  "[&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:p-0 " +
  "[&::-webkit-calendar-picker-indicator]:opacity-0 hover:[&::-webkit-calendar-picker-indicator]:opacity-60";

/** LinkedIn's mark. Lucide dropped brand icons, so this is drawn here. */
function LinkedInMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM2.4 21.5h5.2V9.5H2.4v12zM9.9 9.5h4.98v1.64h.07c.7-1.25 2.4-2.14 4.05-2.14 4.33 0 5 2.6 5 5.98v6.52h-5.2v-5.78c0-1.38-.02-3.15-2-3.15-2 0-2.3 1.5-2.3 3.05v5.88H9.9v-12z" />
    </svg>
  );
}

/**
 * A contact detail: click the value to copy it, hover for a pencil to change it.
 *
 * ⚠️ CLICK COPIES, THE PENCIL EDITS — Nitsan's shape, and the right way round.
 * A phone number on this page is read to be dialled or pasted twenty times for
 * every once it is corrected, so the common action gets the whole target and
 * the rare one gets an affordance that only appears when you reach for it.
 *
 * ⚠️ `navigator.clipboard` REJECTS on an insecure origin and in some embedded
 * views, so the failure is caught and the value is selected instead — a silent
 * "Copied!" over a clipboard that did not change is the one outcome to avoid
 * (the same fallback the task permalink uses).
 */
function ContactField({
  icon,
  value,
  placeholder,
  onCommit,
}: {
  icon: React.ReactNode;
  value: string | null;
  placeholder: string;
  onCommit: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  if (editing || !value) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted">
        <span className="shrink-0 text-faint">{icon}</span>
        <input
          autoFocus={editing}
          defaultValue={value ?? ""}
          placeholder={placeholder}
          onBlur={(e) => {
            setEditing(false);
            const v = e.target.value.trim();
            if (v !== (value ?? "")) onCommit(v || null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = value ?? "";
              e.currentTarget.blur();
            }
          }}
          className="w-40 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] hover:border-border focus:border-border focus:bg-surface focus:outline-none"
        />
      </span>
    );
  }

  return (
    <span className="group/f inline-flex items-center gap-1.5">
      <span className="shrink-0 text-faint">{icon}</span>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            // ⚠️ A PROMPT, NOT A TEXT SELECTION. My first fallback selected the
            // button's own contents — and measured empty, because button text
            // is not selectable, so the branch did nothing at all while looking
            // like it worked. A prompt is what `task-panel.tsx` already does
            // for its permalink and is the one thing that reliably lets
            // somebody get the value out (Safari, an insecure origin, an
            // embedded view: all reject `writeText`).
            window.prompt("Copy this:", value);
          }
        }}
        title="Click to copy"
        className="rounded px-1 py-0.5 text-[13px] text-foreground hover:bg-brand-soft"
      >
        {copied ? <span className="text-success">Copied</span> : value}
      </button>
      <button
        onClick={() => setEditing(true)}
        aria-label={`Edit ${placeholder.toLowerCase()}`}
        title="Edit"
        className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-foreground group-hover/f:opacity-100"
      >
        <Pencil size={11} strokeWidth={1.75} />
      </button>
    </span>
  );
}

export default function CandidatePage() {
  const isAdmin = useIsAdmin();
  const { profiles, currentUserId } = useData();
  const router = useRouter();
  const params = useParams<{ candidateId: string }>();
  const id = params.candidateId;

  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [missing, setMissing] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [linkKind, setLinkKind] = useState<CandidateLinkKind>("portfolio");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [v, d] = await Promise.all([loadVocabulary(), loadCandidate(id)]);
      setVocab(v);
      if (!d) setMissing(true);
      else setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this candidate.");
    } finally {
      setBusy(false);
    }
  }, [id]);

  /**
   * ⚠️ `alive` matters more here than on the board: every write calls `reload`,
   * so a save and a navigation can be in flight at once, and a response landing
   * after the user has left would set state on an unmounted page. Same guard the
   * CSP viewer took in v1.42.1 after its Refresh button bypassed it.
   */
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      const ok = await reload();
      if (!alive) return;
      void ok;
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin, reload]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That change could not be saved.");
      }
    },
    [reload],
  );

  /**
   * ⚠️ THROUGH `/api/candidate-file`, NOT STRAIGHT TO STORAGE FROM THE BROWSER.
   * The bucket is private with no anon policy, so the browser has no way in —
   * and that route is where the admin check and the Content-Type allowlist
   * live. A browser-side upload with the anon key would have neither.
   */
  const uploadCv = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("candidateId", id);
        const res = await fetch("/api/candidate-file", { method: "POST", body });
        const json = (await res.json()) as { path?: string; url?: string; error?: string };
        if (!res.ok || !json.url || !json.path) {
          throw new Error(json.error ?? "That file could not be stored.");
        }
        await addLink(id, file.name, json.url, "cv", json.path, 0);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That file could not be stored.");
      } finally {
        setUploading(false);
      }
    },
    [id, reload],
  );

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  /**
   * ⚠️ ADMINS ONLY, FOR BOTH THE OWNER AND THE INTERVIEWER PICKERS — and the
   * reason is not tidiness. Every candidate table is `admin all` with no
   * `read all` (0039), so a designer named as the owner of a candidate could
   * not open that candidate, and an interviewer who cannot see the scorecard
   * cannot have filled it in. Offering the whole studio here would let you
   * assign work to somebody the app will then refuse.
   *
   * ⚠️ This is a UX gate, not the boundary. The boundary is the RLS policy;
   * nothing here is what stops a designer reading a CV.
   */
  const assignable = useMemo(
    () =>
      profiles
        .filter((p) => p.active && p.role === "admin")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [profiles],
  );

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="font-serif-accent text-2xl">Candidates</h1>
        <p className="mt-3 text-sm text-muted">Hiring is admin-only.</p>
      </div>
    );
  }
  if (busy) return <p className="py-10 text-sm text-muted">Loading…</p>;
  if (missing)
    return (
      <div className="py-10">
        <p className="text-sm text-muted">That candidate no longer exists.</p>
        <Link href="/candidates" className="mt-2 inline-block text-sm text-brand">
          Back to the board
        </Link>
      </div>
    );
  if (!detail || !vocab) return <p className="py-10 text-sm text-danger">{error}</p>;

  const { candidate: c, links, interviews, comments, events } = detail;
  const stage = vocab.stages.find((s) => s.id === c.stageId) ?? null;
  const role = vocab.roles.find((r) => r.id === c.roleId) ?? null;
  const overall = overallScore(interviews);
  const scoredCount = interviews.filter((i) => Object.keys(i.scores).length > 0).length;
  const cv = links.filter((l) => l.kind === "cv");
  const others = links.filter((l) => l.kind !== "cv");

  return (
    <div className="mx-auto max-w-[1500px]">
      <Link
        href="/candidates"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} strokeWidth={1.75} /> Candidates
      </Link>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* ── header ─────────────────────────────────────────────────────────
          Full width, three bands: who they are and how to reach them, then the
          files, then the actions. The one figure worth seeing from across the
          room sits on the right. */}
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <input
              defaultValue={c.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== c.name) void run(() => updateCandidate(c.id, { name: v }, currentUserId));
              }}
              className="bidi-auto min-w-0 max-w-full rounded-md border border-transparent px-1 font-serif-accent text-[32px] leading-tight hover:border-border focus:border-border focus:outline-none"
              style={{ width: `${Math.max(8, c.name.length + 1)}ch` }}
            />
            {/* Nitsan: phone and mail beside the name — they are what you came
                to the page for as often as anything below. */}
            <ContactField
              icon={<Phone size={13} strokeWidth={1.75} />}
              value={c.phone}
              placeholder="Phone"
              onCommit={(v) => void run(() => updateCandidate(c.id, { phone: v }, currentUserId))}
            />
            <ContactField
              icon={<Mail size={13} strokeWidth={1.75} />}
              value={c.email}
              placeholder="Email"
              onCommit={(v) => void run(() => updateCandidate(c.id, { email: v }, currentUserId))}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-muted">
            {/* ⚠️ NO CALENDAR ICON OF OUR OWN. I added a lucide one and Nitsan
                had asked for the opposite — the glyph beside a date is not
                needed at all, and the browser already draws one. Two calendars
                on one field was the wrong reading of "show it only on hover". */}
            <label className="group/d flex items-center gap-1.5">
              <span className="text-faint">Applied</span>
              {/* ⚠️ The browser's own calendar glyph is hidden until hover — it
                  is a second calendar icon sitting beside the one above, on a
                  field that is read far more often than it is changed. The same
                  trick `QUIET_FIELD` uses in the task pane. */}
              <input
                type="date"
                defaultValue={c.appliedOn ?? ""}
                onChange={(e) =>
                  void run(() => updateCandidate(c.id, { appliedOn: e.target.value || null }, currentUserId))
                }
                className={`rounded border border-transparent px-1 py-0.5 hover:border-border focus:border-border focus:outline-none group-hover/d:[&::-webkit-calendar-picker-indicator]:opacity-60 ${DATE_FIELD}`}
              />
            </label>
            <ContactField
              icon={<Link2 size={13} strokeWidth={1.75} />}
              value={c.source}
              placeholder="Where from"
              onCommit={(v) => void run(() => updateCandidate(c.id, { source: v }, currentUserId))}
            />
            {c.status === "on_hold" && (
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11.5px]">
                <PauseCircle size={12} /> On hold
              </span>
            )}
            {c.status === "archived" && (
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11.5px]">
                <Archive size={12} /> Archived
                {stage && <span className="text-faint">· reached {stage.name}</span>}
              </span>
            )}
            {role && (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: role.color }} />
                {role.name}
              </span>
            )}
          </div>

          {/* ── files and links ── */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {[...cv, ...others].map((l) => {
              const linked = /(^|\.)linkedin\.com\//i.test(l.url);
              const safe = isSafeUrl(l.url) || l.url.startsWith("/api/");
              return (
                <span
                  key={l.id}
                  className="group flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-2.5 pr-1 text-[11.5px] text-muted"
                >
                  <span className="shrink-0 text-faint">
                    {l.kind === "cv" ? (
                      <FileText size={12} strokeWidth={1.75} />
                    ) : linked ? (
                      <LinkedInMark />
                    ) : (
                      <ExternalLink size={12} strokeWidth={1.75} />
                    )}
                  </span>
                  {safe ? (
                    <a href={l.url} target="_blank" rel="noreferrer" className="hover:text-brand">
                      {l.title}
                    </a>
                  ) : (
                    <span className="text-faint line-through" title={l.url}>
                      {l.title}
                    </span>
                  )}
                  <button
                    onClick={() => void run(() => removeLink(l.id, c.id))}
                    aria-label={`Remove ${l.title}`}
                    className="rounded-full p-1 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
                  >
                    <Trash2 size={12} strokeWidth={1.75} />
                  </button>
                </span>
              );
            })}

            {addingLink ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const url = normalizeUrl(linkUrl);
                  if (!url) {
                    setError("That link could not be read — check the address.");
                    return;
                  }
                  const title = linkTitle.trim() || hostLabel(url);
                  setAddingLink(false);
                  setLinkTitle("");
                  setLinkUrl("");
                  void run(() => addLink(c.id, title, url, linkKind, null, links.length + 1));
                }}
                className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface p-1.5"
              >
                <select
                  value={linkKind}
                  onChange={(e) => setLinkKind(e.target.value as CandidateLinkKind)}
                  aria-label="What kind of link"
                  className="rounded border border-border bg-surface px-1.5 py-1 text-[12px]"
                >
                  <option value="portfolio">Portfolio</option>
                  <option value="cv">CV</option>
                  <option value="other">Other</option>
                </select>
                <input
                  autoFocus
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="Paste the address"
                  className="w-56 rounded border border-border px-2 py-1 text-[12px]"
                />
                <input
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="Label (optional)"
                  className="w-36 rounded border border-border px-2 py-1 text-[12px]"
                />
                <button
                  type="submit"
                  disabled={!linkUrl.trim()}
                  className="h-7 rounded-md bg-brand px-2.5 text-[12px] font-medium text-white disabled:opacity-40"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingLink(false);
                    setLinkTitle("");
                    setLinkUrl("");
                  }}
                  className="h-7 rounded-md border border-border px-2 text-[12px]"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <label
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[11.5px] hover:border-brand hover:text-brand ${
                    uploading ? "opacity-50" : "text-muted"
                  }`}
                >
                  <Upload size={12} strokeWidth={1.75} />
                  {uploading ? "Uploading…" : "Upload a CV"}
                  <input
                    type="file"
                    hidden
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void uploadCv(f);
                    }}
                  />
                </label>
                <button
                  onClick={() => setAddingLink(true)}
                  className="flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[11.5px] text-muted hover:border-brand hover:text-brand"
                >
                  <Link2 size={12} strokeWidth={1.75} /> Add a link
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── the figure, and the controls under it ──
            ⚠️ Every score anybody has given them, weighted toward the latest —
            see `overallScore`. Deliberately the biggest thing on the page after
            the name: it is the one number you want from across the room, and
            the per-interview averages below are where it comes from.
            ⚠️ THE CONTROLS SIT WITH IT RATHER THAN IN A BAR BENEATH A RULE.
            Nitsan's call: a full-width row under a divider read as a toolbar
            for the whole page, when it only ever acts on this one person. */}
        <div className="flex shrink-0 flex-col items-end gap-3">
          <div className="text-right">
            <div className={`font-serif-accent text-[44px] leading-none ${TONE[scoreTone(overall)]}`}>
              {formatScore(overall)}
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-wider text-faint">
              {overall === null
                ? "not scored yet"
                : `across ${scoredCount} ${scoredCount === 1 ? "interview" : "interviews"}`}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              value={c.ownerId ?? ""}
              onChange={(e) =>
                void run(() => updateCandidate(c.id, { ownerId: e.target.value || null }, currentUserId))
              }
              className="h-9 rounded-lg border border-border bg-surface px-2 text-[13px]"
              aria-label="Who is holding this candidate"
            >
              <option value="">Unassigned</option>
              {assignable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {c.status === "active" ? (
              <select
                value={c.stageId ?? ""}
                onChange={(e) => {
                  const st = vocab.stages.find((x) => x.id === e.target.value);
                  if (st) void run(() => moveToStage(c.id, st.id, st.name, currentUserId));
                }}
                className="h-9 rounded-lg border border-[#c9d6fb] bg-brand-soft px-2 text-[13px] font-medium text-brand-dark"
                aria-label="Stage"
              >
                {vocab.stages.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => void run(() => setStatus(c.id, "active", null, currentUserId))}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px]"
              >
                <RotateCcw size={14} strokeWidth={1.75} /> Put back on the board
              </button>
            )}

            {/* ⚠️ HOLD, ARCHIVE AND DELETE GO BEHIND THE DOTS, and the three
                belong together because they are one idea: take this person off
                the board. Owner and Stage stay out because they are touched on
                every visit. It also gets the delete out from under a stray
                click — it was a bare trash icon sitting beside Archive, which
                is the neighbour you least want to miss. */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="More actions"
                aria-expanded={menuOpen}
                className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:text-foreground"
              >
                <MoreHorizontal size={16} strokeWidth={1.75} />
              </button>
              {menuOpen && (
                <>
                  <button
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setMenuOpen(false)}
                    className="fixed inset-0 z-40 cursor-default"
                  />
                  <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 text-left shadow-card">
                    {c.status !== "on_hold" && c.status !== "archived" && (
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          void run(() => setStatus(c.id, "on_hold", null, currentUserId));
                        }}
                        className={MENU_ITEM}
                      >
                        <span className={MENU_TITLE}>
                          <PauseCircle size={14} strokeWidth={1.75} className="shrink-0 text-faint" />
                          Hold
                        </span>
                        <span className={MENU_NOTE}>Good, wrong moment</span>
                      </button>
                    )}
                    {c.status !== "archived" && (
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          void run(() => setStatus(c.id, "archived", null, currentUserId));
                        }}
                        className={MENU_ITEM}
                      >
                        <span className={MENU_TITLE}>
                          <Archive size={14} strokeWidth={1.75} className="shrink-0 text-faint" />
                          Archive
                        </span>
                        <span className={MENU_NOTE}>Off the board, still searchable</span>
                      </button>
                    )}
                    <div className="my-1 border-t border-border" />
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        const bits = [
                          interviews.length &&
                            `${interviews.length} interview${interviews.length === 1 ? "" : "s"}`,
                          comments.length &&
                            `${comments.length} message${comments.length === 1 ? "" : "s"}`,
                          links.length &&
                            `${links.length} file${links.length === 1 ? "" : "s"} or link${links.length === 1 ? "" : "s"}`,
                        ].filter(Boolean);
                        const tail = bits.length ? `, along with ${bits.join(", ")}` : "";
                        if (
                          !window.confirm(
                            `Delete ${c.name} for good${tail}? This cannot be undone — Archive keeps them and takes them off the board.`,
                          )
                        )
                          return;
                        void (async () => {
                          setError(null);
                          try {
                            await deleteCandidate(c.id);
                            router.push("/candidates");
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : "That candidate could not be deleted.",
                            );
                          }
                        })();
                      }}
                      className={`${MENU_ITEM} text-danger hover:bg-danger/5`}
                    >
                      <span className={MENU_TITLE}>
                        <Trash2 size={14} strokeWidth={1.75} className="shrink-0" />
                        Delete for good
                      </span>
                      <span className={MENU_NOTE}>Interviews and files too</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── body ── */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-3">
          {/* application */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">
              Application
            </div>
            <textarea
              defaultValue={c.applicationText ?? ""}
              placeholder="What they sent — paste it here, verbatim. The studio's own notes go on the interviews below."
              rows={4}
              onBlur={(e) =>
                void run(() =>
                  updateCandidate(c.id, { applicationText: e.target.value.trim() || null }, currentUserId),
                )
              }
              className="bidi-auto w-full resize-y rounded-md border border-transparent bg-transparent p-1 text-[12.5px] leading-relaxed text-muted hover:border-border focus:border-border focus:bg-surface focus:outline-none"
            />
          </div>

          {/* interviews */}
          {interviews.map((iv) => {
            const who = iv.interviewerId ? profileById.get(iv.interviewerId) : null;
            const avg = interviewAverage(iv.scores);
            return (
              <div key={iv.id} className="rounded-xl border border-border bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  {who ? <Avatar profile={who} size={26} /> : <span className="size-[26px] rounded-full bg-background" />}
                  {/* ⚠️ The stored value is added to the option list when it is
                      not one we offer, so an imported kind ("Candidates",
                      "Contract") still renders and is not silently rewritten by
                      the first change to any other field on the card. */}
                  <select
                    value={iv.kind}
                    onChange={(e) => void run(() => updateInterview(iv.id, c.id, { kind: e.target.value }))}
                    aria-label="What kind of interview"
                    className="rounded border border-transparent bg-transparent px-1 py-1 text-sm font-medium hover:border-border focus:border-border focus:outline-none"
                  >
                    {(INTERVIEW_KINDS.includes(iv.kind)
                      ? INTERVIEW_KINDS
                      : [iv.kind, ...INTERVIEW_KINDS]
                    ).map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <select
                    value={iv.interviewerId ?? ""}
                    onChange={(e) =>
                      void run(() => updateInterview(iv.id, c.id, { interviewerId: e.target.value || null }))
                    }
                    className="rounded border border-border bg-surface px-1.5 py-1 text-[12px] text-muted"
                    aria-label="Who ran it"
                  >
                    <option value="">Who ran it</option>
                    {assignable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {/* Same rule as the Applied date: the browser's calendar
                      glyph is chrome on a field that is read more than it is
                      changed, so it waits until you reach for it. */}
                  <input
                    type="date"
                    defaultValue={iv.heldOn ?? ""}
                    onChange={(e) => void run(() => updateInterview(iv.id, c.id, { heldOn: e.target.value || null }))}
                    className={`rounded border border-border bg-surface px-1.5 py-1 text-[12px] text-muted ${DATE_FIELD}`}
                    aria-label="When"
                  />
                  {/* ⚠️ The figure and the delete travel TOGETHER in their own
                      shrink-0 group. Left loose in the wrapping row they
                      separate at a laptop width and the trash drops onto a line
                      of its own under the interview's name, which reads as a
                      broken card rather than a tidy wrap. */}
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                  <span className={`text-sm font-semibold ${TONE[scoreTone(avg)]}`}>
                    {formatScore(avg)}
                    <span className="ml-1 text-[11px] font-normal text-faint">average</span>
                  </span>
                  {/* ⚠️ Confirmed, because it takes the scores with it — the
                      interview's rows cascade (0039) and there is no undo in
                      this section by design. */}
                  <button
                    onClick={() => {
                      const n = Object.keys(iv.scores).length;
                      if (
                        !window.confirm(
                          n > 0
                            ? `Delete this ${iv.kind.toLowerCase()} and its ${n} score${n === 1 ? "" : "s"}? This cannot be undone.`
                            : "Delete this interview? This cannot be undone.",
                        )
                      )
                        return;
                      void run(() => removeInterview(iv.id, c.id));
                    }}
                    aria-label={`Delete this ${iv.kind}`}
                    title="Delete this interview"
                    className="rounded p-1.5 text-faint hover:text-danger"
                  >
                    <Trash2 size={14} strokeWidth={1.75} />
                  </button>
                  </span>
                </div>

                <textarea
                  defaultValue={iv.summary ?? ""}
                  placeholder="What you heard. A few lines is plenty — the scores carry the rest."
                  rows={3}
                  onBlur={(e) =>
                    void run(() => updateInterview(iv.id, c.id, { summary: e.target.value.trim() || null }))
                  }
                  className="bidi-auto mt-2.5 w-full resize-y rounded-md border border-transparent bg-transparent p-1 text-[12.5px] leading-relaxed text-muted hover:border-border focus:border-border focus:bg-surface focus:outline-none"
                />

                <div className="mt-3 grid gap-x-5 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
                  {vocab.subjects.map((s) => (
                    <SubjectColumn
                      key={s.id}
                      subject={s}
                      interview={iv}
                      onSet={(paramId, value) => void run(() => setScore(iv.id, paramId, value, c.id))}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                void run(() =>
                  addInterview(c.id, "Phone interview", null, currentUserId, currentUserId),
                )
              }
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong p-4 text-[13px] text-muted hover:border-brand hover:text-brand"
            >
              <Plus size={16} strokeWidth={2} /> Add an interview
            </button>
            {/* ⚠️ Its own button rather than one more option in the picker,
                because it is the step people forget to record: the judgement
                formed from the mail, the CV and the portfolio, before anybody
                has spoken to them. Same card, same subjects — leave the ones
                that need a conversation blank and they simply do not count. */}
            {!interviews.some((i) => i.kind === "Application review") && (
              <button
                onClick={() =>
                  void run(() =>
                    addInterview(c.id, "Application review", c.appliedOn, currentUserId, currentUserId),
                  )
                }
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong p-4 text-[13px] text-muted hover:border-brand hover:text-brand"
              >
                <Plus size={16} strokeWidth={2} /> Score the application
              </button>
            )}
          </div>
        </div>

        {/* ── right column ── */}
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <div className="mb-3 text-[12px] font-medium uppercase tracking-wider text-faint">
              Discussion
            </div>
            <div className="flex flex-col gap-3">
              {comments.map((m) => {
                const mine = m.authorId && m.authorId === currentUserId;
                const who = m.authorId ? profileById.get(m.authorId) : null;
                return (
                  <div key={m.id} className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                    {who ? (
                      <Avatar profile={who} size={22} />
                    ) : (
                      <span className="size-[22px] shrink-0 rounded-full bg-background" />
                    )}
                    <div className={`min-w-0 ${mine ? "text-right" : ""}`}>
                      <div className="mb-0.5 text-[11px] text-faint">
                        {who?.name ?? m.authorName ?? "Unknown"} ·{" "}
                        {formatDate(m.createdAt.slice(0, 10))}
                      </div>
                      <div
                        className={`bidi-auto inline-block rounded-lg px-2.5 py-2 text-left text-[12.5px] leading-relaxed ${
                          mine ? "bg-brand-soft" : "bg-background"
                        }`}
                      >
                        {m.body}
                      </div>
                    </div>
                  </div>
                );
              })}
              {comments.length === 0 && (
                <p className="text-[12.5px] text-faint">
                  Nothing yet. This is where you and Michal work out what to do.
                </p>
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const body = draft.trim();
                if (!body) return;
                setDraft("");
                void run(() => addComment(c.id, body, currentUserId));
              }}
              className="mt-3"
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // ⌘/Ctrl+Enter posts; plain Enter is a newline, because these
                  // are paragraphs rather than one-line notes.
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                placeholder="Write a message…"
                className="w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-2 text-[12.5px]"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="mt-2 h-8 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white disabled:opacity-40"
              >
                Post
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <div className="mb-2.5 text-[12px] font-medium uppercase tracking-wider text-faint">
              History
            </div>
            <div className="flex flex-col gap-2 text-[12.5px] text-muted">
              {events.map((ev) => (
                <div key={ev.id} className="flex gap-2">
                  <span className="w-14 shrink-0 text-faint">
                    {formatDate(ev.createdAt.slice(0, 10))}
                  </span>
                  <span className="min-w-0">
                    {ev.kind.replace(/_/g, " ")}
                    {ev.detail && (
                      <>
                        {" — "}
                        <span className="font-medium text-foreground">{ev.detail}</span>
                      </>
                    )}
                  </span>
                </div>
              ))}
              {events.length === 0 && <p className="text-faint">Nothing recorded yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
