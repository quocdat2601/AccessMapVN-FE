"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Gavel,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  communityModerationRepository,
  disputeStatusLabels,
  featureLabels,
  formatAdminDate,
  publishedStatusLabels,
  reportReasonLabels,
  reportStatusLabels,
  type AdminQueueQuery,
  type DisputeQueueItem,
  type ReportQueueItem,
} from "@/entities/community-moderation";
import { useModerationQueue } from "@/features/community-moderation/model/use-moderation-queue";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { Skeleton } from "@/shared/ui/skeleton";

type QueueKind = "disputes" | "reports";

const disputeStatuses = [
  "All",
  "Open",
  "UnderReview",
  "AwaitingMoreInfo",
  "CorrectionPending",
  "ResolvedBaseline",
  "ResolvedUpdated",
] as const;

const reportStatuses = [
  "All",
  "Submitted",
  "UnderReview",
  "AwaitingMoreInfo",
  "LinkedToDispute",
  "Resolved",
  "Rejected",
] as const;

function statusVariant(status: string): "neutral" | "teal" | "amber" | "red" | "blue" {
  if (status.startsWith("Resolved")) return "teal";
  if (status === "Rejected") return "red";
  if (status === "AwaitingMoreInfo" || status === "CorrectionPending") return "amber";
  if (status === "Open" || status === "Submitted") return "red";
  return "blue";
}

export function ModerationQueuePage({ kind }: { kind: QueueKind }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [page, setPage] = useState(1);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideFeatureId, setOverrideFeatureId] = useState("");
  const [overrideVersion, setOverrideVersion] = useState("1");
  const [overrideReason, setOverrideReason] = useState("");
  const [isCreatingOverride, setIsCreatingOverride] = useState(false);
  const [overrideFeedback, setOverrideFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const query = useMemo<AdminQueueQuery>(
    () => ({ search, status, page, pageSize: 20 }),
    [page, search, status],
  );
  const queue = useModerationQueue(kind, query);
  const isDispute = kind === "disputes";
  const Icon = isDispute ? Gavel : FileWarning;
  const title = isDispute ? "Tranh chấp tiếp cận" : "Báo cáo thông tin sai lệch";
  const description = isDispute
    ? "Đối chiếu các báo cáo & quan sát mâu thuẫn với dữ liệu đã công bố kèm kiểm định AI."
    : "Xử lý báo cáo chi tiết mà không biến báo cáo thành phiếu đồng thuận.";
  const statuses = isDispute ? disputeStatuses : reportStatuses;

  async function handleOverrideSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedFeatureId = overrideFeatureId.trim();
    const parsedVersion = Number(overrideVersion);
    const trimmedReason = overrideReason.trim();
    if (!trimmedFeatureId || !Number.isInteger(parsedVersion) || parsedVersion < 1 || !trimmedReason) {
      setOverrideFeedback({
        tone: "error",
        message: "Vui lòng nhập đúng LocationFeatureId (UUID), phiên bản (>= 1) và lý do ghi đè.",
      });
      return;
    }

    setIsCreatingOverride(true);
    setOverrideFeedback(null);
    try {
      await communityModerationRepository.createDisputeOverride({
        locationFeatureId: trimmedFeatureId,
        observedFeatureVersion: parsedVersion,
        reason: trimmedReason,
      });
      setOverrideFeedback({
        tone: "success",
        message: "Đã mở hồ sơ ghi đè trực tiếp (Moderator Override) thành công.",
      });
      setOverrideFeatureId("");
      setOverrideVersion("1");
      setOverrideReason("");
      setOverrideOpen(false);
      queue.reload();
    } catch (cause) {
      setOverrideFeedback({
        tone: "error",
        message: cause instanceof Error ? cause.message : "Không thể tạo ghi đè trực tiếp.",
      });
    } finally {
      setIsCreatingOverride(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 sm:p-6">
      <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold text-teal-700">Kiểm duyệt & Xác thực cộng đồng</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold text-slate-950">
            <Icon className="size-6 text-teal-700" />
            {title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDispute && (
            <Button
              variant={overrideOpen ? "secondary" : "default"}
              onClick={() => {
                setOverrideFeedback(null);
                setOverrideOpen((prev) => !prev);
              }}
            >
              <Plus className="size-4" /> Tạo ghi đè trực tiếp (Override)
            </Button>
          )}
          <Button variant="outline" onClick={queue.reload}>
            <RefreshCw className="size-4" /> Làm mới
          </Button>
        </div>
      </header>

      {overrideFeedback && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium ${
            overrideFeedback.tone === "success"
              ? "border-teal-200 bg-teal-50 text-teal-900"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{overrideFeedback.message}</span>
        </div>
      )}

      {isDispute && overrideOpen && (
        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-bold text-slate-950">Tạo tranh chấp / Ghi đè trực tiếp từ kiểm duyệt viên</h2>
          <p className="mt-1 text-xs text-slate-500">
            Mở hồ sơ tranh chấp chủ động cho một tiện ích đã công bố thông qua <code className="font-mono">POST /api/v1/admin/community-disputes</code>.
          </p>
          <form onSubmit={(event) => void handleOverrideSubmit(event)} className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label htmlFor="override-feature-id" className="block text-xs font-semibold text-slate-700">
                LocationFeatureId (UUID) <span className="text-red-600">*</span>
              </label>
              <input
                id="override-feature-id"
                value={overrideFeatureId}
                onChange={(event) => setOverrideFeatureId(event.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                required
              />
            </div>
            <div>
              <label htmlFor="override-feature-version" className="block text-xs font-semibold text-slate-700">
                Phiên bản quan sát (ObservedFeatureVersion) <span className="text-red-600">*</span>
              </label>
              <input
                id="override-feature-version"
                type="number"
                min={1}
                value={overrideVersion}
                onChange={(event) => setOverrideVersion(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                required
              />
            </div>
            <div>
              <label htmlFor="override-reason" className="block text-xs font-semibold text-slate-700">
                Lý do mở tranh chấp / ghi đè <span className="text-red-600">*</span>
              </label>
              <input
                id="override-reason"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Nêu rõ sai lệch hoặc yêu cầu tái thẩm định..."
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                required
              />
            </div>
            <div className="flex justify-end gap-2 md:col-span-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setOverrideOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" size="sm" disabled={isCreatingOverride}>
                {isCreatingOverride ? "Đang gửi..." : "Xác nhận tạo Override"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="grid gap-3 border-b border-slate-200 bg-slate-50/60 p-4 md:grid-cols-[1fr_230px]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              placeholder="Tìm mã hoặc địa điểm..."
            />
          </label>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
            aria-label="Lọc trạng thái"
          >
            {statuses.map((value) => (
              <option key={value} value={value}>
                {value === "All"
                  ? "Tất cả trạng thái"
                  : isDispute
                    ? disputeStatusLabels[value as keyof typeof disputeStatusLabels]
                    : reportStatusLabels[value as keyof typeof reportStatusLabels]}
              </option>
            ))}
          </select>
        </div>

        {queue.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
        ) : queue.error ? (
          <div className="p-6">
            <EmptyState title="Không tải được hàng đợi" description={queue.error} />
          </div>
        ) : queue.data?.items.length ? (
          <div className="overflow-x-auto">
            {isDispute ? (
              <DisputeTable items={queue.data.items as DisputeQueueItem[]} />
            ) : (
              <ReportTable items={queue.data.items as ReportQueueItem[]} />
            )}
          </div>
        ) : (
          <div className="p-8">
            <EmptyState title="Không có mục phù hợp" description="Hãy thay đổi bộ lọc hoặc làm mới hàng đợi." />
          </div>
        )}

        {queue.data && queue.data.totalPages > 1 && (
          <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span>
              Trang {queue.data.page}/{queue.data.totalPages} · {queue.data.total} mục
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                <ChevronLeft className="size-4" /> Trước
              </Button>
              <Button variant="outline" size="sm" disabled={page >= queue.data.totalPages} onClick={() => setPage((value) => value + 1)}>
                Tiếp <ChevronRight className="size-4" />
              </Button>
            </div>
          </footer>
        )}
      </Card>

      <div className="flex gap-2 rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        Phiếu xác nhận và báo cáo không tự sửa dữ liệu đã công bố, độ tin cậy AI hoặc điểm uy tín / danh vọng.
      </div>
    </div>
  );
}

function DisputeTable({ items }: { items: DisputeQueueItem[] }) {
  return (
    <table className="w-full min-w-[960px] text-left text-sm">
      <thead className="bg-white text-[11px] uppercase tracking-wide text-slate-400">
        <tr>
          <th className="px-4 py-3">Hồ sơ & Lý do mâu thuẫn</th>
          <th className="px-4 py-3">Địa điểm</th>
          <th className="px-4 py-3">Hạng mục & Trạng thái gốc</th>
          <th className="px-4 py-3">Số báo cáo đối lập</th>
          <th className="px-4 py-3">Trạng thái xử lý</th>
          <th className="px-4 py-3">Phát sinh lúc</th>
          <th className="px-4 py-3" />
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {items.map((item) => (
          <tr key={item.id} className="hover:bg-slate-50/70">
            <td className="px-4 py-4">
              <span className="font-mono text-xs font-semibold text-teal-800">
                #{item.id.slice(0, 8)}…{item.id.slice(-4)}
              </span>
              <p className="mt-1 max-w-sm text-xs leading-5 text-slate-700">{item.openReason}</p>
            </td>
            <td className="px-4 py-4">
              <p className="font-semibold text-slate-900">{item.locationName || item.locationId}</p>
              <p className="max-w-xs truncate text-xs text-slate-500">{item.locationAddress}</p>
            </td>
            <td className="px-4 py-4">
              <p className="font-semibold text-slate-800">
                {featureLabels[item.featureType] ?? item.featureType} (v{item.featureVersion})
              </p>
              <p className="text-xs text-slate-500">
                Đang công bố:{" "}
                <strong className="text-slate-700">
                  {item.publishedStatus
                    ? (publishedStatusLabels[item.publishedStatus] ?? item.publishedStatus)
                    : "—"}
                </strong>
              </p>
            </td>
            <td className="px-4 py-4">
              <Badge variant="amber">
                {item.contradictingVoterCount ?? 2} báo cáo trái chiều
              </Badge>
            </td>
            <td className="px-4 py-4">
              <Badge variant={statusVariant(item.status)}>
                {disputeStatusLabels[item.status] ?? item.status}
              </Badge>
            </td>
            <td className="px-4 py-4 text-xs text-slate-600">{formatAdminDate(item.openedAt)}</td>
            <td className="px-4 py-4 text-right">
              <Link
                href={`/admin/tranh-chap-tiep-can/${item.id}`}
                className="inline-flex items-center rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-800 transition hover:bg-teal-100"
              >
                So sánh & Phân xử
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReportTable({ items }: { items: ReportQueueItem[] }) {
  return (
    <table className="w-full min-w-[900px] text-left text-sm">
      <thead className="bg-white text-[11px] uppercase tracking-wide text-slate-400">
        <tr>
          <th className="px-4 py-3">Báo cáo</th>
          <th className="px-4 py-3">Địa điểm</th>
          <th className="px-4 py-3">Loại vấn đề</th>
          <th className="px-4 py-3">Trạng thái</th>
          <th className="px-4 py-3">Gửi lúc</th>
          <th className="px-4 py-3" />
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {items.map((item) => (
          <tr key={item.id} className="hover:bg-slate-50/70">
            <td className="px-4 py-4"><span className="font-mono text-xs text-slate-600">{item.id}</span><p className="mt-1 max-w-xs truncate text-xs text-slate-500">{item.description}</p></td>
            <td className="px-4 py-4"><p className="font-semibold text-slate-900">{item.locationName || item.locationId}</p><p className="max-w-xs truncate text-xs text-slate-500">{item.locationAddress}</p></td>
            <td className="px-4 py-4"><p className="font-semibold text-slate-800">{reportReasonLabels[item.reason] ?? item.reason}</p>{item.featureType && <p className="text-xs text-slate-500">{featureLabels[item.featureType] ?? item.featureType} {item.observedFeatureVersion ? `· v${item.observedFeatureVersion}` : ""}</p>}</td>
            <td className="px-4 py-4"><Badge variant={statusVariant(item.status)}>{reportStatusLabels[item.status] ?? item.status}</Badge>{item.isStaleBaseline && <Badge variant="amber" className="ml-1">Bản cũ</Badge>}</td>
            <td className="px-4 py-4 text-xs text-slate-600">{formatAdminDate(item.createdAt)}</td>
            <td className="px-4 py-4 text-right"><Link href={`/admin/bao-cao-sai-lech/${item.id}`} className="font-semibold text-teal-700 hover:underline">Xem chi tiết</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
