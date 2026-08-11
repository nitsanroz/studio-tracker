"use client";

// "Version 1.12.0 is out" — shown once per release, per person, on the first
// sign-in after it ships.
//
// ⚠️ Dismissal lives in localStorage, NOT in `profiles`. Two reasons, and the
// second is the load-bearing one: this app's stated convention is that per-user
// UI preferences go in localStorage rather than a `profiles.prefs` column
// (v1.1.0); and migration 0021's trigger lets a member write only
// `name`/`avatar_url`/`photo_url`, so a `seen_version` column would need either
// an amended trigger or a service-role API route — a lot of machinery for
// "I've read this". The cost is that someone who uses both a laptop and a
// phone sees it once on each, which for a release note is fine.

import { useEffect, useState } from "react";
import Image from "next/image";
import { Sparkles } from "lucide-react";
import { useIsAdmin } from "@/lib/store";
import { APP_VERSION } from "@/lib/version";
import { releaseFor } from "@/lib/whats-new";
import { formatDate } from "@/lib/format";
import { Modal } from "./ui";

const SEEN_KEY = "whatsnew.seen";

export function WhatsNewModal({ suppressed = false }: { suppressed?: boolean }) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const release = releaseFor(APP_VERSION, isAdmin);

  // Read in an effect, never in the useState initialiser — the server renders
  // this too, and reading localStorage there is a hydration mismatch. Same
  // pattern as the theme and the folded sidebar.
  useEffect(() => {
    if (suppressed || !release) return;
    if (localStorage.getItem(SEEN_KEY) === APP_VERSION) return;
    setOpen(true);
  }, [suppressed, release]);

  // ⚠️ Marked seen on DISMISS, not on open. If it were marked on open, a reload
  // mid-read would lose the note for good — and this is the one screen in the
  // app whose entire job is to be read once.
  function dismiss() {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
    setOpen(false);
  }

  if (!open || !release) return null;

  return (
    // ⚠️ `align="center"`. The default is `top-1/3`, which with a
    // `-translate-y-1/2` card only works for short dialogs: this one is ~547px
    // once it has a picture strip, so a third of an 812px phone put its top edge
    // 3px ABOVE the viewport and clipped the heading. Centred it clears both
    // edges with room to spare.
    <Modal onClose={dismiss} width="sm" align="center" labelledBy="whats-new-title">
      <div className="flex flex-col gap-4">
        {/* The date sits at the far end rather than under the heading: stacked,
            it forced the title into the top half of its own row and left the
            icon aligned to nothing. On one line the title can be `text-xl` and
            sit dead centre against the icon, which is the only thing here that
            needs to read as a headline. */}
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Sparkles size={20} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 id="whats-new-title" className="min-w-0 flex-1 text-xl font-semibold leading-tight">
            {release.version} is out
          </h2>
          <span className="shrink-0 self-center whitespace-nowrap text-xs text-muted">
            {formatDate(release.date)}
          </span>
        </div>

        {release.images && release.images.length > 0 && (
          // One picture fills the width; several become a swipeable strip, each
          // at a fixed 260px so the next one peeks in at the edge — without that
          // hint nobody discovers there is a second. `snap-x` makes a swipe land
          // on a picture rather than between two.
          <div
            className={`-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 [scrollbar-width:none] ${
              release.images.length === 1 ? "" : "pb-1"
            }`}
          >
            {release.images.map((img) => (
              <Image
                key={img.src}
                src={img.src}
                alt={img.alt}
                width={300}
                height={190}
                className={`h-[190px] shrink-0 snap-center rounded-xl border border-border bg-background object-cover ${
                  release.images!.length === 1 ? "w-full" : "w-[260px]"
                }`}
                unoptimized
              />
            ))}
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {release.items.map((it) => (
            <li key={it.title} className="flex gap-2.5">
              <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
              <div>
                <p className="text-sm font-semibold leading-snug">{it.title}</p>
                {it.body && <p className="text-[13px] leading-relaxed text-muted">{it.body}</p>}
              </div>
            </li>
          ))}
        </ul>

        <button
          onClick={dismiss}
          className="min-h-11 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}
