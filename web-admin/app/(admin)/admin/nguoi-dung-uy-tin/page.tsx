"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Award,
  CheckCircle2,
  ClockAlert,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trophy,
  UserCheck,
  UserX,
  UsersRound,
  Vote,
} from "lucide-react";
import { ApiError, apiRequest } from "@/shared/api/api-client";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { Skeleton } from "@/shared/ui/skeleton";

type ActiveTab = "users" | "events" | "votes";

interface ContractBUserItem {
  userId: string;
  name: string;
  email: string;
  phoneNumber?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  status: "Active" | "Disabled" | string;
  profileVersion: number;
  createdAt: string;
  accountStandingScore: number;
  contributionAccuracyRate?: number | null;
  reputationPoints: number;
}

interface LegacyUserItem {
  id: string;
  displayName: string;
  role: string;
  isActive: boolean;
  reputationScore: number;
  reputationTier: string;
  expPoints: number;
  contributionsCount: number;
  reportsCount: number;
}

interface UnifiedAdminUser {
  id: string;
  name: string;
  email: string;
  status: string;
  profileVersion: number;
  accountStandingScore: number;
  contributionAccuracyRate: number | null;
  reputationPoints: number;
  tierLabel: string;
  isLegacy: boolean;
}

interface LeaderboardEntry {
  rank: number;
  rankBadge?: string | null;
  userId: string;
  displayName: string;
  reputationScore: number;
  reputationTier: string;
  expPoints: number;
  contributionsCount: number;
}

interface LeaderboardResponse {
  items: LeaderboardEntry[];
  totalContributors: number;
}

interface EvidenceRefItem {
  sourceType: string;
  sourceId: string;
}

interface HeldContributionEventItem {
  eventId: string;
  subjectUserId: string;
  type: string;
  status: string;
  version: number;
  sourceDecisionVersion: number;
  policyVersion: string;
  holdReasonCode?: string | null;
  heldAt?: string | null;
  reviewDueAt?: string | null;
  overdue: boolean;
  evidenceRefs: EvidenceRefItem[];
}

interface HeldContributionEventPage {
  items: HeldContributionEventItem[];
  nextCursor?: string | null;
}

interface HeldCommunityVoteItem {
  voteId: string;
  voterId: string;
  locationId: string;
  scopeId: string;
  locationFeatureId: string;
  featureType: string;
  voteType: string;
  proposedStatus?: string | null;
  comment?: string | null;
  status: string;
  version: number;
  createdAt: string;
  holdReasonCode: string;
}

interface HeldCommunityVotePage {
  items: HeldCommunityVoteItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

function tierFromPoints(points: number): string {
  if (points >= 500) return "Hạng Vàng";
  if (points >= 200) return "Trusted";
  if (points >= 50) return "Hạng Đồng";
  return "Baseline";
}

function tierBadgeVariant(tier: string): "amber" | "teal" | "blue" | "neutral" {
  const lower = tier.toLowerCase();
  if (lower.includes("vàng")) return "amber";
  if (lower.includes("trusted")) return "teal";
  if (lower.includes("đồng")) return "blue";
  return "neutral";
}

function formatAccuracy(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "Chưa đánh giá";
  const pct = rate <= 1 ? rate * 100 : rate;
  return `${pct.toFixed(1)}%`;
}

export default function AdminUsersReputationPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("users");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [users, setUsers] = useState<UnifiedAdminUser[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [statusTarget, setStatusTarget] = useState<UnifiedAdminUser | null>(null);
  const [statusReason, setStatusReason] = useState("");

  const [selectedUser, setSelectedUser] = useState<UnifiedAdminUser | null>(null);
  const [adjustAction, setAdjustAction] = useState<"ConfirmViolation" | "ReverseStandingEffect" | "RevokeReward" | "RestoreReward">("ConfirmViolation");
  const [scoreType, setScoreType] = useState<"AccountStanding" | "ReputationPoints">("AccountStanding");
  const [sourceEventId, setSourceEventId] = useState("");
  const [originalHistoryEntryId, setOriginalHistoryEntryId] = useState("");
  const [expectedVersion, setExpectedVersion] = useState("1");
  const [amount, setAmount] = useState("10");
  const [violationCategory, setViolationCategory] = useState("AttributableFalseSubmission");
  const [evidenceSourceType, setEvidenceSourceType] = useState("Submission");
  const [evidenceSourceId, setEvidenceSourceId] = useState("");
  const [legacyDelta, setLegacyDelta] = useState("5");
  const [reason, setReason] = useState("");
  const [useLegacyMode, setUseLegacyMode] = useState(false);

  const [heldEvents, setHeldEvents] = useState<HeldContributionEventItem[]>([]);
  const [eventsNextCursor, setEventsNextCursor] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<HeldContributionEventItem | null>(null);
  const [eventDecision, setEventDecision] = useState<"Release" | "Cancel">("Release");
  const [eventReason, setEventReason] = useState("");

  const [heldVotes, setHeldVotes] = useState<HeldCommunityVoteItem[]>([]);
  const [votePage, setVotePage] = useState(1);
  const [voteHasMore, setVoteHasMore] = useState(false);
  const [selectedVote, setSelectedVote] = useState<HeldCommunityVoteItem | null>(null);
  const [voteDecision, setVoteDecision] = useState<"Accept" | "Reject">("Accept");
  const [voteReason, setVoteReason] = useState("");

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const triggerReload = useCallback(() => {
    setIsLoading(true);
    setReloadToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchTabData() {
      setIsLoading(true);
      try {
        if (activeTab === "users") {
          const params = new URLSearchParams({ limit: "20" });
          if (search.trim()) params.set("q", search.trim());
          if (statusFilter !== "ALL") params.set("status", statusFilter);
          if (cursor) params.set("cursor", cursor);

          const [usersRes, lbRes] = await Promise.all([
            apiRequest<Record<string, unknown>>(`/api/v1/admin/users?${params.toString()}`),
            apiRequest<LeaderboardResponse>("/api/v1/admin/users/leaderboard?limit=10")
              .catch(() => apiRequest<LeaderboardResponse>("/api/v1/leaderboard?limit=10"))
              .catch(() => ({ data: { items: [], totalContributors: 0 } })),
          ]);

          if (cancelled) return;

          const rawItems = Array.isArray(usersRes.data.items) ? usersRes.data.items : [];
          const normalized: UnifiedAdminUser[] = rawItems.map((rawItem) => {
            const item = rawItem as Record<string, unknown>;
            if (typeof item.userId === "string") {
              const b = item as unknown as ContractBUserItem;
              return {
                id: b.userId,
                name: b.name,
                email: b.email,
                status: b.status,
                profileVersion: b.profileVersion ?? 1,
                accountStandingScore: b.accountStandingScore ?? 100,
                contributionAccuracyRate: b.contributionAccuracyRate ?? null,
                reputationPoints: b.reputationPoints ?? 0,
                tierLabel: tierFromPoints(b.reputationPoints ?? 0),
                isLegacy: false,
              };
            }
            const l = item as unknown as LegacyUserItem;
            return {
              id: l.id,
              name: l.displayName,
              email: l.role,
              status: l.isActive ? "Active" : "Disabled",
              profileVersion: 1,
              accountStandingScore: 100,
              contributionAccuracyRate: null,
              reputationPoints: l.reputationScore ?? 0,
              tierLabel: l.reputationTier || "Baseline",
              isLegacy: true,
            };
          });

          setUsers(normalized);
          setNextCursor(typeof usersRes.data.nextCursor === "string" ? usersRes.data.nextCursor : null);
          setLeaderboard(lbRes.data.items ?? []);
          setError(null);
        } else if (activeTab === "events") {
          const params = new URLSearchParams({ status: "HeldForReview", limit: "20" });
          const res = await apiRequest<HeldContributionEventPage>(`/api/v1/admin/contribution-events?${params.toString()}`);
          if (!cancelled) {
            setHeldEvents(res.data.items ?? []);
            setEventsNextCursor(res.data.nextCursor ?? null);
            setError(null);
          }
        } else {
          const res = await apiRequest<HeldCommunityVotePage>(
            `/api/v1/admin/community-votes?page=${votePage}&pageSize=20`,
          );
          if (!cancelled) {
            setHeldVotes(res.data.items ?? []);
            setVoteHasMore(Boolean(res.data.hasMore));
            setError(null);
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu quản trị uy tín.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchTabData();
    return () => {
      cancelled = true;
    };
  }, [activeTab, search, statusFilter, cursor, votePage, reloadToken]);

  async function handleStatusToggleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!statusTarget) return;
    setActionError(null);
    setActionSuccess(null);

    if (statusReason.trim().length < 10) {
      setActionError("Lý do thay đổi trạng thái tài khoản phải dài tối thiểu 10 ký tự.");
      return;
    }

    const nextStatus = statusTarget.status === "Active" ? "Disabled" : "Active";
    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ userId: string; status: string; profileVersion: number }>(
        `/api/v1/admin/users/${encodeURIComponent(statusTarget.id)}/status`,
        {
          method: "PATCH",
          body: {
            status: nextStatus,
            reason: statusReason.trim(),
            expectedProfileVersion: statusTarget.profileVersion,
          },
        },
      );
      setActionSuccess(
        `Đã chuyển trạng thái tài khoản ${statusTarget.name} sang ${res.data.status} (phiên bản hồ sơ v${res.data.profileVersion}).`,
      );
      setStatusTarget(null);
      setStatusReason("");
      triggerReload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không thể cập nhật trạng thái tài khoản.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAdjustSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedUser) return;

    setActionError(null);
    setActionSuccess(null);

    if (useLegacyMode || selectedUser.isLegacy) {
      const parsedDelta = Number(legacyDelta);
      if (!Number.isFinite(parsedDelta) || parsedDelta === 0) {
        setActionError("Vui lòng nhập mức điểm điều chỉnh khác 0 (trong khoảng ±100).");
        return;
      }
      setIsSubmitting(true);
      try {
        await apiRequest(`/api/v1/admin/users/${selectedUser.id}/reputation-adjustments`, {
          method: "POST",
          body: { delta: parsedDelta, reason: reason.trim() },
        });
        setActionSuccess(`Đã điều chỉnh điểm uy tín cho ${selectedUser.name}.`);
        setSelectedUser(null);
        setReason("");
        triggerReload();
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : "Không thể điều chỉnh điểm.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (reason.trim().length < 10) {
      setActionError("Lý do điều chỉnh theo quy trình WF-04 phải có ít nhất 10 ký tự.");
      return;
    }

    const bodyPayload: Record<string, unknown> = {
      userId: selectedUser.id,
      scoreType: adjustAction === "ConfirmViolation" || adjustAction === "ReverseStandingEffect" ? "AccountStanding" : scoreType,
      action: adjustAction,
      expectedVersion: Math.max(1, Number(expectedVersion) || 1),
      reason: reason.trim(),
    };
    if (sourceEventId.trim()) bodyPayload.sourceEventId = sourceEventId.trim();
    if (originalHistoryEntryId.trim()) bodyPayload.originalHistoryEntryId = originalHistoryEntryId.trim();
    if (adjustAction === "RevokeReward" || adjustAction === "RestoreReward") {
      bodyPayload.amount = Math.max(1, Number(amount) || 1);
    }
    if (adjustAction === "ConfirmViolation") {
      bodyPayload.confirmedViolationCategory = violationCategory;
      if (evidenceSourceId.trim()) {
        bodyPayload.evidenceRefs = [{ sourceType: evidenceSourceType, sourceId: evidenceSourceId.trim() }];
      }
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ eventId: string; status: string }>(
        "/api/v1/admin/reputation-adjustments",
        { method: "POST", body: bodyPayload },
      );
      setActionSuccess(`Đã tiếp nhận yêu cầu điều chỉnh WF-04 (Event ${res.data.eventId}, trạng thái ${res.data.status}).`);
      setSelectedUser(null);
      setReason("");
      triggerReload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setActionError("Bị từ chối (403): Quản trị viên không được tự điều chỉnh hoặc có xung đột lợi ích với hồ sơ nguồn.");
      } else {
        setActionError(cause instanceof Error ? cause.message : "Không thể gửi yêu cầu điều chỉnh WF-04.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReviewEventSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedEvent) return;
    setActionError(null);
    setActionSuccess(null);

    if (eventReason.trim().length < 10) {
      setActionError("Lý do duyệt sự kiện đóng góp phải dài tối thiểu 10 ký tự.");
      return;
    }

    const refs =
      selectedEvent.evidenceRefs.length > 0
        ? selectedEvent.evidenceRefs
        : [{ sourceType: "ContributionEvent", sourceId: selectedEvent.eventId }];

    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ eventId: string; status: string }>(
        `/api/v1/admin/contribution-events/${encodeURIComponent(selectedEvent.eventId)}/review`,
        {
          method: "POST",
          body: {
            decision: eventDecision,
            expectedVersion: selectedEvent.version,
            reason: eventReason.trim(),
            evidenceRefs: refs,
          },
        },
      );
      setActionSuccess(`Đã xử lý sự kiện ${res.data.eventId} (${res.data.status}).`);
      setSelectedEvent(null);
      setEventReason("");
      triggerReload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không thể duyệt sự kiện đóng góp.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleValidateVoteSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedVote) return;
    setActionError(null);
    setActionSuccess(null);

    if (voteReason.trim().length < 10) {
      setActionError("Lý do kiểm duyệt phiếu bầu phải dài tối thiểu 10 ký tự.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest(
        `/api/v1/admin/community-votes/${encodeURIComponent(selectedVote.voteId)}/validation`,
        {
          method: "POST",
          etag: `"${selectedVote.version}"`,
          body: {
            decision: voteDecision,
            reason: voteReason.trim(),
          },
        },
      );
      setActionSuccess(`Đã ${voteDecision === "Accept" ? "chấp nhận" : "từ chối"} phiếu bầu ${selectedVote.voteId.slice(0, 8)}.`);
      setSelectedVote(null);
      setVoteReason("");
      triggerReload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không thể xác nhận phiếu bầu cộng đồng.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-teal-700">Nền tảng · Quản trị thành viên & WF-04</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold text-slate-950">
            <UsersRound className="size-6 text-teal-700" />
            Người dùng & Uy tín đóng góp
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Quản lý 3 chỉ số độc lập WF-04 (Điểm chấp hành · Độ chính xác đóng góp · Điểm xếp hạng), sự kiện giữ chờ và phiếu bầu cộng đồng.
          </p>
        </div>
        <Button variant="outline" onClick={triggerReload} disabled={isLoading}>
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <Button
          variant={activeTab === "users" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setActiveTab("users");
            setActionError(null);
            setActionSuccess(null);
          }}
        >
          <UsersRound className="size-4" />
          Tài khoản & 3 chỉ số WF-04
        </Button>
        <Button
          variant={activeTab === "events" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setActiveTab("events");
            setActionError(null);
            setActionSuccess(null);
          }}
        >
          <ClockAlert className="size-4" />
          Sự kiện đóng góp chờ duyệt
        </Button>
        <Button
          variant={activeTab === "votes" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setActiveTab("votes");
            setActionError(null);
            setActionSuccess(null);
          }}
        >
          <Vote className="size-4" />
          Phiếu bầu cộng đồng tạm giữ
        </Button>
      </div>

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

      {activeTab === "users" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Danh sách tài khoản ({users.length})</CardTitle>
                <CardDescription>Hiển thị 3 chỉ số WF-04 tách biệt và kiểm soát trạng thái tài khoản</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setCursor(null);
                      setCursorHistory([]);
                    }}
                    placeholder="Tìm tên, email hoặc SĐT..."
                    className="h-9 w-56 rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-teal-500"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setCursor(null);
                    setCursorHistory([]);
                  }}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500"
                >
                  <option value="ALL">Tất cả trạng thái</option>
                  <option value="Active">Đang hoạt động (Active)</option>
                  <option value="Disabled">Đã vô hiệu (Disabled)</option>
                </select>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : error ? (
                <EmptyState title="Không tải được danh sách" description={error} />
              ) : users.length === 0 ? (
                <EmptyState title="Chưa có tài khoản phù hợp" description="Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc trạng thái." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                        <th className="py-2.5 pr-3">Thành viên</th>
                        <th className="py-2.5 px-3">Trạng thái</th>
                        <th className="py-2.5 px-3 text-right">Điểm chấp hành</th>
                        <th className="py-2.5 px-3 text-right">Độ chính xác</th>
                        <th className="py-2.5 px-3 text-right">Điểm xếp hạng</th>
                        <th className="py-2.5 pl-3 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {users.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50/70">
                          <td className="py-3 pr-3">
                            <div className="font-semibold text-slate-900">{u.name}</div>
                            <div className="text-xs text-slate-500">{u.email}</div>
                            <div className="font-mono text-[11px] text-slate-400">{u.id}</div>
                          </td>
                          <td className="py-3 px-3">
                            <Badge variant={u.status === "Active" ? "teal" : "red"}>{u.status}</Badge>
                          </td>
                          <td className="py-3 px-3 text-right font-semibold text-slate-800">
                            {u.accountStandingScore}/100
                          </td>
                          <td className="py-3 px-3 text-right text-slate-700">
                            {formatAccuracy(u.contributionAccuracyRate)}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="font-bold text-slate-900">{u.reputationPoints}</div>
                            <Badge variant={tierBadgeVariant(u.tierLabel)}>{u.tierLabel}</Badge>
                          </td>
                          <td className="py-3 pl-3 text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setStatusTarget(u);
                                  setSelectedUser(null);
                                  setActionError(null);
                                  setActionSuccess(null);
                                }}
                              >
                                {u.status === "Active" ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
                                {u.status === "Active" ? "Khóa" : "Mở"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedUser(u);
                                  setStatusTarget(null);
                                  setUseLegacyMode(u.isLegacy);
                                  setActionError(null);
                                  setActionSuccess(null);
                                }}
                              >
                                Điều chỉnh WF-04
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(cursorHistory.length > 0 || nextCursor) && (
                <div className="flex items-center justify-between border-t border-slate-100 pt-3">
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
                    Trang trước
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
                    Trang sau
                  </Button>
                </div>
              )}

              {statusTarget && (
                <form onSubmit={handleStatusToggleSubmit} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">
                      {statusTarget.status === "Active" ? "Vô hiệu hóa tài khoản" : "Kích hoạt lại tài khoản"}: {statusTarget.name} (v{statusTarget.profileVersion})
                    </h3>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setStatusTarget(null)}>
                      Đóng
                    </Button>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Lý do bắt buộc (tối thiểu 10 ký tự)</label>
                    <input
                      value={statusReason}
                      onChange={(e) => setStatusReason(e.target.value)}
                      placeholder="VD: Tài khoản vi phạm nghiêm trọng chính sách cộng đồng hoặc xác minh mở lại..."
                      required
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setStatusTarget(null)}>
                      Hủy
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? "Đang lưu..." : "Xác nhận đổi trạng thái"}
                    </Button>
                  </div>
                </form>
              )}

              {selectedUser && (
                <form onSubmit={handleAdjustSubmit} className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      Điều chỉnh WF-04: {selectedUser.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      {!selectedUser.isLegacy && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setUseLegacyMode((v) => !v)}
                        >
                          {useLegacyMode ? "Chuyển sang WF-04 có cấu trúc" : "Chế độ điểm đơn giản (Legacy)"}
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedUser(null)}>
                        Đóng
                      </Button>
                    </div>
                  </div>

                  {useLegacyMode || selectedUser.isLegacy ? (
                    <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Mức cộng/trừ (±100)</label>
                        <input
                          type="number"
                          step="1"
                          min="-100"
                          max="100"
                          value={legacyDelta}
                          onChange={(e) => setLegacyDelta(e.target.value)}
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Lý do bắt buộc</label>
                        <input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="VD: Thẩm định bổ sung ảnh chính xác..."
                          required
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Hành động WF-04</label>
                        <select
                          value={adjustAction}
                          onChange={(e) => setAdjustAction(e.target.value as typeof adjustAction)}
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                        >
                          <option value="ConfirmViolation">ConfirmViolation (Trừ chấp hành)</option>
                          <option value="ReverseStandingEffect">ReverseStandingEffect (Hoàn điểm chấp hành)</option>
                          <option value="RevokeReward">RevokeReward (Thu hồi điểm thưởng)</option>
                          <option value="RestoreReward">RestoreReward (Khôi phục điểm thưởng)</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Loại chỉ số</label>
                        <select
                          value={scoreType}
                          onChange={(e) => setScoreType(e.target.value as typeof scoreType)}
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                        >
                          <option value="AccountStanding">AccountStanding</option>
                          <option value="ReputationPoints">ReputationPoints</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Phiên bản kỳ vọng (ExpectedVersion)</label>
                        <input
                          type="number"
                          min="1"
                          value={expectedVersion}
                          onChange={(e) => setExpectedVersion(e.target.value)}
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">SourceEventId (UUID)</label>
                        <input
                          value={sourceEventId}
                          onChange={(e) => setSourceEventId(e.target.value)}
                          placeholder="UUID sự kiện gốc..."
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-mono"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">OriginalHistoryEntryId (tùy chọn)</label>
                        <input
                          value={originalHistoryEntryId}
                          onChange={(e) => setOriginalHistoryEntryId(e.target.value)}
                          placeholder="UUID bản ghi lịch sử..."
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-mono"
                        />
                      </div>
                      {adjustAction === "ConfirmViolation" ? (
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">Loại vi phạm</label>
                          <select
                            value={violationCategory}
                            onChange={(e) => setViolationCategory(e.target.value)}
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                          >
                            <option value="AttributableFalseSubmission">AttributableFalseSubmission</option>
                            <option value="Fabrication">Fabrication</option>
                            <option value="MaliciousReport">MaliciousReport</option>
                            <option value="SpamAdvertising">SpamAdvertising</option>
                            <option value="HarassmentHate">HarassmentHate</option>
                            <option value="PrivacyThreat">PrivacyThreat</option>
                            <option value="CoordinatedManipulation">CoordinatedManipulation</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                      ) : (adjustAction === "RevokeReward" || adjustAction === "RestoreReward") ? (
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">Số lượng điểm</label>
                          <input
                            type="number"
                            min="1"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                          />
                        </div>
                      ) : null}
                      {adjustAction === "ConfirmViolation" && (
                        <>
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-600">Loại bằng chứng (Evidence SourceType)</label>
                            <input
                              value={evidenceSourceType}
                              onChange={(e) => setEvidenceSourceType(e.target.value)}
                              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-600">ID bằng chứng (Evidence SourceId)</label>
                            <input
                              value={evidenceSourceId}
                              onChange={(e) => setEvidenceSourceId(e.target.value)}
                              placeholder="UUID bằng chứng..."
                              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-mono"
                            />
                          </div>
                        </>
                      )}
                      <div className="sm:col-span-2 lg:col-span-3">
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Lý do điều chỉnh (10–1500 ký tự)</label>
                        <input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Mô tả rõ căn cứ và quyết định kiểm duyệt..."
                          required
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setSelectedUser(null)}>
                      Hủy
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? "Đang gửi..." : "Xác nhận điều chỉnh"}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="size-4 text-amber-500" />
                Top 10 Bảng xếp hạng
              </CardTitle>
              <CardDescription>Cập nhật từ điểm đóng góp đã công bố</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {leaderboard.length === 0 ? (
                <p className="text-sm text-slate-500">Chưa có thành viên đủ điều kiện xếp hạng.</p>
              ) : (
                leaderboard.map((entry) => (
                  <div key={entry.userId} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white">
                        {entry.rank}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{entry.displayName}</p>
                        <p className="text-[11px] text-slate-500">
                          {entry.reputationTier} · {entry.contributionsCount} đóng góp
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-sm font-bold text-amber-700">
                      <Award className="size-3.5" />
                      {entry.reputationScore}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "events" && (
        <Card>
          <CardHeader>
            <CardTitle>Sự kiện đóng góp đang tạm giữ ({heldEvents.length})</CardTitle>
            <CardDescription>
              Duyệt phát hành điểm (`Release`) hoặc hủy sự kiện (`Cancel`) với chứng từ đối chiếu bắt buộc
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : error ? (
              <EmptyState title="Không tải được hàng đợi sự kiện" description={error} />
            ) : heldEvents.length === 0 ? (
              <EmptyState title="Không có sự kiện đang giữ chờ" description="Mọi sự kiện đóng góp đã được xử lý xong." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="py-2.5 pr-3">Event ID / Loại</th>
                      <th className="py-2.5 px-3">Subject User</th>
                      <th className="py-2.5 px-3">Lý do giữ</th>
                      <th className="py-2.5 px-3">Hạn xử lý</th>
                      <th className="py-2.5 pl-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {heldEvents.map((ev) => (
                      <tr key={ev.eventId} className="hover:bg-slate-50/70">
                        <td className="py-3 pr-3">
                          <div className="font-semibold text-slate-900">{ev.type}</div>
                          <div className="font-mono text-[11px] text-slate-400">{ev.eventId}</div>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-slate-600">{ev.subjectUserId}</td>
                        <td className="py-3 px-3">
                          <Badge variant="amber">{ev.holdReasonCode || "HeldForReview"}</Badge>
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-xs text-slate-600">{ev.reviewDueAt ? new Date(ev.reviewDueAt).toLocaleString("vi-VN") : "—"}</div>
                          {ev.overdue && <Badge variant="red">Quá hạn</Badge>}
                        </td>
                        <td className="py-3 pl-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedEvent(ev);
                                setEventDecision("Release");
                              }}
                            >
                              <ShieldCheck className="size-3.5" />
                              Release
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedEvent(ev);
                                setEventDecision("Cancel");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {eventsNextCursor && (
              <p className="text-xs text-slate-400">Còn dữ liệu trang kế tiếp (`{eventsNextCursor.slice(0, 12)}...`).</p>
            )}

            {selectedEvent && (
              <form onSubmit={handleReviewEventSubmit} className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    Quyết định {eventDecision} sự kiện {selectedEvent.eventId} (v{selectedEvent.version})
                  </h3>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedEvent(null)}>
                    Đóng
                  </Button>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Lý do kiểm duyệt (10–1500 ký tự)</label>
                  <input
                    value={eventReason}
                    onChange={(e) => setEventReason(e.target.value)}
                    placeholder="Ghi rõ lý do phê duyệt hoặc hủy bỏ sự kiện đóng góp..."
                    required
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setSelectedEvent(null)}>
                    Hủy
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Đang xử lý..." : `Xác nhận ${eventDecision}`}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "votes" && (
        <Card>
          <CardHeader>
            <CardTitle>Phiếu bầu cộng đồng tạm giữ ({heldVotes.length})</CardTitle>
            <CardDescription>
              Xác thực (`Accept`) hoặc từ chối (`Reject`) phiếu bầu cộng đồng kèm khóa lạc quan If-Match
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : error ? (
              <EmptyState title="Không tải được hàng đợi phiếu bầu" description={error} />
            ) : heldVotes.length === 0 ? (
              <EmptyState title="Không có phiếu bầu tạm giữ" description="Chưa có phiếu bầu nào cần xác nhận thủ công." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="py-2.5 pr-3">Tiện ích / Loại phiếu</th>
                      <th className="py-2.5 px-3">Lý do tạm giữ</th>
                      <th className="py-2.5 px-3">Ghi chú</th>
                      <th className="py-2.5 px-3">Phiên bản</th>
                      <th className="py-2.5 pl-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {heldVotes.map((v) => (
                      <tr key={v.voteId} className="hover:bg-slate-50/70">
                        <td className="py-3 pr-3">
                          <div className="font-semibold text-slate-900">
                            {v.featureType} · {v.voteType}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">{v.voteId}</div>
                        </td>
                        <td className="py-3 px-3">
                          <Badge variant="amber">{v.holdReasonCode}</Badge>
                        </td>
                        <td className="py-3 px-3 text-slate-600">{v.comment || "—"}</td>
                        <td className="py-3 px-3 font-mono text-xs text-slate-500">v{v.version}</td>
                        <td className="py-3 pl-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedVote(v);
                                setVoteDecision("Accept");
                              }}
                            >
                              <CheckCircle2 className="size-3.5" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedVote(v);
                                setVoteDecision("Reject");
                              }}
                            >
                              Reject
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(votePage > 1 || voteHasMore) && (
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <Button size="sm" variant="outline" disabled={votePage <= 1} onClick={() => setVotePage((p) => Math.max(1, p - 1))}>
                  Trang trước
                </Button>
                <span className="text-xs text-slate-500">Trang {votePage}</span>
                <Button size="sm" variant="outline" disabled={!voteHasMore} onClick={() => setVotePage((p) => p + 1)}>
                  Trang sau
                </Button>
              </div>
            )}

            {selectedVote && (
              <form onSubmit={handleValidateVoteSubmit} className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    Xác thực phiếu bầu {selectedVote.voteId} ({voteDecision}, ETag v{selectedVote.version})
                  </h3>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedVote(null)}>
                    Đóng
                  </Button>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Lý do kiểm duyệt (10–1500 ký tự)</label>
                  <input
                    value={voteReason}
                    onChange={(e) => setVoteReason(e.target.value)}
                    placeholder="Ghi rõ cơ sở chấp nhận hoặc từ chối phiếu bầu..."
                    required
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setSelectedVote(null)}>
                    Hủy
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Đang lưu..." : `Xác nhận ${voteDecision}`}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
