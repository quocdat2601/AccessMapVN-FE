import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/shared/theme';
import {
  loadSavedFavorites,
  removeSavedFavoriteById,
  requestFavoriteMapFocus,
  subscribeFavorites,
  updateSavedFavoriteMeta,
  type FavoriteCategoryPreset,
  type SavedFavoritePlace,
} from '../model/favoritesStorage';

interface FavoritesModalProps {
  visible: boolean;
  isGuest: boolean;
  onClose: () => void;
  onSelectPlace?: (place: SavedFavoritePlace) => void;
}

interface CategoryPresetConfig {
  id: FavoriteCategoryPreset;
  chipLabel: string;
  badgeLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
}

const CATEGORY_PRESETS: CategoryPresetConfig[] = [
  {
    id: 'home',
    chipLabel: 'Nhà 🏠',
    badgeLabel: 'Cá nhân',
    icon: 'home-outline',
    iconBg: '#CCFBF1',
    iconColor: '#0F766E',
    badgeBg: '#E2E8F0',
    badgeText: '#334155',
  },
  {
    id: 'work',
    chipLabel: 'Công sở 💼',
    badgeLabel: 'Công sở',
    icon: 'business-outline',
    iconBg: '#E0F2FE',
    iconColor: '#0369A1',
    badgeBg: '#BAE6FD',
    badgeText: '#0369A1',
  },
  {
    id: 'food',
    chipLabel: 'Quán ăn 🍽️',
    badgeLabel: 'Ẩm thực',
    icon: 'restaurant-outline',
    iconBg: '#CCFBF1',
    iconColor: '#0F766E',
    badgeBg: '#E2E8F0',
    badgeText: '#334155',
  },
  {
    id: 'health',
    chipLabel: 'Y tế 🏥',
    badgeLabel: 'Y tế',
    icon: 'medical-outline',
    iconBg: '#FFE4E6',
    iconColor: '#BE123C',
    badgeBg: '#FECDD3',
    badgeText: '#BE123C',
  },
  {
    id: 'other',
    chipLabel: 'Khác 📍',
    badgeLabel: 'Đã lưu',
    icon: 'bookmark-outline',
    iconBg: '#E0F7FA',
    iconColor: '#006874',
    badgeBg: '#E2E8F0',
    badgeText: '#475569',
  },
];

function resolveCategoryPreset(place: SavedFavoritePlace): CategoryPresetConfig {
  if (place.customCategory) {
    const found = CATEGORY_PRESETS.find((c) => c.id === place.customCategory);
    if (found) return found;
  }
  const cat = (place.category || '').toLowerCase();
  if (cat.includes('hospital') || cat.includes('clinic') || cat.includes('health') || cat.includes('pharmacy')) {
    return CATEGORY_PRESETS[3];
  }
  if (cat.includes('food') || cat.includes('cafe') || cat.includes('restaurant') || cat.includes('coffee')) {
    return CATEGORY_PRESETS[2];
  }
  if (cat.includes('office') || cat.includes('work') || cat.includes('school') || cat.includes('university')) {
    return CATEGORY_PRESETS[1];
  }
  return CATEGORY_PRESETS[4];
}

export function FavoritesModal({ visible, isGuest, onClose, onSelectPlace }: FavoritesModalProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeTop = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0,
    12
  );
  const [items, setItems] = useState<SavedFavoritePlace[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Edit / Personalize modal state
  const [editingPlace, setEditingPlace] = useState<SavedFavoritePlace | null>(null);
  const [editCategory, setEditCategory] = useState<FavoriteCategoryPreset>('other');
  const [editCustomName, setEditCustomName] = useState('');
  const [isSavingMeta, setIsSavingMeta] = useState(false);

  const loadFavorites = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await loadSavedFavorites(!isGuest);
      setItems(list);
    } finally {
      setIsLoading(false);
    }
  }, [isGuest]);

  useEffect(() => {
    if (visible) {
      void loadFavorites();
    }
  }, [visible, loadFavorites]);

  useEffect(() => {
    return subscribeFavorites((updated) => {
      setItems(updated);
    });
  }, []);

  const handleRemove = (place: SavedFavoritePlace) => {
    const title = place.customName || place.name;
    Alert.alert('Bỏ lưu địa điểm', `Bạn có muốn xóa "${title}" khỏi danh sách yêu thích?`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            const next = await removeSavedFavoriteById(place.id, !isGuest);
            setItems(next);
          } catch {
            Alert.alert('Lỗi', 'Không thể bỏ lưu địa điểm yêu thích lúc này.');
          }
        },
      },
    ]);
  };

  const openEditModal = (place: SavedFavoritePlace) => {
    const preset = resolveCategoryPreset(place);
    setEditingPlace(place);
    setEditCategory(place.customCategory ?? preset.id);
    setEditCustomName(place.customName ?? '');
  };

  const handleSaveMeta = async () => {
    if (!editingPlace) return;
    setIsSavingMeta(true);
    try {
      const trimmed = editCustomName.trim();
      const next = await updateSavedFavoriteMeta(editingPlace.id, {
        customName: trimmed.length > 0 ? trimmed : null,
        customCategory: editCategory,
      });
      setItems(next);
      setEditingPlace(null);
    } finally {
      setIsSavingMeta(false);
    }
  };

  const handleViewOnMap = (place: SavedFavoritePlace) => {
    if (onSelectPlace) {
      onSelectPlace(place);
      onClose();
      return;
    }
    requestFavoriteMapFocus(place);
    onClose();
    router.replace('/map' as any);
  };

  const renderTags = (p: SavedFavoritePlace) => {
    const tags: string[] = [];
    if (p.hasRamp) tags.push('Ram dốc');
    if (p.doorWidthOk) tags.push('Cửa rộng >90cm');
    if (p.hasAccessibleElevator) tags.push('Thang máy');
    if (p.hasAccessibleRestroom) tags.push('WC tiếp cận');
    if (p.hasTactilePaving) tags.push('Chỉ dẫn xúc giác');
    return tags;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Top Navigation Bar */}
        <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 16 : safeTop }]}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} accessibilityLabel="Quay lại">
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Địa Điểm Yêu Thích</Text>
          <View style={styles.headerCountBadge}>
            <Ionicons name="bookmark" size={14} color="#FFFFFF" />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Subtitle & Privacy Banner */}
          <Text style={styles.pageSubtitle}>
            Lưu những nơi bạn thường đến theo cách của riêng mình.
          </Text>

          <View style={styles.privacyBanner}>
            <Ionicons name="lock-closed-outline" size={16} color="#0F766E" style={{ marginTop: 1 }} />
            <Text style={styles.privacyText}>
              Riêng tư · Chỉ bạn nhìn thấy và không công khai trên bản đồ cộng đồng
            </Text>
          </View>

          {/* Summary Pill Bar */}
          <View style={styles.summaryRow}>
            <View style={styles.savedCountPill}>
              <Ionicons name="bookmark-outline" size={16} color="#004F58" />
              <Text style={styles.savedCountText}>{items.length} địa điểm đã lưu</Text>
            </View>
          </View>

          {isLoading ? (
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 32 }} />
          ) : items.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <MaterialCommunityIcons name="bookmark-plus-outline" size={32} color="#006874" />
              </View>
              <Text style={styles.emptyTitle}>Chưa có địa điểm yêu thích nào</Text>
              <Text style={styles.emptyText}>
                Chạm vào một địa điểm trên bản đồ và nhấn biểu tượng Lưu yêu thích để thêm vào danh sách riêng tư của bạn.
              </Text>
            </View>
          ) : (
            items.map((place, idx) => {
              const preset = resolveCategoryPreset(place);
              const tags = renderTags(place);
              const displayTitle = place.customName?.trim() || place.name || 'Địa điểm đã lưu';
              const hasAccessMapLink =
                tags.length > 0 || (typeof place.accessibilityScore === 'number' && place.accessibilityScore > 0);
              const subAddress =
                place.customName?.trim() && place.name && place.name !== 'Địa điểm đã lưu'
                  ? place.address
                    ? `${place.name} · ${place.address}`
                    : place.name
                  : place.address || 'Chưa có địa chỉ chi tiết';

              return (
                <View key={`${place.id}-${idx}`} style={styles.card}>
                  <View style={styles.cardTopRow}>
                    <View style={[styles.cardLeftIcon, { backgroundColor: preset.iconBg }]}>
                      <Ionicons name={preset.icon} size={22} color={preset.iconColor} />
                    </View>

                    <View style={styles.cardBody}>
                      <View style={styles.cardTitleRow}>
                        <Text style={styles.placeName} numberOfLines={1}>
                          {displayTitle}
                        </Text>
                        <View style={[styles.categoryPill, { backgroundColor: preset.badgeBg }]}>
                          <Text style={[styles.categoryPillText, { color: preset.badgeText }]}>
                            {preset.badgeLabel}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.placeAddr} numberOfLines={2}>
                        {subAddress}
                      </Text>

                      {hasAccessMapLink ? (
                        <View style={styles.linkedRow}>
                          <Ionicons name="checkmark-circle" size={14} color="#007D78" />
                          <Text style={styles.linkedText}>Đã liên kết điểm trợ năng AccessMap</Text>
                        </View>
                      ) : null}

                      {tags.length > 0 ? (
                        <View style={styles.tagsRow}>
                          {tags.slice(0, 3).map((t, tagIdx) => (
                            <View key={`${place.id}-${t}-${tagIdx}`} style={styles.tagChip}>
                              <Text style={styles.tagText}>{t}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>

                    <TouchableOpacity
                      onPress={() => handleRemove(place)}
                      style={styles.removeIconBtn}
                      accessibilityLabel={`Xóa ${displayTitle}`}
                    >
                      <Ionicons name="trash-outline" size={18} color="#94A3B8" />
                    </TouchableOpacity>
                  </View>

                  {/* Bottom Action Row matching Figma */}
                  <View style={styles.cardActionsRow}>
                    <TouchableOpacity
                      style={styles.mapActionBtn}
                      onPress={() => handleViewOnMap(place)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="map-outline" size={17} color="#004F58" />
                      <Text style={styles.mapActionBtnText}>Xem bản đồ</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.editIconBtn}
                      onPress={() => openEditModal(place)}
                      accessibilityLabel={`Tùy chỉnh ${displayTitle}`}
                    >
                      <Ionicons name="pencil-outline" size={18} color="#334155" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Personalize / Edit Modal inspired by Figma */}
        <Modal
          animationType="fade"
          transparent
          visible={Boolean(editingPlace)}
          onRequestClose={() => {
            if (!isSavingMeta) setEditingPlace(null);
          }}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.editBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (!isSavingMeta) setEditingPlace(null);
              }}
            />
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
            >
            <View style={styles.editSheet}>
              <View style={styles.sheetHandle} />
              <View style={styles.editHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editTitle}>Tùy chỉnh địa điểm yêu thích</Text>
                  <Text style={styles.editSubtitle}>Cá nhân hóa tên gọi và phân loại</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setEditingPlace(null)}
                  disabled={isSavingMeta}
                  style={styles.editCloseBtn}
                >
                  <Ionicons name="close" size={20} color="#334155" />
                </TouchableOpacity>
              </View>

              <Text style={styles.editLabel}>Danh mục gợi ý</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.presetRow}
              >
                {CATEGORY_PRESETS.map((cat) => {
                  const selected = editCategory === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.presetChip, selected && styles.presetChipActive]}
                      onPress={() => setEditCategory(cat.id)}
                    >
                      {selected ? <Ionicons name="checkmark" size={14} color="#004F58" /> : null}
                      <Text style={[styles.presetChipText, selected && styles.presetChipTextActive]}>
                        {cat.chipLabel}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.editLabel}>Tên hiển thị quen thuộc</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.textInput}
                  value={editCustomName}
                  onChangeText={setEditCustomName}
                  placeholder={editingPlace?.name || 'VD: Nhà của tôi, Văn phòng...'}
                  placeholderTextColor="#94A3B8"
                />
                {editCustomName.length > 0 ? (
                  <TouchableOpacity onPress={() => setEditCustomName('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color="#94A3B8" />
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={styles.locationPreviewCard}>
                <Text style={styles.locationPreviewCaption}>Vị trí thực tế đã lưu</Text>
                <View style={styles.locationPreviewRow}>
                  <Ionicons name="location-outline" size={16} color="#004F58" />
                  <Text style={styles.locationPreviewText} numberOfLines={2}>
                    {editingPlace?.name}
                    {editingPlace?.address ? ` - ${editingPlace.address}` : ''}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.saveMetaBtn, isSavingMeta && { opacity: 0.6 }]}
                onPress={() => void handleSaveMeta()}
                disabled={isSavingMeta}
              >
                {isSavingMeta ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveMetaBtnText}>Lưu địa điểm quen thuộc</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelMetaBtn}
                onPress={() => setEditingPlace(null)}
                disabled={isSavingMeta}
              >
                <Text style={styles.cancelMetaBtnText}>Hủy bỏ</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
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
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerCountBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#004F58',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 36,
    gap: 14,
  },
  pageSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
    fontWeight: '500',
  },
  privacyBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#CCFBF1',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  privacyText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: '#0F514E',
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  savedCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  savedCountText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 8,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E0F7FA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardLeftIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 5,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  placeName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    flexShrink: 1,
  },
  categoryPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  categoryPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  placeAddr: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748B',
  },
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  linkedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007D78',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  tagChip: {
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#004F58',
  },
  removeIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mapActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingVertical: 11,
  },
  mapActionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#004F58',
  },
  editIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  editSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 14,
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 4,
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  editTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  editSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#006874',
    marginTop: 2,
  },
  editCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  presetRow: {
    gap: 8,
    paddingVertical: 2,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  presetChipActive: {
    backgroundColor: '#99F6E4',
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  presetChipTextActive: {
    color: '#004F58',
    fontWeight: '700',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 48,
    gap: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
    fontWeight: '500',
  },
  locationPreviewCard: {
    backgroundColor: '#F1F5F9',
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  locationPreviewCaption: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  locationPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationPreviewText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  saveMetaBtn: {
    backgroundColor: '#004F58',
    borderRadius: 999,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  saveMetaBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cancelMetaBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  cancelMetaBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
});
