import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";
import type { Database } from "@/lib/types/database";

let admin: SupabaseClient<Database> | null = null;

/**
 * Privileged client (secret key). Bypasses RLS — only ever used inside route
 * handlers / server components after input validation, never sent to a browser.
 */
export function getAdminSupabase(): SupabaseClient<Database> {
  if (!admin) {
    admin = createClient<Database>(publicEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return admin;
}
