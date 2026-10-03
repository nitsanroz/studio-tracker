"use client";

// Leads from the website form that no admin has opened yet (0048) — the
// counterpart of an unread intake brief. One query for the whole app, held in
// context so the bell, the sidebar and the board agree on the same list.
//
// ⚠️ Leads live OUTSIDE the store (egress), so this is the one lead read that
// rides the store's refresh: it re-runs whenever `lastSyncedAt` moves, which
// means it pauses with the store when the tab is hidden or idle and never
// polls on a clock of its own. It asks for id + company of unseen rows only —
// normally zero or a handful.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useData, useIsAdmin } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";

export interface NewLead {
  id: string;
  company: string;
}

interface NewLeads {
  list: NewLead[];
  ids: Set<string>;
  /** Stamp a lead as opened. A no-op for one that isn't new. */
  markSeen: (id: string) => void;
}

const Ctx = createContext<NewLeads>({ list: [], ids: new Set(), markSeen: () => {} });

export function NewLeadsProvider({ children }: { children: ReactNode }) {
  const isAdmin = useIsAdmin();
  const { lastSyncedAt, currentUserId } = useData();
  const [loaded, setLoaded] = useState<NewLead[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      const { data, error } = await createClient()
        .from("leads")
        .select("id,company")
        .is("seen_at", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      // An error — 0048 not applied yet, or a blip — keeps what is on screen.
      if (alive && !error) setLoaded((data ?? []) as NewLead[]);
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin, lastSyncedAt]);

  // Under `?viewAs=` the store reports a member, who has no Leads at all.
  const list = useMemo(() => (isAdmin ? loaded : []), [isAdmin, loaded]);
  const ids = useMemo(() => new Set(list.map((l) => l.id)), [list]);

  const markSeen = useCallback(
    (id: string) => {
      if (!ids.has(id)) return;
      setLoaded((prev) => prev.filter((l) => l.id !== id));
      void createClient()
        .from("leads")
        .update({ seen_at: new Date().toISOString(), seen_by: currentUserId })
        .eq("id", id)
        .is("seen_at", null)
        .then(({ error }) => {
          if (error) console.warn("markSeen:", error.message);
        });
    },
    [ids, currentUserId],
  );

  const value = useMemo(() => ({ list, ids, markSeen }), [list, ids, markSeen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNewLeads(): NewLeads {
  return useContext(Ctx);
}
