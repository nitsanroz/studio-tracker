"use client";

import { useState } from "react";

/** Shared placeholder used for every member until per-person portraits are generated.
 *  Drop real cut-out PNGs (transparent bg, white studio&more tee, blue & on the chest)
 *  at /public/brand/team/<slug>.png and pass `src` to override per member. */
export const DEFAULT_TEAM_PHOTO = "/brand/team/placeholder.png";

function initials(name?: string) {
  if (!name) return "";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Team-member cut-out portrait.
 * - `variant="hero"`: full standing cut-out, bottom-anchored (for the welcome pane).
 * - `variant="avatar"`: circular crop, top-aligned (for team cards / rows).
 * Falls back to initials on a soft-brand chip if the image is missing, so the UI
 * never shows a broken image before the placeholder file is saved.
 */
export function MemberPhoto({
  name,
  src,
  variant = "avatar",
  size = 64,
  className = "",
}: {
  name?: string;
  src?: string | null;
  variant?: "avatar" | "hero";
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = src || DEFAULT_TEAM_PHOTO;

  if (variant === "hero") {
    return (
      <div
        className={className}
        style={{ position: "relative", width: size, height: size }}
      >
        {!failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={name ?? "Team member"}
            onError={() => setFailed(true)}
            style={{
              position: "absolute",
              bottom: 0,
              left: "50%",
              transform: "translateX(-50%)",
              height: "100%",
              width: "auto",
              maxWidth: "none",
              objectFit: "contain",
              filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.28))",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              paddingBottom: size * 0.12,
              color: "rgba(255,255,255,0.9)",
              fontWeight: 600,
              fontSize: size * 0.22,
            }}
          >
            {initials(name)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        background: "var(--brand-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name ?? "Team member"}
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top",
          }}
        />
      ) : (
        <span
          style={{
            color: "var(--brand-dark)",
            fontWeight: 600,
            fontSize: size * 0.34,
          }}
        >
          {initials(name)}
        </span>
      )}
    </div>
  );
}
