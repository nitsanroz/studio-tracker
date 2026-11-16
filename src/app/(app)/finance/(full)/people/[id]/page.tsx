import { redirect } from "next/navigation";

/**
 * A person's money side is a set of tabs on their one page since 2026-11-15
 * (components/finance/person/finance-person.tsx). Old links land on its Pay tab.
 */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/team/${id}?tab=pay`);
}
