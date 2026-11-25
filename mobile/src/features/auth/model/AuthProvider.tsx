import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ApiError,
  apiClient,
  createUuidV4,
  getStoredBackendAccessToken,
  getStoredBackendTokens,
  refreshBackendAccessToken,
  setStoredBackendTokens,
  subscribeBackendAuthCleared,
} from '@/shared/api/client';
import { isSupabaseConfigured, supabase } from '@/shared/lib/supabase';
import { setContributionsUserId } from '@/entities/contribution/model/store';
import { setFavoritesUserId } from './favoritesStorage';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  profileVersion: number;
  avatarUrl: string | null;
  role: string;
  expPoints: number;
  reputationScore: number;
  reputationTier: string;
  contributionsCount: number;
  reportsCount: number;
  accountStandingScore: number;
  contributionAccuracyRate: number | null;
  correctClaimCount: number;
  incorrectClaimCount: number;
  participationStatus: string;
  isGuest: boolean;
}

export interface RegistrationChallengeResponse {
  challengeId: string;
  expiresAt: string;
  nextSendAt: string;
}

export interface GoogleProfileRequired {
  completionToken: string;
  suggestedName: string | null;
  email: string;
  requiredFields: string[];
  expiresAt: string;
}

export type GoogleOAuthOutcome =
  | { status: 'signed_in' }
  | { status: 'cancelled' }
  | { status: 'profile_required'; profile: GoogleProfileRequired };

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  userProfile: UserProfile;
  isGuest: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  passwordRecoveryPending: boolean;
  refreshProfile(): Promise<void>;
  signIn(identifier: string, password: string): Promise<void>;
  startRegistrationChallenge(input: {
    name: string;
    email: string;
    phone: string;
    channel: 'Email' | 'Sms';
  }): Promise<RegistrationChallengeResponse>;
  completeRegistration(input: {
    challengeId: string;
    otp: string;
    password: string;
    loginIdentifier: string;
  }): Promise<{ signedIn: boolean }>;
  startGoogleOAuth(): Promise<GoogleOAuthOutcome>;
  startGooglePhoneChallenge(
    completionToken: string,
    phone: string
  ): Promise<RegistrationChallengeResponse>;
  completeGoogleProfile(input: {
    completionToken: string;
    name: string;
    password: string;
    phone?: string;
    phoneChallengeId?: string;
    phoneOtp?: string;
  }): Promise<void>;
  updateProfileName(name: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  completePasswordRecovery(newPassword: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const isBackendConfigured = Boolean(
  process.env.EXPO_PUBLIC_API_URL?.trim() ||
    typeof __DEV__ !== 'undefined' ||
    isSupabaseConfigured
);

function requireConfiguration() {
  if (!isBackendConfigured) {
    throw new Error(
      'Chưa cấu hình máy chủ xác thực. Hãy kiểm tra biến EXPO_PUBLIC_API_URL hoặc EXPO_PUBLIC_SUPABASE_* trong .env.'
    );
  }
}

export function normalizeVietnamPhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-().]/g, '');
  if (!compact) return null;
  let candidate = compact;
  if (candidate.startsWith('0')) {
    candidate = `+84${candidate.slice(1)}`;
  } else if (candidate.startsWith('84')) {
    candidate = `+${candidate}`;
  } else if (/^(?:[35789]\d{8}|2\d{9})$/.test(candidate)) {
    candidate = `+84${candidate}`;
  } else if (!candidate.startsWith('+84')) {
    return null;
  }
  return /^\+84(?:[35789]\d{8}|2\d{9})$/.test(candidate) ? candidate : null;
}

export function validateNameRule(raw: string): string | null {
  const collapsed = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (collapsed.length < 2 || collapsed.length > 100) {
    return 'Họ và tên cần dài từ 2 đến 100 ký tự.';
  }
  if (!/^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u.test(collapsed)) {
    return 'Họ và tên chỉ được chứa chữ cái và khoảng trắng.';
  }
  return null;
}

export function validateEmailRule(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
    return 'Địa chỉ email chưa đúng định dạng.';
  }
  return null;
}

export function validatePasswordRule(raw: string): string | null {
  if (!raw || /[\u0000-\u001F\u007F]/.test(raw) || raw.length < 8 || raw.length > 128) {
    return 'Mật khẩu cần dài 8–128 ký tự, gồm chữ hoa, chữ thường và chữ số.';
  }
  if (!/\p{Lu}/u.test(raw) || !/\p{Ll}/u.test(raw) || !/\d/.test(raw)) {
    return 'Mật khẩu cần có ít nhất 1 chữ hoa, 1 chữ thường và 1 chữ số.';
  }
  return null;
}

export function mapAuthErrorMessage(
  error: unknown,
  fallback = 'Không thể xác thực tài khoản.'
): string {
  if (error instanceof ApiError) {
    const code =
      error.code ||
      (typeof error.data === 'object' && error.data !== null
        ? (error.data as { code?: string; title?: string }).code ||
          (error.data as { title?: string }).title
        : undefined);

    switch (code) {
      case 'INVALID_CREDENTIALS':
        return 'Email, số điện thoại hoặc mật khẩu không chính xác.';
      case 'INVALID_LOGIN_REQUEST':
        return 'Vui lòng nhập email hợp lệ hoặc số điện thoại Việt Nam (+84 / 0...) và mật khẩu hợp lệ.';
      case 'INVALID_NAME':
        return 'Họ và tên không hợp lệ (2–100 ký tự, chỉ chữ cái và khoảng trắng).';
      case 'INVALID_EMAIL':
        return 'Địa chỉ email không hợp lệ.';
      case 'INVALID_PHONE':
        return 'Số điện thoại Việt Nam không hợp lệ (VD: 0912345678 hoặc +84912345678).';
      case 'INVALID_PASSWORD':
        return 'Mật khẩu cần dài 8–128 ký tự, gồm ít nhất 1 chữ hoa, 1 chữ thường và 1 chữ số.';
      case 'CONTACT_ALREADY_IN_USE':
        return 'Email hoặc số điện thoại này đã được đăng ký trước đó.';
      case 'REGISTRATION_IN_PROGRESS':
        return 'Tài khoản đang hoàn tất xác thực. Vui lòng thử lại sau giây lát.';
      case 'INVALID_OTP':
        return 'Mã xác thực chưa chính xác. Vui lòng kiểm tra lại.';
      case 'INVALID_OTP_CHALLENGE':
        return 'Mã xác thực không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.';
      case 'OTP_RATE_LIMITED':
        return 'Bạn đã thao tác quá nhiều lần. Vui lòng đợi ít phút trước khi gửi lại hoặc thử lại mã.';
      case 'AUTHORIZATION_FORBIDDEN':
        return 'Tài khoản không có quyền truy cập ứng dụng di động hoặc đang bị tạm khóa.';
      case 'INVALID_PROVIDER_OAUTH_INPUT':
        return 'Đường dẫn chuyển hướng Google OAuth chưa được cấp phép trên máy chủ.';
      case 'INVALID_OAUTH_STATE':
      case 'INVALID_OAUTH_CALLBACK':
      case 'INVALID_OAUTH_CODE':
      case 'OAUTH_EXPIRED':
        return 'Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.';
      case 'INVALID_COMPLETION_TOKEN':
      case 'INVALID_COMPLETION_REQUEST':
      case 'COMPLETION_REPLAY_EXPIRED':
        return 'Phiên hoàn tất hồ sơ Google đã hết hạn. Vui lòng đăng nhập Google lại.';
      case 'INVALID_PHONE_VERIFICATION':
        return 'Mã OTP xác thực số điện thoại chưa đúng hoặc đã hết hạn.';
      case 'ACCOUNT_ALREADY_ACTIVE':
      case 'ACCOUNT_LINK_REQUIRED':
        return 'Email Google này đã có tài khoản AccessMapVN. Vui lòng đăng nhập bằng mật khẩu.';
      case 'PROFILE_VERSION_CONFLICT':
        return 'Hồ sơ vừa được cập nhật ở nơi khác. Hệ thống đã tải lại dữ liệu mới nhất.';
      case 'AUTH_STATE_UNAVAILABLE':
        return 'Dịch vụ xác thực hoặc gửi mã tạm thời không khả dụng. Nếu đang chọn SMS, hãy thử chuyển sang kênh Email.';
      default:
        return error.message || fallback;
    }
  }

  if (error instanceof Error) {
    const msg = error.message;
    if (/invalid login credentials/i.test(msg)) {
      return 'Email hoặc mật khẩu không chính xác.';
    }
    if (/email not confirmed/i.test(msg)) {
      return 'Email chưa được xác nhận. Vui lòng kiểm tra hộp thư.';
    }
    return msg || fallback;
  }

  return fallback;
}

interface BackendUserIdentity {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  profileVersion: number;
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

interface BackendLoginTokensResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  sessionId?: string;
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
  reputationTier: 'Chưa xếp hạng',
  contributionsCount: 0,
  reportsCount: 0,
  accountStandingScore: 50,
  contributionAccuracyRate: null as number | null,
  correctClaimCount: 0,
  incorrectClaimCount: 0,
  participationStatus: 'Normal',
};

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [backendUser, setBackendUser] = useState<BackendUserIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);
  const [profileStats, setProfileStats] = useState(DEFAULT_PROFILE_STATS);

  const applyBackendTokens = useCallback(
    async (tokens: BackendLoginTokensResponse, fallbackEmail = '') => {
      if (!tokens?.accessToken) return false;
      await setStoredBackendTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        sessionId: tokens.sessionId,
        expiresAt:
          typeof tokens.expiresIn === 'number'
            ? Date.now() + tokens.expiresIn * 1000
            : undefined,
      });
      setBackendUser((prev) => ({
        id: tokens.sessionId || prev?.id || fallbackEmail,
        name: prev?.name || '',
        email: prev?.email || fallbackEmail,
        phoneNumber: prev?.phoneNumber ?? null,
        emailVerified: prev?.emailVerified ?? true,
        phoneVerified: prev?.phoneVerified ?? false,
        profileVersion: prev?.profileVersion ?? 1,
      }));
      return true;
    },
    []
  );

  const refreshProfile = useCallback(async (overrideAccessToken?: string) => {
    const stored = await getStoredBackendTokens();
    let backendToken = await getStoredBackendAccessToken();
    if (!backendToken && stored?.refreshToken) {
      backendToken = await refreshBackendAccessToken();
    }
    let supabaseToken = overrideAccessToken || session?.access_token;
    if (!supabaseToken && isSupabaseConfigured) {
      const { data } = await supabase.auth.getSession();
      supabaseToken = data.session?.access_token;
    }
    const hasToken = Boolean(supabaseToken || backendToken);
    if (!hasToken) {
      setProfileStats(DEFAULT_PROFILE_STATS);
      return;
    }

    try {
      try {
        const me = await apiClient.get<{
          userId?: string;
          id?: string;
          name?: string;
          displayName?: string;
          email?: string;
          phoneNumber?: string | null;
          emailVerified?: boolean;
          phoneVerified?: boolean;
          profileVersion?: number;
        }>('/api/v1/me', { auth: 'required' });
        const resolvedId = me?.userId || me?.id;
        if (resolvedId) {
          setBackendUser({
            id: resolvedId,
            name: me.name || me.displayName || '',
            email: me.email || '',
            phoneNumber: me.phoneNumber ?? null,
            emailVerified: Boolean(me.emailVerified),
            phoneVerified: Boolean(me.phoneVerified),
            profileVersion: typeof me.profileVersion === 'number' ? me.profileVersion : 1,
          });
        }
        const rep = await apiClient
          .get<any>('/api/v1/me/reputation', { auth: 'required' })
          .catch(() => null);
        if (rep && typeof rep.reputationPoints === 'number') {
          setProfileStats({
            expPoints: rep.reputationPoints ?? 0,
            reputationScore: rep.reputationPoints ?? 0,
            reputationTier: rep.rankLabel && rep.rankLabel !== 'Unranked' ? rep.rankLabel : 'Chưa xếp hạng',
            contributionsCount: Number(rep.correctClaimCount ?? 0) + Number(rep.incorrectClaimCount ?? 0),
            reportsCount: 0,
            accountStandingScore: typeof rep.accountStandingScore === 'number' ? rep.accountStandingScore : 50,
            contributionAccuracyRate: typeof rep.contributionAccuracyRate === 'number' ? rep.contributionAccuracyRate : null,
            correctClaimCount: Number(rep.correctClaimCount ?? 0),
            incorrectClaimCount: Number(rep.incorrectClaimCount ?? 0),
            participationStatus: typeof rep.participationStatus === 'string' ? rep.participationStatus : 'Normal',
          });
        } else {
          setProfileStats(DEFAULT_PROFILE_STATS);
        }
        return;
      } catch (meError) {
        if (meError instanceof ApiError && meError.status === 401) {
          setBackendUser(null);
          setProfileStats(DEFAULT_PROFILE_STATS);
          return;
        }
        // Fallback to legacy monorepo backend profile endpoint on 404
      }

      const data = await apiClient.get<BackendProfileResponse>('/api/v1/users/me/profile', {
        auth: 'required',
      });
      setProfileStats({
        expPoints: data.expPoints ?? 0,
        reputationScore: data.reputationScore ?? 0,
        reputationTier: data.reputationTier || 'Chưa xếp hạng',
        contributionsCount: data.contributionsCount ?? 0,
        reportsCount: data.reportsCount ?? 0,
        accountStandingScore: 50,
        contributionAccuracyRate: null,
        correctClaimCount: data.contributionsCount ?? 0,
        incorrectClaimCount: 0,
        participationStatus: 'Normal',
      });
    } catch {
      setProfileStats(DEFAULT_PROFILE_STATS);
    }
  }, [session?.access_token]);

  useEffect(() => {
    const unsubscribeCleared = subscribeBackendAuthCleared(() => {
      setBackendUser(null);
      setProfileStats(DEFAULT_PROFILE_STATS);
    });
    return unsubscribeCleared;
  }, []);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    async function bootstrapAuth() {
      try {
        const stored = await getStoredBackendTokens();
        if (stored?.accessToken) {
          const validAccess =
            (await getStoredBackendAccessToken()) ||
            (stored.refreshToken ? await refreshBackendAccessToken() : null);
          if (validAccess && mounted) {
            await refreshProfile();
          }
        }

        if (isSupabaseConfigured) {
          const { data } = await supabase.auth.getSession();
          if (mounted) {
            setSession(data.session);
            if (data.session?.access_token) {
              await refreshProfile(data.session.access_token);
            }
          }

          const listener = supabase.auth.onAuthStateChange((event, nextSession) => {
            if (!mounted) return;
            setSession(nextSession);
            if (event === 'PASSWORD_RECOVERY') {
              setPasswordRecoveryPending(true);
            }
            if (nextSession?.access_token && event === 'SIGNED_IN') {
              void refreshProfile(nextSession.access_token);
            }
          });
          subscription = listener.data.subscription;
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void bootstrapAuth();

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
    // Run initial session hydration once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session?.access_token) {
      void refreshProfile();
    }
  }, [session?.access_token, refreshProfile]);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      requireConfiguration();
      const normalizedIdentifier = identifier.includes('@')
        ? identifier.trim().toLowerCase()
        : normalizeVietnamPhone(identifier) ?? identifier.trim();

      let allowSupabaseFallback = false;
      try {
        const tokens = await apiClient.post<BackendLoginTokensResponse>(
          '/api/v1/auth/login',
          { identifier: normalizedIdentifier, password },
          { auth: 'none' }
        );
        if (await applyBackendTokens(tokens, normalizedIdentifier.includes('@') ? normalizedIdentifier : '')) {
          await refreshProfile();
          return;
        }
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 404 || error.status === 503) &&
          normalizedIdentifier.includes('@') &&
          isSupabaseConfigured
        ) {
          allowSupabaseFallback = true;
        } else {
          throw new Error(mapAuthErrorMessage(error, 'Không thể đăng nhập tài khoản.'));
        }
      }

      if (allowSupabaseFallback && isSupabaseConfigured) {
        const { data: signInData, error } = await supabase.auth.signInWithPassword({
          email: normalizedIdentifier,
          password,
        });
        if (error) throw new Error(mapAuthErrorMessage(error, 'Không thể đăng nhập tài khoản.'));
        const userRole = String(signInData?.user?.app_metadata?.role ?? '').toLowerCase();
        if (userRole === 'admin' || userRole === 'moderator') {
          await supabase.auth.signOut();
          throw new Error('Tài khoản quản trị viên không được phép đăng nhập trên ứng dụng di động. Vui lòng sử dụng tài khoản người dùng thông thường.');
        }
        await refreshProfile();
        return;
      }

      throw new Error('Không thể xác thực tài khoản qua máy chủ.');
    },
    [applyBackendTokens, refreshProfile]
  );

  const startRegistrationChallenge = useCallback(
    async (input: {
      name: string;
      email: string;
      phone: string;
      channel: 'Email' | 'Sms';
    }): Promise<RegistrationChallengeResponse> => {
      requireConfiguration();
      try {
        return await apiClient.post<RegistrationChallengeResponse>(
          '/api/v1/auth/registration/challenges',
          {
            name: input.name,
            email: input.email,
            phone: input.phone,
            channel: input.channel,
          },
          { auth: 'none', idempotencyKey: createUuidV4() }
        );
      } catch (error) {
        throw new Error(mapAuthErrorMessage(error, 'Không thể gửi mã xác thực OTP.'));
      }
    },
    []
  );

  const completeRegistration = useCallback(
    async (input: {
      challengeId: string;
      otp: string;
      password: string;
      loginIdentifier: string;
    }): Promise<{ signedIn: boolean }> => {
      requireConfiguration();
      try {
        await apiClient.post<{ userId?: string }>(
          '/api/v1/auth/registration/complete',
          {
            challengeId: input.challengeId,
            otp: input.otp,
            password: input.password,
          },
          { auth: 'none' }
        );
      } catch (error) {
        throw new Error(mapAuthErrorMessage(error, 'Không thể hoàn tất đăng ký tài khoản.'));
      }

      try {
        await signIn(input.loginIdentifier, input.password);
        return { signedIn: true };
      } catch {
        return { signedIn: false };
      }
    },
    [signIn]
  );

  const startGoogleOAuth = useCallback(async (): Promise<GoogleOAuthOutcome> => {
    requireConfiguration();
    WebBrowser.maybeCompleteAuthSession();
    const redirectUri = Linking.createURL('auth/google/callback', { scheme: 'accessmapvn' });

    try {
      let start: { authorizationUrl: string; expiresAt: string } | null = null;
      try {
        start = await apiClient.post<{ authorizationUrl: string; expiresAt: string }>(
          '/api/v1/auth/google/start',
          { redirectUri },
          { auth: 'none' }
        );
      } catch (startErr) {
        if (
          startErr instanceof ApiError &&
          (startErr.status === 404 || startErr.status === 503) &&
          isSupabaseConfigured
        ) {
          const { data, error: sbStartErr } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: redirectUri, skipBrowserRedirect: true },
          });
          if (sbStartErr || !data?.url) {
            throw new Error(sbStartErr?.message || 'Không thể khởi tạo đăng nhập Google.');
          }
          const sbRes = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
          if (sbRes.type !== 'success' || !sbRes.url) {
            return { status: 'cancelled' };
          }
          const urlObj = new URL(sbRes.url);
          const hashParams = new URLSearchParams(urlObj.hash.replace(/^#/, ''));
          const accessToken = hashParams.get('access_token') || urlObj.searchParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token') || urlObj.searchParams.get('refresh_token');
          const codeParam = urlObj.searchParams.get('code');

          if (accessToken && refreshToken) {
            const { data: sessData, error: sessErr } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (sessErr) throw sessErr;
            const role = String(sessData?.user?.app_metadata?.role ?? '').toLowerCase();
            if (role === 'admin' || role === 'moderator') {
              await supabase.auth.signOut();
              throw new Error(
                'Tài khoản quản trị viên không được phép đăng nhập trên ứng dụng di động. Vui lòng sử dụng tài khoản người dùng thông thường.'
              );
            }
            await refreshProfile();
            return { status: 'signed_in' };
          }
          if (codeParam) {
            const { data: exchData, error: exchErr } = await supabase.auth.exchangeCodeForSession(codeParam);
            if (exchErr) throw exchErr;
            const role = String(exchData?.user?.app_metadata?.role ?? '').toLowerCase();
            if (role === 'admin' || role === 'moderator') {
              await supabase.auth.signOut();
              throw new Error(
                'Tài khoản quản trị viên không được phép đăng nhập trên ứng dụng di động. Vui lòng sử dụng tài khoản người dùng thông thường.'
              );
            }
            await refreshProfile();
            return { status: 'signed_in' };
          }
          throw new Error('Không nhận được thông tin phiên đăng nhập Google.');
        }
        throw startErr;
      }
      if (!start?.authorizationUrl) {
        throw new Error('Máy chủ không trả về liên kết đăng nhập Google.');
      }

      const authResult = await WebBrowser.openAuthSessionAsync(start.authorizationUrl, redirectUri);
      if (authResult.type !== 'success' || !authResult.url) {
        return { status: 'cancelled' };
      }

      const parsed = Linking.parse(authResult.url);
      const code = typeof parsed.queryParams?.code === 'string' ? parsed.queryParams.code : '';
      const state = typeof parsed.queryParams?.state === 'string' ? parsed.queryParams.state : '';
      if (!code || !state) {
        throw new Error('Phiên đăng nhập Google thiếu mã xác thực trả về.');
      }

      const completed = await apiClient.post<
        BackendLoginTokensResponse & Partial<GoogleProfileRequired> & { code?: string }
      >('/api/v1/auth/google/complete', { code, state }, { auth: 'none' });

      if (completed?.accessToken && (await applyBackendTokens(completed))) {
        await refreshProfile();
        return { status: 'signed_in' };
      }

      if (completed?.completionToken) {
        return {
          status: 'profile_required',
          profile: {
            completionToken: completed.completionToken,
            suggestedName: completed.suggestedName ?? null,
            email: completed.email ?? '',
            requiredFields: Array.isArray(completed.requiredFields)
              ? completed.requiredFields
              : ['name', 'password'],
            expiresAt: completed.expiresAt ?? '',
          },
        };
      }

      throw new Error('Không thể hoàn tất đăng nhập Google.');
    } catch (error) {
      throw new Error(mapAuthErrorMessage(error, 'Không thể đăng nhập bằng tài khoản Google.'));
    }
  }, [applyBackendTokens, refreshProfile]);

  const startGooglePhoneChallenge = useCallback(
    async (completionToken: string, phone: string): Promise<RegistrationChallengeResponse> => {
      requireConfiguration();
      try {
        return await apiClient.post<RegistrationChallengeResponse>(
          '/api/v1/auth/google/phone-challenges',
          { completionToken, phone },
          { auth: 'none', idempotencyKey: createUuidV4() }
        );
      } catch (error) {
        throw new Error(mapAuthErrorMessage(error, 'Không thể gửi mã OTP tới số điện thoại.'));
      }
    },
    []
  );

  const completeGoogleProfile = useCallback(
    async (input: {
      completionToken: string;
      name: string;
      password: string;
      phone?: string;
      phoneChallengeId?: string;
      phoneOtp?: string;
    }) => {
      requireConfiguration();
      const body = input.phone
        ? {
            completionToken: input.completionToken,
            name: input.name,
            password: input.password,
            phone: input.phone,
            phoneChallengeId: input.phoneChallengeId,
            phoneOtp: input.phoneOtp,
          }
        : {
            completionToken: input.completionToken,
            name: input.name,
            password: input.password,
          };

      try {
        const tokens = await apiClient.post<BackendLoginTokensResponse>(
          '/api/v1/auth/google/complete',
          body,
          { auth: 'none', idempotencyKey: createUuidV4() }
        );
        if (await applyBackendTokens(tokens)) {
          await refreshProfile();
          return;
        }
        throw new Error('Không nhận được phiên đăng nhập sau khi kích hoạt tài khoản.');
      } catch (error) {
        throw new Error(mapAuthErrorMessage(error, 'Không thể kích hoạt tài khoản Google.'));
      }
    },
    [applyBackendTokens, refreshProfile]
  );

  const updateProfileName = useCallback(
    async (name: string) => {
      const nameError = validateNameRule(name);
      if (nameError) throw new Error(nameError);
      const cleanName = name.normalize('NFC').replace(/\s+/g, ' ').trim();
      const expectedVersion = backendUser?.profileVersion ?? 1;

      try {
        let updated: {
          userId?: string;
          name?: string;
          email?: string;
          phoneNumber?: string | null;
          emailVerified?: boolean;
          phoneVerified?: boolean;
          profileVersion?: number;
        };
        try {
          updated = await apiClient.patch<typeof updated>(
            '/api/v1/me',
            { name: cleanName, expectedProfileVersion: expectedVersion },
            { auth: 'required' }
          );
        } catch (patchErr) {
          if (patchErr instanceof ApiError && (patchErr.status === 409 || patchErr.status === 412)) {
            const latest = await apiClient.get<{ profileVersion?: number }>('/api/v1/me', { auth: 'required' });
            const freshVersion = typeof latest?.profileVersion === 'number' ? latest.profileVersion : expectedVersion;
            updated = await apiClient.patch<typeof updated>(
              '/api/v1/me',
              { name: cleanName, expectedProfileVersion: freshVersion },
              { auth: 'required' }
            );
          } else {
            throw patchErr;
          }
        }

        if (isSupabaseConfigured) {
          void supabase.auth.updateUser({
            data: { full_name: cleanName, name: cleanName },
          }).catch(() => {});
        }

        setBackendUser((prev) => ({
          id: updated?.userId || prev?.id || '',
          name: updated?.name || cleanName,
          email: updated?.email || prev?.email || '',
          phoneNumber: updated?.phoneNumber ?? prev?.phoneNumber ?? null,
          emailVerified: updated?.emailVerified ?? prev?.emailVerified ?? false,
          phoneVerified: updated?.phoneVerified ?? prev?.phoneVerified ?? false,
          profileVersion:
            typeof updated?.profileVersion === 'number'
              ? updated.profileVersion
              : expectedVersion + 1,
        }));
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 503) && isSupabaseConfigured) {
          const { error: sbError } = await supabase.auth.updateUser({
            data: { full_name: cleanName, name: cleanName },
          });
          if (sbError) {
            throw new Error(mapAuthErrorMessage(sbError, 'Không thể cập nhật họ và tên.'));
          }
          setBackendUser((prev) =>
            prev
              ? { ...prev, name: cleanName }
              : {
                  id: user?.id || '',
                  name: cleanName,
                  email: user?.email || '',
                  phoneNumber: null,
                  emailVerified: true,
                  phoneVerified: false,
                  profileVersion: 1,
                }
          );
          return;
        }
        if (error instanceof ApiError && error.status === 409) {
          await refreshProfile();
        }
        throw new Error(mapAuthErrorMessage(error, 'Không thể cập nhật họ và tên.'));
      }
    },
    [backendUser?.profileVersion, refreshProfile]
  );

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!isSupabaseConfigured) {
      throw new Error('Chưa cấu hình Supabase để gửi email đặt lại mật khẩu.');
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: Linking.createURL('login', { scheme: 'accessmapvn' }),
    });
    if (error) throw new Error(mapAuthErrorMessage(error, 'Không thể gửi email đặt lại mật khẩu.'));
  }, []);

  const completePasswordRecovery = useCallback(async (newPassword: string) => {
    if (!isSupabaseConfigured) {
      throw new Error('Chưa cấu hình Supabase để cập nhật mật khẩu mới.');
    }
    const pwErr = validatePasswordRule(newPassword);
    if (pwErr) throw new Error(pwErr);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(mapAuthErrorMessage(error, 'Không thể cập nhật mật khẩu mới.'));
    setPasswordRecoveryPending(false);
  }, []);

  const signOut = useCallback(async () => {
    const storedToken = await getStoredBackendTokens();
    if (storedToken?.accessToken) {
      await apiClient.post('/api/v1/auth/logout', undefined, { auth: 'required' }).catch(() => {});
      await setStoredBackendTokens(null);
    }
    setBackendUser(null);
    setProfileStats(DEFAULT_PROFILE_STATS);
    setPasswordRecoveryPending(false);
    if (isSupabaseConfigured) {
      const { error } = await supabase.auth.signOut();
      if (error && !storedToken) throw error;
    }
  }, []);

  const user = useMemo<User | null>(() => {
    if (session?.user) return session.user;
    if (!backendUser) return null;
    return {
      id: backendUser.id,
      email: backendUser.email,
      app_metadata: {},
      user_metadata: {
        full_name: backendUser.name,
        name: backendUser.name,
      },
      aud: 'authenticated',
      created_at: '',
    } as User;
  }, [backendUser, session?.user]);

  const activeIdentity = user ?? backendUser;
  const isGuest = !activeIdentity;

  useEffect(() => {
    const uid = activeIdentity?.id ?? null;
    setFavoritesUserId(uid);
    setContributionsUserId(uid);
  }, [activeIdentity?.id]);

  const userProfile = useMemo<UserProfile>(() => {
    if (!activeIdentity) {
      return {
        id: 'guest',
        email: '',
        fullName: 'Khách tham quan',
        phoneNumber: null,
        emailVerified: false,
        phoneVerified: false,
        profileVersion: 1,
        avatarUrl: null,
        role: 'Khách',
        expPoints: 0,
        reputationScore: 0,
        reputationTier: 'Khách',
        contributionsCount: 0,
        reportsCount: 0,
        accountStandingScore: 100,
        contributionAccuracyRate: null,
        correctClaimCount: 0,
        incorrectClaimCount: 0,
        participationStatus: 'Normal',
        isGuest: true,
      };
    }

    const metaName = user?.user_metadata?.full_name || user?.user_metadata?.name;
    const emailStr = backendUser?.email || user?.email || '';
    const fallbackName = emailStr ? emailStr.split('@')[0] : 'Thành viên';
    const fullName = backendUser?.name || metaName || fallbackName;

    return {
      id: activeIdentity.id,
      email: emailStr,
      fullName,
      phoneNumber: backendUser?.phoneNumber ?? null,
      emailVerified: backendUser?.emailVerified ?? Boolean(user?.email),
      phoneVerified: backendUser?.phoneVerified ?? false,
      profileVersion: backendUser?.profileVersion ?? 1,
      avatarUrl: user?.user_metadata?.avatar_url || null,
      role: (user?.app_metadata?.role as string) || 'Người dùng đã xác thực',
      expPoints: profileStats.expPoints,
      reputationScore: profileStats.reputationScore,
      reputationTier: profileStats.reputationTier,
      contributionsCount: profileStats.contributionsCount,
      reportsCount: profileStats.reportsCount,
      accountStandingScore: profileStats.accountStandingScore,
      contributionAccuracyRate: profileStats.contributionAccuracyRate,
      correctClaimCount: profileStats.correctClaimCount,
      incorrectClaimCount: profileStats.incorrectClaimCount,
      participationStatus: profileStats.participationStatus,
      isGuest: false,
    };
  }, [activeIdentity, backendUser, user, profileStats]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      userProfile,
      isGuest,
      isLoading,
      isConfigured: isBackendConfigured,
      passwordRecoveryPending,
      refreshProfile,
      signIn,
      startRegistrationChallenge,
      completeRegistration,
      startGoogleOAuth,
      startGooglePhoneChallenge,
      completeGoogleProfile,
      updateProfileName,
      sendPasswordReset,
      completePasswordRecovery,
      signOut,
    }),
    [
      completeGoogleProfile,
      completePasswordRecovery,
      completeRegistration,
      isGuest,
      isLoading,
      passwordRecoveryPending,
      refreshProfile,
      sendPasswordReset,
      session,
      signIn,
      signOut,
      startGoogleOAuth,
      startGooglePhoneChallenge,
      startRegistrationChallenge,
      updateProfileName,
      user,
      userProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
