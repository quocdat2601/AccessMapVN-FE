"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  EyeOff,
  RefreshCw,
  Search,
  ShieldAlert,
  UserX,
} from "lucide-react";
import {
  communityModerationRepository,
  type AdminUserModerationCase,
} from "@/entities/community-moderation";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { UserActivityDrawer } from "@/widgets/user-activity-drawer/ui/user-activity-drawer";

const CASE_TYPE_LABELS: Record<string, { label: string; variant: "red" | "amber" | "blue" | "teal" | "neutral" }> = {
  CensoredProfanityComment: { label: "Cố tình đăng từ cấm (***)", variant: "amber" },
  RepeatedlyReportedUser: { label: "Bị nhiều người báo cáo", variant: "red" },
  ReporterSpamAbuse: { label: "Spam / Báo cáo sai nhiều lần", variant: "red" },
  CommentReported: { label: "Bình luận bị báo cáo", variant: "blue" },
};

export default function UserModerationCasesPage() {
  const [statusFilter, setStatusFilter] = useState<string>("Open");
  const [caseTypeFilter, setCaseTypeFilter] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<AdminUserModerationCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activityUserId, setActivityUserId] = useState<string | null>(null);
  const [resolvingCase, setResolvingCase] = useState<AdminUserModerationCase | null>(null);
  const [actionType, setActionType] = useState<"Dismiss" | "WarnOnly" | "PenalizeStanding" | "SuspendAccount">("PenalizeStanding");
  const [penalty, setPenalty] = useState<number>(4);
  const [hideComment, setHideComment] = useState<boolean>(true);
  const [resolveReason, setResolveReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await communityModerationRepository.getUserModerationCases({
        status: statusFilter,
        caseType: caseTypeFilter,
        search: search.trim() || undefined,
        page: 1,
        pageSize: 50,
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách báo cáo người dùng.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, caseTypeFilter, search]);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  const handleResolve = async () => {
    if (!resolvingCase) return;
    if (resolveReason.trim().length < 5) {
      setError("Vui lòng nhập lý do xử lý tối thiểu 5 ký tự.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await communityModerationRepository.resolveUserModerationCase(resolvingCase.id, {
        action: actionType,
        reason: resolveReason.trim(),
        standingPenalty: actionType === "PenalizeStanding" ? penalty : undefined,
        hideComment: resolvingCase.commentId ? hideComment : false,
      });
      setResolvingCase(null);
      setResolveReason("");
      await loadCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể xử lý hồ sơ vi phạm.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCount = items.filter((i) => i.status === "Open").length;
  const profanityCount = items.filter((i) => i.caseType === "CensoredProfanityComment").length;
  const spamAbuseCount = items.filter((i) => i.caseType === "ReporterSpamAbuse").length;

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-teal-700">Kiểm duyệt cộng đồng · Xử lý tài khoản</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold text-slate-950">
            <ShieldAlert className="size-6 text-teal-700" /> Báo cáo &amp; Vi phạm Người dùng
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Theo dõi tài khoản cố tình vượt bộ lọc từ cấm (***), bị cộng đồng báo cáo nhiều lần hoặc spam báo cáo sai sự thật.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadCases()}>
          <RefreshCw className="size-4" /> Làm mới
        </Button>
      </header>

      {/* KPI Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4 border-slate-200">
          <p className="text-xs font-semibold text-slate-500">Hồ sơ đang hiển thị</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-950">{items.length}</p>
          <p className="text-xs text-amber-700 mt-0.5">{openCount} hồ sơ chưa xử lý</p>
        </Card>
        <Card className="p-4 border-amber-200 bg-amber-50/40">
          <p className="text-xs font-semibold text-amber-800">Cố tình đăng từ cấm (***)</p>
          <p className="mt-1 text-2xl font-extrabold text-amber-900">{profanityCount}</p>
          <p className="text-xs text-amber-700 mt-0.5">Kèm bản chụp nội dung gốc</p>
        </Card>
        <Card className="p-4 border-red-200 bg-red-50/40">
          <p className="text-xs font-semibold text-red-800">Nghi vấn Spam Báo cáo sai</p>
          <p className="mt-1 text-2xl font-extrabold text-red-900">{spamAbuseCount}</p>
          <p className="text-xs text-red-700 mt-0.5">Gửi dồn dập hoặc bị bác nhiều lần</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <input
              className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm"
              placeholder="Tìm tên, email hoặc nội dung vi phạm..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="Open">Chờ xử lý</option>
            <option value="ActionTaken">Đã xử phạt</option>
            <option value="Dismissed">Đã bỏ qua</option>
            <option value="All">Tất cả trạng thái</option>
          </select>
          <select
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={caseTypeFilter}
            onChange={(e) => setCaseTypeFilter(e.target.value)}
          >
            <option value="All">Mọi loại vi phạm</option>
            <option value="CensoredProfanityComment">Từ cấm / Link lạ (***)</option>
            <option value="RepeatedlyReportedUser">Bị report nhiều lần</option>
            <option value="ReporterSpamAbuse">Spam báo cáo sai</option>
            <option value="CommentReported">Bình luận bị báo cáo</option>
          </select>
        </div>
      </Card>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Case List */}
      <div className="space-y-3">
        {loading ? (
          <Card className="p-8 text-center text-sm text-slate-500">Đang tải dữ liệu...</Card>
        ) : items.length === 0 ? (
          <Card className="p-8 text-center text-sm text-slate-500">
            Không có hồ sơ báo cáo người dùng nào khớp bộ lọc hiện tại.
          </Card>
        ) : (
          items.map((item) => {
            const typeMeta = CASE_TYPE_LABELS[item.caseType] ?? {
              label: item.caseType,
              variant: "neutral" as const,
            };
            return (
              <Card key={item.id} className="p-4 space-y-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={typeMeta.variant}>{typeMeta.label}</Badge>
                      <Badge variant={item.severity === "High" || item.severity === "Critical" ? "red" : "neutral"}>
                        Mức độ: {item.severity}
                      </Badge>
                      {item.reportCount > 1 && (
                        <Badge variant="red">{item.reportCount} lượt báo cáo</Badge>
                      )}
                      {item.status !== "Open" && (
                        <Badge variant={item.status === "ActionTaken" ? "teal" : "neutral"}>
                          {item.status === "ActionTaken" ? `Đã xử lý (-${item.standingPenaltyApplied}đ)` : "Đã bỏ qua"}
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-base font-extrabold text-slate-950">{item.subjectName}</span>
                      <span className="text-xs text-slate-500">({item.subjectEmail})</span>
                      <Badge variant={item.subjectAccountStatus === "Active" ? "teal" : "red"}>
                        {item.subjectAccountStatus === "Active" ? "Active" : "Disabled"}
                      </Badge>
                      <span className="text-xs font-semibold text-slate-600">
                        Uy tín: <strong>{item.subjectStandingScore}/100</strong> · Danh vọng: <strong>{item.subjectReputationPoints}</strong>
                      </span>
                    </div>

                    {item.locationName && (
                      <p className="text-xs text-slate-500">
                        Địa điểm liên quan: <strong className="text-slate-700">{item.locationName}</strong>
                      </p>
                    )}

                    {/* Reasons */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {item.violationReasons.map((reason, idx) => (
                        <span key={idx} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          Nguyên nhân: {reason}
                        </span>
                      ))}
                    </div>

                    {/* Matched banned terms & Original vs Censored Snapshot */}
                    {item.matchedBannedTerms.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-xs font-semibold text-red-700">Từ khóa dính:</span>
                        {item.matchedBannedTerms.map((term, idx) => (
                          <span key={idx} className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
                            {term}
                          </span>
                        ))}
                      </div>
                    )}

                    {item.uncensoredSnapshot && (
                      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs space-y-1">
                        <p className="font-bold text-amber-900">Nội dung gốc trước khi che (***):</p>
                        <p className="text-slate-800">{item.uncensoredSnapshot}</p>
                        {item.censoredSnapshot && (
                          <p className="text-slate-500 pt-1 border-t border-amber-200/70">
                            Hiển thị công khai: {item.censoredSnapshot}
                          </p>
                        )}
                      </div>
                    )}

                    {item.adminNote && (
                      <p className="text-xs text-teal-800 bg-teal-50 rounded-lg px-2.5 py-1.5">
                        Ghi chú xử lý: {item.adminNote}
                      </p>
                    )}

                    <p className="text-[11px] text-slate-400">
                      Ghi nhận lúc: {new Date(item.createdAt).toLocaleString("vi-VN")}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActivityUserId(item.subjectUserId)}
                    >
                      <Activity className="size-4" /> Nhật ký 360°
                    </Button>
                    {item.status === "Open" && (
                      <Button
                        size="sm"
                        className="bg-teal-600 hover:bg-teal-700 text-white"
                        onClick={() => {
                          setResolvingCase(item);
                          setActionType("PenalizeStanding");
                          setPenalty(item.caseType === "ReporterSpamAbuse" ? 4 : 6);
                          setHideComment(Boolean(item.commentId));
                          setResolveReason("");
                        }}
                      >
                        Xử lý vi phạm
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Resolve Case Modal */}
      {resolvingCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <Card className="w-full max-w-lg p-5 space-y-4">
            <div>
              <h3 className="text-lg font-extrabold text-slate-950">Xử lý hồ sơ vi phạm</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Tài khoản: <strong>{resolvingCase.subjectName}</strong> (Uy tín hiện tại: {resolvingCase.subjectStandingScore}/100)
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">Hình thức xử lý</label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: "PenalizeStanding", label: "Trừ điểm Uy tín", icon: AlertTriangle },
                    { id: "WarnOnly", label: "Chỉ cảnh cáo", icon: CheckCircle2 },
                    { id: "SuspendAccount", label: "Khóa tài khoản", icon: UserX },
                    { id: "Dismiss", label: "Bỏ qua / Không vi phạm", icon: Ban },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const active = actionType === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setActionType(opt.id)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                        active
                          ? "border-teal-600 bg-teal-50 text-teal-800"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <Icon className="size-4" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {actionType === "PenalizeStanding" && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Mức trừ điểm Uy tín (Standing)
                </label>
                <div className="flex gap-2">
                  {[2, 4, 6, 10].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setPenalty(val)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                        penalty === val
                          ? "border-red-600 bg-red-50 text-red-700"
                          : "border-slate-200 text-slate-700"
                      }`}
                    >
                      -{val} điểm
                    </button>
                  ))}
                </div>
              </div>
            )}

            {resolvingCase.commentId && actionType !== "Dismiss" && (
              <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideComment}
                  onChange={(e) => setHideComment(e.target.checked)}
                />
                <EyeOff className="size-3.5 text-slate-500" />
                Ẩn bình luận liên quan khỏi ứng dụng công khai
              </label>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Lý do quyết định (tối thiểu 5 ký tự)
              </label>
              <textarea
                rows={3}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm"
                placeholder="Ghi rõ căn cứ xử phạt hoặc lý do bỏ qua..."
                value={resolveReason}
                onChange={(e) => setResolveReason(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setResolvingCase(null)} disabled={isSubmitting}>
                Hủy
              </Button>
              <Button
                className="bg-teal-600 hover:bg-teal-700 text-white"
                onClick={() => void handleResolve()}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Đang lưu..." : "Xác nhận xử lý"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <UserActivityDrawer userId={activityUserId} onClose={() => setActivityUserId(null)} />
    </div>
  );
}
