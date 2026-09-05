"use client";

// Client billing periods, and the whole-studio days off the plan and the Gantt
// read as non-working.
//
// The two sit together because they are the calendar the studio bills against:
// a period says which days a client is charged for, a day-off says which of
// those the studio did not work. See ./plan.ts for the extraction pattern.

import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBillingPeriod, mapDayState } from "../db";
import { inversePatch } from "./helpers";
import type { HistoryAction, Store } from "./types";
import type { BillingPeriod, DayState } from "../types";

export interface BillingDeps {
  supabase: SupabaseClient;
  billingPeriods: BillingPeriod[];
  setBillingPeriods: Dispatch<SetStateAction<BillingPeriod[]>>;
  setDayStates: Dispatch<SetStateAction<DayState[]>>;
  currentUserId: string | null;
  record: (action: Omit<HistoryAction, "epoch">) => void;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
  methodsRef: RefObject<Store | null>;
}

export function useBillingActions(deps: BillingDeps) {
  const {
    supabase,
    billingPeriods,
    setBillingPeriods,
    setDayStates,
    currentUserId,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  } = deps;

  /** Re-insert a deleted billing period with its original id (undo support). */
  const restoreBillingPeriod = useCallback(
    (p: BillingPeriod) => {
      setBillingPeriods((prev) =>
        [...prev.filter((x) => x.id !== p.id), p].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom)),
      );
      supabase
        .from("client_billing_periods")
        .insert({
          id: p.id,
          client_id: p.clientId,
          label: p.label,
          date_from: p.dateFrom,
          date_to: p.dateTo,
          hour_cap: p.hourCap,
          advance_hours: p.advanceHours,
          position: p.position,
          // omit `paid: false` so the insert also works before migration 0010
          ...(p.paid && { paid: true }),
        })
        .then(wrote("restoreBillingPeriod"));
    },
    [supabase, wrote, setBillingPeriods],
  );

  const addBillingPeriod = useCallback(
    (input: Omit<BillingPeriod, "id" | "position" | "paid">) => {
      const position =
        Math.max(0, ...billingPeriods.filter((p) => p.clientId === input.clientId).map((p) => p.position)) + 1;
      counting(
        supabase
          .from("client_billing_periods")
          .insert({
            client_id: input.clientId,
            label: input.label,
            date_from: input.dateFrom,
            date_to: input.dateTo,
            hour_cap: input.hourCap,
            advance_hours: input.advanceHours,
            position,
          })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addBillingPeriod", error);
            return;
          }
          const period = mapBillingPeriod(data);
          setBillingPeriods((prev) =>
            [...prev, period].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom)),
          );
          record({
            undo: () => methodsRef.current?.deleteBillingPeriod(period.id),
            redo: () => restoreBillingPeriod(period),
          });
        });
    },
    [supabase, billingPeriods, record, restoreBillingPeriod, noteWriteError, counting, methodsRef, setBillingPeriods],
  );

  const updateBillingPeriod = useCallback(
    (id: string, patch: Partial<BillingPeriod>) => {
      const before = billingPeriods.find((p) => p.id === id);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateBillingPeriod(id, prev),
          redo: () => methodsRef.current?.updateBillingPeriod(id, patch),
        });
      }
      setBillingPeriods((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      const row: Record<string, unknown> = {};
      if ("label" in patch) row.label = patch.label;
      if ("dateFrom" in patch) row.date_from = patch.dateFrom;
      if ("dateTo" in patch) row.date_to = patch.dateTo;
      if ("hourCap" in patch) row.hour_cap = patch.hourCap;
      if ("advanceHours" in patch) row.advance_hours = patch.advanceHours;
      if ("paid" in patch) row.paid = patch.paid;
      supabase
        .from("client_billing_periods")
        .update(row)
        .eq("id", id)
        .then(wrote("updateBillingPeriod"));
    },
    [supabase, billingPeriods, record, wrote, methodsRef, setBillingPeriods],
  );

  const deleteBillingPeriod = useCallback(
    (id: string) => {
      const before = billingPeriods.find((p) => p.id === id);
      if (before) {
        record({
          undo: () => restoreBillingPeriod(before),
          redo: () => methodsRef.current?.deleteBillingPeriod(id),
        });
      }
      setBillingPeriods((prev) => prev.filter((p) => p.id !== id));
      supabase
        .from("client_billing_periods")
        .delete()
        .eq("id", id)
        .then(wrote("deleteBillingPeriod"));
    },
    [supabase, billingPeriods, record, restoreBillingPeriod, wrote, methodsRef, setBillingPeriods],
  );

  const addDayState = useCallback(
    (dateFrom: string, dateTo: string, label: string) => {
      counting(
        supabase
          .from("plan_day_states")
          .insert({ date_from: dateFrom, date_to: dateTo, label, created_by: currentUserId })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addDayState", error);
            return;
          }
          setDayStates((prev) => [...prev, mapDayState(data)]);
        });
    },
    [supabase, currentUserId, noteWriteError, counting, setDayStates],
  );

  const deleteDayState = useCallback(
    (id: string) => {
      setDayStates((prev) => prev.filter((d) => d.id !== id));
      supabase
        .from("plan_day_states")
        .delete()
        .eq("id", id)
        .then(wrote("deleteDayState"));
    },
    [supabase, wrote, setDayStates],
  );

  return useMemo(
    () => ({
      restoreBillingPeriod,
      addBillingPeriod,
      updateBillingPeriod,
      deleteBillingPeriod,
      addDayState,
      deleteDayState,
    }),
    [
      restoreBillingPeriod,
      addBillingPeriod,
      updateBillingPeriod,
      deleteBillingPeriod,
      addDayState,
      deleteDayState,
    ],
  );
}
