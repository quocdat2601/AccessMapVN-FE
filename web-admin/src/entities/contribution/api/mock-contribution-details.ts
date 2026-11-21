import type {
  AccessibilityCategory,
  AccessibilityClaim,
  ContributionDetail,
  ContributionEvidence,
  ContributionRecord,
  ContributionStatus,
  ContributionTimelineEvent,
} from "../model/types";

const featureCopy: Record<AccessibilityCategory, { standard: string; claim: string; ai: string }> = {
  "Đường dốc": { standard: "Độ dốc không vượt quá 1:12 (QCVN 10:2024 Mục 2.3)", claim: "Đường dốc rộng 1,4 m, có tay vịn hai bên", ai: "Nhận diện tay vịn kép và độ dốc ước tính 7,8%" },
  "Cửa & Lối vào": { standard: "Chiều rộng thông thủy lọt lòng tối thiểu 900 mm (Mục 2.2)", claim: "Cửa trượt tự động mở rộng, không có gờ cản", ai: "Phát hiện cửa trượt cảm biến và mặt phẳng đồng mức" },
  "Lối đi nội bộ": { standard: "Mặt sàn bằng phẳng, không trơn trượt, bề rộng thông thủy ≥ 1200 mm (Mục 2.1)", claim: "Hành lang rộng rãi, không có vật cản cố định", ai: "Nhận diện hành lang rộng và thông thoáng" },
  "Thang máy": { standard: "Kích thước buồng thang ≥ 1100x1400 mm, nút bấm thấp và ký hiệu nổi (Mục 2.4)", claim: "Thang máy có nút bấm thấp, màn hình và âm thanh thông báo", ai: "Nhận diện bảng điều khiển thấp và cửa mở tự động" },
  "Cầu thang": { standard: "Bậc thang có gờ chống trượt, tay vịn liên tục hai bên (Mục 2.4)", claim: "Cầu thang bộ có dải cảnh báo thị giác và tay vịn kép", ai: "Nhận diện bậc cầu thang có viền tương phản" },
  "Khu vệ sinh": { standard: "Buồng vệ sinh tiếp cận độc lập có tay vịn và khoảng quay xe lăn ≥ 1500 mm (Mục 2.5)", claim: "WC tiếp cận có cửa mở ra ngoài, tay vịn trợ lực bên bồn cầu", ai: "Phát hiện buồng WC rộng rãi có lắp thanh tay vịn an toàn" },
  "Bãi đỗ xe": { standard: "Có ô đỗ xe ưu tiên gần lối vào, kẻ vạch và biển báo chuẩn (Mục 2.6)", claim: "Có ô đỗ xe ưu tiên sơn biểu tượng tiếp cận cạnh cửa sảnh", ai: "Nhận diện biểu tượng xe lăn trên mặt sàn bãi đỗ" },
  "Quầy phục vụ": { standard: "Có đoạn quầy hạ thấp ≤ 800 mm cho người ngồi xe lăn (Mục 2.7)", claim: "Quầy lễ tân có mặt bàn thấp phục vụ người dùng xe lăn", ai: "Nhận diện đoạn quầy hạ thấp tiếp cận thuận tiện" },
  "Chỉ dẫn & Cảnh báo": { standard: "Dải xúc giác dẫn hướng liên tục và biển báo trực quan/Braille (Mục 2.8)", claim: "Có dải gạch xúc giác từ vỉa hè dẫn thẳng vào quầy thông tin", ai: "Nhận diện dải gạch xúc giác cảnh báo liên tục" },
  "Lối thoát hiểm": { standard: "Lối thoát nạn không có bậc cản, cửa mở theo chiều thoát (Mục 2.9)", claim: "Cửa thoát hiểm có thanh đẩy panic bar, lối ra phẳng", ai: "Nhận diện cửa thoát hiểm có đèn báo và thanh đẩy tiêu chuẩn" },
};

function decisionFor(status: ContributionStatus, index: number) {
  if (status === "published") return "approved" as const;
  if (status === "rejected") return "rejected" as const;
  if (status === "needs_supplement" && index === 0) return "needs_more_info" as const;
  return "pending" as const;
}

function createEvidence(record: ContributionRecord): ContributionEvidence[] {
  const rejected = record.status === "rejected";
  return [
    {
      id: `${record.id}-evidence-1`,
      type: "image",
      title: rejected ? "Ảnh 1 · Lối vào bị khuất" : "Ảnh 1 · Ram dốc lối vào",
      url: rejected ? "/evidence/obstructed-ramp.png" : "/evidence/ramp-entrance.png",
      capturedAt: "2026-09-26T10:24:00+07:00",
      device: "iPhone 14 Pro · camera góc rộng",
      resolution: "2048 × 1152",
      fileSize: "2,9 MB",
      exifStatus: "valid",
      geotagStatus: record.priority === "high" ? "mismatch" : "valid",
      description: rejected ? "Góc chụp chéo và bồn cây che khuất điểm bắt đầu của ram dốc." : "Toàn cảnh tuyến tiếp cận từ vỉa hè đến cửa vào phụ.",
      aiFindings: rejected
        ? [{ label: "Góc quan sát không đủ điều kiện đối soát", confidence: 48, tone: "critical" }]
        : [{ label: "Phát hiện ram dốc tiếp cận", confidence: record.verification.confidence, tone: record.verification.confidence >= 80 ? "positive" : "warning" }, { label: "Có tay vịn hai bên", confidence: 86, tone: "positive" }],
    },
    {
      id: `${record.id}-evidence-2`,
      type: "image",
      title: "Ảnh 2 · Cửa vào sảnh chính",
      url: "/evidence/automatic-door.png",
      capturedAt: "2026-09-26T10:25:00+07:00",
      device: "iPhone 14 Pro · camera chính",
      resolution: "2048 × 1152",
      fileSize: "2,7 MB",
      exifStatus: "valid",
      geotagStatus: "valid",
      description: "Góc trực diện thể hiện khoảng mở cửa và ngưỡng chuyển tiếp.",
      aiFindings: [{ label: "Phát hiện cửa trượt tự động", confidence: 85, tone: "positive" }, { label: "Ngưỡng cửa bằng phẳng", confidence: 89, tone: "positive" }],
    },
    {
      id: `${record.id}-evidence-3`,
      type: "video",
      title: "Video · Hành trình tiếp cận 5 giây",
      url: "/evidence/ramp-entrance.png",
      capturedAt: "2026-09-26T10:26:00+07:00",
      device: "iPhone 14 Pro · 60 fps",
      resolution: "1920 × 1080",
      fileSize: "14 MB",
      exifStatus: "valid",
      geotagStatus: "valid",
      description: "Mô phỏng hành trình từ vỉa hè đến sảnh; ảnh đại diện dùng trong prototype.",
      aiFindings: [{ label: "Luồng di chuyển không bị gián đoạn", confidence: 79, tone: "neutral" }],
    },
  ];
}

function createClaims(record: ContributionRecord): AccessibilityClaim[] {
  return record.categories.map((feature, index) => {
    const copy = featureCopy[feature];
    const confidence = Math.max(35, Math.min(98, record.verification.confidence - index * 7));
    const decision = decisionFor(record.status, index);
    return {
      id: `${record.id}-claim-${index + 1}`,
      feature,
      standard: copy.standard,
      contributorClaim: copy.claim,
      aiAssessment: {
        label: confidence >= 80 ? "Phù hợp" : confidence >= 60 ? "Cần đối chiếu" : "Độ tin cậy thấp",
        confidence,
        details: copy.ai,
        advisoryOnly: true,
      },
      currentPublishedValue: record.type === "place_update" ? (index === 0 ? "Có · duyệt 3 tháng trước" : "Chưa có dữ liệu") : undefined,
      evidenceIds: [`${record.id}-evidence-${Math.min(index + 1, 2)}`],
      eligibleForApproval: confidence >= 60 && record.status !== "rejected",
      decision,
      decisionNote: decision === "needs_more_info" ? "Cần ảnh toàn cảnh và góc bên để xác định điểm đầu, điểm cuối." : decision === "rejected" ? "Bằng chứng không đủ điều kiện xác minh kỹ thuật." : undefined,
    };
  });
}

export function createContributionDetail(record: ContributionRecord): ContributionDetail {
  const claims = createClaims(record);
  const isWaiting = record.status === "needs_supplement";
  const isProcessed = record.status === "published" || record.status === "rejected";
  const submittedTime = Date.parse(record.submittedAt);
  const aiCompletedAt = new Date(submittedTime + 60 * 1000).toISOString();
  const reviewStartedAt = new Date(submittedTime + 15 * 60 * 1000).toISOString();
  const decisionTime = new Date(submittedTime + 30 * 60 * 1000).toISOString();
  const baseTimeline: ContributionTimelineEvent[] = [
    { id: `${record.id}-timeline-1`, type: "submitted" as const, title: "Gửi hồ sơ lần 1", description: `${record.evidenceCount} bằng chứng được gửi từ ứng dụng cộng đồng.`, occurredAt: record.submittedAt, actor: record.contributor.name },
    { id: `${record.id}-timeline-2`, type: "ai_completed" as const, title: "Phân tích AI hoàn tất", description: `Độ tin cậy tổng hợp ${record.verification.confidence}%. Kết quả chỉ mang tính hỗ trợ.`, occurredAt: aiCompletedAt, actor: "Hệ thống" },
    { id: `${record.id}-timeline-3`, type: "review_started" as const, title: "Mở phiên kiểm duyệt thủ công", description: "Hồ sơ được chuyển cho kiểm duyệt viên phụ trách.", occurredAt: reviewStartedAt, actor: "Minh Trần" },
  ];

  if (isWaiting) baseTimeline.push({ id: `${record.id}-timeline-4`, type: "info_requested", title: "Yêu cầu bổ sung minh chứng", description: "Đề nghị bổ sung ảnh toàn cảnh, góc bên và video ngắn.", occurredAt: decisionTime, actor: "Minh Trần" });
  if (record.status === "published") baseTimeline.push({ id: `${record.id}-timeline-4`, type: "published", title: "Phê duyệt và công bố dữ liệu", description: `${claims.length}/${claims.length} hạng mục được tích hợp vào bản đồ.`, occurredAt: decisionTime, actor: "Minh Trần" });
  if (record.status === "rejected") baseTimeline.push({ id: `${record.id}-timeline-4`, type: "rejected", title: "Từ chối hồ sơ", description: "Bằng chứng không đủ điều kiện xác minh kỹ thuật.", occurredAt: decisionTime, actor: "Minh Trần" });

  return {
    ...record,
    locationIntegrity: {
      poiCode: `POI-${record.place.city === "TP.HCM" ? "HCM" : "HN"}-${record.place.id.slice(-5).toUpperCase()}`,
      latitude: record.place.city === "TP.HCM" ? 10.77375 : 21.0245,
      longitude: record.place.city === "TP.HCM" ? 106.7011 : 105.8412,
      gpsAccuracyMeters: record.priority === "high" ? 45 : 1.8,
      surveyArea: record.place.name.includes("Saigon Centre") ? "Lối vào phụ Pasteur (Tầng 1)" : "Lối vào chính (Sảnh trệt)",
      scope: {
        id: `scope-${record.id}`,
        locationId: record.place.id,
        kind: record.categories.some(c => c.includes("Lối vào") || c.includes("Đường dốc")) ? 2 : 1, // 2: Entrance, 1: BuildingGeneral
        label: record.place.name.includes("Saigon Centre") ? "Lối vào phụ Pasteur (Tầng 1)" : "Khu vực sảnh đón chính",
        floorNumber: 1,
        coverageStatus: "Known",
      },
      mismatchMeters: record.priority === "high" ? 45 : undefined,
      warning: record.priority === "high" ? "Vị trí media cách tọa độ tâm cơ sở khoảng 45 m; cần đối soát góc nhìn thực tế." : undefined,
      mapHref: `https://www.openstreetmap.org/?mlat=${record.place.city === "TP.HCM" ? 10.77375 : 21.0245}&mlon=${record.place.city === "TP.HCM" ? 106.7011 : 105.8412}`,
    },
    evidence: createEvidence(record),
    claims,
    timeline: baseTimeline,
    informationRequest: isWaiting ? {
      requestedClaimIds: [claims[0]?.id].filter(Boolean) as string[],
      evidenceItems: ["Ảnh toàn cảnh ram dốc", "Ảnh góc bên thể hiện độ nghiêng", "Video hành trình 5–10 giây"],
      instructions: "Cần thấy rõ điểm bắt đầu, điểm kết thúc và tay vịn của ram dốc theo QCVN 10:2024/BXD.",
      requestedAt: decisionTime,
      requestedBy: "Minh Trần",
      dueAt: "2026-10-15T23:59:00+07:00",
      responseStatus: "waiting",
    } : undefined,
    moderationDecision: isProcessed ? {
      type: record.status === "published" ? "published" : "rejected",
      selectedClaimIds: record.status === "published" ? claims.map((claim) => claim.id) : [],
      reason: record.status === "published" ? "Bằng chứng đủ rõ, vị trí và các hạng mục được đối soát độc lập." : "Bằng chứng hình ảnh không đủ độ rõ và góc chụp chuẩn để xác minh.",
      decidedAt: decisionTime,
      decidedBy: "Minh Trần",
    } : undefined,
    contributorHistory: {
      approved: Math.max(4, Math.round(record.contributor.reputationScore / 5)),
      supplements: record.contributor.reputationScore > 80 ? 2 : 4,
      violations: record.contributor.reputationScore > 60 ? 0 : 1,
      reputationDelta: record.status === "published" ? 15 : 0,
    },
    technicalNotes: ["EXIF được kiểm tra độc lập với nội dung do người dùng khai báo.", "AI chỉ gợi ý vùng quan tâm; quyết định thuộc quy trình kiểm duyệt phía máy chủ trong tương lai.", "Không suy diễn toàn bộ công trình tiếp cận từ một hạng mục hình ảnh đơn lẻ."],
    applicableStandards: ["QCVN 10:2024/BXD · Mục 2.2 Lối vào", "QCVN 10:2024/BXD · Mục 2.3 Đường dốc", "WCAG 2.2 AA · Trình bày dữ liệu quản trị"],
  };
}
