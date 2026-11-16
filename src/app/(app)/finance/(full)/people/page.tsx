import { redirect } from "next/navigation";

/**
 * People is no longer a page (Nitsan, 2026-11-15): each person's cost, cost per
 * hour and return sit on their Team card and in Team's table, and their money
 * tabs on their own page. The address still answers, by sending you there.
 */
export default function PeoplePage() {
  redirect("/team");
}
