"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  FileText,
  Flag,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  UserX,
} from "lucide-react";
import {
  communityModerationRepository,
  type AdminUserActivity360,
} from "@/entities/community-moderation";
import { apiRequest } from "@/shared/api/api-client";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

interface AdminUserDetailResponse {
  userId: string;
  name: string;
  email: string;
  phoneNumber?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  status: string;
  profileVersion: number;
  createdAt: string;
  accountStandingScore: number;
  contributionAccuracyRate?: number | null;
  reputationPoints: number;
}

type DetailTab = "submissions" | "comments" | "reports" | "scores";

export default function UserProfileDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params?.id ?? "";

  const [profile, setProfile] = useState<AdminUserDetailResponse | null>(null);
  const [activity, setActivity] = useState<AdminUserActivity360 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("submissions");
  const [actionBusy, setActionBusy] = useState(false);
  const [statusReason, setStatusReason] = useState("");
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [userRes, actRes] = await Promise.all([
        apiRequest<AdminUserDetailResponse>(`/api/v1/admin/users/${encodeURIComponent(userId)}`),
        communityModerationRepository.getUserActivity360(userId),
      ]);
      setProfile(userRes.data);
      setActivity(actRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải hồ sơ người dùng.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function toggleStatus() {
    if (!profile) return;
    const reason = statusReason.trim() || "Cập nhật trạng thái tài khoản từ trang hồ sơ chi tiết.";
    if (reason.length < 10) {
      setError("Lý do thay đổi trạng thái cần tối thiểu 10 ký tự.");
      return;
    }
    setActionBusy(true);
    setError(null);
    setActionMsg(null);
    try {
      const nextStatus = profile.status === "Active" ? "Disabled" : "Active";
      await apiRequest(`/api/v1/admin/users/${encodeURIComponent(profile.userId)}/status`, {
        method: "PATCH",
        body: {
          status: nextStatus,
          reason,
          expectedProfileVersion: profile.profileVersion,
        },
      });
      setStatusReason("");
      setActionMsg(`Đã chuyển trạng thái tài khoản sang ${nextStatus}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể cập nhật trạng thái tài khoản.");
    } finally {
      setActionBusy(false);
    }
  }

  const sentReports = (activity?.reports ?? []).filter((r) => r.direction === "Sent");
  const receivedReports = (activity?.reports ?? []).filter((r) => r.direction !== "Sent");

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/nguoi-dung-uy-tin"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:underline"
        >
          <ArrowLeft className="size-4" /> Quay lại danh sách Người dùng &amp; Uy tín
        </Link>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCw className="size-4" /> Làm mới
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}
      {actionMsg && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">{actionMsg}</div>
      )}

      {loading && !profile ? (
        <Card className="p-8 text-center text-sm text-slate-500">Đang tải hồ sơ chi tiết người dùng...</Card>
      ) : profile ? (
        <>
          <Card className="p-5 border-slate-200">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-teal-700 text-lg font-extrabold text-white">
                  {profile.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-extrabold text-slate-950">{profile.name}</h1>
                    <Badge variant={profile.status === "Active" ? "teal" : "red"}>{profile.status}</Badge>
                    <Badge variant="neutral">v{profile.profileVersion}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="size-3.5 text-slate-400" /> {profile.email}
                      {profile.emailVerified && <CheckCircle2 className="size-3.5 text-teal-600" />}
                    </span>
                    {profile.phoneNumber && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="size-3.5 text-slate-400" /> {profile.phoneNumber}
                        {profile.phoneVerified && <CheckCircle2 className="size-3.5 text-teal-600" />}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-slate-400">
                    ID: {profile.userId} · Tham gia: {new Date(profile.createdAt).toLocaleString("vi-VN")}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder="Lý do khóa / mở tài khoản..."
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs sm:w-56"
                />
                <Button
                  size="sm"
                  variant={profile.status === "Active" ? "danger" : "default"}
                  onClick={() => void toggleStatus()}
                  disabled={actionBusy}
                >
                  {profile.status === "Active" ? (
                    <>
                      <UserX className="size-4" /> Tạm khóa
                    </>
                  ) : (
                    <>
                      <UserCheck className="size-4" /> Mở khóa
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs font-semibold text-slate-500">Điểm chấp hành</p>
                <p className="mt-1 text-xl font-extrabold text-slate-950">{profile.accountStandingScore}/100</p>
              </div>
              <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3">
                <p className="text-xs font-semibold text-teal-800">Điểm uy tín đóng góp</p>
                <p className="mt-1 text-xl font-extrabold text-teal-900">{profile.reputationPoints}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs font-semibold text-slate-500">Độ chính xác đóng góp</p>
                <p className="mt-1 text-xl font-extrabold text-slate-950">
                  {typeof profile.contributionAccuracyRate === "number"
                    ? `${Math.round(profile.contributionAccuracyRate * 100)}%`
                    : "Chưa có"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs font-semibold text-slate-500">Tổng bài đóng góp / Bình luận</p>
                <p className="mt-1 text-xl font-extrabold text-slate-950">
                  {activity?.submissions.length ?? 0} / {activity?.comments.length ?? 0}
                </p>
              </div>
            </div>
          </Card>

          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: "submissions", label: `Hồ sơ đã đăng (${activity?.submissions.length ?? 0})`, icon: FileText },
                { id: "comments", label: `Bình luận (${activity?.comments.length ?? 0})`, icon: MessageSquare },
                {
                  id: "reports",
                  label: `Báo cáo gửi/nhận (${(activity?.reports ?? []).length})`,
                  icon: Flag,
                },
                { id: "scores", label: `Lịch sử điểm (${activity?.scoreHistory.length ?? 0})`, icon: Award },
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                    tab === t.id
                      ? "bg-teal-700 text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="size-3.5" /> {t.label}
                </button>
              );
            })}
          </div>

          <Card className="p-4 border-slate-200">
            {tab === "submissions" && (
              <div className="space-y-2.5">
                {!activity?.submissions.length ? (
                  <p className="text-sm text-slate-500">Người dùng chưa đăng hồ sơ đóng góp nào.</p>
                ) : (
                  activity.submissions.map((sub) => (
                    <div
                      key={sub.submissionId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                    >
                      <div>
                        <p className="font-semibold text-slate-900">
                          {sub.locationName || sub.businessCode || sub.submissionId}
                        </p>
                        <p className="text-xs text-slate-500">
                          {sub.businessCode} · {new Date(sub.createdAt).toLocaleString("vi-VN")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="neutral">{sub.status}</Badge>
                        <Link
                          href={`/admin/ho-so-dong-gop/${encodeURIComponent(sub.submissionId)}`}
                          className="text-xs font-semibold text-teal-700 hover:underline"
                        >
                          Xem hồ sơ →
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === "comments" && (
              <div className="space-y-2.5">
                {!activity?.comments.length ? (
                  <p className="text-sm text-slate-500">Người dùng chưa có bình luận nào.</p>
                ) : (
                  activity.comments.map((c) => (
                    <div key={c.commentId} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-700">
                          {c.locationName || "Địa điểm"}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {c.reportCount > 0 && <Badge variant="red">{c.reportCount} báo cáo</Badge>}
                          <Badge variant={c.status === "Hidden" ? "red" : "teal"}>{c.status}</Badge>
                        </div>
                      </div>
                      <p className="mt-1 text-sm text-slate-900">{c.body}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {new Date(c.createdAt).toLocaleString("vi-VN")}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === "reports" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <Flag className="size-3.5 text-amber-600" /> Báo cáo đã gửi ({sentReports.length})
                  </h3>
                  {!sentReports.length ? (
                    <p className="text-xs text-slate-400">Chưa gửi báo cáo nào.</p>
                  ) : (
                    sentReports.map((r) => (
                      <div key={r.reportId} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-800">{r.reason}</span>
                          <Badge variant="neutral">{r.status}</Badge>
                        </div>
                        <p className="mt-1 text-slate-600">{r.description}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <ShieldAlert className="size-3.5 text-red-600" /> Bị người khác báo cáo ({receivedReports.length})
                  </h3>
                  {!receivedReports.length ? (
                    <p className="text-xs text-slate-400">Chưa bị báo cáo lần nào.</p>
                  ) : (
                    receivedReports.map((r) => (
                      <div key={r.reportId} className="rounded-lg border border-red-200 bg-red-50/40 p-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-red-900">{r.reason}</span>
                          <Badge variant="red">{r.status}</Badge>
                        </div>
                        <p className="mt-1 text-slate-700">{r.description}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {tab === "scores" && (
              <div className="space-y-2">
                {!activity?.scoreHistory.length ? (
                  <p className="text-sm text-slate-500">Chưa có biến động điểm uy tín nào.</p>
                ) : (
                  activity.scoreHistory.map((s) => (
                    <div
                      key={s.historyId}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-slate-800">{s.reason}</span>
                        <span className="ml-2 text-slate-400">({s.scoreType})</span>
                        <p className="text-[11px] text-slate-400">
                          {new Date(s.appliedAt).toLocaleString("vi-VN")}
                        </p>
                      </div>
                      <Badge variant={s.appliedDelta >= 0 ? "teal" : "red"}>
                        {s.appliedDelta >= 0 ? `+${s.appliedDelta}` : s.appliedDelta} ({s.balanceAfter})
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
