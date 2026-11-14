"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/finance/supabase-client";
import { termsFromClientRow } from "@/lib/finance/payment-terms";
import type { TermsByClient } from "@/lib/finance/receivables";

/**
 * Each client's payment terms and invoice day (the tracker's 0065/0066 +
 * `invoice_note`), by id AND by name — the Plan's rows carry the canon name and
 * not always an id. Selected as `*` so a column the database doesn't have yet is
 * simply absent rather than failing the read. Any failure is an empty map:
 * every line then counts the usual 14 days from the 1st, as before.
 */
export function useClientTerms(): TermsByClient {
  const [terms, setTerms] = useState<TermsByClient>(() => new Map());
  useEffect(() => {
    let alive = true;
    void createClient()
      .from("clients")
      .select("*")
      .then(({ data, error }) => {
        if (!alive || error || !data) return;
        const m: TermsByClient = new Map();
        for (const c of data as Record<string, unknown>[]) {
          const t = termsFromClientRow(c);
          m.set(String(c.id), t);
          m.set(String(c.name), t);
        }
        setTerms(m);
      });
    return () => {
      alive = false;
    };
  }, []);
  return terms;
}
