"use client";

import { MyVacationCard, VacationApprovals } from "@/components/vacation";
import { useVacation } from "@/lib/use-vacation";

/**
 * Vacation (migration 0058): your balance and requests for everyone, and the
 * requests to decide for the owner. Until 0058 is run both cards render nothing,
 * so the page says so rather than standing empty.
 */
export default function VacationPage() {
  const vacation = useVacation();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl">Vacation</h1>
      {vacation.ready ? (
        <>
          <VacationApprovals vacation={vacation} />
          <MyVacationCard vacation={vacation} full />
        </>
      ) : vacation.unavailable ? (
        <p className="text-sm text-muted">Vacation isn&apos;t switched on yet — it needs migration 0058.</p>
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
    </div>
  );
}
