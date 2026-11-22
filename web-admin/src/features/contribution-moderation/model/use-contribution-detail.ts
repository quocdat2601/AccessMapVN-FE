"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/shared/api/api-client";
import {
  contributionRepository,
  type ApproveContributionInput,
  type ContributionDetail,
  type ContributionNavigation,
  type RequestMoreInfoInput,
  type ReviseClaimAssessmentInput,
} from "@/entities/contribution";

const MODERATION_ERROR_MESSAGES: Record<string, string> = {
  SELF_REVIEW_FORBIDDEN:
    "Không thể tự phê duyệt hoặc xử lý hồ sơ do chính tài khoản của bạn gửi lên. Hãy dùng tài khoản Admin khác.",
  PUBLICATION_EVIDENCE_UNUSABLE:
    "Ảnh/video minh chứng bị AI đánh giá không đạt chất lượng (ví dụ bị mờ) nên chưa đủ điều kiện phê duyệt công bố.",
  ADMIN_SOURCE_EVIDENCE_REQUIRED:
    "Minh chứng chưa qua đánh giá chất lượng đầy đủ; cần ghi nhận đánh giá trực tiếp từ kiểm duyệt viên.",
  PUBLICATION_SAFETY_BLOCKED:
    "Hồ sơ đang bị chặn công bố do cảnh báo an toàn hoặc xác thực ảnh.",
  REVIEW_VERSION_CHANGED:
    "Phiên kiểm duyệt đã hết hạn (quá 10 phút) hoặc hồ sơ vừa thay đổi. Vui lòng tải lại trang.",
  SUBMISSION_STATE_CONFLICT:
    "Trạng thái hồ sơ hiện không còn ở bước chờ kiểm duyệt.",
  PRECONDITION_REQUIRED:
    "Thiếu hoặc sai mã xác nhận phiên duyệt (ETag/If-Match). Vui lòng tải lại trang.",
  INVALID_REVIEW_TOKEN:
    "Thiếu hoặc sai mã xác nhận phiên duyệt (ETag/If-Match). Vui lòng tải lại trang.",
  INVALID_APPROVAL:
    "Thông tin phê duyệt hoặc hạng mục được chọn chưa hợp lệ.",
  INVALID_APPROVED_CLAIMS:
    "Thông tin phê duyệt hoặc hạng mục được chọn chưa hợp lệ.",
  LOCATION_NOT_PUBLISHABLE:
    "Địa điểm hiện chưa ở trạng thái cho phép công bố.",
};

function formatModerationError(reason: unknown): string {
  if (reason instanceof ApiError) {
    const tokenMatch = reason.message.match(/\b[A-Z][A-Z0-9_]{2,}\b/);
    const code = reason.code ?? tokenMatch?.[0];
    if (code && code in MODERATION_ERROR_MESSAGES) {
      return MODERATION_ERROR_MESSAGES[code];
    }
    return reason.message;
  }
  if (reason instanceof TypeError || (reason instanceof Error && reason.message.includes("Failed to fetch"))) {
    return "Không thể kết nối máy chủ API (hoặc bị chặn CORS). Hãy kiểm tra AccessMap.Api đang chạy bản mới nhất.";
  }
  return reason instanceof Error ? reason.message : "Không thể cập nhật hồ sơ.";
}

export function useContributionDetail(id: string) {
  const [data, setData] = useState<ContributionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [navigation, setNavigation] = useState<ContributionNavigation | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    contributionRepository.getById(id, controller.signal)
      .then((response) => response ? setData(response) : setError("Không tìm thấy hồ sơ đóng góp."))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("Không thể tải chi tiết hồ sơ.");
      });
    contributionRepository.getNavigation(id).then(setNavigation);
    return () => controller.abort();
  }, [id]);

  const runMutation = useCallback(async (operation: () => Promise<ContributionDetail>) => {
    setIsMutating(true);
    setError(null);
    try {
      const next = await operation();
      setData(next);
      return next;
    } catch (reason) {
      setError(formatModerationError(reason));
      throw reason;
    } finally {
      setIsMutating(false);
    }
  }, []);

  return {
    data,
    error,
    isLoading: !data && !error,
    isMutating,
    navigation,
    approve: (input: ApproveContributionInput) => runMutation(() => contributionRepository.approve(id, input)),
    requestMoreInfo: (input: RequestMoreInfoInput) => runMutation(() => contributionRepository.requestMoreInfo(id, input)),
    reject: (reason: string) => runMutation(() => contributionRepository.reject(id, reason)),
    reviseClaimAssessment: (input: ReviseClaimAssessmentInput) =>
      runMutation(() => contributionRepository.reviseClaimAssessment(id, input)),
    sendReminder: () => runMutation(() => contributionRepository.sendReminder(id)),
  };
}
