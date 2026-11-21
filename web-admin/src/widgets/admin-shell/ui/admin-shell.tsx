"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredPortalAuth } from "@/shared/api/api-client";
import { isSupabaseConfigured } from "@/shared/config/runtime";
import { cn } from "@/shared/lib/cn";
import { createBrowserSupabaseClient } from "@/shared/lib/supabase/client";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { Sidebar } from "./sidebar";
import { TopHeader } from "./top-header";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    let active = true;

    async function verifySession() {
      const portalAuth = getStoredPortalAuth();
      if (portalAuth?.accessToken) {
        if (active) setIsAuthorized(true);
        return;
      }

      if (isSupabaseConfigured()) {
        try {
          const supabase = createBrowserSupabaseClient();
          const { data } = await supabase.auth.getSession();
          if (data.session?.access_token) {
            if (active) setIsAuthorized(true);
            return;
          }
        } catch {
          // Fall through to login redirect
        }
      }

      if (active) router.replace("/login");
    }

    void verifySession();
    return () => {
      active = false;
    };
  }, [router]);

  if (!isAuthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50/80 text-sm text-slate-500">
        Đang xác thực phiên quản trị...
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-screen bg-slate-50/80">
        <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onCollapsedChange={() => setCollapsed((value) => !value)} onMobileClose={() => setMobileOpen(false)} />
        <div className={cn("min-h-screen transition-[padding] duration-200", collapsed ? "lg:pl-[76px]" : "lg:pl-[260px]")}>
          <TopHeader onMenuOpen={() => setMobileOpen(true)} />
          <main>{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
