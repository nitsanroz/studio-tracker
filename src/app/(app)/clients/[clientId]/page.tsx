"use client";

import { use } from "react";
import { ClientView } from "@/components/client-view";
import { MobileClientView } from "@/components/client-mobile";
import { useIsNarrow } from "@/lib/use-is-narrow";

// The title used to live here and the action buttons one level down, on their own
// row. They are one line now, and it is ClientView that owns them: the buttons read
// its `showDone`/`view` state, so lifting them up here would mean lifting that state
// too — moving the title down was three lines.
//
// ⚠️ The phone gets a DIFFERENT COMPONENT, chosen in JS rather than with `md:`
// classes. Rendering both would mount `ClientView` on a phone — 2,900 lines that
// build a Gantt, measure columns and register drag handlers for a tree that is
// then hidden by CSS. Gating here means none of it runs.
export default function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const isNarrow = useIsNarrow();
  if (isNarrow) return <MobileClientView clientId={clientId} />;
  return <ClientView clientId={clientId} />;
}
