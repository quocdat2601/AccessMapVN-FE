import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ContributionHistorySheet,
  addContributionRecord,
  fetchSubmissionStatus,
  isTerminalSubmissionStatus,
  updateContributionRecordStatus,
  type CapturedContributionMedia,
  type LiveSubmissionStatus,
} from '@/entities/contribution';
import { QCVN_FEATURE_TAGS } from '../../model/tagReviewModel';
import { ApiError, apiClient } from '@/shared/api/client';
import {
  submitContributionToBackend,
  uploadMediaToBackend,
  type DuplicateLocationChallenge,
  type IdentityConfirmationInput,
  type ProposedUploadScope,
} from '../../api/mediaUploadService';
import { mapContributionError, type VerificationMatrixResult } from '../../lib/verificationEngine';
import { ScoreMatrixBreakdown } from '../components/review/ScoreMatrixBreakdown';
import { ScoreMeterRing } from '../components/review/ScoreMeterRing';
import {
  saveSurveyDraft,
  loadSurveyDraft,
  deleteSurveyDraftOnSuccess,
  refreshDraftSubmissionId,
  defaultFileExistenceChecker,
} from '../../model/surveyDraftStore';
import {
  getReportDraft,
  setReportEvidence,
  setActiveUploadPromise,
} from '@/features/reports/model/reportDraftStore';
import { ScoreCriteriaExplainer } from '../components/review/ScoreCriteriaExplainer';
import type { UserMeasurementsInput } from './TagReviewScreen';
import { useAuth } from '@/features/auth';
import { LoginRequiredModal } from '@/shared/ui/LoginRequiredModal';

interface FinalScorecardScreenProps {
  media: CapturedContributionMedia;
  matrixResult: VerificationMatrixResult;
  selectedTagKeys: string[];
  confirmedObservations?: Record<string, 'present' | 'absent'>;
  notes: string;
  userMeasurements?: UserMeasurementsInput | null;
  proposedScope?: ProposedUploadScope;
  qualityWarning?: string | null;
  flow?: string;
  locationName?: string;
  locationAddress?: string | null;
  onChangeLocation?: () => void;
  onRetakeOrReset: () => void;
  onEditTags: () => void;
  onFinish?: () => void;
}

const SCOPE_KIND_LABELS: Record<ProposedUploadScope['kind'], string> = {
  BuildingGeneral: 'Toàn địa điểm',
  Entrance: 'Lối vào',
  Floor: 'Theo tầng',
  Unit: 'Khu / Phòng',
};

function formatScopeSummary(scope: ProposedUploadScope): string {
  const kindLabel = SCOPE_KIND_LABELS[scope.kind] ?? scope.kind;
  const rawLabel = scope.label?.trim();
  const displayLabel = !rawLabel || rawLabel === 'Whole place' ? kindLabel : rawLabel;
  return displayLabel === kindLabel ? displayLabel : `${displayLabel} · ${kindLabel}`;
}

export function FinalScorecardScreen({
  media,
  matrixResult,
  selectedTagKeys,
  confirmedObservations,
  notes,
  userMeasurements,
  proposedScope,
  qualityWarning,
  flow,
  locationName,
  locationAddress,
  onChangeLocation,
  onRetakeOrReset,
  onEditTags,
  onFinish,
}: FinalScorecardScreenProps) {
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const { overallScore, status, statusLabel, statusDescription, pillars, spatialValid, spatialDistanceMeters } =
    matrixResult;

  const badgeScale = useRef(new Animated.Value(0.7)).current;
  const badgeOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(12)).current;

  const { refreshProfile, user } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showHistorySheet, setShowHistorySheet] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedTagLabels = React.useMemo(
    () =>
      selectedTagKeys.map(
        (key) => QCVN_FEATURE_TAGS.find((t) => t.key === key)?.label ?? key
      ),
    [selectedTagKeys]
  );
  const clientSubmissionIdRef = useRef<string>(
    `mob-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`
  );
  const [submittedResult, setSubmittedResult] = useState<{
    submissionId: string;
    message: string;
    pointsAwarded: number;
  } | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveSubmissionStatus | null>(null);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const isMountedRef = useRef(true);
  React.useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const submittedId = submittedResult?.submissionId ?? null;
  const refreshSubmissionStatus = React.useCallback(async () => {
    if (!submittedId) return;
    if (isMountedRef.current) setIsRefreshingStatus(true);
    try {
      const latest = await fetchSubmissionStatus(submittedId);
      if (!latest || !isMountedRef.current) return;
      setLiveStatus(latest);
      updateContributionRecordStatus(submittedId, {
        status: latest.status,
        submissionCode: latest.submissionCode,
        revision: latest.revision,
        resubmissionCount: latest.resubmissionCount,
        moderatorNote: latest.informationRequestReason ?? undefined,
      });
      if (latest.status === 'Published' || latest.status === 'Auto-Verified') {
        void refreshProfile();
      }
    } finally {
      if (isMountedRef.current) setIsRefreshingStatus(false);
    }
  }, [submittedId, refreshProfile]);

  const liveStatusValue = liveStatus?.status;
  React.useEffect(() => {
    if (!submittedId) return;
    void refreshSubmissionStatus();

    const shouldPoll =
      !isTerminalSubmissionStatus(liveStatusValue) && liveStatusValue !== 'AwaitingMoreInfo';
    const timer = shouldPoll
      ? setInterval(() => {
          void refreshSubmissionStatus();
        }, 5000)
      : null;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshSubmissionStatus();
      }
    });

    return () => {
      if (timer) clearInterval(timer);
      subscription.remove();
    };
  }, [submittedId, liveStatusValue, refreshSubmissionStatus]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConflictError, setIsConflictError] = useState(false);
  const [needsRetakeOnError, setNeedsRetakeOnError] = useState(false);
  const [duplicateChallenge, setDuplicateChallenge] = useState<DuplicateLocationChallenge | null>(null);
  const [confirmDistinctReason, setConfirmDistinctReason] = useState('');
  const [resolvedLocationIdOverride, setResolvedLocationIdOverride] = useState<string | null>(null);

  // Sync draft on mount (preserve clientSubmissionId across sessions)
  React.useEffect(() => {
    async function syncDraft() {
      if (!media.locationId) return;
      try {
        const existing = await loadSurveyDraft(media.locationId);
        if (existing?.clientSubmissionId) {
          clientSubmissionIdRef.current = existing.clientSubmissionId;
          const hasFailedMedia = existing.media?.some((m) => m.uploadStatus === 'failed');
          if (hasFailedMedia) {
            setSubmitError('Ảnh trong bản nháp không còn tồn tại trên thiết bị (có thể do hệ thống dọn dẹp cache). Vui lòng chụp lại ảnh.');
          }
        } else {
          await saveSurveyDraft({
            locationId: media.locationId,
            locationName: media.locationName,
            clientSubmissionId: clientSubmissionIdRef.current,
            media: [{ localUri: media.uri, uploadStatus: 'pending' }],
            featureTags: selectedTagKeys,
            textDescription: notes,
            gps: media.gps ? { latitude: media.gps.latitude, longitude: media.gps.longitude, accuracy: media.gps.accuracy ?? undefined } : undefined,
          });
        }
      } catch {}
    }
    void syncDraft();
  }, [media.locationId]);

  React.useEffect(() => {
    if (flow !== 'report') {
      badgeScale.setValue(1);
      badgeOpacity.setValue(1);
      contentOpacity.setValue(1);
      contentTranslateY.setValue(0);
    }
  }, [flow, badgeScale, badgeOpacity, contentOpacity, contentTranslateY]);

  // Keep draft updated when tags or notes change
  React.useEffect(() => {
    if (!media.locationId) return;
    void saveSurveyDraft({
      locationId: media.locationId,
      locationName: media.locationName,
      clientSubmissionId: clientSubmissionIdRef.current,
      media: [{ localUri: media.uri, uploadStatus: 'pending' }],
      featureTags: selectedTagKeys,
      textDescription: notes,
      gps: media.gps ? { latitude: media.gps.latitude, longitude: media.gps.longitude, accuracy: media.gps.accuracy ?? undefined } : undefined,
    }).catch(() => {});
  }, [selectedTagKeys, notes, media.locationId, media.locationName, media.uri, media.gps]);

  const handleResetSubmissionId = async () => {
    clientSubmissionIdRef.current = `mob-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
    setIsConflictError(false);
    setNeedsRetakeOnError(false);
    setSubmitError(null);
    if (media.locationId) {
      await saveSurveyDraft({
        locationId: media.locationId,
        locationName: media.locationName,
        clientSubmissionId: clientSubmissionIdRef.current,
        media: [{ localUri: media.uri, uploadStatus: 'pending' }],
        featureTags: selectedTagKeys,
        textDescription: notes,
        gps: media.gps ? { latitude: media.gps.latitude, longitude: media.gps.longitude, accuracy: media.gps.accuracy ?? undefined } : undefined,
      });
    }
  };

  const submitContribution = async (override?: {
    locationId?: string;
    identityConfirmation?: IdentityConfirmationInput;
  }) => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    if (!media.gps) {
      setSubmitError('Chưa xác định được tọa độ địa điểm. Vui lòng bật GPS hoặc chọn lại địa điểm.');
      return;
    }
    const effectiveLocationId = override?.locationId ?? resolvedLocationIdOverride ?? media.locationId ?? 'custom-location';
    setIsSubmitting(true);
    setSubmitError(null);
    setIsConflictError(false);
    setNeedsRetakeOnError(false);
    try {
      if (media.uri) {
        const fileExists = await defaultFileExistenceChecker(media.uri);
        if (!fileExists) {
          setIsSubmitting(false);
          setSubmitError('Ảnh chụp cục bộ không còn tồn tại trên thiết bị (đã bị dọn dẹp khỏi cache). Vui lòng chụp lại ảnh.');
          if (media.locationId) {
            await saveSurveyDraft({
              locationId: media.locationId,
              locationName: media.locationName,
              clientSubmissionId: clientSubmissionIdRef.current,
              media: [{ localUri: media.uri, uploadStatus: 'failed' }],
              featureTags: selectedTagKeys,
              textDescription: notes,
              gps: media.gps ? { latitude: media.gps.latitude, longitude: media.gps.longitude, accuracy: media.gps.accuracy ?? undefined } : undefined,
            });
          }
          return;
        }
      }

      // 1. Upload the authentic photo to backend so Web Admin can display it
      let uploadedUrl = media.uri;
      if (media.uri.startsWith('file:') || media.uri.startsWith('content:')) {
        try {
          uploadedUrl = await uploadMediaToBackend(media.uri, media.base64, {
            latitude: media.gps.latitude,
            longitude: media.gps.longitude,
            accuracyMeters: media.gps?.accuracy ?? 5.0,
            locationId: effectiveLocationId,
            textDescription: notes || undefined,
            proposedScope,
          });
        } catch (uploadErr) {
          if (
            uploadErr instanceof ApiError &&
            (uploadErr.status === 401 || uploadErr.status === 413 || uploadErr.status === 422)
          ) {
            throw uploadErr;
          }
          console.warn('Could not upload media to server, using local uri fallback', uploadErr);
        }
      }

      const payload = {
        client_submission_id: clientSubmissionIdRef.current,
        location_id: effectiveLocationId,
        user_id: user.id,
        media_urls: [uploadedUrl],
        client_observations: selectedTagKeys,
        observations: confirmedObservations ?? {},
        feature_tags: selectedTagKeys,

        measurements: {
          door_clear_width: userMeasurements?.doorClearWidthCm
            ? {
                status: 'provided',
                value_mm: Math.round(userMeasurements.doorClearWidthCm * 10),
                method: 'tape_measure',
              }
            : {
                status: 'not_measured',
              },
          ramp_slope:
            userMeasurements?.rampHeightCm != null && userMeasurements?.rampLengthCm != null
              ? {
                status: 'provided',
                height_cm: userMeasurements.rampHeightCm,
                length_cm: userMeasurements.rampLengthCm,
                method: 'tape_measure',
              }
            : {
                status: 'not_measured',
              },
        },
        gps_lat: media.gps.latitude,
        gps_lng: media.gps.longitude,
        accuracy_meters: media.gps?.accuracy ?? 5.0,
        is_mocked: (media.gps as any)?.mocked ?? false,
        client_timestamp: media.gps?.timestamp ?? Date.now(),
        text_description: notes || '',
        confidence_score: overallScore / 100,
      };

      const res = await submitContributionToBackend(payload, {
        uploadedUrl,
        locationName: media.locationName,
        proposedScope,
        userMeasurements,
        identityConfirmation: override?.identityConfirmation,
      });

      if (res?.conflict_challenge) {
        setDuplicateChallenge(res.conflict_challenge);
        return;
      }

      if (res && res.submission_id) {
        // Delete draft ONLY when backend confirms submission creation matching current client ID
        if (media.locationId) {
          await deleteSurveyDraftOnSuccess(
            media.locationId,
            res.submission_id,
            clientSubmissionIdRef.current
          );
        }

        addContributionRecord({
          id: res.submission_id,
          locationId: effectiveLocationId,
          locationName: media.locationName,
          mediaUri: media.uri || uploadedUrl,
          mediaType: media.type,
          featureTags: selectedTagKeys,
          textDescription: notes,
          gps: media.gps ? { latitude: media.gps.latitude, longitude: media.gps.longitude } : null,
          status: 'Submitted',
          confidenceScore: overallScore / 100,
          pointsAwarded: res.points_awarded ?? 0,
          createdAt: Date.now(),
        });

        setLiveStatus(null);
        setSubmittedResult({
          submissionId: res.submission_id,
          message: res.message || 'Hồ sơ đã được tiếp nhận. Điểm danh vọng và uy tín sẽ được cộng sau khi kiểm duyệt viên phê duyệt.',
          pointsAwarded: res.points_awarded ?? 0,
        });
      }
    } catch (err: unknown) {
      const mapped = mapContributionError(err);
      setIsConflictError(mapped.isConflict);
      setNeedsRetakeOnError(mapped.needsRetake);
      setSubmitError(mapped.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = () => {
    void submitContribution();
  };

  const handleScoreAnimationComplete = () => {
    Animated.parallel([
      Animated.spring(badgeScale, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(badgeOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 350,
        delay: 100,
        useNativeDriver: true,
      }),
      Animated.timing(contentTranslateY, {
        toValue: 0,
        duration: 350,
        delay: 100,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  };

  let statusBg = 'rgba(5, 150, 105, 0.12)';
  let statusBorder = '#059669';
  let statusIcon: any = 'check-decagram';
  let statusColor = '#059669';

  if (status === 'AwaitingMoreInfo') {
    statusBg = 'rgba(225, 29, 72, 0.12)';
    statusBorder = '#e11d48';
    statusIcon = 'alert-circle-outline';
    statusColor = '#e11d48';
  } else if (overallScore < 80 || !spatialValid || matrixResult.unverifiedTagCount > 0) {
    statusBg = 'rgba(217, 119, 6, 0.12)';
    statusBorder = '#d97706';
    statusIcon = 'clock-alert-outline';
    statusColor = '#d97706';
  }

  const handleAttachToReport = () => {
    if (overallScore < 60) {
      Alert.alert(
        'Độ tin cậy quá thấp',
        `Ảnh minh chứng chỉ đạt ${overallScore}% độ tin cậy AI (yêu cầu tối thiểu 60%).\n\nBáo cáo mâu thuẫn không chấp nhận ảnh độ tin cậy thấp để bảo vệ chất lượng dữ liệu tiếp cận. Vui lòng chụp lại ảnh rõ góc ram dốc hoặc lối vào.`,
        [
          { text: 'Chụp lại ngay', onPress: onRetakeOrReset, style: 'default' },
          { text: 'Đóng', style: 'cancel' },
        ]
      );
      return;
    }

    // Start background upload immediately so it's ready before user finishes typing
    let uploadPromise: Promise<string> | null = null;
    if (media.uri && !media.uri.startsWith('http')) {
      uploadPromise = uploadMediaToBackend(media.uri, media.base64);
      setActiveUploadPromise(uploadPromise);
      uploadPromise
        .then((url) => {
          const draft = getReportDraft();
          if (draft?.evidence) {
            setReportEvidence({
              ...draft.evidence,
              uploadedUrl: url,
              isUploading: false,
            });
          }
        })
        .catch((err) => {
          console.warn('[Background upload error]', err);
          const draft = getReportDraft();
          if (draft?.evidence) {
            setReportEvidence({
              ...draft.evidence,
              isUploading: false,
            });
          }
        });
    }

    setReportEvidence({
      uri: media.uri,
      base64: media.base64,
      aiScore: overallScore,
      confidenceScore: overallScore / 100,
      featureTags: selectedTagKeys,
      aiSummary:
        `Điểm tin cậy AI: ${overallScore}/100 (${statusLabel})\n` +
        `Đánh giá: ${statusDescription}\n` +
        `Đặc tính nhận diện: ${selectedTagKeys.length > 0 ? selectedTagKeys.join(', ') : 'Chung'}` +
        (notes ? `\nGhi chú: ${notes}` : ''),
      matrixResult,
      isUploading: uploadPromise !== null,
    });
    onFinish?.();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        {submittedResult ? (
          <View style={styles.headerSpacer} />
        ) : (
          <Pressable
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            onPress={onEditTags}
            accessibilityRole="button"
            accessibilityLabel="Chỉnh sửa nhãn"
            hitSlop={6}
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color="#0f172a" />
          </Pressable>
        )}
        <View style={styles.headerCenter}>
          <Text style={styles.headerStep}>
            {submittedResult ? 'ĐÃ GỬI HỒ SƠ' : flow === 'report' ? 'MINH CHỨNG BÁO CÁO' : 'BƯỚC 3 / 3'}
          </Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {submittedResult
              ? 'Hoàn tất đóng góp'
              : flow === 'report'
              ? 'Đánh giá AI minh chứng'
              : 'Kết quả đánh giá tiếp cận'}
          </Text>
        </View>
        {submittedResult ? (
          <View style={styles.headerSpacer} />
        ) : (
          <Pressable
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            onPress={onRetakeOrReset}
            accessibilityRole="button"
            accessibilityLabel="Quét lại từ đầu"
            hitSlop={6}
          >
            <MaterialCommunityIcons name="refresh" size={20} color="#475569" />
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {submittedResult ? (
          (() => {
            const effectiveStatus = liveStatus?.status ?? 'Submitted';
            const isPublished =
              effectiveStatus === 'Published' || effectiveStatus === 'Auto-Verified';
            const isAwaitingMoreInfo =
              effectiveStatus === 'AwaitingMoreInfo' || effectiveStatus === 'NeedsSupplement';
            const isRejected =
              effectiveStatus === 'Rejected' || effectiveStatus === 'Cancelled';
            const isPendingModeration =
              effectiveStatus === 'PendingModeration' || effectiveStatus === 'Pending Moderation';

            let heroBorderColor = '#a7f3d0';
            let heroIconBg = '#ecfdf5';
            let heroIconName: React.ComponentProps<typeof MaterialCommunityIcons>['name'] =
              'check-decagram';
            let heroIconColor = '#059669';
            let heroTitle = 'Đã gửi đóng góp thành công';
            let heroSubtitle = 'Cảm ơn bạn đã đóng góp dữ liệu tiếp cận cho cộng đồng.';

            if (isPublished) {
              heroBorderColor = '#6ee7b7';
              heroIconBg = '#d1fae5';
              heroIconName = 'shield-check';
              heroIconColor = '#047857';
              heroTitle = 'Đã phê duyệt & công bố';
              heroSubtitle = 'Dữ liệu tiếp cận của bạn đã được công bố chính thức lên bản đồ.';
            } else if (isAwaitingMoreInfo) {
              heroBorderColor = '#fcd34d';
              heroIconBg = '#fef3c7';
              heroIconName = 'alert-circle-outline';
              heroIconColor = '#d97706';
              heroTitle = 'Cần bổ sung minh chứng';
              heroSubtitle =
                liveStatus?.informationRequestReason ||
                'Kiểm duyệt viên yêu cầu bổ sung thêm ảnh hoặc thông tin trong mục Theo dõi trạng thái hồ sơ.';
            } else if (isRejected) {
              heroBorderColor = '#fecdd3';
              heroIconBg = '#ffe4e6';
              heroIconName = 'close-circle-outline';
              heroIconColor = '#dc2626';
              heroTitle =
                effectiveStatus === 'Cancelled' ? 'Hồ sơ đã được hủy' : 'Hồ sơ không được duyệt';
              heroSubtitle =
                effectiveStatus === 'Cancelled'
                  ? 'Bạn đã hủy hồ sơ đóng góp này.'
                  : 'Hồ sơ không đủ điều kiện công bố. Vui lòng xem chi tiết trong Theo dõi trạng thái hồ sơ.';
            } else if (isPendingModeration) {
              heroTitle = 'Đã xác minh AI · Chờ kiểm duyệt';
              heroSubtitle =
                'Hệ thống AI đã xử lý xong. Hồ sơ đang chờ kiểm duyệt viên xem xét công bố.';
            }

            const displayReceiptCode =
              liveStatus?.submissionCode || submittedResult.submissionId;

            return (
              <>
                {/* Dedicated Post-Submit Receipt Hero */}
                <View style={[styles.receiptHeroCard, { borderColor: heroBorderColor }]}>
                  <View style={[styles.receiptIconWrap, { backgroundColor: heroIconBg }]}>
                    <MaterialCommunityIcons name={heroIconName} size={38} color={heroIconColor} />
                  </View>
                  <Text style={styles.receiptTitle}>{heroTitle}</Text>
                  <Text style={styles.receiptSubtitle}>{heroSubtitle}</Text>
                  <View style={styles.receiptCodePill}>
                    <MaterialCommunityIcons name="identifier" size={14} color="#004e58" />
                    <Text style={styles.receiptCodeText}>Mã hồ sơ: {displayReceiptCode}</Text>
                  </View>
                </View>

                {/* Open Contribution History Sheet */}
                <Pressable
                  style={({ pressed }) => [styles.historyLinkCard, pressed && styles.pressed]}
                  onPress={() => setShowHistorySheet(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Theo dõi trạng thái hồ sơ"
                >
                  <View style={styles.historyLinkIconWrap}>
                    <MaterialCommunityIcons name="clipboard-text-clock-outline" size={20} color="#004e58" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyLinkTitle}>Theo dõi trạng thái hồ sơ</Text>
                    <Text style={styles.historyLinkSub}>
                      Xem tiến độ duyệt hoặc bổ sung ảnh nếu cần
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color="#64748b" />
                </Pressable>

                {/* Location & Confirmed Features */}
                <View style={styles.detailsCard}>
                  <Text style={styles.detailsTitle}>Thông tin đã ghi nhận</Text>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Địa điểm:</Text>
                    <Text style={styles.detailValue} numberOfLines={1}>
                      {locationName || media.locationName}
                    </Text>
                  </View>
                  {selectedTagLabels.length > 0 ? (
                    <View style={styles.tagChipsSection}>
                      <Text style={styles.detailLabel}>Đặc điểm xác nhận ({selectedTagLabels.length}):</Text>
                      <View style={styles.tagChipsWrap}>
                        {selectedTagLabels.map((label) => (
                          <View key={label} style={styles.featureChip}>
                            <MaterialCommunityIcons name="check" size={12} color="#004e58" />
                            <Text style={styles.featureChipText}>{label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>

                {/* Live 3-Step Approval Timeline */}
                <View style={styles.detailsCard}>
                  <View style={styles.timelineHeaderRow}>
                    <Text style={styles.detailsTitle}>Tiến trình xử lý</Text>
                    <Pressable
                      style={({ pressed }) => [styles.timelineRefreshBtn, pressed && styles.pressed]}
                      onPress={() => void refreshSubmissionStatus()}
                      disabled={isRefreshingStatus}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Làm mới trạng thái hồ sơ"
                    >
                      {isRefreshingStatus ? (
                        <ActivityIndicator size="small" color="#004e58" />
                      ) : (
                        <MaterialCommunityIcons name="refresh" size={14} color="#004e58" />
                      )}
                      <Text style={styles.timelineRefreshText}>Làm mới</Text>
                    </Pressable>
                  </View>

                  <View style={styles.timelineRow}>
                    <View style={[styles.timelineDot, styles.timelineDotDone]}>
                      <MaterialCommunityIcons name="check" size={12} color="#ffffff" />
                    </View>
                    <View style={styles.timelineTextCol}>
                      <Text style={styles.timelineTitle}>Đã tiếp nhận hồ sơ</Text>
                      <Text style={styles.timelineDesc}>
                        Lưu minh chứng với mã {displayReceiptCode}.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.timelineConnector} />

                  <View style={styles.timelineRow}>
                    <View
                      style={[
                        styles.timelineDot,
                        isPublished
                          ? styles.timelineDotDone
                          : isAwaitingMoreInfo
                            ? styles.timelineDotWarn
                            : isRejected
                              ? styles.timelineDotError
                              : styles.timelineDotActive,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={
                          isPublished
                            ? 'check'
                            : isAwaitingMoreInfo
                              ? 'alert'
                              : isRejected
                                ? 'close'
                                : 'clock-outline'
                        }
                        size={12}
                        color="#ffffff"
                      />
                    </View>
                    <View style={styles.timelineTextCol}>
                      <Text style={styles.timelineTitle}>
                        {isPublished
                          ? 'AI & kiểm duyệt viên đã xác minh'
                          : isAwaitingMoreInfo
                            ? 'Kiểm duyệt viên yêu cầu bổ sung'
                            : isRejected
                              ? effectiveStatus === 'Cancelled'
                                ? 'Hồ sơ đã hủy'
                                : 'Hồ sơ bị từ chối'
                              : isPendingModeration
                                ? 'Đang chờ kiểm duyệt viên duyệt'
                                : 'AI đang kiểm định & xếp hàng duyệt'}
                      </Text>
                      <Text style={styles.timelineDesc}>
                        {isPublished
                          ? 'Hồ sơ đã hoàn tất đối soát minh chứng.'
                          : isAwaitingMoreInfo
                            ? liveStatus?.informationRequestReason ||
                              'Mở mục Theo dõi trạng thái hồ sơ để nộp lại minh chứng.'
                            : isRejected
                              ? effectiveStatus === 'Cancelled'
                                ? 'Hồ sơ đã dừng xử lý theo yêu cầu của bạn.'
                                : 'Hồ sơ không đạt điều kiện thẩm định để công bố.'
                              : isPendingModeration
                                ? 'Hệ thống AI đã xử lý xong; đang chờ kiểm duyệt viên đối chiếu.'
                                : 'AI đang phân tích minh chứng trước khi chuyển kiểm duyệt viên.'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.timelineConnector} />

                  <View style={styles.timelineRow}>
                    <View
                      style={[
                        styles.timelineDot,
                        isPublished
                          ? styles.timelineDotDone
                          : isRejected
                            ? styles.timelineDotError
                            : styles.timelineDotPending,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={isPublished ? 'star' : isRejected ? 'close' : 'star-outline'}
                        size={12}
                        color={isPublished || isRejected ? '#ffffff' : '#64748b'}
                      />
                    </View>
                    <View style={styles.timelineTextCol}>
                      <Text
                        style={[
                          styles.timelineTitle,
                          !isPublished && !isRejected && { color: '#475569' },
                        ]}
                      >
                        {isPublished
                          ? 'Đã công bố lên bản đồ'
                          : isRejected
                            ? 'Không công bố'
                            : 'Công bố dữ liệu tiếp cận'}
                      </Text>
                      <Text style={styles.timelineDesc}>
                        {isPublished
                          ? 'Các hạng mục đã duyệt đã cập nhật vào dữ liệu địa điểm và ghi nhận điểm đóng góp.'
                          : isRejected
                            ? 'Không có thay đổi nào được công bố lên bản đồ.'
                            : 'Sau khi kiểm duyệt viên phê duyệt, tiện ích sẽ hiển thị trên bản đồ.'}
                      </Text>
                    </View>
                  </View>
                </View>
              </>
            );
          })()
        ) : (
          <>
            {/* Top Hero: Spec-aligned Pre-Submit Readiness (Contribution) or Score Meter (Report) */}
            {flow === 'report' ? (
              <View style={styles.heroCard}>
                <ScoreMeterRing
                  score={overallScore}
                  size={130}
                  strokeWidth={11}
                  animated={true}
                  onAnimationComplete={handleScoreAnimationComplete}
                />

                <Animated.View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor: statusBg,
                      borderColor: statusBorder,
                      opacity: badgeOpacity,
                      transform: [{ scale: badgeScale }],
                    },
                  ]}
                >
                  <MaterialCommunityIcons name={statusIcon} size={18} color={statusColor} />
                  <Text style={[styles.statusTitle, { color: statusColor }]}>{statusLabel}</Text>
                </Animated.View>

                <Animated.View
                  style={{
                    width: '100%',
                    alignItems: 'center',
                    opacity: contentOpacity,
                    transform: [{ translateY: contentTranslateY }],
                  }}
                >
                  <Text style={styles.statusDescription}>{statusDescription}</Text>
                </Animated.View>
              </View>
            ) : (
              (() => {
                const hasReadinessWarning =
                  Boolean(qualityWarning) || selectedTagKeys.length === 0 || !spatialValid;
                const readinessBadgeText =
                  selectedTagKeys.length === 0
                    ? 'Chưa chọn đặc điểm'
                    : qualityWarning
                      ? 'Ảnh cần kiểm tra lại'
                      : !spatialValid
                        ? 'Vị trí GPS bị lệch'
                        : 'Sẵn sàng gửi kiểm duyệt';
                const readinessDesc = qualityWarning
                  ? qualityWarning
                  : selectedTagKeys.length === 0
                    ? 'Bạn chưa chọn đặc điểm tiếp cận nào ở Bước 2. Nên quay lại chọn ít nhất 1 đặc điểm trước khi gửi.'
                    : !spatialValid
                      ? `Vị trí thiết bị đang cách địa điểm ${spatialDistanceMeters ?? '> 50'}m (vượt bán kính 50m). Nên chọn lại đúng vị trí hoặc chụp gần lối vào hơn trước khi gửi.`
                      : 'Hồ sơ đã sẵn sàng. Điểm tin cậy chính thức sẽ được hệ thống AI máy chủ thẩm định sau khi gửi để kiểm duyệt viên xét duyệt.';

                return (
                  <View style={styles.heroCard}>
                    <View
                      style={[
                        styles.readinessIconWrap,
                        {
                          backgroundColor: hasReadinessWarning ? '#fef3c7' : '#ecfdf5',
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={hasReadinessWarning ? 'alert-circle-outline' : 'shield-check-outline'}
                        size={34}
                        color={hasReadinessWarning ? '#d97706' : '#059669'}
                      />
                    </View>

                    <Text style={styles.readinessTitle}>Kiểm tra sơ bộ trước khi gửi</Text>

                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: hasReadinessWarning
                            ? 'rgba(217, 119, 6, 0.12)'
                            : 'rgba(5, 150, 105, 0.12)',
                          borderColor: hasReadinessWarning ? '#d97706' : '#059669',
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={hasReadinessWarning ? 'alert-outline' : 'check-circle-outline'}
                        size={16}
                        color={hasReadinessWarning ? '#d97706' : '#059669'}
                      />
                      <Text
                        style={[
                          styles.statusTitle,
                          {
                            color: hasReadinessWarning ? '#d97706' : '#059669',
                          },
                        ]}
                      >
                        {readinessBadgeText}
                      </Text>
                    </View>

                    <Text style={styles.statusDescription}>{readinessDesc}</Text>

                    {qualityWarning ? (
                      <Pressable
                        style={({ pressed }) => [styles.readinessRetakeBtn, pressed && styles.pressed]}
                        onPress={onRetakeOrReset}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Chụp lại ảnh rõ hơn"
                      >
                        <MaterialCommunityIcons name="camera-retake-outline" size={16} color="#92400e" />
                        <Text style={styles.readinessRetakeText}>Chụp lại ảnh rõ hơn</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })()
            )}

            {/* Breakdown Matrix & Details */}
            <Animated.View
              style={{
                opacity: contentOpacity,
                transform: [{ translateY: contentTranslateY }],
              }}
            >
              <ScoreMatrixBreakdown
                matrixResult={matrixResult}
                pillars={pillars}
                spatialValid={spatialValid}
                spatialDistanceMeters={spatialDistanceMeters}
                selectedTagKeys={selectedTagKeys}
                mediaType={media.type === 'video' ? 'video' : 'photo'}
              />

              {flow === 'report' ? (
                <ScoreCriteriaExplainer
                  overallScore={overallScore}
                  hasNoFeatures={selectedTagKeys.length === 0}
                  cvScore={pillars.computerVision.score}
                  spatialDistanceMeters={spatialDistanceMeters}
                  mediaType={media.type === 'video' ? 'video' : 'photo'}
                  hasNotes={Boolean(notes.trim())}
                />
              ) : null}

              {/* POI & Submission Details Card */}
              <View style={styles.detailsCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={styles.detailsTitle}>Thông tin ghi nhận</Text>
                  {onChangeLocation ? (
                    <Pressable
                      style={({ pressed }) => [
                        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f0fdfa' },
                        pressed && styles.pressed,
                      ]}
                      onPress={onChangeLocation}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Đổi vị trí địa điểm"
                    >
                      <MaterialCommunityIcons name="pencil-outline" size={13} color="#006874" />
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#006874' }}>Đổi vị trí</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Địa điểm:</Text>
                  <Text style={styles.detailValue} numberOfLines={1}>
                    {locationName || media.locationName}
                  </Text>
                </View>
                {locationAddress ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Địa chỉ:</Text>
                    <Text style={styles.detailValue} numberOfLines={1}>
                      {locationAddress}
                    </Text>
                  </View>
                ) : null}
                {proposedScope ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Phạm vi:</Text>
                    <Text style={styles.detailValue} numberOfLines={1}>
                      {formatScopeSummary(proposedScope)}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.tagChipsSection}>
                  <Text style={styles.detailLabel}>
                    Đặc tính đã chọn ({selectedTagLabels.length}):
                  </Text>
                  {selectedTagLabels.length > 0 ? (
                    <View style={styles.tagChipsWrap}>
                      {selectedTagLabels.map((label) => (
                        <View key={label} style={styles.featureChip}>
                          <MaterialCommunityIcons name="check" size={12} color="#004e58" />
                          <Text style={styles.featureChipText}>{label}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.detailEmptyText}>Chưa chọn đặc tính nào</Text>
                  )}
                </View>
                {userMeasurements?.doorClearWidthCm ||
                (userMeasurements?.rampHeightCm != null && userMeasurements?.rampLengthCm != null) ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Số đo kỹ thuật:</Text>
                    <Text style={styles.detailValue} numberOfLines={1}>
                      {[
                        userMeasurements?.doorClearWidthCm ? `Cửa ${userMeasurements.doorClearWidthCm} cm` : null,
                        userMeasurements?.rampHeightCm != null && userMeasurements?.rampLengthCm != null
                          ? `Dốc ${userMeasurements.rampHeightCm}/${userMeasurements.rampLengthCm} cm`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                ) : null}
                {notes ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Ghi chú:</Text>
                    <Text style={styles.detailValue} numberOfLines={2}>
                      "{notes}"
                    </Text>
                  </View>
                ) : null}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Ghi nhận điểm:</Text>
                  <View style={styles.expPill}>
                    <MaterialCommunityIcons name="star-circle-outline" size={14} color="#b45309" />
                    <Text style={styles.expPillText}>
                      {flow === 'report' ? '+1 danh vọng · +1 uy tín khi xác nhận' : '+2~5 danh vọng · +2 uy tín khi công bố'}
                    </Text>
                  </View>
                </View>
              </View>
            </Animated.View>
          </>
        )}
      </ScrollView>

      {/* Bottom Actions with Docked Status Notification */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) + 6 }]}>
        {submitError ? (
          <View style={styles.dockedAlertBanner}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#e11d48" />
            <View style={{ flex: 1 }}>
              <Text style={styles.dockedAlertTitle}>
                {isConflictError ? 'Hồ sơ đã được gửi trước đó' : 'Lỗi gửi hồ sơ'}
              </Text>
              <Text style={styles.dockedAlertText}>{submitError}</Text>
              {isConflictError && (
                <Pressable
                  style={styles.dockedConflictResetBtn}
                  onPress={handleResetSubmissionId}
                  accessibilityRole="button"
                  accessibilityLabel="Tạo phiên mới và thử lại"
                  hitSlop={8}
                >
                  <MaterialCommunityIcons name="refresh" size={12} color="#9f1239" />
                  <Text style={styles.dockedConflictResetText}>Tạo phiên mới và thử lại</Text>
                </Pressable>
              )}
              {needsRetakeOnError && (
                <Pressable
                  style={styles.dockedRetakeBtn}
                  onPress={onRetakeOrReset}
                  accessibilityRole="button"
                  accessibilityLabel="Chụp hoặc chọn lại ảnh"
                >
                  <MaterialCommunityIcons name="camera-retake-outline" size={15} color="#9f1239" />
                  <Text style={styles.dockedRetakeText}>Chụp / chọn lại ảnh</Text>
                </Pressable>
              )}
            </View>
          </View>
        ) : null}

        <View style={styles.bottomButtonsRow}>
          {flow === 'report' ? (
            <>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
                onPress={onEditTags}
                accessibilityRole="button"
                accessibilityLabel="Sửa đặc tính"
              >
                <MaterialCommunityIcons name="tag-outline" size={16} color="#334155" />
                <Text style={styles.secondaryBtnText}>Sửa đặc tính</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                onPress={handleAttachToReport}
                accessibilityRole="button"
                accessibilityLabel="Đính kèm vào báo cáo"
              >
                <MaterialCommunityIcons name="clipboard-check-outline" size={18} color="#ffffff" />
                <Text style={styles.primaryBtnText}>Đính kèm vào báo cáo</Text>
              </Pressable>
            </>
          ) : submittedResult ? (
            <>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
                onPress={onRetakeOrReset}
                accessibilityRole="button"
                accessibilityLabel="Đóng góp khác"
              >
                <MaterialCommunityIcons name="camera-retake" size={16} color="#334155" />
                <Text style={styles.secondaryBtnText}>Đóng góp khác</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                onPress={onFinish || onRetakeOrReset}
                accessibilityRole="button"
                accessibilityLabel="Về bản đồ"
              >
                <MaterialCommunityIcons name="map-outline" size={16} color="#ffffff" />
                <Text style={styles.primaryBtnText}>Về bản đồ</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
                onPress={onEditTags}
                accessibilityRole="button"
                accessibilityLabel="Sửa đặc tính"
                disabled={isSubmitting}
              >
                <MaterialCommunityIcons name="tag-outline" size={16} color="#334155" />
                <Text style={styles.secondaryBtnText}>Sửa đặc tính</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && styles.pressed,
                  isSubmitting && { opacity: 0.8 },
                ]}
                onPress={handleSubmit}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Gửi đóng góp"
              >
                {isSubmitting ? (
                  <>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text style={styles.primaryBtnText}>Đang gửi...</Text>
                  </>
                ) : (
                  <>
                    <MaterialCommunityIcons name="send" size={16} color="#ffffff" />
                    <Text style={styles.primaryBtnText}>Gửi đóng góp</Text>
                  </>
                )}
              </Pressable>
            </>
          )}
        </View>
      </View>

      <LoginRequiredModal
        visible={showLoginModal}
        featureName="xuất bản dữ liệu tiếp cận và tích lũy điểm danh vọng"
        onClose={() => setShowLoginModal(false)}
      />

      <ContributionHistorySheet
        visible={showHistorySheet}
        onClose={() => {
          setShowHistorySheet(false);
          if (submittedResult) {
            void refreshSubmissionStatus();
          }
        }}
      />

      <Modal
        visible={Boolean(duplicateChallenge)}
        transparent
        animationType="slide"
        onRequestClose={() => setDuplicateChallenge(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            justifyContent: 'flex-end',
          }}
        >
          <View
            style={{
              backgroundColor: '#ffffff',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 20,
              gap: 12,
              maxHeight: '80%',
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>
              Phát hiện địa điểm tương tự gần đây
            </Text>
            <Text style={{ fontSize: 12.5, color: '#475569', lineHeight: 18 }}>
              Hệ thống tìm thấy địa điểm trùng khớp hoặc lân cận. Chọn địa điểm có sẵn hoặc xác nhận đây là địa điểm riêng biệt.
            </Text>

            <ScrollView style={{ maxHeight: 200 }}>
              {(duplicateChallenge?.candidates ?? []).map((cand) => (
                <Pressable
                  key={cand.locationId}
                  onPress={() => {
                    setDuplicateChallenge(null);
                    setResolvedLocationIdOverride(cand.locationId);
                    void submitContribution({
                      locationId: cand.locationId,
                    });
                  }}
                  style={{
                    minHeight: 48,
                    padding: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#cbd5e1',
                    backgroundColor: '#f8fafc',
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#004e58' }}>{cand.name}</Text>
                  {cand.address ? (
                    <Text style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>{cand.address}</Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>

            <TextInput
              value={confirmDistinctReason}
              onChangeText={setConfirmDistinctReason}
              placeholder="Lý do xác nhận địa điểm riêng biệt (>= 10 ký tự)..."
              placeholderTextColor="#94a3b8"
              style={{
                minHeight: 44,
                borderWidth: 1,
                borderColor: '#cbd5e1',
                borderRadius: 12,
                paddingHorizontal: 12,
                fontSize: 13,
                color: '#0f172a',
              }}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setDuplicateChallenge(null)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 12,
                  backgroundColor: '#f1f5f9',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontWeight: '700', color: '#334155' }}>Đóng</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const trimmed = confirmDistinctReason.trim();
                  if (trimmed.length < 10) {
                    setSubmitError('Vui lòng nhập lý do xác nhận địa điểm mới tối thiểu 10 ký tự.');
                    return;
                  }
                  const challenge = duplicateChallenge;
                  setDuplicateChallenge(null);
                  if (challenge) {
                    void submitContribution({
                      identityConfirmation: {
                        decision: 'DistinctPlace',
                        confirmationToken: challenge.confirmationToken,
                        reason: trimmed,
                      },
                    });
                  }
                }}
                style={{
                  flex: 1.5,
                  minHeight: 44,
                  borderRadius: 12,
                  backgroundColor: '#004e58',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontWeight: '700', color: '#ffffff' }}>Xác nhận địa điểm mới</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8faf9',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  headerCenter: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerStep: {
    fontSize: 10,
    fontWeight: '700',
    color: '#004e58',
    letterSpacing: 0.8,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  readinessIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readinessTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  readinessRetakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  readinessRetakeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
  },
  statusTitle: {
    fontSize: 13.5,
    fontWeight: '800',
  },
  statusDescription: {
    fontSize: 12,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  detailsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  detailsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
    maxWidth: '65%',
  },
  expPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  expPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#b45309',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingHorizontal: 16,
    paddingTop: 10,
    flexDirection: 'column',
    gap: 8,
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  dockedAlertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
    width: '100%',
  },
  dockedAlertTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9f1239',
  },
  dockedAlertText: {
    fontSize: 11,
    color: '#be123c',
    lineHeight: 15,
    marginTop: 1,
  },
  dockedConflictResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ffe4e6',
    borderWidth: 1,
    borderColor: '#fecdd3',
    minHeight: 40,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  dockedConflictResetText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9f1239',
  },
  dockedRetakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffe4e6',
    borderWidth: 1,
    borderColor: '#fecdd3',
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  dockedRetakeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9f1239',
  },
  tagChipsSection: {
    gap: 6,
    paddingTop: 2,
  },
  tagChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  featureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f0fdfa',
    borderWidth: 1,
    borderColor: '#ccfbf1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  featureChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#004e58',
  },
  detailEmptyText: {
    fontSize: 11.5,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  receiptHeroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  receiptIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  receiptTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  receiptSubtitle: {
    fontSize: 12.5,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
  },
  receiptCodePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f0fdfa',
    borderWidth: 1,
    borderColor: '#ccfbf1',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    marginTop: 4,
  },
  receiptCodeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#004e58',
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  timelineRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#f0fdfa',
    borderWidth: 1,
    borderColor: '#ccfbf1',
  },
  timelineRefreshText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#004e58',
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  timelineDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  timelineDotDone: {
    backgroundColor: '#059669',
  },
  timelineDotActive: {
    backgroundColor: '#004e58',
  },
  timelineDotWarn: {
    backgroundColor: '#d97706',
  },
  timelineDotError: {
    backgroundColor: '#dc2626',
  },
  timelineDotPending: {
    backgroundColor: '#e2e8f0',
  },
  timelineConnector: {
    width: 2,
    height: 14,
    backgroundColor: '#e2e8f0',
    marginLeft: 10,
    marginVertical: 2,
  },
  timelineTextCol: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0f172a',
  },
  timelineDesc: {
    fontSize: 11.5,
    color: '#64748b',
    lineHeight: 16,
    marginTop: 1,
  },
  historyLinkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    padding: 14,
  },
  historyLinkIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#f0fdfa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyLinkTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#004e58',
  },
  historyLinkSub: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 1,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderRadius: 12,
    gap: 6,
  },
  secondaryBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#334155',
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#004e58',
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderRadius: 12,
    gap: 6,
    shadowColor: '#004e58',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#ffffff',
  },
});
