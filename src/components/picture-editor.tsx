"use client";

import { useRef, useState } from "react";
import { Pencil, Trash2, Upload, X } from "lucide-react";
import { useData } from "@/lib/store";
import { Avatar } from "./ui";
import { MemberPhoto } from "./member-photo";
import type { Profile } from "@/lib/types";

/**
 * Upload / replace / remove one of a member's two pictures.
 *   avatar — small round avatar (initials, a graphic, or a headshot)
 *   photo  — the studio cut-out portrait used on the home hero + team cards
 *
 * Rendered for the member themselves and for admins editing someone else.
 */
/** Upload/remove plumbing shared by the titled pane and the compact hero badge. */
function usePicture(profile: Profile, kind: "avatar" | "photo") {
  const { patchProfileLocal } = useData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = kind === "avatar" ? profile.avatarUrl : profile.photoUrl;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    body.append("kind", kind);
    body.append("targetId", profile.id);
    const res = await fetch("/api/member-image", { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Upload failed");
      return;
    }
    patchProfileLocal(profile.id, kind === "avatar" ? { avatarUrl: json.url } : { photoUrl: json.url });
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/member-image?kind=${kind}&targetId=${profile.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Could not remove the picture");
      return;
    }
    patchProfileLocal(profile.id, kind === "avatar" ? { avatarUrl: null } : { photoUrl: null });
  }

  /** The hidden <input> both views render; keeps the ref and reset in one place. */
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) upload(f);
        e.target.value = "";
      }}
    />
  );

  return { current, busy, error, remove, fileInput, pick: () => inputRef.current?.click() };
}

export function PictureEditor({
  profile,
  kind,
  title,
  hint,
}: {
  profile: Profile;
  kind: "avatar" | "photo";
  title: string;
  hint: string;
}) {
  const { current, busy, error, remove, fileInput, pick } = usePicture(profile, kind);

  return (
    <div className={`flex items-center gap-4 ${busy ? "opacity-60" : ""}`}>
      <button
        onClick={pick}
        title={`Change ${title.toLowerCase()}`}
        className="group/pic relative shrink-0 rounded-full"
      >
        {kind === "avatar" ? (
          <Avatar profile={profile} size={64} />
        ) : (
          <MemberPhoto name={profile.name} src={profile.photoUrl} variant="avatar" size={64} fallback={profile.hasAccount === false ? "initials" : "cutout"} />
        )}
        <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-black/45 text-white group-hover/pic:flex">
          <Pencil size={16} />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={pick}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium hover:border-brand hover:text-brand disabled:opacity-50"
          >
            <Upload size={13} /> {current ? "Replace" : "Upload"}
          </button>
          {current && (
            <button
              onClick={remove}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted hover:border-danger hover:text-danger disabled:opacity-50"
            >
              <Trash2 size={13} /> Remove
            </button>
          )}
          {busy && <span className="text-xs text-muted">Uploading…</span>}
        </div>
        {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
      </div>

      {fileInput}
    </div>
  );
}

/**
 * The picture on its own with a pencil badge — for heroes and headers, where a
 * titled pane with copy would take more room than the image it describes.
 * Click the image (or the badge) to replace; the × clears it.
 */
export function PictureEditBadge({
  profile,
  kind,
  size = 56,
  round = true,
  className = "",
}: {
  profile: Profile;
  kind: "avatar" | "photo";
  size?: number;
  round?: boolean;
  className?: string;
}) {
  const { current, busy, error, remove, fileInput, pick } = usePicture(profile, kind);
  const label = kind === "avatar" ? "avatar" : "studio portrait";

  return (
    <div
      className={`relative shrink-0 ${busy ? "opacity-60" : ""} ${className}`}
      style={{ width: size }}
      title={error ?? undefined}
    >
      <button
        onClick={pick}
        title={`Change ${label}`}
        aria-label={`Change ${label}`}
        className={`group/pic relative block ${round ? "rounded-full" : "rounded-xl"}`}
      >
        {kind === "avatar" ? (
          <Avatar profile={profile} size={size} />
        ) : (
          <MemberPhoto name={profile.name} src={profile.photoUrl} variant="avatar" size={size} fallback={profile.hasAccount === false ? "initials" : "cutout"} />
        )}
        <span
          className={`absolute inset-0 hidden items-center justify-center bg-black/45 text-white group-hover/pic:flex ${round ? "rounded-full" : "rounded-xl"}`}
        >
          <Pencil size={Math.max(12, Math.round(size / 4))} />
        </span>
      </button>
      {current && !busy && (
        <button
          onClick={remove}
          title={`Remove ${label}`}
          aria-label={`Remove ${label}`}
          className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-card hover:border-danger hover:text-danger"
        >
          <X size={11} />
        </button>
      )}
      {error && <span className="sr-only">{error}</span>}
      {fileInput}
    </div>
  );
}

/** Both pictures, stacked — used on Settings (self) and the member page (admin). */
export function MemberPictures({ profile }: { profile: Profile }) {
  return (
    <div className="flex flex-col gap-5">
      <PictureEditor
        profile={profile}
        kind="avatar"
        title="Avatar"
        hint="Small round picture used in tables, avatars and the sidebar. Initials, a graphic or a headshot."
      />
      <div className="border-t border-border" />
      <PictureEditor
        profile={profile}
        kind="photo"
        title="Studio portrait"
        hint="Cut-out photo (head to arms, white studio&more tee, transparent background) shown on the home welcome pane and team card."
      />
    </div>
  );
}
