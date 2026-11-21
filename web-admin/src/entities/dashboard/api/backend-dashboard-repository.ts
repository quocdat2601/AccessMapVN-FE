"use client";

import { apiRequest } from "@/shared/api/api-client";
import type { DashboardData, DateRangeKey } from "../model/types";
import type { DashboardRepository } from "./dashboard-repository";
import { mockDashboardData } from "./mock-dashboard-data";

function isRouteUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  const status = (err as { status: number }).status;
  return status === 404 || status === 405;
}

export class BackendDashboardRepository implements DashboardRepository {
  async getDashboard(range: DateRangeKey, signal?: AbortSignal): Promise<DashboardData> {
    try {
      const response = await apiRequest<DashboardData>(
        `/api/v1/admin/dashboard?range=${encodeURIComponent(range)}`,
        { signal },
      );
      return response.data;
    } catch (err: unknown) {
      if (!isRouteUnavailable(err)) throw err;
      const [pendingRes, disputesRes] = await Promise.allSettled([
        apiRequest<{ items?: unknown[] }>("/api/v1/admin/submissions/pending?limit=50", { signal }),
        apiRequest<{ items?: unknown[] }>("/api/v1/admin/community-disputes?pageSize=50", { signal }),
      ]);
      const base = structuredClone(mockDashboardData[range]);
      const pendingCount =
        pendingRes.status === "fulfilled" && Array.isArray(pendingRes.value.data?.items)
          ? pendingRes.value.data.items.length
          : base.summary.pendingSubmissions;
      const disputeCount =
        disputesRes.status === "fulfilled" && Array.isArray(disputesRes.value.data?.items)
          ? disputesRes.value.data.items.length
          : base.summary.pendingDisputes;
      base.summary.pendingSubmissions = pendingCount;
      base.summary.pendingDisputes = disputeCount;
      base.generatedAt = new Date().toISOString();
      if (base.metrics[0]?.id === "pending") {
        base.metrics[0].value = pendingCount;
      }
      return base;
    }
  }
}

export const backendDashboardRepository: DashboardRepository = new BackendDashboardRepository();
