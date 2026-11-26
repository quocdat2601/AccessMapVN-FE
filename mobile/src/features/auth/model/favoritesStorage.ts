import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@/shared/api/client';
import type { PlaceDto } from '@/entities/place';

const FAVORITES_STORAGE_PREFIX = '@accessmap_saved_favorites_v2_';

let activeUserId: string | null = null;

function getStorageKey(): string | null {
  return activeUserId ? `${FAVORITES_STORAGE_PREFIX}${activeUserId}` : null;
}

export function setFavoritesUserId(userId: string | null): void {
  const next = userId?.trim() || null;
  if (activeUserId === next) return;
  activeUserId = next;
  if (!activeUserId) {
    notify([]);
  }
}

export type FavoriteCategoryPreset = 'home' | 'work' | 'food' | 'health' | 'other';

export interface SavedFavoritePlace {
  id: string;
  name: string;
  customName?: string | null;
  customCategory?: FavoriteCategoryPreset | null;
  category: string;
  address?: string | null;
  lng?: number;
  lat?: number;
  hasRamp?: boolean | null;
  hasAccessibleElevator?: boolean | null;
  hasAccessibleRestroom?: boolean | null;
  hasTactilePaving?: boolean | null;
  doorWidthOk?: boolean | null;
  accessibilityScore?: number | null;
  savedAt: string;
}

type Listener = (items: SavedFavoritePlace[]) => void;
const listeners = new Set<Listener>();

function notify(items: SavedFavoritePlace[]) {
  listeners.forEach((fn) => fn(items));
}

export function subscribeFavorites(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function placeDtoToFavorite(place: PlaceDto): SavedFavoritePlace {
  return {
    id: place.id,
    name: place.name,
    category: place.category || 'other',
    address: place.address ?? null,
    lng: place.lng,
    lat: place.lat,
    hasRamp: Boolean(place.has_ramp),
    hasAccessibleElevator: Boolean(place.has_elevator || place.has_accessible_elevator),
    hasAccessibleRestroom: Boolean(place.has_accessible_restroom),
    hasTactilePaving: Boolean(place.has_tactile_paving),
    doorWidthOk: Boolean(place.door_width_ok),
    accessibilityScore: place.accessibility_score,
    savedAt: new Date().toISOString(),
  };
}

export async function loadSavedFavorites(syncWithServer = false): Promise<SavedFavoritePlace[]> {
  const storageKey = getStorageKey();
  if (!storageKey) {
    return [];
  }

  let localItems: SavedFavoritePlace[] = [];
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        localItems = parsed;
      }
    }
  } catch {
    localItems = [];
  }

  if (!syncWithServer) {
    return localItems;
  }

  try {
    let serverItems: any[] | null = null;
    try {
      const raw = await apiClient.get<any>('/api/v1/me/favorites', { auth: 'optional' });
      serverItems = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : null;
    } catch {
      const legacy = await apiClient.get<any[]>('/api/v1/users/me/favorites', { auth: 'optional' });
      serverItems = Array.isArray(legacy) ? legacy : null;
    }
    if (serverItems) {
      const localById = new Map<string, SavedFavoritePlace>(
        localItems.map((item) => [item.id, item])
      );
      const byId = new Map<string, SavedFavoritePlace>();
      for (const s of serverItems) {
        const id = String(s.locationId ?? s.id ?? '');
        if (!id) continue;
        const local = localById.get(id);
        const serverName = typeof s.name === 'string' ? s.name.trim() : '';
        const resolvedName =
          serverName && serverName !== 'Địa điểm đã lưu'
            ? serverName
            : local?.name && local.name !== 'Địa điểm đã lưu'
              ? local.name
              : 'Địa điểm đã lưu';
        byId.set(id, {
          id,
          name: resolvedName,
          customName: local?.customName ?? null,
          customCategory: local?.customCategory ?? null,
          category: String(s.category ?? local?.category ?? 'other'),
          address: s.address ?? local?.address ?? null,
          lng: typeof (s.longitude ?? s.lng) === 'number' ? (s.longitude ?? s.lng) : local?.lng,
          lat: typeof (s.latitude ?? s.lat) === 'number' ? (s.latitude ?? s.lat) : local?.lat,
          hasRamp: s.hasRamp ?? s.has_ramp ?? local?.hasRamp ?? false,
          hasAccessibleElevator: s.hasAccessibleElevator ?? s.has_elevator ?? local?.hasAccessibleElevator ?? false,
          hasAccessibleRestroom: s.hasAccessibleRestroom ?? s.has_accessible_restroom ?? local?.hasAccessibleRestroom ?? false,
          hasTactilePaving: s.hasTactilePaving ?? s.has_tactile_paving ?? local?.hasTactilePaving ?? false,
          doorWidthOk: s.doorWidthOk ?? s.door_width_ok ?? local?.doorWidthOk ?? false,
          accessibilityScore:
            typeof s.accessibilityScore === 'number'
              ? s.accessibilityScore
              : local?.accessibilityScore ?? null,
          savedAt: String(s.createdAt ?? local?.savedAt ?? new Date().toISOString()),
        });
      }
      const merged = Array.from(byId.values());
      // Hydrate any server-only item missing name/address from place details
      const hydrated = await Promise.all(
        merged.map(async (item) => {
          if (item.name !== 'Địa điểm đã lưu' && item.address) return item;
          try {
            const detail = await apiClient.get<any>(`/api/v1/locations/${encodeURIComponent(item.id)}`, {
              auth: 'optional',
            });
            if (detail && typeof detail.name === 'string' && detail.name.trim()) {
              const feats = Array.isArray(detail.features) ? detail.features : [];
              const hasAvail = (type: string) =>
                feats.some((f: any) => f?.featureType === type && f?.currentStatus === 'Available');
              return {
                ...item,
                name: detail.name.trim(),
                address: detail.formattedAddress ?? detail.address ?? item.address,
                category: detail.category ?? item.category,
                lat: typeof detail.latitude === 'number' ? detail.latitude : item.lat,
                lng: typeof detail.longitude === 'number' ? detail.longitude : item.lng,
                hasRamp: feats.length > 0 ? hasAvail('Ramp') : item.hasRamp,
                hasAccessibleElevator: feats.length > 0 ? hasAvail('Elevator') : item.hasAccessibleElevator,
                hasAccessibleRestroom: feats.length > 0 ? hasAvail('AccessibleRestroom') : item.hasAccessibleRestroom,
                hasTactilePaving: feats.length > 0 ? hasAvail('TactilePaving') : item.hasTactilePaving,
                doorWidthOk: feats.length > 0 ? hasAvail('EntranceDoor') : item.doorWidthOk,
                accessibilityScore:
                  detail.hasAccessibilityData && (item.accessibilityScore == null || item.accessibilityScore < 0)
                    ? 80
                    : item.accessibilityScore,
              };
            }
          } catch {
            // Keep existing item if detail fetch fails
          }
          return item;
        })
      );
      await AsyncStorage.setItem(storageKey, JSON.stringify(hydrated));
      notify(hydrated);
      return hydrated;
    }
  } catch {
    // Fallback to local favorites when offline or server endpoint not restarted yet
  }

  return localItems;
}

async function syncFavoriteServer(placeId: string, exists: boolean, payload?: Record<string, unknown>) {
  const encodedId = encodeURIComponent(placeId);
  if (exists) {
    await apiClient.delete(`/api/v1/me/favorites/${encodedId}`, { auth: 'optional' }).catch(() =>
      apiClient.delete(`/api/v1/users/me/favorites/${encodedId}`, { auth: 'optional' })
    );
    return;
  }
  await apiClient.put(`/api/v1/me/favorites/${encodedId}`, undefined, { auth: 'optional' }).catch(() =>
    apiClient.post(`/api/v1/users/me/favorites/${encodedId}`, payload, { auth: 'optional' })
  );
}

export async function toggleSavedFavorite(
  place: PlaceDto,
  isLoggedIn: boolean
): Promise<{ isFavorite: boolean; items: SavedFavoritePlace[] }> {
  const storageKey = getStorageKey();
  if (!isLoggedIn || !storageKey) {
    return { isFavorite: false, items: [] };
  }
  const current = await loadSavedFavorites(false);
  const exists = current.some((item) => item.id === place.id);
  let next: SavedFavoritePlace[];

  if (exists) {
    next = current.filter((item) => item.id !== place.id);
  } else {
    next = [placeDtoToFavorite(place), ...current];
  }

  await AsyncStorage.setItem(storageKey, JSON.stringify(next));
  notify(next);

  void syncFavoriteServer(place.id, exists, {
    name: place.name,
    category: place.category,
    address: place.address,
    lng: place.lng,
    lat: place.lat,
    hasRamp: place.has_ramp,
    hasAccessibleElevator: place.has_elevator || place.has_accessible_elevator,
    hasTactilePaving: place.has_tactile_paving,
    hasAccessibleRestroom: place.has_accessible_restroom,
    doorWidthOk: place.door_width_ok,
    accessibilityScore: place.accessibility_score,
  }).catch(() => {});

  return { isFavorite: !exists, items: next };
}

export async function removeSavedFavoriteById(
  placeId: string,
  isLoggedIn: boolean
): Promise<SavedFavoritePlace[]> {
  const storageKey = getStorageKey();
  if (!isLoggedIn || !storageKey) {
    return [];
  }
  const current = await loadSavedFavorites(false);
  const next = current.filter((item) => item.id !== placeId);
  await AsyncStorage.setItem(storageKey, JSON.stringify(next));
  notify(next);

  void syncFavoriteServer(placeId, true).catch(() => {});

  return next;
}

export async function updateSavedFavoriteMeta(
  placeId: string,
  patch: { customName?: string | null; customCategory?: FavoriteCategoryPreset | null }
): Promise<SavedFavoritePlace[]> {
  const storageKey = getStorageKey();
  if (!storageKey) {
    return [];
  }
  const current = await loadSavedFavorites(false);
  const next = current.map((item) =>
    item.id === placeId
      ? {
          ...item,
          customName: patch.customName !== undefined ? patch.customName : item.customName,
          customCategory: patch.customCategory !== undefined ? patch.customCategory : item.customCategory,
        }
      : item
  );
  await AsyncStorage.setItem(storageKey, JSON.stringify(next));
  notify(next);
  return next;
}

// --- Pending Map Focus & Session Filter Memory ---

type MapFocusListener = (place: SavedFavoritePlace) => void;
const mapFocusListeners = new Set<MapFocusListener>();
let pendingFavoriteMapFocus: SavedFavoritePlace | null = null;

export function requestFavoriteMapFocus(place: SavedFavoritePlace): void {
  pendingFavoriteMapFocus = place;
  mapFocusListeners.forEach((fn) => fn(place));
}

export function consumePendingFavoriteMapFocus(): SavedFavoritePlace | null {
  const item = pendingFavoriteMapFocus;
  pendingFavoriteMapFocus = null;
  return item;
}

export function subscribeFavoriteMapFocus(listener: MapFocusListener): () => void {
  mapFocusListeners.add(listener);
  return () => {
    mapFocusListeners.delete(listener);
  };
}

const sessionFiltersByUser = new Map<string, unknown>();

export function getSessionAccessibilityFilters<T>(userId: string | null | undefined): T | undefined {
  if (!userId) return undefined;
  return sessionFiltersByUser.get(userId) as T | undefined;
}

export function setSessionAccessibilityFilters<T>(userId: string | null | undefined, filters: T): void {
  if (!userId) return;
  sessionFiltersByUser.set(userId, filters);
}

export function clearSessionAccessibilityFilters(userId?: string | null): void {
  if (userId) {
    sessionFiltersByUser.delete(userId);
  } else {
    sessionFiltersByUser.clear();
  }
}
