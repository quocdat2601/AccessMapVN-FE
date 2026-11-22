import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '@/features/auth';
import { AccessibilityProvider, useAccessibility } from '@/features/accessibility';
import { ToastProvider } from '@/shared/ui/ToastProvider';

function RootStackNavigator() {
  const { settings } = useAccessibility();
  const reduceMotion = settings.reduceMotion;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'slide_from_right',
        animationDuration: reduceMotion ? 0 : 240,
      }}
    >
      <Stack.Screen name="index" options={{ animation: reduceMotion ? 'none' : 'fade' }} />
      <Stack.Screen
        name="map"
        options={{
          animation: reduceMotion ? 'none' : 'fade',
          animationDuration: reduceMotion ? 0 : 220,
        }}
      />
      <Stack.Screen
        name="community"
        options={{
          animation: reduceMotion ? 'none' : 'fade',
          animationDuration: reduceMotion ? 0 : 140,
        }}
      />
      <Stack.Screen
        name="profile"
        options={{
          animation: reduceMotion ? 'none' : 'fade',
          animationDuration: reduceMotion ? 0 : 140,
        }}
      />
      <Stack.Screen
        name="contribute"
        options={{ animation: reduceMotion ? 'none' : 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="reports"
        options={{ animation: reduceMotion ? 'none' : 'slide_from_right' }}
      />
      <Stack.Screen
        name="login"
        options={{ animation: reduceMotion ? 'none' : 'slide_from_bottom' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <AccessibilityProvider>
          <SafeAreaProvider>
            <ToastProvider>
              <RootStackNavigator />
              <StatusBar style="auto" />
            </ToastProvider>
          </SafeAreaProvider>
        </AccessibilityProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
