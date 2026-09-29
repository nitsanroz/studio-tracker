"use client";

// One candidate, read top to bottom as a story: what they sent, what each
// interviewer heard, what the two of you said to each other, what was decided.
//
// ⚠️ THE SCORECARDS ARE THE POINT OF THIS PAGE, and they are SEPARATE per
// interview on purpose. Michal's phone screen and Nitsan's own interview each
// get their own card, so where the two of them disagreed survives — a single
// shared scorecard would let whoever typed last overwrite the other's reading.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  FileText,
  Globe,
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
import { useIsNarrow } from "@/lib/use-is-narrow";
import { MobileSheet } from "@/components/mobile-sheet";
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
  scoreApplication,
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
  NEW_CANDIDATE_PARAM,
  type CandidateDetail,
  type CandidateLinkKind,
  type CandidateRole,
  splitApplicationReview,
  type ScoreSubject,
} from "@/lib/candidates/types";

/**
 * What kind of meeting a scorecard describes.
 *
 * ⚠️ "Application review" IS DELIBERATELY NOT HERE ANY MORE. Reading a CV, a
 * portfolio and a covering mail is still scored on the same card and still
 * stored in the same table — but it is not a meeting, and it is no longer a
 * card you add: the grid lives beside the application text and its row is
 * created by the first score. Offering the kind here would let a second one be
 * made by hand, which is the state `splitApplicationReview` then has to
 * tolerate rather than the one it should invite.
 *
 * ⚠️ The column is TEXT, not an enum, and the picker tolerates a value it does
 * not know: the Asana import writes the board's own column names as the kind,
 * and a `<select>` that silently dropped an unrecognised one would rewrite the
 * label on an interview that happened two years ago — which is also what keeps
 * an old second "Application review" readable if one exists.
 */
const INTERVIEW_KINDS = [
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
  scores,
  onSet,
}: {
  subject: ScoreSubject;
  /** ⚠️ THE SCORES, NOT AN INTERVIEW — the application scorecard draws this
      grid before any interview row exists. */
  scores: Record<string, number>;
  onSet: (paramId: string, value: number | null) => void;
}) {
  const avg = subjectAverage(subject, scores);
  const params = subject.params.filter((p) => p.active || typeof scores[p.id] === "number");
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
        const v = scores[p.id];
        return (
          <div key={p.id} className="flex items-center gap-2 py-0.5 text-[13px] md:text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-muted" title={p.name}>
              {p.name}
            </span>
            <select
              value={typeof v === "number" ? String(v) : ""}
              onChange={(e) => onSet(p.id, e.target.value ? Number(e.target.value) : null)}
              aria-label={`${subject.name} — ${p.name}`}
              /* ⚠️ 44px tall on a phone — this is the control the whole
                 section exists to use, and at 24px it was the smallest target
                 on the page. The WIDTH stays: the column is a list of numbers
                 and a wider box would pull each one away from its label. */
              className={`h-11 w-11 cursor-pointer appearance-none rounded bg-transparent py-0.5 text-right text-[12.5px] font-semibold hover:bg-background md:h-auto ${
                TONE[scoreTone(typeof v === "number" ? v : null)]
              }`}
            >
              {/* ⚠️ "" IS NOT 0, AND THE TEST BELOW RELIES ON THAT. An empty
                  value clears the score and DELETES the row — absent means
                  "not scored" and counts toward no average — while 0 is a real
                  reading that counts as a zero. The guard is `e.target.value ?
                  …` and it works because the string "0" is truthy; a numeric
                  check would collapse the two and silently delete every zero. */}
              <option value="">—</option>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
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

/** Type and horizontal metrics for the two auto-sized fields in the header. */
/**
 * ⚠️ BIGGER ON A PHONE THAN ON A LAPTOP, WHICH IS THE OPPOSITE OF THE USUAL
 * RULE — Nitsan, 2026-09-29: "on mobile make name of candidate bigger
 * significantly". It is right here: on a desktop the name shares the top of the
 * page with the score, the contacts, the files and the controls, so 32px is
 * already the largest thing in a crowded band. On a 375px screen those all fall
 * onto separate lines and the name has a row to itself, where 32px reads as one
 * more line rather than as the title of the page.
 */
const NAME_BOX =
  "keeps-font-size rounded-md border border-transparent px-1 font-serif-accent " +
  "text-[40px] leading-tight md:text-[32px]";
const CONTACT_BOX = "min-h-11 rounded border border-transparent px-1 py-0.5 text-[13px] md:min-h-0";

/**
 * A date field whose picker glyph sits next to the number rather than adrift
 * from it, and stays out of sight until you reach for it.
 *
 * `"tight"` pulls the glyph in against the digits, for a bare field in a line
 * of prose; `"boxed"` leaves it at the right edge, where the field has a
 * border of its own to sit against.
 *
 * ⚠️ THE GAP WAS THE GLYPH'S OWN MARGIN, NOT SLACK IN THE FIELD — and I got
 * that wrong first time round. I measured the date text with a canvas (67px),
 * compared it to the input's 123px and concluded there were ~48px going spare,
 * so I pinned the width to 94px. That clipped the last digit, because a canvas
 * measure is not how a browser lays out date SEGMENTS: asked directly, it wants
 * **119px** for this font. So there was only ever 4px of slack, and the fix is
 * entirely in `::-webkit-calendar-picker-indicator`'s own box.
 *
 * ⚠️ NO EXPLICIT WIDTH. It would have to be re-tuned for every font size and
 * date locale this field ever renders in, and being one pixel short crops a
 * digit — which is exactly what happened.
 *
 * ⚠️⚠️ THE MARGIN IS SET HERE AND NOWHERE ELSE, AND IT IS A PARAMETER RATHER
 * THAN A DEFAULT A CALLER OVERRIDES. It briefly was the latter: this constant
 * set `m-0` while the Applied field set `-ml-5` on the same element — two
 * utilities, one property, identical specificity, so the winner was decided by
 * Tailwind's emit order and not by anything written here. Making the caller
 * supply the margin instead would have fixed the collision by handing every
 * future call site an undocumented obligation: forget it and the browser's
 * 20px gap comes back silently. One owner, one utility per element, chosen in
 * JavaScript where you can see it.
 */
/**
 * ⚠️ EVERY CLASS NAME BELOW IS SPELLED OUT IN FULL, and the repetition is the
 * price of that. Tailwind finds utilities by scanning this file as TEXT, so a
 * name assembled at runtime — `${prefix}-ml-5` — is never generated and the
 * rule simply does not exist in the stylesheet. Do not factor the shared
 * `[&::-webkit-calendar-picker-indicator]:` prefix out into a variable.
 */
/**
 * ⚠️ THE GLYPH IS ALWAYS VISIBLE BELOW `md`, AND THAT IS NOT A STYLE CHOICE.
 * Hiding it until hover is right on a laptop — it is a second calendar icon on
 * a field that is read far more often than it is changed — but a touch screen
 * never hovers, so on a phone the only affordance for opening the picker was
 * one that could not be triggered. `max-md:` wins over the `hover:` rule by
 * source order, so the two do not fight.
 */
const DATE_GLYPH =
  "[&::-webkit-calendar-picker-indicator]:my-0 [&::-webkit-calendar-picker-indicator]:mr-0 " +
  "[&::-webkit-calendar-picker-indicator]:p-0 " +
  "[&::-webkit-calendar-picker-indicator]:opacity-0 hover:[&::-webkit-calendar-picker-indicator]:opacity-60 " +
  "max-md:[&::-webkit-calendar-picker-indicator]:opacity-60";

function dateField(pull: "tight" | "boxed"): string {
  return pull === "tight"
    ? `[&::-webkit-calendar-picker-indicator]:-ml-5 ${DATE_GLYPH}`
    : `[&::-webkit-calendar-picker-indicator]:ml-0 ${DATE_GLYPH}`;
}

/** LinkedIn's mark. Lucide dropped brand icons, so this is drawn here. */
function LinkedInMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM2.4 21.5h5.2V9.5H2.4v12zM9.9 9.5h4.98v1.64h.07c.7-1.25 2.4-2.14 4.05-2.14 4.33 0 5 2.6 5 5.98v6.52h-5.2v-5.78c0-1.38-.02-3.15-2-3.15-2 0-2.3 1.5-2.3 3.05v5.88H9.9v-12z" />
    </svg>
  );
}

/**
 * A CHIP THAT IS REALLY A <select>. Two fields in the meta row use it — where
 * the application came from, and which role they are up for — and they must
 * look the same, because they read as one row of facts about one person.
 *
 * ⚠️ BOTH EMPTY STATES ARE THE SAME CHIP — Nitsan, 2026-09-28: "no role chip
 * state should look like other no state chip". They drifted because I built
 * them a day apart, one as a chip and one as a bare select, and the meta row
 * ended up with two different ways of saying "nothing here yet" side by side.
 * One component is the fix; two matching class strings would drift again.
 *
 * ⚠️ THE SELECT IS INVISIBLE AND COVERS THE WHOLE CHIP. It is a real
 * <select>, so the keyboard and the screen reader get a real control and the
 * platform draws its own menu; the chip is only its face. Do not swap it for a
 * div with a click handler.
 */
function ChipSelect({
  value,
  label,
  icon,
  placeholder,
  ariaLabel,
  onPick,
  children,
}: {
  value: string | null;
  /** What to show when something IS chosen — the option's own wording. */
  label: string;
  /** Shown only when something is chosen; see the empty-state note below. */
  icon?: React.ReactNode;
  placeholder: string;
  ariaLabel: string;
  onPick: (next: string | null) => void;
  children: React.ReactNode;
}) {
  const set = Boolean(value);
  return (
    <span
      /* ⚠️ `focus-within:border-brand` IS NOT DECORATION. The real <select> is
         `opacity-0`, which hides the browser's own focus ring with it — so
         without this the keyboard lands on this control and NOTHING on screen
         changes, twice in a row, on two chips that sit side by side. The chip
         has to wear the focus the select cannot show. Same treatment
         `task-autocomplete` and `task-panel` use. */
      className={`relative inline-flex min-h-11 items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-2 text-[11.5px] focus-within:border-brand focus-within:text-brand md:min-h-0 ${
        set
          ? "border-border bg-surface text-muted"
          : "border-dashed border-border-strong text-faint hover:border-brand hover:text-brand"
      }`}
    >
      {/* ⚠️ NO ICON ON THE EMPTY STATE. The one that used to sit on "Where
          from" was a generic link glyph on a field that has nothing to do with
          links — Nitsan called it irrelevant and he was right. An icon earns
          its place by saying WHICH channel, or WHICH role; with nothing picked
          it has nothing to say. */}
      {set && icon && <span className="flex shrink-0 items-center">{icon}</span>}
      {set ? label : placeholder}
      <ChevronDown size={12} strokeWidth={1.75} className="shrink-0 opacity-60" />
      <select
        value={value ?? ""}
        onChange={(e) => onPick(e.target.value || null)}
        aria-label={ariaLabel}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {children}
      </select>
    </span>
  );
}

/**
 * WHERE THE APPLICATION CAME FROM — a chip you pick, not a box you type in.
 *
 * ⚠️ IT WAS FREE TEXT AND SHOULD NOT HAVE BEEN — Nitsan, 2026-09-28. There
 * are three answers: they found the post on LinkedIn, they wrote to
 * jobs@nmore.co, or they came through the site. A text box invites "linkedin",
 * "LinkedIn.com", "li" and "thru linked in" for the same fact, and then the
 * question this field exists to answer — which channel is actually bringing
 * people in — cannot be counted.
 *
 * ⚠️ A STORED VALUE THAT IS NOT ONE OF THE THREE GETS ITS OWN OPTION rather
 * than being dropped. 270 imported rows say "Asana import" — provenance of the
 * ROW, not of the person — and a select whose value is missing from its options
 * renders as something else entirely, which is how a field silently rewrites
 * itself the first time anybody opens the menu.
 */
const SOURCES = [
  { value: "LinkedIn", icon: <LinkedInMark /> },
  { value: "Email", icon: <Mail size={12} strokeWidth={1.75} /> },
  { value: "Website", icon: <Globe size={12} strokeWidth={1.75} /> },
];

function SourceChip({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (next: string | null) => void;
}) {
  const known = SOURCES.find((s) => s.value === value);
  return (
    <ChipSelect
      value={value}
      label={`from ${value}`}
      icon={known?.icon}
      placeholder="Where from"
      ariaLabel="Where the application came from"
      onPick={onPick}
    >
      <option value="">Not set</option>
      {SOURCES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.value}
        </option>
      ))}
      {value && !known && <option value={value}>{value}</option>}
    </ChipSelect>
  );
}

/**
 * Which role they are up for — the same chip as `SourceChip`, and deliberately
 * the same SHAPE of component so the meta row has one pattern rather than one
 * component and one inlined copy of it.
 *
 * ⚠️ THE STALE-VALUE GUARD IS THE REASON THIS EXISTS RATHER THAN BEING
 * INLINED. A `<select>` whose value is missing from its options does not show
 * nothing — it shows the FIRST option, so a role deleted in Settings while
 * this page was open would silently read as "No role" while the chip face went
 * blank. Both chips now carry that guard in one place each, written once.
 */
function RoleChip({
  roleId,
  roles,
  onPick,
}: {
  roleId: string | null;
  roles: CandidateRole[];
  onPick: (next: string | null) => void;
}) {
  const role = roles.find((r) => r.id === roleId);
  const label = role?.name ?? "Role removed";
  return (
    <ChipSelect
      value={roleId}
      label={label}
      icon={role && <span className="size-2 rounded-full" style={{ backgroundColor: role.color }} />}
      placeholder="No role"
      ariaLabel="Role"
      onPick={onPick}
    >
      <option value="">No role</option>
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
      {roleId && !role && <option value={roleId}>{label}</option>}
    </ChipSelect>
  );
}

/**
 * An <input> exactly as wide as what is in it, never wider.
 *
 * ⚠⚠ THIS REPLACED TWO DIFFERENT GUESSES AT THE SAME QUESTION, made in the
 * same header row on the same day. The name field counted characters
 * (`1ch` each, then `0.8ch` each) and the contact fields stepped between two
 * fixed widths on focus — and both were wrong for the same reason: there is no
 * constant that is right for "Yuval", a Hebrew name, "+972…" and
 * firstname.lastname@example.com at once. An empty 160px box reading "Phone"
 * claimed more of the row than a filled one does, which is what forced the
 * meta group onto a second line.
 *
 * ⚠️ HOW: the mirror span below holds the same text in the same type, the
 * grid cell takes ITS width, and the input lies on top and fills it. Exact in
 * any script, no measurement, no constant to re-tune when the font changes.
 *
 * ⚠️ BOTH CHILDREN WEAR `box`, and that is the whole invariant. They must
 * agree on type and horizontal box metrics or the caret sits a pixel or two
 * off its own text — so the class is passed ONCE and applied to both, rather
 * than written twice at the call site and kept in step by hand.
 *
 * ⚠️ `field-sizing: content` is the one-line version of this and is NOT
 * usable: Safari is most of the studio (CLAUDE.md) and does not ship it.
 *
 * ⚠️ The mirror follows the input as you TYPE, through the DOM rather than
 * through state — a keystroke should not re-render the page, and the input is
 * uncontrolled everywhere it is used.
 */
function AutoWidthInput({
  box,
  className = "",
  minWidth,
  inputRef,
  onInput,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  /** Type and horizontal metrics, applied to the mirror AND the input. */
  box: string;
  /** Floor, so an empty field is still a target you can click. */
  minWidth: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const mirror = useRef<HTMLSpanElement>(null);
  const shown = String(props.defaultValue ?? props.value ?? "") || (props.placeholder ?? "");
  return (
    /**
     * ⚠️ THE INPUT IS TAKEN OUT OF FLOW, and it has to be. Side by side in a
     * grid cell the input still contributes its OWN intrinsic width to the
     * track — a browser default of about 20 characters, which `min-w-0` does
     * not suppress — so an empty field measured 136px instead of the 45px its
     * placeholder needs, and the header wrapped exactly as before. Absolute
     * positioning makes the mirror the only thing the box is measured from.
     */
    <span className="relative inline-block max-w-full" style={{ minWidth }}>
      <span ref={mirror} aria-hidden className={`block invisible whitespace-pre ${box}`}>
        {shown}
      </span>
      <input
        {...props}
        ref={inputRef}
        onInput={(e) => {
          if (mirror.current) {
            mirror.current.textContent = e.currentTarget.value || (props.placeholder ?? "");
          }
          onInput?.(e);
        }}
        className={`absolute inset-0 w-full min-w-0 ${box} ${className}`}
      />
    </span>
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
        <AutoWidthInput
          box={CONTACT_BOX}
          minWidth="4rem"
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
          className="bg-transparent hover:border-border focus:border-border focus:bg-surface focus:outline-none"
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
        className="min-h-11 rounded px-1 py-0.5 text-[13px] text-foreground hover:bg-brand-soft md:min-h-0"
      >
        {copied ? <span className="text-success">Copied</span> : value}
      </button>
      <button
        onClick={() => setEditing(true)}
        aria-label={`Edit ${placeholder.toLowerCase()}`}
        title="Edit"
        /* ⚠️ ALWAYS SHOWN BELOW `md`. A touch screen never hovers, so the only
           way to EDIT a phone number rather than copy it was an affordance that
           could not be revealed — the contact value itself is a copy button. */
        className="flex size-11 items-center justify-center rounded text-faint opacity-100 transition-opacity hover:text-foreground md:size-auto md:p-0.5 md:opacity-0 md:group-hover/f:opacity-100"
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
  /**
   * ⚠️ THE EDIT SHEET IS PHONE-ONLY AND `isNarrow` IS WHAT DECIDES IT, not a
   * `md:hidden`. The point is that only ONE of the two presentations exists at
   * a time — CSS would mount both, which for the link form and the CV upload
   * would mean two file inputs and two half-typed forms in the document.
   */
  const [editOpen, setEditOpen] = useState(false);
  const isNarrow = useIsNarrow();
  /**
   * Which interviews the reader has opened or shut BY HAND.
   *
   * ⚠️⚠️ AN OVERRIDE MAP, NOT A SET OF FOLDED IDS, AND THE DIFFERENCE IS LOAD
   * BEARING. The default is now computed — everything shut except the latest
   * (Nitsan, 2026-09-29: "its the recent more relevant one") — so a set of
   * closed ids would have to be SEEDED, and the only place to seed it is an
   * effect keyed on the loaded detail. `run()` reloads after EVERY write,
   * including setting a single score, so that effect would re-fold a card
   * while somebody was scoring in it. Deriving the default and remembering
   * only the explicit toggles cannot do that: nothing writes this map except a
   * press on the chevron.
   *
   * ⚠️ Per-visit rather than stored, like the client table's folded sections: a
   * fold is how you read a page today, not a preference about this candidate.
   */
  const [openOverride, setOpenOverride] = useState<Map<string, boolean>>(new Map());
  const toggleFold = useCallback((id: string, wasOpen: boolean) => {
    setOpenOverride((prev) => new Map(prev).set(id, !wasOpen));
  }, []);

  /**
   * ⚠️ ARRIVING FROM "ADD CANDIDATE": the cursor belongs in the name field,
   * with the placeholder SELECTED so the first keystroke replaces it — Nitsan
   * asked for exactly that. Landing on a page called "New candidate" and having
   * to find the name to change it is the whole friction the button removes.
   *
   * ⚠️ `window.location.search`, not `useSearchParams`, which would force
   * this page into a Suspense boundary for one throwaway flag.
   *
   * ⚠️ IT FIRES ONCE. `focused` latches, so a later reload (every save calls
   * one) cannot yank the cursor out of whatever field is being typed in.
   */
  const nameRef = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  const ready = Boolean(detail);
  useEffect(() => {
    if (!ready || focused.current) return;
    if (!new URLSearchParams(window.location.search).has(NEW_CANDIDATE_PARAM)) return;
    focused.current = true;
    nameRef.current?.focus();
    nameRef.current?.select();
    /**
     * ⚠️ SPEND THE FLAG. Left in the URL it fires again on every later
     * reload of this page — and what it does is SELECT THE WHOLE NAME, so
     * somebody who reopens a candidate an hour later is one stray keystroke
     * away from replacing a saved name, which `onBlur` then writes.
     *
     * ⚠️ `history.replaceState`, not `router.replace`: this only needs the
     * address bar tidied, and re-entering the route would re-run the page for
     * a flag it has already consumed.
     */
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      // Nothing depends on it; the flag is already spent in `focused`.
    }
  }, [ready]);

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

  const { candidate: c, links, comments, events } = detail;
  // ⚠️ THE APPLICATION SCORECARD IS LIFTED OUT OF THE INTERVIEW LIST, but stays
  // in `detail.interviews` for every SCORING figure below: it is an opinion,
  // and `overallScore` already weighs it least because it is dated earliest.
  // What it is not is a meeting, so it does not render as one and is not
  // counted as one.
  const { application, interviews } = splitApplicationReview(detail.interviews);
  /**
   * The most recent interview — the one that stays open.
   *
   * ⚠️ ORDERED BY WHEN IT HAPPENED (`heldOn`), FALLING BACK TO WHEN THE CARD
   * WAS MADE, which is the rule `overallScore` already weights by. The two must
   * agree: the card left open should be the one carrying the most weight in the
   * figure at the top, or the page would open on one reading and headline
   * another. It also means an interview you have just ADDED is the latest
   * thing known and opens itself, which is what you want a beat before filling
   * it in.
   */
  const latestInterviewId =
    interviews.length === 0
      ? null
      : interviews.reduce((a, b) => ((a.heldOn ?? a.createdAt) > (b.heldOn ?? b.createdAt) ? a : b))
          .id;
  const stage = vocab.stages.find((s) => s.id === c.stageId) ?? null;
  const overall = overallScore(detail.interviews);
  const scoredCount = detail.interviews.filter((i) => Object.keys(i.scores).length > 0).length;
  /** The subjects a portfolio can actually answer — see `fromSubmission`. */
  const submissionSubjects = vocab.subjects.filter((s) => s.fromSubmission);
  const applicationScores = application?.scores ?? {};
  const applicationAvg = interviewAverage(applicationScores);
  /**
   * ⚠️ ONE DEFINITION, TWO PLACES — the trap this codebase has paid for three
   * times (the `.brand-wordmark` instances in v1.32.1 and v1.12.1). A single
   * DOM order cannot serve both shapes: on a desktop the figure heads the
   * right-hand cluster it shares with Owner and Stage, while on a phone that
   * cluster falls below the files and the figure would arrive four rows under
   * the name it belongs with. Declared once so the two cannot drift.
   */
  const scoreFigure = (
    <>
      {/* ⚠️ SMALLER THAN THE NAME ON A PHONE AND BIGGER THAN IT ON A LAPTOP,
          and both are right. On a desktop the figure has to carry across a
          1500px page full of chips and controls. On a 375px line it sits
          directly beside the name, where at 44px it read as the headline and
          the person read as its caption. */}
      <div
        className={`font-serif-accent text-[32px] leading-none md:text-[44px] ${TONE[scoreTone(overall)]}`}
      >
        {formatScore(overall)}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-faint md:text-[11px]">
        {overall === null
          ? "not scored yet"
          : `across ${scoredCount} ${scoredCount === 1 ? "reading" : "readings"}`}
      </div>
    </>
  );

  const role = c.roleId ? (vocab.roles.find((r) => r.id === c.roleId) ?? null) : null;
  const cv = links.filter((l) => l.kind === "cv");
  const others = links.filter((l) => l.kind !== "cv");

  /**
   * Everything about the person that is EDITED rather than read — the two
   * contact fields and the meta row (applied, where from, role).
   *
   * ⚠️⚠️ HOISTED SO IT CAN BE RENDERED IN ONE OF TWO PLACES, NEVER BOTH.
   * On a desktop it sits in the header beside the name. On a phone it moves
   * wholesale into the edit sheet, and the header shows a read-only summary
   * instead — Nitsan, 2026-09-29: the inline pencils and trash icons were
   * spending a third of a 375px header on affordances, when what a phone
   * mostly does with this page is READ it. Declared once and rendered under
   * an `isNarrow` branch, so unlike the wordmark and the score figure there
   * is no second copy that can drift.
   */
  const detailFields = (
    <>
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

            {/* ⚠️ ONE ROW, NOT TWO — Nitsan, 2026-09-28: "all these should
                be in same div". Name, phone, mail, the applied date and the
                two chips are one sentence about one person, and splitting
                them over two lines spent a whole band of the page on a gap.
                They still WRAP as a group on a narrow window; what changed
                is that the break is no longer forced at full width. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-muted">
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
                  /* ⚠️ −20px ON THE INDICATOR, NOT A NARROWER FIELD — Nitsan,
                     2026-09-28, asked for 20px out of the gap. Chrome sizes a
                     date input to 119px here and reserves ~35px of slack past
                     the digits, which is where that gap comes from. Setting an
                     explicit width is what CROPPED A DIGIT last time (94px);
                     pulling the indicator left eats the slack instead, and the
                     field shrinks to 99px on its own with every segment intact. */
                  className={`min-h-11 rounded border border-transparent px-1 py-0.5 hover:border-border focus:border-border focus:outline-none group-hover/d:[&::-webkit-calendar-picker-indicator]:opacity-60 md:min-h-0 ${dateField("tight")}`}
                />
              </label>
              <SourceChip
                value={c.source}
                onPick={(v) => void run(() => updateCandidate(c.id, { source: v }, currentUserId))}
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
              {/* ⚠️ THE ROLE IS SET HERE AND NOWHERE ELSE — Nitsan, 2026-09-28:
                  "i'm not sure i have an option to set, edit a role of a
                  candidate". He was right: this was a read-only span, drawn ONLY
                  when a role was already set, so the one field the Asana import
                  could never fill was the one field the app gave you no way to
                  fill either. An empty state that renders as nothing is not a
                  quiet control, it is a missing one.

                  ⚠️ IT STAYS IN THE META ROW, not beside Owner and Stage. His
                  own words: a role is "more like a tag", the studio hires
                  designers and rarely two kinds at once. A third select in the
                  loud cluster would claim it matters as much as who is holding
                  the person, which is the opposite of what he asked for when he
                  had the board filter made shy. */}
              <RoleChip
                roleId={c.roleId}
                roles={vocab.roles}
                onPick={(v) => void run(() => updateCandidate(c.id, { roleId: v }, currentUserId))}
              />
            </div>
    </>
  );

  const filesAndLinks = (
    <>
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
                    /* Same rule as the contact pencil: revealed on hover at a
                       desk, always there on a phone, which has no hover. */
                    className="flex size-11 shrink-0 items-center justify-center rounded-full text-faint opacity-100 hover:text-danger md:size-auto md:p-1 md:opacity-0 md:group-hover:opacity-100"
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
                  className="min-h-11 rounded border border-border bg-surface px-1.5 py-1 text-[12px] md:min-h-0"
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
                  className="min-h-11 w-full rounded border border-border px-2 py-1 text-[12px] md:min-h-0 md:w-56"
                />
                <input
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="Label (optional)"
                  className="min-h-11 w-full rounded border border-border px-2 py-1 text-[12px] md:min-h-0 md:w-36"
                />
                <button
                  type="submit"
                  disabled={!linkUrl.trim()}
                  className="h-11 flex-1 rounded-md bg-brand px-2.5 text-[12px] font-medium text-white disabled:opacity-40 md:h-7 md:flex-none"
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
                  className="h-11 flex-1 rounded-md border border-border px-2 text-[12px] md:h-7 md:flex-none"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <label
                  className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[11.5px] hover:border-brand hover:text-brand md:min-h-0 ${
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
                  className="flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[11.5px] text-muted hover:border-brand hover:text-brand md:min-h-0"
                >
                  <Link2 size={12} strokeWidth={1.75} /> Add a link
                </button>
              </>
            )}
          </div>
    </>
  );

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
            {/* ⚠️ ITS OWN LINE BELOW `md`. The name auto-sizes to its text, so
                at 375px an empty "Phone" placeholder floated up beside it and
                the two read as one field. Above md the wrapper is `w-auto` and
                the original single wrapping row is unchanged. */}
            {/* ⚠️ `md:contents` — above md the wrapper leaves the layout and the
                name is a direct child of the wrapping row again, exactly as it
                was. Below it, the name gets a row to itself and the score
                follows immediately, instead of arriving four rows of chips
                later at the bottom of the header.

                ⚠️ THE TWO ARE STACKED, NOT SIDE BY SIDE, AND THAT WAS MEASURED.
                Sharing the line left the name 233px against the ~250px that
                "Hadar Lozon" needs at 40px — and an `<input>` cannot ellipsize,
                it scrolls, so the last letter was simply cut off with nothing
                to say so. Studio names run median 12 characters, so that would
                have clipped the ordinary case, not an outlier. */}
            <div className="w-full md:contents">
            <AutoWidthInput
              box={NAME_BOX}
              minWidth="6ch"
              inputRef={nameRef}
              defaultValue={c.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== c.name) void run(() => updateCandidate(c.id, { name: v }, currentUserId));
              }}
              className="bidi-auto hover:border-border focus:border-border focus:outline-none"
            />
              <div className="mt-1 md:hidden">{scoreFigure}</div>
            </div>
            {!isNarrow && detailFields}
          </div>

          {!isNarrow && filesAndLinks}

          {/* ── the phone's read-only summary ──
              ⚠️ A SEPARATE, DELIBERATELY DIFFERENT PRESENTATION, not the same
              markup with the controls hidden. Phone and email become `tel:` and
              `mailto:` links, which is the single most useful thing this page
              can offer on a phone and is not something the editable version can
              do — its value IS a copy button. Everything here is a fact; every
              way to change one is behind the button at the end. */}
          {isNarrow && (
            <div className="mt-3 flex flex-col gap-2 text-[13px]">
              {(c.phone || c.email) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 text-foreground">
                      <Phone size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
                      {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex min-w-0 items-center gap-1.5 text-foreground">
                      <Mail size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
                      <span className="truncate">{c.email}</span>
                    </a>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted">
                {c.appliedOn && (
                  <span>
                    <span className="text-faint">Applied</span> {formatDate(c.appliedOn)}
                  </span>
                )}
                {c.source && <span>{c.source}</span>}
                {role && (
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: role.color }}
                      aria-hidden
                    />
                    {role.name}
                  </span>
                )}
              </div>

              {/* The files stay TAPPABLE here — opening a CV is most of what
                  this page is for on a phone — they simply lose their trash. */}
              {[...cv, ...others].length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {[...cv, ...others].map((l) => {
                    const safe = isSafeUrl(l.url) || l.url.startsWith("/api/");
                    return safe ? (
                      <a
                        key={l.id}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12px] text-muted"
                      >
                        {l.kind === "cv" ? (
                          <FileText size={12} strokeWidth={1.75} />
                        ) : (
                          <ExternalLink size={12} strokeWidth={1.75} />
                        )}
                        {l.title}
                      </a>
                    ) : (
                      <span
                        key={l.id}
                        className="flex min-h-11 items-center rounded-full border border-border px-3 text-[12px] text-faint line-through"
                        title={l.url}
                      >
                        {l.title}
                      </span>
                    );
                  })}
                </div>
              )}

              <button
                onClick={() => setEditOpen(true)}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface text-[13px] font-medium"
              >
                <Pencil size={14} strokeWidth={1.75} /> Edit details &amp; files
              </button>
            </div>
          )}

        </div>

        {/* ── the figure, and the controls under it ──
            ⚠️ Every score anybody has given them, weighted toward the latest —
            see `overallScore`. Deliberately the biggest thing on the page after
            the name: it is the one number you want from across the room, and
            the per-interview averages below are where it comes from.
            ⚠️ THE CONTROLS SIT WITH IT RATHER THAN IN A BAR BENEATH A RULE.
            Nitsan's call: a full-width row under a divider read as a toolbar
            for the whole page, when it only ever acts on this one person. */}
        {/* ⚠️ FULL WIDTH AND LEFT-ALIGNED ON A PHONE. Right-aligned in a 375px
            column the figure sat alone above a stack of right-edged selects,
            which reads as three separate things rather than one cluster about
            this person. */}
        <div className="flex w-full shrink-0 flex-col items-start gap-3 md:w-auto md:items-end">
          <div className="hidden text-right md:block">{scoreFigure}</div>

          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
            <select
              value={c.ownerId ?? ""}
              onChange={(e) =>
                void run(() => updateCandidate(c.id, { ownerId: e.target.value || null }, currentUserId))
              }
              className="h-11 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-[13px] md:h-9 md:w-auto"
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
                className="h-11 min-w-0 flex-1 rounded-lg border border-[#c9d6fb] bg-brand-soft px-2 text-[13px] font-medium text-brand-dark md:h-9 md:flex-none"
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
                className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] md:h-9 md:flex-none"
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
                className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:text-foreground md:size-9"
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
                          // ⚠️ NAMED SEPARATELY, because it is no longer counted
                          // as an interview anywhere — so without this line the
                          // one thing the delete destroys silently is the read
                          // somebody actually recorded.
                          Object.keys(application?.scores ?? {}).length &&
                            "the application scorecard",
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
          {/* application — the text they sent, and the studio's first read of it */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-[12px] font-medium uppercase tracking-wider text-faint">
                Application
              </span>
              {c.appliedOn && (
                <span className="text-[11px] text-faint">applied {formatDate(c.appliedOn)}</span>
              )}
              <span className={`ml-auto text-sm font-semibold ${TONE[scoreTone(applicationAvg)]}`}>
                {formatScore(applicationAvg)}
                <span className="ml-1 text-[11px] font-normal text-faint">first read</span>
              </span>
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

            {/* ⚠️ ALWAYS HERE, NEVER ADDED. A judgement formed from the mail, the
                CV and the portfolio is one you have already made by the time you
                finish reading — so it is a grid to fill in, not a card to opt
                into. The row behind it is created by the first score. */}
            {submissionSubjects.length > 0 && (
              <div className="mt-3 grid gap-x-5 border-t border-border pt-3 sm:grid-cols-2">
                {submissionSubjects.map((s) => (
                  <SubjectColumn
                    key={s.id}
                    subject={s}
                    scores={applicationScores}
                    onSet={(paramId, value) =>
                      void run(() =>
                        scoreApplication(c.id, paramId, value, c.appliedOn, currentUserId),
                      )
                    }
                  />
                ))}
              </div>
            )}
            {/* ⚠️ Said out loud rather than left as an absence, because the
                missing column is the one somebody will look for. */}
            <p className="mt-2 text-[11px] leading-snug text-faint">
              Only what a submission can answer — a portfolio is not a person, so the subjects that
              need a conversation are on the interviews below.
            </p>
          </div>

          {/* interviews */}
          {interviews.map((iv) => {
            const who = iv.interviewerId ? profileById.get(iv.interviewerId) : null;
            const avg = interviewAverage(iv.scores);
            const shut = !(openOverride.get(iv.id) ?? iv.id === latestInterviewId);
            const scored = Object.keys(iv.scores).length;
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
                    className="min-h-11 rounded border border-transparent bg-transparent px-1 py-1 text-sm font-medium hover:border-border focus:border-border focus:outline-none md:min-h-0"
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
                    className="min-h-11 rounded border border-border bg-surface px-1.5 py-1 text-[12px] text-muted md:min-h-0"
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
                    className={`min-h-11 rounded border border-border bg-surface px-1.5 py-1 text-[12px] text-muted md:min-h-0 ${dateField("boxed")}`}
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
                  {/* ⚠️ THE AVERAGE STAYS VISIBLE WHEN FOLDED, and that is what
                      makes folding worth having: the figure is the reason to
                      keep a card on screen, the eleven rows behind it are not.
                      A fold that hid the number would just be a delete you can
                      undo. */}
                  <button
                    onClick={() => toggleFold(iv.id, !shut)}
                    aria-expanded={!shut}
                    aria-label={shut ? `Open this ${iv.kind.toLowerCase()}` : `Fold this ${iv.kind.toLowerCase()} away`}
                    title={shut ? "Open" : "Fold away"}
                    className="flex size-11 items-center justify-center rounded text-faint hover:text-foreground md:size-auto md:p-1.5"
                  >
                    <ChevronDown
                      size={15}
                      strokeWidth={1.75}
                      className={`transition-transform ${shut ? "-rotate-90" : ""}`}
                    />
                  </button>
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
                    className="flex size-11 items-center justify-center rounded text-faint hover:text-danger md:size-auto md:p-1.5"
                  >
                    <Trash2 size={14} strokeWidth={1.75} />
                  </button>
                  </span>
                </div>

                {/* ⚠️ THE BODY IS UNMOUNTED WHEN FOLDED, NOT HIDDEN WITH CSS,
                    and the summary textarea is why: it is UNCONTROLLED
                    (`defaultValue`, committing on blur), so keeping it in the
                    DOM behind `hidden` would leave a half-typed note alive and
                    invisible, saving on some later blur nobody could see coming.
                    Unmounting is safe because the chevron is a BUTTON: pressing
                    it moves focus off the textarea, which fires `onBlur` and
                    commits, and only then does the fold take the element away. */}
                {!shut && (
                  <>
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
                          scores={iv.scores}
                          onSet={(paramId, value) => void run(() => setScore(iv.id, paramId, value, c.id))}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* ⚠️ A FOLDED CARD SAYS WHAT IS BEHIND IT. Without this the
                    summary and the scores vanish with nothing standing in for
                    them, which reads as an empty interview rather than a
                    closed one — the failure the client table's folded sections
                    already solved by keeping their subtotals. */}
                {shut && (
                  <p className="mt-2 text-[12px] text-faint">
                    {[
                      scored > 0 && `${scored} score${scored === 1 ? "" : "s"}`,
                      iv.summary?.trim() && "a summary",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Nothing recorded yet"}
                  </p>
                )}
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
                /* The 16px floor that stops iOS zooming on focus is a global
                   rule in globals.css (v1.12.0) — nothing to repeat here. */
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="mt-2 h-11 w-full rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white disabled:opacity-40 md:h-8 md:w-auto"
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

      {/* ── the phone's edit sheet ──
          ⚠️ IT HOLDS THE SAME CONTROLS THE DESKTOP HEADER DOES, moved rather
          than rebuilt — see `detailFields`. Everything inside commits on its own
          (blur, change, submit) exactly as it does at a desk, so the sheet needs
          no Save: there is nothing it could save that has not been written
          already, and a Save button that did nothing would be worse than none.
          ⚠️ The name is NOT in here — it is the page's title and is edited in
          place, where you can see what you are changing.
          ⚠️ `title` is the sheet's ARIA LABEL and is never drawn — MobileSheet
          shows no heading — so it is written for a screen reader, with the word
          "and" rather than the ampersand the button uses. */}
      {isNarrow && editOpen && (
        <MobileSheet title="Edit details and files" onClose={() => setEditOpen(false)}>
          <div className="flex flex-col gap-5 pb-2">
            {detailFields}
            {filesAndLinks}
          </div>
        </MobileSheet>
      )}
    </div>
  );
}
