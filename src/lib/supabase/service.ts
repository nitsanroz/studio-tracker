import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role client, for server code that has already checked who's
 * asking (a cron secret, an owner check, a private token). Bypasses RLS.
 */
export function service(): SupabaseClient {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}
