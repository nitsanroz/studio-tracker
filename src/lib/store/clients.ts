"use client";

// Clients and member profiles.
//
// ⚠️ `updateClient` is not a plain row update: marking a client Internal flips
// every one of its tasks non-billable, so it edits tasks too and records the
// whole thing as ONE undo step (`asOneStep`). Splitting that into two steps
// would let an undo leave a client billable with non-billable tasks under it.
//
// ⚠️ `updateProfile` holds the end-date invariant that migration 0020 also
// enforces in the DB: an end date implies inactive, and restoring somebody has
// to clear the date or the trigger immediately re-archives them.
//
// See ./plan.ts for why deps arrive as an object and the result is memoized.

import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapClient, mapTask, updateWithOptional } from "../db";
import { inversePatch } from "./helpers";
import type { HistoryAction, Store } from "./types";
import type { Client, Profile, Task } from "../types";

export interface ClientDeps {
  supabase: SupabaseClient;
  clients: Client[];
  setClients: Dispatch<SetStateAction<Client[]>>;
  profiles: Profile[];
  setProfiles: Dispatch<SetStateAction<Profile[]>>;
  /** tag id → name, so a task rebuilt after a billable flip keeps its tag. */
  tagNameById: Map<string, string>;
  /** One-off banner, e.g. when a billable flip touched tasks. */
  setNotice: (text: string) => void;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  record: (action: Omit<HistoryAction, "epoch">) => void;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
  methodsRef: RefObject<Store | null>;
}

export function useClientActions(deps: ClientDeps) {
  const {
    supabase,
    clients,
    setClients,
    profiles,
    setProfiles,
    setTasks,
    tagNameById,
    setNotice,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  } = deps;

  /**
   * A new client, with the non-billable Keys task every client needs.
   *
   * ⚠️⚠️ THE KEYS TASK IS CREATED HERE, AND THAT IS THE ONLY WAY IT CAN BE
   * RELIABLE. Every client the studio bills has a "«Client» Keys" task — it is
   * where hours are written down to before a client report (migration 0037) — and
   * for the first fourteen clients somebody made it by hand. A client without one
   * silently has NO write-down control anywhere in the app, which reads as the
   * feature being broken rather than as a task being missing.
   * ⚠️ `billable: false` explicitly, NOT inherited from the client: `addTask`
   * copies the client's flag, and a new client is billable, so a keys task created
   * that way would keep billing the client — the exact opposite of a write-down.
   * ⚠️ The task and the pointer are BEST-EFFORT, and deliberately not fatal: the
   * client row is already committed by then, and failing the whole creation over
   * the keys task would lose a client somebody just typed. Either half can be
   * fixed later from the Keys-task picker on Client Reports.
   */
  const addClient = useCallback(
    async (name: string, color: string, billingPeriodNote?: string): Promise<Client | null> => {
      const { data, error } = await counting(
        supabase
          .from("clients")
          .insert({ name, color, billing_period_note: billingPeriodNote ?? "" })
          .select()
          .single(),
      );
      if (error) {
        noteWriteError("addClient", error);
        return null;
      }
      let client = mapClient(data);

      const keys = await counting(
        supabase
          .from("tasks")
          .insert({
            client_id: client.id,
            title: `${name} Keys`,
            billable: false,
            position: 1,
          })
          .select()
          .single(),
      );
      if (keys.error || !keys.data) {
        noteWriteError("addClient keys task", keys.error ?? { message: "keys task not created" });
      } else {
        setTasks((prev) => [...prev, mapTask(keys.data, tagNameById)]);
        // 0037's column goes through `updateWithOptional` for the reason
        // `updateClient` documents: a missing column on a WRITE is PGRST204 and
        // fails the whole statement.
        const res = await updateWithOptional(
          supabase,
          "clients",
          { id: client.id },
          {},
          { keys_task_id: keys.data.id as string },
        );
        if (res.error) noteWriteError("addClient keys pointer", res.error);
        else if (!res.degraded) client = { ...client, keysTaskId: keys.data.id as string };
      }

      setClients((prev) => [...prev, client]);
      return client;
    },
    [supabase, noteWriteError, counting, tagNameById, setClients, setTasks],
  );

  const patchProfileLocal = useCallback(
    (profileId: string, patch: Partial<Profile>) => {
      setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, ...patch } : p)));
    },
    [setProfiles],
  );

  /**
   * Local-only client patch, for a value an API ROUTE has already written with
   * the service key (the client-icon upload). Calling `updateClient` instead
   * would issue a second, redundant write — and record an undo step for a change
   * the store never made.
   */
  const patchClientLocal = useCallback(
    (clientId: string, patch: Partial<Client>) => {
      setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, ...patch } : c)));
    },
    [setClients],
  );

  const updateProfile = useCallback(
    (profileId: string, patch: Partial<Profile>) => {
      const before = profiles.find((p) => p.id === profileId);
      // An end date and `active` are two halves of one fact, and migration 0020
      // enforces the first half in the DB (a trigger). Mirror it here so the UI
      // doesn't briefly disagree with the row, and close the other direction too:
      // restoring somebody has to clear the date, or the trigger just re-archives
      // them and the button looks broken.
      if (patch.endDate) patch = { ...patch, active: false };
      else if (patch.active === true && before?.endDate) patch = { ...patch, endDate: null };
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateProfile(profileId, prev),
          redo: () => methodsRef.current?.updateProfile(profileId, patch),
        });
      }
      setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, ...patch } : p)));
      const row: Record<string, unknown> = {};
      if ("name" in patch) row.name = patch.name;
      if ("role" in patch) row.role = patch.role;
      if ("active" in patch) row.active = patch.active;
      if ("startDate" in patch) row.start_date = patch.startDate;
      if ("endDate" in patch) row.end_date = patch.endDate;
      if ("capacityHoursWeek" in patch) row.capacity_hours_week = patch.capacityHoursWeek;
      supabase
        .from("profiles")
        .update(row)
        .eq("id", profileId)
        .then(wrote("updateProfile"));
    },
    [supabase, profiles, record, wrote, methodsRef, setProfiles],
  );

  const updateClient = useCallback(
    (clientId: string, patch: Partial<Client>) => {
      // billable flips cascade to tasks — too side-effectful to undo cleanly
      const before = "billable" in patch ? undefined : clients.find((c) => c.id === clientId);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateClient(clientId, prev),
          redo: () => methodsRef.current?.updateClient(clientId, patch),
        });
      }
      setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, ...patch } : c)));
      const row: Record<string, unknown> = {};
      if ("name" in patch) row.name = patch.name;
      if ("color" in patch) row.color = patch.color;
      if ("archived" in patch) row.archived = patch.archived;
      if ("billingPeriodNote" in patch) row.billing_period_note = patch.billingPeriodNote;
      if ("billable" in patch) row.billable = patch.billable;
      if ("invoiceNote" in patch) row.invoice_note = patch.invoiceNote;
      /**
       * ⚠️ 0033's two columns go through `updateWithOptional`, not into `row`.
       * A missing column on a WRITE is reported by PostgREST as PGRST204 and
       * fails the WHOLE update — so folding `hour_cap`/`report_notes` in here
       * would mean that, before that SQL is run, renaming a client or marking it
       * internal silently failed too. The optional pair is dropped and the rest
       * retried instead. See `updateWithOptional` for why this must never be used
       * for a value the app then relies on.
       */
      const optional: Record<string, unknown> = {};
      if ("hourCap" in patch) optional.hour_cap = patch.hourCap;
      if ("reportNotes" in patch) optional.report_notes = patch.reportNotes;
      // 0037. Optional for the same reason as the two above: a missing column on a
      // WRITE is PGRST204 and fails the whole update, which would break renaming a
      // client until the migration runs.
      if ("keysTaskId" in patch) optional.keys_task_id = patch.keysTaskId;
      const tail = wrote("updateClient");
      void updateWithOptional(supabase, "clients", { id: clientId }, row, optional).then((res) => {
        tail(res);
        // ⚠️ Say so rather than leaving local state claiming a value the database
        // does not have — it would look saved until the next refresh took it away.
        if (res.degraded && Object.keys(optional).length) {
          setNotice("The cap, notes and keys task weren't saved — migration 0033/0037 hasn't been run yet.");
        }
      });
      // Marking a client internal makes all its existing tasks non-billable.
      // The reverse is NOT mass-applied (keys tasks etc. must stay non-billable).
      if (patch.billable === false) {
        setTasks((prev) =>
          prev.map((t) => (t.clientId === clientId ? { ...t, billable: false } : t)),
        );
        supabase
          .from("tasks")
          .update({ billable: false })
          .eq("client_id", clientId)
          .then(wrote("updateClient tasks-billable"));
      }
    },
    [supabase, clients, record, wrote, methodsRef, setClients, setNotice, setTasks],
  );

  return useMemo(
    () => ({
      addClient,
      patchProfileLocal,
      patchClientLocal,
      updateProfile,
      updateClient,
    }),
    [
      addClient,
      patchProfileLocal,
      patchClientLocal,
      updateProfile,
      updateClient,
    ],
  );
}
