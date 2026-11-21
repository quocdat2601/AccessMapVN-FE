import { apiClient } from '@/shared/api/client';
import {
  fallbackGeocodeFromMocks,
  fallbackReverseGeocodeFromMocks,
} from '../lib/geocodeFallback';
import { MOCK_S901_PLACES } from '../model/mockS901Places';
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
  const hasFeature = (typeStr: string) =>
    featuresList.some(
      (f: any) =>
        String(f.featureType ?? '').toLowerCase() === typeStr.toLowerCase() &&
        String(f.currentStatus ?? '').toLowerCase() === 'available'
    );

  const hasRamp = hasFeature('Ramp') || Boolean(p.hasRamp ?? p.has_ramp);
  const hasElevator =
    hasFeature('Elevator') || Boolean(p.hasAccessibleElevator ?? p.has_accessible_elevator ?? p.has_elevator);
  const hasRestroom =
    hasFeature('AccessibleRestroom') || Boolean(p.hasAccessibleRestroom ?? p.has_accessible_restroom);
  const hasDoor = hasFeature('EntranceDoor') || nullableBoolean(p.doorWidthOk, p.door_width_ok);

  const rawScore =
    typeof p.accessibilityScore === 'number'
      ? p.accessibilityScore
      : typeof p.accessibility_score === 'number'
      ? p.accessibility_score
      : p.hasAccessibilityData || featuresList.length > 0
      ? defaultScoreOnHasData
      : -1;

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

function filterMockPlacesInBBox(bbox: BoundingBox): PlaceDto[] {
  const inBox = MOCK_S901_PLACES.filter(
    (p) => p.lat >= bbox.south && p.lat <= bbox.north && p.lng >= bbox.west && p.lng <= bbox.east
  );
  return inBox.length > 0 ? inBox : MOCK_S901_PLACES;
}

export async function fetchPlacesInBBox(
  bbox: BoundingBox,
  zoomLevel: number = 14,
  categories?: string[]
): Promise<PlaceDto[]> {
  const mockMatches = filterMockPlacesInBBox(bbox);
  try {
    const centerLat = (bbox.north + bbox.south) / 2;
    const centerLng = (bbox.east + bbox.west) / 2;
    const radiusMeters = Math.min(
      5000,
      Math.max(500, Math.round((Math.abs(bbox.north - bbox.south) * 111320) / 2))
    );

    let items: any[] | null = null;
    try {
      const raw = await apiClient.get<any>('/api/v1/locations/search', {
        params: {
          lat: centerLat,
          lng: centerLng,
          radiusMeters,
          limit: 30,
          source: 'accessmap',
        },
        auth: 'none',
      });
      items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : null;
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

    if (!items) return mockMatches;

    const mapped = items.map((p) => mapPlaceDto(p, 80)).filter((p) => Boolean(p.id));
    const existingIds = new Set(mapped.map((m) => m.id));
    for (const mock of mockMatches) {
      if (!existingIds.has(mock.id)) {
        mapped.push(mock);
      }
    }
    return mapped;
  } catch {
    return mockMatches;
  }
}

export async function fetchPlaceById(id: string): Promise<PlaceDto | null> {
  const mockMatch = MOCK_S901_PLACES.find((m) => m.id === id);
  if (mockMatch) return mockMatch;
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

function cleanDisplayName(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/,\s*\d{5,6}/g, '')
    .replace(/,\s*Việt Nam$/i, '')
    .trim();
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
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  try {
    const photonRes = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`, {
      headers: { 'User-Agent': 'AccessMapVN/1.0' },
      signal: AbortSignal.timeout(900),
    });
    if (photonRes.ok) {
      const data = await photonRes.json();
      const p = data?.features?.[0]?.properties;
      if (p) {
        const num = p.housenumber ? `${p.housenumber} ` : '';
        const street = p.street || p.name || '';
        const streetPart = `${num}${street}`.trim();
        const locality = p.locality || '';
        const district = p.district && p.district !== locality ? p.district : '';
        const city = p.city || p.state || '';
        const parts = [streetPart, locality, district, city].filter(Boolean);
        if (parts.length >= 2) {
          const formatted = parts.join(', ');
          geocodeCache.set(cacheKey, formatted);
          return formatted;
        }
      }
    }
  } catch {
    // Fallback to Nominatim
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AccessMapVN/1.0 (https://accessmap.vn)',
        'Accept-Language': 'vi,en;q=0.9',
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return fallbackReverseGeocodeFromMocks(lat, lng);
    const data = await res.json();
    const formatted = formatNominatim(data);
    if (formatted) {
      if (geocodeCache.size > 200) {
        const firstKey = geocodeCache.keys().next().value;
        if (firstKey) geocodeCache.delete(firstKey);
      }
      geocodeCache.set(cacheKey, formatted);
      return formatted;
    }
    return fallbackReverseGeocodeFromMocks(lat, lng);
  } catch {
    return fallbackReverseGeocodeFromMocks(lat, lng);
  }
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

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AccessMapVN/1.0 (https://accessmap.vn)',
        'Accept-Language': 'vi,en;q=0.9',
      },
      signal: AbortSignal.timeout(2500),
    });

    if (!res.ok) return fallbackGeocodeFromMocks(trimmed, limit);
    const data = await res.json();
    if (!Array.isArray(data)) return fallbackGeocodeFromMocks(trimmed, limit);

    const results: GeocodeResult[] = data.map((item: any) => ({
      id: String(item.place_id ?? `${item.lat},${item.lon}`),
      name: item.name || item.display_name?.split(',')[0] || trimmed,
      displayName: item.display_name || '',
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      type: item.type || item.class,
    }));

    if (results.length === 0) {
      return fallbackGeocodeFromMocks(trimmed, limit);
    }

    if (forwardGeocodeCache.size > 100) {
      const firstKey = forwardGeocodeCache.keys().next().value;
      if (firstKey) forwardGeocodeCache.delete(firstKey);
    }
    forwardGeocodeCache.set(cacheKey, results);

    return results;
  } catch {
    return fallbackGeocodeFromMocks(trimmed, limit);
  }
}

export async function searchAccessMapPlaces(
  query: string,
  options?: { lat?: number; lng?: number; limit?: number }
): Promise<PlaceDto[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  const qLower = trimmed.toLowerCase();
  const localMocks = MOCK_S901_PLACES.filter(
    (m) =>
      m.name.toLowerCase().includes(qLower) ||
      (m.address && m.address.toLowerCase().includes(qLower)) ||
      (m.brand && m.brand.toLowerCase().includes(qLower)) ||
      m.category.toLowerCase().includes(qLower)
  );

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

    if (!items) return localMocks;

    const mapped = items.map((p) => mapPlaceDto(p, 80)).filter((p) => Boolean(p.id));
    const existingIds = new Set(mapped.map((m) => m.id));
    return [...localMocks.filter((m) => !existingIds.has(m.id)), ...mapped];
  } catch {
    return localMocks;
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
                title: feat.featureType ?? 'Tiện ích tiếp cận',
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
