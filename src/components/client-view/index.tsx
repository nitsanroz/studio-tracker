"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  Pencil,
  Plus,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { rollupTasks, sectionBudgetHours } from "@/lib/task-rollup";
import { CollapseChevron, Tabs } from "../ui";
import { ClientAvatar } from "../client-avatar";
import { ClientInfoModal } from "../client-info-modal";
import { ClientNotes } from "../client-notes";
import { ClientTimeline, timelineHint, type Zoom } from "../client-timeline";
import { NO_TYPE, ShowMenu } from "../show-menu";
import {
} from "../editable-cell";
import { ShareGanttButton } from "../share-gantt-button";
import { useColWidths, ResizeHandle } from "../resizable";
import type { Section, Task, TaskGroup } from "@/lib/types";
import { BoardCard } from "./board";
import { SectionGroup, SummaryStrip } from "./section";
import { SelectAllBox, SelectionBar } from "./selection";
import { ALL_COLS, COLS, COL_DEFAULTS, ColWidthsContext, HiddenColsContext, LEAD_TIGHT, NAME_MIN, SelectionContext, drag } from "./shared";
import type { ColKey, SelectionCtx, TaskTab } from "./shared";
import { SortHeader, makeComparator } from "./sort";
import type { Sort, SortKey } from "./sort";
import { ClientStats } from "./stats";
import { ColumnsMenu, TimelineHintDot } from "./toolbar";


export function ClientView({ clientId }: { clientId: string }) {
  const {
    clients,
    sections,
    taskGroups,
    tasks,
    profiles,
    taskTypes,
    taskMinutes,
    addSection,
    addTaskGroup,
    tags,
    updateTask,
  } = useData();
  const isAdmin = useIsAdmin();
  /**
   * The three "what am I not seeing?" settings, held PER TAB.
   *
   * Undated is why: on the Timeline it is off by default (a bar needs an end
   * date, so those rows are listed only when you ask for them), and on Tasks it
   * is on (they are ordinary rows, and hiding them would blank most of the
   * client's work the first time you opened it). One shared value cannot have
   * two defaults, and whichever it picked would look like a bug on the other
   * tab. Completed and the type filter follow suit, so the rule is one rule.
   */
  const [showBy, setShowBy] = useState<
    Record<TaskTab, { done: boolean; undated: boolean; summaries: boolean }>
  >({
    // `summaries` follows the same per-tab rule and for the same reason: the
    // Timeline's left table IS those four figures, and a folded group there is a
    // bar with no numbers unless they are on — while the Tasks tab is already
    // dense and its headers read fine without them.
    tasks: { done: false, undated: true, summaries: false },
    board: { done: false, undated: true, summaries: false },
    timeline: { done: false, undated: false, summaries: true },
  });
  const [hiddenTypesBy, setHiddenTypesBy] = useState<Record<TaskTab, Set<string>>>({
    tasks: new Set(),
    board: new Set(),
    timeline: new Set(),
  });
  const [draggingTask, setDraggingTask] = useState(false);
  // Collapsed-by-exception: sections are open unless their key is in here, so new
  // sections appear expanded. "" stands for the null "No section" group.
  //
  // ⚠️ GROUPS live in this same set under a `g:` prefix (0027), so the header's
  // collapse-all chevron and `allCollapsed` keep working without knowing which
  // kind of thing a key names. Two tables' UUIDs could not realistically collide,
  // but a namespace makes it impossible AND makes the keys readable in a debugger.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Lifted out of ClientTimeline so the zoom control can live on the tab strip.
  // Day by default: at week zoom a one-day task is a 9px sliver and the weekend
  // shading is dropped entirely, so the calendar you land on says least about
  // the days you actually plan in.
  const [zoom, setZoom] = useState<Zoom>("day");
  /** The tab strip's right end, which ClientTimeline portals its toolbar into.
   *  State rather than a ref: the portal has to re-render once the node exists. */
  const [tlToolbar, setTlToolbar] = useState<HTMLElement | null>(null);
  /** Timeline only: draw the bars plain instead of in their type's colour. */
  const [plainBars, setPlainBars] = useState(false);
  /** Which board column the pointer is over, `null` being "No status". */
  const [boardOver, setBoardOver] = useState<string | null | undefined>(undefined);

  const [tab, setTab] = useState<"tasks" | "board" | "timeline" | "overview">("tasks");
  /** Overview has no task list, so it borrows the Tasks tab's settings. */
  const showKey: TaskTab = tab === "timeline" ? "timeline" : tab === "board" ? "board" : "tasks";
  const showDone = showBy[showKey].done;
  const showUndated = showBy[showKey].undated;
  const showSummaries = showBy[showKey].summaries;
  const hiddenTypes = hiddenTypesBy[showKey];
  const setShowDone = (v: boolean) =>
    setShowBy((p) => ({ ...p, [showKey]: { ...p[showKey], done: v } }));
  const setShowUndated = (v: boolean) =>
    setShowBy((p) => ({ ...p, [showKey]: { ...p[showKey], undated: v } }));
  const setShowSummaries = (v: boolean) =>
    setShowBy((p) => ({ ...p, [showKey]: { ...p[showKey], summaries: v } }));
  const toggleType = (id: string) =>
    setHiddenTypesBy((p) => {
      const next = new Set(p[showKey]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...p, [showKey]: next };
    });
  const clearTypes = () => setHiddenTypesBy((p) => ({ ...p, [showKey]: new Set() }));

  /**
   * The board fills the window, so its horizontal scrollbar is ON SCREEN.
   *
   * Left to its content the rail was as tall as its tallest column — 117 cards
   * for Anchor — which put the bar for scrolling to the last status thousands
   * of pixels down the page. Same measured-height trick as the Timeline card,
   * and for the same reason: this is one tab of four inside the app shell, so
   * giving the shell a fixed height would change how the others scroll.
   */
  const boardRail = useRef<HTMLDivElement>(null);
  const [boardH, setBoardH] = useState<number | null>(null);
  useEffect(() => {
    if (tab !== "board") return;
    const measure = () => {
      const el = boardRail.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setBoardH(Math.max(320, window.innerHeight - top - 24));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tab]);

  /**
   * Only the types this client's own work uses — a filter listing every type in
   * the studio would be mostly rows that hide nothing. `NO_TYPE` stands for the
   * tasks that have none, which are otherwise unfilterable and are usually the
   * ones you want out of the way.
   */
  const filterableTypes = useMemo(() => {
    const mine = tasks.filter((t) => t.clientId === clientId);
    const used = new Set(mine.map((t) => t.typeId).filter(Boolean) as string[]);
    const list = taskTypes
      .filter((t) => used.has(t.id))
      .map((t) => ({ id: t.id, name: t.name, color: t.color }));
    if (mine.some((t) => !t.typeId)) {
      list.push({ id: NO_TYPE, name: "No type", color: "#0b43ed" });
    }
    return list;
  }, [tasks, clientId, taskTypes]);
  const [showInfo, setShowInfo] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const { widths, startResize } = useColWidths("client-tasks", COL_DEFAULTS);
  const colCell = (key: string) => ({ width: widths[key], flexShrink: 0 }) as const;

  // Hidden columns, per user. Read in an effect, never in the initialiser —
  // localStorage on the server is a hydration mismatch.
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("client-tasks.hiddenCols");
      if (!raw) return;
      const list = JSON.parse(raw);
      // validate against the current column list: a stored key we no longer
      // have would hide nothing and quietly linger
      if (Array.isArray(list)) {
        setHiddenCols(new Set(list.filter((k: string) => (ALL_COLS as string[]).includes(k))));
      }
    } catch {
      /* a corrupt blob just means "show everything" */
    }
  }, []);
  const toggleCol = useCallback((key: ColKey, on: boolean) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key);
      else next.add(key);
      localStorage.setItem("client-tasks.hiddenCols", JSON.stringify([...next]));
      return next;
    });
  }, []);
  const showCol = (key: ColKey) => !hiddenCols.has(key);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Anchor for shift-click ranges — the last row toggled without shift. */
  const lastPickedRef = useRef<string | null>(null);

  const client = clients.find((c) => c.id === clientId);

  // click = asc, again = desc, third = clear
  const cycleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key !== key ? { key, dir: 1 } : prev.dir === 1 ? { key, dir: -1 } : null,
    );

  const { clientSections, hiddenSections } = useMemo(() => {
    const all = sections
      .filter((s) => s.clientId === clientId)
      .sort((a, b) => a.position - b.position);
    if (showDone) return { clientSections: all, hiddenSections: 0 };
    // A section whose tasks are ALL done folds away with them — an old finished
    // section is exactly as much noise as the finished tasks inside it, and it
    // comes back with them when "Show completed" is ticked.
    //
    // Measured against ALL tasks, and an EMPTY section stays visible: it has
    // nothing finished to hide behind, and a section you just created must not
    // disappear the moment you make it.
    const open = all.filter((sec) => {
      const own = tasks.filter((t) => t.sectionId === sec.id);
      return own.length === 0 || own.some((t) => t.status !== "done");
    });
    return { clientSections: open, hiddenSections: all.length - open.length };
  }, [sections, clientId, tasks, showDone]);

  const typeName = useCallback(
    (id: string | null) => (id ? (taskTypes.find((t) => t.id === id)?.name ?? null) : null),
    [taskTypes],
  );

  const { clientTasks, hiddenByShow } = useMemo(() => {
    const mine = tasks.filter((t) => t.clientId === clientId && (showDone || t.status !== "done"));
    // The Show menu's two filters. `NO_TYPE` is how a task with no type is
    // named in the hidden set — `t.typeId ?? NO_TYPE` is the whole trick.
    const list = mine
      .filter((t) => showUndated || !!t.dueDate)
      .filter((t) => !hiddenTypes.has(t.typeId ?? NO_TYPE))
      .sort((a, b) => a.position - b.position);
    if (sort) list.sort(makeComparator(sort, profiles, taskMinutes, typeName));
    return { clientTasks: list, hiddenByShow: mine.length - list.length };
  }, [tasks, clientId, showDone, showUndated, hiddenTypes, sort, profiles, taskMinutes, typeName]);

  if (!client) return <div className="text-muted">Client not found.</div>;

  // the billing note is xl-only inline, so the full text always lives on the title
  const titleTooltip = client.billingPeriodNote
    ? `${client.name} — billing: ${client.billingPeriodNote}`
    : client.name;

  const noSection = clientTasks.filter((t) => t.sectionId === null);

  /** This client's groups for one section key, in position order. */
  const groupsIn = (sectionId: string | null) =>
    taskGroups
      .filter((g) => g.clientId === clientId && g.sectionId === sectionId)
      .sort((a, b) => a.position - b.position);

  /** How the collapse set names a group — see the `collapsed` comment. */
  const gKey = (id: string) => `g:${id}`;

  // Keys of the sections actually on screen, so "expand/collapse all" only reasons
  // about what's visible (the empty "No section" group appears only mid-drag).
  // A section holding nothing but GROUPS still shows, which is why the no-section
  // bucket asks about groups as well as tasks.
  const showNoSection =
    noSection.length > 0 || groupsIn(null).length > 0 || (isAdmin && draggingTask);
  const sectionKeys = [...(showNoSection ? [""] : []), ...clientSections.map((s) => s.id)];
  // Groups are collapsible in their own right, so they belong in the all/none
  // calculation too — otherwise "collapse all" would leave every group open
  // inside its folded section and un-collapsing would look half-done.
  const groupKeys = [
    ...(showNoSection ? groupsIn(null) : []),
    ...clientSections.flatMap((s) => groupsIn(s.id)),
  ].map((g) => gKey(g.id));
  const allKeys = [...sectionKeys, ...groupKeys];
  const allCollapsed = allKeys.length > 0 && allKeys.every((k) => collapsed.has(k));
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const reveal = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  /** Right-click → "New section…": a sibling of the section the row sits in. */
  const promptNewSection = () => {
    const name = prompt("Name for the new section")?.trim();
    if (name) addSection(clientId, name);
  };

  /** Right-click → "New group…": name it, then it appears empty in that section. */
  const promptNewGroup = (sectionId: string | null) => {
    const name = prompt("Name for the new group")?.trim();
    if (!name) return;
    void addTaskGroup(clientId, sectionId, name);
    reveal(sectionId ?? ""); // a group you just made must not land in a folded section
  };

  // ── the "Section totals" strips ───────────────────────────────────────
  // Both go through `rollupTasks`, the one place these figures are computed, so
  // the Tasks tab and the Timeline can never disagree about a group's hours.
  // ⚠️ `dayStates` is NOT threaded in here: this table has no calendar, so the
  // working-day count is the plain Sun–Thu one. The Timeline passes the studio's
  // holidays, which is why a duration there can be a day shorter — and that is
  // the number to trust, since it is the one drawn against a calendar.
  const sectionSummary = (section: Section | null, list: Task[]) => {
    if (!showSummaries) return undefined;
    const rolled = rollupTasks(list, taskMinutes);
    return <SummaryStrip rolled={rolled} budget={sectionBudgetHours(section, rolled)} />;
  };
  const groupSummaryStrip = (_group: TaskGroup, list: Task[]) => {
    if (!showSummaries) return undefined;
    const rolled = rollupTasks(list, taskMinutes);
    // A group has no budget of its own — always the sum of its tasks.
    return <SummaryStrip rolled={rolled} budget={rolled.estimateHours} />;
  };

  /** A section's tasks in the order they render: each group's, then the loose ones. */
  const orderedIn = (sectionId: string | null, list: Task[]) => {
    const gs = groupsIn(sectionId);
    const inGroups = gs.flatMap((g) => list.filter((t) => t.groupId === g.id));
    const loose = list.filter((t) => !t.groupId || !gs.some((g) => g.id === t.groupId));
    return [...inGroups, ...loose];
  };

  // Display order across every section, so a shift-click range spans sections and
  // groups the same way it reads on screen.
  const orderedIds = [
    ...orderedIn(null, noSection),
    ...clientSections.flatMap((s) =>
      orderedIn(
        s.id,
        clientTasks.filter((t) => t.sectionId === s.id),
      ),
    ),
  ].map((t) => t.id);

  const selectionValue: SelectionCtx = {
    selected,
    ordered: orderedIds,
    toggle: (taskId, shiftKey) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const anchor = lastPickedRef.current;
        if (shiftKey && anchor && anchor !== taskId) {
          const a = orderedIds.indexOf(anchor);
          const b = orderedIds.indexOf(taskId);
          if (a !== -1 && b !== -1) {
            // A range always SELECTS — never deselects. Extending a selection and
            // silently clearing part of it is the classic shift-click surprise.
            for (const id of orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(id);
            return next;
          }
        }
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        return next;
      });
      // Only a plain click moves the anchor, so repeated shift-clicks keep
      // extending from the same origin.
      if (!shiftKey) lastPickedRef.current = taskId;
    },
    setMany: (taskIds, on) =>
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of taskIds) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
  };

  /**
   * The board's columns are the studio's STATUSES — the `tags` table, which the
   * UI has called Status since v0.99 while the code still says tag.
   *
   * They used to be `Task.status` (todo / in_progress / done), which was the
   * wrong field twice over: nothing in the app ever writes `in_progress`, so
   * that column could only ever drain; and the board had no drag, so it could
   * not write anything at all. It showed a field you cannot edit while the
   * field you CAN edit sat in a dropdown in a table cell.
   *
   * `null` leads, for tasks with no status yet — dragging OUT of that column is
   * how a task gets one, and a board that hid untagged work would hide almost
   * all of it today.
   */
  const boardColumns: { key: string | null; label: string }[] = [
    { key: null, label: "No status" },
    ...tags.map((t) => ({ key: t.name, label: t.name })),
  ];

  return (
    <div className="flex flex-col gap-4">
      {client.archived && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted shadow-card">
          <Archive size={14} />
          <span>
            <span className="font-medium text-foreground">{client.name}</span> is archived — it stays
            out of task pickers, reports and search until it&apos;s restored.
          </span>
        </div>
      )}

      {/*
        Name + actions on ONE line, pinned under the app header while you scroll a
        long board. top-14 because the header is exactly h-14; -mx-6/px-6 covers
        main's 24px padding so card corners don't peek out from beneath it.
        It must stay OUTSIDE the overflow-x-auto table wrapper below, or sticky dies.
      */}
      {/*
        ⚠️ THE IN-PAGE Z-SCALE, and why this number is `z-[25]` exactly.

        Two constraints pull in opposite directions, and satisfying one alone
        breaks the other — both have now been shipped as bugs:

          · This header is a stacking context (sticky + z-index), so the Show and
            Columns menus inside it are capped at ITS depth however high their own
            z-index goes. It must therefore beat the Timeline's ruler, or both
            dropdowns open underneath the dates.
          · The APP header is `sticky z-30` + `backdrop-blur` — also a stacking
            context — so its search dropdown is capped at 30 no matter that it
            asks for z-50. Anything on the page above 30 paints over the search
            results. `z-[31]` did exactly that.

        So the whole page must live BELOW 30, and the ruler below this:

            app chrome (sidebar, header) ...... 30
            this header ....................... 25   ← dropdowns ride at its depth
            Timeline x-scroll shadow .......... 24
            Timeline mark labels, drag chip ... 23
            Timeline ruler .................... 22
            Timeline sticky name column ....... 20
            overlays and portalled popups ..... 40 / 50 / 70 (above everything)
      */}
      <div className="sticky top-14 z-[25] -mx-6 flex flex-col gap-2 bg-background px-6 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* 40px against a 24px title: the mark is the client's identity on
              their own page, so it leads rather than annotates. */}
          <ClientAvatar client={client} size={40} />
          {/* Billing sits UNDER the name rather than beside it: as a sibling of
              the title it competed with it for the same line and was dropped
              below xl, so on a laptop the terms of the engagement were invisible.
              Stacked, it reads as a subtitle of the client and always shows. */}
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <h1 className="truncate text-2xl font-bold leading-tight tracking-tight" title={titleTooltip}>
                {client.name}
              </h1>
              {/* Beside the name, unboxed: this edits the client's NAME, mark
                  and billing note, so sitting in the toolbar among view controls
                  put it next to things it has nothing to do with. Quiet until
                  the header is hovered, like every other rename in the app. */}
              {isAdmin && (
                <button
                  onClick={() => setShowInfo(true)}
                  title="Edit client"
                  aria-label={`Edit ${client.name}`}
                  // Always visible, just unboxed and quiet. The rename pencils
                  // on rows are hover-only because a table full of them would be
                  // a wall of icons; there is one client name on this page, and
                  // hiding its only edit control buys nothing.
                  className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-brand"
                >
                  <Pencil size={15} />
                </button>
              )}
            </span>
            {client.billingPeriodNote && (
              <span className="truncate text-xs text-muted" title={client.billingPeriodNote}>
                {client.billingPeriodNote}
              </span>
            )}
          </span>
          {/* The header row is the client's IDENTITY and the one thing you hand
              outward. Everything that shapes the view below — Show, Columns, the
              layout switch — moved down onto the tab strip, so Tasks and
              Timeline are laid out the same way instead of each keeping its
              controls wherever they were first added.

              The client report's own buttons are gone entirely: Client Reports
              is where reports are built, published and shared, and a second
              entry point here meant two places that had to agree. */}
          <div className="ml-auto flex items-center gap-2">
            {tab === "timeline" && <ShareGanttButton clientId={client.id} />}
          </div>
        </div>
        {/* The tab strip, with the Timeline's own zoom control CENTRED on the
            same line — it's a property of the view being shown, so it reads as
            part of this row rather than as the first thing inside the panel. */}
        {/*
          A GRID, not a flex row with an absolutely-centred child.

          The zoom control was `absolute left-1/2`, which takes it out of flow —
          so once the legend moved onto this line it had no idea the control was
          there and slid straight under it, at every width I tried. Three tracks
          with `auto` in the middle keeps the control exactly on the row's centre
          (the side tracks are equal `1fr`s) AND gives the legend a box of its
          own to be clipped by instead of a neighbour to overlap.
        */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex min-w-0 items-center">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: "tasks" as const, label: "Task list" },
                { value: "board" as const, label: "Board" },
                {
                  value: "timeline" as const,
                  label: "Timeline",
                  /* The Timeline's how-to, on demand, ON ITS OWN TAB — next to
                     the client name it was help floating beside something it
                     wasn't about, appearing and vanishing as you changed tabs,
                     which read as a glitch in the title rather than as part of
                     the view. `after` puts it on the tab's own line.

                     A button, not a decorated span: it is the only place this
                     help now lives, so it has to be reachable by keyboard —
                     hence opening on focus as well as hover. And a custom panel
                     rather than `title`, because the browser's own tooltip waits
                     about a second and this is a paragraph you want the instant
                     you go looking for it. */
                  after: tab === "timeline" ? <TimelineHintDot text={timelineHint(isAdmin)} /> : undefined,
                },
                { value: "overview" as const, label: "Overview" },
              ]}
              ariaLabel="Client sections"
            />
          </div>
          {/* The centre track holds this tab's view-mode switch. Only the
              Timeline has one now: list vs board used to live here, and became
              two tabs of its own — they are different arrangements of the work,
              which is what the tab strip is for, not a setting of one view. */}
          <div className="flex justify-center">
            {tab === "timeline" && (
              <Tabs
                value={zoom}
                onChange={setZoom}
                items={["day", "week", "month"] as const}
                variant="segmented"
                size="sm"
                ariaLabel="Timeline zoom"
              />
            )}
          </div>
          {/* The Timeline's legend and Columns button land here, by portal. They
              used to have a row of their own between the tabs and the chart;
              on the tab strip they cost nothing, because this line was already
              half empty. */}
          <div className="flex min-w-0 items-center justify-end gap-2">
            {/* The Timeline portals its legend and Columns button into this
                slot; Tasks renders its own Columns beside the same Show menu. */}
            <span ref={setTlToolbar} className="flex min-w-0 items-center gap-3" />
            {tab === "tasks" && <ColumnsMenu hidden={hiddenCols} onToggle={toggleCol} />}
            {tab !== "overview" && (
              <ShowMenu
                showDone={showDone}
                onShowDone={setShowDone}
                showUndated={showUndated}
                onShowUndated={setShowUndated}
                types={filterableTypes}
                hiddenTypes={hiddenTypes}
                onToggleType={toggleType}
                onClearTypes={clearTypes}
                plainBars={tab === "timeline" ? plainBars : undefined}
                onPlainBars={tab === "timeline" ? setPlainBars : undefined}
                // Not on the Board: its cards are grouped by status, so there is
                // no section or group header there to put a total on.
                summaries={tab === "board" ? undefined : showSummaries}
                onSummaries={tab === "board" ? undefined : setShowSummaries}
              />
            )}
          </div>
        </div>
      </div>

      {tab === "timeline" && (
        <ClientTimeline
          clientId={clientId}
          zoom={zoom}
          showDone={showDone}
          showUndated={showUndated}
          hiddenTypes={hiddenTypes}
          plainBars={plainBars}
          showSummaries={showBy.timeline.summaries}
          toolbarSlot={tlToolbar}
        />
      )}

      {/* Overview holds the stats that used to be an xl-only aside — below 1280px
          the total logged, open-task count, billable share and per-user hours were
          simply invisible. */}
      {tab === "overview" && (
        // Notes and links are the reading surface and take the width; the
        // figures are a sidebar at ~30%. Stacked in one 3xl column they pushed
        // "Hours per month" below the fold on a laptop while half the screen sat
        // empty beside a 500px-wide notes box. Below lg it falls back to one
        // column, notes first — the figures are reference, not the point.
        <div className="grid gap-4 lg:grid-cols-[7fr_3fr]">
          {/* Notes and links live HERE rather than behind the edit button:
              they are for everyone to read, and the edit button is admin-only.
              Admins edit them in place; members see the same panes read-only. */}
          <div className="min-w-0">
            <ClientNotes client={client} />
          </div>
          <div className="min-w-0">
            <ClientStats clientId={clientId} inTab />
          </div>
        </div>
      )}

      {/* Both task arrangements live in this block. It stays MOUNTED and
          hidden rather than unmounting, as it always has — the table's column
          widths, its selection and its collapsed sections are all local state
          that a round trip through another tab would throw away. */}
      <div className={`flex gap-4 ${tab === "tasks" || tab === "board" ? "" : "hidden"}`}>
        <div className="min-w-0 flex-1">
      {tab === "tasks" ? (
        <ColWidthsContext.Provider value={widths}>
        <HiddenColsContext.Provider value={hiddenCols}>
        <SelectionContext.Provider value={isAdmin ? selectionValue : null}>
        {/* dragstart/dragend bubble, so the whole table can know a drag is running
            without threading state through every row. */}
        <div
          className="overflow-x-auto rounded-xl border border-border bg-surface"
          // dragstart bubbles AFTER the row handler has set drag.taskId, so this
          // can tell a task drag from a section drag — without the check, dragging a
          // section would reveal the empty "No section" group.
          onDragStart={() => {
            if (drag.taskId) setDraggingTask(true);
          }}
          onDragEnd={() => {
            setDraggingTask(false);
            drag.taskId = null; // belt-and-braces: a stale id would make targets accept
            drag.sectionId = null;
          }}
          onDrop={() => {
            setDraggingTask(false);
            drag.taskId = null;
            drag.sectionId = null;
          }}
        >
          <div className="min-w-fit">
            <div
              className={`${COLS} group/thead relative h-8 border-b border-border bg-background text-xs font-medium`}
            >
              {isAdmin && (
                <span className="absolute left-1 top-0 flex h-full items-center">
                  <SelectAllBox ids={orderedIds} title="Select every task shown" />
                </span>
              )}
              <button
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(allKeys))}
                title={allCollapsed ? "Expand everything" : "Collapse every section and group"}
                aria-label={allCollapsed ? "Expand everything" : "Collapse every section and group"}
                className={`flex w-[17px] shrink-0 items-center justify-center text-muted hover:text-brand ${LEAD_TIGHT}`}
              >
                <CollapseChevron open={!allCollapsed} />
              </button>
              <span
                className="relative"
                style={{ width: Math.max(NAME_MIN, widths.name ?? COL_DEFAULTS.name), flexShrink: 0 }}
              >
                <SortHeader label="Name" k="title" sort={sort} onSort={cycleSort} />
                <ResizeHandle onMouseDown={startResize("name")} />
              </span>
              {showCol("assignee") && (
                <span className="relative hidden sm:block" style={colCell("assignee")}>
                  <SortHeader label="Assignee" k="assignee" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("assignee")} />
                </span>
              )}
              {showCol("start") && (
                <span className="relative hidden lg:block" style={colCell("start")}>
                  <SortHeader label="Start" k="start" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("start")} />
                </span>
              )}
              {showCol("due") && (
                <span className="relative" style={colCell("due")}>
                  <SortHeader label="Due" k="due" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("due")} />
                </span>
              )}
              {showCol("type") && (
                <span className="relative hidden xl:block" style={colCell("type")}>
                  <SortHeader label="Type" k="type" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("type")} />
                </span>
              )}
              {showCol("tag") && (
                <span className="relative hidden lg:block" style={colCell("tag")}>
                  <SortHeader label="Status" k="tag" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("tag")} />
                </span>
              )}
              {/* Hours and Budget appear and disappear together — a Budget column
                  with no Hours beside it would read worse than today's merged one */}
              {showCol("hours") && (
                <span className="relative hidden md:block" style={colCell("hours")}>
                  <SortHeader label="Hours" k="hours" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("hours")} />
                </span>
              )}
              {showCol("budget") && (
                <span className="relative hidden md:block" style={colCell("budget")}>
                  <SortHeader label="Budget" k="budget" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("budget")} />
                </span>
              )}
              {isAdmin && showCol("billable") && (
                <span className="w-4 shrink-0">
                  <SortHeader label="$" k="billable" sort={sort} onSort={cycleSort} />
                </span>
              )}
            </div>
            {/* Normally hidden when empty, but an admin mid-drag needs somewhere to
                drop a task to take it OUT of a section. */}
            {showNoSection && (
              <SectionGroup
                section={null}
                tasks={noSection}
                groups={groupsIn(null)}
                clientId={clientId}
                reorderable={sort === null}
                open={!collapsed.has("")}
                isGroupOpen={(id) => !collapsed.has(gKey(id))}
                onToggle={() => toggleGroup("")}
                onToggleGroup={(id) => toggleGroup(gKey(id))}
                onOpen={() => reveal("")}
                onOpenGroup={(id) => reveal(gKey(id))}
                onNewGroup={() => promptNewGroup(null)}
                onNewSection={promptNewSection}
                summary={sectionSummary(null, noSection)}
                groupSummary={groupSummaryStrip}
              />
            )}
            {clientSections.map((section) => (
              <SectionGroup
                key={section.id}
                section={section}
                tasks={clientTasks.filter((t) => t.sectionId === section.id)}
                groups={groupsIn(section.id)}
                clientId={clientId}
                reorderable={sort === null}
                open={!collapsed.has(section.id)}
                isGroupOpen={(id) => !collapsed.has(gKey(id))}
                onToggle={() => toggleGroup(section.id)}
                onToggleGroup={(id) => toggleGroup(gKey(id))}
                onOpen={() => reveal(section.id)}
                onOpenGroup={(id) => reveal(gKey(id))}
                onNewGroup={() => promptNewGroup(section.id)}
                onNewSection={promptNewSection}
                summary={sectionSummary(
                  section,
                  clientTasks.filter((t) => t.sectionId === section.id),
                )}
                groupSummary={groupSummaryStrip}
              />
            ))}
            {hiddenByShow > 0 && (
              // Never quietly partial: the Timeline has always printed what it
              // is not drawing, and now that this table filters too, it says so
              // in the same voice.
              <div className="px-3 py-2 text-xs text-faint">
                {hiddenByShow} task{hiddenByShow === 1 ? "" : "s"} hidden by the Show filter.
              </div>
            )}
            {hiddenSections > 0 && (
              // Folding a finished section away silently would read as data loss.
              <button
                onClick={() => setShowDone(true)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-faint hover:text-brand"
                title="Sections whose tasks are all done are folded away with them"
              >
                {hiddenSections} finished section{hiddenSections === 1 ? "" : "s"} hidden — show
                completed
              </button>
            )}
            {addingSection ? (
              <form
                className="flex items-center gap-2 px-3 py-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sectionName.trim()) addSection(clientId, sectionName.trim());
                  setSectionName("");
                  setAddingSection(false);
                }}
              >
                <input
                  autoFocus
                  value={sectionName}
                  onChange={(e) => setSectionName(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setAddingSection(false)}
                  placeholder="Section name — Enter to add"
                  className="bidi-auto rounded-md border border-border px-2 py-1 text-sm outline-none focus:border-brand"
                />
              </form>
            ) : (
              <button
                onClick={() => setAddingSection(true)}
                className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-muted hover:text-brand"
              >
                <Plus size={14} /> Add section
              </button>
            )}
          </div>
        </div>
        {isAdmin && selected.size > 0 && (
          <SelectionBar
            // Only ids still on screen: a task filtered out by "Show completed"
            // or moved away must not be acted on invisibly.
            ids={orderedIds.filter((id) => selected.has(id))}
            clientId={clientId}
            onClear={() => setSelected(new Set())}
          />
        )}
        </SelectionContext.Provider>
        </HiddenColsContext.Provider>
        </ColWidthsContext.Provider>
      ) : (
        // `clientTasks`, not `tasks`: the board used to read straight from the
        // store and so ignored Show completed, Undated and the type filter
        // entirely — the two views of one client disagreed about what they were
        // showing. Auto-fit columns so five statuses don't squeeze to nothing.
        // A ROW that scrolls, not a grid that wraps. Wrapped, a sixth status
        // dropped onto a second line and the board stopped reading as columns
        // at all. `1 0 220px`: grow to fill the width when there is room, never
        // shrink below a readable card, and overflow into a scroll when there
        // isn't. `pb-2` leaves the scrollbar somewhere to sit.
        <div
          ref={boardRail}
          style={{ height: boardH ?? undefined }}
          className="flex gap-4 overflow-x-auto overflow-y-hidden pb-2"
        >
          {boardColumns.map(({ key, label }) => {
            const columnTasks = clientTasks.filter((t) => (t.tag ?? null) === key);
            const isOver = boardOver === key;
            return (
              <div
                key={key ?? "__none"}
                onDragOver={(e) => {
                  if (!isAdmin || !drag.boardId) return;
                  e.preventDefault();
                  setBoardOver(key);
                }}
                onDragLeave={() => setBoardOver((k) => (k === key ? undefined : k))}
                onDrop={() => {
                  setBoardOver(undefined);
                  const id = drag.boardId;
                  drag.boardId = null;
                  if (!id) return;
                  const moved = tasks.find((t) => t.id === id);
                  // Dropping a card back where it started is not an edit, and
                  // must not cost an undo step.
                  if (!moved || (moved.tag ?? null) === key) return;
                  updateTask(id, { tag: key });
                }}
                style={{ flex: "1 0 220px" }}
                className={`flex min-h-0 flex-col rounded-xl border bg-surface p-3 transition-colors ${
                  isOver ? "border-brand bg-brand-soft/40" : "border-border"
                }`}
              >
                <div className="mb-2 text-sm font-semibold">
                  {label}
                  <span className="ml-2 text-xs font-normal text-faint">{columnTasks.length}</span>
                </div>
                {/* Each column scrolls on its own, so the rail's own scrollbar
                    is only ever horizontal — and stays at the foot of the
                    screen where you can reach it. `min-h-0` is what lets a flex
                    child shrink below its content and actually scroll. */}
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                  {columnTasks.map((t) => (
                    <BoardCard key={t.id} task={t} draggable={isAdmin} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
        </div>
      </div>

      {showInfo && <ClientInfoModal client={client} onClose={() => setShowInfo(false)} />}
    </div>
  );
}
