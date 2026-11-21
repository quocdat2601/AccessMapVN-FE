import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/shared/lib/supabase';
import { apiClient, resolveServiceUrl } from '@/shared/api/client';

export interface MediaUploadResponse {
  url: string;
  relativeUrl: string;
  fileName: string;
  size: number;
}

export interface ProposedUploadScope {
  kind: 'BuildingGeneral' | 'Entrance' | 'Floor' | 'Unit';
  label: string;
  floorNumber?: number;
}

export interface DuplicateSubmissionCandidate {
  locationId: string;
  name: string;
  address?: string | null;
}

export interface DuplicateLocationChallenge {
  status: string;
  action: string;
  candidates: DuplicateSubmissionCandidate[];
  confirmationToken: string;
}

export interface IdentityConfirmationInput {
  decision: 'UseExisting' | 'ConfirmDistinct';
  confirmationToken: string;
  reason: string;
}

export interface UploadCaptureContext {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationId?: string;
  textDescription?: string;
  proposedScope?: ProposedUploadScope;
}

export interface UploadedMediaMetadata {
  mediaId: string;
  suggestionCorrelationId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uploadedMediaMetadataByUrl = new Map<string, UploadedMediaMetadata>();

const FEATURE_TAG_TO_BACKEND_TYPE: Record<string, string> = {
  exterior_ramp_present: 'Ramp',
  elevator_present: 'Elevator',
  door_width_ok: 'EntranceDoor',
  door_detected: 'EntranceDoor',
  door_width_compliant: 'EntranceDoor',
  accessible_restroom_sign: 'AccessibleRestroom',
};

export function getUploadedMediaMetadata(url: string): UploadedMediaMetadata | undefined {
  return uploadedMediaMetadataByUrl.get(url);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64.replace(/\s/g, ''));
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function resolveBase64(uri: string, existingBase64?: string): Promise<string | undefined> {
  if (existingBase64 && existingBase64.trim().length > 0) {
    return existingBase64;
  }
  if (typeof FileReader === 'undefined') {
    return undefined;
  }
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (typeof result === 'string') {
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.substring(comma + 1) : result);
        } else {
          resolve(undefined);
        }
      };
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

function getMediaFileInfo(uri: string): { ext: string; mimeType: string; isVideo: boolean } {
  const cleanPath = uri.split('?')[0].toLowerCase();
  if (cleanPath.endsWith('.mp4')) {
    return { ext: 'mp4', mimeType: 'video/mp4', isVideo: true };
  }
  if (cleanPath.endsWith('.mov')) {
    return { ext: 'mov', mimeType: 'video/quicktime', isVideo: true };
  }
  if (cleanPath.endsWith('.webm')) {
    return { ext: 'webm', mimeType: 'video/webm', isVideo: true };
  }
  if (cleanPath.endsWith('.png')) {
    return { ext: 'png', mimeType: 'image/png', isVideo: false };
  }
  return { ext: 'jpg', mimeType: 'image/jpeg', isVideo: false };
}

/**
 * Uploads a local photo/video via Contract B Upload-Intents (AccessMapVN-Backend)
 * or falls back to Supabase Cloud Storage / legacy backend multipart upload.
 * Returns the uploaded media URL.
 */
async function tryUploadViaBackendIntent(
  fileBody: Uint8Array | ArrayBuffer,
  mimeType: string,
  isVideo: boolean,
  captureContext?: UploadCaptureContext
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const lat = captureContext?.latitude ?? 10.7736;
  const lng = captureContext?.longitude ?? 106.7011;
  const hasLocationUuid = Boolean(
    captureContext?.locationId && UUID_RE.test(captureContext.locationId)
  );

  try {
    const intent = await apiClient.post<{
      mediaId: string;
      uploadUrl: string;
      method?: string;
      headers?: Record<string, string>;
    }>(
      '/api/v1/media/upload-intents',
      {
        mediaType: isVideo ? 'video' : 'photo',
        contentType: mimeType,
        fileSizeBytes: fileBody.byteLength,
        captureMetadata: {
          source: 'Camera',
          capturedAt: nowIso,
          position: {
            latitude: lat,
            longitude: lng,
            accuracyMeters: captureContext?.accuracyMeters ?? 5,
            fixRecordedAt: nowIso,
          },
          ...(hasLocationUuid
            ? { locationId: captureContext!.locationId }
            : { proposedPlacePosition: { latitude: lat, longitude: lng } }),
        },
        proposedScope: captureContext?.proposedScope ?? { kind: 'BuildingGeneral', label: 'Whole place' },
      },
      { auth: 'optional' }
    );

    if (!intent?.mediaId || !intent?.uploadUrl) return null;

    const putRes = await fetch(intent.uploadUrl, {
      method: intent.method || 'PUT',
      headers: intent.headers ?? { 'Content-Type': mimeType },
      body: fileBody as BodyInit,
    });
    if (!putRes.ok) return null;

    // Best-effort owned pre-scan & AI suggestions correlation for AccessMapVN-Backend
    await apiClient
      .post(
        '/api/v1/submissions/pre-scan',
        {
          mediaIds: [intent.mediaId],
          textDescription: captureContext?.textDescription || undefined,
        },
        { auth: 'optional' }
      )
      .catch(() => null);

    const suggRes = await apiClient
      .post<{ correlationId?: string }>(
        '/api/v1/ai/suggestions',
        {
          mediaIds: [intent.mediaId],
          textDescription: captureContext?.textDescription || undefined,
        },
        { auth: 'optional' }
      )
      .catch(() => null);

    const cleanUrl = intent.uploadUrl.split('?')[0];
    const meta: UploadedMediaMetadata = {
      mediaId: intent.mediaId,
      suggestionCorrelationId: suggRes?.correlationId,
    };
    uploadedMediaMetadataByUrl.set(cleanUrl, meta);
    uploadedMediaMetadataByUrl.set(intent.mediaId, meta);
    return cleanUrl;
  } catch {
    return null;
  }
}

export async function uploadMediaToBackend(
  uri: string,
  base64?: string,
  captureContext?: UploadCaptureContext
): Promise<string> {
  const { ext, mimeType, isVideo } = getMediaFileInfo(uri);
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
  const effectiveBase64 = isVideo ? undefined : await resolveBase64(uri, base64);

  let binaryBody: Uint8Array | ArrayBuffer | undefined;
  if (effectiveBase64) {
    binaryBody = base64ToUint8Array(effectiveBase64);
  } else {
    try {
      const localRes = await fetch(uri);
      if (localRes.ok) binaryBody = await localRes.arrayBuffer();
    } catch {
      // Local file fetch unavailable
    }
  }

  // 0. Try AccessMapVN-Backend signed upload-intent flow when binary is readable
  if (binaryBody && binaryBody.byteLength > 0) {
    const intentUrl = await tryUploadViaBackendIntent(
      binaryBody,
      mimeType,
      isVideo,
      captureContext
    );
    if (intentUrl) return intentUrl;
  }

  // 1. Try Supabase Storage first (Cloud storage accessible by everyone globally)
  if (isSupabaseConfigured && (isVideo || effectiveBase64)) {
    try {
      const fileBody = binaryBody;
      if (fileBody) {
        const { data, error } = await supabase.storage
          .from('contributions-media')
          .upload(fileName, fileBody, {
            contentType: mimeType,
            cacheControl: '31536000',
            upsert: true,
          });

        if (!error && data) {
          const { data: publicUrlData } = supabase.storage
            .from('contributions-media')
            .getPublicUrl(fileName);

          if (publicUrlData?.publicUrl) {
            return publicUrlData.publicUrl;
          }
        }
      }
    } catch (e) {
      console.warn('[uploadMediaToBackend] Supabase storage upload failed, falling back to backend', e);
    }
  }

  // 2. Fallback to backend upload if Supabase Storage failed or offline
  const baseUrl = resolveServiceUrl(5256, process.env.EXPO_PUBLIC_API_URL);
  let authHeaders: Record<string, string> = {};
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (token) {
      authHeaders = { Authorization: `Bearer ${token}` };
    }
  } catch {
    // Continue without auth header if session lookup fails
  }

  if (!isVideo && effectiveBase64) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/media/upload-base64`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          fileName,
          base64Data: effectiveBase64,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as MediaUploadResponse;
        if (data.url) return data.url;
      }
    } catch (e) {
      console.warn('[uploadMediaToBackend] Base64 backend upload failed, trying FormData fallback', e);
    }
  }

  // 3. FormData fallback
  try {
    const formData = new FormData();
    const cleanUri = Platform.OS === 'android' ? uri : uri.replace('file://', '');

    formData.append('file', {
      uri: cleanUri,
      name: fileName,
      type: mimeType,
    } as any);

    const response = await fetch(`${baseUrl}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        Accept: 'application/json',
      },
      body: formData,
    });

    if (response.ok) {
      const data = (await response.json()) as MediaUploadResponse;
      if (data.url) return data.url;
    }
  } catch (e) {
    console.warn('[uploadMediaToBackend] FormData upload failed', e);
  }

  // Fallback: return original uri if all uploads failed
  return uri;
}

export async function submitContributionToBackend(
  legacyPayload: {
    client_submission_id: string;
    location_id: string;
    feature_tags: string[];
    gps_lat: number;
    gps_lng: number;
    text_description?: string;
    [key: string]: unknown;
  },
  options: {
    uploadedUrl: string;
    locationName?: string;
    proposedScope?: ProposedUploadScope;
    identityConfirmation?: IdentityConfirmationInput;
  }
): Promise<{
  submission_id?: string;
  submission_code?: string;
  status?: string;
  points_awarded?: number;
  message?: string;
  conflict_challenge?: DuplicateLocationChallenge;
}> {
  const meta = getUploadedMediaMetadata(options.uploadedUrl);
  const operationId = `submission-create:${legacyPayload.client_submission_id}`;

  if (meta?.mediaId) {
    const claims: Array<{
      featureType: string;
      claimedStatus: string;
      description?: string;
    }> = [];
    const seenTypes = new Set<string>();
    for (const tag of legacyPayload.feature_tags || []) {
      const mapped = FEATURE_TAG_TO_BACKEND_TYPE[tag];
      if (!mapped || seenTypes.has(mapped)) continue;
      seenTypes.add(mapped);
      claims.push({
        featureType: mapped,
        claimedStatus: 'Available',
        description: legacyPayload.text_description || undefined,
      });
    }
    if (claims.length === 0) {
      claims.push({
        featureType: 'Ramp',
        claimedStatus: 'Unknown',
        description: legacyPayload.text_description || undefined,
      });
    }

    const hasUuidLocation = UUID_RE.test(legacyPayload.location_id);
    const contractBBody = {
      mediaIds: [meta.mediaId],
      accessibilityClaims: claims,
      ...(hasUuidLocation
        ? { locationId: legacyPayload.location_id }
        : {
            placeName: options.locationName || 'Địa điểm khảo sát',
            latitude: legacyPayload.gps_lat,
            longitude: legacyPayload.gps_lng,
            positionSource: 'ContributorProposal',
          }),
      proposedScope: options.proposedScope ?? { kind: 'BuildingGeneral', label: 'Whole place' },
      textDescription: legacyPayload.text_description || undefined,
      ...(meta.suggestionCorrelationId
        ? { suggestionCorrelationId: meta.suggestionCorrelationId }
        : {}),
      ...(options.identityConfirmation
        ? { identityConfirmation: options.identityConfirmation }
        : {}),
    };

    try {
      const res = await apiClient.postIdempotent<{
        submissionId?: string;
        submissionCode?: string;
        status?: string;
        message?: string;
      }>('/api/v1/submissions', contractBBody, operationId, { auth: 'required' });

      return {
        submission_id: res?.submissionId,
        submission_code: res?.submissionCode,
        status: res?.status,
        points_awarded: 0,
        message: res?.message,
      };
    } catch (err: any) {
      if (
        err?.status === 409 &&
        err?.data &&
        Array.isArray(err.data.candidates) &&
        typeof err.data.confirmationToken === 'string'
      ) {
        return {
          conflict_challenge: err.data as DuplicateLocationChallenge,
        };
      }
      throw err;
    }
  }

  return await apiClient.post<{
    submission_id?: string;
    submissionId?: string;
    submission_code?: string;
    submissionCode?: string;
    status?: string;
    points_awarded?: number;
  }>('/api/v1/submissions', legacyPayload, {
    idempotencyKey: legacyPayload.client_submission_id,
  });
}
