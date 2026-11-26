import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAccessibility } from '@/features/accessibility';
import { DiscoveryScreen } from '@/features/discovery';
import { startContributionFlow } from '@/features/contribution';
import { CommunityScreen } from '@/features/community';
import { ProfileScreen } from '@/features/auth';
import { requestFavoriteMapFocus, type SavedFavoritePlace } from '@/features/auth/model/favoritesStorage';
import { BottomNavBar, type BottomNavTab } from './BottomNavBar';

export type MainNavTab = 'map' | 'community' | 'profile';

interface MainTabContainerProps {
  initialTab?: MainNavTab;
}

export function MainTabContainer({ initialTab = 'map' }: MainTabContainerProps) {
  const router = useRouter();
  const { settings } = useAccessibility();

  const [activeTab, setActiveTab] = useState<MainNavTab>(initialTab);
  const [prevTab, setPrevTab] = useState<MainNavTab | null>(null);
  const [isPlaceSelected, setIsPlaceSelected] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const isAnimatingRef = useRef(false);

  const handleTabPress = useCallback(
    (tab: BottomNavTab) => {
      if (tab === 'contribute') {
        startContributionFlow(router, {
          id: 's9.01',
          name: 'Tòa S9.01 - The Origami',
          latitude: 10.8454,
          longitude: 106.8373,
        });
        return;
      }

      const targetTab = tab as MainNavTab;
      if (targetTab === activeTab || isAnimatingRef.current) return;

      if (settings.reduceMotion) {
        setPrevTab(null);
        setActiveTab(targetTab);
        fadeAnim.setValue(1);
        return;
      }

      isAnimatingRef.current = true;
      setPrevTab(activeTab);
      setActiveTab(targetTab);

      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setPrevTab(null);
        isAnimatingRef.current = false;
      });
    },
    [activeTab, fadeAnim, router, settings.reduceMotion]
  );

  const handleContributePress = useCallback(() => {
    startContributionFlow(router, {
      id: 's9.01',
      name: 'Tòa S9.01 - The Origami',
      latitude: 10.8454,
      longitude: 106.8373,
    });
  }, [router]);

  const getTabOpacity = (tab: MainNavTab) => {
    if (prevTab === null) {
      return activeTab === tab ? 1 : 0;
    }
    if (activeTab === tab) {
      return fadeAnim;
    }
    if (prevTab === tab) {
      return 1;
    }
    return 0;
  };

  return (
    <View style={styles.rootContainer}>
      {/* Main content viewport: keep map mounted and cross-fade tabs cleanly */}
      <View style={styles.mainViewport}>
        {/* 1. Map Tab (kept continuously mounted to preserve MapLibre context & tiles) */}
        <Animated.View
          style={[
            styles.screenSlide,
            activeTab === 'map' && prevTab !== null && styles.screenIncoming,
            activeTab !== 'map' && prevTab !== 'map'
              ? styles.screenHidden
              : { opacity: getTabOpacity('map') },
          ]}
          pointerEvents={activeTab === 'map' && !prevTab ? 'auto' : 'none'}
        >
          <DiscoveryScreen
            hideBottomNav={true}
            onActivePlaceChange={setIsPlaceSelected}
            onNavigateToContribute={(place) => {
              startContributionFlow(router, {
                id: place.id,
                name: place.name,
                latitude: place.latitude,
                longitude: place.longitude,
              });
            }}
          />
        </Animated.View>

        {/* 2. Community Tab */}
        {(activeTab === 'community' || prevTab === 'community') && (
          <Animated.View
            style={[
              styles.screenSlide,
              activeTab === 'community' && prevTab !== null
                ? styles.screenIncoming
                : styles.screenElevated,
              { opacity: getTabOpacity('community') },
            ]}
            pointerEvents={activeTab === 'community' && !prevTab ? 'auto' : 'none'}
          >
            <CommunityScreen hideBottomNav={true} />
          </Animated.View>
        )}

        {/* 3. Profile Tab */}
        {(activeTab === 'profile' || prevTab === 'profile') && (
          <Animated.View
            style={[
              styles.screenSlide,
              activeTab === 'profile' && prevTab !== null
                ? styles.screenIncoming
                : styles.screenElevated,
              { opacity: getTabOpacity('profile') },
            ]}
            pointerEvents={activeTab === 'profile' && !prevTab ? 'auto' : 'none'}
          >
            <ProfileScreen
              hideBottomNav={true}
              onSelectFavoritePlace={(place: SavedFavoritePlace) => {
                handleTabPress('map');
                requestFavoriteMapFocus(place);
              }}
            />
          </Animated.View>
        )}
      </View>

      {/* Rock-solid, fixed Bottom Navigation Bar */}
      {!isPlaceSelected && (
        <BottomNavBar
          activeTab={activeTab}
          onTabPress={handleTabPress}
          onContributePress={handleContributePress}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  mainViewport: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  screenSlide: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
  },
  screenElevated: {
    zIndex: 5,
  },
  screenIncoming: {
    zIndex: 6,
  },
  screenHidden: {
    opacity: 0,
    zIndex: -10,
  },
});
