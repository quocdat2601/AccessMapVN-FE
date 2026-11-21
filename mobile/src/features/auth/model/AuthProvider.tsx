import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { apiClient } from '@/shared/api/client';
import { isSupabaseConfigured, supabase } from '@/shared/lib/supabase';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  role: string;
  expPoints: number;
  reputationScore: number;
  reputationTier: string;
  contributionsCount: number;
  reportsCount: number;
  isGuest: boolean;
}

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  userProfile: UserProfile;
  isGuest: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  refreshProfile(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, fullName?: string): Promise<boolean>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function requireConfiguration() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase chưa được cấu hình. Hãy kiểm tra các biến EXPO_PUBLIC_SUPABASE_* trong .env.');
  }
}

interface BackendProfileResponse {
  id: string;
  displayName?: string;
  role?: string;
  expPoints: number;
  reputationScore: number;
  reputationTier: string;
  contributionsCount: number;
  reportsCount: number;
}

const VALID_BACKEND_PROFILES = new Set(['wheelchair', 'limited_mobility', 'elderly', 'stroller']);

function featureCriterionToFeatureType(key: string): string | null {
  switch (key) {
    case 'ramp':
      return 'Ramp';
    case 'wideEntrance':
      return 'EntranceDoor';
    case 'elevatorMode':
      return 'Elevator';
    case 'restroomMode':
      return 'AccessibleRestroom';
    default:
      return null;
  }
}

function featureTypeToCriterionKey(featureType: unknown): string | null {
  switch (String(featureType ?? '').toLowerCase()) {
    case 'ramp':
    case '1':
      return 'ramp';
    case 'entrancedoor':
    case '5':
      return 'wideEntrance';
    case 'elevator':
    case '2':
      return 'elevatorMode';
    case 'accessiblerestroom':
    case '3':
      return 'restroomMode';
    default:
      return null;
  }
}

function toBackendPreferencePayload(filters: Record<string, unknown>) {
  const preset = String(filters.preset ?? '');
  const mobilityProfile = VALID_BACKEND_PROFILES.has(preset) ? preset : 'limited_mobility';
  const defaultRequiredFeatures: Array<{ featureType: string; desiredStatus: string }> = [];
  const defaultPreferredFeatures: Array<{ featureType: string; desiredStatus: string }> = [];

  for (const [key, level] of Object.entries(filters)) {
    const featureType = featureCriterionToFeatureType(key);
    if (!featureType) continue;
    if (level === 'required') defaultRequiredFeatures.push({ featureType, desiredStatus: 'Available' });
    else if (level === 'preferred') defaultPreferredFeatures.push({ featureType, desiredStatus: 'Available' });
  }

  return {
    mobilityProfile,
    defaultRequiredFeatures,
    defaultPreferredFeatures,
    consent: true,
    expectedVersion: null,
  };
}

function fromBackendPreferenceView(raw: any): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!('mobilityProfile' in raw) && !('defaultRequiredFeatures' in raw)) {
    return raw as Record<string, unknown>;
  }
  const mapped: Record<string, unknown> = {
    preset: VALID_BACKEND_PROFILES.has(String(raw.mobilityProfile)) ? raw.mobilityProfile : 'custom',
  };
  for (const item of Array.isArray(raw.defaultRequiredFeatures) ? raw.defaultRequiredFeatures : []) {
    const key = featureTypeToCriterionKey(item?.featureType);
    if (key) mapped[key] = 'required';
  }
  for (const item of Array.isArray(raw.defaultPreferredFeatures) ? raw.defaultPreferredFeatures : []) {
    const key = featureTypeToCriterionKey(item?.featureType);
    if (key && !mapped[key]) mapped[key] = 'preferred';
  }
  return mapped;
}

export async function fetchUserAccessibilityPreferences(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await apiClient.get<any>('/api/v1/me/accessibility-preference', { auth: 'optional' });
    return fromBackendPreferenceView(raw);
  } catch {
    return await apiClient.get<Record<string, unknown>>('/api/v1/users/me/preferences', {
      auth: 'optional',
    });
  }
}

export async function saveUserAccessibilityPreferences(filters: Record<string, unknown>): Promise<void> {
  try {
    await apiClient.put('/api/v1/me/accessibility-preference', toBackendPreferencePayload(filters), {
      auth: 'optional',
    });
  } catch {
    await apiClient.put('/api/v1/users/me/preferences', filters, { auth: 'optional' }).catch(() => {});
  }
}

const DEFAULT_PROFILE_STATS = {
  expPoints: 0,
  reputationScore: 0,
  reputationTier: 'Thành viên mới',
  contributionsCount: 0,
  reportsCount: 0,
};

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileStats, setProfileStats] = useState(DEFAULT_PROFILE_STATS);

  const refreshProfile = useCallback(async () => {
    if (!session?.access_token) {
      setProfileStats(DEFAULT_PROFILE_STATS);
      return;
    }

    try {
      try {
        await apiClient.get<any>('/api/v1/me', { auth: 'required' });
        const rep = await apiClient
          .get<any>('/api/v1/me/reputation', { auth: 'required' })
          .catch(() => null);
        if (rep && typeof rep.reputationPoints === 'number') {
          setProfileStats({
            expPoints: rep.reputationPoints ?? 0,
            reputationScore: rep.reputationPoints ?? 0,
            reputationTier: rep.rankLabel || rep.rankBadge || 'Thành viên mới',
            contributionsCount: Number(rep.correctClaimCount ?? 0) + Number(rep.incorrectClaimCount ?? 0),
            reportsCount: 0,
          });
        } else {
          setProfileStats(DEFAULT_PROFILE_STATS);
        }
        return;
      } catch {
        // Fallback to legacy monorepo backend profile endpoint
      }

      const data = await apiClient.get<BackendProfileResponse>('/api/v1/users/me/profile', {
        auth: 'required',
      });
      setProfileStats({
        expPoints: data.expPoints ?? 0,
        reputationScore: data.reputationScore ?? 0,
        reputationTier: data.reputationTier || 'Thành viên mới',
        contributionsCount: data.contributionsCount ?? 0,
        reportsCount: data.reportsCount ?? 0,
      });
    } catch {
      // Keep zeroed defaults if backend is unreachable instead of showing fake stats
      setProfileStats(DEFAULT_PROFILE_STATS);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    let mounted = true;

    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setIsLoading(false);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) {
        setSession(nextSession);
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    requireConfiguration();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    requireConfiguration();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: fullName ? { data: { full_name: fullName } } : undefined,
    });
    if (error) throw error;
    return Boolean(data.session);
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    requireConfiguration();
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const user = session?.user ?? null;
  const isGuest = !user;

  const userProfile = useMemo<UserProfile>(() => {
    if (!user) {
      return {
        id: 'guest',
        email: '',
        fullName: 'Khách tham quan',
        avatarUrl: null,
        role: 'Khách',
        expPoints: 0,
        reputationScore: 0,
        reputationTier: 'Khách',
        contributionsCount: 0,
        reportsCount: 0,
        isGuest: true,
      };
    }

    const metaName = user.user_metadata?.full_name || user.user_metadata?.name;
    const fallbackName = user.email ? user.email.split('@')[0] : 'Thành viên';
    const fullName = metaName || fallbackName;

    return {
      id: user.id,
      email: user.email || '',
      fullName,
      avatarUrl: user.user_metadata?.avatar_url || null,
      role: (user.app_metadata?.role as string) || 'Người dùng đã xác thực',
      expPoints: profileStats.expPoints,
      reputationScore: profileStats.reputationScore,
      reputationTier: profileStats.reputationTier,
      contributionsCount: profileStats.contributionsCount,
      reportsCount: profileStats.reportsCount,
      isGuest: false,
    };
  }, [user, profileStats]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      userProfile,
      isGuest,
      isLoading,
      isConfigured: isSupabaseConfigured,
      refreshProfile,
      signIn,
      signUp,
      sendPasswordReset,
      signOut,
    }),
    [isLoading, refreshProfile, sendPasswordReset, session, signIn, signOut, signUp, user, userProfile, isGuest]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
