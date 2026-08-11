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
    <Modal onClose={dismiss} width="sm" labelledBy="whats-new-title">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Sparkles size={18} strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <h2 id="whats-new-title" className="text-lg font-semibold leading-tight">
              {release.version} is out
            </h2>
            <p className="text-xs text-muted">{formatDate(release.date)}</p>
          </div>
        </div>

        {release.image && (
          // `h-auto` with a max: a release picture is whatever shape it is, and
          // forcing one crops the very thing it was added to show.
          <Image
            src={release.image}
            alt={release.imageAlt ?? ""}
            width={640}
            height={380}
            className="max-h-[190px] w-full rounded-xl border border-border object-contain"
            unoptimized
          />
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
