"use client";

import type { Client, Profile } from "@/lib/types";

const AVATAR_COLORS = [
  "#0b43ed",
  "#7c5cff",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#e879a0",
  "#06b6d4",
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function hashColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

export function Avatar({ profile, size = 28 }: { profile: Profile | null; size?: number }) {
  if (!profile) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-dashed border-border-strong text-faint shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
        title="Unassigned"
      >
        ?
      </span>
    );
  }
  if (profile.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.avatarUrl}
        alt={profile.name}
        title={profile.name}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size, opacity: profile.active ? 1 : 0.45 }}
      />
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        backgroundColor: hashColor(profile.name),
        opacity: profile.active ? 1 : 0.45,
      }}
      title={profile.name}
    >
      {initials(profile.name)}
    </span>
  );
}

export function ClientChip({ client, size = "md" }: { client: Client; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium ${size === "sm" ? "text-xs" : "text-sm"}`}
    >
      <span
        className="rounded-full shrink-0"
        style={{
          width: size === "sm" ? 8 : 10,
          height: size === "sm" ? 8 : 10,
          backgroundColor: client.color,
        }}
      />
      {client.name}
    </span>
  );
}

export function TagBadge({ tag }: { tag: string }) {
  const styles: Record<string, string> = {
    "in design": "bg-brand-soft text-brand-dark",
    "waiting for client approval": "bg-amber-100 text-amber-800",
    "in development": "bg-purple-100 text-purple-800",
    "done and approved": "bg-emerald-100 text-emerald-800",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${styles[tag] ?? "bg-gray-100 text-gray-700"}`}
    >
      {tag}
    </span>
  );
}

export function BudgetBar({
  doneMinutes,
  estimateHours,
}: {
  doneMinutes: number;
  estimateHours: number | null;
}) {
  if (estimateHours == null) return null;
  const doneH = doneMinutes / 60;
  const pct = Math.min(100, (doneH / estimateHours) * 100);
  const over = doneH > estimateHours;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-1.5 w-16 rounded-full bg-border overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full ${over ? "bg-danger" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs whitespace-nowrap ${over ? "text-danger font-semibold" : "text-muted"}`}>
        {doneH % 1 === 0 ? doneH : doneH.toFixed(1)}/{estimateHours}h
      </span>
    </div>
  );
}
