"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { MyVacationCard, VacationApprovals, VacationRequestModal, useMyVacationBalance } from "@/components/vacation";
import { Button } from "@/components/primitives";
import { useVacation } from "@/lib/use-vacation";
import { formatDays } from "@/lib/vacation";
import { PageSkeleton } from "@/components/skeleton";

/**
 * Vacation (migration 0058): your balance and requests for everyone, and the
 * requests to decide for the owner. Until 0058 is run both cards render nothing,
 * so the page says so rather than standing empty.
 *
 * Two columns for the approver — you on the left, the team on the right (picked
 * 2026-10-23); everyone else has only the left one, so it stays a readable width.
 */
export default function VacationPage() {
  const vacation = useVacation();
  const [asking, setAsking] = useState(false);
  // Your days left, for the headline — the card below uses the same hook.
  const left = useMyVacationBalance(vacation).balance?.available ?? null;
  const team = vacation.ready && vacation.approver;
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {/* The website's voice (2026-10-23): one headline, the figure that
              matters in brand-blue serif italic. */}
          <h1 className="page-title">
            Vacation
            {left !== null && (
              <>
                {" "}— <span className={`font-serif-accent font-normal ${left < 0 ? "text-danger" : "text-brand"}`}>
                  {formatDays(left)} {Math.abs(left) === 1 ? "day" : "days"}
                </span>{" "}
                left
              </>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Days come from your latest payslip; the owner approves each request.
          </p>
        </div>
        {vacation.ready && (
          <Button onClick={() => setAsking(true)} className="inline-flex items-center gap-1.5">
            <Plus size={16} strokeWidth={2} /> Request vacation
          </Button>
        )}
      </div>
      {vacation.ready ? (
        <div className={team ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]" : "max-w-2xl"}>
          <MyVacationCard vacation={vacation} full />
          {team && <VacationApprovals vacation={vacation} />}
        </div>
      ) : vacation.unavailable ? (
        <p className="text-sm text-muted">Vacation isn&apos;t switched on yet — it needs migration 0058.</p>
      ) : (
        <PageSkeleton />
      )}
      {asking && <VacationRequestModal vacation={vacation} onClose={() => setAsking(false)} />}
    </div>
  );
}
