"use client";

import { apiRequest } from "@/shared/api/api-client";
import type { ContributionRepository } from "./contribution-repository";
import {
  ModerationDecision,
  type AccessibilityCategory,
  type ApproveContributionInput,
  type ClaimDecision,
  type ContributionDetail,
  type ContributionEvidence,
  type ContributionNavigation,
  type ContributionQueueQuery,
  type ContributionQueueResponse,
  type ContributionStatus,
  type ContributionTimelineEvent,
  type EvidenceAiFinding,
  type ModerationDecisionRecord,
  type RequestMoreInfoInput,
  type ReviseClaimAssessmentInput,
  type TimelineEventType,
  type VisualSuggestion,
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

function mapFeatureTypeToDetectorKey(featureType?: string): string {
  switch (String(featureType ?? "").toLowerCase()) {
    case "entrancedoor":
      return "door_width_ok";
    case "ramp":
      return "ramp_slope";
    case "elevator":
      return "elevator_present";
    case "accessiblerestroom":
      return "accessible_restroom";
    default:
      return String(featureType ?? "feature").toLowerCase();
  }
}

function formatFileSize(bytes?: number | null): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return "NC";
}

function mapBackendStatus(status?: string): ContributionStatus {
  switch (String(status ?? "").toLowerCase()) {
    case "published":
      return "published";
    case "rejected":
      return "rejected";
    case "awaitingmoreinfo":
      return "needs_supplement";
    default:
      return "pending";
  }
}

function mapExifStatus(status?: string): "valid" | "missing" | "mismatch" {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "valid" || normalized === "parsed" || normalized === "matched") return "valid";
  if (!normalized || normalized === "missing") return "missing";
  return "mismatch";
}

function mapTimelineEvent(raw: Record<string, unknown>, idx: number): ContributionTimelineEvent {
  const toStatus = String(raw.toStatus ?? "");
  const lower = toStatus.toLowerCase();
  let type: TimelineEventType = "review_started";
  let title = toStatus || "Cập nhật trạng thái";

  if (lower === "submitted") {
    type = "submitted";
    title = "Gửi hồ sơ đóng góp";
  } else if (lower === "aiprocessing") {
    type = "submitted";
    title = "Hệ thống AI đang phân tích";
  } else if (lower === "pendingmoderation") {
    type = "ai_completed";
    title = "Hoàn tất phân tích AI, chờ duyệt";
  } else if (lower === "awaitingmoreinfo") {
    type = "info_requested";
    title = "Yêu cầu bổ sung minh chứng";
  } else if (lower === "published") {
    type = "published";
    title = "Đã phê duyệt & công bố";
  } else if (lower === "rejected") {
    type = "rejected";
    title = "Từ chối hồ sơ";
  }

  const fallbackDesc = raw.fromStatus ? `${raw.fromStatus} → ${toStatus}` : toStatus;
  return {
    id: String(raw.eventId ?? `timeline-${idx}`),
    type,
    title,
    description: String(raw.reason ?? raw.reasonCode ?? fallbackDesc),
    occurredAt: String(raw.createdAt ?? new Date().toISOString()),
    actor: String(raw.actor ?? "System"),
  };
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
  const location = (raw.location as Record<string, unknown> | undefined) ?? undefined;
  const contributorRaw = (raw.contributor as Record<string, unknown> | undefined) ?? undefined;
  const rawVisuals = Array.isArray(raw.visualEvidence)
    ? (raw.visualEvidence as Array<Record<string, unknown>>)
    : [];
  const rawTimeline = Array.isArray(raw.timeline)
    ? (raw.timeline as Array<Record<string, unknown>>)
    : [];
  const rawCriteria = Array.isArray(raw.criteria)
    ? (raw.criteria as Array<Record<string, unknown>>)
    : [];
  const rawCurrentFeatures = Array.isArray(raw.currentFeatures)
    ? (raw.currentFeatures as Array<Record<string, unknown>>)
    : [];

  const createdAtIso = String(raw.createdAt ?? new Date().toISOString());
  const mappedStatus = mapBackendStatus(String(raw.status ?? ""));

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

      const mediaVisuals = rawVisuals.filter((v) => String(v.mediaId ?? "") === mediaId);
      const visualSuggestions: VisualSuggestion[] = mediaVisuals.map((v) => {
        const hasRegion =
          typeof v.regionX === "number" &&
          typeof v.regionY === "number" &&
          typeof v.regionWidth === "number" &&
          typeof v.regionHeight === "number";
        const conf = typeof v.confidence === "number" ? (v.confidence > 1 ? v.confidence / 100 : v.confidence) : undefined;
        return {
          feature: mapFeatureTypeToDetectorKey(String(v.featureType ?? "")),
          value: "suggested_present",
          detectorScore: conf,
          bboxFormat: "xyxy",
          coordinateSpace: "normalized_0_1",
          bboxNormalized: hasRegion
            ? [
                Number(v.regionX),
                Number(v.regionY),
                Math.min(1, Number(v.regionX) + Number(v.regionWidth)),
                Math.min(1, Number(v.regionY) + Number(v.regionHeight)),
              ]
            : undefined,
        };
      });

      const aiFindings: EvidenceAiFinding[] = mediaVisuals.map((v) => ({
        label: String(v.observation ?? mapBackendFeatureCategory(String(v.featureType ?? ""))),
        confidence:
          typeof v.confidence === "number"
            ? v.confidence <= 1
              ? Math.round(v.confidence * 100)
              : Math.round(v.confidence)
            : undefined,
        tone: "positive",
      }));
      const isBlur = typeof orig?.isBlur === "boolean" ? orig.isBlur : null;
      const lap = typeof orig?.laplacianVariance === "number" ? orig.laplacianVariance : null;
      const qCodes = Array.isArray(orig?.qualityCodes) ? orig.qualityCodes.map(String) : [];

      if (String(orig?.authenticityAssessment ?? "").toLowerCase() === "suspected") {
        aiFindings.push({
          label: "Cảnh báo xác thực ảnh: cần kiểm tra thủ công",
          tone: "warning",
        });
      }
      if (isBlur === true || qCodes.includes("IMAGE_BLURRY")) {
        aiFindings.push({
          label: `Ảnh bị AI đánh giá mờ (Laplacian ${lap ?? "—"})`,
          tone: "critical",
        });
      }

      const qualityDesc =
        isBlur === true
          ? `Chất lượng ảnh: Bị mờ (độ nét ${lap ?? "—"}) — không đạt điều kiện công bố`
          : isBlur === false
            ? `Chất lượng ảnh: Rõ nét (độ nét ${lap ?? "—"})`
            : `Chất lượng ảnh: ${String(orig?.qualityAssessment ?? "Chưa đánh giá")}`;

      const exifStatus = mapExifStatus(typeof orig?.exifGpsStatus === "string" ? orig.exifGpsStatus : "");
      const geotagStatus =
        exifStatus === "valid" && orig?.gpsRequiresReview !== true
          ? "valid"
          : exifStatus === "missing"
            ? "missing"
            : "mismatch";

      return {
        id: mediaId,
        type: isVideo ? "video" : "image",
        title: `Minh chứng #${idx + 1} (${mediaId.slice(0, 8)})`,
        url: signedUrl,
        capturedAt: String(orig?.capturedAt ?? createdAtIso),
        device: "Mobile contributor",
        resolution: orig?.width && orig?.height ? `${orig.width} × ${orig.height}` : "—",
        fileSize: formatFileSize(typeof orig?.fileSizeBytes === "number" ? orig.fileSizeBytes : null),
        exifStatus,
        geotagStatus,
        description: orig ? `${qualityDesc} · An toàn: ${String(orig.safetyAssessment ?? "NotAssessed")}` : "",
        aiFindings,
        visualSuggestions,
      };
    }),
  );

  const rawAiConfidence = typeof raw.aiConfidence === "number" ? raw.aiConfidence : null;
  const avgConf =
    rawAiConfidence ??
    (rawFeatures.length
      ? rawFeatures.reduce((sum, f) => sum + Number(f.confidence ?? 0), 0) / rawFeatures.length
      : 0);
  const confidencePct = avgConf <= 1 ? Math.round(avgConf * 100) : Math.round(avgConf);

  const contributorName = String(contributorRaw?.name ?? "Người đóng góp");
  const devLat = typeof raw.deviceLatitude === "number" ? raw.deviceLatitude : null;
  const devLon = typeof raw.deviceLongitude === "number" ? raw.deviceLongitude : null;
  const locLat = typeof location?.latitude === "number" ? location.latitude : null;
  const locLon = typeof location?.longitude === "number" ? location.longitude : null;
  const latitude = devLat ?? locLat ?? 0;
  const longitude = devLon ?? locLon ?? 0;
  const hasCoords = latitude !== 0 || longitude !== 0;
  const gpsDistanceMeters = typeof raw.gpsDistanceMeters === "number" ? Math.round(raw.gpsDistanceMeters) : 0;
  const hasMissingExif = originals.some((o) => String(o.exifGpsStatus ?? "").toLowerCase() === "missing");
  const hasGpsReview = originals.some((o) => o.gpsRequiresReview === true);
  const locationWarning =
    gpsDistanceMeters > 50
      ? `Tọa độ thiết bị lệch ${gpsDistanceMeters} m so với vị trí địa điểm trên bản đồ.`
      : hasMissingExif && hasGpsReview
        ? "Ảnh minh chứng chưa gắn tọa độ EXIF GPS; đang đối soát theo vị trí thiết bị."
        : undefined;

  const createdMs = Date.parse(createdAtIso);
  const waitingMinutes =
    mappedStatus === "pending" && Number.isFinite(createdMs)
      ? Math.max(0, Math.round((Date.now() - createdMs) / 60000))
      : 0;

  const applicableStandards = Array.from(
    new Set(
      rawCriteria
        .map((c) => [c.standardVersion, c.criterionCode].filter(Boolean).join(" · "))
        .filter(Boolean),
    ),
  );

  const timeline = rawTimeline.map((ev, idx) => mapTimelineEvent(ev, idx));
  const claims = rawClaims.map((claim) => {
    const claimId = String(claim.claimId ?? "");
    const feat = rawFeatures.find((f) => String(f.claimId ?? "") === claimId);
    const aiConf = Number(claim.confidence ?? feat?.confidence ?? 0);
    const matchingCurrent = rawCurrentFeatures.find(
      (cf) => !cf.retired && String(cf.featureType ?? "") === String(claim.featureType ?? ""),
    );
    const matchingVisual = rawVisuals.find(
      (v) => String(v.featureType ?? "") === String(claim.featureType ?? ""),
    );
    const claimDecision: ClaimDecision =
      mappedStatus === "published" && claim.isEligibleForPublication
        ? "approved"
        : mappedStatus === "rejected"
          ? "rejected"
          : mappedStatus === "needs_supplement"
            ? "needs_more_info"
            : "pending";
    return {
      id: claimId,
      feature: mapBackendFeatureCategory(String(claim.featureType)),
      standard: String(claim.claimedStatus ?? "Available"),
      contributorClaim: String(claim.description ?? claim.claimedStatus ?? ""),
      aiAssessment: {
        label: String(claim.verificationResult ?? feat?.result ?? "Unclear"),
        confidence: aiConf <= 1 ? Math.round(aiConf * 100) : Math.round(aiConf),
        details: String(feat?.explanation || matchingVisual?.observation || ""),
        advisoryOnly: true as const,
      },
      currentPublishedValue: matchingCurrent ? String(matchingCurrent.status ?? "") : undefined,
      evidenceIds: mediaIds,
      eligibleForApproval:
        Boolean(claim.isEligibleForPublication) ||
        String(claim.claimedStatus ?? "").toLowerCase() !== "unknown",
      decision: claimDecision,
    };
  });

  const matchingDecisionEvent =
    mappedStatus === "published" || mappedStatus === "rejected"
      ? [...timeline].reverse().find((ev) => ev.type === mappedStatus)
      : undefined;
  const moderationDecision: ModerationDecisionRecord | undefined =
    mappedStatus === "published"
      ? {
          type: "published",
          decision: ModerationDecision.Approve,
          selectedClaimIds: claims.filter((c) => c.decision === "approved").map((c) => c.id),
          reason: matchingDecisionEvent?.description || "Đã phê duyệt công bố",
          decidedAt: matchingDecisionEvent?.occurredAt ?? createdAtIso,
          decidedBy: matchingDecisionEvent?.actor || "Admin",
        }
      : mappedStatus === "rejected"
        ? {
            type: "rejected",
            decision: ModerationDecision.Reject,
            selectedClaimIds: [],
            reason: matchingDecisionEvent?.description || "Đã từ chối hồ sơ",
            decidedAt: matchingDecisionEvent?.occurredAt ?? createdAtIso,
            decidedBy: matchingDecisionEvent?.actor || "Admin",
          }
        : undefined;

  return {
    id: submissionId,
    submittedAt: createdAtIso,
    attemptLabel: `Lần gửi ${Number(raw.revision ?? 1)}`,
    submissionSequence: Number(raw.revision ?? 1),
    resubmissionCount: Number(raw.resubmissionCount ?? 0),
    type: String(raw.flowType ?? "").toLowerCase() === "newlocation" ? "new_place" : "place_update",
    reason: "new_accessibility_data",
    place: {
      id: String(location?.locationId ?? raw.locationId ?? ""),
      name: String(location?.name ?? `Hồ sơ ${submissionCode}`),
      address: String(location?.formattedAddress ?? scope?.label ?? ""),
      district: "",
      city: "",
    },
    contributor: {
      id: String(contributorRaw?.userId ?? raw.contributorId ?? ""),
      name: contributorName,
      initials: getInitials(contributorName),
      reputationScore: Number(contributorRaw?.accountStandingScore ?? 50),
      avatarTone: "teal",
    },
    categories: Array.from(new Set(rawClaims.map((c) => mapBackendFeatureCategory(String(c.featureType))))),
    verification: {
      confidence: confidencePct,
      outcome: "needs_review",
      checkedItems: rawClaims.length,
      totalItems: rawClaims.length,
      note: raw.textDescription ? String(raw.textDescription) : "Dữ liệu kiểm định từ AccessMapVN-Backend",
    },
    status: mappedStatus,
    priority: Array.isArray(raw.warnings) && raw.warnings.length > 0 ? "high" : "normal",
    waitingMinutes,
    evidenceCount: originals.length || mediaIds.length,
    locationIntegrity: {
      poiCode: String(location?.businessCode ?? submissionCode),
      latitude,
      longitude,
      gpsAccuracyMeters: gpsDistanceMeters,
      mismatchMeters: gpsDistanceMeters > 0 ? gpsDistanceMeters : undefined,
      surveyArea: scope ? String(scope.label ?? "Whole place") : "Whole place",
      warning: locationWarning,
      mapHref: hasCoords ? `https://www.google.com/maps?q=${latitude},${longitude}` : undefined,
    },
    evidence,
    claims,
    timeline,
    moderationDecision,
    contributorHistory: {
      approved: Number(contributorRaw?.approvedSubmissions ?? 0),
      supplements: Number(contributorRaw?.needsInfoSubmissions ?? 0),
      violations: Number(contributorRaw?.rejectedSubmissions ?? 0),
    },
    technicalNotes: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
    applicableStandards: applicableStandards.length ? applicableStandards : ["QCVN 10:2024/BXD"],
  };
}

function isRouteUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  const status = (err as { status: number }).status;
  return status === 404 || status === 405;
}

function normalizeSubmissionQueue(
  raw: { items?: Array<Record<string, unknown>>; summary?: Record<string, unknown>; updatedAt?: string },
  query: ContributionQueueQuery = {},
): ContributionQueueResponse {
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const nowIso = String(raw?.updatedAt ?? new Date().toISOString());
  const allItems = rawItems.map((item) => {
    const submissionCode = item.submissionCode ? String(item.submissionCode) : "";
    const contributorName = String(item.contributorName ?? "Người đóng góp");
    const createdAtIso = String(item.createdAt ?? nowIso);
    const createdMs = Date.parse(createdAtIso);
    const status = mapBackendStatus(typeof item.status === "string" ? item.status : undefined);
    const waitingMinutes =
      (status === "pending" || status === "needs_supplement") && Number.isFinite(createdMs)
        ? Math.max(0, Math.round((Date.now() - createdMs) / 60000))
        : 0;
    const rawConf = typeof item.aiConfidence === "number" ? item.aiConfidence : 0;
    const confidencePct = rawConf <= 1 ? Math.round(rawConf * 100) : Math.round(rawConf);
    const warningCount = typeof item.warningCount === "number" ? item.warningCount : 0;
    const categories = Array.isArray(item.featureTypes)
      ? Array.from(new Set(item.featureTypes.map((feature) => mapBackendFeatureCategory(String(feature)))))
      : [];
    const outcome =
      status === "published"
        ? ("publishable" as const)
        : status === "rejected"
          ? ("not_publishable" as const)
          : status === "needs_supplement"
            ? ("missing_evidence" as const)
            : ("needs_review" as const);
    const note =
      status === "published"
        ? "Đã phê duyệt công bố"
        : status === "rejected"
          ? "Đã từ chối hồ sơ"
          : status === "needs_supplement"
            ? "Đang chờ bổ sung minh chứng"
            : "Chờ kiểm duyệt viên đối chiếu";
    return {
      id: String(item.submissionId ?? submissionCode),
      submittedAt: createdAtIso,
      attemptLabel: `Lần gửi ${Number(item.revision ?? 1)}`,
      submissionSequence: Number(item.revision ?? 1),
      type: (String(item.flowType ?? "").toLowerCase() === "newlocation" ? "new_place" : "place_update") as "new_place" | "place_update",
      reason: "new_accessibility_data" as const,
      place: {
        id: String(item.locationId ?? ""),
        name: String(item.locationName ?? (submissionCode ? `Hồ sơ ${submissionCode}` : "Địa điểm khảo sát")),
        address: String(item.formattedAddress ?? item.scopeLabel ?? ""),
        district: "",
        city: "",
      },
      contributor: {
        id: String(item.contributorId ?? "contributor"),
        name: contributorName,
        initials: getInitials(contributorName),
        reputationScore: typeof item.contributorStandingScore === "number" ? item.contributorStandingScore : 50,
        avatarTone: "teal" as const,
      },
      categories,
      verification: {
        confidence: confidencePct,
        outcome,
        note,
      },
      status,
      priority: (warningCount > 0 ? "high" : "normal") as "normal" | "high",
      waitingMinutes,
      evidenceCount: typeof item.mediaCount === "number" ? item.mediaCount : 0,
    };
  });

  const searchTerm = query.search?.trim().toLowerCase() ?? "";
  const nowDateStr = new Date().toDateString();
  const nowMs = Date.now();

  const filtered = allItems.filter((item) => {
    if (query.status && query.status !== "all") {
      if (query.status === "processed") {
        if (item.status !== "published" && item.status !== "rejected") return false;
      } else if (item.status !== query.status) {
        return false;
      }
    }
    if (query.type && query.type !== "all" && item.type !== query.type) return false;
    if (query.reason && query.reason !== "all" && item.reason !== query.reason) return false;
    if (query.category && query.category !== "all" && !item.categories.includes(query.category)) return false;
    if (query.warning === "warning" && item.priority !== "high") return false;
    if (query.warning === "over_sla" && item.waitingMinutes <= 120) return false;
    if (query.date && query.date !== "all") {
      const submittedMs = Date.parse(item.submittedAt);
      if (!Number.isFinite(submittedMs)) return false;
      if (query.date === "today" && new Date(submittedMs).toDateString() !== nowDateStr) return false;
      if (query.date === "7d" && nowMs - submittedMs > 7 * 86_400_000) return false;
      if (query.date === "30d" && nowMs - submittedMs > 30 * 86_400_000) return false;
    }
    if (query.view === "fast_track" && !(item.status === "pending" && item.verification.confidence >= 80 && item.priority !== "high")) return false;
    if (query.view === "waiting_long" && item.waitingMinutes <= 120) return false;
    if (query.view === "warning" && item.priority !== "high") return false;
    if (query.view === "new_place" && item.type !== "new_place") return false;
    if (searchTerm) {
      const hay = `${item.id} ${item.place.name} ${item.place.address} ${item.contributor.name}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (query.sort) {
      case "oldest":
        return Date.parse(a.submittedAt) - Date.parse(b.submittedAt);
      case "highest_confidence":
        return b.verification.confidence - a.verification.confidence;
      case "lowest_confidence":
        return a.verification.confidence - b.verification.confidence;
      case "highest_reputation":
        return b.contributor.reputationScore - a.contributor.reputationScore;
      default:
        return Date.parse(b.submittedAt) - Date.parse(a.submittedAt);
    }
  });

  const pageSize = Math.max(1, query.pageSize ?? 8);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);
  const pagedItems = sorted.slice((page - 1) * pageSize, page * pageSize);

  const rawSummary = raw?.summary;
  const hasServerSummary = rawSummary && typeof rawSummary.total === "number";
  const awaitingDecision = hasServerSummary
    ? Number(rawSummary.pending ?? 0)
    : allItems.filter((item) => item.status === "pending").length;
  const needsSupplement = hasServerSummary
    ? Number(rawSummary.needsSupplement ?? 0)
    : allItems.filter((item) => item.status === "needs_supplement").length;
  const published = hasServerSummary
    ? Number(rawSummary.published ?? 0)
    : allItems.filter((item) => item.status === "published").length;
  const rejected = hasServerSummary
    ? Number(rawSummary.rejected ?? 0)
    : allItems.filter((item) => item.status === "rejected").length;

  return {
    items: pagedItems,
    total,
    page,
    pageSize,
    totalPages,
    summary: {
      total: hasServerSummary ? Number(rawSummary.total) : allItems.length,
      awaitingDecision,
      needsSupplement,
      processed: published + rejected,
      published,
      rejected,
      active: awaitingDecision + needsSupplement,
      warnings: hasServerSummary ? Number(rawSummary.warnings ?? 0) : allItems.filter((item) => item.priority === "high").length,
      waitingOverSla: hasServerSummary ? Number(rawSummary.waitingOverSla ?? 0) : allItems.filter((item) => item.waitingMinutes > 120).length,
      newPlaces: hasServerSummary ? Number(rawSummary.newPlaces ?? 0) : allItems.filter((item) => item.type === "new_place").length,
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
    const params = new URLSearchParams();
    if (query.status && query.status !== "all" && query.status !== "processed") {
      params.set("status", query.status);
    }
    params.set("limit", "200");
    // ponytail: fetches up to 200 moderation items and applies search/category/view/sort/pagination client-side; move filters server-side if queue volume exceeds 200.
    try {
      const response = await apiRequest<ContributionQueueResponse | Record<string, unknown>>(
        `/api/v1/admin/submissions?${params.toString()}`,
        { signal },
      );
      const data = response.data as Record<string, unknown>;
      const firstItem = Array.isArray(data?.items) ? (data.items[0] as Record<string, unknown> | undefined) : undefined;
      if (firstItem && "place" in firstItem && "contributor" in firstItem) {
        return response.data as ContributionQueueResponse;
      }
      return normalizeSubmissionQueue(
        data as { items?: Array<Record<string, unknown>>; summary?: Record<string, unknown>; updatedAt?: string },
        query,
      );
    } catch (err: unknown) {
      if (!isRouteUnavailable(err)) throw err;
      const limit = 50;
      const fallback = await apiRequest<{ items?: Array<Record<string, unknown>> }>(
        `/api/v1/admin/submissions/pending?limit=${limit}`,
        { signal },
      );
      return normalizeSubmissionQueue(fallback.data, query);
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
      if (raw && typeof raw.submissionId === "string" && !("place" in raw && "evidence" in raw)) {
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

  private async resolveDetailAfterMutation(
    id: string,
    data: ContributionDetail | Record<string, unknown>,
  ): Promise<ContributionDetail> {
    const record = data as unknown as Record<string, unknown>;
    if (record && typeof record === "object" && "place" in record && "claims" in record) {
      return data as ContributionDetail;
    }
    const refreshed = await this.getById(id);
    if (refreshed) return refreshed;
    return data as ContributionDetail;
  }

  async approve(id: string, input: ApproveContributionInput): Promise<ContributionDetail> {
    const response = await apiRequest<ContributionDetail | Record<string, unknown>>(
      `/api/v1/admin/submissions/${encodeURIComponent(id)}/approve`,
      {
        method: "POST",
        body: {
          approvedClaimIds: input.claimIds,
          reason: input.note.trim(),
        },
        etag: etagBySubmissionId.get(id),
        idempotencyKey: crypto.randomUUID(),
      },
    );
    return await this.resolveDetailAfterMutation(id, response.data);
  }

  async requestMoreInfo(id: string, input: RequestMoreInfoInput): Promise<ContributionDetail> {
    const response = await apiRequest<ContributionDetail | Record<string, unknown>>(
      `/api/v1/admin/submissions/${encodeURIComponent(id)}/request-more-info`,
      {
        method: "POST",
        body: { reason: input.instructions.trim() },
        etag: etagBySubmissionId.get(id),
        idempotencyKey: crypto.randomUUID(),
      },
    );
    return await this.resolveDetailAfterMutation(id, response.data);
  }

  async reject(id: string, reason: string): Promise<ContributionDetail> {
    const response = await apiRequest<ContributionDetail | Record<string, unknown>>(
      `/api/v1/admin/submissions/${encodeURIComponent(id)}/reject`,
      {
        method: "POST",
        body: { reason },
        etag: etagBySubmissionId.get(id),
        idempotencyKey: crypto.randomUUID(),
      },
    );
    return await this.resolveDetailAfterMutation(id, response.data);
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
