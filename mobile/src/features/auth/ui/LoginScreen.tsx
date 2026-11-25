import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccessibility } from '@/features/accessibility';
import { branding } from '@/shared/config/branding';
import { useToast } from '@/shared/ui/ToastProvider';
import {
  type GoogleProfileRequired,
  normalizeVietnamPhone,
  type RegistrationChallengeResponse,
  useAuth,
  validateEmailRule,
  validateNameRule,
  validatePasswordRule,
} from '../model/AuthProvider';

type AuthMode = 'signIn' | 'signUp';
type SignUpStep = 'form' | 'otp';
type OtpChannel = 'Sms' | 'Email';

function formatCountdown(targetIso: string | undefined, nowMs: number): number {
  if (!targetIso) return 0;
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) return 0;
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

function formatMmSs(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function maskDestination(destination: string, channel: OtpChannel): string {
  if (channel === 'Sms') {
    const clean = destination.replace(/^\+84/, '');
    if (clean.length >= 6) {
      return `+84 ${clean.slice(0, 3)} ••• ${clean.slice(-3)}`;
    }
    return destination;
  }
  const [local, domain] = destination.split('@');
  if (!local || !domain) return destination;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

interface OtpCodeBoxesProps {
  value: string;
  onChangeText: (next: string) => void;
  hasError?: boolean;
  label?: string;
}

function extractOtpDigits(raw: string, currentDigits: string): string {
  if (/\D/.test(raw)) {
    const sixMatches = raw.match(/\b\d{6}\b/g);
    if (sixMatches && sixMatches.length > 0) {
      return sixMatches[sixMatches.length - 1];
    }
  }
  const onlyDigits = raw.replace(/\D/g, '');
  if (onlyDigits.length <= 6) return onlyDigits;
  if (
    currentDigits.length > 0 &&
    onlyDigits.length >= currentDigits.length + 6 &&
    onlyDigits.startsWith(currentDigits)
  ) {
    return onlyDigits.slice(-6);
  }
  return onlyDigits.slice(0, 6);
}

function OtpCodeBoxes({
  value,
  onChangeText,
  hasError = false,
  label = 'Mã xác thực OTP 6 chữ số',
}: OtpCodeBoxesProps) {
  const digits = value.replace(/\D/g, '').slice(0, 6);

  return (
    <View style={styles.otpContainer}>
      <View style={styles.otpBoxRow} pointerEvents="none">
        {[0, 1, 2, 3, 4, 5].map((index) => {
          const char = digits[index] ?? '';
          const isActive = index === digits.length || (digits.length === 6 && index === 5);
          return (
            <View
              key={index}
              style={[
                styles.otpBox,
                Boolean(char) && styles.otpBoxFilled,
                isActive && styles.otpBoxActive,
                hasError && styles.otpBoxError,
              ]}
            >
              <Text style={styles.otpBoxDigit}>{char || (isActive ? '' : '·')}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        accessibilityLabel={label}
        autoComplete="sms-otp"
        contextMenuHidden={false}
        cursorColor="transparent"
        importantForAutofill="yes"
        keyboardType="number-pad"
        onChangeText={(text) => onChangeText(extractOtpDigits(text, digits))}
        selectTextOnFocus
        selectionColor="transparent"
        style={styles.otpHiddenInput}
        textContentType="oneTimeCode"
        underlineColorAndroid="transparent"
        value={digits}
      />
    </View>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const { settings, triggerHaptic } = useAccessibility();
  const { showToast } = useToast();
  const {
    isConfigured,
    isGuest,
    passwordRecoveryPending,
    signIn,
    startRegistrationChallenge,
    completeRegistration,
    startGoogleOAuth,
    startGooglePhoneChallenge,
    completeGoogleProfile,
    sendPasswordReset,
    completePasswordRecovery,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('signIn');
  const [regStep, setRegStep] = useState<SignUpStep>('form');
  const [channel, setChannel] = useState<OtpChannel>('Email');

  // Sign-In & Sign-Up fields
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);

  // Registration OTP state
  const [challenge, setChallenge] = useState<RegistrationChallengeResponse | null>(null);
  const [otpDestination, setOtpDestination] = useState('');
  const [otpCode, setOtpCode] = useState('');

  // Password recovery state
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirm, setRecoveryConfirm] = useState('');

  // Google completion modal state (SCR-AUTH-03)
  const [googleProfile, setGoogleProfile] = useState<GoogleProfileRequired | null>(null);
  const [googleName, setGoogleName] = useState('');
  const [googlePassword, setGooglePassword] = useState('');
  const [googleConfirmPassword, setGoogleConfirmPassword] = useState('');
  const [isGooglePwVisible, setIsGooglePwVisible] = useState(false);
  const [googlePhone, setGooglePhone] = useState('');
  const [googlePhoneChallenge, setGooglePhoneChallenge] =
    useState<RegistrationChallengeResponse | null>(null);
  const [googlePhoneOtp, setGooglePhoneOtp] = useState('');
  const [googleSendingOtp, setGoogleSendingOtp] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  // Shared UI & validation states
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const errorMessage: string | null = null;
  const setErrorMessage = (msg: string | null) => {
    if (msg) {
      showToast({ message: msg, variant: 'error' });
    }
  };
  const [suggestEmailFallback, setSuggestEmailFallback] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [registrationSuccess, setRegistrationSuccess] = useState<{ name: string } | null>(null);

  const authRedirectHandledRef = useRef(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstStepRenderRef = useRef(true);

  const cardOpacity = useSharedValue(1);
  const cardTranslateY = useSharedValue(0);
  const checkScale = useSharedValue(1);

  // Input refs for keyboard "next" focus
  const loginPasswordRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const regPasswordRef = useRef<TextInput>(null);
  const regConfirmRef = useRef<TextInput>(null);

  const stepKey = passwordRecoveryPending
    ? 'recovery'
    : registrationSuccess
    ? 'reg-success'
    : `${mode}-${regStep}`;

  useEffect(() => {
    if (
      !isGuest &&
      !passwordRecoveryPending &&
      !authRedirectHandledRef.current &&
      !registrationSuccess
    ) {
      router.replace('/map');
    }
  }, [isGuest, passwordRecoveryPending, registrationSuccess, router]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isFirstStepRenderRef.current) {
      isFirstStepRenderRef.current = false;
      return;
    }
    if (settings.reduceMotion) {
      cardOpacity.value = 1;
      cardTranslateY.value = 0;
      return;
    }
    cardOpacity.value = 0;
    cardTranslateY.value = 10;
    cardOpacity.value = withTiming(1, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
    cardTranslateY.value = withTiming(0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [cardOpacity, cardTranslateY, settings.reduceMotion, stepKey]);

  useEffect(() => {
    if (!registrationSuccess || settings.reduceMotion) {
      checkScale.value = 1;
      return;
    }
    checkScale.value = 0.72;
    checkScale.value = withTiming(1, {
      duration: 240,
      easing: Easing.out(Easing.back(1.6)),
    });
  }, [checkScale, registrationSuccess, settings.reduceMotion]);

  const stepCardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardTranslateY.value }],
  }));

  const checkAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const finishRegistrationNavigation = (displayName: string) => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    showToast({
      message: `Chào mừng ${displayName} đến với AccessMap VN!`,
      variant: 'success',
      durationMs: 3000,
    });
    router.replace('/map');
  };

  useEffect(() => {
    if (regStep !== 'otp' && !googlePhoneChallenge) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [regStep, googlePhoneChallenge]);

  const setFieldError = (key: string, value: string | null) => {
    setFieldErrors((prev) => ({ ...prev, [key]: value }));
  };

  const resetMessages = () => {
    setErrorMessage(null);
    setSuggestEmailFallback(false);
  };

  const handleModeSwitch = (nextMode: AuthMode) => {
    setMode(nextMode);
    setRegStep('form');
    setChallenge(null);
    setOtpCode('');
    setFieldErrors({});
    resetMessages();
  };

  const handleSignIn = async () => {
    const trimmed = loginIdentifier.trim();
    if (!trimmed) {
      setFieldError('loginIdentifier', 'Vui lòng nhập email hoặc số điện thoại.');
      setErrorMessage('Vui lòng nhập email hoặc số điện thoại và mật khẩu.');
      return;
    }
    if (!trimmed.includes('@') && !normalizeVietnamPhone(trimmed)) {
      setFieldError(
        'loginIdentifier',
        'Nhập email hợp lệ hoặc số điện thoại Việt Nam (VD: 0912345678).'
      );
      setErrorMessage('Định dạng email hoặc số điện thoại chưa đúng.');
      return;
    }
    if (!password) {
      setFieldError('password', 'Vui lòng nhập mật khẩu.');
      setErrorMessage('Vui lòng nhập mật khẩu.');
      return;
    }

    authRedirectHandledRef.current = true;
    setIsSubmitting(true);
    resetMessages();
    try {
      await signIn(trimmed, password);
      triggerHaptic(30);
      showToast({
        message: 'Đăng nhập thành công! Chào mừng trở lại.',
        variant: 'success',
      });
      router.replace('/map');
    } catch (error) {
      authRedirectHandledRef.current = false;
      setErrorMessage(error instanceof Error ? error.message : 'Không thể đăng nhập tài khoản.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendRegChallenge = async (targetChannel: OtpChannel) => {
    const nameErr = validateNameRule(fullName);
    const emailErr = validateEmailRule(email);
    const normalizedPhone = normalizeVietnamPhone(phone);
    const phoneErr = normalizedPhone
      ? null
      : 'Số điện thoại Việt Nam chưa hợp lệ (VD: 0912345678).';
    const pwErr = validatePasswordRule(password);
    const confirmErr = password !== confirmPassword ? 'Mật khẩu xác nhận không trùng khớp.' : null;

    setFieldErrors({
      fullName: nameErr,
      email: emailErr,
      phone: phoneErr,
      password: pwErr,
      confirmPassword: confirmErr,
    });

    if (nameErr || emailErr || phoneErr || pwErr || confirmErr || !normalizedPhone) {
      setErrorMessage(nameErr || emailErr || phoneErr || pwErr || confirmErr);
      return;
    }

    const cleanName = fullName.normalize('NFC').replace(/\s+/g, ' ').trim();
    const cleanEmail = email.trim();

    setIsSubmitting(true);
    resetMessages();
    try {
      const created = await startRegistrationChallenge({
        name: cleanName,
        email: cleanEmail,
        phone: normalizedPhone,
        channel: targetChannel,
      });
      setChannel(targetChannel);
      setChallenge(created);
      setOtpDestination(targetChannel === 'Email' ? cleanEmail : normalizedPhone);
      setOtpCode('');
      setRegStep('otp');
      setNowMs(Date.now());
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Không thể gửi mã xác thực OTP.';
      setErrorMessage(msg);
      if (targetChannel === 'Sms' && msg.includes('tạm thời không khả dụng')) {
        setSuggestEmailFallback(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteRegistration = async () => {
    if (!challenge) {
      setErrorMessage('Phiên OTP không tồn tại. Vui lòng gửi lại mã xác thực.');
      return;
    }
    const cleanOtp = otpCode.replace(/\D/g, '');
    if (cleanOtp.length !== 6) {
      setErrorMessage('Vui lòng nhập đủ 6 chữ số xác thực.');
      return;
    }

    authRedirectHandledRef.current = true;
    setIsSubmitting(true);
    resetMessages();
    try {
      const cleanEmail = email.trim().toLowerCase();
      const result = await completeRegistration({
        challengeId: challenge.challengeId,
        otp: cleanOtp,
        password,
        loginIdentifier: cleanEmail,
      });
      if (result.signedIn) {
        const cleanName = fullName.normalize('NFC').replace(/\s+/g, ' ').trim() || 'bạn';
        triggerHaptic(50);
        setRegistrationSuccess({ name: cleanName });
        successTimerRef.current = setTimeout(
          () => finishRegistrationNavigation(cleanName),
          settings.reduceMotion ? 900 : 1200
        );
      } else {
        authRedirectHandledRef.current = false;
        handleModeSwitch('signIn');
        setLoginIdentifier(cleanEmail);
        triggerHaptic(40);
        showToast({
          message: 'Tạo tài khoản thành công! Vui lòng đăng nhập.',
          variant: 'success',
          durationMs: 3200,
        });
      }
    } catch (error) {
      authRedirectHandledRef.current = false;
      setErrorMessage(error instanceof Error ? error.message : 'Không thể hoàn tất đăng ký.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    const targetEmail = (mode === 'signIn' ? loginIdentifier : email).trim().toLowerCase();
    const emailErr = validateEmailRule(targetEmail);
    if (emailErr) {
      setFieldError('loginIdentifier', 'Nhập email tài khoản để nhận hướng dẫn đặt lại mật khẩu.');
      setErrorMessage('Nhập địa chỉ email hợp lệ vào ô tài khoản để đặt lại mật khẩu.');
      return;
    }

    setIsSubmitting(true);
    resetMessages();
    try {
      await sendPasswordReset(targetEmail);
      Alert.alert(
        'Đã gửi email đặt lại mật khẩu',
        `Kiểm tra hộp thư ${targetEmail} và mở liên kết trong email bằng AccessMapVN.`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Không thể gửi email đặt lại mật khẩu.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteRecovery = async () => {
    const pwErr = validatePasswordRule(recoveryPassword);
    if (pwErr) {
      setErrorMessage(pwErr);
      return;
    }
    if (recoveryPassword !== recoveryConfirm) {
      setErrorMessage('Mật khẩu xác nhận không trùng khớp.');
      return;
    }

    authRedirectHandledRef.current = true;
    setIsSubmitting(true);
    resetMessages();
    try {
      await completePasswordRecovery(recoveryPassword);
      triggerHaptic(40);
      showToast({
        message: 'Mật khẩu mới đã được cập nhật.',
        variant: 'success',
      });
      router.replace('/map');
    } catch (error) {
      authRedirectHandledRef.current = false;
      setErrorMessage(
        error instanceof Error ? error.message : 'Không thể cập nhật mật khẩu mới.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    authRedirectHandledRef.current = true;
    setIsGoogleLoading(true);
    resetMessages();
    try {
      const outcome = await startGoogleOAuth();
      if (outcome.status === 'signed_in') {
        triggerHaptic(30);
        showToast({
          message: 'Đăng nhập Google thành công!',
          variant: 'success',
        });
        router.replace('/map');
        return;
      }
      authRedirectHandledRef.current = false;
      if (outcome.status === 'profile_required') {
        setGoogleProfile(outcome.profile);
        setGoogleName(outcome.profile.suggestedName ?? '');
        setGooglePassword('');
        setGoogleConfirmPassword('');
        setGooglePhone('');
        setGooglePhoneChallenge(null);
        setGooglePhoneOtp('');
        setGoogleError(null);
      }
    } catch (error) {
      authRedirectHandledRef.current = false;
      setErrorMessage(
        error instanceof Error ? error.message : 'Không thể đăng nhập với tài khoản Google.'
      );
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSendGooglePhoneOtp = async () => {
    if (!googleProfile) return;
    const normalizedPhone = normalizeVietnamPhone(googlePhone);
    if (!normalizedPhone) {
      setGoogleError('Số điện thoại Việt Nam chưa hợp lệ (VD: 0912345678).');
      return;
    }
    setGoogleSendingOtp(true);
    setGoogleError(null);
    try {
      const res = await startGooglePhoneChallenge(googleProfile.completionToken, normalizedPhone);
      setGooglePhoneChallenge(res);
      setGooglePhoneOtp('');
      setNowMs(Date.now());
    } catch (error) {
      setGoogleError(
        error instanceof Error ? error.message : 'Không thể gửi mã OTP tới số điện thoại.'
      );
    } finally {
      setGoogleSendingOtp(false);
    }
  };

  const handleSubmitGoogleProfile = async () => {
    if (!googleProfile) return;
    const nameErr = validateNameRule(googleName);
    const pwErr = validatePasswordRule(googlePassword);
    if (nameErr) {
      setGoogleError(nameErr);
      return;
    }
    if (pwErr) {
      setGoogleError(pwErr);
      return;
    }
    if (googlePassword !== googleConfirmPassword) {
      setGoogleError('Mật khẩu xác nhận không trùng khớp.');
      return;
    }

    let normalizedPhone: string | undefined;
    let challengeId: string | undefined;
    let phoneOtpClean: string | undefined;
    const phoneInputTrimmed = googlePhone.trim();
    const phoneRequired = googleProfile.requiredFields.includes('phone');

    if (phoneInputTrimmed || phoneRequired) {
      const normalized = normalizeVietnamPhone(phoneInputTrimmed);
      if (!normalized) {
        setGoogleError('Vui lòng nhập số điện thoại Việt Nam hợp lệ.');
        return;
      }
      if (!googlePhoneChallenge?.challengeId) {
        setGoogleError('Hãy bấm "Gửi mã" để nhận OTP 6 số xác thực số điện thoại.');
        return;
      }
      const digits = googlePhoneOtp.replace(/\D/g, '');
      if (digits.length !== 6) {
        setGoogleError('Vui lòng nhập đủ 6 chữ số OTP số điện thoại.');
        return;
      }
      normalizedPhone = normalized;
      challengeId = googlePhoneChallenge.challengeId;
      phoneOtpClean = digits;
    }

    authRedirectHandledRef.current = true;
    setIsSubmitting(true);
    setGoogleError(null);
    try {
      await completeGoogleProfile({
        completionToken: googleProfile.completionToken,
        name: googleName.normalize('NFC').replace(/\s+/g, ' ').trim(),
        password: googlePassword,
        phone: normalizedPhone,
        phoneChallengeId: challengeId,
        phoneOtp: phoneOtpClean,
      });
      const cleanName = googleName.normalize('NFC').replace(/\s+/g, ' ').trim() || 'bạn';
      setGoogleProfile(null);
      triggerHaptic(50);
      showToast({
        message: `Chào mừng ${cleanName} đến với AccessMap VN!`,
        variant: 'success',
        durationMs: 3000,
      });
      router.replace('/map');
    } catch (error) {
      authRedirectHandledRef.current = false;
      setGoogleError(
        error instanceof Error ? error.message : 'Không thể kích hoạt tài khoản Google.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const otpExpiresSec = formatCountdown(challenge?.expiresAt, nowMs);
  const otpResendSec = formatCountdown(challenge?.nextSendAt, nowMs);
  const googleOtpExpiresSec = formatCountdown(googlePhoneChallenge?.expiresAt, nowMs);
  const googleOtpResendSec = formatCountdown(googlePhoneChallenge?.nextSendAt, nowMs);

  const screenTitle = passwordRecoveryPending
    ? 'Đặt lại mật khẩu mới'
    : registrationSuccess
    ? 'Đăng ký thành công'
    : mode === 'signUp' && regStep === 'otp'
    ? 'Xác thực mã OTP'
    : mode === 'signUp'
    ? 'Tạo tài khoản mới'
    : 'Đăng nhập AccessMap';

  const handleTopBack = () => {
    if (mode === 'signUp' && regStep === 'otp') {
      setRegStep('form');
      resetMessages();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/map');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.mapDecoration}
      >
        <View style={[styles.mapRoad, styles.mapRoadHorizontal]} />
        <View style={[styles.mapRoad, styles.mapRoadVertical]} />
        <View style={[styles.mapBlock, styles.mapBlockLeft]} />
        <View style={[styles.mapBlock, styles.mapBlockRight]} />
      </View>

      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleTopBack}
          accessibilityRole="button"
          accessibilityLabel={
            mode === 'signUp' && regStep === 'otp' ? 'Quay lại biểu mẫu đăng ký' : 'Quay lại bản đồ'
          }
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color={branding.colors.primary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{screenTitle}</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 12}
        style={styles.keyboardArea}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.content, stepCardAnimatedStyle]}>
            {passwordRecoveryPending ? (
              <View style={styles.formCard}>
                <Text style={styles.sectionHeading}>Tạo mật khẩu mới</Text>
                <Text style={styles.sectionSubText}>
                  Mật khẩu phải dài 8–128 ký tự, gồm ít nhất 1 chữ hoa, 1 chữ thường và 1 chữ số.
                </Text>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Mật khẩu mới *</Text>
                  <View style={styles.inputShell}>
                    <Ionicons name="lock-closed-outline" size={20} color={branding.colors.mutedText} />
                    <TextInput
                      accessibilityLabel="Mật khẩu mới"
                      autoCapitalize="none"
                      onChangeText={setRecoveryPassword}
                      placeholder="Nhập mật khẩu mới (≥ 8 ký tự)"
                      placeholderTextColor="#8A9695"
                      secureTextEntry={!isPasswordVisible}
                      style={styles.input}
                      value={recoveryPassword}
                    />
                    <TouchableOpacity
                      accessibilityLabel={isPasswordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => setIsPasswordVisible((v) => !v)}
                      style={styles.visibilityButton}
                    >
                      <Ionicons
                        color={branding.colors.mutedText}
                        name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                        size={20}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Xác nhận mật khẩu mới *</Text>
                  <View style={styles.inputShell}>
                    <Ionicons name="shield-checkmark-outline" size={20} color={branding.colors.mutedText} />
                    <TextInput
                      accessibilityLabel="Xác nhận mật khẩu mới"
                      autoCapitalize="none"
                      onChangeText={setRecoveryConfirm}
                      placeholder="Nhập lại mật khẩu mới"
                      placeholderTextColor="#8A9695"
                      secureTextEntry={!isConfirmPasswordVisible}
                      style={styles.input}
                      value={recoveryConfirm}
                    />
                  </View>
                </View>

                {errorMessage ? (
                  <View accessibilityLiveRegion="polite" style={styles.errorBanner}>
                    <Ionicons name="alert-circle" size={16} color="#93000A" />
                    <Text style={styles.errorBannerText}>{errorMessage}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={() => void handleCompleteRecovery()}
                  style={[styles.primaryButton, isSubmitting && styles.disabledButton]}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Cập nhật mật khẩu mới</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : registrationSuccess ? (
              <View style={[styles.formCard, styles.successCard]}>
                <Animated.View style={[styles.successBadgeCircle, checkAnimatedStyle]}>
                  <Ionicons name="checkmark-circle" size={40} color="#059669" />
                </Animated.View>
                <Text style={styles.successTitle}>Tạo tài khoản thành công!</Text>
                <Text style={styles.successSubtitle}>
                  Chào mừng {registrationSuccess.name} đến với AccessMap VN. Đang chuyển tới bản đồ...
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.85}
                  onPress={() => finishRegistrationNavigation(registrationSuccess.name)}
                  style={[styles.primaryButton, { width: '100%' }]}
                >
                  <View style={styles.primaryButtonInner}>
                    <Text style={styles.primaryButtonText}>Khám phá ngay</Text>
                    <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {!(mode === 'signUp' && regStep === 'otp') && (
                  <>
                    <View style={styles.brandSection}>
                      <View style={styles.logoFrame}>
                        <Image
                          accessibilityLabel={`${branding.appName}, ứng dụng bản đồ tiếp cận`}
                          source={branding.logo}
                          style={styles.logo}
                        />
                      </View>
                      <Text style={styles.appName}>{branding.appName}</Text>
                      <Text style={styles.supportingText}>
                        {mode === 'signIn'
                          ? 'Đăng nhập để lưu điểm danh vọng, uy tín và vinh danh đóng góp'
                          : 'Tham gia cộng đồng xây dựng bản đồ tiếp cận Việt Nam'}
                      </Text>
                    </View>

                    <View accessibilityRole="tablist" style={styles.tabContainer}>
                      <TouchableOpacity
                        accessibilityRole="tab"
                        accessibilityState={{ selected: mode === 'signIn' }}
                        style={[styles.tabButton, mode === 'signIn' && styles.tabButtonActive]}
                        onPress={() => handleModeSwitch('signIn')}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.tabText, mode === 'signIn' && styles.tabTextActive]}>
                          Đăng nhập
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityRole="tab"
                        accessibilityState={{ selected: mode === 'signUp' }}
                        style={[styles.tabButton, mode === 'signUp' && styles.tabButtonActive]}
                        onPress={() => handleModeSwitch('signUp')}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.tabText, mode === 'signUp' && styles.tabTextActive]}>
                          Đăng ký
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {mode === 'signIn' ? (
                  <View style={styles.formCard}>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Email hoặc số điện thoại *</Text>
                      <View
                        style={[
                          styles.inputShell,
                          fieldErrors.loginIdentifier ? styles.inputShellError : null,
                        ]}
                      >
                        <Ionicons name="person-circle-outline" size={20} color={branding.colors.mutedText} />
                        <TextInput
                          accessibilityLabel="Email hoặc số điện thoại"
                          autoCapitalize="none"
                          autoComplete="username"
                          keyboardType="email-address"
                          onBlur={() => {
                            const v = loginIdentifier.trim();
                            if (v && !v.includes('@') && !normalizeVietnamPhone(v)) {
                              setFieldError(
                                'loginIdentifier',
                                'Nhập email hợp lệ hoặc số điện thoại Việt Nam.'
                              );
                            }
                          }}
                          onChangeText={(text) => {
                            setLoginIdentifier(text);
                            setFieldError('loginIdentifier', null);
                          }}
                          onSubmitEditing={() => loginPasswordRef.current?.focus()}
                          placeholder="email@example.com hoặc 0912345678"
                          placeholderTextColor="#8A9695"
                          returnKeyType="next"
                          selectionColor={branding.colors.primary}
                          style={styles.input}
                          value={loginIdentifier}
                        />
                      </View>
                      {fieldErrors.loginIdentifier ? (
                        <Text style={styles.inlineError}>{fieldErrors.loginIdentifier}</Text>
                      ) : null}
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Mật khẩu *</Text>
                      <View
                        style={[
                          styles.inputShell,
                          fieldErrors.password ? styles.inputShellError : null,
                        ]}
                      >
                        <Ionicons name="lock-closed-outline" size={20} color={branding.colors.mutedText} />
                        <TextInput
                          ref={loginPasswordRef}
                          accessibilityLabel="Mật khẩu"
                          autoCapitalize="none"
                          autoComplete="current-password"
                          onChangeText={(text) => {
                            setPassword(text);
                            setFieldError('password', null);
                          }}
                          onSubmitEditing={() => void handleSignIn()}
                          placeholder="Nhập mật khẩu của bạn"
                          placeholderTextColor="#8A9695"
                          returnKeyType="done"
                          secureTextEntry={!isPasswordVisible}
                          selectionColor={branding.colors.primary}
                          style={styles.input}
                          textContentType="password"
                          value={password}
                        />
                        <TouchableOpacity
                          accessibilityLabel={isPasswordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                          accessibilityRole="button"
                          activeOpacity={0.7}
                          hitSlop={8}
                          onPress={() => setIsPasswordVisible((v) => !v)}
                          style={styles.visibilityButton}
                        >
                          <Ionicons
                            color={branding.colors.mutedText}
                            name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                            size={20}
                          />
                        </TouchableOpacity>
                      </View>
                      {fieldErrors.password ? (
                        <Text style={styles.inlineError}>{fieldErrors.password}</Text>
                      ) : null}
                    </View>

                    <TouchableOpacity
                      accessibilityRole="button"
                      activeOpacity={0.7}
                      disabled={isSubmitting}
                      onPress={() => void handlePasswordReset()}
                      style={styles.forgotButton}
                    >
                      <Text style={styles.linkText}>Quên mật khẩu?</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      accessibilityHint="Đăng nhập vào AccessMapVN"
                      accessibilityRole="button"
                      activeOpacity={0.84}
                      disabled={isSubmitting || !isConfigured}
                      onPress={() => void handleSignIn()}
                      style={[
                        styles.primaryButton,
                        (isSubmitting || !isConfigured) && styles.disabledButton,
                      ]}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.primaryButtonText}>Đăng nhập ngay</Text>
                      )}
                    </TouchableOpacity>

                    {errorMessage ? (
                      <View accessibilityLiveRegion="polite" style={styles.errorBanner}>
                        <Ionicons name="alert-circle" size={16} color="#93000A" />
                        <Text style={styles.errorBannerText}>{errorMessage}</Text>
                      </View>
                    ) : null}

                    <View style={styles.dividerRow}>
                      <View style={styles.dividerLine} />
                      <Text style={styles.dividerText}>Hoặc tiếp tục với</Text>
                      <View style={styles.dividerLine} />
                    </View>

                    <TouchableOpacity
                      accessibilityRole="button"
                      activeOpacity={0.82}
                      disabled={isGoogleLoading || isSubmitting}
                      onPress={() => void handleGoogleAuth()}
                      style={[styles.googleButton, isGoogleLoading && styles.disabledButton]}
                    >
                      {isGoogleLoading ? (
                        <ActivityIndicator color="#0F172A" size="small" />
                      ) : (
                        <>
                          <Ionicons name="logo-google" size={18} color="#DB4437" />
                          <Text style={styles.googleButtonText}>Đăng nhập với tài khoản Google</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : regStep === 'form' ? (
                  /* SCR-AUTH-01: Tạo tài khoản mới */
                  <View style={styles.formCard}>
                    <View style={styles.introBanner}>
                      <View style={styles.introBannerIcon}>
                        <MaterialCommunityIcons
                          name="wheelchair-accessibility"
                          size={20}
                          color="#004E58"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.introBannerTitle}>Cùng xây dựng lộ trình tiếp cận</Text>
                        <Text style={styles.introBannerDesc}>
                          Đăng ký để chia sẻ dữ liệu thực địa và hỗ trợ cộng đồng di chuyển an toàn.
                        </Text>
                      </View>
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Họ và tên *</Text>
                      <View
                        style={[
                          styles.inputShell,
                          fieldErrors.fullName ? styles.inputShellError : null,
                        ]}
                      >
                        <Ionicons name="person-outline" size={20} color={branding.colors.mutedText} />
                        <TextInput
                          accessibilityLabel="Họ và tên"
                          autoCapitalize="words"
                          autoComplete="name"
                          onBlur={() => setFieldError('fullName', validateNameRule(fullName))}
                          onChangeText={(text) => {
                            setFullName(text);
                            setFieldError('fullName', null);
                          }}
                          onSubmitEditing={() => emailRef.current?.focus()}
                          placeholder="Nguyễn Văn An"
                          placeholderTextColor="#8A9695"
                          returnKeyType="next"
                          selectionColor={branding.colors.primary}
                          style={styles.input}
                          value={fullName}
                        />
                      </View>
                      {fieldErrors.fullName ? (
                        <Text style={styles.inlineError}>{fieldErrors.fullName}</Text>
                      ) : null}
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Địa chỉ Email *</Text>
                      <View
                        style={[styles.inputShell, fieldErrors.email ? styles.inputShellError : null]}
                      >
                        <Ionicons name="mail-outline" size={20} color={branding.colors.mutedText} />
                        <TextInput
                          ref={emailRef}
                          accessibilityLabel="Địa chỉ Email"
                          autoCapitalize="none"
                          autoComplete="email"
                          keyboardType="email-address"
                          onBlur={() => setFieldError('email', validateEmailRule(email))}
                          onChangeText={(text) => {
                            setEmail(text);
                            setFieldError('email', null);
                          }}
                          onSubmitEditing={() => phoneRef.current?.focus()}
                          placeholder="name@example.com"
                          placeholderTextColor="#8A9695"
                          returnKeyType="next"
                          selectionColor={branding.colors.primary}
                          style={styles.input}
                          value={email}
                        />
                      </View>
                      {fieldErrors.email ? (
                        <Text style={styles.inlineError}>{fieldErrors.email}</Text>
                      ) : null}
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Số điện thoại Việt Nam *</Text>
                      <View
                        style={[styles.inputShell, fieldErrors.phone ? styles.inputShellError : null]}
                      >
                        <View style={styles.phonePrefixBadge}>
                          <Text style={styles.phonePrefixText}>+84</Text>
                        </View>
                        <TextInput
                          ref={phoneRef}
                          accessibilityLabel="Số điện thoại Việt Nam"
                          autoComplete="tel"
                          keyboardType="phone-pad"
                          onBlur={() => {
                            const normalized = normalizeVietnamPhone(phone);
                            setFieldError(
                              'phone',
                              normalized ? null : 'Số điện thoại Việt Nam chưa hợp lệ.'
                            );
                          }}
                          onChangeText={(text) => {
                            setPhone(text);
                            setFieldError('phone', null);
                          }}
                          onSubmitEditing={() => regPasswordRef.current?.focus()}
                          placeholder="0912 345 678"
                          placeholderTextColor="#8A9695"
                          returnKeyType="next"
                          selectionColor={branding.colors.primary}
                          style={styles.input}
                          value={phone}
                        />
                      </View>
                      {fieldErrors.phone ? (
                        <Text style={styles.inlineError}>{fieldErrors.phone}</Text>
                      ) : null}
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Mật khẩu *</Text>
                      <View
                        style={[
                          styles.inputShell,
                          fieldErrors.password ? styles.inputShellError : null,
                        ]}
                      >
                        <Ionicons name="lock-closed-outline" size={20} color={branding.colors.mutedText} />
                        <TextInput
                          ref={regPasswordRef}
                          accessibilityLabel="Mật khẩu"
                          autoCapitalize="none"
                          autoComplete="new-password"
                          onBlur={() => setFieldError('password', validatePasswordRule(password))}
                          onChangeText={(text) => {
                            setPassword(text);
                            setFieldError('password', null);
                          }}
                          onSubmitEditing={() => regConfirmRef.current?.focus()}
                          placeholder="8+ ký tự, gồm hoa, thường và số"
                          placeholderTextColor="#8A9695"
                          returnKeyType="next"
                          secureTextEntry={!isPasswordVisible}
                          selectionColor={branding.colors.primary}
                          style={styles.input}
                          textContentType="newPassword"
                          value={password}
                        />
                        <TouchableOpacity
                          accessibilityLabel={isPasswordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                          accessibilityRole="button"
                          hitSlop={8}
                          onPress={() => setIsPasswordVisible((v) => !v)}
                          style={styles.visibilityButton}
                        >
                          <Ionicons
                            color={branding.colors.mutedText}
                            name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                            size={20}
                          />
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.helperHint}>
                        Yêu cầu tối thiểu 8 ký tự, ít nhất 1 chữ hoa, 1 chữ thường và 1 chữ số.
                      </Text>
                      {fieldErrors.password ? (
                        <Text style={styles.inlineError}>{fieldErrors.password}</Text>
                      ) : null}
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Xác nhận mật khẩu *</Text>
                      <View
                        style={[
                          styles.inputShell,
                          fieldErrors.confirmPassword ? styles.inputShellError : null,
                        ]}
                      >
                        <Ionicons name="shield-checkmark-outline" size={20} color={branding.colors.mutedText} />
                        <TextInput
                          ref={regConfirmRef}
                          accessibilityLabel="Xác nhận mật khẩu"
                          autoCapitalize="none"
                          onBlur={() =>
                            setFieldError(
                              'confirmPassword',
                              password !== confirmPassword
                                ? 'Mật khẩu xác nhận không trùng khớp.'
                                : null
                            )
                          }
                          onChangeText={(text) => {
                            setConfirmPassword(text);
                            setFieldError('confirmPassword', null);
                          }}
                          placeholder="Nhập lại mật khẩu"
                          placeholderTextColor="#8A9695"
                          returnKeyType="done"
                          secureTextEntry={!isConfirmPasswordVisible}
                          selectionColor={branding.colors.primary}
                          style={styles.input}
                          value={confirmPassword}
                        />
                        <TouchableOpacity
                          accessibilityLabel={isConfirmPasswordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                          accessibilityRole="button"
                          hitSlop={8}
                          onPress={() => setIsConfirmPasswordVisible((v) => !v)}
                          style={styles.visibilityButton}
                        >
                          <Ionicons
                            color={branding.colors.mutedText}
                            name={isConfirmPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                            size={20}
                          />
                        </TouchableOpacity>
                      </View>
                      {fieldErrors.confirmPassword ? (
                        <Text style={styles.inlineError}>{fieldErrors.confirmPassword}</Text>
                      ) : null}
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Chọn kênh nhận mã xác thực OTP</Text>
                      <TouchableOpacity
                        accessibilityRole="radio"
                        accessibilityState={{ checked: channel === 'Email' }}
                        activeOpacity={0.85}
                        onPress={() => {
                          setChannel('Email');
                          setSuggestEmailFallback(false);
                        }}
                        style={[styles.channelCard, channel === 'Email' && styles.channelCardActive]}
                      >
                        <View style={[styles.radioDot, channel === 'Email' && styles.radioDotActive]}>
                          {channel === 'Email' ? <View style={styles.radioDotInner} /> : null}
                        </View>
                        <Ionicons
                          name="mail-unread-outline"
                          size={19}
                          color={channel === 'Email' ? '#004E58' : '#64748B'}
                        />
                        <View style={{ flex: 1 }}>
                          <View style={styles.channelTitleRow}>
                            <Text style={styles.channelTitle}>Qua địa chỉ Email</Text>
                            <View style={styles.recommendedPill}>
                              <Text style={styles.recommendedPillText}>Khuyên dùng</Text>
                            </View>
                          </View>
                          <Text style={styles.channelDesc}>Gửi mã xác thực tới hòm thư cá nhân</Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        accessibilityRole="radio"
                        accessibilityState={{ checked: channel === 'Sms' }}
                        activeOpacity={0.85}
                        onPress={() => {
                          setChannel('Sms');
                          setSuggestEmailFallback(false);
                        }}
                        style={[styles.channelCard, channel === 'Sms' && styles.channelCardActive]}
                      >
                        <View style={[styles.radioDot, channel === 'Sms' && styles.radioDotActive]}>
                          {channel === 'Sms' ? <View style={styles.radioDotInner} /> : null}
                        </View>
                        <Ionicons
                          name="chatbox-ellipses-outline"
                          size={19}
                          color={channel === 'Sms' ? '#004E58' : '#64748B'}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.channelTitle}>Qua tin nhắn SMS</Text>
                          <Text style={styles.channelDesc}>Nhận tức thì qua số điện thoại di động</Text>
                        </View>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      accessibilityRole="button"
                      activeOpacity={0.85}
                      disabled={isSubmitting || !isConfigured}
                      onPress={() => void sendRegChallenge(channel)}
                      style={[
                        styles.primaryButton,
                        (isSubmitting || !isConfigured) && styles.disabledButton,
                      ]}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <View style={styles.primaryButtonInner}>
                          <Text style={styles.primaryButtonText}>Nhận mã xác thực OTP</Text>
                          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                        </View>
                      )}
                    </TouchableOpacity>

                    {suggestEmailFallback ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => void sendRegChallenge('Email')}
                        style={[styles.switchFallbackBtn, { marginTop: 8 }]}
                      >
                        <Text style={styles.switchFallbackText}>
                          Chuyển sang gửi OTP qua Email ngay
                        </Text>
                      </TouchableOpacity>
                    ) : null}

                    <View style={styles.dividerRow}>
                      <View style={styles.dividerLine} />
                      <Text style={styles.dividerText}>Hoặc tiếp tục với</Text>
                      <View style={styles.dividerLine} />
                    </View>

                    <TouchableOpacity
                      accessibilityRole="button"
                      activeOpacity={0.82}
                      disabled={isGoogleLoading || isSubmitting}
                      onPress={() => void handleGoogleAuth()}
                      style={[styles.googleButton, isGoogleLoading && styles.disabledButton]}
                    >
                      {isGoogleLoading ? (
                        <ActivityIndicator color="#0F172A" size="small" />
                      ) : (
                        <>
                          <Ionicons name="logo-google" size={18} color="#DB4437" />
                          <Text style={styles.googleButtonText}>Đăng ký với tài khoản Google</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* SCR-AUTH-02: Xác thực mã OTP */
                  <View style={styles.formCard}>
                    <View style={styles.otpHeader}>
                      <View style={styles.otpShieldCircle}>
                        <Ionicons name="shield-checkmark-outline" size={28} color="#006874" />
                      </View>
                      <Text style={styles.otpHeading}>Nhập mã xác thực</Text>
                      <Text style={styles.otpSubtitle}>
                        Mã bảo mật 6 chữ số đã được gửi qua{' '}
                        {channel === 'Sms' ? 'tin nhắn SMS' : 'Email'} an toàn tới:
                      </Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Sửa thông tin nhận mã OTP"
                        onPress={() => {
                          setRegStep('form');
                          resetMessages();
                        }}
                        style={styles.destinationPill}
                      >
                        <Ionicons
                          name={channel === 'Sms' ? 'phone-portrait-outline' : 'mail-outline'}
                          size={15}
                          color="#004E58"
                        />
                        <Text style={styles.destinationText}>
                          {maskDestination(otpDestination, channel)}
                        </Text>
                        <Ionicons name="pencil" size={14} color="#006874" />
                      </TouchableOpacity>

                      <View style={styles.countdownPill}>
                        <Ionicons name="timer-outline" size={14} color="#006874" />
                        <Text style={styles.countdownText}>
                          {otpExpiresSec > 0
                            ? `Còn hiệu lực: ${formatMmSs(otpExpiresSec)}`
                            : 'Mã đã hết hạn — hãy gửi lại mã'}
                        </Text>
                      </View>
                    </View>

                    <OtpCodeBoxes
                      value={otpCode}
                      onChangeText={(next) => {
                        setOtpCode(next);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      hasError={Boolean(errorMessage)}
                    />

                    {errorMessage ? (
                      <View accessibilityLiveRegion="polite" style={styles.errorBanner}>
                        <Ionicons name="alert-circle" size={16} color="#93000A" />
                        <Text style={styles.errorBannerText}>{errorMessage}</Text>
                      </View>
                    ) : null}

                    <View style={styles.resendRow}>
                      <Text style={styles.resendLabel}>Chưa nhận được mã?</Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={otpResendSec > 0 || isSubmitting}
                        onPress={() => void sendRegChallenge(channel)}
                      >
                        <Text
                          style={[
                            styles.resendAction,
                            (otpResendSec > 0 || isSubmitting) && styles.resendActionDisabled,
                          ]}
                        >
                          {otpResendSec > 0 ? `Gửi lại sau (${otpResendSec}s)` : 'Gửi lại mã'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      accessibilityRole="button"
                      disabled={isSubmitting}
                      onPress={() => void sendRegChallenge(channel === 'Sms' ? 'Email' : 'Sms')}
                      style={styles.switchChannelBtn}
                    >
                      <Ionicons name="swap-horizontal" size={16} color="#006874" />
                      <Text style={styles.switchChannelText}>
                        {channel === 'Sms'
                          ? 'Đổi phương thức nhận qua Email'
                          : 'Đổi phương thức nhận qua SMS'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      accessibilityRole="button"
                      activeOpacity={0.85}
                      disabled={isSubmitting || otpCode.length !== 6}
                      onPress={() => void handleCompleteRegistration()}
                      style={[
                        styles.primaryButton,
                        (isSubmitting || otpCode.length !== 6) && styles.disabledButton,
                      ]}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <View style={styles.primaryButtonInner}>
                          <Ionicons name="checkmark-circle-outline" size={19} color="#FFFFFF" />
                          <Text style={styles.primaryButtonText}>Hoàn tất đăng ký</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {!isConfigured ? (
                  <Text style={[styles.inlineError, { textAlign: 'center', marginTop: 10 }]}>
                    Chưa cấu hình máy chủ xác thực trong .env.
                  </Text>
                ) : null}
              </>
            )}

            {!registrationSuccess ? (
              <TouchableOpacity
                accessibilityHint="Bỏ qua đăng nhập và mở bản đồ"
                accessibilityRole="button"
                activeOpacity={0.7}
                onPress={() => router.replace('/map')}
                style={styles.guestButton}
              >
                <Text style={styles.guestButtonText}>Vào trải nghiệm chế độ Khách</Text>
                <Ionicons name="arrow-forward" size={17} color={branding.colors.primary} />
              </TouchableOpacity>
            ) : null}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* SCR-AUTH-03: Google Profile Completion & Optional Phone Verification */}
      <Modal
        animationType="slide"
        transparent
        visible={Boolean(googleProfile)}
        onRequestClose={() => {
          if (!isSubmitting) setGoogleProfile(null);
        }}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.modalTopRow}>
                <View style={styles.securityBadge}>
                  <Ionicons name="shield-checkmark" size={13} color="#004E58" />
                  <Text style={styles.securityBadgeText}>Bảo mật cộng đồng</Text>
                </View>
                <TouchableOpacity
                  accessibilityLabel="Đóng"
                  accessibilityRole="button"
                  onPress={() => setGoogleProfile(null)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={20} color="#475569" />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalTitle}>Hoàn tất hồ sơ Google</Text>
              <Text style={styles.modalDesc}>
                Để hoàn tất kích hoạt tài khoản AccessMapVN, vui lòng xác nhận tên hiển thị, mật
                khẩu bảo vệ và số điện thoại xác thực (nếu có).
              </Text>

              {googleProfile ? (
                <View style={styles.googleAccountCard}>
                  <Ionicons name="logo-google" size={20} color="#DB4437" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.googleAccountName} numberOfLines={1}>
                      {googleProfile.suggestedName || googleProfile.email}
                    </Text>
                    <Text style={styles.googleAccountEmail} numberOfLines={1}>
                      {googleProfile.email}
                    </Text>
                  </View>
                  <View style={styles.linkedPill}>
                    <Text style={styles.linkedPillText}>Đã liên kết</Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Họ và tên *</Text>
                <View style={styles.inputShell}>
                  <Ionicons name="person-outline" size={19} color={branding.colors.mutedText} />
                  <TextInput
                    accessibilityLabel="Họ và tên"
                    autoCapitalize="words"
                    onChangeText={setGoogleName}
                    placeholder="Nguyễn Minh Anh"
                    placeholderTextColor="#8A9695"
                    style={styles.input}
                    value={googleName}
                  />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Mật khẩu tài khoản *</Text>
                <View style={styles.inputShell}>
                  <Ionicons name="lock-closed-outline" size={19} color={branding.colors.mutedText} />
                  <TextInput
                    accessibilityLabel="Mật khẩu tài khoản"
                    autoCapitalize="none"
                    onChangeText={setGooglePassword}
                    placeholder="8+ ký tự, gồm hoa, thường và số"
                    placeholderTextColor="#8A9695"
                    secureTextEntry={!isGooglePwVisible}
                    style={styles.input}
                    value={googlePassword}
                  />
                  <TouchableOpacity
                    accessibilityLabel={isGooglePwVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    hitSlop={8}
                    onPress={() => setIsGooglePwVisible((v) => !v)}
                    style={styles.visibilityButton}
                  >
                    <Ionicons
                      color={branding.colors.mutedText}
                      name={isGooglePwVisible ? 'eye-off-outline' : 'eye-outline'}
                      size={19}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Xác nhận mật khẩu *</Text>
                <View style={styles.inputShell}>
                  <Ionicons name="shield-checkmark-outline" size={19} color={branding.colors.mutedText} />
                  <TextInput
                    accessibilityLabel="Xác nhận mật khẩu"
                    autoCapitalize="none"
                    onChangeText={setGoogleConfirmPassword}
                    placeholder="Nhập lại mật khẩu"
                    placeholderTextColor="#8A9695"
                    secureTextEntry={!isGooglePwVisible}
                    style={styles.input}
                    value={googleConfirmPassword}
                  />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>
                  Số điện thoại nhận mã OTP{' '}
                  {googleProfile?.requiredFields.includes('phone') ? '*' : '(không bắt buộc)'}
                </Text>
                <View style={styles.phoneSendRow}>
                  <View style={[styles.inputShell, { flex: 1 }]}>
                    <View style={styles.phonePrefixBadge}>
                      <Text style={styles.phonePrefixText}>+84</Text>
                    </View>
                    <TextInput
                      accessibilityLabel="Số điện thoại nhận mã OTP"
                      keyboardType="phone-pad"
                      onChangeText={setGooglePhone}
                      placeholder="0988 123 456"
                      placeholderTextColor="#8A9695"
                      style={styles.input}
                      value={googlePhone}
                    />
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={googleSendingOtp || googleOtpResendSec > 0}
                    onPress={() => void handleSendGooglePhoneOtp()}
                    style={[
                      styles.sendOtpMiniBtn,
                      (googleSendingOtp || googleOtpResendSec > 0) && styles.disabledButton,
                    ]}
                  >
                    {googleSendingOtp ? (
                      <ActivityIndicator color="#004E58" size="small" />
                    ) : (
                      <Text style={styles.sendOtpMiniText}>
                        {googleOtpResendSec > 0
                          ? `${googleOtpResendSec}s`
                          : googlePhoneChallenge
                          ? 'Gửi lại'
                          : 'Gửi mã'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {googlePhoneChallenge ? (
                <View style={styles.fieldGroup}>
                  <View style={styles.googleOtpMetaRow}>
                    <Text style={styles.label}>Mã OTP 6 chữ số *</Text>
                    <Text style={styles.countdownText}>
                      {googleOtpExpiresSec > 0
                        ? `Hiệu lực ${formatMmSs(googleOtpExpiresSec)}`
                        : 'Hết hạn'}
                    </Text>
                  </View>
                  <OtpCodeBoxes
                    label="Mã OTP xác thực số điện thoại Google"
                    onChangeText={setGooglePhoneOtp}
                    value={googlePhoneOtp}
                  />
                </View>
              ) : null}

              {googleError ? (
                <View accessibilityLiveRegion="polite" style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={16} color="#93000A" />
                  <Text style={styles.errorBannerText}>{googleError}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => void handleSubmitGoogleProfile()}
                style={[styles.primaryButton, { marginTop: 8 }, isSubmitting && styles.disabledButton]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Xác thực & Kích hoạt tài khoản</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: branding.colors.background,
    flex: 1,
  },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  topBarTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  keyboardArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  content: {
    alignSelf: 'center',
    maxWidth: 440,
    width: '100%',
  },
  mapDecoration: {
    ...StyleSheet.absoluteFill,
  },
  mapRoad: {
    backgroundColor: '#E5EEED',
    position: 'absolute',
  },
  mapRoadHorizontal: {
    height: 18,
    left: 0,
    right: 0,
    top: '32%',
  },
  mapRoadVertical: {
    bottom: 0,
    left: '28%',
    top: 0,
    width: 18,
  },
  mapBlock: {
    backgroundColor: '#EFF6F5',
    borderRadius: 24,
    opacity: 0.85,
    position: 'absolute',
  },
  mapBlockLeft: {
    bottom: 40,
    height: 140,
    left: -20,
    width: 160,
  },
  mapBlockRight: {
    height: 180,
    right: -30,
    top: 40,
    width: 170,
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: 18,
  },
  logoFrame: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 24,
    borderWidth: 1,
    elevation: 3,
    height: 68,
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#004E58',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    width: 68,
  },
  logo: {
    height: 44,
    resizeMode: 'contain',
    width: 44,
  },
  appName: {
    color: '#004E58',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  supportingText: {
    color: '#596264',
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 320,
    textAlign: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 14,
    padding: 4,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  tabTextActive: {
    color: branding.colors.primary,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 20,
    borderWidth: 1,
    elevation: 4,
    padding: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    width: '100%',
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  sectionSubText: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 19,
    marginBottom: 16,
  },
  introBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#E6F8F5',
    borderColor: '#9FF2E4',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  introBannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#9FF2E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  introBannerTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#004E58',
    marginBottom: 2,
  },
  introBannerDesc: {
    fontSize: 12,
    color: '#115E59',
    lineHeight: 17,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#F8FAF9',
    borderColor: '#CBD5E1',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  inputShellError: {
    borderColor: '#BA1A1A',
    backgroundColor: '#FFF5F5',
  },
  phonePrefixBadge: {
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  phonePrefixText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#004E58',
  },
  input: {
    color: '#0F172A',
    flex: 1,
    fontSize: 14,
    paddingLeft: 10,
    paddingVertical: 10,
  },
  helperHint: {
    marginTop: 5,
    fontSize: 11.5,
    color: '#64748B',
    lineHeight: 16,
  },
  inlineError: {
    marginTop: 5,
    fontSize: 12,
    color: '#BA1A1A',
    fontWeight: '600',
  },
  visibilityButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -6,
  },
  forgotButton: {
    alignSelf: 'flex-end',
    marginBottom: 14,
    marginTop: -2,
    minHeight: 36,
    justifyContent: 'center',
  },
  linkText: {
    color: branding.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  channelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAF9',
    padding: 12,
    marginBottom: 8,
    minHeight: 58,
  },
  channelCardActive: {
    backgroundColor: '#E6F8F5',
    borderColor: '#006874',
  },
  radioDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDotActive: {
    borderColor: '#006874',
  },
  radioDotInner: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#006874',
  },
  channelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  channelTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  recommendedPill: {
    backgroundColor: '#9FF2E4',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  recommendedPillText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#004E58',
  },
  channelDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: branding.colors.primary,
    borderRadius: 14,
    elevation: 2,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    shadowColor: branding.colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    marginTop: 4,
  },
  primaryButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  disabledButton: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFDAD6',
    borderColor: '#FECDD3',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  errorBannerText: {
    flex: 1,
    color: '#93000A',
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
  },
  switchFallbackBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  switchFallbackText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#004E58',
    textDecorationLine: 'underline',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  dividerText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
  },
  googleButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  otpHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  otpShieldCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#E6F8F5',
    borderWidth: 1.5,
    borderColor: '#9FF2E4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  otpHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  otpSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 10,
  },
  destinationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 10,
  },
  destinationText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  countdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E6F8F5',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  countdownText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#006874',
  },
  otpContainer: {
    position: 'relative',
    marginBottom: 10,
  },
  otpHiddenInput: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2,
    opacity: 0.01,
    fontSize: 22,
    color: 'transparent',
    backgroundColor: 'transparent',
  },
  otpBoxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  otpBox: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAF9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxFilled: {
    borderColor: '#006874',
    backgroundColor: '#FFFFFF',
  },
  otpBoxActive: {
    borderColor: '#004E58',
    borderWidth: 2,
  },
  otpBoxError: {
    borderColor: '#BA1A1A',
    backgroundColor: '#FFF5F5',
  },
  otpBoxDigit: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  resendLabel: {
    fontSize: 12.5,
    color: '#64748B',
  },
  resendAction: {
    fontSize: 13,
    fontWeight: '800',
    color: '#006874',
  },
  resendActionDisabled: {
    color: '#94A3B8',
  },
  switchChannelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    marginBottom: 8,
  },
  switchChannelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#006874',
  },
  guestButton: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 18,
    minHeight: 44,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  guestButtonText: {
    color: branding.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  modalTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#9FF2E4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  securityBadgeText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#004E58',
  },
  modalCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  modalDesc: {
    fontSize: 12.5,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 14,
  },
  googleAccountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAF9',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  googleAccountName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  googleAccountEmail: {
    fontSize: 12,
    color: '#64748B',
  },
  linkedPill: {
    backgroundColor: '#E6F8F5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  linkedPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#006874',
  },
  phoneSendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sendOtpMiniBtn: {
    minHeight: 48,
    minWidth: 78,
    borderRadius: 14,
    backgroundColor: '#9FF2E4',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  sendOtpMiniText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#004E58',
  },
  googleOtpMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  successCard: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 22,
  },
  successBadgeCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#DCFCE7',
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 13.5,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
});
