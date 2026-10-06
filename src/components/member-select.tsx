"use client";

// The admin "whose hours are these?" picker, with the archived-members toggle.
//
// ⚠️ ONE COMPONENT FOR EVERY LOG-TIME SURFACE. The toggle first shipped in the
// day popup alone (v1.66.2), so whether an admin could correct a departed
// member's hours depended on which screen they opened — the Log time modal had
// no way to reach them. Same rule as `LogTimeForm`: the studio's rule lives once.

import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { useData } from "@/lib/store";
import { archivedMembers, loggableMembers } from "@/lib/members";

export function MemberSelect({
  value,
  onChange,
  className = "",
  width = "w-44",
  title = "Who these hours are for",
}: {
  value: string;
  onChange: (id: string) => void;
  /** styling for the select itself; its width comes from `width` (see below) */
  className?: string;
  /** a FIXED width class — never auto, or the archived names make it jump */
  width?: string;
  title?: string;
}) {
  const { profiles, currentUserId } = useData();
  const members = useMemo(() => loggableMembers(profiles, currentUserId), [profiles, currentUserId]);
  const archived = useMemo(() => archivedMembers(profiles), [profiles]);
  /**
   * Archived members are opt-in: a late correction for someone who has left is
   * rare, and 20+ former names would bury the current team. A value that is
   * already an archived person (an entry being edited, a day opened on them)
   * starts with the list open, or the select would show a name it doesn't offer.
   */
  const [showArchived, setShowArchived] = useState(() => archived.some((p) => p.id === value));

  return (
    <div className="flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={title}
        // ⚠️ A fixed width: a native select sizes itself to its widest option,
        // so adding the archived names would make it jump.
        className={`${width} truncate ${className}`}
      >
        {members.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id === currentUserId ? "Me" : p.name}
          </option>
        ))}
        {showArchived && archived.length > 0 && (
          <optgroup label="Archived">
            {archived.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {archived.length > 0 && (
        <button
          type="button"
          onClick={() => {
            // Hiding the list while an archived person is chosen would leave the
            // select showing a value it no longer offers.
            if (showArchived && archived.some((p) => p.id === value)) onChange(currentUserId);
            setShowArchived((v) => !v);
          }}
          aria-pressed={showArchived}
          aria-label={showArchived ? "Hide archived members" : "Include archived members"}
          title={
            showArchived
              ? "Hide archived members"
              : "Include archived members — for correcting the hours of someone who has left"
          }
          className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors ${
            showArchived ? "bg-brand-soft text-brand" : "text-faint hover:bg-background hover:text-foreground"
          }`}
        >
          <span className="relative flex">
            <Users size={15} strokeWidth={1.75} />
            {/* Off: a diagonal slash through the group, the usual "hidden" mark. */}
            {!showArchived && (
              <span
                aria-hidden
                className="absolute left-1/2 top-1/2 h-px w-[19px] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current"
              />
            )}
          </span>
        </button>
      )}
    </div>
  );
}
