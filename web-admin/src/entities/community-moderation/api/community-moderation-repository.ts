"use client";

import { apiRequest, type ApiResponse } from "@/shared/api/api-client";
import type {
  AdminQueueQuery,
  AdminQueueResponse,
  AdminReportedCommentItem,
  AdminUserActivity360,
  AdminUserModerationCase,
  CommentModerationInput,
  CommentModerationPolicy,
  CommunityCommentQueueItem,
  DisputeDecisionInput,
  DisputeDetail,
  DisputeQueueItem,
  EvidenceAccess,
  MetadataCorrectionInput,
  ReportDetail,
  ReportQueueItem,
  ReportTransitionInput,
} from "../model/types";

function queryString(query: AdminQueueQuery & { onlyFlagged?: boolean } = {}) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status && query.status !== "All") params.set("status", query.status);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.onlyFlagged) params.set("onlyFlagged", "true");
  const value = params.toString();
  return value ? `?${value}` : "";
}

function normalizeQueue<T>(payload: AdminQueueResponse<T> | T[], query: AdminQueueQuery) {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      total: payload.length,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? Math.max(payload.length, 1),
      totalPages: 1,
    } satisfies AdminQueueResponse<T>;
  }

  const pageSize = payload.pageSize || query.pageSize || 20;
  return {
    ...payload,
    items: payload.items ?? [],
    total: payload.total ?? payload.items?.length ?? 0,
    page: payload.page || query.page || 1,
    pageSize,
    totalPages:
      payload.totalPages ||
      Math.max(1, Math.ceil((payload.total ?? payload.items?.length ?? 0) / pageSize)),
  };
}

function isRouteUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  const status = (err as { status: number }).status;
  return status === 404 || status === 405;
}

function normalizeReportSummary(raw: unknown): ReportQueueItem {
  if (raw && typeof raw === "object" && "report" in raw && raw.report && typeof raw.report === "object") {
    const rec = raw as Record<string, unknown>;
    const r = raw.report as Record<string, unknown>;
    return {
      id: String(r.reportId ?? ""),
      locationId: String(r.locationId ?? ""),
      locationName: r.locationName ? String(r.locationName) : undefined,
      featureType: r.featureType as ReportQueueItem["featureType"],
      observedFeatureVersion:
        typeof rec.observedFeatureVersion === "number" ? rec.observedFeatureVersion : undefined,
      reason: (rec.reason as ReportQueueItem["reason"]) ?? "Other",
      description: String(rec.description ?? ""),
      status: (r.status as ReportQueueItem["status"]) ?? "Submitted",
      isStaleBaseline: Boolean(rec.isStaleBaseline),
      createdAt: String(r.createdAt ?? new Date().toISOString()),
      updatedAt: r.updatedAt ? String(r.updatedAt) : undefined,
    };
  }
  return raw as ReportQueueItem;
}

function normalizeReportDetail(raw: unknown): ReportDetail {
  const outerRec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const outer =
    outerRec?.report &&
    typeof outerRec.report === "object" &&
    "report" in (outerRec.report as Record<string, unknown>)
      ? (outerRec.report as Record<string, unknown>)
      : null;
  if (!outer || !outerRec) return raw as ReportDetail;
  const base = normalizeReportSummary(outer);
  const innerReport = outer.report as Record<string, unknown>;
  const proposedPos = outerRec.proposedPosition as { latitude?: number; longitude?: number } | undefined;
  const rawEvidence = Array.isArray(outerRec.evidence)
    ? (outerRec.evidence as Array<Record<string, unknown>>)
    : [];
  const rawHistory = Array.isArray(outerRec.history)
    ? (outerRec.history as Array<Record<string, unknown>>)
    : [];
  return {
    ...base,
    description: String(outerRec.description ?? base.description ?? ""),
    proposedAddress:
      typeof outerRec.proposedAddress === "string" ? outerRec.proposedAddress : undefined,
    proposedLatitude: proposedPos?.latitude,
    proposedLongitude: proposedPos?.longitude,
    linkedSubmissionId:
      typeof outerRec.linkedSubmissionId === "string" ? outerRec.linkedSubmissionId : undefined,
    evidence: rawEvidence.map((e) => ({
      id: String(e.evidenceId ?? e.id ?? ""),
      description: typeof e.description === "string" ? e.description : undefined,
      createdAt: String(e.createdAt ?? base.createdAt),
    })),
    history: rawHistory.map((h) => ({
      id: String(h.decisionId ?? h.id ?? ""),
      fromStatus: h.fromStatus as ReportDetail["status"] | undefined,
      toStatus: (h.toStatus as ReportDetail["status"]) ?? base.status,
      reason: String(h.reason ?? ""),
      outcome:
        typeof h.verificationOutcome === "string"
          ? h.verificationOutcome
          : typeof h.findingType === "string"
            ? h.findingType
            : undefined,
      occurredAt: String(h.occurredAt ?? base.createdAt),
    })),
    version: Number(innerReport.version ?? 1),
  };
}

export const communityModerationRepository = {
  async getDisputes(query: AdminQueueQuery = {}, signal?: AbortSignal) {
    const response = await apiRequest<AdminQueueResponse<DisputeQueueItem> | DisputeQueueItem[]>(
      `/api/v1/admin/community-disputes${queryString(query)}`,
      { signal },
    );
    return normalizeQueue(response.data, query);
  },

  getDispute(id: string, signal?: AbortSignal) {
    return apiRequest<DisputeDetail>(
      `/api/v1/admin/community-disputes/${encodeURIComponent(id)}`,
      { signal },
    );
  },

  decideDispute(
    id: string,
    input: DisputeDecisionInput,
    etag: string,
    idempotencyKey = crypto.randomUUID(),
  ) {
    return apiRequest<DisputeDetail>(
      `/api/v1/admin/community-disputes/${encodeURIComponent(id)}`,
      { method: "PATCH", body: input, etag, idempotencyKey },
    );
  },

  createDisputeOverride(
    input: {
      locationFeatureId: string;
      observedFeatureVersion: number;
      reason: string;
      evidenceSubmissionId?: string;
      reportId?: string;
    },
    idempotencyKey = crypto.randomUUID(),
  ) {
    const body = {
      locationFeatureId: input.locationFeatureId.trim(),
      observedFeatureVersion: input.observedFeatureVersion,
      reason: input.reason.trim(),
      ...(input.evidenceSubmissionId?.trim()
        ? { evidenceSubmissionId: input.evidenceSubmissionId.trim() }
        : {}),
      ...(input.reportId?.trim() ? { reportId: input.reportId.trim() } : {}),
    };
    return apiRequest<DisputeDetail>(`/api/v1/admin/community-disputes`, {
      method: "POST",
      body,
      idempotencyKey,
    });
  },

  async getReports(query: AdminQueueQuery = {}, signal?: AbortSignal) {
    const response = await apiRequest<AdminQueueResponse<ReportQueueItem> | ReportQueueItem[]>(
      `/api/v1/admin/reports${queryString(query)}`,
      { signal },
    );
    const normalized = normalizeQueue(response.data, query);
    return {
      ...normalized,
      items: normalized.items.map((item) => normalizeReportSummary(item)),
    };
  },

  async getReport(id: string, signal?: AbortSignal) {
    const response = await apiRequest<ReportDetail>(
      `/api/v1/admin/reports/${encodeURIComponent(id)}`,
      { signal },
    );
    return {
      ...response,
      data: normalizeReportDetail(response.data),
    };
  },

  async getEvidenceAccess(reportId: string, evidenceId: string) {
    try {
      return await apiRequest<EvidenceAccess>(
        `/api/v1/admin/reports/${encodeURIComponent(reportId)}/evidence/${encodeURIComponent(evidenceId)}/access`,
      );
    } catch (err: unknown) {
      if (!isRouteUnavailable(err)) throw err;
      const res = await apiRequest<{ mediaId?: string; url?: string; expiresAt?: string }>(
        `/api/v1/admin/reports/${encodeURIComponent(reportId)}/media/${encodeURIComponent(evidenceId)}`,
      );
      return {
        ...res,
        data: {
          evidenceId: String(res.data?.mediaId ?? evidenceId),
          accessUrl: String(res.data?.url ?? ""),
          contentType: "image/jpeg",
          expiresAt: String(res.data?.expiresAt ?? new Date(Date.now() + 300_000).toISOString()),
        },
      };
    }
  },

  transitionReport(
    id: string,
    input: ReportTransitionInput,
    etag: string,
    idempotencyKey = crypto.randomUUID(),
  ) {
    return apiRequest<ReportDetail>(`/api/v1/admin/reports/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
      etag,
      idempotencyKey,
    });
  },

  correctMetadata(
    locationId: string,
    input: MetadataCorrectionInput,
    etag: string,
    idempotencyKey = crypto.randomUUID(),
  ) {
    return apiRequest<{
      reportId: string;
      status: string;
      version: number;
      locationMetadataVersion: number;
      updatedAt: string;
    }>(
      `/api/v1/admin/locations/${encodeURIComponent(locationId)}/metadata`,
      { method: "PATCH", body: input, etag, idempotencyKey },
    );
  },

  async getComments(query: AdminQueueQuery & { onlyFlagged?: boolean } = {}, signal?: AbortSignal) {
    try {
      const response = await apiRequest<
        AdminQueueResponse<Record<string, unknown>> | Array<Record<string, unknown>>
      >(`/api/v1/admin/comments${queryString(query)}`, { signal });
      const normalized = normalizeQueue(response.data, query);
      return {
        ...normalized,
        items: normalized.items.map((raw): CommunityCommentQueueItem => ({
          id: String(raw.id ?? ""),
          locationId: String(raw.locationId ?? raw.placeId ?? ""),
          locationName: raw.locationName
            ? String(raw.locationName)
            : raw.placeName
              ? String(raw.placeName)
              : undefined,
          userId: raw.userId ? String(raw.userId) : undefined,
          authorDisplayName: raw.authorDisplayName ? String(raw.authorDisplayName) : undefined,
          authorTier: raw.authorTier ? String(raw.authorTier) : undefined,
          body: String(raw.body ?? raw.content ?? ""),
          uncensoredBody: raw.uncensoredBody ? String(raw.uncensoredBody) : undefined,
          matchedBannedTerms: Array.isArray(raw.matchedBannedTerms)
            ? raw.matchedBannedTerms.map(String)
            : undefined,
          wasCensored: Boolean(raw.wasCensored),
          reportCount: typeof raw.reportCount === "number" ? raw.reportCount : 0,
          status: (raw.status === "Visible" ? "Approved" : String(raw.status ?? "PendingReview")) as CommunityCommentQueueItem["status"],
          createdAt: String(raw.createdAt ?? new Date().toISOString()),
          version: typeof raw.version === "number" ? raw.version : 1,
        })),
      };
    } catch (err: unknown) {
      if (!isRouteUnavailable(err)) throw err;
      return normalizeQueue<CommunityCommentQueueItem>([], query);
    }
  },

  moderateComment(
    locationId: string,
    commentId: string,
    input: CommentModerationInput,
    etag: string,
    idempotencyKey = crypto.randomUUID(),
  ): Promise<ApiResponse<CommunityCommentQueueItem>> {
    return apiRequest<CommunityCommentQueueItem>(
      `/api/v1/admin/locations/${encodeURIComponent(locationId)}/comments/${encodeURIComponent(commentId)}/moderation`,
      { method: "POST", body: input, etag, idempotencyKey },
    );
  },

  getCommentPolicy(signal?: AbortSignal) {
    return apiRequest<CommentModerationPolicy>(`/api/v1/admin/settings/comment-moderation`, { signal });
  },

  saveCommentPolicy(input: CommentModerationPolicy) {
    return apiRequest<CommentModerationPolicy>(`/api/v1/admin/settings/comment-moderation`, {
      method: "PUT",
      body: input,
    });
  },

  async getUserModerationCases(
    query: AdminQueueQuery & { caseType?: string } = {},
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams();
    if (query.status && query.status !== "All") params.set("status", query.status);
    if (query.caseType && query.caseType !== "All") params.set("caseType", query.caseType);
    if (query.search) params.set("search", query.search);
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString() ? `?${params.toString()}` : "";
    const response = await apiRequest<AdminQueueResponse<AdminUserModerationCase>>(
      `/api/v1/admin/user-moderation/cases${qs}`,
      { signal },
    );
    return normalizeQueue(response.data, query);
  },

  getUserActivity360(userId: string, signal?: AbortSignal) {
    return apiRequest<AdminUserActivity360>(
      `/api/v1/admin/user-moderation/users/${encodeURIComponent(userId)}/activity`,
      { signal },
    );
  },

  resolveUserModerationCase(
    caseId: string,
    input: {
      action: "Dismiss" | "WarnOnly" | "PenalizeStanding" | "SuspendAccount";
      reason: string;
      standingPenalty?: number;
      hideComment?: boolean;
    },
  ) {
    return apiRequest<{ caseId: string; status: string; code: string }>(
      `/api/v1/admin/user-moderation/cases/${encodeURIComponent(caseId)}/resolve`,
      { method: "POST", body: input },
    );
  },

  async getReportedComments(
    query: { status?: string; search?: string; page?: number; pageSize?: number } = {},
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams();
    if (query.status && query.status !== "All") params.set("status", query.status);
    if (query.search) params.set("search", query.search);
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString() ? `?${params.toString()}` : "";
    const response = await apiRequest<AdminQueueResponse<AdminReportedCommentItem>>(
      `/api/v1/admin/comments/reports${qs}`,
      { signal },
    );
    return normalizeQueue(response.data, query);
  },
};
