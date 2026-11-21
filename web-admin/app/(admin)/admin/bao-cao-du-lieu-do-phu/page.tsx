"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ChartNoAxesCombined, CheckCircle2, Download, FilePlus2, Info, RefreshCw, ShieldAlert } from "lucide-react";
import { apiRequest, getStoredPortalAuth } from "@/shared/api/api-client";
import { getApiBaseUrl } from "@/shared/config/runtime";
import { createBrowserSupabaseClient } from "@/shared/lib/supabase/client";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { Progress } from "@/shared/ui/progress";
import { Skeleton } from "@/shared/ui/skeleton";

interface FeatureBreakdown {
  key: string;
  label: string;
  supportedCount: number;
  percentage: number;
}

interface CategoryBreakdown {
  category: string;
  totalPlaces: number;
  verifiedPlaces: number;
}

interface CoverageSnapshot {
  id: string;
  title: string;
  region: string;
  category?: string | null;
  status: string;
  totalPlaces: number;
  verifiedPlaces: number;
  createdAt: string;
}

interface CoverageOverviewResponse {
  totalPlaces: number;
  verifiedPlaces: number;
  verifiedPercentage: number;
  featureBreakdown: FeatureBreakdown[];
  categoryBreakdown: CategoryBreakdown[];
  snapshots: CoverageSnapshot[];
}

interface QualityInsightFeatureItem {
  featureType: string;
  totalPublished: number;
  rawReportsSubmitted: number;
  confirmedCorrections: number;
  suppressedCount: number;
  smallCellSuppressed: boolean;
}

interface QualityInsightRegionItem {
  region: string;
  activeLocations: number;
  rawReportsSubmitted: number;
  confirmedCorrections: number;
  smallCellSuppressed: boolean;
}

interface QualityInsightsResponse {
  disclaimer: string;
  policyVersion: string;
  smallCellThreshold: number;
  totalRawReportsSubmitted: number;
  totalConfirmedCorrections: number;
  missingObservationLocations: number;
  featureBreakdown: QualityInsightFeatureItem[];
  regionBreakdown: QualityInsightRegionItem[];
}

type ExportFormat = "CSV" | "GeoJSON" | "PDF";

export default function CoverageReportsPage() {
  const [data, setData] = useState<CoverageOverviewResponse | null>(null);
  const [insights, setInsights] = useState<QualityInsightsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const [title, setTitle] = useState("Báo cáo độ phủ tiếp cận định kỳ");
  const [region, setRegion] = useState("TP.HCM & Hà Nội");
  const [category, setCategory] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const triggerReload = useCallback(() => {
    setIsLoading(true);
    setReloadToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchOverview() {
      try {
        const [covRes, insightsRes] = await Promise.all([
          apiRequest<CoverageOverviewResponse>("/api/v1/admin/coverage-reports"),
          apiRequest<QualityInsightsResponse>("/api/v1/admin/quality-insights").catch(() => null),
        ]);
        if (!cancelled) {
          setData(covRes.data);
          setInsights(insightsRes?.data ?? null);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Không thể tải báo cáo độ phủ dữ liệu.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchOverview();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function handleCreateSnapshot(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !region.trim()) return;
    setIsCreating(true);
    setExportMessage(null);
    try {
      await apiRequest<CoverageSnapshot>("/api/v1/admin/coverage-reports", {
        method: "POST",
        body: {
          title: title.trim(),
          region: region.trim(),
          category: category.trim() || null,
        },
      });
      triggerReload();
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : "Không thể tạo bản chụp báo cáo.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleReviewSnapshot(reportId: string) {
    setReviewingId(reportId);
    setExportMessage(null);
    try {
      await apiRequest<CoverageSnapshot>(`/api/v1/admin/coverage-reports/${encodeURIComponent(reportId)}/review`, {
        method: "POST",
        body: { note: "Đã đối soát số liệu trước khi kết xuất" },
      });
      triggerReload();
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : "Không thể phê duyệt bản chụp.");
    } finally {
      setReviewingId(null);
    }
  }

  async function handleExport(reportId: string, format: ExportFormat) {
    const key = `${reportId}:${format}`;
    setDownloadingKey(key);
    setExportMessage(null);
    try {
      const apiBaseUrl = getApiBaseUrl();
      if (!apiBaseUrl) throw new Error("Chưa cấu hình NEXT_PUBLIC_API_BASE_URL.");

      const portalAuth = getStoredPortalAuth();
      let token = portalAuth?.accessToken;
      if (!token) {
        const supabase = createBrowserSupabaseClient();
        const { data: sessionData } = await supabase.auth.getSession();
        token = sessionData.session?.access_token;
      }
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");

      const headers = new Headers({ Authorization: `Bearer ${token}` });
      if (portalAuth?.csrfToken) headers.set("X-CSRF-TOKEN", portalAuth.csrfToken);

      const response = await fetch(
        `${apiBaseUrl}/api/v1/admin/coverage-reports/${encodeURIComponent(reportId)}/export?format=${format}`,
        {
          headers,
          credentials: portalAuth ? "include" : "same-origin",
        },
      );

      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { message?: string; title?: string } | null;
        throw new Error(problem?.message || problem?.title || `Không thể xuất ${format} (${response.status}).`);
      }

      const ext = format === "GeoJSON" ? "geojson" : format.toLowerCase();
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `accessmap-coverage-${reportId.slice(0, 8)}.${ext}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : `Lỗi khi kết xuất tệp ${format}.`);
    } finally {
      setDownloadingKey(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-teal-700">Nền tảng · Thống kê tiếp cận</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold text-slate-950">
            <ChartNoAxesCombined className="size-6 text-teal-700" />
            Báo cáo Dữ liệu & Độ phủ tiếp cận
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Theo dõi tỷ lệ địa điểm đã thẩm định theo tiêu chí QCVN 10:2024/BXD, đối soát Quality Insights và xuất CSV / GeoJSON / PDF.
          </p>
        </div>
        <Button variant="outline" onClick={triggerReload} disabled={isLoading}>
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </header>

      {exportMessage && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <ShieldAlert className="size-4 shrink-0" />
          <span>{exportMessage}</span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-64" />
        </div>
      ) : error || !data ? (
        <EmptyState title="Không tải được thống kê độ phủ" description={error ?? "Đã xảy ra lỗi kết nối máy chủ."} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase text-slate-500">Tổng số địa điểm Active</p>
                <p className="mt-2 text-3xl font-extrabold text-slate-950">{data.totalPlaces}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase text-slate-500">Địa điểm đã có thẩm định</p>
                <p className="mt-2 text-3xl font-extrabold text-teal-700">{data.verifiedPlaces}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase text-slate-500">Tỷ lệ độ phủ xác minh</p>
                <p className="mt-2 text-3xl font-extrabold text-amber-600">{data.verifiedPercentage}%</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Tỷ lệ đáp ứng theo tiêu chí tiếp cận</CardTitle>
                <CardDescription>Số lượng địa điểm có dữ liệu đối chiếu trên tổng số địa điểm đang hoạt động</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.featureBreakdown.map((item) => (
                  <div key={item.key} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold text-slate-800">{item.label}</span>
                      <span className="text-slate-600">
                        {item.supportedCount} địa điểm ({item.percentage}%)
                      </span>
                    </div>
                    <Progress value={item.percentage} />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Độ phủ theo khu vực / quận</CardTitle>
                <CardDescription>Phân bổ địa điểm đã kiểm định theo khu vực hành chính</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2.5">
                  {data.categoryBreakdown.map((cat) => (
                    <div key={cat.category} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm">
                      <span className="font-medium text-slate-800">{cat.category}</span>
                      <span className="text-slate-600">
                        <strong className="text-teal-700">{cat.verifiedPlaces}</strong> / {cat.totalPlaces} đã xác minh
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {insights && (
            <Card>
              <CardHeader>
                <CardTitle>Quality Insights — Báo cáo thô vs. Đã xác nhận sửa lỗi</CardTitle>
                <CardDescription>Chính sách {insights.policyVersion} · Ngưỡng ẩn nhóm nhỏ: {insights.smallCellThreshold}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50/70 px-3.5 py-2.5 text-xs text-teal-900">
                  <Info className="mt-0.5 size-4 shrink-0 text-teal-700" />
                  <span>{insights.disclaimer}</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Tổng báo cáo thô cộng đồng gửi</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{insights.totalRawReportsSubmitted}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Chỉnh sửa đã được Admin xác nhận</p>
                    <p className="mt-1 text-2xl font-bold text-teal-700">{insights.totalConfirmedCorrections}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Địa điểm thiếu quan sát tiện ích</p>
                    <p className="mt-1 text-2xl font-bold text-amber-600">{insights.missingObservationLocations}</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                        <th className="py-2 pr-3">Hạng mục tiện ích</th>
                        <th className="py-2 px-3 text-right">Đã công bố</th>
                        <th className="py-2 px-3 text-right">Báo cáo thô</th>
                        <th className="py-2 px-3 text-right">Đã xác nhận sửa</th>
                        <th className="py-2 pl-3 text-right">Quyền riêng tư nhóm nhỏ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {insights.featureBreakdown.map((item) => (
                        <tr key={item.featureType}>
                          <td className="py-2.5 pr-3 font-medium text-slate-900">{item.featureType}</td>
                          <td className="py-2.5 px-3 text-right text-slate-700">
                            {item.smallCellSuppressed ? "Đã ẩn" : item.totalPublished}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-700">
                            {item.smallCellSuppressed ? "Đã ẩn" : item.rawReportsSubmitted}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-teal-700">
                            {item.smallCellSuppressed ? "Đã ẩn" : item.confirmedCorrections}
                          </td>
                          <td className="py-2.5 pl-3 text-right">
                            <Badge variant={item.smallCellSuppressed ? "amber" : "neutral"}>
                              {item.smallCellSuppressed ? "Small-cell suppressed" : "Đạt ngưỡng"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Tạo bản chụp, Phê duyệt & Kết xuất CSV / GeoJSON / PDF</CardTitle>
              <CardDescription>Tạo snapshot bất biến, phê duyệt trước khi xuất và tải định dạng cần thiết</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <form onSubmit={handleCreateSnapshot} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-4">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Tiêu đề báo cáo"
                  required
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm sm:col-span-2"
                />
                <input
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="Khu vực (VD: Quận 1)"
                  required
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                />
                <div className="flex gap-2">
                  <input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Nhóm (tùy chọn)"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                  <Button type="submit" disabled={isCreating} className="shrink-0">
                    <FilePlus2 className="size-4" />
                    Tạo
                  </Button>
                </div>
              </form>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="py-2.5 pr-3">Tiêu đề báo cáo</th>
                      <th className="py-2.5 px-3">Khu vực</th>
                      <th className="py-2.5 px-3">Trạng thái</th>
                      <th className="py-2.5 px-3 text-right">Đã xác minh / Tổng</th>
                      <th className="py-2.5 pl-3 text-right">Phê duyệt & Xuất file</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.snapshots.map((snap) => (
                      <tr key={snap.id}>
                        <td className="py-3 pr-3 font-semibold text-slate-900">{snap.title}</td>
                        <td className="py-3 px-3 text-slate-600">
                          {snap.region} {snap.category ? `· ${snap.category}` : ""}
                        </td>
                        <td className="py-3 px-3">
                          <Badge variant={snap.status === "Reviewed" || snap.status === "Ready" ? "teal" : "amber"}>
                            {snap.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right text-slate-700">
                          {snap.verifiedPlaces} / {snap.totalPlaces}
                        </td>
                        <td className="py-3 pl-3 text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {snap.id !== "live-default" && snap.status === "Generated" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={reviewingId === snap.id}
                                onClick={() => void handleReviewSnapshot(snap.id)}
                              >
                                <CheckCircle2 className="size-3.5" />
                                {reviewingId === snap.id ? "Đang duyệt..." : "Duyệt"}
                              </Button>
                            )}
                            {(["CSV", "GeoJSON", "PDF"] as const).map((fmt) => {
                              const dlKey = `${snap.id}:${fmt}`;
                              return (
                                <Button
                                  key={fmt}
                                  size="sm"
                                  variant="outline"
                                  disabled={downloadingKey === dlKey}
                                  onClick={() => void handleExport(snap.id, fmt)}
                                >
                                  <Download className="size-3.5" />
                                  {downloadingKey === dlKey ? "..." : fmt}
                                </Button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
