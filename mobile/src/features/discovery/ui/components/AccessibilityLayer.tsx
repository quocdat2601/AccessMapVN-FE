import React, { useMemo } from 'react';
import type { PlaceDto } from '../../model';

interface AccessibilityLayerProps {
  MapLibreGL: any;
  places: PlaceDto[];
  onSelectPlace?: (placeId: string) => void;
  onClusterPress?: (lng: number, lat: number) => void;
  selectedPlaceId?: string | null;
}

function categoryToSpriteIcon(category: string): string {
  switch (category?.toLowerCase()) {
    case 'cafe':
    case 'coffee':
      return 'cafe_11';
    case 'restaurant':
    case 'food_court':
    case 'food':
      return 'restaurant_11';
    case 'fast_food':
      return 'fast_food';
    case 'bar':
    case 'pub':
      return 'bar';
    case 'bakery':
      return 'bakery';

    case 'mall':
    case 'market':
    case 'supermarket':
    case 'convenience':
    case 'shop':
    case 'store':
      return 'shop_11';
    case 'clothes':
    case 'clothing_store':
    case 'department_store':
      return 'clothing_store';

    case 'hospital':
    case 'clinic':
    case 'doctors':
      return 'hospital_11';
    case 'pharmacy':
      return 'pharmacy';
    case 'dentist':
      return 'dentist';

    case 'school':
    case 'university':
    case 'college':
      return 'school';
    case 'library':
      return 'library';

    case 'transit':
    case 'bus_station':
    case 'bus':
      return 'bus';

    case 'hotel':
    case 'motel':
    case 'hostel':
    case 'guest_house':
    case 'lodging':
      return 'lodging';

    case 'attraction':
    case 'museum':
      return 'museum';
    case 'cinema':
      return 'cinema';
    case 'park':
      return 'park';

    case 'bank':
    case 'atm':
      return 'bank_11';

    case 'police':
      return 'police';
    case 'post_office':
      return 'post';

    case 'parking':
      return 'parking';

    case 'charging_station':
    case 'fuel':
      return 'fuel_11';

    case 'hairdresser':
      return 'hairdresser';

    case 'place_of_worship':
      return 'place_of_worship';

    case 'apartment':
    case 'residential':
    case 'building':
      return 'building_11';

    default:
      return 'marker_11';
  }
}

export function normalizeScore(score: number): number {
  if (isNaN(score) || score < 0) return -1;
  if (score > 5) return score / 100; // e.g. 85 -> 0.85, 98 -> 0.98
  if (score > 1) return score / 5;   // e.g. 4.0 -> 0.80
  return score;                      // e.g. 0.85 -> 0.85
}

export function getAccessibilityColor(normalizedScore: number): string {
  if (normalizedScore >= 0.7) return '#10b981'; // Xanh lá: Tiếp cận tốt (đối chiếu QCVN 10:2024/BXD)
  if (normalizedScore >= 0.4) return '#f59e0b'; // Vàng cam: Tiếp cận một phần
  return '#ef4444'; // Đỏ: Khó tiếp cận / có chướng ngại
}

export function AccessibilityLayer({
  MapLibreGL,
  places,
  onSelectPlace,
  selectedPlaceId,
}: AccessibilityLayerProps) {
  const geojson: any = useMemo(() => ({
    type: 'FeatureCollection',
    features: places.map((p) => {
      const rawScore = Number(p.accessibility_score);
      const normalizedScore = normalizeScore(rawScore);
      const isRated = normalizedScore >= 0;
      const accessColor = isRated ? getAccessibilityColor(normalizedScore) : '#94a3b8';
      const icon = categoryToSpriteIcon(p.category);
      const reviewCount = Number(p.review_count ?? 0);
      const reportCount = Number(p.report_count ?? 0);
      const badgeText = reportCount > 0 ? `!${reportCount}` : reviewCount > 0 ? `${reviewCount}` : '';

      return {
        type: 'Feature' as const,
        id: p.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [p.lng, p.lat],
        },
        properties: {
          id: p.id,
          name: p.name,
          category: p.category,
          score: normalizedScore,
          isRated,
          accessColor,
          icon,
          reviewCount,
          reportCount,
          hasConflictPin: reportCount > 0,
          badgeText,
          isSelected: p.id === selectedPlaceId,
        },
      };
    }),
  }), [places, selectedPlaceId]);

  if (!MapLibreGL) return null;

  return (
    <MapLibreGL.GeoJSONSource
      id="accessibility-places"
      data={geojson}
      cluster={false}
      hitbox={{ top: 38, bottom: 38, left: 38, right: 38 }}
      onPress={(e: any) => {
        const features = e?.nativeEvent?.features ?? e?.features;
        const feature = features?.[0];
        if (!feature) return;

        if (feature?.properties?.id) {
          onSelectPlace?.(feature.properties.id as string);
        }
      }}
    >
      {/* 1. Unrated places: Secondary white-and-slate pin at zoom >= 13 */}
      <MapLibreGL.Layer
        type="circle"
        id="places-unrated-dot"
        minZoomLevel={13}
        filter={['all', ['==', ['get', 'isRated'], false], ['!=', ['get', 'isSelected'], true]]}
        paint={{
          circleRadius: [
            'interpolate',
            ['linear'],
            ['zoom'],
            13, 5,
            15, 7,
            17, 9,
          ],
          circleColor: '#ffffff',
          circleOpacity: 0.96,
          circleStrokeWidth: 2,
          circleStrokeColor: '#475569',
        }}
      />

      {/* 1b. Unrated places: Inner slate center dot */}
      <MapLibreGL.Layer
        type="circle"
        id="places-unrated-center"
        minZoomLevel={13}
        filter={['all', ['==', ['get', 'isRated'], false], ['!=', ['get', 'isSelected'], true]]}
        paint={{
          circleRadius: [
            'interpolate',
            ['linear'],
            ['zoom'],
            13, 2.2,
            15, 3.2,
            17, 4,
          ],
          circleColor: '#64748b',
          circleOpacity: 1,
        }}
      />

      {/* 2. Unrated places label: high-contrast slate name at zoom >= 15 */}
      <MapLibreGL.Layer
        type="symbol"
        id="places-unrated-symbols"
        minZoomLevel={15}
        filter={['==', ['get', 'isRated'], false]}
        layout={{
          textField: ['get', 'name'],
          textSize: 10.5,
          textFont: ['Noto Sans Regular'],
          textOffset: [0, 1.2],
          textAnchor: 'top',
          textMaxWidth: 8,
          textOptional: true,
          textAllowOverlap: false,
        }}
        paint={{
          textColor: '#334155',
          textHaloColor: '#ffffff',
          textHaloWidth: 1.8,
          textHaloBlur: 0.5,
        }}
      />

      {/* 3. Rated / Verified Places: Outer White Badge with Accessibility Ring */}
      <MapLibreGL.Layer
        type="circle"
        id="places-rated-badge"
        minZoomLevel={11}
        filter={['all', ['==', ['get', 'isRated'], true], ['!=', ['get', 'isSelected'], true]]}
        paint={{
          circleRadius: [
            'interpolate',
            ['linear'],
            ['zoom'],
            11, 7,
            14, 11,
            16, 14,
          ],
          circleColor: '#ffffff',
          circleOpacity: 0.98,
          circleStrokeWidth: [
            'interpolate',
            ['linear'],
            ['zoom'],
            11, 2.5,
            14, 3,
            16, 3.5,
          ],
          circleStrokeColor: ['get', 'accessColor'],
        }}
      />

      {/* 4. Rated / Verified Places: Inner Colored Center Dot */}
      <MapLibreGL.Layer
        type="circle"
        id="places-rated-center"
        minZoomLevel={11}
        filter={['all', ['==', ['get', 'isRated'], true], ['!=', ['get', 'isSelected'], true]]}
        paint={{
          circleRadius: [
            'interpolate',
            ['linear'],
            ['zoom'],
            11, 3.5,
            14, 5.5,
            16, 7.5,
          ],
          circleColor: ['get', 'accessColor'],
          circleOpacity: 1,
        }}
      />

      {/* 5. Selected Place: Prominent Highlight Ring */}
      <MapLibreGL.Layer
        type="circle"
        id="places-selected-badge"
        minZoomLevel={11}
        filter={['==', ['get', 'isSelected'], true]}
        paint={{
          circleRadius: [
            'interpolate',
            ['linear'],
            ['zoom'],
            11, 10,
            14, 14,
            16, 17,
          ],
          circleColor: '#ffffff',
          circleOpacity: 1,
          circleStrokeWidth: 4,
          circleStrokeColor: ['get', 'accessColor'],
        }}
      />

      {/* 6. Rated / Verified Places: Bold Name Label (visible from zoom 14 without overlap) */}
      <MapLibreGL.Layer
        type="symbol"
        id="places-rated-label"
        minZoomLevel={14}
        filter={['==', ['get', 'isRated'], true]}
        layout={{
          textField: ['get', 'name'],
          textSize: 11,
          textFont: ['Noto Sans Bold'],
          textOffset: [0, 1.4],
          textAnchor: 'top',
          textMaxWidth: 10,
          textAllowOverlap: false,
          textIgnorePlacement: false,
        }}
        paint={{
          textColor: '#0f172a',
          textHaloColor: '#ffffff',
          textHaloWidth: 2,
          textHaloBlur: 0.5,
        }}
      />

      {/* 7. Rated Places: Compact Review / Report Count Badge */}
      <MapLibreGL.Layer
        type="symbol"
        id="places-rated-count-badge"
        minZoomLevel={13}
        filter={['all', ['==', ['get', 'isRated'], true], ['!=', ['get', 'badgeText'], '']]}
        layout={{
          textField: ['get', 'badgeText'],
          textSize: 10,
          textFont: ['Noto Sans Bold'],
          textOffset: [0.95, -0.95],
          textAnchor: 'center',
          textAllowOverlap: true,
        }}
        paint={{
          textColor: ['case', ['get', 'hasConflictPin'], '#be123c', '#004e58'],
          textHaloColor: '#ffffff',
          textHaloWidth: 2,
        }}
      />
    </MapLibreGL.GeoJSONSource>
  );
}
