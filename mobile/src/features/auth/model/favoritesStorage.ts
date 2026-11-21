import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@/shared/api/client';
import type { PlaceDto } from '@/entities/place';

const FAVORITES_STORAGE_KEY = '@accessmap_saved_favorites_v1';

export interface SavedFavoritePlace {
  id: string;
  name: string;
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
  let localItems: SavedFavoritePlace[] = [];
  try {
    const raw = await AsyncStorage.getItem(FAVORITES_STORAGE_KEY);
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
    if (serverItems && serverItems.length > 0) {
      const byId = new Map<string, SavedFavoritePlace>();
      for (const item of localItems) {
        byId.set(item.id, item);
      }
      for (const s of serverItems) {
        const id = String(s.locationId ?? s.id ?? '');
        if (!id) continue;
        if (!byId.has(id)) {
          byId.set(id, {
            id,
            name: String(s.name ?? 'Địa điểm đã lưu'),
            category: String(s.category ?? 'other'),
            address: s.address ?? null,
            lng: typeof (s.longitude ?? s.lng) === 'number' ? (s.longitude ?? s.lng) : undefined,
            lat: typeof (s.latitude ?? s.lat) === 'number' ? (s.latitude ?? s.lat) : undefined,
            hasRamp: Boolean(s.hasRamp ?? s.has_ramp),
            hasAccessibleElevator: Boolean(s.hasAccessibleElevator ?? s.has_elevator),
            hasAccessibleRestroom: Boolean(s.hasAccessibleRestroom ?? s.has_accessible_restroom),
            hasTactilePaving: Boolean(s.hasTactilePaving ?? s.has_tactile_paving),
            doorWidthOk: Boolean(s.doorWidthOk ?? s.door_width_ok),
            accessibilityScore: typeof s.accessibilityScore === 'number' ? s.accessibilityScore : 0.85,
            savedAt: String(s.createdAt ?? new Date().toISOString()),
          });
        }
      }
      const merged = Array.from(byId.values());
      await AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(merged));
      notify(merged);
      return merged;
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
  const current = await loadSavedFavorites(false);
  const exists = current.some((item) => item.id === place.id);
  let next: SavedFavoritePlace[];

  if (exists) {
    next = current.filter((item) => item.id !== place.id);
  } else {
    next = [placeDtoToFavorite(place), ...current];
  }

  await AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
  notify(next);

  if (isLoggedIn) {
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
  }

  return { isFavorite: !exists, items: next };
}

export async function removeSavedFavoriteById(
  placeId: string,
  isLoggedIn: boolean
): Promise<SavedFavoritePlace[]> {
  const current = await loadSavedFavorites(false);
  const next = current.filter((item) => item.id !== placeId);
  await AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
  notify(next);

  if (isLoggedIn) {
    void syncFavoriteServer(placeId, true).catch(() => {});
  }

  return next;
}
