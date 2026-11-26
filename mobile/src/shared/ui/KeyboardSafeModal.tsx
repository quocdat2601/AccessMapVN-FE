import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type ModalProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface KeyboardSafeModalProps extends Omit<ModalProps, 'children'> {
  children: React.ReactNode;
  onBackdropPress?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  keyboardVerticalOffset?: number;
}

/**
 * Shared modal wrapper that keeps TextInputs and footer action buttons
 * visible above the software keyboard on both iOS and Android.
 */
export function KeyboardSafeModal({
  children,
  onBackdropPress,
  containerStyle,
  contentContainerStyle,
  scrollable = true,
  keyboardVerticalOffset = 0,
  transparent = true,
  animationType = 'slide',
  ...modalProps
}: KeyboardSafeModalProps) {
  const insets = useSafeAreaInsets();
  const behavior = Platform.OS === 'ios' ? 'padding' : 'height';

  return (
    <Modal transparent={transparent} animationType={animationType} {...modalProps}>
      <KeyboardAvoidingView
        behavior={behavior}
        keyboardVerticalOffset={keyboardVerticalOffset}
        style={[styles.backdrop, containerStyle]}
      >
        {onBackdropPress ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={onBackdropPress} />
        ) : null}
        {scrollable ? (
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: Math.max(16, insets.bottom + 8) },
              contentContainerStyle,
            ]}
            style={styles.scrollView}
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  scrollView: {
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
});
