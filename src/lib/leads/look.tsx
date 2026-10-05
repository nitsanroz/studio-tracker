// How stages and sources LOOK — colour and icon (Nitsan, 2026-10-03).
//
// Stage look is data (0046: `lead_stages.color` / `icon`), editable in
// Settings → Leads, because stages are renamed and added there. Source look is
// code, because the sources are a fixed list.
//
// ⚠️ AN UNKNOWN ICON KEY OR A MISSING COLOUR NEVER BREAKS ANYTHING: it falls
// back to a plain dot in the neutral colour. That is what a stage added before
// anybody picked a look for it shows, and what every stage shows before 0046.

import {
  CalendarCheck,
  CircleX,
  Compass,
  Eye,
  FileText,
  Flag,
  Globe,
  Handshake,
  History,
  Hourglass,
  Mail,
  MessageCircle,
  PenLine,
  Phone,
  Rocket,
  Scale,
  Send,
  Snowflake,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { LeadSource, LeadStage } from "./types";

export const NEUTRAL = "#6b7280";

/** The curated set a stage can wear. Keys are what 0046 stores. */
export const STAGE_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  compass: Compass,
  pen: PenLine,
  send: Send,
  scale: Scale,
  trophy: Trophy,
  "circle-x": CircleX,
  handshake: Handshake,
  "file-text": FileText,
  phone: Phone,
  calendar: CalendarCheck,
  mail: Mail,
  message: MessageCircle,
  eye: Eye,
  target: Target,
  star: Star,
  flag: Flag,
  rocket: Rocket,
  hourglass: Hourglass,
  snowflake: Snowflake,
};

/** The palette offered beside each stage — the studio's client hues. */
export const STAGE_COLORS = [
  "#6181e8", "#0891b2", "#7c3aed", "#0b43ed", "#ea580c", "#0f9d58",
  "#ca8a04", "#e11d48", "#c026d3", "#00a5b5", "#06112f", "#6b7280",
];

export function StageIcon({ stage, size = 13 }: { stage: Pick<LeadStage, "icon" | "color"> | undefined; size?: number }) {
  const Icon = stage?.icon ? STAGE_ICONS[stage.icon] : undefined;
  const color = stage?.color || NEUTRAL;
  if (!Icon) {
    return (
      <span
        className="inline-block shrink-0 rounded-full"
        style={{ width: size * 0.6, height: size * 0.6, backgroundColor: color }}
        aria-hidden
      />
    );
  }
  return <Icon size={size} strokeWidth={2} style={{ color }} className="shrink-0" aria-hidden />;
}

/** Border/fill/ink for a control that wears a stage's colour (the lead page's stage picker). */
export function stageStyle(stage: Pick<LeadStage, "color"> | null | undefined) {
  const color = stage?.color || NEUTRAL;
  return { color, backgroundColor: `${color}14`, borderColor: `${color}4d` };
}

/** A stage as a small tinted chip: icon + name in the stage's colour. */
export function StageChip({ stage, className = "" }: { stage: LeadStage | undefined; className?: string }) {
  if (!stage) return <span className="text-faint">—</span>;
  const color = stage.color || NEUTRAL;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${className}`}
      style={{ color, backgroundColor: `${color}1a` }}
    >
      <StageIcon stage={stage} size={12} />
      <span className="bidi-auto truncate">{stage.name}</span>
    </span>
  );
}

/** LinkedIn's mark — lucide dropped brand icons (same drawing as the candidate page). */
function LinkedInMark({ size = 13 }: { size?: number }) {
  return (
    // ⚠️ A white mark on a FILLED rounded square (the brand's own app-icon
    // shape) in the icon's colour, filling the full box so it carries the same
    // visual weight as the Globe beside other names — an outline with a small
    // mark inside read as a smaller icon than its neighbours.
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="22" height="22" rx="5" fill="currentColor" />
      <path
        transform="translate(4.1 4.5) scale(0.6)"
        fill="var(--li-ink, #fff)"
        d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM2.4 21.5h5.2V9.5H2.4v12zM9.9 9.5h4.98v1.64h.07c.7-1.25 2.4-2.14 4.05-2.14 4.33 0 5 2.6 5 5.98v6.52h-5.2v-5.78c0-1.38-.02-3.15-2-3.15-2 0-2.3 1.5-2.3 3.05v5.88H9.9v-12z"
      />
    </svg>
  );
}

const SOURCE_ICON: Record<LeadSource, LucideIcon | "linkedin"> = {
  website: Globe,
  linkedin: "linkedin",
  cold: Send,
  referral: Users,
  past_client: History,
};

export function SourceIcon({ source, size = 13, className = "" }: { source: LeadSource | null; size?: number; className?: string }) {
  if (!source) return null;
  const Icon = SOURCE_ICON[source];
  if (!Icon) return null;
  return (
    <span className={`inline-flex shrink-0 ${className}`}>
      {Icon === "linkedin" ? <LinkedInMark size={size} /> : <Icon size={size} strokeWidth={1.75} aria-hidden />}
    </span>
  );
}
