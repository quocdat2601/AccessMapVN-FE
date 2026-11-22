import React, {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccessibility } from '@/features/accessibility';

export type ToastVariant = 'success' | 'info' | 'warning' | 'error';

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
}

interface ActiveToast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  hideToast: () => {},
});

const VARIANT_STYLES: Record<
  ToastVariant,
  {
    bg: string;
    border: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    iconColor: string;
    text: string;
  }
> = {
  success: {
    bg: '#004E58',
    border: '#0F766E',
    icon: 'checkmark-circle',
    iconColor: '#99F6E4',
    text: '#FFFFFF',
  },
  info: {
    bg: '#0F172A',
    border: '#334155',
    icon: 'information-circle',
    iconColor: '#7DD3FC',
    text: '#FFFFFF',
  },
  warning: {
    bg: '#78350F',
    border: '#D97706',
    icon: 'alert-circle',
    iconColor: '#FDE68A',
    text: '#FFFFFF',
  },
  error: {
    bg: '#7F1D1D',
    border: '#DC2626',
    icon: 'close-circle',
    iconColor: '#FECACA',
    text: '#FFFFFF',
  },
};

export function ToastProvider({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  const { settings } = useAccessibility();
  const [toast, setToast] = useState<ActiveToast | null>(null);

  const toastIdRef = useRef(0);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-16);

  const clearTimers = useCallback(() => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
    if (unmountTimerRef.current) {
      clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const hideToast = useCallback(() => {
    clearTimers();
    if (settings.reduceMotion) {
      opacity.set(0);
      translateY.set(-16);
      setToast(null);
      return;
    }
    const closingId = toastIdRef.current;
    opacity.set(
      withTiming(0, {
        duration: 160,
        easing: Easing.in(Easing.cubic),
      })
    );
    translateY.set(
      withTiming(-16, {
        duration: 160,
        easing: Easing.in(Easing.cubic),
      })
    );
    unmountTimerRef.current = setTimeout(() => {
      if (toastIdRef.current === closingId) {
        setToast(null);
      }
    }, 170);
  }, [clearTimers, opacity, settings.reduceMotion, translateY]);

  const showToast = useCallback(
    ({ message, variant = 'success', durationMs = 2600 }: ToastOptions) => {
      const trimmed = message.trim();
      if (!trimmed) return;

      clearTimers();
      const nextId = ++toastIdRef.current;
      setToast({ id: nextId, message: trimmed, variant });

      if (settings.reduceMotion) {
        opacity.set(1);
        translateY.set(0);
      } else {
        opacity.set(0);
        translateY.set(-16);
        opacity.set(
          withTiming(1, {
            duration: 200,
            easing: Easing.out(Easing.cubic),
          })
        );
        translateY.set(
          withTiming(0, {
            duration: 200,
            easing: Easing.out(Easing.cubic),
          })
        );
      }

      autoHideTimerRef.current = setTimeout(() => {
        if (toastIdRef.current === nextId) {
          hideToast();
        }
      }, Math.max(1000, durationMs));
    },
    [clearTimers, hideToast, opacity, settings.reduceMotion, translateY]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const safeTop = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0,
    12
  );

  const value = useMemo(() => ({ showToast, hideToast }), [showToast, hideToast]);
  const palette = toast ? VARIANT_STYLES[toast.variant] : null;

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {toast && palette ? (
          <View pointerEvents="box-none" style={[styles.overlay, { top: safeTop + 10 }]}>
            <Animated.View style={[styles.toastWrap, animatedStyle]}>
              <Pressable
                onPress={hideToast}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                accessibilityLabel={toast.message}
                style={({ pressed }) => [
                  styles.toastCard,
                  {
                    backgroundColor: palette.bg,
                    borderColor: palette.border,
                  },
                  pressed && styles.toastPressed,
                ]}
              >
                <Ionicons name={palette.icon} size={21} color={palette.iconColor} />
                <Text style={[styles.toastText, { color: palette.text }]} numberOfLines={3}>
                  {toast.message}
                </Text>
              </Pressable>
            </Animated.View>
          </View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 16,
    alignItems: 'center',
  },
  toastWrap: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  toastCard: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 8,
  },
  toastPressed: {
    opacity: 0.9,
  },
  toastText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 19,
  },
});
