import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/shared/config/runtime";
import { hasAdminClaim } from "@/shared/lib/supabase/proxy";
import { createServerSupabaseClient } from "@/shared/lib/supabase/server";
import { AdminShell } from "@/widgets/admin-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createServerSupabaseClient();
      const { data, error } = await supabase.auth.getClaims();
      if (!error && data?.claims?.sub && !hasAdminClaim(data.claims as Record<string, unknown>)) {
        redirect("/login?reason=forbidden");
      }
    } catch {
      // Allow client-side Portal Auth guard in AdminShell when SSR Supabase cookies are absent
    }
  }

  return <AdminShell>{children}</AdminShell>;
}
