"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CornerDownRight,
  EyeOff,
  Flag,
  MapPin,
  MessageSquareWarning,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  communityModerationRepository,
  formatEtagFromVersion,
  type AdminReportedCommentItem,
} from "@/entities/community-moderation";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { UserActivityDrawer } from "@/widgets/user-activity-drawer/ui/user-activity-drawer";

const CATEGORY_LABELS: Record<string, string> = {
  SpamAdvertising: "Quảng cáo / Spam / Web lạ",
  HarassmentHate: "Ngôn từ thô tục / Xúc phạm",
  PrivacyThreat: "Xâm phạm quyền riêng tư",
  CoordinatedManipulation: "Sai sự thật / Thao túng",
  Other: "Lý do khác",
};

type FilterTab = "Open" | "Hidden" | "All";

export function CommentModerationPage() {
  const [tab, setTab] = useState<FilterTab>("Open");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<AdminReportedCommentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adminReason, setAdminReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activityUserId, setActivityUserId] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await communityModerationRepository.getReportedComments({
        status: tab,
        search: search.trim() || undefined,
        page: 1,
        pageSize: 50,
      });
      setItems(res.items);
      setTotal(res.total);
      if (res.items.length > 0 && !res.items.some((x) => x.commentId === selectedId)) {
        setSelectedId(res.items[0].commentId);
      } else if (res.items.length === 0) {
        setSelectedId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách báo cáo bình luận.");
    } finally {
      setLoading(false);
    }
  }, [tab, search, selectedId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  async function handleDecision(item: AdminReportedCommentItem, decision: "Approve" | "Hide") {
    setBusyId(item.commentId);
    setError(null);
    try {
      const trimmed = adminReason.trim();
      await communityModerationRepository.moderateComment(
        item.locationId,
        item.commentId,
        {
          decision,
          reason:
            trimmed.length >= 10
              ? trimmed
              : decision === "Hide"
                ? "Xác nhận bình luận vi phạm tiêu chuẩn cộng đồng qua báo cáo."
                : "Bác bỏ báo cáo, giữ hiển thị bình luận hợp lệ.",
          expectedVersion: item.commentVersion,
        },
        formatEtagFromVersion(item.commentVersion)!,
      );
      setAdminReason("");
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể cập nhật quyết định kiểm duyệt.");
    } finally {
      setBusyId(null);
    }
  }

  const selectedItem = items.find((x) => x.commentId === selectedId) ?? items[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-teal-700">Quản trị nội dung · Báo cáo bình luận</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold text-slate-950">
            <MessageSquareWarning className="size-6 text-teal-700" /> Báo cáo bình luận cộng đồng
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Chỉ hiển thị các bình luận bị người dùng báo cáo hoặc dính từ cấm (***), kèm địa điểm, ngữ cảnh và nguyên nhân báo cáo.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadReports()} disabled={loading}>
          <RefreshCw className="size-4" /> Làm mới
        </Button>
      </header>

      {/* Toolbar: Filter Tabs + Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "Open", label: "Đang chờ xử lý" },
              { id: "Hidden", label: "Đã ẩn do vi phạm" },
              { id: "All", label: "Tất cả báo cáo" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                tab === t.id
                  ? "bg-teal-700 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo địa điểm, tác giả, nội dung..."
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {/* Split Master-Detail Layout (Compact, Zero Vertical Clutter) */}
      {loading && items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">Đang tải danh sách báo cáo bình luận...</Card>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          Hiện không có báo cáo bình luận nào trong mục này.
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          {/* Left Column: Compact Queue List */}
          <Card className="overflow-hidden border-slate-200 lg:col-span-5">
            <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-xs font-bold text-slate-600">
              Danh sách báo cáo ({total})
            </div>
            <div className="max-h-[600px] divide-y divide-slate-100 overflow-y-auto">
              {items.map((item) => {
                const active = selectedItem?.commentId === item.commentId;
                return (
                  <button
                    key={item.commentId}
                    type="button"
                    onClick={() => setSelectedId(item.commentId)}
                    className={`w-full px-4 py-3 text-left transition ${
                      active ? "bg-teal-50/70" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-bold text-slate-800">{item.locationName}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        {item.reportCount > 0 && (
                          <Badge variant="red">
                            <Flag className="mr-1 size-3" /> {item.reportCount}
                          </Badge>
                        )}
                        {item.uncensoredBody && <Badge variant="amber">***</Badge>}
                      </div>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-900">{item.commentBody}</p>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Tác giả: {item.authorName}</span>
                      <Badge variant={item.commentStatus === "Hidden" ? "red" : "teal"}>
                        {item.commentStatus === "Hidden" ? "Đã ẩn" : "Đang hiện"}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Right Column: Full Context + Reports + Decision */}
          <Card className="border-slate-200 p-5 lg:col-span-7">
            {selectedItem ? (
              <div className="space-y-4">
                {/* 1. Bài viết / Địa điểm là gì */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-teal-800">
                    <MapPin className="size-3.5" /> Địa điểm / Bài viết gốc
                  </p>
                  <p className="mt-1 text-sm font-extrabold text-slate-950">{selectedItem.locationName}</p>
                  {selectedItem.locationAddress && (
                    <p className="text-xs text-slate-500">{selectedItem.locationAddress}</p>
                  )}
                  {selectedItem.parentCommentBody && (
                    <div className="mt-2.5 rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                      <p className="flex items-center gap-1 font-semibold text-slate-600">
                        <CornerDownRight className="size-3.5 text-teal-700" /> Phản hồi cho bình luận của{" "}
                        <span className="text-slate-900">{selectedItem.parentAuthorName || "Thành viên"}</span>:
                      </p>
                      <p className="mt-1 italic text-slate-700">&ldquo;{selectedItem.parentCommentBody}&rdquo;</p>
                    </div>
                  )}
                </div>

                {/* 2. Bình luận bị báo cáo là gì */}
                <div className="rounded-xl border border-amber-200/80 bg-amber-50/30 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs">
                      <span className="font-bold uppercase tracking-wide text-slate-500">Bình luận bị báo cáo · </span>
                      <Link
                        href={`/admin/nguoi-dung-uy-tin/${encodeURIComponent(selectedItem.authorId)}`}
                        className="font-bold text-teal-700 hover:underline"
                      >
                        {selectedItem.authorName}
                      </Link>
                      <span className="ml-1.5 text-slate-400">({selectedItem.authorEmail})</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActivityUserId(selectedItem.authorId)}
                    >
                      <Activity className="size-3.5" /> Nhật ký 360°
                    </Button>
                  </div>

                  <p className="mt-2 rounded-lg bg-white p-3 text-sm font-medium text-slate-900 border border-slate-200">
                    {selectedItem.commentBody}
                  </p>

                  {selectedItem.uncensoredBody && (
                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50/60 p-2.5 text-xs text-red-900">
                      <p className="flex items-center gap-1 font-bold">
                        <AlertTriangle className="size-3.5" /> Nội dung gốc trước khi che từ cấm (***):
                      </p>
                      <p className="mt-1 font-medium">{selectedItem.uncensoredBody}</p>
                      {selectedItem.matchedBannedTerms.length > 0 && (
                        <p className="mt-1 text-[11px] text-red-700">
                          Từ cấm khớp: {selectedItem.matchedBannedTerms.join(", ")}
                        </p>
                      )}
                    </div>
                  )}

                  <p className="mt-2 text-[11px] text-slate-400">
                    Đăng lúc: {new Date(selectedItem.createdAt).toLocaleString("vi-VN")} · Phiên bản v{selectedItem.commentVersion}
                  </p>
                </div>

                {/* 3. Nguyên nhân báo cáo là gì */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">
                    Chi tiết báo cáo từ cộng đồng ({selectedItem.reports.length})
                  </h3>
                  {selectedItem.reports.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 p-3 text-xs text-slate-500">
                      Hệ thống tự động gắn cờ do phát hiện từ cấm / liên kết lạ khi đăng.
                    </p>
                  ) : (
                    <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                      {selectedItem.reports.map((rep) => (
                        <div key={rep.reportId} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="red">
                                {CATEGORY_LABELS[rep.violationCategory] ?? rep.violationCategory}
                              </Badge>
                              <Link
                                href={`/admin/nguoi-dung-uy-tin/${encodeURIComponent(rep.reporterId)}`}
                                className="font-semibold text-slate-700 hover:underline"
                              >
                                Người báo cáo: {rep.reporterName}
                              </Link>
                            </div>
                            <span className="text-[11px] text-slate-400">
                              {new Date(rep.createdAt).toLocaleString("vi-VN")}
                            </span>
                          </div>
                          <p className="mt-1.5 text-slate-800">{rep.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 4. Quyết định kiểm duyệt */}
                <div className="border-t border-slate-200 pt-3 space-y-2.5">
                  <input
                    value={adminReason}
                    onChange={(e) => setAdminReason(e.target.value)}
                    placeholder="Ghi chú quyết định kiểm duyệt (không bắt buộc, tối thiểu 10 ký tự nếu nhập)..."
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs"
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === selectedItem.commentId}
                      onClick={() => void handleDecision(selectedItem, "Approve")}
                    >
                      <CheckCircle2 className="size-4 text-teal-700" /> Giữ hiển thị (Bác bỏ báo cáo)
                    </Button>
                    {selectedItem.commentStatus !== "Hidden" && (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busyId === selectedItem.commentId}
                        onClick={() => void handleDecision(selectedItem, "Hide")}
                      >
                        <EyeOff className="size-4" /> Xác nhận vi phạm &amp; Ẩn bình luận
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      )}

      <UserActivityDrawer userId={activityUserId} onClose={() => setActivityUserId(null)} />
    </div>
  );
}
