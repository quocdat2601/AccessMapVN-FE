"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Award,
  FileCheck2,
  Flag,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  communityModerationRepository,
  type AdminUserActivity360,
} from "@/entities/community-moderation";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

interface UserActivityDrawerProps {
  userId: string | null;
  onClose: () => void;
}

type ActivityTab = "submissions" | "comments" | "reports" | "scores";

export function UserActivityDrawer({ userId, onClose }: UserActivityDrawerProps) {
  const [data, setData] = useState<AdminUserActivity360 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ActivityTab>("submissions");

  useEffect(() => {
    if (!userId) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    communityModerationRepository
      .getUserActivity360(userId, controller.signal)
      .then((res) => setData(res.data))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Không thể tải nhật ký hoạt động.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId]);

  if (!userId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 backdrop-blur-[1px]">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-teal-50 text-teal-700 border border-teal-100">
              <Activity className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-950">Hồ sơ &amp; Nhật ký Hoạt động 360°</h2>
              <p className="text-xs text-slate-500">Theo dõi đóng góp, bình luận, báo cáo và điểm uy tín tài khoản</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Đóng">
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="py-12 text-center text-sm text-slate-500">Đang tải dữ liệu hoạt động...</div>
          )}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
          {data && (
            <>
              {/* Account Header */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-extrabold text-slate-950">{data.name}</h3>
                      <Badge variant={data.accountStatus === "Active" ? "teal" : "red"}>
                        {data.accountStatus === "Active" ? "Đang hoạt động" : "Đã khóa"}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{data.email}</p>
                    <p className="text-[11px] font-mono text-slate-400 mt-0.5">ID: {data.userId}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
                      <p className="text-[10px] font-semibold uppercase text-slate-500">Uy tín (Standing)</p>
                      <p className={`text-base font-extrabold ${data.accountStandingScore < 20 ? "text-red-600" : data.accountStandingScore < 40 ? "text-amber-600" : "text-teal-700"}`}>
                        {data.accountStandingScore}/100
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
                      <p className="text-[10px] font-semibold uppercase text-slate-500">Danh vọng</p>
                      <p className="text-base font-extrabold text-slate-900">{data.reputationPoints} đ</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
                      <p className="text-[10px] font-semibold uppercase text-slate-500">Độ chính xác</p>
                      <p className="text-base font-extrabold text-slate-900">
                        {data.contributionAccuracyRate != null ? `${data.contributionAccuracyRate}%` : "N/A"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Risk Signals Summary */}
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-white p-2.5 border border-slate-200">
                    <p className="text-[11px] text-slate-500">Report đã gửi</p>
                    <p className="text-sm font-bold text-slate-900">
                      {data.reportsSentTotal} <span className="text-xs font-normal text-emerald-700">({data.reportsSentValid} đúng)</span>
                    </p>
                  </div>
                  <div className="rounded-lg bg-white p-2.5 border border-slate-200">
                    <p className="text-[11px] text-slate-500">Report bị bác (sai)</p>
                    <p className={`text-sm font-bold ${data.reportsSentRejected >= 3 ? "text-red-600" : "text-slate-900"}`}>
                      {data.reportsSentRejected}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white p-2.5 border border-slate-200">
                    <p className="text-[11px] text-slate-500">Bình luận bị report</p>
                    <p className={`text-sm font-bold ${data.receivedCommentReports >= 3 ? "text-amber-600" : "text-slate-900"}`}>
                      {data.receivedCommentReports}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white p-2.5 border border-slate-200">
                    <p className="text-[11px] text-slate-500">Dính từ cấm (***)</p>
                    <p className={`text-sm font-bold ${data.censoredCommentViolations > 0 ? "text-red-600" : "text-slate-900"}`}>
                      {data.censoredCommentViolations}
                    </p>
                  </div>
                </div>
              </div>

              {/* Activity Tabs */}
              <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
                {(
                  [
                    { id: "submissions", label: `Đóng góp (${data.submissions.length})`, icon: FileCheck2 },
                    { id: "comments", label: `Bình luận (${data.comments.length})`, icon: MessageSquare },
                    { id: "reports", label: `Báo cáo (${data.reports.length})`, icon: Flag },
                    { id: "scores", label: `Biến động điểm (${data.scoreHistory.length})`, icon: Award },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setTab(item.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? "bg-teal-600 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      <Icon className="size-3.5" />
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab Content */}
              {tab === "submissions" && (
                <div className="space-y-2.5">
                  {data.submissions.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">Chưa có hồ sơ đóng góp nào.</p>
                  ) : (
                    data.submissions.map((s) => (
                      <div key={s.submissionId} className="rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{s.locationName}</p>
                          <p className="text-xs text-slate-500 font-mono">
                            {s.businessCode} · {new Date(s.createdAt).toLocaleString("vi-VN")}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge variant={s.status === "Published" ? "teal" : s.status === "Rejected" ? "red" : "amber"}>
                            {s.status}
                          </Badge>
                          {s.aiConfidence != null && (
                            <p className="mt-1 text-[11px] text-slate-500">AI: {Math.round(Number(s.aiConfidence) * 100)}%</p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === "comments" && (
                <div className="space-y-2.5">
                  {data.comments.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">Chưa có bình luận nào.</p>
                  ) : (
                    data.comments.map((c) => (
                      <div key={c.commentId} className="rounded-xl border border-slate-200 p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-teal-800">{c.locationName}</span>
                          <div className="flex items-center gap-1.5">
                            {c.reportCount > 0 && (
                              <Badge variant="red">{c.reportCount} report</Badge>
                            )}
                            <Badge variant={c.status === "Approved" ? "teal" : c.status === "Hidden" ? "red" : "amber"}>
                              {c.status}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-sm text-slate-800">{c.body}</p>
                        <p className="text-[11px] text-slate-400">
                          v{c.version} · {new Date(c.createdAt).toLocaleString("vi-VN")}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === "reports" && (
                <div className="space-y-2.5">
                  {data.reports.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">Chưa có lịch sử báo cáo nào.</p>
                  ) : (
                    data.reports.map((r) => (
                      <div key={r.reportId} className="rounded-xl border border-slate-200 p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={r.direction === "Sent" ? "blue" : "amber"}>
                              {r.direction === "Sent" ? "Đã gửi" : "Bị nhận"}
                            </Badge>
                            <span className="text-xs font-bold text-slate-900">{r.locationName}</span>
                          </div>
                          <Badge variant={r.status === "Resolved" ? "teal" : r.status === "Rejected" ? "red" : "neutral"}>
                            {r.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-700">{r.description}</p>
                        <p className="text-[11px] text-slate-400">
                          Đối tượng: {r.targetType} · {new Date(r.createdAt).toLocaleString("vi-VN")}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === "scores" && (
                <div className="space-y-2.5">
                  {data.scoreHistory.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">Chưa có lịch sử biến động điểm.</p>
                  ) : (
                    data.scoreHistory.map((h) => (
                      <div key={h.historyId} className="rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant={h.scoreType === "AccountStanding" ? "amber" : "teal"}>
                              {h.scoreType === "AccountStanding" ? "Uy tín" : "Danh vọng"}
                            </Badge>
                            <span className="text-xs font-medium text-slate-800">{h.reason}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {new Date(h.appliedAt).toLocaleString("vi-VN")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-extrabold ${h.appliedDelta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {h.appliedDelta >= 0 ? `+${h.appliedDelta}` : h.appliedDelta}
                          </p>
                          <p className="text-[11px] text-slate-500">Sau: {h.balanceAfter}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
