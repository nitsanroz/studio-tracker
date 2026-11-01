import { notFound } from "next/navigation";
import { PanelLab } from "./panel-lab";

/**
 * Design lab, round 7: the task panel (`components/task-panel.tsx`), the side
 * pane every task opens in. Fixture task, invented client. Dev only.
 */
export const dynamic = "force-dynamic";

export default function PanelLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PanelLab />;
}
