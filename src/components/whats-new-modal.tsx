"use client";

// "Version 1.12.0 is out" — shown once per release, per person, on the first
// sign-in after it ships. On a laptop it walks through one point at a time with
// a picture; on a phone it is a plain list.
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
import { useIsAdmin } from "@/lib/store";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { APP_VERSION } from "@/lib/version";
import { whatsNewSince, type Step, type WhatsNew } from "@/lib/whats-new";
import { formatDate } from "@/lib/format";
import { Modal, ModalClose } from "./ui";

const SEEN_KEY = "whatsnew.seen";

/** The blue box. A step with no picture of its own falls back to the studio mark. */
function Visual({ step }: { step: Step }) {
  return (
    <div className="relative flex shrink-0 items-start justify-center overflow-hidden bg-brand md:w-[45%]">
      {step.image ? (
        // Taller than its box and anchored to the top, so the panel CROPS the
        // device — it runs off the bottom edge instead of floating inside a
        // frame with air around it, which is what makes it read as a product
        // shot rather than a sticker.
        <Image
          key={step.image.src}
          src={step.image.src}
          alt={step.image.alt}
          width={200}
          height={400}
          className="mt-9 h-[460px] w-auto max-w-none drop-shadow-xl"
          unoptimized
        />
      ) : (
        <span
          className="brand-wordmark mt-32 w-40 bg-white/90"
          aria-hidden
        />
      )}
    </div>
  );
}

export function WhatsNewModal({ suppressed = false }: { suppressed?: boolean }) {
  const isAdmin = useIsAdmin();
  const isNarrow = useIsNarrow();
  // ⚠️ Held in state, not derived on every render: it is computed FROM
  // localStorage, which the server cannot read, so deriving it during render
  // would be a hydration mismatch. Resolved once, in the effect below.
  const [news, setNews] = useState<WhatsNew | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (suppressed) return;
    const found = whatsNewSince(localStorage.getItem(SEEN_KEY), isAdmin);
    if (!found) return;
    setNews(found);
    setOpen(true);
  }, [suppressed, isAdmin]);

  // ⚠️ Marked seen on DISMISS, not on open. If it were marked on open, a reload
  // mid-read would lose the note for good — and this is the one screen in the
  // app whose entire job is to be read once. Closing early still counts: having
  // decided not to read it is a decision, and re-showing it would be nagging.
  function dismiss() {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
    setOpen(false);
  }

  if (!open || !news) return null;
  const latest = news.releases[0];
  const heading = (
    <div>
      <p className="mb-1 text-xs text-muted">{formatDate(latest.date)}</p>
      <h2 id="whats-new-title" className="text-2xl font-semibold leading-tight">
        {latest.version} is out
      </h2>
    </div>
  );

  // ── Phone: no stepper, no pictures ──────────────────────────────────────
  // Deliberately the plain list. Stepping through five screens with a Next
  // button is a lot of taps for something nobody asked to read, the pictures are
  // phone mockups being shown ON a phone, and at 375px the two-column layout the
  // stepper exists to fill isn't there anyway.
  if (isNarrow) {
    return (
      <Modal onClose={dismiss} width="sm" align="center" labelledBy="whats-new-title">
        <div className="flex max-h-[80dvh] flex-col gap-4">
          {heading}
          <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2">
            {news.steps.map((s) => (
              <div key={s.title}>
                <p className="text-sm font-semibold leading-snug">{s.title}</p>
                {s.body && <p className="text-[13px] leading-relaxed text-muted">{s.body}</p>}
              </div>
            ))}
            {news.olderCount > 0 && (
              <p className="text-[13px] text-faint">
                + {news.olderCount} more from earlier releases.
              </p>
            )}
          </div>
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

  // ── Desktop: one point at a time ────────────────────────────────────────
  const current = news.steps[step];
  const last = step === news.steps.length - 1;

  return (
    // ⚠️ `p-0!` — NOT `p-0`. Tailwind orders `p-4` after `p-0` in the sheet, so
    // class order never decides it and the card keeps a 16px white frame; the
    // blue panel has to reach its own edges. (Cost several rounds in v1.9.0.)
    <Modal
      onClose={dismiss}
      width="3xl"
      align="center"
      labelledBy="whats-new-title"
      className="overflow-hidden p-0!"
    >
      {/* A FIXED height, not one that follows the text. Steps have wildly
          different amounts of copy, and a card that resized under the Next
          button would move the button out from under the cursor using it. */}
      <div className="relative flex h-[440px] flex-row">
        {/* ⚠️ `ModalClose` is NOT absolutely positioned on its own — it is a
            plain `shrink-0` button, so dropped straight into this flex row it
            became the FIRST column and shoved the blue panel off the card's
            left edge. Every other caller puts it in a header row, where that is
            what you want; a bleeding two-column card has to pin it. */}
        <span className="absolute right-3 top-3 z-10">
          <ModalClose onClose={dismiss} />
        </span>

        <Visual step={current} />

        <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          {heading}

          <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
            {/* Only when this point came from an OLDER release than the one the
                heading names — otherwise it would label every step redundantly. */}
            {current.version !== latest.version && (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                {current.version} · {formatDate(current.date)}
              </p>
            )}
            <p className="text-lg font-semibold leading-snug">{current.title}</p>
            {current.body && (
              <p className="text-sm leading-relaxed text-muted">{current.body}</p>
            )}
            {last && news.olderCount > 0 && (
              <p className="mt-1 text-[13px] text-faint">
                + {news.olderCount} more from earlier releases.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Dots are a progress READOUT, not a control — a 6px target is not
                a button, and jumping steps isn't worth the hit area. */}
            {news.steps.length > 1 && (
              <div className="flex items-center gap-1.5" aria-hidden>
                {news.steps.map((s, i) => (
                  <span
                    key={s.title}
                    className={`size-1.5 rounded-full transition-colors ${
                      i === step ? "bg-brand" : "bg-border-strong"
                    }`}
                  />
                ))}
              </div>
            )}
            <span className="sr-only" aria-live="polite">
              Step {step + 1} of {news.steps.length}
            </span>
            <button
              onClick={() => (last ? dismiss() : setStep((s) => s + 1))}
              className="ml-auto min-h-10 rounded-lg bg-brand px-5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              {last ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
