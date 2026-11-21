"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  GitMerge,
  History,
  Layers,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { apiRequest } from "@/shared/api/api-client";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { Skeleton } from "@/shared/ui/skeleton";

interface AdminLocationListItem {
  id: string;
  name: string;
  formattedAddress?: string | null;
  latitude: number;
  longitude: number;
  status: string;
  origin: string;
  metadataVersion: number;
  pendingSourceProposalCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AdminLocationListResponse {
  items: AdminLocationListItem[];
  nextCursor?: string | null;
  hasMore: boolean;
}

interface AdminAccessScope {
  id: string;
  locationId: string;
  parentScopeId?: string | null;
  kind: string;
  floorNumber?: number | null;
  label: string;
  coverageStatus: string;
  latitude?: number | null;
  longitude?: number | null;
  positionStatus: string;
  positionVersion: number;
}

interface AdminLocationFeature {
  id: string;
  scopeId: string;
  featureType: string;
  currentStatus: string;
  confidence?: number | null;
  confidenceMode: string;
  version: number;
  isMergeRetired: boolean;
}

interface AdminMetadataHistoryItem {
  id: string;
  scopeId?: string | null;
  recordKind: string;
  changeType: string;
  decision?: string | null;
  sourceSubmissionId?: string | null;
  sourceReportId?: string | null;
  reason: string;
  locationVersion: number;
  effectiveAt: string;
}

interface AdminLocationDetail extends AdminLocationListItem {
  externalPlaceProvider?: string | null;
  externalPlaceId?: string | null;
  mergedIntoLocationId?: string | null;
  replacesLocationId?: string | null;
  scopes: AdminAccessScope[];
  currentFeatures: AdminLocationFeature[];
  pendingSourceProposals: AdminMetadataHistoryItem[];
  metadataHistory: AdminMetadataHistoryItem[];
}

interface LocationMergeConflict {
  sourceFeatureId: string;
  sourceScopeId: string;
  sourceScopeLabel: string;
  targetFeatureId: string;
  targetScopeId: string;
  targetScopeLabel: string;
  featureType: string;
  sourceStatus: string;
  targetStatus: string;
}

interface LocationMergePreview {
  sourceLocation: AdminLocationListItem;
  targetLocation: AdminLocationListItem;
  potentialConflicts: LocationMergeConflict[];
  affectedLocationCount: number;
  affectedScopeCount: number;
  affectedFeatureCount: number;
  affectedFavoriteCount: number;
  affectedAccountCount: number;
  mergeToken: string;
  tokenExpiresAt: string;
}

function statusBadgeVariant(status: string): "teal" | "amber" | "red" | "blue" | "neutral" {
  switch (status) {
    case "Active":
      return "teal";
    case "Provisional":
      return "amber";
    case "Closed":
    case "Hidden":
      return "red";
    case "Merged":
      return "blue";
    default:
      return "neutral";
  }
}

export default function AdminLocationsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [locations, setLocations] = useState<AdminLocationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminLocationDetail | null>(null);

  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Metadata patch state
  const [metaDecision, setMetaDecision] = useState<"Approve" | "Dismiss">("Approve");
  const [metaProposalId, setMetaProposalId] = useState("");
  const [metaReportId, setMetaReportId] = useState("");
  const [metaSubmissionId, setMetaSubmissionId] = useState("");
  const [metaName, setMetaName] = useState("");
  const [metaAddress, setMetaAddress] = useState("");
  const [metaLat, setMetaLat] = useState("");
  const [metaLng, setMetaLng] = useState("");
  const [metaReason, setMetaReason] = useState("");

  // Scope position patch state
  const [editingScope, setEditingScope] = useState<AdminAccessScope | null>(null);
  const [scopeLat, setScopeLat] = useState("");
  const [scopeLng, setScopeLng] = useState("");
  const [scopeReason, setScopeReason] = useState("");

  // Lifecycle state
  const [lifecycleAction, setLifecycleAction] = useState<
    "ConfirmClosure" | "ConfirmReopening" | "ConfirmStructuralChange" | "ConfirmReplacement"
  >("ConfirmClosure");
  const [lifecycleSourceId, setLifecycleSourceId] = useState("");
  const [lifecycleReplacementId, setLifecycleReplacementId] = useState("");
  const [lifecycleReason, setLifecycleReason] = useState("");

  // Merge state
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergePreview, setMergePreview] = useState<LocationMergePreview | null>(null);
  const [conflictDecisions, setConflictDecisions] = useState<Record<string, string>>({});
  const [mergeReason, setMergeReason] = useState("");

  const triggerReload = useCallback(() => {
    setReloadToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchList() {
      setIsLoadingList(true);
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (search.trim()) params.set("q", search.trim());
        if (statusFilter) params.set("status", statusFilter);
        if (pendingOnly) params.set("hasPendingSourceChanges", "true");
        if (cursor) params.set("cursor", cursor);

        const res = await apiRequest<AdminLocationListResponse>(`/api/v1/admin/locations?${params.toString()}`);
        if (!cancelled) {
          const items = res.data.items ?? [];
          setLocations(items);
          setNextCursor(res.data.nextCursor ?? null);
          setListError(null);
          if (items.length > 0 && (!selectedId || !items.some((x) => x.id === selectedId))) {
            setSelectedId(items[0].id);
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setListError(cause instanceof Error ? cause.message : "Không thể tải danh sách địa điểm.");
        }
      } finally {
        if (!cancelled) setIsLoadingList(false);
      }
    }

    void fetchList();
    return () => {
      cancelled = true;
    };
  }, [search, statusFilter, pendingOnly, cursor, reloadToken, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    let cancelled = false;
    async function fetchDetail() {
      try {
        const res = await apiRequest<AdminLocationDetail>(`/api/v1/admin/locations/${encodeURIComponent(selectedId!)}`);
        if (!cancelled) {
          const d = res.data;
          setDetail(d);
          setMetaName(d.name);
          setMetaAddress(d.formattedAddress ?? "");
          setMetaLat(String(d.latitude));
          setMetaLng(String(d.longitude));
          const firstProposal = d.pendingSourceProposals[0];
          setMetaProposalId(firstProposal?.id ?? "");
          setMetaReportId(firstProposal?.sourceReportId ?? "");
          setMetaSubmissionId(firstProposal?.sourceSubmissionId ?? "");
          setMergePreview(null);
        }
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setIsLoadingDetail(false);
      }
    }

    void fetchDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedId, reloadToken]);

  async function handleMetadataSubmit(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setActionError(null);
    setActionSuccess(null);

    if (!metaProposalId.trim() && !metaReportId.trim() && !metaSubmissionId.trim()) {
      setActionError("Cần nhập ít nhất một mã nguồn (Proposal ID, Report ID hoặc Submission ID) để cập nhật metadata.");
      return;
    }
    if (metaReason.trim().length < 10) {
      setActionError("Lý do cập nhật metadata phải tối thiểu 10 ký tự.");
      return;
    }

    setIsSubmitting(true);
    try {
      const latNum = Number(metaLat);
      const lngNum = Number(metaLng);
      await apiRequest(`/api/v1/admin/locations/${encodeURIComponent(detail.id)}/metadata`, {
        method: "PATCH",
        body: {
          sourceProposalId: metaProposalId.trim() || null,
          sourceReportId: metaReportId.trim() || null,
          sourceSubmissionId: metaSubmissionId.trim() || null,
          decision: metaDecision,
          name: metaName.trim() || null,
          formattedAddress: metaAddress.trim() || null,
          latitude: Number.isFinite(latNum) ? latNum : null,
          longitude: Number.isFinite(lngNum) ? lngNum : null,
          expectedMetadataVersion: detail.metadataVersion,
          reason: metaReason.trim(),
        },
      });
      setActionSuccess("Đã lưu quyết định metadata địa điểm.");
      setMetaReason("");
      triggerReload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không thể cập nhật metadata.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleScopePositionSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editingScope) return;
    setActionError(null);
    setActionSuccess(null);

    const latNum = Number(scopeLat);
    const lngNum = Number(scopeLng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      setActionError("Tọa độ lối vào (vĩ độ / kinh độ) không hợp lệ.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest(`/api/v1/admin/access-scopes/${encodeURIComponent(editingScope.id)}/position`, {
        method: "PATCH",
        body: {
          latitude: latNum,
          longitude: lngNum,
          expectedVersion: editingScope.positionVersion,
          reason: scopeReason.trim() || "Hiệu chỉnh tọa độ lối vào trên Admin Portal",
        },
      });
      setActionSuccess(`Đã cập nhật tọa độ phân khu ${editingScope.label}.`);
      setEditingScope(null);
      setScopeReason("");
      triggerReload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không thể cập nhật tọa độ phân khu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLifecycleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setActionError(null);
    setActionSuccess(null);

    if (!lifecycleSourceId.trim()) {
      setActionError("Cần nhập Report ID hoặc Submission ID làm căn cứ chuyển trạng thái vòng đời.");
      return;
    }
    if (lifecycleReason.trim().length < 10) {
      setActionError("Lý do chuyển trạng thái vòng đời phải tối thiểu 10 ký tự.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest(`/api/v1/admin/locations/${encodeURIComponent(detail.id)}/lifecycle`, {
        method: "PATCH",
        body: {
          action: lifecycleAction,
          reportId: lifecycleSourceId.trim(),
          replacementLocationId:
            lifecycleAction === "ConfirmReplacement" && lifecycleReplacementId.trim()
              ? lifecycleReplacementId.trim()
              : null,
          expectedMetadataVersion: detail.metadataVersion,
          reason: lifecycleReason.trim(),
        },
      });
      setActionSuccess(`Đã thực hiện ${lifecycleAction} cho địa điểm ${detail.name}.`);
      setLifecycleReason("");
      triggerReload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không thể thay đổi trạng thái vòng đời.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMergePreview() {
    if (!detail || !mergeTargetId.trim()) return;
    setActionError(null);
    setActionSuccess(null);
    setIsSubmitting(true);
    try {
      const res = await apiRequest<LocationMergePreview>(
        `/api/v1/admin/locations/${encodeURIComponent(detail.id)}/merge-preview?targetLocationId=${encodeURIComponent(mergeTargetId.trim())}`,
      );
      setMergePreview(res.data);
      const defaults: Record<string, string> = {};
      for (const c of res.data.potentialConflicts) {
        defaults[`${c.targetScopeId}:${c.featureType}`] = c.targetFeatureId;
      }
      setConflictDecisions(defaults);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không thể xem trước hợp nhất địa điểm.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMergeExecute(event: FormEvent) {
    event.preventDefault();
    if (!detail || !mergePreview) return;
    setActionError(null);
    setActionSuccess(null);

    if (mergeReason.trim().length < 10) {
      setActionError("Lý do hợp nhất địa điểm phải tối thiểu 10 ký tự.");
      return;
    }

    setIsSubmitting(true);
    try {
      const conflictList = mergePreview.potentialConflicts.map((c) => ({
        targetScopeId: c.targetScopeId,
        featureType: c.featureType,
        winningFeatureId: conflictDecisions[`${c.targetScopeId}:${c.featureType}`] || c.targetFeatureId,
      }));

      await apiRequest(`/api/v1/admin/locations/${encodeURIComponent(detail.id)}/merge`, {
        method: "POST",
        body: {
          mergeToken: mergePreview.mergeToken,
          targetLocationId: mergePreview.targetLocation.id,
          conflictDecisions: conflictList,
          reason: mergeReason.trim(),
        },
      });
      setActionSuccess(`Đã hợp nhất ${detail.name} vào ${mergePreview.targetLocation.name}.`);
      setMergePreview(null);
      setMergeTargetId("");
      setMergeReason("");
      triggerReload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Hợp nhất địa điểm thất bại.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-teal-700">Nền tảng · Quản trị bản đồ chuẩn hóa</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold text-slate-950">
            <MapPin className="size-6 text-teal-700" />
            Quản lý Địa điểm, Phân khu & Hợp nhất
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Duyệt đề xuất metadata, hiệu chỉnh tọa độ lối vào AccessScope, đóng/thay thế địa điểm và hợp nhất bản ghi trùng lặp.
          </p>
        </div>
        <Button variant="outline" onClick={triggerReload} disabled={isLoadingList}>
          <RefreshCw className={`size-4 ${isLoadingList ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </header>

      {actionError && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <ShieldAlert className="size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}
      {actionSuccess && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
          {actionSuccess}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="space-y-3">
            <div>
              <CardTitle>Danh sách địa điểm</CardTitle>
              <CardDescription>Chọn địa điểm để xem phân khu, lịch sử và công cụ chỉnh sửa</CardDescription>
            </div>
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setCursor(null);
                    setCursorHistory([]);
                  }}
                  placeholder="Tìm tên, địa chỉ, BusinessCode..."
                  className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-teal-500"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setCursor(null);
                    setCursorHistory([]);
                  }}
                  className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-teal-500"
                >
                  <option value="">Tất cả trạng thái</option>
                  <option value="Active">Active</option>
                  <option value="Provisional">Provisional</option>
                  <option value="Closed">Closed</option>
                  <option value="Hidden">Hidden</option>
                  <option value="Merged">Merged</option>
                </select>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={pendingOnly}
                    onChange={(e) => {
                      setPendingOnly(e.target.checked);
                      setCursor(null);
                      setCursorHistory([]);
                    }}
                  />
                  Có đề xuất chờ
                </label>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-2">
            {isLoadingList ? (
              <div className="space-y-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : listError ? (
              <EmptyState title="Không tải được địa điểm" description={listError} />
            ) : locations.length === 0 ? (
              <EmptyState title="Không tìm thấy địa điểm" description="Thử thay đổi từ khóa hoặc bộ lọc." />
            ) : (
              locations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => setSelectedId(loc.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    selectedId === loc.id
                      ? "border-teal-600 bg-teal-50/70"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">{loc.name}</p>
                    <Badge variant={statusBadgeVariant(loc.status)}>{loc.status}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {loc.formattedAddress || `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                    <span>v{loc.metadataVersion} · {loc.origin}</span>
                    {loc.pendingSourceProposalCount > 0 && (
                      <Badge variant="amber">{loc.pendingSourceProposalCount} đề xuất</Badge>
                    )}
                  </div>
                </button>
              ))
            )}

            {(cursorHistory.length > 0 || nextCursor) && (
              <div className="flex justify-between pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cursorHistory.length === 0}
                  onClick={() => {
                    const prev = cursorHistory.at(-1) ?? null;
                    setCursorHistory((h) => h.slice(0, -1));
                    setCursor(prev);
                  }}
                >
                  Trước
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!nextCursor}
                  onClick={() => {
                    setCursorHistory((h) => [...h, cursor]);
                    setCursor(nextCursor);
                  }}
                >
                  Tiếp
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {isLoadingDetail ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-32" />
              </CardContent>
            </Card>
          ) : !detail ? (
            <Card>
              <CardContent className="p-8">
                <EmptyState title="Chọn một địa điểm" description="Nhấp vào một địa điểm bên trái để xem chi tiết và thao tác." />
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle>{detail.name}</CardTitle>
                      <CardDescription>
                        {detail.formattedAddress || "Chưa có địa chỉ"} · ID: <span className="font-mono">{detail.id}</span>
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant={statusBadgeVariant(detail.status)}>{detail.status}</Badge>
                      <Badge variant="neutral">Metadata v{detail.metadataVersion}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={handleMetadataSubmit} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <h3 className="text-sm font-bold text-slate-900">Cập nhật & Duyệt đề xuất Metadata</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Tên địa điểm</label>
                        <input
                          value={metaName}
                          onChange={(e) => setMetaName(e.target.value)}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Địa chỉ chuẩn hóa</label>
                        <input
                          value={metaAddress}
                          onChange={(e) => setMetaAddress(e.target.value)}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Vĩ độ (Lat)</label>
                        <input
                          value={metaLat}
                          onChange={(e) => setMetaLat(e.target.value)}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-mono"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Kinh độ (Lng)</label>
                        <input
                          value={metaLng}
                          onChange={(e) => setMetaLng(e.target.value)}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-mono"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">SourceProposalId</label>
                        <input
                          value={metaProposalId}
                          onChange={(e) => setMetaProposalId(e.target.value)}
                          placeholder="UUID Proposal (nếu có)..."
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">SourceReportId / SubmissionId</label>
                        <input
                          value={metaReportId}
                          onChange={(e) => setMetaReportId(e.target.value)}
                          placeholder="UUID Report căn cứ..."
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono"
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                      <select
                        value={metaDecision}
                        onChange={(e) => setMetaDecision(e.target.value as "Approve" | "Dismiss")}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                      >
                        <option value="Approve">Approve</option>
                        <option value="Dismiss">Dismiss</option>
                      </select>
                      <input
                        value={metaReason}
                        onChange={(e) => setMetaReason(e.target.value)}
                        placeholder="Lý do áp dụng hoặc bác bỏ đề xuất metadata (>= 10 ký tự)..."
                        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" size="sm" disabled={isSubmitting}>
                        <CheckCircle2 className="size-4" />
                        Lưu Metadata
                      </Button>
                    </div>
                  </form>

                  <div className="space-y-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                      <Layers className="size-4 text-teal-700" />
                      Phân khu / Lối vào ({detail.scopes.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2 pr-2">Phân khu</th>
                            <th className="py-2 px-2">Loại / Tầng</th>
                            <th className="py-2 px-2">Tọa độ</th>
                            <th className="py-2 px-2">Trạng thái vị trí</th>
                            <th className="py-2 pl-2 text-right">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {detail.scopes.map((sc) => (
                            <tr key={sc.id}>
                              <td className="py-2 pr-2 font-medium text-slate-900">{sc.label}</td>
                              <td className="py-2 px-2 text-slate-600">
                                {sc.kind} {sc.floorNumber != null ? `· Tầng ${sc.floorNumber}` : ""}
                              </td>
                              <td className="py-2 px-2 font-mono text-slate-600">
                                {sc.latitude != null && sc.longitude != null
                                  ? `${sc.latitude.toFixed(5)}, ${sc.longitude.toFixed(5)}`
                                  : "Kế thừa địa điểm"}
                              </td>
                              <td className="py-2 px-2">
                                <Badge variant={sc.positionStatus === "Approved" ? "teal" : "amber"}>
                                  {sc.positionStatus} (v{sc.positionVersion})
                                </Badge>
                              </td>
                              <td className="py-2 pl-2 text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setEditingScope(sc);
                                    setScopeLat(String(sc.latitude ?? detail.latitude));
                                    setScopeLng(String(sc.longitude ?? detail.longitude));
                                  }}
                                >
                                  Chỉnh vị trí
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {editingScope && (
                      <form onSubmit={handleScopePositionSubmit} className="grid gap-2 rounded-lg border border-teal-200 bg-teal-50/40 p-3 sm:grid-cols-4">
                        <input
                          value={scopeLat}
                          onChange={(e) => setScopeLat(e.target.value)}
                          placeholder="Latitude"
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-mono"
                        />
                        <input
                          value={scopeLng}
                          onChange={(e) => setScopeLng(e.target.value)}
                          placeholder="Longitude"
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-mono"
                        />
                        <input
                          value={scopeReason}
                          onChange={(e) => setScopeReason(e.target.value)}
                          placeholder="Lý do chỉnh tọa độ..."
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs"
                        />
                        <div className="flex gap-1.5 justify-end">
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditingScope(null)}>
                            Hủy
                          </Button>
                          <Button type="submit" size="sm" disabled={isSubmitting}>
                            Lưu tọa độ
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Vòng đời Địa điểm (Lifecycle)</CardTitle>
                    <CardDescription>Đóng cửa, mở lại, thay đổi kết cấu hoặc thay thế cơ sở mới</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleLifecycleSubmit} className="space-y-3">
                      <select
                        value={lifecycleAction}
                        onChange={(e) => setLifecycleAction(e.target.value as typeof lifecycleAction)}
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                      >
                        <option value="ConfirmClosure">ConfirmClosure (Đóng cửa)</option>
                        <option value="ConfirmReopening">ConfirmReopening (Mở cửa lại)</option>
                        <option value="ConfirmStructuralChange">ConfirmStructuralChange (Cải tạo kết cấu)</option>
                        <option value="ConfirmReplacement">ConfirmReplacement (Thay thế địa điểm mới)</option>
                      </select>
                      <input
                        value={lifecycleSourceId}
                        onChange={(e) => setLifecycleSourceId(e.target.value)}
                        placeholder="Report ID căn cứ (UUID bắt buộc)..."
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono"
                      />
                      {lifecycleAction === "ConfirmReplacement" && (
                        <input
                          value={lifecycleReplacementId}
                          onChange={(e) => setLifecycleReplacementId(e.target.value)}
                          placeholder="Location ID mới thay thế..."
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono"
                        />
                      )}
                      <input
                        value={lifecycleReason}
                        onChange={(e) => setLifecycleReason(e.target.value)}
                        placeholder="Lý do chuyển trạng thái (>= 10 ký tự)..."
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                      />
                      <Button type="submit" size="sm" disabled={isSubmitting} className="w-full">
                        Áp dụng trạng thái vòng đời
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <GitMerge className="size-4 text-teal-700" />
                      Hợp nhất Địa điểm Trùng lặp
                    </CardTitle>
                    <CardDescription>Xem trước xung đột tính năng và hợp nhất địa điểm hiện tại vào địa điểm đích</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        placeholder="Target Location ID (UUID đích giữ lại)..."
                        className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono"
                      />
                      <Button type="button" size="sm" variant="outline" disabled={isSubmitting} onClick={() => void handleMergePreview()}>
                        Xem trước
                      </Button>
                    </div>

                    {mergePreview && (
                      <form onSubmit={handleMergeExecute} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs">
                        <p className="font-semibold text-slate-900">
                          Đích giữ lại: {mergePreview.targetLocation.name} · Ảnh hưởng {mergePreview.affectedLocationCount} địa điểm, {mergePreview.affectedFeatureCount} tiện ích
                        </p>
                        {mergePreview.potentialConflicts.map((c) => (
                          <div key={`${c.targetScopeId}:${c.featureType}`} className="rounded border border-amber-200 bg-white p-2">
                            <p className="font-semibold">{c.featureType} tại {c.targetScopeLabel}</p>
                            <select
                              value={conflictDecisions[`${c.targetScopeId}:${c.featureType}`] || c.targetFeatureId}
                              onChange={(e) =>
                                setConflictDecisions((prev) => ({
                                  ...prev,
                                  [`${c.targetScopeId}:${c.featureType}`]: e.target.value,
                                }))
                              }
                              className="mt-1 h-8 w-full rounded border border-slate-200 px-2"
                            >
                              <option value={c.targetFeatureId}>Giữ Target ({c.targetStatus})</option>
                              <option value={c.sourceFeatureId}>Giữ Source ({c.sourceStatus})</option>
                            </select>
                          </div>
                        ))}
                        <input
                          value={mergeReason}
                          onChange={(e) => setMergeReason(e.target.value)}
                          placeholder="Lý do hợp nhất (>= 10 ký tự)..."
                          required
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs"
                        />
                        <Button type="submit" size="sm" disabled={isSubmitting} className="w-full">
                          Xác nhận Hợp nhất (Merge)
                        </Button>
                      </form>
                    )}
                  </CardContent>
                </Card>
              </div>

              {detail.metadataHistory.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <History className="size-4 text-slate-500" />
                      Lịch sử chỉnh sửa Metadata ({detail.metadataHistory.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    {detail.metadataHistory.slice(0, 6).map((h) => (
                      <div key={h.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
                        <div>
                          <span className="font-semibold text-slate-800">{h.changeType}</span> · {h.reason}
                        </div>
                        <span className="font-mono text-slate-400">v{h.locationVersion}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
