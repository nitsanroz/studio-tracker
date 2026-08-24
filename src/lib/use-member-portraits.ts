"use client";

import { useEffect, useState } from "react";
import type { PortraitVariant } from "@/components/member-photo";

/**
 * profileId → which default cut-out to draw, from `/api/member-avatars`.
 *
 * Fetched ONCE per page load and shared through a module-level cache: the answer
 * comes from `member_hr`, which changes about as often as somebody joins, and the
 * team page alone would otherwise issue one request per card. An in-flight promise
 * is cached too, so several components mounting together share one request rather
 * than racing.
 *
 * ⚠️ Failure is silent and returns an empty map on purpose. Every caller's
 * fallback is the neutral cut-out that shipped before this existed, so a dropped
 * request costs a slightly different picture — not a broken one, and not an error
 * worth putting in front of anyone.
 */
type PortraitMap = Record<string, PortraitVariant>;

let cache: PortraitMap | null = null;
let inFlight: Promise<PortraitMap> | null = null;

function load(): Promise<PortraitMap> {
  if (cache) return Promise.resolve(cache);
  if (inFlight) return inFlight;
  inFlight = fetch("/api/member-avatars")
    .then((r) => (r.ok ? r.json() : { avatars: {} }))
    .then((j) => {
      cache = (j.avatars ?? {}) as PortraitMap;
      return cache;
    })
    .catch(() => ({}) as PortraitMap)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useMemberPortraits(): PortraitMap {
  const [map, setMap] = useState<PortraitMap>(() => cache ?? {});
  useEffect(() => {
    let alive = true;
    void load().then((m) => {
      if (alive) setMap(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return map;
}
