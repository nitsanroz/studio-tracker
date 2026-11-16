import { redirect } from "next/navigation";

/** Scenarios is a tab of the advisor's one page now (2026-11-16) — /advice. */
export default function ScenariosRedirect() {
  redirect("/advice?tab=scenarios");
}
