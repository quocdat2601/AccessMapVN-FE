"use client";

import { apiRequest } from "@/shared/api/api-client";
import type { ContributionRepository } from "./contribution-repository";
import {
  ModerationDecision,
  type AccessibilityCategory,
  type ApproveContributionInput,
  type ContributionDetail,
  type ContributionEvidence,
  type ContributionNavigation,
  type ContributionQueueQuery,
  type ContributionQueueResponse,
  type RequestMoreInfoInput,
  type ReviseClaimAssessmentInput,
} from "../model/types";

const etagBySubmissionId = new Map<string, string>();

function mapBackendFeatureCategory(featureType?: string): AccessibilityCategory {
  switch (String(featureType ?? "").toLowerCase()) {
    case "ramp":
      return "Đường dốc";
    case "entrancedoor":
      return "Cửa & Lối vào";
    case "elevator":
      return "Thang máy";
    case "accessiblerestroom":
      return "Khu vệ sinh";
    default:
      return "Lối vào chính";
  }
}

async function normalizeSubmissionReviewDetail(raw: Record<string, unknown>): Promise<ContributionDetail> {
  const submissionId = String(raw.submissionId ?? "");
  const submissionCode = String(raw.submissionCode ?? submissionId);
  const rawClaims = Array.isArray(raw.claims) ? (raw.claims as Array<Record<string, unknown>>) : [];
  const rawFeatures = Array.isArray(raw.analysisFeatures)
    ? (raw.analysisFeatures as Array<Record<string, unknown>>)
    : [];
  const mediaIds = Array.isArray(raw.mediaIds) ? raw.mediaIds.map(String) : [];
  const originals = Array.isArray(raw.originals) ? (raw.originals as Array<Record<string, unknown>>) : [];
  const scope = (raw.scope as Record<string, unknown> | undefined) ?? undefined;

  const evidence: ContributionEvidence[] = await Promise.all(
    mediaIds.map(async (mediaId, idx) => {
      const orig = originals.find((o) => String(o.mediaId) === mediaId);
      const isVideo = String(orig?.mediaType ?? "").toLowerCase() === "video";
      let signedUrl = "";
      try {
        const res = await apiRequest<{ url?: string }>(`/api/v1/admin/media/${encodeURIComponent(mediaId)}/url`);
        signedUrl = res.data?.url ?? "";
      } catch {
        signedUrl = "";
      }
      return {
        id: mediaId,
        type: isVideo ? "video" : "image",
        title: `Minh chứng #${idx + 1} (${mediaId.slice(0, 8)})`,
        url: signedUrl,
        capturedAt: new Date().toISOString(),
        device: "Mobile contributor",
        resolution: "—",
        fileSize: "—",
        exifStatus: "valid",
        geotagStatus: "valid",
        description: orig ? `Quality: ${orig.qualityAssessment ?? "Unknown"} | Safety: ${orig.safetyAssessment ?? "Unknown"}` : "",
        aiFindings: [],
      };
    }),
  );

  const avgConf = rawFeatures.length
    ? rawFeatures.reduce((sum, f) => sum + Number(f.confidence ?? 0), 0) / rawFeatures.length
    : 0;

  return {
    id: submissionId,
    submittedAt: new Date().toISOString(),
    attemptLabel: `Lần gửi ${Number(raw.revision ?? 1)}`,
    submissionSequence: Number(raw.revision ?? 1),
    resubmissionCount: Number(raw.resubmissionCount ?? 0),
    type: "place_update",
    reason: "new_accessibility_data",
    place: {
      id: String(raw.locationId ?? ""),
      name: `Hồ sơ ${submissionCode}`,
      address: scope ? String(scope.label ?? "") : "",
      district: "",
      city: "",
    },
    contributor: {
      id: String(raw.contributorId ?? ""),
      name: "Người đóng góp",
      initials: "NC",
      reputationScore: 50,
      avatarTone: "teal",
    },
    categories: Array.from(new Set(rawClaims.map((c) => mapBackendFeatureCategory(String(c.featureType))))),
    verification: {
      confidence: Math.round(avgConf * 100),
      outcome: "needs_review",
      checkedItems: rawClaims.length,
      totalItems: rawClaims.length,
      note: "Dữ liệu kiểm định từ AccessMapVN-Backend",
    },
    status: "pending",
    priority: "normal",
    waitingMinutes: 0,
    evidenceCount: mediaIds.length,
    locationIntegrity: {
      poiCode: submissionCode,
      latitude: 0,
      longitude: 0,
      gpsAccuracyMeters: 0,
      surveyArea: scope ? String(scope.label ?? "Whole place") : "Whole place",
    },
    evidence,
    claims: rawClaims.map((claim) => {
      const claimId = String(claim.claimId ?? "");
      const feat = rawFeatures.find((f) => String(f.claimId ?? "") === claimId);
      const aiConf = Number(claim.confidence ?? feat?.confidence ?? 0);
      return {
        id: claimId,
        feature: mapBackendFeatureCategory(String(claim.featureType)),
        standard: String(claim.claimedStatus ?? "Available"),
        contributorClaim: String(claim.description ?? claim.claimedStatus ?? ""),
        aiAssessment: {
          label: String(claim.verificationResult ?? feat?.result ?? "Unclear"),
          confidence: aiConf <= 1 ? Math.round(aiConf * 100) : Math.round(aiConf),
          details: String(feat?.explanation ?? ""),
          advisoryOnly: true,
        },
        evidenceIds: mediaIds,
        eligibleForApproval: Boolean(claim.isEligibleForPublication),
        decision: "pending",
      };
    }),
    timeline: [],
    contributorHistory: { approved: 0, supplements: 0, violations: 0 },
    technicalNotes: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
    applicableStandards: [],
  };
}

function buildQueryString(query: ContributionQueueQuery = {}) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.type && query.type !== "all") params.set("type", query.type);
  if (query.reason && query.reason !== "all") params.set("reason", query.reason);
  if (query.category && query.category !== "all") params.set("category", query.category);
  if (query.warning && query.warning !== "all") params.set("warning", query.warning);
  if (query.date && query.date !== "all") params.set("date", query.date);
  if (query.view && query.view !== "all") params.set("view", query.view);
  if (query.sort) params.set("sort", query.sort);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));

  const str = params.toString();
  return str ? `?${str}` : "";
}

function isRouteUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  const status = (err as { status: number }).status;
  return status === 404 || status === 405;
}

function normalizePendingQueue(
  raw: { items?: Array<{ submissionId?: string; submissionCode?: string; locationId?: string; revision?: number }> },
  pageSize: number,
): ContributionQueueResponse {
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const nowIso = new Date().toISOString();
  const items = rawItems.map((item) => ({
    id: String(item.submissionId ?? item.submissionCode ?? ""),
    submittedAt: nowIso,
    attemptLabel: `Lần gửi ${item.revision ?? 1}`,
    submissionSequence: item.revision ?? 1,
    type: "place_update" as const,
    reason: "new_accessibility_data" as const,
    place: {
      id: String(item.locationId ?? ""),
      name: item.submissionCode ? `Hồ sơ ${item.submissionCode}` : "Địa điểm khảo sát",
      address: "",
      district: "",
      city: "",
    },
    contributor: {
      id: "contributor",
      name: "Người đóng góp",
      initials: "NC",
      reputationScore: 50,
      avatarTone: "teal" as const,
    },
    categories: [],
    verification: {
      confidence: 0,
      outcome: "needs_review" as const,
      note: "Chờ kiểm duyệt viên đối chiếu",
    },
    status: "pending" as const,
    priority: "normal" as const,
    waitingMinutes: 0,
    evidenceCount: 0,
  }));

  return {
    items,
    total: items.length,
    page: 1,
    pageSize,
    totalPages: 1,
    summary: {
      total: items.length,
      awaitingDecision: items.length,
      needsSupplement: 0,
      processed: 0,
      published: 0,
      rejected: 0,
      active: items.length,
      warnings: 0,
      waitingOverSla: 0,
      newPlaces: 0,
    },
    updatedAt: nowIso,
    slaTargetMinutes: 120,
  };
}

class BackendContributionRepository implements ContributionRepository {
  async getQueue(
    query: ContributionQueueQuery = {},
    signal?: AbortSignal,
  ): Promise<ContributionQueueResponse> {
    try {
      const response = await apiRequest<ContributionQueueResponse>(
        `/api/v1/admin/submissions${buildQueryString(query)}`,
        { signal },
      );
      return response.data;
    } catch (err: unknown) {
      if (!isRouteUnavailable(err)) throw err;
      const limit = Math.min(50, Math.max(1, query.pageSize ?? 20));
      const fallback = await apiRequest<{ items?: Array<Record<string, unknown>> }>(
        `/api/v1/admin/submissions/pending?limit=${limit}`,
        { signal },
      );
      return normalizePendingQueue(fallback.data, limit);
    }
  }

  async getById(id: string, signal?: AbortSignal): Promise<ContributionDetail | null> {
    try {
      const response = await apiRequest<ContributionDetail | Record<string, unknown>>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}`,
        { signal },
      );
      const raw = response.data as Record<string, unknown>;
      const reviewToken = typeof raw?.reviewToken === "string" ? `"${raw.reviewToken}"` : undefined;
      const resolvedEtag = response.etag || reviewToken;
      if (resolvedEtag) {
        etagBySubmissionId.set(id, resolvedEtag);
      }
      if (raw && typeof raw.submissionId === "string" && !("claims" in raw && "contributor" in raw)) {
        return await normalizeSubmissionReviewDetail(raw);
      }
      return response.data as ContributionDetail;
    } catch (err: unknown) {
      if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
        return null;
      }
      throw err;
    }
  }

  async getNavigation(id: string): Promise<ContributionNavigation> {
    try {
      const response = await apiRequest<ContributionNavigation>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}/navigation`,
      );
      return response.data;
    } catch {
      return {
        current: 1,
        total: 1,
      };
    }
  }

  async approve(id: string, input: ApproveContributionInput): Promise<ContributionDetail> {
    const idempotencyKey = crypto.randomUUID();
    const etag = etagBySubmissionId.get(id);
    try {
      const response = await apiRequest<ContributionDetail>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}/approve`,
        {
          method: "POST",
          body: input,
          etag,
          idempotencyKey,
        },
      );
      return response.data;
    } catch (err: unknown) {
      if (!err || typeof err !== "object" || !("status" in err) || ((err as { status: number }).status !== 400 && (err as { status: number }).status !== 422)) {
        throw err;
      }
      const response = await apiRequest<ContributionDetail>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}/approve`,
        {
          method: "POST",
          body: {
            approvedClaimIds: input.claimIds,
            reason: input.note,
          },
          etag,
          idempotencyKey: crypto.randomUUID(),
        },
      );
      return response.data;
    }
  }

  async requestMoreInfo(id: string, input: RequestMoreInfoInput): Promise<ContributionDetail> {
    const idempotencyKey = crypto.randomUUID();
    const etag = etagBySubmissionId.get(id);
    try {
      const response = await apiRequest<ContributionDetail>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}/request-info`,
        {
          method: "POST",
          body: input,
          etag,
          idempotencyKey,
        },
      );
      return response.data;
    } catch (err: unknown) {
      if (!isRouteUnavailable(err)) throw err;
      const response = await apiRequest<ContributionDetail>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}/request-more-info`,
        {
          method: "POST",
          body: { reason: input.instructions },
          etag,
          idempotencyKey,
        },
      );
      return response.data;
    }
  }

  async reject(id: string, reason: string): Promise<ContributionDetail> {
    const response = await apiRequest<ContributionDetail>(
      `/api/v1/admin/submissions/${encodeURIComponent(id)}/reject`,
      {
        method: "POST",
        body: { reason },
        etag: etagBySubmissionId.get(id),
        idempotencyKey: crypto.randomUUID(),
      },
    );
    return response.data;
  }

  async reviseClaimAssessment(
    id: string,
    input: ReviseClaimAssessmentInput
  ): Promise<ContributionDetail> {
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = await apiRequest<ContributionDetail>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}/revise-claim-assessment`,
        {
          method: "POST",
          body: {
            decision: ModerationDecision.ReviseClaimAssessment,
            ...input,
          },
          idempotencyKey,
        }
      );
      return response.data;
    } catch (err: unknown) {
      if (!isRouteUnavailable(err) || !input.claimIds?.[0]) throw err;
      const response = await apiRequest<ContributionDetail>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}/claim-assessments/${encodeURIComponent(input.claimIds[0])}/revision`,
        {
          method: "POST",
          body: {
            expectedAssessmentVersion: 1,
            submissionRevision: 1,
            outcome: input.outcome,
            observedAt: new Date().toISOString(),
            reason: input.reason,
            evidenceRefs: [],
          },
          idempotencyKey,
        },
      );
      return response.data;
    }
  }

  async sendReminder(id: string): Promise<ContributionDetail> {
    try {
      const response = await apiRequest<ContributionDetail>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}/remind`,
        {
          method: "POST",
          idempotencyKey: crypto.randomUUID(),
        },
      );
      return response.data;
    } catch (err: unknown) {
      if (!isRouteUnavailable(err)) throw err;
      const current = await this.getById(id);
      if (current) return current;
      throw err;
    }
  }
}

export async function retryAdminAiVerificationJob(
  jobId: string,
  reason: string,
  submissionId?: string,
): Promise<void> {
  await apiRequest<unknown>(`/api/v1/admin/ai-jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    body: { reason: reason.trim() },
    etag: submissionId ? etagBySubmissionId.get(submissionId) : undefined,
    idempotencyKey: crypto.randomUUID(),
  });
}

export const backendContributionRepository = new BackendContributionRepository();
