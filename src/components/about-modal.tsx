"use client";

import { APP_VERSION } from "@/lib/version";
import {
  ABOUT,
  ACTUAL_SPEND,
  MILESTONES,
  REPLACED,
  actualSpendUsd,
  group,
  projectSpanDays,
  recoveredShare,
} from "@/lib/about";
import { InfoDot, Modal, ModalClose } from "./ui";

/**
 * "Behind the tracker" — how it was built, and what it holds.
 *
 * Opened from the version number in the sidebar. Every figure comes from the
 * GENERATED `about-data.json` (`node scripts/build-about-stats.mjs --apply`), so
 * opening this costs one import and no queries.
 *
 * Two ideas carry it, and neither is a grid of numbers:
 *
 *   The RAIL is the 33 days, with one tick per release at its true date — so the
 *   pace reads as texture (27 July alone carries 13 of them) rather than as the
 *   claim "49 versions".
 *
 *   The LEDGERS are split bars. The two facts worth knowing are both divisions —
 *   half the studio's history had to be recovered rather than logged, and the
 *   build divides between Claude and Nitsan — and a bar that splits is the one
 *   chart nobody has to learn.
 *
 * ⚠️ It is built to fit ON ONE SCREEN, with no scroller. That is what the (i)
 * dots are for: prose that would sit under a section lives in the tooltip
 * instead. If you add something, take something out — and don't drop the type
 * below 11px to make room, which is what the first draft did.
 */

const HERO_FIGURE = "font-serif-accent leading-none";

/** Where a date sits along the rail, 0–100. */
function railPosition(iso: string): number {
  const from = Date.parse(ABOUT.build.firstCommit);
  const to = Date.parse(ABOUT.build.lastCommit);
  if (to <= from) return 0;
  return ((Date.parse(iso) - from) / (to - from)) * 100;
}

/**
 * The build, as a rail.
 *
 * Milestone captions alternate above and below so neighbours can't overlap, and
 * the two at the ends anchor to their edge instead of centring — a centred
 * caption at 0% hangs half its width off the panel.
 */
function BuildLog() {
  const { releases, firstCommit, lastCommit } = ABOUT.build;

  return (
    // A TINT of brand rather than the brand-soft token: brand-soft flips to a
    // dark navy under the night theme, where the band would stop being "weak
    // blue" and start being a dark slab. A tint composites over whatever
    // surface it sits on, so it stays faint in both.
    <section className="bg-brand/[0.055] px-7 py-5">
      <SectionHeading
        note={`${formatDay(firstCommit)} – ${formatDay(lastCommit)}`}
        info={`One tick per release, placed on the day it shipped. ${releases.length} of them in ${projectSpanDays()} days — they arrive in bursts, not a steady drip, which is what a working week on this actually looked like.`}
      >
        From an empty folder to daily use
      </SectionHeading>

      {/* The captions are two 11px lines sitting 16px clear of the rail, so they
          reach ~42px above and below it. The margins have to clear that AND
          leave the band some breathing room, or the rail crowds its own box. */}
      <div className="relative mx-1 mb-14 mt-14 h-0.5 rounded-full bg-brand">
        {/* Releases: thin marks above the rail, so they read as texture and never
            compete with the milestone dots sitting ON it. */}
        {releases.map((r) => (
          <span
            key={r.version}
            title={`${r.version} — ${formatDay(r.date)}`}
            className="absolute bottom-1.5 h-2 w-px bg-brand/40"
            style={{ left: `${railPosition(r.date)}%` }}
          />
        ))}

        {MILESTONES.map((m, i) => {
          const pos = railPosition(m.date);
          const first = i === 0;
          const last = i === MILESTONES.length - 1;
          const below = i % 2 === 1;
          return (
            <div key={m.date + m.label}>
              <span
                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                  m.major
                    ? "size-3 bg-brand ring-4 ring-brand-soft"
                    : "size-2 border-2 border-brand bg-surface"
                }`}
                style={{ left: `${pos}%` }}
              />
              <div
                className={`absolute w-32 text-[11px] leading-tight ${
                  below ? "top-4" : "bottom-4"
                } ${first ? "text-left" : last ? "-translate-x-full text-right" : "-translate-x-1/2 text-center"}`}
                style={{ left: `${pos}%` }}
              >
                {/* The date leads its caption, so it carries the emphasis
                    weight and a step of size over the label under it. Saans
                    only has two weights here — `font-semibold` resolves to 570,
                    the same as `font-medium`/`font-bold` (see globals.css), so
                    size is the other half of the hierarchy, not decoration. */}
                <span className="block text-[13px] font-semibold text-brand">
                  {formatShort(m.date)}
                </span>
                <span className={m.major ? "text-foreground" : "text-muted"}>
                  {m.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The models, as one donut.
 *
 * A donut and not a fourth split bar: the three shares are parts of a single
 * whole, and three stacked bars that each total 100% invite you to compare them
 * across rows when they measure different things. The cost sits in the hole
 * because it is the same fact seen in money rather than in share.
 *
 * The three weights are one hue at three opacities rather than three colours —
 * it stays legible in both themes and doesn't spend a second accent.
 */
function ModelDonut() {
  const { models, costUsd, outputTokensM, inputTokensM } = ABOUT.effort;
  const paid = actualSpendUsd();
  // Sized so the cost reads as a figure rather than a footnote: r 38 with a 12
  // ring leaves a 64px hole, room for the amount at 17px with clearance to
  // spare — which it needs, since the real Saans is wider than the fallback.
  const R = 38;
  const SW = 12;
  const BOX = 104;
  const C = 2 * Math.PI * R;
  const WEIGHTS = [1, 0.55, 0.28];
  let offset = 0;

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0">
        <svg
          width={BOX}
          height={BOX}
          viewBox={`0 0 ${BOX} ${BOX}`}
          aria-hidden="true"
        >
          <g transform={`translate(${BOX / 2} ${BOX / 2}) rotate(-90)`}>
            {models.map((m, i) => {
              const len = (m.share / 100) * C;
              const dash = (
                <circle
                  key={m.name}
                  r={R}
                  fill="none"
                  stroke="var(--brand)"
                  strokeOpacity={WEIGHTS[i] ?? 0.2}
                  strokeWidth={SW}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return dash;
            })}
          </g>
        </svg>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="font-serif-accent text-[17px] leading-none text-brand">
            ${group(costUsd)}
          </span>
        </span>
      </div>

      <div className="w-32 shrink-0 space-y-1">
        {models.map((m, i) => (
          <div key={m.name} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="size-2 shrink-0 rounded-full bg-brand"
              style={{ opacity: WEIGHTS[i] ?? 0.2 }}
            />
            <span className="truncate text-foreground">
              {modelName(m.name)}
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-muted">
              {Math.round(m.share)}%
            </span>
          </div>
        ))}
        <div className="whitespace-nowrap pt-1 text-[10px] leading-snug text-muted">
          <div className="flex items-center gap-1">
            <span>at list price</span>
            <InfoDot title="Cost of the compute" align="right" side="up">
              {formatMoney(costUsd)} is what {outputTokensM}M written tokens and{" "}
              {formatTokens(inputTokensM)} read would cost at list API prices —
              a valuation of the compute,{" "}
              <strong className="text-foreground">
                not a bill anyone received
              </strong>
              . Two things make it as low as it is: most of the volume is
              re-reading this codebase, and cached reads bill at a tenth of the
              normal rate. Fable 5 is the outlier — 28% of the work but nearly
              half the cost, at double the per-token price.
            </InfoDot>
          </div>
          {paid !== null && (
            // The whole point of stating both: the seat bought two orders of
            // magnitude more compute than it cost. Neither figure means much
            // without the other beside it.
            <div className="mt-0.5 flex items-center gap-1 text-muted">
              <span>
                <strong className="font-medium text-foreground">
                  ${group(Math.round(paid))}
                </strong>{" "}
                actually paid
              </span>
              <InfoDot title="What it really cost" align="right" side="up">
                One Claude seat at ${ACTUAL_SPEND?.seatMonthlyUsd}/month, for
                the {projectSpanDays()} days the build ran — about $
                {group(Math.round(paid))}. The {formatMoney(costUsd)} beside it
                is what the same compute would cost at list API prices, so the
                seat returned roughly{" "}
                <strong className="text-foreground">
                  {Math.round(costUsd / paid)}× its price
                </strong>{" "}
                in compute. Most of that gap is prompt caching: re-reading this
                codebase every turn bills at a tenth of the normal rate.
              </InfoDot>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Segment = {
  value: string;
  label: string;
  share: number;
  className: string;
};

/** A split bar: shares of one whole, each sized by its own number. */
function Ledger({
  title,
  total,
  segments,
  note,
  info,
  side,
}: {
  title: string;
  total: string;
  segments: Segment[];
  /** omit on a bar whose total line already says everything */
  note?: string;
  info: React.ReactNode;
  side?: "down" | "up";
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1 text-[13px]">
          {title}
          <InfoDot title={title} side={side}>
            {info}
          </InfoDot>
        </span>
        <span className="text-[11px] text-muted">{total}</span>
      </div>
      <div className="flex h-9 overflow-hidden rounded-lg">
        {segments.map((s) => (
          <div
            key={s.label}
            className={`flex min-w-0 items-center gap-1.5 px-3 text-[12px] ${s.className}`}
            style={{ width: `${s.share}%` }}
          >
            <span className="font-serif-accent text-[15px]">{s.value}</span>
            <span className="truncate opacity-80">{s.label}</span>
          </div>
        ))}
      </div>
      {note && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{note}</p>
      )}
    </div>
  );
}

function SectionHeading({
  children,
  note,
  info,
}: {
  children: React.ReactNode;
  note?: string;
  info?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="flex items-center gap-1 text-[13px]">
        {children}
        {info && (
          <InfoDot title={typeof children === "string" ? children : undefined}>
            {info}
          </InfoDot>
        )}
      </h3>
      {note && <span className="text-[11px] text-muted">{note}</span>}
    </div>
  );
}

/** A figure in the closing strip — small, and explained by its dot. */
function Stat({
  value,
  label,
  info,
  align = "left",
}: {
  value: string;
  label: string;
  info: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div className="min-w-0">
      <div className="font-serif-accent text-lg leading-none text-brand">
        {value}
      </div>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted">
        <span className="truncate">{label}</span>
        <InfoDot title={label} align={align} side="up">
          {info}
        </InfoDot>
      </div>
    </div>
  );
}

export function AboutModal({ onClose }: { onClose: () => void }) {
  const { studio, build, effort } = ABOUT;
  const span = projectSpanDays();
  const loggedHours = studio.hours - studio.recoveredHours;
  const toV1 = daysBetween(build.firstCommit, "2026-07-29");

  return (
    <Modal
      onClose={onClose}
      width="5xl"
      align="center"
      labelledBy="about-title"
      // `p-0!` — Modal's own `p-4` is a plain utility, so class order in the
      // stylesheet decides, not the order in this string, and a bare `p-0` loses.
      // The hero and the timeline band both have to reach the card's edges.
      className="p-0!"
    >
      <div className="relative rounded-t-2xl bg-brand px-7 py-4 text-white">
        <div className="absolute right-3 top-3 [&_button]:text-white/85 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
          <ModalClose onClose={onClose} />
        </div>

        {/* Two columns: what the app holds on the left, what produced it on the
            right. The right half used to be empty — the models belong there
            rather than as a third bar below, which cost 80px of height. */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 id="about-title" className={`${HERO_FIGURE} text-xl`}>
              Behind the tracker
            </h2>
            <p className="mt-1 text-[12px] text-white/85">
              Studio&amp;more Tracker {APP_VERSION} — the studio&rsquo;s own
              task and time tracker.
            </p>

            <div className="mt-3.5 flex flex-wrap items-end gap-x-10 gap-y-3">
              <div>
                <div className={`${HERO_FIGURE} text-[40px]`}>
                  {group(studio.hours)}
                </div>
                <div className="mt-1 text-[12px] text-white/85">
                  hours of studio work, in one place
                </div>
              </div>
              <div>
                <div className={`${HERO_FIGURE} text-2xl`}>{studio.years}</div>
                <div className="mt-1 text-[12px] text-white/85">years covered</div>
              </div>
              <div>
                <div className={`${HERO_FIGURE} text-2xl`}>{span}</div>
                <div className="mt-1 text-[12px] text-white/85">
                  days to build it
                </div>
              </div>
            </div>
          </div>

          {/* The retired tools live here rather than as a full-width row below —
              same fact, one less band of hero height, and it fills a column that
              was empty. The count is the point: everyone remembers Everhour,
              Asana and the plan sheet; the other four went quietly. */}
          <div className="w-full shrink-0 border-t border-white/15 pt-3 sm:w-60 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <div className="flex items-center gap-1 text-[12px] text-white/85">
              Replaces {REPLACED.length} tools
              <span className="text-white/85">
                <InfoDot
                  title={`${REPLACED.length} tools retired`}
                  align="right"
                >
                  <span className="block">
                    {REPLACED.map((r) => (
                      <span key={r.tool} className="mb-1 block last:mb-0">
                        <strong className="text-foreground">{r.tool}</strong> →{" "}
                        {r.became}
                      </span>
                    ))}
                  </span>
                </InfoDot>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REPLACED.map((r) => (
                <span
                  key={r.tool}
                  title={`${r.tool} → ${r.became}`}
                  className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-white/90"
                >
                  {r.tool}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <BuildLog />

      <div className="space-y-5 px-7 pb-5 pt-5">

        {/* The bars don't need the full width — the donut takes the column beside
            them instead of a row of its own, which is the whole height saving. */}
        <div className="grid gap-x-6 gap-y-3 lg:grid-cols-[1fr_17rem]">
          <div className="space-y-4">
            <Ledger
              title="Where the studio's hours came from"
              total={`${group(studio.hours)} hours · ${studio.years} years`}
              segments={[
                {
                  value: `${group(studio.recoveredHours)}h`,
                  label: "recovered from Asana",
                  share: recoveredShare(),
                  // A TINT of brand rather than the brand-soft token, and the theme's
                  // own foreground on top: brand-soft flips to a dark navy under the
                  // night theme, where fixed brand-dark text on it lands at 1.5:1.
                  // A tint and the foreground token move together, so both themes work.
                  className: "bg-brand/25 text-foreground",
                },
                {
                  value: `${group(loggedHours)}h`,
                  label: "logged in the tracker",
                  share: 100 - recoveredShare(),
                  className: "bg-brand text-white",
                },
              ]}
              info={`${group(
                studio.recoveredHours,
              )} hours lived only in Asana task titles ("Ui system - 165hrs") and comment threads. Parsing them out, then cross-checking every year against the studio's own billing sheets, is the only reason anything before ${studio.firstEntry.slice(
                0,
                4,
              )} can be shown at all. Those years are marked in the data, so they never contaminate a per-person figure.`}
            />

            <Ledger
              title="Who built it"
              total={`${effort.wallClockHours}h together · ${effort.days} working days · ${group(
                effort.prompts,
              )} instructions across ${effort.sessions} sessions`}
              side="up"
              segments={[
                {
                  value: `${effort.claudeHours}h`,
                  label: "Claude working",
                  share: Math.round(
                    (effort.claudeHours / effort.wallClockHours) * 100,
                  ),
                  className: "bg-brand text-white",
                },
                {
                  value: `${effort.humanHours}h`,
                  label: "Nitsan directing",
                  share:
                    100 -
                    Math.round(
                      (effort.claudeHours / effort.wallClockHours) * 100,
                    ),
                  // Studio Black hard-coded, NOT text-foreground: aqua is the same
                  // bright accent in every theme, so its ink has to be fixed too —
                  // the foreground token goes near-white under night and vanishes.
                  className: "bg-aqua text-[#06112f]",
                },
              ]}
              info={`The app is the product of ${group(
                effort.prompts,
              )} decisions, not of one brief. Measured from the session transcripts, with any gap over ${effort.idleThresholdMinutes} minutes treated as a break. Claude's share is time spent generating or running tools; Nitsan's is the time between a turn finishing and the next instruction — reading, checking the app, deciding. His figure is a floor: applying migrations by hand, verifying in the browser and gathering references all happened outside the session and aren't counted.`}
            />
          </div>

          <div className="flex items-center lg:pl-2">
            <ModelDonut />
          </div>
        </div>

        <section className="pt-1">
          <div className="grid grid-cols-3 gap-x-5 gap-y-3 sm:grid-cols-4 lg:grid-cols-8">
            <Stat
              value={group(studio.entries)}
              label="Time entries"
              info="Every logged block of work, each carrying a description — the tracker refuses an entry without one, which is why the history can still be read years later."
            />
            <Stat
              value={group(studio.tasks)}
              label="Tasks"
              info="Across every client, open and finished, including everything imported when the studio moved off Asana and Everhour."
            />
            <Stat
              value={group(studio.clients)}
              label="Clients"
              info="Live and archived. Most are archived — kept so their hours stay attached to a name instead of becoming an orphaned total."
            />
            <Stat
              value={group(studio.people)}
              label="People"
              info="Everyone who has logged studio hours. Former staff are kept as people without accounts, so a decade of work stays attributed to whoever did it."
            />
            <Stat
              value={group(build.lines)}
              label="Lines of code"
              info={`Across ${build.files} files — TypeScript, React, CSS and SQL. Excludes the committed data dumps, which are imported client history rather than anything anyone wrote.`}
            />
            <Stat
              value={String(build.migrations)}
              label="Migrations"
              align="right"
              info="Database schema changes, each applied by hand in the Supabase editor rather than automatically — a deliberate gate, since several protect columns the app must never let a member write."
            />
            <Stat
              value={group(effort.toolCalls)}
              label="Tool calls"
              align="right"
              info="Reads, edits, searches, builds and browser checks — every action Claude took that wasn't writing prose."
            />
            <Stat
              value={formatTokens(effort.inputTokensM + effort.outputTokensM)}
              label="Tokens"
              align="right"
              info={`${formatTokens(effort.inputTokensM)} read and ${
                effort.outputTokensM
              }M written. The read figure dwarfs the written one because this codebase goes back through the model on every single turn — that is what stops a change in one file quietly contradicting another. Nearly all of it is served from cache at a tenth of the normal price, which is why ${formatTokens(
                effort.inputTokensM,
              )} costs what it does.`}
            />
          </div>
        </section>

        {/* The regenerate command lived here and has been removed — it is a
            developer instruction, and everyone in the studio opens this panel.
            How to refresh the figures is documented in `scripts/README.md` and
            at the top of `src/lib/about.ts`, where whoever needs it will be. */}
        <p className="text-[11px] text-muted">
          * Zero to production in {toV1} days; live for the team since 29 July. Figures generated{" "}
          {formatDay(ABOUT.generatedAt)}.
        </p>
      </div>
    </Modal>
  );
}

/** `$5,787` — money always leads with its symbol, even mid-sentence. */
function formatMoney(usd: number): string {
  return `$${group(Math.round(usd))}`;
}

/** `claude-opus-4-8` → `Opus 4.8` — the API id is not what a person reads. */
function modelName(id: string): string {
  return id
    .replace(/^claude-/, "")
    .replace(/-(\d)-(\d)$/, " $1.$2")
    .replace(/-(\d)$/, " $1")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** `4383` (millions) reads as noise; `4.4B` is the same fact at a glance. */
function formatTokens(millions: number): string {
  return millions >= 1000 ? `${(millions / 1000).toFixed(1)}B` : `${millions}M`;
}

/** "5 July" — the panel's prose voice, where a slashed date would read as data. */
function formatDay(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  });
}

/** "5 Jul" — the rail, where the long form would not fit. */
function formatShort(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
