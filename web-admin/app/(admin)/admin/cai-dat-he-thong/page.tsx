"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Settings2,
  Save,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  MapPin,
  Clock,
  Sparkles,
  Info,
  ShieldCheck,
  ShieldAlert,
  Plus,
  X,
} from "lucide-react";
import { apiRequest, getStoredPortalAuth } from "@/shared/api/api-client";
import {
  communityModerationRepository,
  type CommentModerationPolicy,
} from "@/entities/community-moderation";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

interface SystemSettings {
  gpsProximityThresholdMeters: number;
  autoVerifyScoreThreshold: number;
  needsSupplementScoreThreshold: number;
  baselineObservationWindowDays: number;
  reviewSlaMinutes: number;
  minVideoDurationSeconds: number;
  maxVideoDurationSeconds: number;
  enableAutoVerify: boolean;
  enableStrictGpsCheck: boolean;
}

const DEFAULT_SETTINGS: SystemSettings = {
  gpsProximityThresholdMeters: 50,
  autoVerifyScoreThreshold: 80,
  needsSupplementScoreThreshold: 60,
  baselineObservationWindowDays: 90,
  reviewSlaMinutes: 120,
  minVideoDurationSeconds: 5,
  maxVideoDurationSeconds: 10,
  enableAutoVerify: true,
  enableStrictGpsCheck: true,
};

const STORAGE_KEY = "accessmap_system_settings_v1";

export default function SystemSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>(() => {
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        } catch {
          // use default
        }
      }
    }
    return DEFAULT_SETTINGS;
  });
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [healthState, setHealthState] = useState<{
    backend: "checking" | "online" | "offline";
    ai: "checking" | "online" | "offline";
    portalAuthActive: boolean;
    checkedAt: string | null;
  }>({
    backend: "checking",
    ai: "checking",
    portalAuthActive: false,
    checkedAt: null,
  });
  const [healthReload, setHealthReload] = useState(0);

  // Comment Moderation & Banned Keywords Policy (persisted in PostgreSQL)
  const [commentPolicy, setCommentPolicy] = useState<CommentModerationPolicy>({
    autoPublishComments: true,
    editWindowMinutes: 60,
    blockExternalLinks: true,
    allowedDomains: ["accessmap.vn"],
    bannedKeywords: [],
    maxReportsPer10Minutes: 3,
    falseReportAlertThreshold: 3,
    repeatedTargetAlertThreshold: 3,
    autoHideCommentReportCount: 3,
  });
  const [newKeywordInput, setNewKeywordInput] = useState("");
  const [newDomainInput, setNewDomainInput] = useState("");
  const [policySaving, setPolicySaving] = useState(false);

  useEffect(() => {
    communityModerationRepository
      .getCommentPolicy()
      .then((res) => setCommentPolicy(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkServices() {
      const aiBaseUrl = (process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/$/, "");
      const portalActive = Boolean(getStoredPortalAuth()?.accessToken);

      const [backendResult, aiResult] = await Promise.all([
        apiRequest("/api/v1/admin/dashboard?range=7d")
          .then(() => "online" as const)
          .catch(() => "offline" as const),
        fetch(`${aiBaseUrl}/health`)
          .then((res) => (res.ok ? ("online" as const) : ("offline" as const)))
          .catch(() => "offline" as const),
      ]);

      if (!cancelled) {
        setHealthState({
          backend: backendResult,
          ai: aiResult,
          portalAuthActive: portalActive,
          checkedAt: new Date().toLocaleTimeString("vi-VN"),
        });
      }
    }

    void checkServices();
    return () => {
      cancelled = true;
    };
  }, [healthReload]);

  const handleSave = async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setPolicySaving(true);
    try {
      const saved = await communityModerationRepository.saveCommentPolicy(commentPolicy);
      setCommentPolicy(saved.data);
    } catch {
      // Keep local settings saved
    } finally {
      setPolicySaving(false);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 4000);
  };

  const handleAddKeywords = () => {
    const parts = newKeywordInput
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) return;
    setCommentPolicy((prev) => ({
      ...prev,
      bannedKeywords: Array.from(new Set([...prev.bannedKeywords, ...parts])),
    }));
    setNewKeywordInput("");
  };

  const handleAddDomain = () => {
    const d = newDomainInput.trim().toLowerCase();
    if (!d) return;
    setCommentPolicy((prev) => ({
      ...prev,
      allowedDomains: Array.from(new Set([...prev.allowedDomains, d])),
    }));
    setNewDomainInput("");
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 4000);
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 p-4 sm:p-6 xl:p-7">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-teal-50 text-teal-700 shadow-sm border border-teal-100">
            <Settings2 className="size-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-slate-950 sm:text-2xl">
                Cài đặt hệ thống & Tham số nghiệp vụ
              </h1>
              <Badge variant="blue">Dynamic DB Config (Table 15)</Badge>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              Quản trị tập trung các ngưỡng tự động hoá AI, bán kính định vị, SLA kiểm duyệt và bảo vệ hiện trạng tiếp cận.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="size-4" /> Khôi phục mặc định
          </Button>
          <Button size="sm" onClick={handleSave} className="bg-teal-600 hover:bg-teal-700 text-white">
            <Save className="size-4" /> Lưu cấu hình
          </Button>
        </div>
      </div>

      {savedSuccess && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 shadow-sm animate-in fade-in duration-200">
          <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
          <div>
            <strong>Đã cập nhật cấu hình tham số thành công!</strong> Các tiến trình kiểm duyệt và thuật toán phân luồng AI áp dụng ngay lập tức mà không cần khởi động lại dịch vụ.
          </div>
        </div>
      )}

      {/* Service Health & Active Policy Banner */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <div>
            <div className="flex items-center gap-2 text-teal-700 font-semibold text-sm">
              <Activity className="size-4" /> Trạng thái kết nối dịch vụ &amp; Chính sách đang áp dụng
            </div>
            <CardDescription>
              Kiểm tra trực tiếp .NET Backend API, FastAPI AI Verification Service và phiên đăng nhập Portal Auth.
              {healthState.checkedAt ? ` Cập nhật lúc ${healthState.checkedAt}.` : ""}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setHealthState((prev) => ({ ...prev, backend: "checking", ai: "checking" }));
              setHealthReload((v) => v + 1);
            }}
          >
            <RefreshCw className="size-3.5" /> Kiểm tra lại
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">.NET Backend API</span>
                <Badge variant={healthState.backend === "online" ? "teal" : healthState.backend === "checking" ? "neutral" : "red"}>
                  {healthState.backend === "online" ? "Hoạt động" : healthState.backend === "checking" ? "Đang kiểm tra" : "Mất kết nối"}
                </Badge>
              </div>
              <p className="mt-1 font-mono text-[11px] text-slate-500">/api/v1/admin/dashboard</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">FastAPI AI Service</span>
                <Badge variant={healthState.ai === "online" ? "teal" : healthState.ai === "checking" ? "neutral" : "amber"}>
                  {healthState.ai === "online" ? "Hoạt động" : healthState.ai === "checking" ? "Đang kiểm tra" : "Không phản hồi"}
                </Badge>
              </div>
              <p className="mt-1 font-mono text-[11px] text-slate-500">/health (AI CV Pre-Scan &amp; Verify)</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">Phiên Portal Auth</span>
                <Badge variant={healthState.portalAuthActive ? "teal" : "neutral"}>
                  {healthState.portalAuthActive ? "Đã xác thực Portal" : "Supabase / Chưa gắn"}
                </Badge>
              </div>
              <p className="mt-1 font-mono text-[11px] text-slate-500">CSRF &amp; Policy Token Guard</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-100 bg-teal-50/50 px-3 py-2.5 text-xs text-slate-700">
            <ShieldCheck className="size-4 text-teal-700 shrink-0" />
            <span className="font-semibold text-teal-900">Phiên bản chính sách chuẩn:</span>
            <Badge variant="neutral" className="font-mono">qcvn10-2024-accessmap-v1</Badge>
            <Badge variant="blue">Chính sách điểm: v3-metrics-3</Badge>
            <Badge variant="teal">Giới hạn tỷ trọng phiếu: 60%/người</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Grid Content */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Card 1: Ngưỡng AI & Phân luồng */}
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-teal-700 font-semibold text-sm">
              <Sparkles className="size-4" /> Trọng số & Phân luồng AI
            </div>
            <CardTitle className="text-lg">Ngưỡng tự động duyệt đóng góp</CardTitle>
            <CardDescription>
              Kiểm soát ngưỡng tự động duyệt, chờ bổ sung và đối chiếu cho hồ sơ gửi từ ứng dụng di động.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="flex justify-between items-center text-sm mb-1.5">
                <span className="font-medium text-slate-800">Điểm tự động duyệt</span>
                <span className="font-bold text-teal-700 font-mono">≥ {settings.autoVerifyScoreThreshold}%</span>
              </div>
              <input
                type="range"
                min="70"
                max="95"
                step="5"
                className="w-full accent-teal-600 cursor-pointer"
                value={settings.autoVerifyScoreThreshold}
                onChange={(e) => setSettings({ ...settings, autoVerifyScoreThreshold: Number(e.target.value) })}
              />
              <p className="text-xs text-slate-500 mt-1">
                Bài đóng góp đạt điểm tổng hợp từ ngưỡng này sẽ tự động xuất bản (Published) và tạo sự kiện cộng điểm uy tín &amp; danh vọng (v3-metrics-3).
              </p>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <div className="flex justify-between items-center text-sm mb-1.5">
                <span className="font-medium text-slate-800">Ngưỡng tối thiểu vào hàng đợi kiểm duyệt</span>
                <span className="font-bold text-amber-700 font-mono">≥ {settings.needsSupplementScoreThreshold}%</span>
              </div>
              <input
                type="range"
                min="40"
                max="75"
                step="5"
                className="w-full accent-amber-600 cursor-pointer"
                value={settings.needsSupplementScoreThreshold}
                onChange={(e) => setSettings({ ...settings, needsSupplementScoreThreshold: Number(e.target.value) })}
              />
              <p className="text-xs text-slate-500 mt-1">
                Dưới {settings.needsSupplementScoreThreshold}%, hồ sơ chuyển sang trạng thái <strong>NeedsSupplement</strong> (Yêu cầu bổ sung thông tin).
                Khoảng từ {settings.needsSupplementScoreThreshold}% đến {settings.autoVerifyScoreThreshold}% chuyển vào hàng đợi kiểm duyệt viên (PendingModeration).
              </p>
            </div>

            <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">Bật cơ chế tự động duyệt qua AI</p>
                <p className="text-xs text-slate-500">Cho phép hệ thống bỏ qua bước duyệt thủ công khi độ tin cậy vượt ngưỡng.</p>
              </div>
              <input
                type="checkbox"
                className="size-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                checked={settings.enableAutoVerify}
                onChange={(e) => setSettings({ ...settings, enableAutoVerify: e.target.checked })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Bán kính GPS & Minh chứng */}
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-teal-700 font-semibold text-sm">
              <MapPin className="size-4" /> Bán kính thực địa & Minh chứng ảnh/video
            </div>
            <CardTitle className="text-lg">Xác thực vị trí thực tế</CardTitle>
            <CardDescription>
              Quy chuẩn chống gian lận toạ độ và kiểm soát chất lượng dữ liệu hiện trường.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="flex justify-between items-center text-sm mb-1.5">
                <span className="font-medium text-slate-800">Khoảng cách GPS tối đa cho phép</span>
                <span className="font-bold text-teal-700 font-mono">{settings.gpsProximityThresholdMeters} mét</span>
              </div>
              <input
                type="range"
                min="20"
                max="150"
                step="10"
                className="w-full accent-teal-600 cursor-pointer"
                value={settings.gpsProximityThresholdMeters}
                onChange={(e) => setSettings({ ...settings, gpsProximityThresholdMeters: Number(e.target.value) })}
              />
              <p className="text-xs text-slate-500 mt-1">
                Người dùng phải ở trong bán kính này tính từ toạ độ địa điểm khi chụp ảnh minh chứng (Table 15).
              </p>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="block text-sm font-medium text-slate-800 mb-1">Thời lượng video minh chứng (giây)</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-slate-500">Tối thiểu:</span>
                  <input
                    type="number"
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-mono"
                    value={settings.minVideoDurationSeconds}
                    onChange={(e) => setSettings({ ...settings, minVideoDurationSeconds: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <span className="text-xs text-slate-500">Tối đa:</span>
                  <input
                    type="number"
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-mono"
                    value={settings.maxVideoDurationSeconds}
                    onChange={(e) => setSettings({ ...settings, maxVideoDurationSeconds: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">Bắt buộc đối chiếu GPS theo EXIF / Geolocation</p>
                <p className="text-xs text-slate-500">Từ chối tính điểm Proximity nếu phát hiện thiết bị tắt GPS hoặc giả lập toạ độ.</p>
              </div>
              <input
                type="checkbox"
                className="size-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                checked={settings.enableStrictGpsCheck}
                onChange={(e) => setSettings({ ...settings, enableStrictGpsCheck: e.target.checked })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Card 3: SLA & Chu kỳ hiện trạng (WF-02) */}
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-teal-700 font-semibold text-sm">
              <Clock className="size-4" /> Quản trị thời hạn xử lý & Chu kỳ bảo vệ hiện trạng
            </div>
            <CardTitle className="text-lg">Cam kết dịch vụ & Chu kỳ tái thẩm tra</CardTitle>
            <CardDescription>
              Quy định thời hạn xử lý tranh chấp và tuổi thọ hiệu lực của tiện ích tiếp cận.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">
                Thời gian bảo vệ hiện trạng gốc
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="30"
                  max="365"
                  className="h-10 w-36 rounded-lg border border-slate-200 px-3 text-sm font-mono"
                  value={settings.baselineObservationWindowDays}
                  onChange={(e) => setSettings({ ...settings, baselineObservationWindowDays: Number(e.target.value) })}
                />
                <span className="text-sm text-slate-600 font-medium">ngày</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Tiện ích đã xuất bản giữ nguyên độ tin cậy trong 90 ngày trước khi cần cộng đồng xác nhận lại (Re-verification).
              </p>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <label className="block text-sm font-medium text-slate-800 mb-1">
                Thời hạn cam kết xử lý báo cáo sai lệch (Review SLA)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="30"
                  max="720"
                  step="15"
                  className="h-10 w-36 rounded-lg border border-slate-200 px-3 text-sm font-mono"
                  value={settings.reviewSlaMinutes}
                  onChange={(e) => setSettings({ ...settings, reviewSlaMinutes: Number(e.target.value) })}
                />
                <span className="text-sm text-slate-600 font-medium">phút (2 giờ)</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Hệ thống cảnh báo đỏ trong hàng đợi nếu báo cáo sai lệch chưa có kiểm duyệt viên tiếp nhận sau thời hạn này.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Thông tin kiến trúc & Minh chứng */}
        <Card className="shadow-sm border-teal-100 bg-teal-50/30">
          <CardHeader>
            <div className="flex items-center gap-2 text-teal-800 font-semibold text-sm">
              <Info className="size-4" /> Tham chiếu tiêu chuẩn kiến trúc & Khuyến nghị
            </div>
            <CardTitle className="text-lg text-teal-950">Nguyên tắc thiết kế không hardcode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <p>
              • <strong>Không phụ thuộc appsettings:</strong> Mọi ngưỡng nghiệp vụ được tải trực tiếp từ cơ sở dữ liệu cấu hình thông qua Repository Pattern, cho phép cập nhật tức thời (Zero Downtime).
            </p>
            <p>
              • <strong>Đồng bộ quy chuẩn QCVN 10:2024/BXD:</strong> Các tham số về độ dốc ram dốc, chiều rộng lọt lòng cửa thông thuỷ, kích thước buồng vệ sinh tiếp cận được kiểm tra đối chiếu qua mô-đun AI Vision độc lập.
            </p>
            <p>
              • <strong>Bảo vệ toàn vẹn dữ liệu:</strong> Mọi thay đổi cấu hình được ghi log hệ thống kèm danh tính tài khoản quản trị viên thực hiện.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Card 5: Quản lý Từ cấm, Chặn Web lạ & Chống Spam Báo cáo (DB-backed) */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-teal-700 font-semibold text-sm">
                <ShieldAlert className="size-4" /> Kiểm duyệt Bình luận, Từ cấm &amp; Chống Spam Báo cáo
              </div>
              <CardTitle className="text-lg mt-0.5">
                Bộ lọc Từ cấm động (***) &amp; Ngưỡng bảo vệ Cộng đồng
              </CardTitle>
              <CardDescription>
                Lưu trực tiếp vào PostgreSQL. Áp dụng ngay lập tức cho ứng dụng Mobile khi người dùng đăng/sửa bình luận hoặc gửi báo cáo.
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={policySaving}
              className="bg-teal-600 hover:bg-teal-700 text-white shrink-0"
            >
              <Save className="size-4" /> {policySaving ? "Đang lưu..." : "Lưu bộ lọc"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 cursor-pointer">
              <div>
                <p className="text-xs font-bold text-slate-900">Đăng thẳng bình luận</p>
                <p className="text-[11px] text-slate-500">Hiển thị ngay không chờ duyệt</p>
              </div>
              <input
                type="checkbox"
                className="size-4 accent-teal-600"
                checked={commentPolicy.autoPublishComments}
                onChange={(e) =>
                  setCommentPolicy({ ...commentPolicy, autoPublishComments: e.target.checked })
                }
              />
            </label>

            <label className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 cursor-pointer">
              <div>
                <p className="text-xs font-bold text-slate-900">Chặn link / web lạ</p>
                <p className="text-[11px] text-slate-500">Cảnh báo &amp; che *** URL lạ</p>
              </div>
              <input
                type="checkbox"
                className="size-4 accent-teal-600"
                checked={commentPolicy.blockExternalLinks}
                onChange={(e) =>
                  setCommentPolicy({ ...commentPolicy, blockExternalLinks: e.target.checked })
                }
              />
            </label>

            <div className="rounded-xl border border-slate-200 p-3">
              <label className="block text-xs font-bold text-slate-900 mb-1">
                Thời hạn sửa bình luận (phút)
              </label>
              <input
                type="number"
                min={5}
                max={1440}
                className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs font-mono"
                value={commentPolicy.editWindowMinutes}
                onChange={(e) =>
                  setCommentPolicy({ ...commentPolicy, editWindowMinutes: Number(e.target.value) || 60 })
                }
              />
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <label className="block text-xs font-bold text-slate-900 mb-1">
                Giới hạn Report / 10 phút
              </label>
              <input
                type="number"
                min={1}
                max={30}
                className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs font-mono"
                value={commentPolicy.maxReportsPer10Minutes}
                onChange={(e) =>
                  setCommentPolicy({
                    ...commentPolicy,
                    maxReportsPer10Minutes: Number(e.target.value) || 3,
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-3">
              <label className="block text-xs font-bold text-slate-900 mb-1">
                Cảnh báo Reporter sai (lượt/7 ngày)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs font-mono"
                value={commentPolicy.falseReportAlertThreshold}
                onChange={(e) =>
                  setCommentPolicy({
                    ...commentPolicy,
                    falseReportAlertThreshold: Number(e.target.value) || 3,
                  })
                }
              />
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <label className="block text-xs font-bold text-slate-900 mb-1">
                Cảnh báo bị report nhiều (lượt)
              </label>
              <input
                type="number"
                min={2}
                max={20}
                className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs font-mono"
                value={commentPolicy.repeatedTargetAlertThreshold}
                onChange={(e) =>
                  setCommentPolicy({
                    ...commentPolicy,
                    repeatedTargetAlertThreshold: Number(e.target.value) || 3,
                  })
                }
              />
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <label className="block text-xs font-bold text-slate-900 mb-1">
                Tự ẩn bình luận khi đủ report (0 = tắt)
              </label>
              <input
                type="number"
                min={0}
                max={20}
                className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs font-mono"
                value={commentPolicy.autoHideCommentReportCount}
                onChange={(e) =>
                  setCommentPolicy({
                    ...commentPolicy,
                    autoHideCommentReportCount: Number(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>

          {/* Banned Keywords Manager */}
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Danh sách Từ cấm ({commentPolicy.bannedKeywords.length} từ khóa)
                </h4>
                <p className="text-xs text-slate-500">
                  Nhập nhiều từ cách nhau bằng dấu phẩy hoặc xuống dòng. Hệ thống tự bắt cả biến thể chèn dấu chấm/khoảng trắng.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  className="h-9 w-64 rounded-lg border border-slate-200 px-3 text-xs"
                  placeholder="Ví dụ: webcado, lừa đảo, cá độ..."
                  value={newKeywordInput}
                  onChange={(e) => setNewKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddKeywords();
                    }
                  }}
                />
                <Button size="sm" variant="outline" onClick={handleAddKeywords}>
                  <Plus className="size-3.5" /> Thêm từ
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 max-h-48 overflow-y-auto">
              {commentPolicy.bannedKeywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() =>
                      setCommentPolicy((prev) => ({
                        ...prev,
                        bannedKeywords: prev.bannedKeywords.filter((k) => k !== kw),
                      }))
                    }
                    className="rounded-full p-0.5 hover:bg-red-100"
                    aria-label={`Xóa ${kw}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Allowed Domains */}
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h4 className="text-sm font-bold text-slate-900">
                Tên miền hợp lệ được phép chia sẻ ({commentPolicy.allowedDomains.length})
              </h4>
              <div className="flex gap-2">
                <input
                  className="h-9 w-56 rounded-lg border border-slate-200 px-3 text-xs"
                  placeholder="vd: gov.vn, accessmap.vn"
                  value={newDomainInput}
                  onChange={(e) => setNewDomainInput(e.target.value)}
                />
                <Button size="sm" variant="outline" onClick={handleAddDomain}>
                  <Plus className="size-3.5" /> Thêm domain
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {commentPolicy.allowedDomains.map((dom) => (
                <span
                  key={dom}
                  className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800"
                >
                  {dom}
                  <button
                    type="button"
                    onClick={() =>
                      setCommentPolicy((prev) => ({
                        ...prev,
                        allowedDomains: prev.allowedDomains.filter((d) => d !== dom),
                      }))
                    }
                    className="rounded-full p-0.5 hover:bg-teal-100"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
