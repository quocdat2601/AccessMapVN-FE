import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPlacesInBBox, type BoundingBox, type PlaceDto } from '@/entities/place';

export function useNearbyPlaces(bbox: BoundingBox | null) {
  const [places, setPlaces] = useState<PlaceDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheRef = useRef<Map<string, PlaceDto>>(new Map());
  const lastFetchedBox = useRef<BoundingBox | null>(null);
  const lastFetchCappedRef = useRef<boolean>(false);

  const selectedPlace = places.find((p) => p.id === selectedId) ?? null;

  const fetchPlaces = useCallback(async (box: BoundingBox) => {
    const latSpan = Math.abs(box.north - box.south);
    const lngSpan = Math.abs(box.east - box.west);
    const prevBox = lastFetchedBox.current;

    if (prevBox) {
      if (!lastFetchCappedRef.current) {
        // Sparse area: all venues inside prevBox were returned, skip if still inside
        if (
          box.north <= prevBox.north &&
          box.south >= prevBox.south &&
          box.east <= prevBox.east &&
          box.west >= prevBox.west
        ) {
          return;
        }
      } else {
        // Dense area hit result cap: refetch whenever user pans significantly or zooms in
        const prevLatSpan = Math.abs(prevBox.north - prevBox.south);
        const prevLngSpan = Math.abs(prevBox.east - prevBox.west);
        const newCenterLat = (box.north + box.south) / 2;
        const newCenterLng = (box.east + box.west) / 2;
        const prevCenterLat = (prevBox.north + prevBox.south) / 2;
        const prevCenterLng = (prevBox.east + prevBox.west) / 2;

        const barelyMoved =
          Math.abs(newCenterLat - prevCenterLat) < latSpan * 0.15 &&
          Math.abs(newCenterLng - prevCenterLng) < lngSpan * 0.15;
        const notZoomedIn = latSpan >= prevLatSpan * 0.7 && lngSpan >= prevLngSpan * 0.7;

        if (barelyMoved && notZoomedIn) {
          return;
        }
      }
    }

    const requestBox: BoundingBox =
      latSpan > 0.018
        ? box
        : {
            north: box.north + latSpan * 0.25,
            south: box.south - latSpan * 0.25,
            east: box.east + lngSpan * 0.25,
            west: box.west - lngSpan * 0.25,
          };

    setLoading(true);
    setError(null);
    try {
      const data = await fetchPlacesInBBox(requestBox);
      const isCapped = data.length >= 20;
      lastFetchCappedRef.current = isCapped;
      lastFetchedBox.current = isCapped ? box : requestBox;

      // Accumulative merge: keep existing loaded places so they never disappear or flash while panning
      data.forEach((p) => cacheRef.current.set(p.id, p));

      // LRU eviction if cache exceeds 1200 venues
      if (cacheRef.current.size > 1200) {
        const excess = cacheRef.current.size - 1000;
        const keys = cacheRef.current.keys();
        for (let i = 0; i < excess; i++) {
          const k = keys.next().value;
          if (k) cacheRef.current.delete(k);
        }
      }

      setPlaces(Array.from(cacheRef.current.values()));
    } catch {
      // Keep existing cached places and retry on next region change
      setError('Không thể tải địa điểm gần đây');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (bbox) {
      fetchPlaces(bbox);
    } else {
      // Keep previously cached places before first bbox settles
      setPlaces(Array.from(cacheRef.current.values()));
      lastFetchedBox.current = null;
      lastFetchCappedRef.current = false;
    }
  }, [bbox, fetchPlaces]);

  const refresh = useCallback(() => {
    lastFetchedBox.current = null;
    lastFetchCappedRef.current = false;
    if (bbox) {
      fetchPlaces(bbox);
    }
  }, [bbox, fetchPlaces]);

  return {
    places,
    selectedPlace,
    selectedId,
    selectPlace: setSelectedId,
    loading,
    error,
    refresh,
  };
}
