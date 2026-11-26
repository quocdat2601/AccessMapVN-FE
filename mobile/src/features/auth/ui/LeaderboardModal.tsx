import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiClient } from '@/shared/api/client';
import { Colors } from '@/shared/theme';
import { useAuth } from '../model/AuthProvider';

export interface LeaderboardEntry {
  rank: number;
  rankBadge?: string | null;
  userId: string;
  displayName: string;
  reputationScore: number;
  reputationTier: string;
  expPoints: number;
  contributionsCount: number;
}

interface MyReputationResponse {
  reputationScore: number;
  reputationTier: string;
  rankLabel: string;
  accountStandingScore: number;
  contributionAccuracyRate: number | null;
  correctClaimCount: number;
  incorrectClaimCount: number;
  recentEvents: {
    scoreType?: string;
    delta: number;
    newScore: number;
    reason: string;
    occurredAt: string;
  }[];
}

export const FALLBACK_LEADERBOARD: LeaderboardEntry[] = [
  {
    rank: 1,
    rankBadge: 'Top1',
    userId: 'demo-user-1',
    displayName: 'Nguyễn Minh Anh',
    reputationScore: 120,
    reputationTier: 'Top 1',
    expPoints: 120,
    contributionsCount: 42,
  },
  {
    rank: 2,
    rankBadge: 'Top2',
    userId: 'demo-user-2',
    displayName: 'Trần Quốc Đạt',
    reputationScore: 95,
    reputationTier: 'Top 2',
    expPoints: 95,
    contributionsCount: 35,
  },
  {
    rank: 3,
    rankBadge: 'Top3',
    userId: 'demo-user-3',
    displayName: 'Lê Hoàng Nam',
    reputationScore: 78,
    reputationTier: 'Top 3',
    expPoints: 78,
    contributionsCount: 28,
  },
  {
    rank: 4,
    rankBadge: 'Top4',
    userId: 'demo-user-4',
    displayName: 'Phạm Thu Hà',
    reputationScore: 62,
    reputationTier: 'Top 4',
    expPoints: 62,
    contributionsCount: 21,
  },
  {
    rank: 5,
    rankBadge: 'Top5',
    userId: 'demo-user-5',
    displayName: 'Võ Thanh Tùng',
    reputationScore: 49,
    reputationTier: 'Top 5',
    expPoints: 49,
    contributionsCount: 17,
  },
  {
    rank: 6,
    rankBadge: 'Top6',
    userId: 'demo-user-6',
    displayName: 'Đặng Ngọc Linh',
    reputationScore: 38,
    reputationTier: 'Top 6',
    expPoints: 38,
    contributionsCount: 13,
  },
  {
    rank: 7,
    rankBadge: 'Top7',
    userId: 'demo-user-7',
    displayName: 'Hoàng Văn Khôi',
    reputationScore: 29,
    reputationTier: 'Top 7',
    expPoints: 29,
    contributionsCount: 10,
  },
  {
    rank: 8,
    rankBadge: 'Top8',
    userId: 'demo-user-8',
    displayName: 'Bùi Thị Mai',
    reputationScore: 21,
    reputationTier: 'Top 8',
    expPoints: 21,
    contributionsCount: 7,
  },
  {
    rank: 9,
    rankBadge: 'Top9',
    userId: 'demo-user-9',
    displayName: 'Đỗ Anh Đức',
    reputationScore: 14,
    reputationTier: 'Top 9',
    expPoints: 14,
    contributionsCount: 5,
  },
  {
    rank: 10,
    rankBadge: 'Top10',
    userId: 'demo-user-10',
    displayName: 'Phan Khánh Huyền',
    reputationScore: 7,
    reputationTier: 'Top 10',
    expPoints: 7,
    contributionsCount: 4,
  },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return 'TV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const first = parts[0][0];
  const last = parts[parts.length - 1][0];
  return `${first}${last}`.toUpperCase();
}

/**
 * Animated Skeleton Shimmer Placeholder
 */
function LeaderboardSkeleton() {
  const pulseAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.85,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.skeletonContainer}>
      {/* Policy Card Skeleton */}
      <Animated.View style={[styles.skeletonPolicyCard, { opacity: pulseAnim }]} />

      {/* Podium Skeleton */}
      <View style={styles.skeletonPodiumWrapper}>
        <Animated.View style={[styles.skeletonPodiumCol, { height: 160, opacity: pulseAnim }]} />
        <Animated.View style={[styles.skeletonPodiumCol, { height: 190, opacity: pulseAnim }]} />
        <Animated.View style={[styles.skeletonPodiumCol, { height: 145, opacity: pulseAnim }]} />
      </View>

      {/* List Row Skeletons */}
      {[1, 2, 3, 4].map((key) => (
        <Animated.View key={key} style={[styles.skeletonRow, { opacity: pulseAnim }]} />
      ))}
    </View>
  );
}

/**
 * Empty State Component with Call-To-Action
 */
interface LeaderboardEmptyStateProps {
  onStartContribution?: () => void;
}

function LeaderboardEmptyState({ onStartContribution }: LeaderboardEmptyStateProps) {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconCircle}>
        <MaterialCommunityIcons name="trophy-outline" size={48} color="#006874" />
      </View>
      <Text style={styles.emptyTitle}>Chưa có dữ liệu bảng xếp hạng</Text>
      <Text style={styles.emptySubtitle}>
        Hãy là người tiên phong khảo sát tiếp cận và đóng góp vị trí để vinh danh trên bục vàng uy tín cộng đồng!
      </Text>
      {onStartContribution && (
        <TouchableOpacity
          style={styles.emptyActionBtn}
          onPress={onStartContribution}
          activeOpacity={0.85}
        >
          <Ionicons name="add-circle" size={18} color="#FFFFFF" />
          <Text style={styles.emptyActionBtnText}>Bắt đầu đóng góp ngay</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * Top 3 Podium Component
 */
interface LeaderboardPodiumProps {
  top3: LeaderboardEntry[];
}

function LeaderboardPodium({ top3 }: LeaderboardPodiumProps) {
  if (top3.length === 0) return null;

  const rank1 = top3.find((item) => item.rank === 1) || top3[0];
  const rank2 = top3.find((item) => item.rank === 2) || (top3.length > 1 ? top3[1] : null);
  const rank3 = top3.find((item) => item.rank === 3) || (top3.length > 2 ? top3[2] : null);

  return (
    <View style={styles.podiumContainer}>
      <View style={styles.podiumHeaderBadge}>
        <MaterialCommunityIcons name="crown" size={16} color="#D97706" />
        <Text style={styles.podiumHeaderText}>VINH DANH TOP 3 XUẤT SẮC</Text>
      </View>

      <View style={styles.podiumRow}>
        {/* RANK 2 - SILVER (LEFT) */}
        {rank2 ? (
          <View style={styles.podiumColumn}>
            <View style={styles.avatarWrapper}>
              <View style={[styles.avatarCircle, styles.silverAvatar]}>
                <Text style={styles.avatarInitials}>{getInitials(rank2.displayName)}</Text>
              </View>
              <View style={[styles.podiumMedalBadge, styles.silverMedal]}>
                <MaterialCommunityIcons name="medal" size={12} color="#475569" />
                <Text style={styles.silverMedalText}>2</Text>
              </View>
            </View>
            <Text style={styles.podiumName} numberOfLines={2}>{rank2.displayName}</Text>
            <View style={[styles.podiumScorePill, styles.silverScorePill]}>
              <Text style={styles.silverScoreText}>{rank2.reputationScore}</Text>
              <Text style={styles.podiumScoreLabel}>danh vọng</Text>
            </View>
            <Text style={styles.podiumSubText}>
              {rank2.contributionsCount > 0 ? `${rank2.contributionsCount} đóng góp` : 'Đóng góp công nhận'}
            </Text>
            {/* Step Base */}
            <View style={[styles.stepBase, styles.silverStep]}>
              <Text style={styles.silverStepNum}>2</Text>
              <Text style={styles.stepTitle}>Á Quân 1</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.podiumColumn, { opacity: 0.3 }]} />
        )}

        {/* RANK 1 - GOLD (CENTER, ELEVATED) */}
        {rank1 && (
          <View style={[styles.podiumColumn, styles.goldColumn]}>
            <View style={styles.crownFloating}>
              <MaterialCommunityIcons name="crown" size={24} color="#D97706" />
            </View>
            <View style={styles.avatarWrapper}>
              <View style={[styles.avatarCircle, styles.goldAvatar]}>
                <Text style={[styles.avatarInitials, styles.goldInitials]}>
                  {getInitials(rank1.displayName)}
                </Text>
              </View>
              <View style={[styles.podiumMedalBadge, styles.goldMedal]}>
                <MaterialCommunityIcons name="trophy" size={14} color="#B45309" />
                <Text style={styles.goldMedalText}>1</Text>
              </View>
            </View>
            <Text style={[styles.podiumName, styles.goldName]} numberOfLines={2}>
              {rank1.displayName}
            </Text>
            <View style={[styles.podiumScorePill, styles.goldScorePill]}>
              <Text style={styles.goldScoreText}>{rank1.reputationScore}</Text>
              <Text style={styles.goldScoreLabel}>danh vọng</Text>
            </View>
            <Text style={[styles.podiumSubText, styles.goldSubText]}>
              {rank1.contributionsCount > 0
                ? `${rank1.contributionsCount} đóng góp · ${rank1.reputationScore} điểm`
                : `${rank1.reputationScore} điểm danh vọng`}
            </Text>
            {/* Step Base */}
            <View style={[styles.stepBase, styles.goldStep]}>
              <Text style={styles.goldStepNum}>1</Text>
              <Text style={styles.goldStepTitle}>Quán Quân</Text>
            </View>
          </View>
        )}

        {/* RANK 3 - BRONZE (RIGHT) */}
        {rank3 ? (
          <View style={styles.podiumColumn}>
            <View style={styles.avatarWrapper}>
              <View style={[styles.avatarCircle, styles.bronzeAvatar]}>
                <Text style={styles.avatarInitials}>{getInitials(rank3.displayName)}</Text>
              </View>
              <View style={[styles.podiumMedalBadge, styles.bronzeMedal]}>
                <MaterialCommunityIcons name="medal" size={12} color="#C2410C" />
                <Text style={styles.bronzeMedalText}>3</Text>
              </View>
            </View>
            <Text style={styles.podiumName} numberOfLines={2}>{rank3.displayName}</Text>
            <View style={[styles.podiumScorePill, styles.bronzeScorePill]}>
              <Text style={styles.bronzeScoreText}>{rank3.reputationScore}</Text>
              <Text style={styles.podiumScoreLabel}>danh vọng</Text>
            </View>
            <Text style={styles.podiumSubText}>
              {rank3.contributionsCount > 0 ? `${rank3.contributionsCount} đóng góp` : 'Đóng góp công nhận'}
            </Text>
            {/* Step Base */}
            <View style={[styles.stepBase, styles.bronzeStep]}>
              <Text style={styles.bronzeStepNum}>3</Text>
              <Text style={styles.stepTitle}>Á Quân 2</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.podiumColumn, { opacity: 0.3 }]} />
        )}
      </View>
    </View>
  );
}

const ENABLE_MOCK_FALLBACK = __DEV__ && process.env.EXPO_PUBLIC_ENABLE_MOCK_ACCESSIBILITY === 'true';

export interface LeaderboardContentProps {
  isGuest: boolean;
  onStartContribution?: () => void;
}

export function LeaderboardContent({ isGuest, onStartContribution }: LeaderboardContentProps) {
  const router = useRouter();
  const { userProfile } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myRep, setMyRep] = useState<MyReputationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPolicyExpanded, setIsPolicyExpanded] = useState(false);

  const handleStartContribution = useCallback(() => {
    if (onStartContribution) {
      onStartContribution();
    } else {
      try {
        router.push('/' as any);
      } catch {
        // Safe fallback
      }
    }
  }, [onStartContribution, router]);

  const loadData = useCallback(async (isPullToRefresh = false) => {
    if (isPullToRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      // Parallel fetch with fast timeout to avoid hanging UI
      const [lbResult, repResult] = await Promise.allSettled([
        apiClient.get<any>('/api/v1/leaderboard', { auth: 'optional', timeoutMs: 3500 }),
        !isGuest
          ? apiClient.get<any>('/api/v1/me/reputation', { auth: 'optional', timeoutMs: 3500 })
          : Promise.resolve(null),
      ]);

      // Process Leaderboard
      if (lbResult.status === 'fulfilled' && lbResult.value) {
        const rawLb = lbResult.value;
        const rawItems = Array.isArray(rawLb?.items)
          ? rawLb.items
          : Array.isArray(rawLb?.entries)
          ? rawLb.entries
          : null;

        if (rawItems && rawItems.length > 0) {
          setLeaderboard(
            rawItems.map((entry: any, index: number) => ({
              rank: Number(entry.rank ?? index + 1),
              rankBadge: entry.rankBadge ?? (index === 0 ? 'Quán Quân' : index === 1 ? 'Á Quân 1' : index === 2 ? 'Á Quân 2' : 'Top 10'),
              userId: String(entry.userId ?? `leader-${index + 1}`),
              displayName: String(entry.displayName ?? 'Thành viên'),
              reputationScore: Number(entry.reputationScore ?? entry.reputationPoints ?? 0),
              reputationTier: String(entry.reputationTier ?? entry.rankBadge ?? 'Thành viên'),
              expPoints: Number(entry.expPoints ?? entry.reputationPoints ?? 0),
              contributionsCount: Number(entry.contributionsCount ?? 0),
            }))
          );
        } else {
          setLeaderboard([]);
        }
      } else {
        setLeaderboard(ENABLE_MOCK_FALLBACK ? FALLBACK_LEADERBOARD : []);
      }

      // Process Reputation
      if (!isGuest) {
        if (repResult.status === 'fulfilled' && repResult.value) {
          const ownerRep = repResult.value;
          if (typeof ownerRep?.reputationPoints === 'number' || typeof ownerRep?.reputationScore === 'number') {
            const score = ownerRep.reputationPoints ?? ownerRep.reputationScore;
            const resolvedRankLabel =
              ownerRep.rankLabel && ownerRep.rankLabel !== 'Unranked'
                ? String(ownerRep.rankLabel)
                : ownerRep.rank
                  ? `#${ownerRep.rank}`
                  : 'Chưa xếp hạng';
            setMyRep({
              reputationScore: score,
              reputationTier:
                ownerRep.rankBadge ||
                (resolvedRankLabel !== 'Chưa xếp hạng' ? resolvedRankLabel : null) ||
                ownerRep.reputationTier ||
                'Chưa xếp hạng',
              rankLabel: resolvedRankLabel,
              accountStandingScore: Number(ownerRep.accountStandingScore ?? 50),
              contributionAccuracyRate:
                typeof ownerRep.contributionAccuracyRate === 'number' ? ownerRep.contributionAccuracyRate : null,
              correctClaimCount: Number(ownerRep.correctClaimCount ?? 0),
              incorrectClaimCount: Number(ownerRep.incorrectClaimCount ?? 0),
              recentEvents: Array.isArray(ownerRep.history)
                ? ownerRep.history.map((h: any) => ({
                    scoreType: String(h.scoreType ?? 'ReputationPoints'),
                    delta: Number(h.appliedDelta ?? 0),
                    newScore: Number(h.balanceAfter ?? 0),
                    reason: String(h.sourceType ?? h.sourceOutcome ?? 'Cập nhật uy tín'),
                    occurredAt: String(h.appliedAt ?? ''),
                  }))
                : [],
            });
          } else {
            throw new Error('use fallback reputation');
          }
        } else {
          throw new Error('fetch reputation failed');
        }
      } else {
        setMyRep(null);
      }
    } catch {
      setMyRep(null);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [isGuest, userProfile.contributionsCount, userProfile.expPoints, userProfile.reputationTier]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const top3 = leaderboard.slice(0, 3);
  const remainingRanks = leaderboard.slice(3);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void loadData(true)}
          colors={[Colors.primary]}
          tintColor={Colors.primary}
        />
      }
    >
      {/* Policy Card Banner (Collapsible) */}
      <View style={styles.policyCard}>
        <TouchableOpacity
          style={styles.policyHeaderRow}
          onPress={() => setIsPolicyExpanded((prev) => !prev)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Quy tắc cộng điểm uy tín & Kiểm định"
          accessibilityState={{ expanded: isPolicyExpanded }}
        >
          <View style={styles.policyHeaderLeft}>
            <MaterialCommunityIcons name="shield-star-outline" size={18} color="#006874" />
            <Text style={styles.policyTitle}>Quy tắc cộng điểm uy tín & Kiểm định</Text>
          </View>
          <Ionicons
            name={isPolicyExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color="#006874"
          />
        </TouchableOpacity>

        {isPolicyExpanded && (
          <View style={styles.policyBody}>
            <Text style={styles.policyLine}>• Địa điểm mới công bố: +5 điểm danh vọng · +2 điểm uy tín.</Text>
            <Text style={styles.policyLine}>• Bổ sung tiện ích công bố: +2 điểm danh vọng · +2 điểm uy tín.</Text>
            <Text style={styles.policyLine}>• Báo cáo sai lệch hợp lệ: +1 điểm danh vọng · +1 điểm uy tín.</Text>
            <Text style={styles.policyLine}>• Độ tin cậy = tỷ lệ nhận định (claim) được kiểm duyệt viên xác nhận đúng.</Text>
          </View>
        )}
      </View>

      {/* Personal Rank Card */}
      {!isGuest && myRep && (
        <View style={styles.mySummaryCard}>
          <View style={styles.mySummaryHeaderRow}>
            <Text style={styles.mySummaryLabel}>THỨ HẠNG CÁ NHÂN CỦA BẠN</Text>
            <View style={styles.tierPill}>
              <Ionicons name="sparkles" size={11} color="#006874" />
              <Text style={styles.tierPillText}>{myRep.reputationTier}</Text>
            </View>
          </View>
          <View style={styles.mySummaryRow}>
            <View style={styles.myStat}>
              <Text style={styles.myStatValue}>{myRep.rankLabel}</Text>
              <Text style={styles.myStatSub}>Xếp hạng</Text>
            </View>
            <View style={styles.myStatDivider} />
            <View style={styles.myStat}>
              <Text style={[styles.myStatValue, { color: '#006874' }]}>{myRep.reputationScore}</Text>
              <Text style={styles.myStatSub}>Danh vọng</Text>
            </View>
            <View style={styles.myStatDivider} />
            <View style={styles.myStat}>
              <Text style={styles.myStatValue}>{myRep.accountStandingScore}/100</Text>
              <Text style={styles.myStatSub}>Uy tín</Text>
            </View>
            <View style={styles.myStatDivider} />
            <View style={styles.myStat}>
              <Text style={styles.myStatValue}>
                {myRep.contributionAccuracyRate != null
                  ? `${(myRep.contributionAccuracyRate <= 1
                      ? myRep.contributionAccuracyRate * 100
                      : myRep.contributionAccuracyRate
                    ).toFixed(0)}%`
                  : 'Chưa có'}
              </Text>
              <Text style={styles.myStatSub}>Độ tin cậy</Text>
            </View>
          </View>
        </View>
      )}

      {/* Loading Skeleton State */}
      {isLoading ? (
        <LeaderboardSkeleton />
      ) : leaderboard.length === 0 ? (
        /* Empty State */
        <LeaderboardEmptyState onStartContribution={handleStartContribution} />
      ) : (
        /* Podium & List */
        <View style={styles.leaderboardSection}>
          {/* Top 3 Honoring Podium */}
          <LeaderboardPodium top3={top3} />

          {/* Ranks 4+ List */}
          {remainingRanks.length > 0 && (
            <View style={styles.remainingSection}>
              <View style={styles.listHeaderRow}>
                <Text style={styles.listSectionTitle}>BẢNG XẾP HẠNG TỔNG HỢP</Text>
                <View style={styles.listCountBadge}>
                  <Text style={styles.listCountText}>Top {leaderboard.length}</Text>
                </View>
              </View>

              <View style={styles.list}>
                {remainingRanks.map((item) => (
                  <View key={item.userId} style={styles.row}>
                    <View style={styles.rankCircle}>
                      <Text style={styles.rankText}>{item.rank}</Text>
                    </View>

                    <View style={styles.itemAvatar}>
                      <Text style={styles.itemAvatarText}>{getInitials(item.displayName)}</Text>
                    </View>

                    <View style={styles.itemInfo}>
                      <View style={styles.nameRow}>
                        <Text style={styles.nameText} numberOfLines={1}>{item.displayName}</Text>
                        {item.rankBadge && (
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>{item.rankBadge}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.subText}>
                        {item.reputationTier}
                        {item.contributionsCount > 0 ? ` · ${item.contributionsCount} đóng góp` : ''} · {item.reputationScore} điểm
                      </Text>
                    </View>

                    <View style={styles.scoreCol}>
                      <Text style={styles.scoreVal}>{item.reputationScore}</Text>
                      <Text style={styles.scoreUnit}>Danh vọng</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

export interface LeaderboardModalProps {
  visible: boolean;
  isGuest: boolean;
  onClose: () => void;
  onStartContribution?: () => void;
}

export function LeaderboardModal({
  visible,
  isGuest,
  onClose,
  onStartContribution,
}: LeaderboardModalProps) {
  const insets = useSafeAreaInsets();
  const safeTop = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0,
    12
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 16 : safeTop }]}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconBadge}>
              <MaterialCommunityIcons name="trophy-award" size={20} color="#004F58" />
            </View>
            <Text style={styles.headerTitle}>Bảng xếp hạng & Uy tín</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Đóng">
            <Ionicons name="close" size={22} color="#475569" />
          </TouchableOpacity>
        </View>

        <LeaderboardContent isGuest={isGuest} onStartContribution={onStartContribution} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAF9' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#99F6E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  closeBtn: { padding: 6, borderRadius: 16, backgroundColor: '#F1F5F9' },
  content: { padding: 16, gap: 16, paddingBottom: 36 },

  /* Policy Card (Collapsible) */
  policyCard: {
    backgroundColor: '#F0FDFA',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#99F6E4',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  policyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  policyHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
  },
  policyTitle: { fontSize: 13, fontWeight: '800', color: '#004F58' },
  policyBody: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#CCFBF1',
    gap: 4,
  },
  policyLine: { fontSize: 12.5, color: '#134E4A', lineHeight: 18 },

  /* Personal Rank Card */
  mySummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#99F6E4',
    padding: 16,
    shadowColor: '#004F58',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  mySummaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  mySummaryLabel: { fontSize: 11, fontWeight: '800', color: '#006874', letterSpacing: 0.4 },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E6F8F5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  tierPillText: { fontSize: 10.5, fontWeight: '700', color: '#006874' },
  mySummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  myStat: { alignItems: 'center', flex: 1 },
  myStatDivider: { width: 1, height: 26, backgroundColor: '#E2E8F0' },
  myStatValue: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  myStatSub: { fontSize: 11, color: '#64748B', marginTop: 2 },

  /* Skeleton Shimmer */
  skeletonContainer: { gap: 16, paddingVertical: 8 },
  skeletonPolicyCard: {
    height: 46,
    backgroundColor: '#E2E8F0',
    borderRadius: 16,
  },
  skeletonPodiumWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    gap: 12,
  },
  skeletonPodiumCol: {
    flex: 1,
    backgroundColor: '#E2E8F0',
    borderRadius: 14,
  },
  skeletonRow: {
    height: 64,
    backgroundColor: '#E2E8F0',
    borderRadius: 16,
  },

  /* Empty State */
  emptyContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 32,
    alignItems: 'center',
    marginVertical: 12,
    gap: 12,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F0FDFA',
    borderWidth: 1.5,
    borderColor: '#99F6E4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 10,
  },
  emptyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#006874',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 14,
    marginTop: 6,
  },
  emptyActionBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  /* Leaderboard Podium */
  leaderboardSection: { gap: 16 },
  podiumContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingTop: 16,
    paddingHorizontal: 12,
    paddingBottom: 4,
    shadowColor: '#004F58',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  podiumHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  podiumHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E',
    letterSpacing: 0.6,
  },
  podiumRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
  },
  podiumColumn: {
    flex: 1,
    alignItems: 'center',
  },
  goldColumn: {
    transform: [{ translateY: -10 }],
    zIndex: 2,
  },
  crownFloating: {
    marginBottom: -4,
    zIndex: 3,
  },
  avatarWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  goldAvatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#FEF08A',
    borderColor: '#F59E0B',
    borderWidth: 3,
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  silverAvatar: {
    backgroundColor: '#F1F5F9',
    borderColor: '#94A3B8',
  },
  bronzeAvatar: {
    backgroundColor: '#FFEDD5',
    borderColor: '#FB923C',
  },
  avatarInitials: {
    fontSize: 15,
    fontWeight: '800',
    color: '#334155',
  },
  goldInitials: {
    fontSize: 18,
    color: '#92400E',
  },
  podiumMedalBadge: {
    position: 'absolute',
    bottom: -4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    borderWidth: 1,
  },
  goldMedal: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  silverMedal: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
  },
  bronzeMedal: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FDBA74',
  },
  goldMedalText: { fontSize: 10, fontWeight: '800', color: '#B45309' },
  silverMedalText: { fontSize: 10, fontWeight: '800', color: '#475569' },
  bronzeMedalText: { fontSize: 10, fontWeight: '800', color: '#C2410C' },

  podiumName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 8,
    textAlign: 'center',
    maxWidth: '92%',
  },
  goldName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  podiumScorePill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 4,
  },
  goldScorePill: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  silverScorePill: {
    backgroundColor: '#F1F5F9',
  },
  bronzeScorePill: {
    backgroundColor: '#FFF7ED',
  },
  goldScoreText: { fontSize: 13, fontWeight: '800', color: '#B45309' },
  silverScoreText: { fontSize: 12, fontWeight: '800', color: '#334155' },
  bronzeScoreText: { fontSize: 12, fontWeight: '800', color: '#C2410C' },
  goldScoreLabel: { fontSize: 9.5, fontWeight: '700', color: '#92400E' },
  podiumScoreLabel: { fontSize: 9, color: '#64748B' },
  podiumSubText: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
    textAlign: 'center',
  },
  goldSubText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#78350F',
  },

  /* Pedestal Steps */
  stepBase: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 8,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    marginTop: 10,
  },
  goldStep: {
    height: 84,
    backgroundColor: '#FEF9C3',
    borderWidth: 1.5,
    borderColor: '#FDE047',
    borderBottomWidth: 0,
  },
  silverStep: {
    height: 64,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderBottomWidth: 0,
  },
  bronzeStep: {
    height: 50,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderBottomWidth: 0,
  },
  goldStepNum: { fontSize: 24, fontWeight: '900', color: '#B45309', lineHeight: 28 },
  silverStepNum: { fontSize: 20, fontWeight: '900', color: '#64748B', lineHeight: 24 },
  bronzeStepNum: { fontSize: 18, fontWeight: '900', color: '#C2410C', lineHeight: 22 },
  goldStepTitle: { fontSize: 10, fontWeight: '800', color: '#92400E' },
  stepTitle: { fontSize: 9.5, fontWeight: '700', color: '#64748B' },

  /* Remaining Section (Ranks 4+) */
  remainingSection: { gap: 10 },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 4,
  },
  listSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
  },
  listCountBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  listCountText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#475569',
  },
  list: { gap: 9 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  rankCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { fontSize: 13, fontWeight: '800', color: '#475569' },
  itemAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E6F8F5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#99F6E4',
  },
  itemAvatarText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#004F58',
  },
  itemInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameText: { fontSize: 14, fontWeight: '700', color: '#0F172A', flexShrink: 1 },
  badge: { backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#475569' },
  subText: { fontSize: 11.5, color: '#64748B', marginTop: 2 },
  scoreCol: { alignItems: 'flex-end' },
  scoreVal: { fontSize: 16, fontWeight: '800', color: '#006874' },
  scoreUnit: { fontSize: 10, color: '#64748B', fontWeight: '600' },
});
