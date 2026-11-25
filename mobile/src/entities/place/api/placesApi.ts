import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { apiClient } from '@/shared/api/client';
import type { BoundingBox, GeocodeResult, PlaceDto, PoiCategory } from '../model/types';

function nullableBoolean(...values: unknown[]): boolean | null {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null);
  return value == null ? null : Boolean(value);
}

function isVideoUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  return /\.(mp4|mov|webm|mkv|avi|m4v)(\?|$)/i.test(rawUrl);
}

function mapPlaceDto(p: any, defaultScoreOnHasData = 80): PlaceDto {
  const featuresList = Array.isArray(p.features) ? p.features : [];
  const hasRealAccessibility = Boolean(p.hasAccessibilityData || featuresList.length > 0);

  // Fallback: Mock feature tiếp cận cho địa điểm thật (từ OSM/Search) chưa có khảo sát
  // Dùng id hash để các thuộc tính cố định theo từng quán, phục vụ test filter
  const charSum = String(p.locationId ?? p.id ?? '0')
    .split('')
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const mockRamp = charSum % 2 === 0;
  const mockDoor = charSum % 3 === 0;
  const mockElevator = charSum % 4 === 0;
  const mockRestroom = charSum % 5 === 0;
  const mockScore = 55 + (charSum % 40);

  const hasFeature = (typeStr: string) =>
    featuresList.some(
      (f: any) =>
        String(f.featureType ?? '').toLowerCase() === typeStr.toLowerCase() &&
        String(f.currentStatus ?? '').toLowerCase() === 'available'
    );

  const hasRamp = hasRealAccessibility
    ? hasFeature('Ramp') || Boolean(p.hasRamp ?? p.has_ramp)
    : mockRamp;
  const hasElevator = hasRealAccessibility
    ? hasFeature('Elevator') || Boolean(p.hasAccessibleElevator ?? p.has_accessible_elevator ?? p.has_elevator)
    : mockElevator;
  const hasRestroom = hasRealAccessibility
    ? hasFeature('AccessibleRestroom') || Boolean(p.hasAccessibleRestroom ?? p.has_accessible_restroom)
    : mockRestroom;
  const hasDoor = hasRealAccessibility
    ? hasFeature('EntranceDoor') || nullableBoolean(p.doorWidthOk, p.door_width_ok)
    : mockDoor;

  const rawScore =
    typeof p.accessibilityScore === 'number'
      ? p.accessibilityScore
      : typeof p.accessibility_score === 'number'
      ? p.accessibility_score
      : hasRealAccessibility
      ? defaultScoreOnHasData
      : mockScore;

  return {
    id: String(p.locationId ?? p.id ?? ''),
    name: String(p.name ?? ''),
    category: (p.category ?? 'other') as PoiCategory,
    address: p.address ?? null,
    phone: p.phone ?? null,
    website: p.website ?? null,
    opening_hours: p.openingHours ?? p.opening_hours ?? null,
    brand: p.brand ?? null,
    operator: p.operator ?? null,
    lng: Number(p.longitude ?? p.lng ?? 0),
    lat: Number(p.latitude ?? p.lat ?? 0),
    has_ramp: hasRamp,
    has_elevator: hasElevator,
    has_tactile_paving: Boolean(p.hasTactilePaving ?? p.has_tactile_paving),
    has_accessible_restroom: hasRestroom,
    door_width_ok: hasDoor,
    accessibility_score: rawScore,
    accessibility_note: p.accessibilityNote ?? p.accessibility_note ?? featuresList[0]?.qcvnSummaryText ?? null,
    floor_level: p.floorLevel ?? p.floor_level ?? null,
    building_id: p.buildingId ?? p.building_id ?? null,
    scope: p.scope ?? null,
    has_accessible_elevator: hasElevator,
    has_accessible_parking: Boolean(p.hasAccessibleParking ?? p.has_accessible_parking),
    has_step_free: Boolean(
      p.hasStepFree ?? p.has_step_free ?? hasRamp ?? p.has_ramp ?? p.doorWidthOk ?? p.door_width_ok
    ),
    last_verified_at: featuresList[0]?.verifiedAt ?? p.lastVerifiedAt ?? p.last_verified_at ?? null,
    legacy_feature_values: {
      ramp: featuresList.length > 0 ? hasRamp : nullableBoolean(p.hasRamp, p.has_ramp),
      entranceDoor: hasDoor,
      elevator:
        featuresList.length > 0
          ? hasElevator
          : nullableBoolean(p.hasAccessibleElevator, p.has_accessible_elevator, p.has_elevator),
      accessibleRestroom:
        featuresList.length > 0 ? hasRestroom : nullableBoolean(p.hasAccessibleRestroom, p.has_accessible_restroom),
      tactilePaving: nullableBoolean(p.hasTactilePaving, p.has_tactile_paving),
    },
  };
}

async function fetchSearchPage(
  lat: number,
  lng: number,
  radiusMeters: number,
  limit: number,
  cursor?: string
): Promise<{ items: any[]; nextCursor?: string } | null> {
  const raw = await apiClient.get<any>('/api/v1/locations/search', {
    params: {
      lat,
      lng,
      radiusMeters,
      limit,
      source: 'accessmap',
      ...(cursor ? { cursor } : {}),
    },
    auth: 'none',
  });
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : null;
  if (!items) return null;
  const nextCursor =
    typeof raw?.nextCursor === 'string' && raw.nextCursor.trim() ? raw.nextCursor : undefined;
  return { items, nextCursor };
}

export async function fetchPlacesInBBox(
  bbox: BoundingBox,
  zoomLevel: number = 14,
  categories?: string[]
): Promise<PlaceDto[]> {
  const PAGE_LIMIT = 20;
  const centerLat = (bbox.north + bbox.south) / 2;
  const centerLng = (bbox.east + bbox.west) / 2;
  const latSpan = Math.abs(bbox.north - bbox.south);
  const lngSpan = Math.abs(bbox.east - bbox.west);

  let items: any[] | null = null;
  try {
    if (latSpan > 0.018) {
      const points: Array<[number, number]> = [
        [centerLat, centerLng],
        [bbox.south + latSpan * 0.25, bbox.west + lngSpan * 0.25],
        [bbox.south + latSpan * 0.25, bbox.west + lngSpan * 0.75],
        [bbox.south + latSpan * 0.75, bbox.west + lngSpan * 0.25],
        [bbox.south + latSpan * 0.75, bbox.west + lngSpan * 0.75],
      ];
      const quadrantRadius = Math.min(2500, Math.max(500, Math.round((latSpan * 111320) / 3)));
      const settled = await Promise.allSettled(
        points.map(([lat, lng]) => fetchSearchPage(lat, lng, quadrantRadius, PAGE_LIMIT))
      );
      const fulfilled = settled.filter(
        (res): res is PromiseFulfilledResult<{ items: any[]; nextCursor?: string } | null> =>
          res.status === 'fulfilled'
      );
      if (fulfilled.length === 0) {
        const firstRejected = settled.find((res) => res.status === 'rejected') as
          | PromiseRejectedResult
          | undefined;
        throw firstRejected?.reason ?? new Error('ALL_SEARCH_POINTS_FAILED');
      }

      const collected: any[] = [];
      let hasValidArray = false;
      for (const res of fulfilled) {
        if (res.value) {
          hasValidArray = true;
          collected.push(...res.value.items);
        }
      }
      items = hasValidArray ? collected : null;
    } else {
      const MAX_PAGES = 3;
      const radiusMeters = Math.min(5000, Math.max(500, Math.round((latSpan * 111320) / 2)));
      const collected: any[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        let pageResult: { items: any[]; nextCursor?: string } | null;
        try {
          pageResult = await fetchSearchPage(centerLat, centerLng, radiusMeters, PAGE_LIMIT, cursor);
        } catch (err) {
          if (page === 0) throw err;
          break;
        }

        if (!pageResult) {
          if (page === 0) items = null;
          break;
        }

        collected.push(...pageResult.items);
        items = collected;

        if (!pageResult.nextCursor || pageResult.items.length < PAGE_LIMIT) break;
        cursor = pageResult.nextCursor;
      }
    }
  } catch {
    const legacyRaw = await apiClient.get<any[]>('/api/v1/places', {
      params: {
        minLng: bbox.west,
        minLat: bbox.south,
        maxLng: bbox.east,
        maxLat: bbox.north,
        zoomLevel,
        categories: categories?.join(','),
      },
    });
    items = Array.isArray(legacyRaw) ? legacyRaw : null;
  }

  if (!items) return [];

  const deduped = new Map<string, PlaceDto>();
  for (const rawItem of items) {
    const mapped = mapPlaceDto(rawItem, 80);
    if (mapped.id && !deduped.has(mapped.id)) {
      deduped.set(mapped.id, mapped);
    }
  }
  return Array.from(deduped.values());
}

export async function fetchPlaceById(id: string): Promise<PlaceDto | null> {
  try {
    let p: any = null;
    try {
      p = await apiClient.get<any>(`/api/v1/locations/${encodeURIComponent(id)}`, {
        auth: 'none',
      });
    } catch {
      p = await apiClient.get<any>(`/api/v1/places/${encodeURIComponent(id)}`);
    }
    if (!p || !(p.locationId ?? p.id)) return null;
    return mapPlaceDto(p, 85);
  } catch {
    return null;
  }
}

const geocodeCache = new Map<string, string>();
const geocodeInFlight = new Map<string, Promise<string | null>>();

const LEADING_PLUS_CODE_RE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3},?\s*/i;
const EXACT_PLUS_CODE_RE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}$/i;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

function cleanDisplayName(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/,\s*\d{5,6}/g, '')
    .replace(/,\s*Việt Nam$/i, '')
    .trim();
}

function formatNativeGeocode(geo: Location.LocationGeocodedAddress): string | null {
  if (geo.formattedAddress) {
    const cleanedFormatted = cleanDisplayName(geo.formattedAddress.replace(LEADING_PLUS_CODE_RE, ''));
    if (cleanedFormatted.includes(',')) {
      return cleanedFormatted;
    }
  }

  const streetNumber = geo.streetNumber?.trim() ?? '';
  const street = geo.street?.trim() ?? '';
  const combinedStreet = [streetNumber, street].filter(Boolean).join(' ').trim();
  const safeName = geo.name?.trim() ?? '';
  const fallbackName = safeName && !EXACT_PLUS_CODE_RE.test(safeName) ? safeName : '';
  const streetPart = combinedStreet || fallbackName;

  const candidates = [streetPart, geo.district, geo.subregion, geo.city || geo.region];
  const parts: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && !parts.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      parts.push(trimmed);
    }
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

function raceFirstNonEmpty(tasks: Array<Promise<string | null>>): Promise<string | null> {
  if (tasks.length === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settledCount = 0;
    let done = false;

    for (const task of tasks) {
      task
        .then((value) => {
          const trimmed = typeof value === 'string' ? value.trim() : '';
          if (!done && trimmed) {
            done = true;
            resolve(trimmed);
          }
        })
        .catch(() => {})
        .finally(() => {
          settledCount += 1;
          if (!done && settledCount === tasks.length) {
            done = true;
            resolve(null);
          }
        });
    }
  });
}

function formatNominatim(data: any): string {
  const addr = data?.address;
  const displayName = data?.display_name as string;
  if (!addr) return cleanDisplayName(displayName) || displayName;

  const num = addr.house_number ? `${addr.house_number} ` : '';
  const road = addr.road || addr.pedestrian || addr.footway || '';
  const streetPart = `${num}${road}`.trim();

  const locality = addr.residential || '';
  const ward = addr.suburb || addr.quarter || addr.neighbourhood || addr.ward || addr.hamlet || '';
  const district = addr.city_district || addr.district || addr.county || '';
  const city = addr.city || addr.town || addr.province || addr.state || '';

  const parts = [streetPart, locality, ward, district, city].filter(Boolean);
  if (parts.length >= 2) {
    return parts.join(', ');
  }
  return cleanDisplayName(displayName) || parts.join(', ');
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;

  const existing = geocodeInFlight.get(cacheKey);
  if (existing) return existing;

  const pending = (async () => {
    const httpAbort = new AbortController();
    try {
      const tasks: Array<Promise<string | null>> = [];

      if (Platform?.OS === 'android' || Platform?.OS === 'ios') {
        tasks.push(
          Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
            .then((list) => (list?.[0] ? formatNativeGeocode(list[0]) : null))
            .catch(() => null)
        );
      }

      tasks.push(
        fetchWithTimeout(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
          {
            headers: {
              'User-Agent': 'AccessMapVN/1.0 (https://accessmap.vn)',
              'Accept-Language': 'vi,en;q=0.9',
            },
          },
          2500,
          httpAbort.signal
        )
          .then(async (res) => {
            if (!res.ok) return null;
            const data = await res.json();
            return formatNominatim(data) || null;
          })
          .catch(() => null)
      );

      tasks.push(
        fetchWithTimeout(
          `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`,
          { headers: { 'User-Agent': 'AccessMapVN/1.0' } },
          2500,
          httpAbort.signal
        )
          .then(async (res) => {
            if (!res.ok) return null;
            const data = await res.json();
            const p = data?.features?.[0]?.properties;
            if (!p) return null;
            const num = p.housenumber ? `${p.housenumber} ` : '';
            const street = p.street || p.name || '';
            const streetPart = `${num}${street}`.trim();
            const locality = p.locality || '';
            const district = p.district && p.district !== locality ? p.district : '';
            const city = p.city || p.state || '';
            const parts = [streetPart, locality, district, city].filter(Boolean);
            return parts.length >= 2 ? parts.join(', ') : null;
          })
          .catch(() => null)
      );

      const formatted = await raceFirstNonEmpty(tasks);
      if (formatted) {
        if (geocodeCache.size > 200) {
          const firstKey = geocodeCache.keys().next().value;
          if (firstKey) geocodeCache.delete(firstKey);
        }
        geocodeCache.set(cacheKey, formatted);
      }
      return formatted;
    } finally {
      httpAbort.abort();
      geocodeInFlight.delete(cacheKey);
    }
  })();

  geocodeInFlight.set(cacheKey, pending);
  return pending;
}

const forwardGeocodeCache = new Map<string, GeocodeResult[]>();

export async function forwardGeocode(
  query: string,
  options?: { lat?: number; lng?: number; limit?: number }
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  const limit = options?.limit ?? 5;
  const cacheKey = `${trimmed.toLowerCase()}_${limit}_${options?.lat?.toFixed(2) ?? ''}_${options?.lng?.toFixed(2) ?? ''}`;
  if (forwardGeocodeCache.has(cacheKey)) {
    return forwardGeocodeCache.get(cacheKey)!;
  }

  try {
    let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&countrycodes=vn&limit=${limit}&addressdetails=1`;
    if (options?.lat != null && options?.lng != null) {
      const d = 0.2;
      url += `&viewbox=${options.lng - d},${options.lat + d},${options.lng + d},${options.lat - d}`;
    }

    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent': 'AccessMapVN/1.0 (https://accessmap.vn)',
          'Accept-Language': 'vi,en;q=0.9',
        },
      },
      2500
    );

    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const results: GeocodeResult[] = data.map((item: any) => ({
      id: String(item.place_id ?? `${item.lat},${item.lon}`),
      name: item.name || item.display_name?.split(',')[0] || trimmed,
      displayName: item.display_name || '',
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      type: item.type || item.class,
    }));

    if (results.length === 0) {
      return [];
    }

    if (forwardGeocodeCache.size > 100) {
      const firstKey = forwardGeocodeCache.keys().next().value;
      if (firstKey) forwardGeocodeCache.delete(firstKey);
    }
    forwardGeocodeCache.set(cacheKey, results);

    return results;
  } catch {
    return [];
  }
}

export async function searchAccessMapPlaces(
  query: string,
  options?: { lat?: number; lng?: number; limit?: number }
): Promise<PlaceDto[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  try {
    let items: any[] | null = null;
    try {
      const raw = await apiClient.get<any>('/api/v1/locations/search', {
        params: {
          q: trimmed,
          lat: options?.lat,
          lng: options?.lng,
          limit: options?.limit ?? 10,
          source: 'accessmap',
        },
        auth: 'none',
      });
      items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : null;
    } catch {
      const legacyRaw = await apiClient.get<any[]>('/api/v1/places/search', {
        params: {
          q: trimmed,
          lat: options?.lat,
          lng: options?.lng,
          limit: options?.limit ?? 6,
        },
        auth: 'none',
      });
      items = Array.isArray(legacyRaw) ? legacyRaw : null;
    }

    if (!items) return [];

    return items.map((p) => mapPlaceDto(p, 80)).filter((p) => Boolean(p.id));
  } catch {
    return [];
  }
}

export async function unifiedSearch(
  query: string,
  options?: { lat?: number; lng?: number; limit?: number }
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  const [accessMapResults, osmResults] = await Promise.all([
    searchAccessMapPlaces(trimmed, options),
    forwardGeocode(trimmed, options),
  ]);

  const accessMapFormatted: GeocodeResult[] = accessMapResults.map((p) => ({
    id: p.id,
    name: p.name,
    displayName: p.address || 'Địa điểm trong AccessMap',
    lat: p.lat,
    lng: p.lng,
    type: p.category,
    source: 'accessmap',
    placeDto: p,
  }));

  const osmFormatted: GeocodeResult[] = osmResults.map((item) => ({
    ...item,
    source: 'osm',
  }));

  return [...accessMapFormatted, ...osmFormatted];
}

export interface PlaceEvidenceDto {
  id: string;
  title: string;
  subtitle?: string;
  badge: string;
  imageUrl: string;
  mediaType?: 'photo' | 'video';
  videoUrl?: string | null;
  featureTags?: string[];
  createdAt?: string;
}

function formatApprovedFeatureTitle(featureType?: string): string {
  switch (featureType) {
    case 'EntranceDoor':
      return 'Cửa vào';
    case 'Ramp':
      return 'Ram dốc';
    case 'Elevator':
      return 'Thang máy';
    case 'AccessibleRestroom':
      return 'Nhà vệ sinh';
    default:
      return featureType || 'Tiện ích tiếp cận';
  }
}

export async function fetchPlaceEvidence(placeId: string): Promise<PlaceEvidenceDto[]> {
  try {
    try {
      const detail = await apiClient.get<any>(`/api/v1/locations/${encodeURIComponent(placeId)}`, {
        auth: 'none',
      });
      if (detail && Array.isArray(detail.features)) {
        const evidenceList: PlaceEvidenceDto[] = [];
        for (const feat of detail.features) {
          if (Array.isArray(feat.approvedMedia)) {
            for (const m of feat.approvedMedia) {
              const url = String(m.url ?? '');
              const isVideo =
                m.mediaType === 'video' ||
                String(m.contentType ?? '').startsWith('video/') ||
                isVideoUrl(url);
              evidenceList.push({
                id: String(m.mediaId ?? ''),
                title: formatApprovedFeatureTitle(feat.featureType),
                subtitle: feat.qcvnSummaryText ?? 'Đối chiếu QCVN 10:2024/BXD',
                badge: feat.currentStatus === 'Available' ? 'Đã xác minh' : 'Đang xử lý',
                imageUrl: url,
                mediaType: isVideo ? 'video' : 'photo',
                videoUrl: isVideo ? url : undefined,
                featureTags: [feat.featureType].filter(Boolean),
                createdAt: m.observedAt ?? feat.verifiedAt,
              });
            }
          }
        }
        return evidenceList;
      }
    } catch {
      // Fallback to legacy endpoint when running against monorepo backend
    }

    const raw = await apiClient.get<PlaceEvidenceDto[]>(`/api/v1/places/${encodeURIComponent(placeId)}/evidence`);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
