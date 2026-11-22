import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccessibility } from '@/features/accessibility';
import { startContributionFlow } from '@/features/contribution';

export type BottomNavTab = 'map' | 'contribute' | 'community' | 'profile';

interface BottomNavBarProps {
  activeTab: BottomNavTab;
  onTabPress?: (tab: BottomNavTab) => void;
  onContributePress?: () => void;
}

interface NavTabButtonProps {
  active: boolean;
  reduceMotion: boolean;
  accessibilityLabel: string;
  label: string;
  onPress: () => void;
  renderIcon: (color: string) => React.ReactNode;
}

function NavTabButton({
  active,
  reduceMotion,
  accessibilityLabel,
  label,
  onPress,
  renderIcon,
}: NavTabButtonProps) {
  const pillScale = useSharedValue(1);
  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pillScale.value }],
  }));

  const handlePressIn = () => {
    if (reduceMotion) return;
    pillScale.set(
      withTiming(0.92, {
        duration: 110,
        easing: Easing.out(Easing.quad),
      })
    );
  };

  const handlePressOut = () => {
    if (reduceMotion) {
      pillScale.set(1);
      return;
    }
    pillScale.set(
      withTiming(1, {
        duration: 110,
        easing: Easing.out(Easing.quad),
      })
    );
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.tabItem, pressed && styles.tabItemPressed]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={6}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View
        style={[styles.iconPill, active && styles.iconPillActive, pillAnimatedStyle]}
      >
        {renderIcon(active ? '#004F58' : '#475569')}
      </Animated.View>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

export function BottomNavBar({ activeTab, onTabPress, onContributePress }: BottomNavBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, triggerHaptic } = useAccessibility();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'ios' ? 12 : 8);

  const handlePress = (tab: BottomNavTab) => {
    if (tab !== activeTab || tab === 'contribute') {
      triggerHaptic(15);
    }

    if (tab === 'contribute') {
      if (onContributePress) {
        onContributePress();
        return;
      }
      startContributionFlow(router, {
        id: 's9.01',
        name: 'Tòa S9.01 - The Origami',
        latitude: 10.8454,
        longitude: 106.8373,
      });
      return;
    }

    if (onTabPress) {
      onTabPress(tab);
      return;
    }

    if (tab === activeTab) return;

    if (tab === 'map') {
      router.replace('/map' as any);
      return;
    }

    if (tab === 'community') {
      router.replace('/community' as any);
      return;
    }

    if (tab === 'profile') {
      router.replace('/profile' as any);
    }
  };

  return (
    <View style={[styles.container, { paddingBottom: bottomPad }]}>
      <View style={styles.innerRow}>
        {/* 1. Bản đồ */}
        <NavTabButton
          active={activeTab === 'map'}
          reduceMotion={settings.reduceMotion}
          accessibilityLabel="Bản đồ"
          label="Bản đồ"
          onPress={() => handlePress('map')}
          renderIcon={(color) => (
            <Ionicons name={activeTab === 'map' ? 'map' : 'map-outline'} size={19} color={color} />
          )}
        />

        {/* 2. Đóng góp */}
        <NavTabButton
          active={activeTab === 'contribute'}
          reduceMotion={settings.reduceMotion}
          accessibilityLabel="Đóng góp"
          label="Đóng góp"
          onPress={() => handlePress('contribute')}
          renderIcon={(color) => (
            <MaterialCommunityIcons
              name={activeTab === 'contribute' ? 'map-marker-plus' : 'map-marker-plus-outline'}
              size={21}
              color={color}
            />
          )}
        />

        {/* 3. Cộng đồng */}
        <NavTabButton
          active={activeTab === 'community'}
          reduceMotion={settings.reduceMotion}
          accessibilityLabel="Cộng đồng & Bảng xếp hạng"
          label="Cộng đồng"
          onPress={() => handlePress('community')}
          renderIcon={(color) => (
            <Ionicons
              name={activeTab === 'community' ? 'chatbubbles' : 'chatbubbles-outline'}
              size={20}
              color={color}
            />
          )}
        />

        {/* 4. Cá nhân */}
        <NavTabButton
          active={activeTab === 'profile'}
          reduceMotion={settings.reduceMotion}
          accessibilityLabel="Cá nhân"
          label="Cá nhân"
          onPress={() => handlePress('profile')}
          renderIcon={(color) => (
            <Ionicons
              name={activeTab === 'profile' ? 'person-circle' : 'person-circle-outline'}
              size={22}
              color={color}
            />
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 20,
  },
  innerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  tabItem: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabItemPressed: {
    opacity: 0.85,
  },
  iconPill: {
    width: 62,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPillActive: {
    backgroundColor: '#99F6E4',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginTop: 1,
  },
  tabLabelActive: {
    color: '#004F58',
    fontWeight: '800',
  },
});
