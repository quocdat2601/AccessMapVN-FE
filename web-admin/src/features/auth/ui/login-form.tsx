"use client";

import { setStoredPortalAuth } from "@/shared/api/api-client";
import { getApiBaseUrl, isSupabaseConfigured } from "@/shared/config/runtime";
import { createBrowserSupabaseClient } from "@/shared/lib/supabase/client";
import { hasAdminClaim } from "@/shared/lib/supabase/proxy";
import { Button } from "@/shared/ui/button";
import { AlertTriangle, ArrowRight, Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

function safeNextPath(value?: string) {
  return value?.startsWith("/admin") ? value : "/admin";
}

function resolveInitialError(configurationMissing: boolean, forbidden: boolean): string | null {
  if (configurationMissing) {
    return "Supabase Auth chưa được cấu hình. Hãy bổ sung các biến môi trường theo .env.example.";
  }
  if (forbidden) {
    return "Tài khoản của bạn không có quyền truy cập hệ thống quản trị.";
  }
  return null;
}

function mapPortalLoginError(code?: string, status?: number): string {
  switch (code) {
    case "INVALID_CREDENTIALS":
      return "Email hoặc mật khẩu quản trị không chính xác.";
    case "AUTHORIZATION_FORBIDDEN":
      return "Tài khoản của bạn không có quyền truy cập hệ thống quản trị.";
    case "INVALID_LOGIN_REQUEST":
      return "Email hoặc định dạng mật khẩu không hợp lệ.";
    case "CSRF_VALIDATION_FAILED":
      return "Yêu cầu bảo mật không khớp cấu hình tên miền quản trị (TrustedOrigins / HTTPS).";
    case "PORTAL_AUTH_NOT_CONFIGURED":
    case "AUTH_STATE_UNAVAILABLE":
      return "Dịch vụ xác thực quản trị đang tạm gián đoạn. Vui lòng thử lại sau.";
    default:
      if (status === 401) return "Email hoặc mật khẩu quản trị không chính xác.";
      if (status === 403) return "Tài khoản của bạn không có quyền truy cập hệ thống quản trị.";
      return "Không thể đăng nhập hệ thống quản trị.";
  }
}

export function LoginForm({
  nextPath,
  configurationMissing = false,
  forbidden = false,
}: {
  nextPath?: string;
  configurationMissing?: boolean;
  forbidden?: boolean;
}) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    resolveInitialError(configurationMissing, forbidden),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    try {
      let portalSignedIn = false;
      let allowSupabaseFallback = false;
      const apiBaseUrl = getApiBaseUrl();
      if (apiBaseUrl) {
        try {
          const portalRes = await fetch(`${apiBaseUrl}/api/v1/admin/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            credentials: "include",
            body: JSON.stringify({ identifier: email, password }),
          });
          if (portalRes.ok) {
            const portalData = (await portalRes.json()) as {
              accessToken?: string;
              csrfToken?: string;
              sessionId?: string;
            };
            if (portalData?.accessToken) {
              setStoredPortalAuth({
                accessToken: portalData.accessToken,
                csrfToken: portalData.csrfToken,
                sessionId: portalData.sessionId,
              });
              portalSignedIn = true;
            }
          } else if (portalRes.status === 404 || portalRes.status === 503) {
            allowSupabaseFallback = true;
          } else {
            const problem = (await portalRes.json().catch(() => undefined)) as
              | { code?: string; message?: string; title?: string }
              | undefined;
            setStoredPortalAuth(null);
            throw new Error(
              problem?.message || mapPortalLoginError(problem?.code ?? problem?.title, portalRes.status),
            );
          }
        } catch (err) {
          if (!allowSupabaseFallback && err instanceof Error && err.name !== "TypeError") {
            throw err;
          }
          allowSupabaseFallback = true;
        }
      } else {
        allowSupabaseFallback = true;
      }

      if (isSupabaseConfigured()) {
        const supabase = createBrowserSupabaseClient();
        const { data: signInData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError && !portalSignedIn) throw authError;

        if (!authError && signInData.user && !hasAdminClaim({ app_metadata: signInData.user.app_metadata })) {
          await supabase.auth.signOut();
          setStoredPortalAuth(null);
          throw new Error("Tài khoản của bạn không có quyền truy cập hệ thống quản trị.");
        }
      } else if (!portalSignedIn) {
        throw new Error("Không thể xác thực qua máy chủ quản trị.");
      }

      router.replace(safeNextPath(nextPath));
      router.refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Không thể đăng nhập. Vui lòng kiểm tra lại tài khoản.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">
          Email quản trị
        </span>
        <span className="relative block">
          <UserRound className="absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
          <input
            required
            name="email"
            type="email"
            autoComplete="username"
            className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-teal-500 focus:ring-3 focus:ring-teal-100"
            placeholder="admin@accessmap.vn"
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">
          Mật khẩu
        </span>
        <span className="relative block">
          <LockKeyhole className="absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
          <input
            required
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-teal-500 focus:ring-3 focus:ring-teal-100"
            placeholder="Nhập mật khẩu"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </span>
      </label>

      <div className="flex justify-end">
        <a
          href="mailto:hotro@accessmap.vn?subject=Khôi%20phục%20mật%20khẩu%20quản%20trị"
          className="text-xs font-semibold text-teal-700 transition hover:text-teal-900 hover:underline hover:underline-offset-4"
        >
          Quên mật khẩu?
        </a>
      </div>

      <Button
        type="submit"
        className="h-12 w-full rounded-xl text-sm font-bold shadow-sm"
        disabled={isSubmitting || configurationMissing}
      >
        {isSubmitting ? "Đang xác thực..." : "Đăng nhập"}
        <ArrowRight className="size-4" />
      </Button>

      <div className="flex items-center gap-3 pt-2 text-[11px] text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        Phiên đăng nhập được bảo vệ bởi Supabase Auth
        <span className="h-px flex-1 bg-slate-200" />
      </div>
    </form>
  );
}
