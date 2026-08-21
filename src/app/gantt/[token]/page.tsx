import { notFound } from "next/navigation";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  PublicGanttView,
  type PublicGanttBlock,
  type PublicGanttGroup,
  type PublicGanttTask,
} from "./public-gantt-view";

/**
 * Public, token-gated client Gantt — LIVE, unlike `/report/[token]`.
 *
 * A report is a published statement of hours and is deliberately frozen. This
 * is a plan, and a plan the client is reading is only worth reading if it is
 * the current one; so it re-reads on every request.
 *
 * ⚠️ The narrowing happens HERE, in the `select`, not in the view. LOGGED
 * hours, status, assignees AND THE BUDGET are never fetched, so they cannot
 * leak through a prop, a serialised payload or a future edit to the component.
 * What the client gets is: section names, task names, dates and the type
 * colour. Nothing about hours in either direction.
 *
 * ⚠️ `estimate_hours` used to be selected and shown as a Budget column, on the
 * argument that the agreed scope is something the client already knows. Nitsan
 * dropped it (2026-08-19): a schedule answers WHEN, and putting a number of
 * hours beside every row invites the one question the chart cannot answer —
 * how many of them are gone. Removed from the QUERY, not just the view.
 */
export const dynamic = "force-dynamic";

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export default async function PublicGanttPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = admin();

  const { data: link } = await sb
    .from("gantt_links")
    .select("active, client_id, clients(name, color, icon, icon_url)")
    .eq("token", token)
    .maybeSingle();
  if (!link || !link.active) notFound();

  const client = link.clients as {
    name?: string;
    color?: string;
    icon?: string | null;
    icon_url?: string | null;
  } | null;
  const clientName = client?.name ?? "Client";
  const clientColor = client?.color ?? "#0b43ed";

  const [
    { data: sections },
    { data: groupRows },
    { data: tasks },
    { data: types },
    { data: days },
    { data: marks },
  ] = await Promise.all([
    sb
      .from("sections")
      .select("id, name, position")
      .eq("client_id", link.client_id)
      .order("position"),
    // Subject groups (0027). Names and structure only — a group holds no hours
    // of its own, so there is nothing here that could leak one.
    sb
      .from("task_groups")
      .select("id, name, section_id, position")
      .eq("client_id", link.client_id)
      .order("position"),
    // `status` IS read — only to EXCLUDE completed work, never sent onward.
    sb
      .from("tasks")
      .select(
        "id, title, section_id, group_id, start_date, due_date, type_id, timeline_position, status",
      )
      .eq("client_id", link.client_id)
      .not("due_date", "is", null)
      .neq("status", "done"),
    sb.from("task_types").select("id, name, color"),
    sb.from("plan_day_states").select("date_from, date_to, label"),
    // Milestones. `title` is fetched so an UNNAMED one can be dropped below —
    // a nameless vertical line on a client's plan is worse than no line, and
    // the studio's own chart creates marks empty and names them after.
    sb
      .from("timeline_marks")
      .select("id, on_date, title")
      .eq("client_id", link.client_id)
      .order("on_date"),
  ]);

  const typeById = new Map(
    (types ?? []).map((t) => [
      t.id as string,
      { name: t.name as string, color: t.color as string },
    ]),
  );

  const rows: PublicGanttTask[] = (tasks ?? []).map((t) => {
    const type = t.type_id ? typeById.get(t.type_id as string) : undefined;
    return {
      id: t.id as string,
      title: t.title as string,
      sectionId: (t.section_id as string | null) ?? null,
      groupId: (t.group_id as string | null) ?? null,
      startDate: (t.start_date as string | null) ?? null,
      dueDate: t.due_date as string,
      typeName: type?.name ?? null,
      typeColor: type?.color ?? null,
      order: (t.timeline_position as number | null) ?? null,
    };
  });

  if (rows.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 p-8 text-center">
        <span
          className="flex size-12 items-center justify-center rounded-xl text-xl font-bold text-white"
          style={{ backgroundColor: clientColor }}
        >
          {clientName[0]}
        </span>
        <h1 className="text-xl font-bold">{clientName}</h1>
        <p className="text-sm text-muted">
          Nothing is scheduled yet. This page updates by itself as the plan
          changes — keep the link.
        </p>
      </main>
    );
  }

  // Grouped by section in the client's own section order, "No section" last —
  // the same arrangement as the studio's own Timeline, so the two agree.
  const order = new Map((sections ?? []).map((s, i) => [s.id as string, i]));
  const byKey = new Map<string, PublicGanttTask[]>();
  for (const r of rows) {
    const key = r.sectionId && order.has(r.sectionId) ? r.sectionId : "";
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(r);
  }

  // ⚠️ The SAME rule as the studio's Timeline, tiebreak for tiebreak: hand-placed
  // rows first in their placed order, never-dragged rows to the bottom by START
  // date (not due), then by title. A client comparing this page with a screenshot
  // from the studio must not see a different order — which is why this is one
  // comparator used at both depths rather than two that happen to agree today.
  const byPlacement = (a: PublicGanttTask, b: PublicGanttTask) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
    (a.startDate ?? a.dueDate).localeCompare(b.startDate ?? b.dueDate) ||
    a.title.localeCompare(b.title);

  const groups: PublicGanttGroup[] = [...byKey.entries()]
    .map(([key, list]) => {
      // Groups in this section, in position order. Only those that actually hold
      // a dated task appear — an empty group is studio scaffolding, and a client
      // reading a plan has nothing to do with a heading over nothing.
      const blocks: PublicGanttBlock[] = (groupRows ?? [])
        .filter((g) => ((g.section_id as string | null) ?? "") === key)
        .map((g) => ({
          id: g.id as string,
          name: g.name as string,
          tasks: list.filter((t) => t.groupId === g.id).sort(byPlacement),
        }))
        .filter((b) => b.tasks.length > 0);
      const inBlock = new Set(blocks.flatMap((b) => b.tasks.map((t) => t.id)));
      return {
        key,
        name: key
          ? ((sections ?? []).find((s) => s.id === key)?.name as string)
          : "No section",
        rank: key ? (order.get(key) ?? 0) : Number.MAX_SAFE_INTEGER,
        blocks,
        // Everything not taken by a group — including a task whose group sits in
        // another section, which renders loose rather than disappearing.
        tasks: list.filter((t) => !inBlock.has(t.id)).sort(byPlacement),
      };
    })
    .sort((a, b) => a.rank - b.rank);

  const offDays = (days ?? []).map((d) => ({
    from: d.date_from as string,
    to: d.date_to as string,
    label: d.label as string,
  }));

  // Unnamed marks are dropped rather than shown as "Untitled" (which is what the
  // studio's own chart calls them, because there it is a prompt to finish naming
  // one). The client has no way to act on that, so it is only noise on their plan.
  const milestones = (marks ?? [])
    .filter((m) => ((m.title as string | null) ?? "").trim())
    .map((m) => ({
      id: m.id as string,
      onDate: m.on_date as string,
      title: (m.title as string).trim(),
    }));

  return (
    <PublicGanttView
      clientName={clientName}
      clientColor={clientColor}
      clientIcon={client?.icon ?? null}
      clientIconUrl={client?.icon_url ?? null}
      groups={groups}
      offDays={offDays}
      milestones={milestones}
    />
  );
}
