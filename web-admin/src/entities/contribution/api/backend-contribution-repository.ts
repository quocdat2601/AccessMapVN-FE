"use client";

import { apiRequest } from "@/shared/api/api-client";
import type { ContributionRepository } from "./contribution-repository";
import {
  ModerationDecision,
  type ApproveContributionInput,
  type ContributionDetail,
  type ContributionNavigation,
  type ContributionQueueQuery,
  type ContributionQueueResponse,
  type RequestMoreInfoInput,
  type ReviseClaimAssessmentInput,
} from "../model/types";

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
      const response = await apiRequest<ContributionDetail>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}`,
        { signal },
      );
      return response.data;
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
    try {
      const response = await apiRequest<ContributionDetail>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}/approve`,
        {
          method: "POST",
          body: input,
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
          idempotencyKey: crypto.randomUUID(),
        },
      );
      return response.data;
    }
  }

  async requestMoreInfo(id: string, input: RequestMoreInfoInput): Promise<ContributionDetail> {
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = await apiRequest<ContributionDetail>(
        `/api/v1/admin/submissions/${encodeURIComponent(id)}/request-info`,
        {
          method: "POST",
          body: input,
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
        idempotencyKey: crypto.randomUUID(),
      },
    );
    return response.data;
  }

  async reviseClaimAssessment(
    id: string,
    input: ReviseClaimAssessmentInput
  ): Promise<ContributionDetail> {
    const response = await apiRequest<ContributionDetail>(
      `/api/v1/admin/submissions/${encodeURIComponent(id)}/revise-claim-assessment`,
      {
        method: "POST",
        body: {
          decision: ModerationDecision.ReviseClaimAssessment,
          ...input,
        },
        idempotencyKey: crypto.randomUUID(),
      }
    );
    return response.data;
  }

  async sendReminder(id: string): Promise<ContributionDetail> {
    const response = await apiRequest<ContributionDetail>(
      `/api/v1/admin/submissions/${encodeURIComponent(id)}/remind`,
      {
        method: "POST",
      },
    );
    return response.data;
  }
}

export const backendContributionRepository = new BackendContributionRepository();
