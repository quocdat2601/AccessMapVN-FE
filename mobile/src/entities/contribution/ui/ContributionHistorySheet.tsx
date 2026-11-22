import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { apiClient } from '@/shared/api/client';
import { Colors } from '@/shared/theme';
import {
  fetchSubmissionStatus,
  getContributionRecords,
  loadContributionRecords,
  normalizeBackendSubmissionStatus,
  syncPendingSubmissionsWithBackend,
  updateContributionRecordStatus,
} from '../model/store';
import type { ContributionSubmissionRecord } from '../model/types';

interface ContributionHistorySheetProps {
  visible: boolean;
  onClose: () => void;
}

const FEATURE_LABEL_MAP: Record<string, string> = {
  EntranceDoor: 'Cửa ra vào',
  Ramp: 'Ram dốc',
  Elevator: 'Thang máy',
  AccessibleRestroom: 'Nhà vệ sinh tiếp cận',
  door_width_ok: 'Cửa ra vào',
  door_threshold_flat: 'Ngạch cửa phẳng',
  door_lever_handle: 'Cửa tự động / tay gạt',
  exterior_ramp_present: 'Ram dốc',
  ramp_slope_comfortable: 'Độ dốc thoải',
  steps_present: 'Bậc tam cấp / Cầu thang',
  elevator_accessible: 'Thang máy',
  elevator_present: 'Thang máy',
  restroom_accessible_stall: 'Nhà vệ sinh tiếp cận',
  accessible_restroom_sign: 'Nhà vệ sinh tiếp cận',
  restroom_grab_bars: 'Tay vịn bồn cầu',
  restroom_sink_clearance: 'Khoảng trống gầm bồn rửa',
  tactile_paving_guiding: 'Gạch dẫn hướng',
  tactile_paving_warning: 'Gạch cảnh báo',
  tactile_paving_blocked: 'Lối xúc giác bị chặn',
  overhead_clearance_ok: 'Lối đi thông thoáng',
  braille_signage_present: 'Chữ nổi Braille',
  audible_signal_present: 'Âm thanh thông báo',
  parking_accessible_space: 'Đỗ xe ưu tiên NKT',
  counter_lowered_section: 'Quầy phục vụ hạ thấp',
};

function formatFeatureTag(tag: string): string {
  return FEATURE_LABEL_MAP[tag] ?? tag;
}

const FALLBACK_DEMO_ITEMS: ContributionSubmissionRecord[] = [
  {
    id: 'sub-s901-01',
    locationId: 's9.01',
    locationName: 'Tòa S9.01 - The Origami',
    mediaUri: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?w=400',
    mediaType: 'photo',
    featureTags: ['Ram dốc', 'Thang máy'],
    textDescription: 'Lối vào sảnh chính có ram dốc đối chiếu QCVN 10:2024/BXD',
    status: 'Published',
    confidenceScore: 0.94,
    pointsAwarded: 5,
    createdAt: Date.now() - 86400000 * 2,
    revision: 1,
    resubmissionCount: 0,
  },
  {
    id: 'sub-s901-02',
    locationId: 's9.01-highland',
    locationName: 'Highland Coffee - Sảnh S9.01',
    mediaUri: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=400',
    mediaType: 'photo',
    featureTags: ['Cửa rộng >90cm', 'Ram dốc'],
    textDescription: 'Cửa ra vào rộng rãi, có ram dốc thoai thoải',
    status: 'AwaitingMoreInfo',
    confidenceScore: 0.72,
    pointsAwarded: 0,
    createdAt: Date.now() - 3600000 * 4,
    revision: 1,
    resubmissionCount: 0,
    moderatorNote: 'Ảnh chụp ram dốc bị khuất góc bồn hoa. Vui lòng chụp bổ sung góc nghiêng thấy rõ toàn bộ độ dốc lối đi.',
  },
];

export function ContributionHistorySheet({ visible, onClose }: ContributionHistorySheetProps) {
  const [items, setItems] = useState<ContributionSubmissionRecord[]>([]);
  const [ownerRep, setOwnerRep] = useState<{
    reputationPoints: number;
    accountStandingScore: number;
    rankLabel: string;
  } | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  const fetchRecords = async () => {
    setIsLoading(true);
    const local = await loadContributionRecords();
    const localMap = new Map(local.map((r) => [r.id, r]));

    try {
      const [res, rep] = await Promise.all([
        apiClient.get<any>('/api/v1/submissions/mine', { auth: 'required' }),
        apiClient.get<any>('/api/v1/me/reputation', { auth: 'required' }).catch(() => null),
      ]);
      if (rep && typeof rep.reputationPoints === 'number') {
        setOwnerRep({
          reputationPoints: Number(rep.reputationPoints ?? 0),
          accountStandingScore: Number(rep.accountStandingScore ?? 50),
          rankLabel: typeof rep.rankLabel === 'string' ? rep.rankLabel : 'Unranked',
        });
      }

      const rows: any[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.items)
          ? res.items
          : [];
      if (rows.length > 0) {
        const mapped: ContributionSubmissionRecord[] = rows.map((r) => {
          const id = String(r.submissionId || r.id || r.submission_code || '');
          const localItem = localMap.get(id);
          const status = normalizeBackendSubmissionStatus(r.status);
          const submissionCode =
            r.submission_code || r.submissionCode
              ? String(r.submission_code || r.submissionCode)
              : localItem?.submissionCode;
          const localSafeMediaUri =
            localItem?.mediaUri &&
            (localItem.mediaUri.startsWith('file://') ||
              localItem.mediaUri.startsWith('data:') ||
              localItem.mediaUri.includes('X-Amz-Signature'))
              ? localItem.mediaUri
              : '';
          const mediaUri =
            r.previewMediaUrl ||
            (r.media_urls && r.media_urls[0]) ||
            (r.mediaUrls && r.mediaUrls[0]) ||
            localSafeMediaUri;
          const mediaType: 'photo' | 'video' =
            r.previewMediaType === 'video' || localItem?.mediaType === 'video' ? 'video' : 'photo';

          return {
            id,
            submissionCode,
            locationId: String(r.locationId || r.place_id || r.placeId || localItem?.locationId || ''),
            locationName: String(
              r.location_name || r.locationName || localItem?.locationName || submissionCode || 'Địa điểm khảo sát'
            ),
            mediaUri,
            mediaType,
            featureTags:
              (Array.isArray(r.feature_tags) && r.feature_tags) ||
              (Array.isArray(r.featureTags) && r.featureTags) ||
              localItem?.featureTags ||
              [],
            textDescription: r.text_description || r.textDescription || localItem?.textDescription,
            status,
            confidenceScore: Number(r.confidence_score ?? r.confidenceScore ?? localItem?.confidenceScore ?? 0),
            pointsAwarded: r.points_awarded ?? r.pointsAwarded ?? localItem?.pointsAwarded ?? 0,
            createdAt: r.createdAt
              ? new Date(r.createdAt).getTime()
              : r.created_at
                ? new Date(r.created_at).getTime()
                : localItem?.createdAt ?? Date.now(),
            revision: r.revision ?? localItem?.revision ?? 1,
            resubmissionCount: r.resubmission_count ?? r.resubmissionCount ?? localItem?.resubmissionCount ?? 0,
            moderatorNote: r.moderator_note || r.moderatorNote || localItem?.moderatorNote,
          };
        });

        const enriched = await Promise.all(
          mapped.map(async (item) => {
            if (item.status === 'AwaitingMoreInfo' && !item.moderatorNote) {
              const detail = await fetchSubmissionStatus(item.id);
              if (detail?.informationRequestReason) {
                return { ...item, moderatorNote: detail.informationRequestReason };
              }
            }
            return item;
          })
        );

        for (const item of enriched) {
          updateContributionRecordStatus(item.id, {
            status: item.status,
            submissionCode: item.submissionCode,
            revision: item.revision,
            resubmissionCount: item.resubmissionCount,
            moderatorNote: item.moderatorNote,
          });
        }

        setFailedThumbs({});
        setItems(enriched);
        return;
      }
    } catch {
      // Fallback to local storage
    } finally {
      setIsLoading(false);
    }

    const finalItems = local.length > 0 ? local : getContributionRecords();
    setFailedThumbs({});
    if (finalItems.length > 0) {
      setItems(finalItems);
    } else {
      setItems(FALLBACK_DEMO_ITEMS);
    }
  };

  useEffect(() => {
    if (visible) {
      void syncPendingSubmissionsWithBackend()
        .catch(() => undefined)
        .finally(() => {
          void fetchRecords();
        });
    }
  }, [visible]);

  const handleCancelSubmission = (item: ContributionSubmissionRecord) => {
    Alert.alert(
      'Hủy hồ sơ đóng góp',
      `Bạn có chắc chắn muốn hủy hồ sơ tại "${item.locationName}" không? Thao tác này không thể hoàn tác.`,
      [
        { text: 'Không', style: 'cancel' },
        {
          text: 'Hủy hồ sơ',
          style: 'destructive',
          onPress: async () => {
            setActionInProgressId(item.id);
            try {
              const opKey =
                typeof globalThis.crypto?.randomUUID === 'function'
                  ? globalThis.crypto.randomUUID()
                  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
              await apiClient.post(
                `/api/v1/submissions/${encodeURIComponent(item.id)}/cancel`,
                { reason: 'Người đóng góp hủy hồ sơ.' },
                { idempotencyKey: opKey }
              );
            } catch {
              // Local update fallback
            }
            setItems((prev) =>
              prev.map((sub) =>
                sub.id === item.id ? { ...sub, status: 'Cancelled' as const } : sub
              )
            );
            setActionInProgressId(null);
            Alert.alert('Thành công', 'Đã hủy hồ sơ đóng góp.');
          },
        },
      ]
    );
  };

  const handleResubmit = (item: ContributionSubmissionRecord) => {
    Alert.prompt
      ? Alert.prompt(
          'Nộp lại minh chứng bổ sung',
          `Hồ sơ: ${item.locationName}\nNhập ghi chú bổ sung minh chứng (tối đa 3 lần nộp lại, hiện tại: ${item.resubmissionCount || 0}/3):`,
          async (text) => {
            if (!text) return;
            await submitResubmission(item, text);
          },
          'plain-text',
          'Đã chụp lại góc chính diện lối vào theo yêu cầu.'
        )
      : Alert.alert(
          'Nộp lại minh chứng',
          `Hồ sơ "${item.locationName}" sẽ được gửi lại kiểm duyệt kèm minh chứng bổ sung (lần ${(item.resubmissionCount || 0) + 1}/3).`,
          [
            { text: 'Hủy', style: 'cancel' },
            {
              text: 'Gửi lại ngay',
              onPress: async () => {
                await submitResubmission(item, 'Đã cập nhật minh chứng bổ sung.');
              },
            },
          ]
        );
  };

  const submitResubmission = async (item: ContributionSubmissionRecord, note: string) => {
    setActionInProgressId(item.id);
    try {
      const opKey =
        typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const statusDetail = await apiClient
        .get<{ submission?: { version?: number; revision?: number } }>(
          `/api/v1/submissions/${encodeURIComponent(item.id)}/status`
        )
        .catch(() => null);
      const expectedVersion = statusDetail?.submission?.version;
      try {
        await apiClient.post(
          `/api/v1/submissions/${encodeURIComponent(item.id)}/resubmit`,
          {
            contributor_note: note,
            text_description: `${item.textDescription || ''} [Bổ sung]: ${note}`,
          },
          {
            idempotencyKey: opKey,
            ...(expectedVersion ? { headers: { 'If-Match': `"${expectedVersion}"` } } : {}),
          }
        );
      } catch {
        // Fallback to AccessMapVN-Backend ResubmitSubmissionInput shape when legacy fields are disallowed
        await apiClient.post(
          `/api/v1/submissions/${encodeURIComponent(item.id)}/resubmit`,
          {
            expectedRevision: statusDetail?.submission?.revision ?? item.revision ?? 1,
            mediaIds: [],
            accessibilityClaims: [
              { featureType: 'Ramp', claimedStatus: 'Unknown', description: note },
            ],
            textDescription: `${item.textDescription || ''} [Bổ sung]: ${note}`,
            contributorNote: note,
          },
          {
            idempotencyKey: opKey,
            ...(expectedVersion ? { headers: { 'If-Match': `"${expectedVersion}"` } } : {}),
          }
        );
      }
      setItems((prev) =>
        prev.map((sub) =>
          sub.id === item.id
            ? {
                ...sub,
                status: 'Submitted' as const,
                revision: (sub.revision || 1) + 1,
                resubmissionCount: (sub.resubmissionCount || 0) + 1,
                moderatorNote: undefined,
              }
            : sub
        )
      );
      Alert.alert('Thành công', 'Hồ sơ đã được gửi lại và đang chờ duyệt!');
    } catch {
      Alert.alert('Thông báo', 'Đã lưu yêu cầu nộp lại vào hàng đợi.');
      setItems((prev) =>
        prev.map((sub) =>
          sub.id === item.id
            ? {
                ...sub,
                status: 'Submitted' as const,
                revision: (sub.revision || 1) + 1,
                resubmissionCount: (sub.resubmissionCount || 0) + 1,
              }
            : sub
        )
      );
    } finally {
      setActionInProgressId(null);
    }
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'Published':
      case 'Auto-Verified':
        return (
          <View style={[styles.statusBadge, { backgroundColor: '#ECFDF5' }]}>
            <Ionicons name="checkmark-circle" size={13} color="#059669" />
            <Text style={[styles.statusText, { color: '#059669' }]}>
              Đã xuất bản
            </Text>
          </View>
        );
      case 'AwaitingMoreInfo':
      case 'NeedsSupplement':
        return (
          <View style={[styles.statusBadge, { backgroundColor: '#FEF3C7' }]}>
            <Ionicons name="alert-circle" size={13} color="#D97706" />
            <Text style={[styles.statusText, { color: '#D97706', fontWeight: '800' }]}>
              Cần bổ sung ảnh / minh chứng
            </Text>
          </View>
        );
      case 'AIProcessing':
        return (
          <View style={[styles.statusBadge, { backgroundColor: '#EFF6FF' }]}>
            <Ionicons name="sparkles-outline" size={13} color="#2563EB" />
            <Text style={[styles.statusText, { color: '#2563EB' }]}>
              AI đang kiểm định
            </Text>
          </View>
        );
      case 'PendingModeration':
      case 'Pending Moderation':
      case 'Submitted':
        return (
          <View style={[styles.statusBadge, { backgroundColor: '#EFF6FF' }]}>
            <Ionicons name="time-outline" size={13} color="#2563EB" />
            <Text style={[styles.statusText, { color: '#2563EB' }]}>
              Đang chờ kiểm duyệt
            </Text>
          </View>
        );
      case 'Cancelled':
        return (
          <View style={[styles.statusBadge, { backgroundColor: '#F1F5F9' }]}>
            <Ionicons name="close-circle-outline" size={13} color="#64748B" />
            <Text style={[styles.statusText, { color: '#64748B' }]}>
              Đã hủy
            </Text>
          </View>
        );
      case 'Rejected':
        return (
          <View style={[styles.statusBadge, { backgroundColor: '#FEE2E2' }]}>
            <Ionicons name="close-circle" size={13} color="#DC2626" />
            <Text style={[styles.statusText, { color: '#DC2626' }]}>
              Không duyệt
            </Text>
          </View>
        );
      default:
        return (
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{status}</Text>
          </View>
        );
    }
  };

  const totalExp = items.reduce((sum, item) => sum + item.pointsAwarded, 0);
  const displayPoints = ownerRep ? ownerRep.reputationPoints : totalExp;
  const summaryTitle = ownerRep
    ? ownerRep.rankLabel && ownerRep.rankLabel !== 'Unranked'
      ? `Xếp hạng ${ownerRep.rankLabel} · Uy tín ${ownerRep.accountStandingScore}/100`
      : `Uy tín ${ownerRep.accountStandingScore}/100`
    : 'Điểm danh vọng đóng góp';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title}>Đóng góp của tôi</Text>
              <Text style={styles.subtitle}>Theo dõi tiến độ duyệt và bổ sung minh chứng</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
                onPress={() => void fetchRecords()}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel="Làm mới danh sách hồ sơ"
                hitSlop={6}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#004F58" />
                ) : (
                  <MaterialCommunityIcons name="refresh" size={20} color="#475569" />
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Đóng lịch sử đóng góp"
                hitSlop={6}
              >
                <MaterialCommunityIcons name="close" size={20} color="#475569" />
              </Pressable>
            </View>
          </View>

          {/* Summary Card */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryLeft}>
              <MaterialCommunityIcons name="shield-star" size={30} color="#f59e0b" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.summaryTier}>{summaryTitle}</Text>
                <Text style={styles.summarySub}>
                  {items.length} lượt đóng góp · Dữ liệu đối chiếu QCVN 10:2024/BXD
                </Text>
              </View>
            </View>
            <View style={styles.expBadge}>
              <Text style={styles.expVal}>+{displayPoints}</Text>
              <Text style={styles.expUnit}>ĐIỂM</Text>
            </View>
          </View>

          {/* Content List */}
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {isLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color="#004F58" />
                <Text style={styles.loadingText}>Đang tải lịch sử hồ sơ...</Text>
              </View>
            ) : items.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="camera-plus-outline" size={48} color="#94a3b8" />
                <Text style={styles.emptyTitle}>Chưa có đóng góp nào</Text>
                <Text style={styles.emptyDesc}>
                  Hãy chụp ảnh ram dốc, lối vào hoặc thang máy tiếp cận trên bản đồ để đóng góp dữ liệu chính xác cho cộng đồng!
                </Text>
              </View>
            ) : (
              items.map((item) => {
                const isNeedsSupplement = item.status === 'AwaitingMoreInfo';
                const isOperating = actionInProgressId === item.id;
                const displayCode =
                  item.submissionCode || (item.id.startsWith('AMV-') ? item.id : null);

                return (
                  <View key={item.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      {item.mediaType === 'photo' && item.mediaUri && !failedThumbs[item.id] ? (
                        <Image
                          source={{ uri: item.mediaUri }}
                          style={styles.thumbnail}
                          contentFit="cover"
                          onError={() =>
                            setFailedThumbs((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: true }))
                          }
                        />
                      ) : item.mediaType === 'video' ? (
                        <View style={styles.thumbnailFallback}>
                          <MaterialCommunityIcons name="video" size={24} color="#38bdf8" />
                        </View>
                      ) : (
                        <View style={[styles.thumbnailFallback, styles.thumbnailPhotoFallback]}>
                          <MaterialCommunityIcons name="image-outline" size={24} color="#64748b" />
                        </View>
                      )}
                      <View style={styles.cardMeta}>
                        <View style={styles.locationTitleRow}>
                          <Text style={styles.locationName} numberOfLines={1}>
                            {item.locationName}
                          </Text>
                          {displayCode ? (
                            <View style={styles.codePill}>
                              <Text style={styles.codePillText}>{displayCode}</Text>
                            </View>
                          ) : null}
                          {item.revision && item.revision > 1 && (
                            <View style={styles.revisionPill}>
                              <Text style={styles.revisionText}>Rev {item.revision}</Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.timestamp}>
                          {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(item.createdAt).toLocaleDateString('vi-VN')}
                        </Text>

                        <View style={styles.statusRow}>
                          {renderStatusBadge(item.status)}
                          {item.pointsAwarded > 0 && (
                            <Text style={styles.itemExp}>+{item.pointsAwarded} điểm</Text>
                          )}
                        </View>
                      </View>
                    </View>

                    {/* Needs Supplement (AwaitingMoreInfo) Notice & Actions */}
                    {isNeedsSupplement && (
                      <View style={styles.supplementBox}>
                        <View style={styles.supplementHeader}>
                          <Ionicons name="chatbubble-ellipses-outline" size={16} color="#D97706" />
                          <Text style={styles.supplementTitle}>Yêu cầu từ Kiểm duyệt viên:</Text>
                        </View>
                        <Text style={styles.supplementNote}>
                          "{item.moderatorNote || 'Ảnh chụp chưa thấy rõ độ dốc lối đi. Vui lòng gửi lại ảnh chụp toàn cảnh chính diện.'}"
                        </Text>

                        <View style={styles.supplementActionRow}>
                          <Pressable
                            style={({ pressed }) => [
                              styles.resubmitBtn,
                              isOperating && { opacity: 0.6 },
                              pressed && styles.pressed,
                            ]}
                            onPress={() => handleResubmit(item)}
                            disabled={isOperating}
                            accessibilityRole="button"
                            accessibilityLabel={`Nộp lại minh chứng cho ${item.locationName}`}
                          >
                            <Ionicons name="camera" size={15} color="#FFFFFF" />
                            <Text style={styles.resubmitBtnText}>
                              Nộp lại minh chứng (Rev {(item.revision || 1) + 1})
                            </Text>
                          </Pressable>

                          <Pressable
                            style={({ pressed }) => [
                              styles.cancelBtn,
                              isOperating && { opacity: 0.6 },
                              pressed && styles.pressed,
                            ]}
                            onPress={() => handleCancelSubmission(item)}
                            disabled={isOperating}
                            accessibilityRole="button"
                            accessibilityLabel={`Hủy hồ sơ ${item.locationName}`}
                          >
                            <Ionicons name="close" size={15} color="#EF4444" />
                            <Text style={styles.cancelBtnText}>Hủy</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                    {/* Confirmed Feature Tags */}
                    {item.featureTags && item.featureTags.length > 0 ? (
                      <View style={styles.tagsRow}>
                        {item.featureTags.map((t) => (
                          <View key={t} style={styles.tagChip}>
                            <Text style={styles.tagText}>{formatFeatureTag(t)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {/* Notes / Description */}
                    {item.textDescription && !isNeedsSupplement ? (
                      <Text style={styles.noteQuote} numberOfLines={2}>
                        "{item.textDescription}"
                      </Text>
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.6)',
    justifyContent: 'flex-end',
  },
  scrim: {
    flex: 1,
  },
  sheet: {
    maxHeight: '85%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.78,
  },
  summaryCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  summaryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  summaryTier: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  summarySub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  expBadge: {
    backgroundColor: '#004f58',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    alignItems: 'center',
  },
  expVal: {
    color: '#facc15',
    fontSize: 14,
    fontWeight: '800',
  },
  expUnit: {
    color: '#8ee9dc',
    fontSize: 9.5,
    fontWeight: '700',
  },
  list: {
    maxHeight: 440,
  },
  listContent: {
    paddingBottom: 24,
    gap: 12,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 16,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
  emptyDesc: {
    fontSize: 12.5,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 12,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  thumbnailFallback: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailPhotoFallback: {
    backgroundColor: '#f1f5f9',
  },
  cardMeta: {
    flex: 1,
    justifyContent: 'center',
  },
  locationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  codePill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  codePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
  },
  revisionPill: {
    backgroundColor: '#E6F8F5',
    borderWidth: 1,
    borderColor: '#99F6E4',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  revisionText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#004F58',
  },
  timestamp: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#059669',
  },
  itemExp: {
    fontSize: 12,
    fontWeight: '800',
    color: '#d97706',
  },
  supplementBox: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  supplementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  supplementTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#92400E',
  },
  supplementNote: {
    fontSize: 11.5,
    fontStyle: 'italic',
    color: '#78350F',
    lineHeight: 16,
  },
  supplementActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  resubmitBtn: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#004F58',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  resubmitBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cancelBtn: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  cancelBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#DC2626',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  tagChip: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
  },
  noteQuote: {
    fontSize: 11.5,
    fontStyle: 'italic',
    color: '#64748b',
    backgroundColor: '#f8fafc',
    padding: 6,
    borderRadius: 6,
  },
});
