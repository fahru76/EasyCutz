import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

export type StaffSession =
  | { kind: "signed_out" }
  | { kind: "not_staff"; email: string | null }
  | {
      kind: "staff";
      supabase: SupabaseClient<Database>;
      userId: string;
      displayName: string;
      role: Database["public"]["Enums"]["staff_role"];
    };

/** Resolves the current desk user. Authorisation is re-checked by every desk RPC. */
export async function getStaffSession(): Promise<StaffSession> {
  const supabase = await getServerSupabase();
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) return { kind: "signed_out" };

  const { data: staff } = await supabase
    .from("staff")
    .select("display_name, role")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!staff) return { kind: "not_staff", email: userData.user.email ?? null };

  return {
    kind: "staff",
    supabase,
    userId: userData.user.id,
    displayName: staff.display_name,
    role: staff.role,
  };
}
