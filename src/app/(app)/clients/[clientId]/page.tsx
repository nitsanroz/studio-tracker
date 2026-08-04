"use client";

import { use } from "react";
import { ClientView } from "@/components/client-view";

// The title used to live here and the action buttons one level down, on their own
// row. They are one line now, and it is ClientView that owns them: the buttons read
// its `showDone`/`view` state, so lifting them up here would mean lifting that state
// too — moving the title down was three lines.
export default function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  return <ClientView clientId={clientId} />;
}
