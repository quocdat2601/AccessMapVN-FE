export type VerificationStatus = 'PendingModeration' | 'AwaitingMoreInfo';

export interface PersonaFitEvaluation {
  electricWheelchair: 'FullyAccessible' | 'Accessible' | 'Inaccessible';
  manualWheelchairSelf: 'FullyAccessible' | 'NeedsAssistance' | 'Inaccessible';
  visualImpaired: 'Safe' | 'NeedsCaution' | 'Unsafe';
}

export interface DataConfidenceAssessment {
  rampGeometryMeasured: boolean;
  confidenceLevel: number; // 0-100%
  recommendationPrompt?: string;
}

export interface PersonaScores {
  wheelchairScore: number; // 0-100%
  blindScore: number; // 0-100%
}

export interface VerificationPenalties {
  stepsWithoutRamp: boolean;
  tactileBlocked: boolean;
}

export interface VerificationMatrixInput {
  cvConfidence: number; // 0.0 to 1.0 (average / key feature CV confidence)
  textDescription?: string;
  contributorCoords: { latitude: number; longitude: number; accuracy?: number | null } | null;
  poiCoords: { latitude: number; longitude: number } | null;
  selectedTags: string[];
  verifiedTagCount?: number;
  unverifiedTagCount?: number;
  allowedRadiusMeters?: number;
  venueCategory?: string;
  isLargeVenue?: boolean;
}

export interface VerificationMatrixResult {
  overallScore: number; // 0 to 100 (%)
  status: VerificationStatus;
  statusLabel: string;
  statusDescription: string;
  spatialDistanceMeters: number | null;
  spatialValid: boolean;
  pillars: {
    computerVision: {
      score: number;
      weight: number;
      label: string;
    };
    nlpContext: {
      score: number;
      weight: number;
      label: string;
      matchedKeywords: string[];
    };
    spatialProximity: {
      score: number;
      weight: number;
      distanceMeters: number | null;
      isWithin50m: boolean;
    };
  };
  // QCVN 10:2024/BXD Persona & Confidence Extensions
  personaScores: PersonaScores;
  personaFit: PersonaFitEvaluation;
  dataConfidence: DataConfidenceAssessment;
  penalties: VerificationPenalties;
  recommendedExp: number;
  hasDiscrepancy: boolean;
  verifiedTagCount: number;
  unverifiedTagCount: number;
}

const ACCESSIBILITY_KEYWORDS = [
  'ram dốc',
  'dốc',
  'thoải',
  'bậc thang',
  'bậc',
  'thang máy',
  'cửa rộng',
  'cửa tự động',
  'tiếp cận',
  'xe lăn',
  'lối đi',
  'nhà vệ sinh',
  'wc',
  'xúc giác',
  'bằng phẳng',
  'gờ',
  'braille',
  'chữ nổi',
];

/**
 * Calculates surface distance between two WGS84 GPS coordinates using the Haversine formula.
 */
export function calculateHaversineDistanceMeters(
  coord1: { latitude: number; longitude: number },
  coord2: { latitude: number; longitude: number }
): number {
  const R = 6371000; // Earth's mean radius in meters
  const dLat = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
  const dLon = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((coord1.latitude * Math.PI) / 180) *
      Math.cos((coord2.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Evaluates the full multi-modal verification matrix combining Computer Vision,
 * NLP context notes, Spatial Proximity Geofence (<= 50m), and QCVN 10:2024/BXD Persona fits.
 */
export function evaluateVerificationMatrix(
  input: VerificationMatrixInput
): VerificationMatrixResult {
  // 1. Computer Vision Pillar (Weight 50%)
  const cvRawScore = Math.min(100, Math.max(0, Math.round(input.cvConfidence * 100)));

  // 2. NLP Context Pillar (Optional — weight 20% only when notes are provided; 0 penalty when empty)
  const notes = (input.textDescription || '').trim().toLowerCase();
  const hasNotes = notes.length > 0;
  const matchedKeywords: string[] = [];

  for (const kw of ACCESSIBILITY_KEYWORDS) {
    if (notes.includes(kw)) {
      matchedKeywords.push(kw);
    }
  }

  let nlpScore = 0;
  if (hasNotes) {
    if (matchedKeywords.length >= 2) {
      nlpScore = 95;
    } else if (matchedKeywords.length === 1) {
      nlpScore = 85;
    } else {
      nlpScore = 70; // Optional note provided without standard keywords
    }
  }

  // 3. Spatial Proximity Geofence Pillar
  let distanceMeters: number | null = null;
  let spatialValid = true;
  let spatialScore = 80; // neutral default if GPS missing

  if (input.contributorCoords && input.poiCoords) {
    distanceMeters = calculateHaversineDistanceMeters(input.contributorCoords, input.poiCoords);
    // In geodesy, effective distance accounts for device GPS accuracy uncertainty
    const accuracyMargin = input.contributorCoords.accuracy
      ? Math.min(30, Math.max(0, Math.round(input.contributorCoords.accuracy)))
      : 0;
    const allowedRadius = input.allowedRadiusMeters && input.allowedRadiusMeters > 0 ? input.allowedRadiusMeters : 50;

    // Large venues (malls, supermarkets, hospitals, parks, transit stations) suffer from indoor drift
    const isLargeVenue =
      input.isLargeVenue ||
      ['mall', 'supermarket', 'market', 'hospital', 'clinic', 'park', 'transit', 'station'].includes(
        input.venueCategory?.toLowerCase() || ''
      );
    const buildingAllowance = isLargeVenue ? 35 : 0;

    const effectiveDistance = Math.max(0, distanceMeters - accuracyMargin - buildingAllowance);
    spatialValid = effectiveDistance <= allowedRadius;

    if (spatialValid) {
      // 0m = 100%, allowedRadius = 80%
      spatialScore = Math.max(80, Math.round(100 - (effectiveDistance / allowedRadius) * 20));
    } else {
      // Penalty when exceeding allowedRadius geofence
      spatialScore = Math.max(10, Math.round(60 - Math.min(50, effectiveDistance - allowedRadius)));
    }
  }

  const cvWeight = hasNotes ? 0.5 : 0.65;
  const spatialWeight = hasNotes ? 0.3 : 0.35;
  const nlpWeight = hasNotes ? 0.2 : 0;

  let overallScore = Math.round(
    cvRawScore * cvWeight + spatialScore * spatialWeight + nlpScore * nlpWeight
  );

  // BR-13 Penalty: If spatial distance exceeds 50m, enforce maximum threshold of 75%
  if (!spatialValid) {
    overallScore = Math.min(overallScore, 75);
  }

  // ── QCVN 10:2024/BXD Persona Scoring & Penalty Rules ───────────────────────────
  const selectedSet = new Set(input.selectedTags);
  const hasRamp = selectedSet.has('exterior_ramp_present');
  const hasComfortableRamp = selectedSet.has('ramp_slope_comfortable');
  const hasSteps = selectedSet.has('steps_present');
  const hasDoorWidth = selectedSet.has('door_width_ok');
  const hasFlatThreshold = selectedSet.has('door_threshold_flat');
  const hasElevator = selectedSet.has('elevator_accessible');
  const hasAccessibleRestroom =
    selectedSet.has('restroom_accessible_stall') || selectedSet.has('restroom_grab_bars');

  const hasTactileGuiding = selectedSet.has('tactile_paving_guiding');
  const hasTactileWarning = selectedSet.has('tactile_paving_warning');
  const isTactileBlocked = selectedSet.has('tactile_paving_blocked');
  const hasOverheadClearance = selectedSet.has('overhead_clearance_ok');
  const hasBraille = selectedSet.has('braille_signage_present');
  const hasAudio = selectedSet.has('audible_signal_present');

  // Penalty Flags
  const stepsWithoutRamp = hasSteps && !hasRamp;
  const tactileBlocked = isTactileBlocked;

  // ── Wheelchair Score Formula ──────────────────────────────────────────────
  let cvWheelchair = cvRawScore;
  if (!hasRamp && !hasSteps && !hasDoorWidth) {
    cvWheelchair = Math.round(cvRawScore * 0.5);
  }

  let wheelchairScore = Math.round(cvWheelchair * 0.5 + spatialScore * 0.3 + nlpScore * 0.2);

  // Severe Penalty: Steps present without Ramp -> Deduct 40%
  if (stepsWithoutRamp) {
    wheelchairScore = Math.max(10, wheelchairScore - 40);
  }

  // ── Blind Score Formula ───────────────────────────────────────────────────
  // If no tactile/braille/audio features exist, blind CV score is 0
  let cvBlind = 0;
  if (hasTactileGuiding || hasTactileWarning || hasBraille || hasAudio) {
    cvBlind = cvRawScore;
  }

  let blindScore = Math.round(cvBlind * 0.5 + spatialScore * 0.3 + nlpScore * 0.2);

  // Severe Penalty: Tactile blocked by obstacles -> Clamp to AwaitingMoreInfo
  if (tactileBlocked) {
    blindScore = Math.min(25, blindScore);
  }

  // ── Persona Fit Qualitative Evaluation ────────────────────────────────────
  let electricWheelchair: PersonaFitEvaluation['electricWheelchair'] = 'Accessible';
  let manualWheelchairSelf: PersonaFitEvaluation['manualWheelchairSelf'] = 'NeedsAssistance';
  let visualImpaired: PersonaFitEvaluation['visualImpaired'] = 'NeedsCaution';

  if (stepsWithoutRamp) {
    electricWheelchair = 'Inaccessible';
    manualWheelchairSelf = 'Inaccessible';
  } else if (hasRamp) {
    if (hasComfortableRamp && (hasDoorWidth || hasFlatThreshold)) {
      electricWheelchair = 'FullyAccessible';
      manualWheelchairSelf = 'FullyAccessible';
    } else {
      electricWheelchair = 'FullyAccessible';
      manualWheelchairSelf = 'NeedsAssistance';
    }
  } else if (hasElevator || hasAccessibleRestroom) {
    electricWheelchair = 'Accessible';
    manualWheelchairSelf = 'NeedsAssistance';
  }

  if (tactileBlocked) {
    visualImpaired = 'Unsafe';
  } else if ((hasTactileGuiding || hasTactileWarning) && (hasOverheadClearance || hasAudio || hasBraille)) {
    visualImpaired = 'Safe';
  } else if (hasTactileGuiding || hasTactileWarning) {
    visualImpaired = 'NeedsCaution';
  }

  // ── Anti-Cheat: Empty Feature Selection & Discrepancy Gates ───────────────
  const hasNoFeatures = input.selectedTags.length === 0;
  const hasDiscrepancy = !hasNoFeatures && cvRawScore === 0;

  if (hasNoFeatures) {
    overallScore = Math.min(overallScore, 25);
    wheelchairScore = Math.min(wheelchairScore, 20);
    blindScore = Math.min(blindScore, 20);
    electricWheelchair = 'Inaccessible';
    manualWheelchairSelf = 'Inaccessible';
    visualImpaired = 'NeedsCaution';
  } else if (hasDiscrepancy) {
    overallScore = Math.min(overallScore, 35);
    wheelchairScore = Math.min(wheelchairScore, 30);
    blindScore = Math.min(blindScore, 25);
    electricWheelchair = 'Inaccessible';
    manualWheelchairSelf = 'Inaccessible';
    visualImpaired = 'NeedsCaution';
  }

  // ── Data Confidence Assessment ─────────────────────────────────────────────
  const dataConfidence: DataConfidenceAssessment = {
    rampGeometryMeasured: false,
    confidenceLevel: hasNoFeatures || hasDiscrepancy ? 25 : 75,
    recommendationPrompt: hasNoFeatures
      ? 'Chưa ghi nhận đặc điểm tiếp cận. Hãy chụp trực diện lối vào, ram dốc hoặc cửa chính.'
      : hasDiscrepancy
      ? 'Ảnh chưa thể hiện đặc tính bạn đã chọn. Vui lòng chụp rõ góc lối vào/ram dốc hoặc chờ kiểm duyệt viên xác minh.'
      : 'Để thẩm định độ dốc 1/20 tuyệt đối theo QCVN 10:2024/BXD, hãy chụp thêm ảnh góc nghiêng hoặc quay video bước dọc theo dốc.',
  };

  // ── Granular Verification: Verified vs Unverified Feature Counts ──────────
  const verifiedTagCount = input.verifiedTagCount ?? (cvRawScore > 0 ? input.selectedTags.length : 0);
  const unverifiedTagCount = input.unverifiedTagCount ?? (cvRawScore === 0 ? input.selectedTags.length : 0);

  // Categorize overall status per WF-01 spec (valid submissions always route to Admin review)
  let status: VerificationStatus = 'PendingModeration';
  let statusLabel = 'Chờ duyệt viên';
  let statusDescription =
    'Thông tin ở mức khá. Đóng góp sẽ được kiểm duyệt viên xem xét và đối chiếu.';

  if (hasNoFeatures || hasDiscrepancy || overallScore < 60) {
    status = 'AwaitingMoreInfo';
    statusLabel = 'Cần thêm thông tin';
    statusDescription = hasNoFeatures
      ? 'Chưa phát hiện hoặc xác nhận đặc điểm tiếp cận nào. Bạn có thể chụp lại góc rộng hơn hoặc chọn thêm tiêu chí.'
      : hasDiscrepancy
      ? 'Ảnh chưa thể hiện đặc tính bạn đã chọn. Vui lòng chụp rõ góc lối vào/ram dốc hoặc chờ kiểm duyệt viên xác minh.'
      : 'Hình ảnh hoặc vị trí chưa rõ ràng. Bạn có thể chụp lại góc rộng hơn để bổ sung.';
  } else if (unverifiedTagCount > 0) {
    status = 'PendingModeration';
    statusLabel = 'Chờ duyệt viên';
    statusDescription =
      `Đã xác thực ${verifiedTagCount}/${input.selectedTags.length} đặc điểm qua hình ảnh. ${unverifiedTagCount} đặc điểm tự khai báo thêm cần kiểm duyệt viên xác minh.`;
  } else if (overallScore >= 80 && spatialValid) {
    status = 'PendingModeration';
    statusLabel = 'Đủ điều kiện gửi duyệt';
    statusDescription =
      'Minh chứng rõ nét và đúng vị trí thực địa. Hồ sơ sẵn sàng gửi để kiểm duyệt viên xét duyệt.';
  }

  return {
    overallScore,
    status,
    statusLabel,
    statusDescription,
    spatialDistanceMeters: distanceMeters,
    spatialValid,
    pillars: {
      computerVision: {
        score: cvRawScore,
        weight: cvWeight,
        label: `${cvRawScore}% độ khớp thị giác máy tính`,
      },
      nlpContext: {
        score: nlpScore,
        weight: nlpWeight,
        label: hasNotes
          ? `${nlpScore}% ngữ cảnh mô tả (${matchedKeywords.length} từ khóa khớp)`
          : 'Không nhập ghi chú (không trừ điểm)',
        matchedKeywords,
      },
      spatialProximity: {
        score: spatialScore,
        weight: spatialWeight,
        distanceMeters,
        isWithin50m: spatialValid,
      },
    },
    personaScores: {
      wheelchairScore,
      blindScore,
    },
    personaFit: {
      electricWheelchair,
      manualWheelchairSelf,
      visualImpaired,
    },
    dataConfidence,
    penalties: {
      stepsWithoutRamp,
      tactileBlocked,
    },
    recommendedExp: 50,
    hasDiscrepancy,
    verifiedTagCount,
    unverifiedTagCount,
  };
}

let isAndroid = false;
try {
  const { Platform } = require('react-native');
  isAndroid = Platform?.OS === 'android';
} catch {
  isAndroid = false;
}

let resolveServiceUrlFn: ((port: number, envOverride?: string) => string) | null = null;
let postMultipartFn: ((url: string, formData: FormData, timeoutMs?: number) => Promise<any>) | null = null;
try {
  const clientModule = require('@/shared/api/client');
  resolveServiceUrlFn = clientModule.resolveServiceUrl;
  postMultipartFn = clientModule.postMultipart;
} catch {
  resolveServiceUrlFn = null;
  postMultipartFn = null;
}

/**
 * Verification Adapter: Evaluates the multi-modal verification matrix deterministically on mobile.
 * Backend full verification occurs asynchronously via Hangfire worker after media upload.
 */
export async function verifyWithAiOrFallback(
  _imageUri: string,
  input: VerificationMatrixInput
): Promise<VerificationMatrixResult> {
  return evaluateVerificationMatrix(input);
}

export const MIN_MEDIA_LONG_EDGE_PX = 1280;
export const MIN_MEDIA_SHORT_EDGE_PX = 720;
export const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_SIZE_BYTES = 30 * 1024 * 1024;
export const MIN_VIDEO_DURATION_SECONDS = 5;
export const MAX_VIDEO_DURATION_SECONDS = 10;

export type MediaValidationResult =
  | { valid: true }
  | { valid: false; code: string; message: string };

export function validateCapturedMedia(media: {
  type: 'photo' | 'video';
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  durationSeconds?: number | null;
}): MediaValidationResult {
  const width = media.width;
  const height = media.height;
  if (width != null && height != null && width > 0 && height > 0) {
    const longEdge = Math.max(width, height);
    const shortEdge = Math.min(width, height);
    if (longEdge < MIN_MEDIA_LONG_EDGE_PX || shortEdge < MIN_MEDIA_SHORT_EDGE_PX) {
      return {
        valid: false,
        code: media.type === 'video' ? 'INVALID_VIDEO_RESOLUTION' : 'INVALID_PHOTO_RESOLUTION',
        message:
          media.type === 'video'
            ? `Video có độ phân giải quá thấp (${Math.round(width)}×${Math.round(height)} px). Yêu cầu tối thiểu ${MIN_MEDIA_LONG_EDGE_PX}×${MIN_MEDIA_SHORT_EDGE_PX} px (720p) — vui lòng quay lại.`
            : `Ảnh có độ phân giải quá thấp (${Math.round(width)}×${Math.round(height)} px). Yêu cầu tối thiểu ${MIN_MEDIA_LONG_EDGE_PX}×${MIN_MEDIA_SHORT_EDGE_PX} px (HD) — vui lòng chụp trực tiếp bằng camera hoặc chọn ảnh gốc nét hơn.`,
      };
    }
  }

  if (media.fileSize != null && media.fileSize > 0) {
    if (media.type === 'photo' && media.fileSize > MAX_PHOTO_SIZE_BYTES) {
      return {
        valid: false,
        code: 'MEDIA_TOO_LARGE',
        message: 'Ảnh vượt quá dung lượng tối đa 10 MB. Vui lòng chụp lại ảnh nhỏ hơn.',
      };
    }
    if (media.type === 'video' && media.fileSize > MAX_VIDEO_SIZE_BYTES) {
      return {
        valid: false,
        code: 'MEDIA_TOO_LARGE',
        message: 'Video vượt quá dung lượng tối đa 30 MB. Vui lòng quay video ngắn hơn.',
      };
    }
  }

  if (media.type === 'video' && media.durationSeconds != null) {
    if (
      media.durationSeconds < MIN_VIDEO_DURATION_SECONDS ||
      media.durationSeconds > MAX_VIDEO_DURATION_SECONDS
    ) {
      return {
        valid: false,
        code: 'INVALID_VIDEO_DURATION',
        message: `Video phải có độ dài từ ${MIN_VIDEO_DURATION_SECONDS} đến ${MAX_VIDEO_DURATION_SECONDS} giây. Vui lòng quay lại.`,
      };
    }
  }

  return { valid: true };
}

export interface MappedContributionError {
  message: string;
  code?: string;
  needsRetake: boolean;
  isConflict: boolean;
}

const CONTRIBUTION_ERROR_MAP: Record<string, { message: string; needsRetake: boolean }> = {
  INVALID_PHOTO_RESOLUTION: {
    message:
      'Ảnh có độ phân giải quá thấp (yêu cầu tối thiểu 1280×720 px). Vui lòng chụp trực tiếp bằng camera hoặc chọn ảnh gốc nét hơn.',
    needsRetake: true,
  },
  INVALID_VIDEO_RESOLUTION: {
    message: 'Video có độ phân giải quá thấp (yêu cầu tối thiểu 1280×720 px). Vui lòng quay lại.',
    needsRetake: true,
  },
  INVALID_VIDEO_DURATION: {
    message: 'Video cần có độ dài từ 5 đến 10 giây. Vui lòng quay lại.',
    needsRetake: true,
  },
  INVALID_PHOTO_CONTENT: {
    message: 'Tệp ảnh bị lỗi hoặc định dạng không hợp lệ (chỉ hỗ trợ JPEG/PNG). Vui lòng chụp lại ảnh.',
    needsRetake: true,
  },
  INVALID_VIDEO_CONTENT: {
    message: 'Tệp video bị lỗi hoặc codec chưa được hỗ trợ (chỉ hỗ trợ MP4 H.264). Vui lòng quay lại.',
    needsRetake: true,
  },
  UNSUPPORTED_MEDIA_CONTENT_TYPE: {
    message: 'Định dạng tệp chưa được hỗ trợ (chỉ chấp nhận ảnh JPEG/PNG hoặc video MP4). Vui lòng chụp lại.',
    needsRetake: true,
  },
  MEDIA_TOO_LARGE: {
    message: 'Tệp minh chứng vượt quá dung lượng cho phép (tối đa 10 MB cho ảnh, 30 MB cho video). Vui lòng chụp hoặc quay lại.',
    needsRetake: true,
  },
  INVALID_MEDIA_SIZE: {
    message: 'Kích thước tệp ảnh/video không khớp khi tải lên. Vui lòng chụp lại hoặc thử gửi lại.',
    needsRetake: true,
  },
  MEDIA_SIZE_MISMATCH: {
    message: 'Kích thước tệp ảnh/video không khớp khi tải lên. Vui lòng chụp lại hoặc thử gửi lại.',
    needsRetake: true,
  },
  PHOTO_DECODE_RESOURCE_LIMIT: {
    message: 'Ảnh có kích thước điểm ảnh quá lớn để xử lý. Vui lòng chụp lại ở chế độ tiêu chuẩn.',
    needsRetake: true,
  },
  UPLOAD_INTENT_NOT_USABLE: {
    message: 'Phiên tải ảnh đã hết hạn hoặc bị thay đổi. Vui lòng bấm gửi lại hoặc chụp lại ảnh.',
    needsRetake: true,
  },
  UPLOAD_ORIGINAL_CHANGED: {
    message: 'Phiên tải ảnh đã hết hạn hoặc bị thay đổi. Vui lòng bấm gửi lại hoặc chụp lại ảnh.',
    needsRetake: true,
  },
  MEDIA_PREPARATION_CHANGED: {
    message: 'Phiên tải ảnh đã hết hạn hoặc bị thay đổi. Vui lòng bấm gửi lại hoặc chụp lại ảnh.',
    needsRetake: true,
  },
  INVALID_CAPTURE_GPS: {
    message: 'Thông tin GPS hoặc thời gian chụp không hợp lệ. Vui lòng kiểm tra GPS và thử lại.',
    needsRetake: false,
  },
  INVALID_CAPTURE_TIME: {
    message: 'Thông tin GPS hoặc thời gian chụp không hợp lệ. Vui lòng kiểm tra GPS và thử lại.',
    needsRetake: false,
  },
  INVALID_UPLOAD_TARGET: {
    message: 'Thông tin địa điểm hoặc phạm vi khảo sát chưa hợp lệ. Vui lòng chọn lại địa điểm.',
    needsRetake: false,
  },
  INVALID_SCOPE_SELECTOR: {
    message: 'Thông tin địa điểm hoặc phạm vi khảo sát chưa hợp lệ. Vui lòng chọn lại địa điểm.',
    needsRetake: false,
  },
  PHOTO_INSPECTION_TIMEOUT: {
    message: 'Quá thời gian kiểm tra tệp minh chứng. Vui lòng thử gửi lại sau giây lát.',
    needsRetake: false,
  },
  VIDEO_INSPECTION_TIMEOUT: {
    message: 'Quá thời gian kiểm tra tệp minh chứng. Vui lòng thử gửi lại sau giây lát.',
    needsRetake: false,
  },
  MEDIA_PREPARATION_TIMEOUT: {
    message: 'Quá thời gian kiểm tra tệp minh chứng. Vui lòng thử gửi lại sau giây lát.',
    needsRetake: false,
  },
  PHOTO_INSPECTION_UNAVAILABLE: {
    message: 'Dịch vụ kiểm tra ảnh/video đang tạm bận. Vui lòng thử lại sau.',
    needsRetake: false,
  },
  VIDEO_INSPECTION_UNAVAILABLE: {
    message: 'Dịch vụ kiểm tra ảnh/video đang tạm bận. Vui lòng thử lại sau.',
    needsRetake: false,
  },
  MEDIA_PREPARATION_UNAVAILABLE: {
    message: 'Dịch vụ kiểm tra ảnh/video đang tạm bận. Vui lòng thử lại sau.',
    needsRetake: false,
  },
  PHOTO_INSPECTOR_NOT_CONFIGURED: {
    message: 'Dịch vụ kiểm tra ảnh/video đang tạm bận. Vui lòng thử lại sau.',
    needsRetake: false,
  },
  SESSION_REVOKED: {
    message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục gửi hồ sơ.',
    needsRetake: false,
  },
};

export function mapContributionError(err: unknown): MappedContributionError {
  const obj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const data = obj?.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null;
  const status = obj?.status ?? obj?.statusCode ?? data?.status ?? data?.statusCode;
  const isConflict = status === 409;

  let code: string | undefined;
  if (typeof obj?.code === 'string' && obj.code.trim()) {
    code = obj.code.trim();
  } else if (typeof data?.code === 'string' && data.code.trim()) {
    code = data.code.trim();
  } else {
    const rawMessages = [data?.message, obj?.message].filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0
    );
    for (const msg of rawMessages) {
      const trimmed = msg.trim();
      if (/^[A-Z][A-Z0-9_]{2,}$/.test(trimmed)) {
        code = trimmed;
        break;
      }
      const tokens = trimmed.match(/\b[A-Z][A-Z0-9_]{2,}\b/g);
      const matched = tokens?.find((token) => token in CONTRIBUTION_ERROR_MAP);
      if (matched) {
        code = matched;
        break;
      }
    }
  }

  if (code && code in CONTRIBUTION_ERROR_MAP) {
    const mapped = CONTRIBUTION_ERROR_MAP[code];
    return {
      message: mapped.message,
      code,
      needsRetake: mapped.needsRetake,
      isConflict,
    };
  }

  const errorsObj =
    data?.errors && typeof data.errors === 'object' ? (data.errors as Record<string, unknown>) : null;
  const gpsErr = Array.isArray(errorsObj?.GpsLat) ? errorsObj.GpsLat[0] : undefined;
  const locErr = Array.isArray(errorsObj?.LocationId) ? errorsObj.LocationId[0] : undefined;
  let errorMsg =
    (typeof gpsErr === 'string' ? gpsErr : undefined) ||
    (typeof locErr === 'string' ? locErr : undefined) ||
    (typeof data?.title === 'string' ? data.title : undefined);

  if (!errorMsg && data?.details && typeof data.details === 'object') {
    const detailValues = Object.values(data.details as Record<string, unknown>)
      .flat()
      .filter(Boolean);
    if (detailValues.length > 0) {
      errorMsg = detailValues.join(', ');
    }
  }

  const fallbackMessage =
    errorMsg ||
    (typeof data?.message === 'string' ? data.message : undefined) ||
    (typeof obj?.message === 'string' ? obj.message : undefined) ||
    'Không thể gửi đóng góp lên máy chủ. Vui lòng thử lại.';

  return {
    message: fallbackMessage,
    code,
    needsRetake: false,
    isConflict,
  };
}

