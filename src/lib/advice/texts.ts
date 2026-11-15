// Every sentence &advice shows that isn't fixed interface text — the cards'
// titles and bodies, their links' labels, the figures' notes, the reviews'
// summaries. This is what the Hebrew option translates (hebrew.ts); the fixed
// interface text has its own dictionary (he-ui.ts).
//
// Pure and client-safe: the pane computes the list from the view it was given
// and asks the server for the Hebrew of each.

import type { AdviceBoard } from "./board";
import type { AdviceRow } from "./merge";
import type { AdviceView } from "./run";

/** A card's title and body as shown: Claude's wording when there is one, the rule's otherwise. */
export const shownTitle = (it: AdviceRow) => it.wordedTitle ?? it.title;
export const shownBody = (it: AdviceRow) => it.wordedBody ?? it.body;

function rowTexts(it: AdviceRow): string[] {
  const out = [shownTitle(it), shownBody(it), it.area];
  if (typeof it.facts.action === "string") out.push(it.facts.action);
  // The one-click fix's button (finance's `Fix`, stored as JSON).
  if (typeof it.facts.fix === "string") {
    try {
      const label = (JSON.parse(it.facts.fix) as { label?: unknown }).label;
      if (typeof label === "string") out.push(label);
    } catch {
      /* not a fix after all */
    }
  }
  return out;
}

/** The view's (and the page's board's) translatable sentences, each once. */
export function viewTexts(view: AdviceView, board?: AdviceBoard | null): string[] {
  const out: string[] = [];
  for (const it of view.items) out.push(...rowTexts(it));
  for (const p of view.pulse) out.push(p.label, p.note, p.help);
  if (view.business?.summary) out.push(view.business.summary);
  for (const q of view.business?.questions ?? []) out.push(q);
  if (view.review?.summary) out.push(view.review.summary);
  for (const it of board?.hidden ?? []) out.push(...rowTexts(it));
  for (const it of board?.resolved ?? []) out.push(shownTitle(it), it.area);
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}
