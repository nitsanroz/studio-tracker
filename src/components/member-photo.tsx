"use client";

import { useState, type CSSProperties } from "react";

/** Shared placeholder used for every member until per-person portraits are generated.
 *  Drop real cut-out PNGs (transparent bg, white studio&more tee, blue & on the chest)
 *  at /public/brand/team/<slug>.png and pass `src` to override per member.
 *
 *  NB: this points at cutout.png, a 640px resize of photo_transparent.png. The old
 *  placeholder.png was a *flattened* export — the Photoshop transparency
 *  checkerboard was baked into its pixels at alpha 255, which is why portraits
 *  looked chequered instead of sitting on the brand circle. It was also 6.7MB. */
export const DEFAULT_TEAM_PHOTO = "/brand/team/cutout.png";

/** Fraction of the frame height above the top of the head in the cut-out assets.
 *  Measured from the alpha channel; used to work out how far to scale a portrait
 *  so a chosen amount of head clears the top of the avatar circle. */
const HEAD_TOP_MARGIN = 0.039;

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
  bleed = 0,
}: {
  name?: string;
  src?: string | null;
  variant?: "avatar" | "hero";
  size?: number;
  className?: string;
  /** Fraction of `size` by which the head should break out above the circle. 0 = plain circular crop. */
  bleed?: number;
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

  // Head breaking the circle crop. The same image is drawn twice at identical
  // geometry: once inside the clipping circle (the body), once unclipped but
  // clipped to only the band ABOVE the circle (the head). Because both layers
  // share a position the join at the circle's edge is seamless — a single
  // oversized image can't do this, since letting the head out would also let
  // the shoulders spill past the circle's curve.
  if (bleed > 0 && !failed) {
    const drawn = (size * (1 + bleed)) / (1 - HEAD_TOP_MARGIN);
    const img: CSSProperties = {
      position: "absolute",
      left: "50%",
      bottom: 0,
      transform: "translateX(-50%)",
      width: drawn,
      height: drawn,
      maxWidth: "none",
      objectFit: "contain",
    };
    return (
      <div
        className={className}
        style={{ position: "relative", width: size, height: size, flex: "none" }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            overflow: "hidden",
            background: "var(--brand)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" style={img} onError={() => setFailed(true)} />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name ?? "Team member"}
          style={{ ...img, clipPath: `inset(0 0 ${size}px 0)` }}
        />
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
        background: "var(--brand)",
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
            // white, not brand-dark: the circle behind is now solid --brand
            color: "#fff",
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
