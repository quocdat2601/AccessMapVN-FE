import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '@/features/auth';
import { ApiError, AuthenticationRequiredError } from '@/shared/api/client';
import { KeyboardSafeModal } from '@/shared/ui/KeyboardSafeModal';
import {
  deleteCommunityComment,
  reportCommunityComment,
  submitCommunityComment,
  updateCommunityComment,
  type CommentViolationCategory,
} from '@/features/community';
import { getDisplayCommunityReviews } from './CommunityReviewsSection';
import type { CommunityReview } from './types';

const MAX_COMMENT_LENGTH = 1500;
const HOURLY_COMMENT_LIMIT = 10;
const EDIT_WINDOW_MS = 60 * 60 * 1000;

const REPORT_CATEGORIES: Array<{
  id: CommentViolationCategory;
  label: string;
  desc: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}> = [
  {
    id: 'SpamAdvertising',
    label: 'Quảng cáo / Spam / Web lạ',
    desc: 'Chứa liên kết lạ, cá độ, lừa đảo hoặc spam lặp lại',
    icon: 'link-variant-off',
  },
  {
    id: 'HarassmentHate',
    label: 'Ngôn từ thô tục / Xúc phạm',
    desc: 'Chửi bới, công kích cá nhân hoặc kỳ thị',
    icon: 'account-alert-outline',
  },
  {
    id: 'PrivacyThreat',
    label: 'Xâm phạm quyền riêng tư',
    desc: 'Tiết lộ số điện thoại, địa chỉ riêng hoặc thông tin cá nhân',
    icon: 'shield-lock-outline',
  },
  {
    id: 'CoordinatedManipulation',
    label: 'Sai sự thật / Thao túng',
    desc: 'Cố tình bôi nhọ hoặc đánh giá sai lệch có chủ đích',
    icon: 'alert-decagram-outline',
  },
  {
    id: 'Other',
    label: 'Lý do khác',
    desc: 'Vi phạm khác cần quản trị viên xem xét',
    icon: 'dots-horizontal-circle-outline',
  },
];

const QUICK_TAGS = [
  'Ram dốc thoải, xe lăn dễ lên',
  'Cửa ra vào rộng rãi (≥ 90cm)',
  'Thang máy có chữ nổi & rộng',
  'Nhà vệ sinh tiếp cận sạch sẽ, có tay vịn',
  'Cần lưu ý bậc thềm tại lối phụ',
];

type CommentFilter = 'all' | 'helpful' | 'newest' | 'mine';

interface ReactionState {
  upvoted?: boolean;
  liked?: boolean;
  disliked?: boolean;
}

interface CensorConfirmState {
  mode: 'create' | 'edit';
  rawBody: string;
  matchedTerms: string[];
  censoredPreview: string;
  editCommentId?: string;
  editVersion?: number;
}

interface CommunityCommentsViewProps {
  locationId: string;
  locationName: string;
  locationCategory?: string;
  reviews: CommunityReview[];
  isLoading?: boolean;
  showDemoContent?: boolean;
  isVerified?: boolean;
  onBack: () => void;
  onCommentAdded: (review: CommunityReview) => void;
  onCommentUpdated?: (review: CommunityReview) => void;
  onCommentDeleted?: (commentId: string) => void;
  onRefreshComments?: () => Promise<void>;
  onRequireLogin: (featureLabel: string) => void;
}

function getRemainingEditMinutes(rev: CommunityReview): number {
  if (!rev.isOwn) return 0;
  const endMs = rev.editableUntilIso
    ? Date.parse(rev.editableUntilIso)
    : rev.createdAtIso
      ? Date.parse(rev.createdAtIso) + EDIT_WINDOW_MS
      : 0;
  if (!Number.isFinite(endMs) || endMs <= 0) return 0;
  const diff = endMs - Date.now();
  return diff > 0 ? Math.ceil(diff / 60000) : 0;
}

export function CommunityCommentsView({
  locationId,
  locationName,
  locationCategory,
  reviews,
  isLoading = false,
  showDemoContent = false,
  isVerified = false,
  onBack,
  onCommentAdded,
  onCommentUpdated,
  onCommentDeleted,
  onRefreshComments,
  onRequireLogin,
}: CommunityCommentsViewProps) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const composerInputRef = useRef<TextInput>(null);
  const [filter, setFilter] = useState<CommentFilter>('all');
  const [reactions, setReactions] = useState<Record<string, ReactionState>>({});
  const [commentBody, setCommentBody] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [censorConfirm, setCensorConfirm] = useState<CensorConfirmState | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ parentId: string; rootId: string; author: string } | null>(null);
  const [expandedReplyGroups, setExpandedReplyGroups] = useState<Record<string, boolean>>({});
  const [showQuickTags, setShowQuickTags] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Edit within 1 hour state
  const [editingReview, setEditingReview] = useState<CommunityReview | null>(null);
  const [editBody, setEditBody] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Report comment modal state
  const [reportingReview, setReportingReview] = useState<CommunityReview | null>(null);
  const [reportCategory, setReportCategory] = useState<CommentViolationCategory>('SpamAdvertising');
  const [reportDescription, setReportDescription] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [isSendingReport, setIsSendingReport] = useState(false);

  const reactionsStorageKey = `@accessmap_comment_reactions_${user?.id ?? 'guest'}_${locationId}`;
  const rateLimitStorageKey = `@accessmap_comment_timestamps_${user?.id ?? 'guest'}`;

  useEffect(() => {
    let isMounted = true;
    async function loadReactions() {
      try {
        const raw = await AsyncStorage.getItem(reactionsStorageKey);
        if (raw && isMounted) {
          setReactions(JSON.parse(raw));
        }
      } catch {}
    }
    void loadReactions();
    return () => {
      isMounted = false;
    };
  }, [reactionsStorageKey]);

  const toggleReaction = useCallback(
    async (reviewId: string, type: 'upvoted' | 'liked' | 'disliked') => {
      setReactions((prev) => {
        const current = prev[reviewId] ?? {};
        const nextForReview: ReactionState = { ...current };

        if (type === 'upvoted') {
          nextForReview.upvoted = !current.upvoted;
          if (nextForReview.upvoted) nextForReview.disliked = false;
        } else if (type === 'disliked') {
          nextForReview.disliked = !current.disliked;
          if (nextForReview.disliked) nextForReview.upvoted = false;
        } else if (type === 'liked') {
          nextForReview.liked = !current.liked;
        }

        const updated = { ...prev, [reviewId]: nextForReview };
        void AsyncStorage.setItem(reactionsStorageKey, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    },
    [reactionsStorageKey]
  );

  const allDisplayReviews = useMemo(
    () => getDisplayCommunityReviews(reviews, showDemoContent, isVerified),
    [reviews, showDemoContent, isVerified]
  );

  const repliesByRootId = useMemo(() => {
    const map: Record<string, CommunityReview[]> = {};
    for (const r of allDisplayReviews) {
      if (r.parentCommentId) {
        if (!map[r.parentCommentId]) map[r.parentCommentId] = [];
        map[r.parentCommentId].push(r);
      }
    }
    Object.values(map).forEach((arr) =>
      arr.sort((a, b) => {
        const ta = a.createdAtIso ? Date.parse(a.createdAtIso) : 0;
        const tb = b.createdAtIso ? Date.parse(b.createdAtIso) : 0;
        return ta - tb;
      })
    );
    return map;
  }, [allDisplayReviews]);

  const filteredReviews = useMemo(() => {
    const roots = allDisplayReviews.filter((r) => !r.parentCommentId);
    if (filter === 'mine') {
      return roots.filter(
        (r) => r.isOwn || (repliesByRootId[r.id]?.some((rep) => rep.isOwn) ?? false)
      );
    }
    if (filter === 'helpful') {
      return [...roots].sort((a, b) => {
        const aScore = a.helpfulCount + (reactions[a.id]?.upvoted ? 1 : 0);
        const bScore = b.helpfulCount + (reactions[b.id]?.upvoted ? 1 : 0);
        return bScore - aScore;
      });
    }
    if (filter === 'newest') {
      return [...roots].sort((a, b) => {
        if (a.isOwn && !b.isOwn) return -1;
        if (!a.isOwn && b.isOwn) return 1;
        return 0;
      });
    }
    return roots;
  }, [allDisplayReviews, filter, reactions, repliesByRootId]);

  const handleStartReply = useCallback(
    (target: CommunityReview, rootId: string) => {
      if (!user) {
        onRequireLogin('phản hồi nhận xét cộng đồng');
        return;
      }
      setReplyingTo({ parentId: target.id, rootId, author: target.author });
      setTimeout(() => composerInputRef.current?.focus(), 80);
    },
    [onRequireLogin, user]
  );

  const trimmedLength = commentBody.trim().length;
  const rawLength = commentBody.length;
  const isOverLength = rawLength > MAX_COMMENT_LENGTH;

  const handleChangeText = (value: string) => {
    setCommentBody(value);
    if (value.length > MAX_COMMENT_LENGTH) {
      setInlineError(
        `Nhận xét vượt quá giới hạn ${MAX_COMMENT_LENGTH.toLocaleString('vi-VN')} ký tự (${value.length.toLocaleString('vi-VN')}/${MAX_COMMENT_LENGTH.toLocaleString('vi-VN')}). Vui lòng rút gọn nội dung.`
      );
    } else if (inlineError) {
      setInlineError(null);
    }
  };

  const handleQuickTagPress = (tag: string) => {
    setSuccessBanner(null);
    const next = commentBody.trim()
      ? `${commentBody.trim()}. ${tag}`
      : `${tag}. `;
    handleChangeText(next);
  };

  const submitCreateFlow = async (bodyText: string, confirmCensored: boolean) => {
    if (!user) {
      onRequireLogin('gửi nhận xét cộng đồng');
      return;
    }

    setSubmitting(true);
    setInlineError(null);

    const displayName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'Thành viên';
    const initials = displayName.slice(0, 2).toUpperCase();

    try {
      const response = await submitCommunityComment(
        locationId,
        bodyText,
        user.id,
        undefined,
        confirmCensored,
        replyingTo?.parentId ?? null
      );

      const censoredText =
        confirmCensored && censorConfirm?.censoredPreview
          ? censorConfirm.censoredPreview
          : bodyText.trim();

      const newReview: CommunityReview = {
        id: response.commentId,
        author: displayName,
        initials,
        age: 'Vừa xong',
        helpfulCount: 1,
        likesCount: 0,
        comment: censoredText,
        status: response.status ?? 'Approved',
        isOwn: true,
        createdAtIso: response.createdAt,
        version: response.version,
        editableUntilIso: new Date(
          Date.parse(response.createdAt) + EDIT_WINDOW_MS
        ).toISOString(),
        parentCommentId: replyingTo?.rootId ?? null,
        replyToAuthorLabel: replyingTo?.author ?? null,
      };

      onCommentAdded(newReview);
      if (replyingTo?.rootId) {
        setExpandedReplyGroups((prev) => ({ ...prev, [replyingTo.rootId]: true }));
      }
      setReplyingTo(null);

      try {
        const rawTimestamps = await AsyncStorage.getItem(rateLimitStorageKey);
        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;
        const recentTimestamps: number[] = rawTimestamps
          ? JSON.parse(rawTimestamps).filter((ts: number) => ts > oneHourAgo)
          : [];
        recentTimestamps.push(now);
        await AsyncStorage.setItem(rateLimitStorageKey, JSON.stringify(recentTimestamps));
      } catch {}

      setCommentBody('');
      setCensorConfirm(null);
      setSuccessBanner(
        response.wasCensored
          ? 'Đã đăng nhận xét với từ vi phạm được che ***. Hệ thống đã ghi nhận báo cáo tự động gửi Quản trị viên.'
          : 'Đã đăng nhận xét thành công! Nhận xét đã hiển thị công khai và có thể chỉnh sửa trong 60 phút.'
      );
    } catch (error) {
      if (
        error instanceof AuthenticationRequiredError ||
        (error instanceof ApiError && error.status === 401)
      ) {
        onRequireLogin('gửi nhận xét cộng đồng');
      } else if (error instanceof ApiError && error.code === 'COMMENT_REQUIRES_CENSOR_CONFIRM') {
        const details = (error.details ?? {}) as {
          matchedTerms?: string[];
          censoredPreview?: string;
        };
        setCensorConfirm({
          mode: 'create',
          rawBody: bodyText,
          matchedTerms: Array.isArray(details.matchedTerms) ? details.matchedTerms : [],
          censoredPreview: details.censoredPreview || bodyText,
        });
      } else if (error instanceof ApiError && error.status === 429) {
        setInlineError(
          `Bạn đã đạt giới hạn tối đa ${HOURLY_COMMENT_LIMIT} nhận xét mỗi giờ. Vui lòng thử lại sau.`
        );
      } else if (error instanceof ApiError && error.status === 422) {
        setInlineError(
          error.message || 'Nội dung nhận xét không hợp lệ (tối đa 1.500 ký tự).'
        );
      } else {
        setInlineError('Không thể gửi nhận xét lúc này. Vui lòng kiểm tra kết nối và thử lại.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitComment = async () => {
    setSuccessBanner(null);

    if (!user) {
      onRequireLogin('gửi nhận xét cộng đồng');
      return;
    }

    if (trimmedLength === 0) {
      setInlineError('Vui lòng nhập nội dung nhận xét trước khi gửi.');
      return;
    }

    if (rawLength > MAX_COMMENT_LENGTH) {
      setInlineError(
        `Nhận xét vượt quá giới hạn tối đa ${MAX_COMMENT_LENGTH.toLocaleString('vi-VN')} ký tự.`
      );
      return;
    }

    try {
      const rawTimestamps = await AsyncStorage.getItem(rateLimitStorageKey);
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const recentTimestamps: number[] = rawTimestamps
        ? JSON.parse(rawTimestamps).filter((ts: number) => ts > oneHourAgo)
        : [];
      if (recentTimestamps.length >= HOURLY_COMMENT_LIMIT) {
        setInlineError(
          `Bạn đã gửi tối đa ${HOURLY_COMMENT_LIMIT} nhận xét trong 1 giờ qua. Vui lòng thử lại sau.`
        );
        return;
      }
    } catch {}

    await submitCreateFlow(commentBody, false);
  };

  const submitEditFlow = async (
    target: CommunityReview,
    nextBody: string,
    confirmCensored: boolean
  ) => {
    if (!nextBody.trim()) {
      Alert.alert('Thiếu nội dung', 'Nội dung nhận xét không được để trống.');
      return;
    }
    setIsSavingEdit(true);
    try {
      const res = await updateCommunityComment(
        locationId,
        target.id,
        nextBody,
        target.version,
        confirmCensored
      );
      const finalText =
        confirmCensored && censorConfirm?.censoredPreview
          ? censorConfirm.censoredPreview
          : nextBody.trim();
      onCommentUpdated?.({
        ...target,
        comment: finalText,
        version: res.version,
        isEdited: true,
      });
      setEditingReview(null);
      setEditBody('');
      setCensorConfirm(null);
      setSuccessBanner(
        res.wasCensored
          ? 'Đã cập nhật nhận xét (che ***) và ghi nhận báo cáo từ cấm.'
          : 'Đã cập nhật nhận xét thành công.'
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'COMMENT_REQUIRES_CENSOR_CONFIRM') {
        const details = (error.details ?? {}) as {
          matchedTerms?: string[];
          censoredPreview?: string;
        };
        setCensorConfirm({
          mode: 'edit',
          rawBody: nextBody,
          matchedTerms: Array.isArray(details.matchedTerms) ? details.matchedTerms : [],
          censoredPreview: details.censoredPreview || nextBody,
          editCommentId: target.id,
          editVersion: target.version,
        });
      } else if (error instanceof ApiError && error.code === 'COMMENT_EDIT_WINDOW_EXPIRED') {
        setEditingReview(null);
        Alert.alert('Hết thời gian chỉnh sửa', 'Nhận xét chỉ có thể chỉnh sửa trong vòng 60 phút sau khi đăng.');
      } else {
        Alert.alert('Lỗi', error instanceof Error ? error.message : 'Không thể cập nhật nhận xét.');
      }
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteComment = (rev: CommunityReview) => {
    Alert.alert('Xóa nhận xét', 'Bạn có chắc chắn muốn xóa nhận xét này khỏi địa điểm?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCommunityComment(locationId, rev.id);
            onCommentDeleted?.(rev.id);
            setSuccessBanner('Đã xóa nhận xét của bạn.');
          } catch (error) {
            Alert.alert('Lỗi', error instanceof Error ? error.message : 'Không thể xóa nhận xét.');
          }
        },
      },
    ]);
  };

  const handleOpenReport = (rev: CommunityReview) => {
    if (!user) {
      onRequireLogin('báo cáo nhận xét vi phạm');
      return;
    }
    setReportingReview(rev);
    setReportCategory('SpamAdvertising');
    setReportDescription('');
    setReportError(null);
  };

  const handleSubmitReport = async () => {
    if (!reportingReview) return;
    if (reportDescription.trim().length < 10) {
      setReportError('Vui lòng mô tả lý do báo cáo tối thiểu 10 ký tự.');
      return;
    }
    setIsSendingReport(true);
    setReportError(null);
    try {
      await reportCommunityComment(locationId, {
        commentId: reportingReview.id,
        reportedCommentVersion: reportingReview.version ?? 1,
        category: reportCategory,
        description: reportDescription.trim(),
      });
      setReportingReview(null);
      setSuccessBanner('Đã gửi báo cáo nhận xét tới Quản trị viên để xem xét.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        void onRefreshComments?.();
        setReportError(
          'Phiên bản nhận xét vừa thay đổi. Danh sách đã được làm mới, vui lòng đóng và gửi lại báo cáo.'
        );
      } else if (error instanceof ApiError && error.status === 429) {
        setReportError(
          error.code === 'REPORT_BURST_RATE_LIMITED'
            ? 'Bạn đang gửi báo cáo quá nhanh trong thời gian ngắn. Hành vi spam báo cáo có thể bị trừ điểm uy tín.'
            : 'Bạn đã đạt giới hạn gửi báo cáo hôm nay.'
        );
      } else {
        setReportError(error instanceof Error ? error.message : 'Không thể gửi báo cáo lúc này.');
      }
    } finally {
      setIsSendingReport(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Sub-header inside Location Detail Sheet */}
      <View style={styles.subHeader}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Quay lại thông tin chi tiết địa điểm"
        >
          <MaterialCommunityIcons name="arrow-left" size={18} color="#006874" />
          <Text style={styles.backButtonText}>Chi tiết địa điểm</Text>
        </TouchableOpacity>

        <View style={styles.countPill}>
          <MaterialCommunityIcons name="forum-outline" size={14} color="#007D78" />
          <Text style={styles.countPillText}>{allDisplayReviews.length} nhận xét</Text>
        </View>
      </View>

      {/* Location Context Banner */}
      <View style={styles.locationContextBox}>
        <View style={styles.locationIconCircle}>
          <MaterialCommunityIcons name="map-marker-check-outline" size={18} color="#007D78" />
        </View>
        <View style={styles.locationContextCopy}>
          <Text style={styles.locationContextName} numberOfLines={1}>
            {locationName}
          </Text>
          <Text style={styles.locationContextSub}>
            {locationCategory ? `${locationCategory} • ` : ''}Cộng đồng chia sẻ trải nghiệm tiếp cận
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        {/* Filter Tabs */}
        <View style={styles.filterRow}>
          {(
            [
              { key: 'all', label: 'Tất cả', icon: 'comment-multiple-outline' },
              { key: 'helpful', label: 'Hữu ích nhất', icon: 'fire' },
              { key: 'newest', label: 'Mới nhất', icon: 'clock-outline' },
              { key: 'mine', label: 'Của bạn', icon: 'account-Check-outline' },
            ] as const
          ).map((item) => {
            const active = filter === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setFilter(item.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Comment Feed */}
        {isLoading && filteredReviews.length === 0 ? (
          <View style={styles.emptyFeedBox}>
            <ActivityIndicator size="small" color="#006874" />
            <Text style={styles.emptyFeedTitle}>Đang tải nhận xét cộng đồng...</Text>
          </View>
        ) : filteredReviews.length === 0 ? (
          <View style={styles.emptyFeedBox}>
            <MaterialCommunityIcons name="comment-text-multiple-outline" size={32} color="#94A3B8" />
            <Text style={styles.emptyFeedTitle}>
              {filter === 'mine'
                ? 'Bạn chưa có nhận xét nào tại địa điểm này'
                : 'Chưa có nhận xét nào được hiển thị'}
            </Text>
            <Text style={styles.emptyFeedSub}>
              Chia sẻ đánh giá thực tế của bạn ở khung phía trên để giúp cộng đồng di chuyển an toàn hơn.
            </Text>
          </View>
        ) : (
          filteredReviews.map((rev, idx) => {
            const revReaction = reactions[rev.id] ?? {};
            const upvoted = Boolean(revReaction.upvoted);
            const liked = Boolean(revReaction.liked);
            const disliked = Boolean(revReaction.disliked);
            const totalHelpful = rev.helpfulCount + (upvoted ? 1 : 0);
            const totalLikes = (rev.likesCount ?? 3) + (liked ? 1 : 0);
            const isPending = rev.status === 'PendingReview';
            const remainingEditMin = getRemainingEditMinutes(rev);
            const isEditingThis = editingReview?.id === rev.id;

            return (
              <View
                key={`${rev.id || 'rev'}-${idx}`}
                style={[styles.commentCard, isPending && styles.commentCardPending]}
              >
                <View style={styles.cardHeader}>
                  <View style={[styles.avatar, rev.isOwn && styles.ownAvatar]}>
                    <Text style={styles.avatarText}>{rev.initials}</Text>
                  </View>

                  <View style={styles.authorMeta}>
                    <View style={styles.authorNameRow}>
                      <Text style={styles.authorName}>{rev.author}</Text>
                      {rev.isOwn ? (
                        <View style={styles.youBadge}>
                          <Text style={styles.youBadgeText}>Bạn</Text>
                        </View>
                      ) : null}
                      {rev.isEdited ? (
                        <Text style={styles.editedTag}>· đã chỉnh sửa</Text>
                      ) : null}
                    </View>
                    <Text style={styles.authorTime}>{rev.age}</Text>
                  </View>

                  <View style={styles.cardTopActions}>
                    {isPending ? (
                      <View style={styles.pendingStatusBadge}>
                        <MaterialCommunityIcons name="clock-outline" size={12} color="#B45309" />
                        <Text style={styles.pendingStatusText}>Chờ duyệt</Text>
                      </View>
                    ) : null}

                    {rev.isOwn && !rev.id.startsWith('demo-') && !rev.id.startsWith('local-') ? (
                      <View style={styles.ownerActionsRow}>
                        {remainingEditMin > 0 && !isEditingThis ? (
                          <TouchableOpacity
                            style={styles.ownerActionBtn}
                            onPress={() => {
                              setEditingReview(rev);
                              setEditBody(rev.comment);
                            }}
                          >
                            <MaterialCommunityIcons name="pencil-outline" size={13} color="#006874" />
                            <Text style={styles.ownerActionText}>Sửa ({remainingEditMin}p)</Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          style={[styles.ownerActionBtn, styles.ownerDeleteBtn]}
                          onPress={() => handleDeleteComment(rev)}
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={13} color="#DC2626" />
                        </TouchableOpacity>
                      </View>
                    ) : !rev.isOwn && !rev.id.startsWith('demo-') ? (
                      <TouchableOpacity
                        style={styles.reportFlagBtn}
                        onPress={() => handleOpenReport(rev)}
                        accessibilityLabel="Báo cáo nhận xét"
                      >
                        <MaterialCommunityIcons name="flag-outline" size={15} color="#64748B" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                {isEditingThis ? (
                  <View style={styles.inlineEditBox}>
                    <TextInput
                      style={styles.inlineEditInput}
                      multiline
                      value={editBody}
                      onChangeText={setEditBody}
                      maxLength={MAX_COMMENT_LENGTH}
                      editable={!isSavingEdit}
                    />
                    <View style={styles.inlineEditActions}>
                      <TouchableOpacity
                        style={styles.inlineCancelBtn}
                        onPress={() => {
                          setEditingReview(null);
                          setEditBody('');
                        }}
                        disabled={isSavingEdit}
                      >
                        <Text style={styles.inlineCancelText}>Hủy</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.inlineSaveBtn}
                        onPress={() => void submitEditFlow(rev, editBody, false)}
                        disabled={isSavingEdit}
                      >
                        {isSavingEdit ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.inlineSaveText}>Lưu thay đổi</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.commentBody}>{rev.comment}</Text>
                )}

                {isPending ? (
                  <View style={styles.pendingNoticeRow}>
                    <MaterialCommunityIcons name="information-outline" size={13} color="#B45309" />
                    <Text style={styles.pendingNoticeText}>
                      Nhận xét này đang ở trạng thái PendingReview và sẽ hiển thị cho mọi người sau khi được duyệt.
                    </Text>
                  </View>
                ) : null}

                {/* Social Interaction Bar (Compact) */}
                <View style={styles.reactionBar}>
                  <TouchableOpacity
                    style={[styles.reactionBtn, upvoted && styles.reactionBtnUpvoteActive]}
                    onPress={() => void toggleReaction(rev.id, 'upvoted')}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`Hữu ích (${totalHelpful})`}
                  >
                    <MaterialCommunityIcons
                      name={upvoted ? 'thumb-up' : 'thumb-up-outline'}
                      size={13}
                      color={upvoted ? '#007D78' : '#64748B'}
                    />
                    <Text
                      style={[
                        styles.reactionBtnText,
                        upvoted && styles.reactionBtnUpvoteTextActive,
                      ]}
                    >
                      {totalHelpful}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.reactionBtn, liked && styles.reactionBtnLikeActive]}
                    onPress={() => void toggleReaction(rev.id, 'liked')}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`Yêu thích (${totalLikes})`}
                  >
                    <MaterialCommunityIcons
                      name={liked ? 'heart' : 'heart-outline'}
                      size={13}
                      color={liked ? '#E11D48' : '#64748B'}
                    />
                    <Text
                      style={[
                        styles.reactionBtnText,
                        liked && styles.reactionBtnLikeTextActive,
                      ]}
                    >
                      {totalLikes}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.reactionBtn, disliked && styles.reactionBtnDislikeActive]}
                    onPress={() => void toggleReaction(rev.id, 'disliked')}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Không đồng tình"
                  >
                    <MaterialCommunityIcons
                      name={disliked ? 'thumb-down' : 'thumb-down-outline'}
                      size={13}
                      color={disliked ? '#B45309' : '#64748B'}
                    />
                  </TouchableOpacity>

                  {!rev.id.startsWith('demo-') && !rev.id.startsWith('local-') ? (
                    <TouchableOpacity
                      style={styles.reactionBtn}
                      onPress={() => handleStartReply(rev, rev.id)}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel="Phản hồi nhận xét"
                    >
                      <MaterialCommunityIcons name="reply-outline" size={14} color="#006874" />
                      <Text style={[styles.reactionBtnText, { color: '#006874' }]}>
                        Phản hồi{(repliesByRootId[rev.id]?.length ?? 0) > 0 ? ` (${repliesByRootId[rev.id].length})` : ''}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Nested 1-level Child Replies (Facebook/YouTube style) */}
                {(repliesByRootId[rev.id]?.length ?? 0) > 0 ? (() => {
                  const allReplies = repliesByRootId[rev.id];
                  const isExpanded = Boolean(expandedReplyGroups[rev.id]);
                  const visibleReplies = isExpanded ? allReplies : allReplies.slice(0, 2);
                  const hiddenCount = allReplies.length - visibleReplies.length;
                  return (
                    <View style={styles.repliesThread}>
                      {visibleReplies.map((rep, repIdx) => {
                        const repLiked = Boolean(reactions[rep.id]?.liked);
                        const repRemMin = getRemainingEditMinutes(rep);
                        const isEditingRep = editingReview?.id === rep.id;
                        return (
                          <View key={`${rep.id}-${repIdx}`} style={styles.replyItem}>
                            <View style={styles.replyHeader}>
                              <View style={[styles.replyAvatar, rep.isOwn && styles.ownAvatar]}>
                                <Text style={styles.replyAvatarText}>{rep.initials}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <View style={styles.authorNameRow}>
                                  <Text style={styles.replyAuthorName}>{rep.author}</Text>
                                  {rep.isOwn ? (
                                    <View style={styles.youBadge}>
                                      <Text style={styles.youBadgeText}>Bạn</Text>
                                    </View>
                                  ) : null}
                                  {rep.isEdited ? (
                                    <Text style={styles.editedTag}>· đã sửa</Text>
                                  ) : null}
                                </View>
                                <Text style={styles.replyTime}>{rep.age}</Text>
                              </View>
                              {rep.isOwn && !rep.id.startsWith('demo-') && !rep.id.startsWith('local-') ? (
                                <View style={styles.ownerActionsRow}>
                                  {repRemMin > 0 && !isEditingRep ? (
                                    <TouchableOpacity
                                      style={styles.ownerActionBtn}
                                      onPress={() => {
                                        setEditingReview(rep);
                                        setEditBody(rep.comment);
                                      }}
                                    >
                                      <MaterialCommunityIcons name="pencil-outline" size={12} color="#006874" />
                                    </TouchableOpacity>
                                  ) : null}
                                  <TouchableOpacity
                                    style={[styles.ownerActionBtn, styles.ownerDeleteBtn]}
                                    onPress={() => handleDeleteComment(rep)}
                                  >
                                    <MaterialCommunityIcons name="trash-can-outline" size={12} color="#DC2626" />
                                  </TouchableOpacity>
                                </View>
                              ) : !rep.isOwn && !rep.id.startsWith('demo-') ? (
                                <TouchableOpacity
                                  style={styles.reportFlagBtn}
                                  onPress={() => handleOpenReport(rep)}
                                >
                                  <MaterialCommunityIcons name="flag-outline" size={13} color="#64748B" />
                                </TouchableOpacity>
                              ) : null}
                            </View>

                            {isEditingRep ? (
                              <View style={styles.inlineEditBox}>
                                <TextInput
                                  style={styles.inlineEditInput}
                                  multiline
                                  value={editBody}
                                  onChangeText={setEditBody}
                                  maxLength={MAX_COMMENT_LENGTH}
                                  editable={!isSavingEdit}
                                />
                                <View style={styles.inlineEditActions}>
                                  <TouchableOpacity
                                    style={styles.inlineCancelBtn}
                                    onPress={() => {
                                      setEditingReview(null);
                                      setEditBody('');
                                    }}
                                    disabled={isSavingEdit}
                                  >
                                    <Text style={styles.inlineCancelText}>Hủy</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.inlineSaveBtn}
                                    onPress={() => void submitEditFlow(rep, editBody, false)}
                                    disabled={isSavingEdit}
                                  >
                                    {isSavingEdit ? (
                                      <ActivityIndicator size="small" color="#FFFFFF" />
                                    ) : (
                                      <Text style={styles.inlineSaveText}>Lưu</Text>
                                    )}
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ) : (
                              <Text style={styles.replyBody}>
                                {rep.replyToAuthorLabel && rep.replyToAuthorLabel !== rev.author ? (
                                  <Text style={styles.mentionText}>@{rep.replyToAuthorLabel} </Text>
                                ) : null}
                                {rep.comment}
                              </Text>
                            )}

                            <View style={styles.replyActionsBar}>
                              <TouchableOpacity
                                style={styles.replyMiniBtn}
                                onPress={() => void toggleReaction(rep.id, 'liked')}
                              >
                                <MaterialCommunityIcons
                                  name={repLiked ? 'heart' : 'heart-outline'}
                                  size={12}
                                  color={repLiked ? '#E11D48' : '#64748B'}
                                />
                                <Text style={[styles.replyMiniText, repLiked && { color: '#E11D48' }]}>
                                  Thích
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.replyMiniBtn}
                                onPress={() => handleStartReply(rep, rev.id)}
                              >
                                <MaterialCommunityIcons name="reply-outline" size={12} color="#006874" />
                                <Text style={[styles.replyMiniText, { color: '#006874' }]}>
                                  Phản hồi
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })}

                      {hiddenCount > 0 ? (
                        <TouchableOpacity
                          style={styles.expandRepliesBtn}
                          onPress={() =>
                            setExpandedReplyGroups((prev) => ({ ...prev, [rev.id]: true }))
                          }
                        >
                          <MaterialCommunityIcons name="subdirectory-arrow-right" size={14} color="#006874" />
                          <Text style={styles.expandRepliesText}>
                            Xem thêm {hiddenCount} phản hồi
                          </Text>
                        </TouchableOpacity>
                      ) : allReplies.length > 2 ? (
                        <TouchableOpacity
                          style={styles.expandRepliesBtn}
                          onPress={() =>
                            setExpandedReplyGroups((prev) => ({ ...prev, [rev.id]: false }))
                          }
                        >
                          <MaterialCommunityIcons name="chevron-up" size={14} color="#64748B" />
                          <Text style={[styles.expandRepliesText, { color: '#64748B' }]}>
                            Thu gọn phản hồi
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                })() : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Pinned Bottom Composer Bar (Facebook Mobile Style) */}
      <View
        style={[
          styles.pinnedComposerBar,
          { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 6 : Math.max(10, insets.bottom + 6) },
        ]}
      >
        {replyingTo ? (
          <View style={styles.replyingBanner}>
            <MaterialCommunityIcons name="reply" size={14} color="#006874" />
            <Text style={styles.replyingBannerText} numberOfLines={1}>
              Đang phản hồi <Text style={{ fontWeight: '800' }}>{replyingTo.author}</Text>
            </Text>
            <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <MaterialCommunityIcons name="close-circle" size={16} color="#64748B" />
            </TouchableOpacity>
          </View>
        ) : null}

        {inlineError ? (
          <View style={[styles.inlineErrorBox, { marginTop: 0, marginBottom: 6 }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={15} color="#DC2626" />
            <Text style={styles.inlineErrorText}>{inlineError}</Text>
          </View>
        ) : null}

        {successBanner ? (
          <View style={[styles.successBannerBox, { marginTop: 0, marginBottom: 6 }]}>
            <MaterialCommunityIcons name="check-circle-outline" size={15} color="#007D78" />
            <Text style={styles.successBannerText}>{successBanner}</Text>
          </View>
        ) : null}

        {showQuickTags ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.quickTagsRow, { paddingBottom: 6 }]}
          >
            {QUICK_TAGS.map((tag) => (
              <TouchableOpacity
                key={tag}
                style={styles.quickTagChip}
                onPress={() => handleQuickTagPress(tag)}
                activeOpacity={0.75}
              >
                <MaterialCommunityIcons name="plus" size={12} color="#007D78" />
                <Text style={styles.quickTagText}>{tag}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.pinnedInputRow}>
          <TouchableOpacity
            style={[styles.quickToggleBtn, showQuickTags && styles.quickToggleBtnActive]}
            onPress={() => setShowQuickTags((v) => !v)}
            accessibilityLabel="Gợi ý nhanh"
          >
            <MaterialCommunityIcons
              name={showQuickTags ? 'chevron-down' : 'lightning-bolt-outline'}
              size={18}
              color={showQuickTags ? '#FFFFFF' : '#006874'}
            />
          </TouchableOpacity>

          <View
            style={[
              styles.pinnedInputBox,
              (isOverLength || inlineError) && styles.inputWrapperError,
            ]}
          >
            <TextInput
              ref={composerInputRef}
              style={styles.pinnedTextInput}
              multiline
              placeholder={
                replyingTo
                  ? `Phản hồi ${replyingTo.author}...`
                  : 'Viết nhận xét của bạn (lối đi, ram dốc, cửa)...'
              }
              placeholderTextColor="#94A3B8"
              value={commentBody}
              onChangeText={handleChangeText}
              editable={!submitting}
              accessibilityLabel="Nhập nội dung nhận xét cộng đồng"
            />
          </View>

          <TouchableOpacity
            style={[
              styles.pinnedSendBtn,
              (submitting || isOverLength || trimmedLength === 0) && styles.sendButtonDisabled,
            ]}
            onPress={() => void handleSubmitComment()}
            disabled={submitting}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="Đăng nhận xét cộng đồng"
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <MaterialCommunityIcons name="send" size={16} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
        {rawLength > 0 ? (
          <Text
            style={[
              styles.charCounter,
              { marginTop: 4, textAlign: 'right' },
              rawLength > MAX_COMMENT_LENGTH * 0.9 && styles.charCounterWarn,
              isOverLength && styles.charCounterError,
            ]}
          >
            {rawLength.toLocaleString('vi-VN')} / {MAX_COMMENT_LENGTH.toLocaleString('vi-VN')} ký tự · Đăng ngay
          </Text>
        ) : null}
      </View>

      {/* 2-Step Profanity / External Link Censorship Confirmation Modal */}
      <Modal
        visible={Boolean(censorConfirm)}
        transparent
        animationType="fade"
        onRequestClose={() => setCensorConfirm(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <MaterialCommunityIcons name="alert-circle" size={22} color="#D97706" />
              <Text style={styles.modalTitle}>Phát hiện từ cấm / liên kết lạ</Text>
            </View>
            <Text style={styles.modalDesc}>
              Nội dung của bạn có chứa từ khóa hoặc đường dẫn không phù hợp sau:
            </Text>
            <View style={styles.termsWrap}>
              {(censorConfirm?.matchedTerms ?? []).map((term, idx) => (
                <View key={`${term}-${idx}`} style={styles.termChip}>
                  <Text style={styles.termChipText}>{term}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.previewLabel}>Xem trước nếu tiếp tục đăng:</Text>
            <View style={styles.previewBox}>
              <Text style={styles.previewText}>{censorConfirm?.censoredPreview}</Text>
            </View>
            <Text style={styles.modalWarnNote}>
              Lưu ý: Nếu vẫn tiếp tục đăng, các từ trên sẽ bị che thành *** và tài khoản của bạn sẽ tự động bị ghi nhận báo cáo vi phạm gửi Quản trị viên.
            </Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalSecondaryBtn}
                onPress={() => setCensorConfirm(null)}
              >
                <Text style={styles.modalSecondaryText}>Sửa lại</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalDangerBtn}
                onPress={() => {
                  if (!censorConfirm) return;
                  if (censorConfirm.mode === 'create') {
                    void submitCreateFlow(censorConfirm.rawBody, true);
                  } else if (editingReview) {
                    void submitEditFlow(editingReview, censorConfirm.rawBody, true);
                  }
                }}
              >
                <Text style={styles.modalDangerText}>Vẫn đăng (***)</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Report Comment Modal */}
      <KeyboardSafeModal
        visible={Boolean(reportingReview)}
        animationType="slide"
        onRequestClose={() => !isSendingReport && setReportingReview(null)}
        onBackdropPress={() => !isSendingReport && setReportingReview(null)}
        containerStyle={{ paddingHorizontal: 0, justifyContent: 'flex-end' }}
        contentContainerStyle={{ justifyContent: 'flex-end', paddingBottom: 0 }}
      >
        <View style={styles.reportSheet}>
          <View style={styles.modalHeaderRow}>
            <MaterialCommunityIcons name="flag-variant" size={21} color="#DC2626" />
            <Text style={styles.modalTitle}>Báo cáo nhận xét vi phạm</Text>
          </View>
          <Text style={styles.modalDesc}>
            Chọn lý do báo cáo để Quản trị viên kiểm tra. Báo cáo sai sự thật hoặc spam hàng loạt có thể bị trừ điểm uy tín.
          </Text>
          <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 8 }}>
              {REPORT_CATEGORIES.map((cat) => {
                const selected = reportCategory === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.reasonRow, selected && styles.reasonRowActive]}
                    onPress={() => setReportCategory(cat.id)}
                  >
                    <MaterialCommunityIcons
                      name={cat.icon}
                      size={18}
                      color={selected ? '#006874' : '#64748B'}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.reasonTitle, selected && { color: '#004F58' }]}>
                        {cat.label}
                      </Text>
                      <Text style={styles.reasonSub}>{cat.desc}</Text>
                    </View>
                    <MaterialCommunityIcons
                      name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                      size={18}
                      color={selected ? '#006874' : '#CBD5E1'}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <TextInput
            style={styles.reportInput}
            multiline
            placeholder="Mô tả chi tiết lý do báo cáo (tối thiểu 10 ký tự)..."
            placeholderTextColor="#94A3B8"
            value={reportDescription}
            onChangeText={(t) => {
              setReportDescription(t);
              if (reportError) setReportError(null);
            }}
          />
          {reportError ? <Text style={styles.reportErrText}>{reportError}</Text> : null}
          <View style={styles.modalBtnRow}>
            <TouchableOpacity
              style={styles.modalSecondaryBtn}
              onPress={() => setReportingReview(null)}
              disabled={isSendingReport}
            >
              <Text style={styles.modalSecondaryText}>Hủy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={() => void handleSubmitReport()}
              disabled={isSendingReport}
            >
              {isSendingReport ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.modalDangerText}>Gửi báo cáo</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardSafeModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  backButtonText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#006874',
  },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  locationContextBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  locationIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#E6F8F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationContextCopy: {
    flex: 1,
  },
  locationContextName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  locationContextSub: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 1,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 36,
  },
  composerCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    padding: 13,
    marginBottom: 14,
  },
  composerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 9,
  },
  composerTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
  },
  moderationHintBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E6F8F5',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  moderationHintText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#006874',
  },
  quickTagsRow: {
    gap: 6,
    paddingBottom: 9,
  },
  quickTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  quickTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  inputWrapper: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingTop: 9,
    paddingBottom: 8,
  },
  inputWrapperError: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  textInput: {
    minHeight: 68,
    maxHeight: 130,
    fontSize: 13,
    lineHeight: 18,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
  composerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  charCounter: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  charCounterWarn: {
    color: '#D97706',
  },
  charCounterError: {
    color: '#DC2626',
    fontWeight: '800',
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#007D78',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  sendButtonDisabled: {
    opacity: 0.55,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  inlineErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 9,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 9,
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 16,
    color: '#B91C1C',
    fontWeight: '600',
  },
  successBannerBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: 9,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    borderRadius: 10,
    padding: 9,
  },
  successBannerText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 16,
    color: '#0F766E',
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#006874',
    borderColor: '#006874',
  },
  filterChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  emptyFeedBox: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 24,
    marginTop: 4,
  },
  emptyFeedTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#334155',
    marginTop: 8,
    textAlign: 'center',
  },
  emptyFeedSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 4,
  },
  commentCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 13,
    marginBottom: 11,
  },
  commentCardPending: {
    borderColor: '#FDE68A',
    backgroundColor: '#FFFDF5',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#004E58',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  ownAvatar: {
    backgroundColor: '#007D78',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  authorMeta: {
    flex: 1,
  },
  authorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  authorName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  youBadge: {
    backgroundColor: '#E6F8F5',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#007D78',
  },
  authorTime: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
  },
  pendingStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pendingStatusText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#B45309',
  },
  approvedStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  approvedStatusText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#007D78',
  },
  commentBody: {
    fontSize: 13,
    lineHeight: 19,
    color: '#1E293B',
    marginBottom: 10,
  },
  pendingNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF9C3',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
    marginBottom: 10,
  },
  pendingNoticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    color: '#854D0E',
  },
  reactionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  reactionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 5.5,
    borderRadius: 999,
  },
  reactionBtnUpvoteActive: {
    backgroundColor: '#E6F8F5',
    borderColor: '#99F6E4',
  },
  reactionBtnLikeActive: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
  },
  reactionBtnDislikeActive: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  reactionBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748B',
  },
  reactionBtnUpvoteTextActive: {
    color: '#007D78',
  },
  reactionBtnLikeTextActive: {
    color: '#E11D48',
  },
  reactionBtnDislikeTextActive: {
    color: '#B45309',
  },
  editedTag: {
    fontSize: 10.5,
    color: '#64748B',
    fontStyle: 'italic',
  },
  cardTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ownerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ownerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  ownerDeleteBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    paddingHorizontal: 7,
  },
  ownerActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#006874',
  },
  reportFlagBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
  },
  inlineEditBox: {
    gap: 8,
    marginBottom: 10,
  },
  inlineEditInput: {
    borderWidth: 1,
    borderColor: '#007D78',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 72,
    textAlignVertical: 'top',
    backgroundColor: '#F8FAFC',
  },
  inlineEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  inlineCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  inlineCancelText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  inlineSaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#006874',
    minWidth: 96,
    alignItems: 'center',
  },
  inlineSaveText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  reportSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalDesc: {
    fontSize: 12.5,
    color: '#475569',
    lineHeight: 18,
  },
  termsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  termChip: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  termChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
  previewLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#334155',
  },
  previewBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
  },
  previewText: {
    fontSize: 12.5,
    color: '#0F172A',
    lineHeight: 18,
  },
  modalWarnNote: {
    fontSize: 11.5,
    color: '#B45309',
    backgroundColor: '#FFFBEB',
    padding: 9,
    borderRadius: 8,
    lineHeight: 16,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  modalSecondaryBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  modalSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  modalDangerBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#D97706',
    alignItems: 'center',
  },
  modalPrimaryBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#DC2626',
    alignItems: 'center',
  },
  modalDangerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  reasonRowActive: {
    borderColor: '#007D78',
    backgroundColor: '#F0FDFA',
  },
  reasonTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  reasonSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  reportInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    padding: 10,
    fontSize: 12.5,
    color: '#0F172A',
    minHeight: 72,
    textAlignVertical: 'top',
  },
  reportErrText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
  },
  repliesThread: {
    marginTop: 10,
    marginLeft: 12,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#E2E8F0',
    gap: 10,
  },
  replyItem: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  replyAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyAvatarText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  replyAuthorName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  replyTime: {
    fontSize: 10.5,
    color: '#64748B',
  },
  replyBody: {
    fontSize: 12.5,
    color: '#1E293B',
    lineHeight: 18,
  },
  mentionText: {
    fontWeight: '700',
    color: '#006874',
  },
  replyActionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 2,
  },
  replyMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  replyMiniText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  expandRepliesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  expandRepliesText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#006874',
  },
  pinnedComposerBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  replyingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDFA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
  },
  replyingBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#0F172A',
  },
  pinnedInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  quickToggleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickToggleBtnActive: {
    backgroundColor: '#006874',
    borderColor: '#006874',
  },
  pinnedInputBox: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    maxHeight: 110,
  },
  pinnedTextInput: {
    fontSize: 13.5,
    color: '#0F172A',
    minHeight: 24,
    maxHeight: 90,
  },
  pinnedSendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#006874',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

