import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon from 'leaflet/dist/images/marker-icon.png';
// Fix default marker icons (webpack/vite strips the default paths)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/**
 * Dark basemap, key-free.
 *
 * This used to be CARTO's `basemaps.cartocdn.com/dark_all`, which now needs an
 * API key — but it does not *fail* without one: it answers 200 with a 2.5 KB
 * tile reading "API KEY REQUIRED" stamped across it, so the map kept "working"
 * while showing nothing but that watermark on every tile.
 *
 * Esri's Dark Gray Canvas needs no key and no referrer. Note the axis order:
 * ArcGIS serves `/{z}/{row}/{col}`, i.e. y before x, and it has no retina (`{r}`)
 * or subdomain (`{s}`) variants — getting that order wrong yields tiles from the
 * wrong place rather than an error, which is the trap this comment exists for.
 */
const DARK_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';
/**
 * This basemap is only rendered to z16. Past it ArcGIS still answers 200, but
 * with a *light* "no data at this zoom" notice tile, which flashes white against
 * the dark theme. Capping the native zoom makes Leaflet upscale z16 instead.
 */
const MAX_NATIVE_ZOOM = 16;

interface Coordinate {
  lat: number;
  lng: number;
  label: string;
}

interface MapCardProps {
  coordinates: Coordinate[];
  title?: string;
  height?: number;
}

function InvalidateSizeOnMount() {
  const map = useMap();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const delays = [100, 300, 600, 1000, 1800];
    const timers = delays.map((d) => setTimeout(() => map.invalidateSize(), d));
    return () => timers.forEach(clearTimeout);
  }, [map]);
  return null;
}

export function MapCard({
  coordinates,
  title = '📍 Physical Location Map',
  height = 350,
}: MapCardProps) {
  if (coordinates.length === 0) return null;

  const center: [number, number] =
    coordinates.length === 1
      ? [coordinates[0].lat, coordinates[0].lng]
      : [
          coordinates.reduce((s, c) => s + c.lat, 0) / coordinates.length,
          coordinates.reduce((s, c) => s + c.lng, 0) / coordinates.length,
        ];

  const zoom = coordinates.length === 1 ? 12 : undefined;

  const polylinePositions: [number, number][] =
    coordinates.length > 1 ? coordinates.map((c) => [c.lat, c.lng]) : [];

  return (
    <div className="result-card map-card full-width">
      <div className="card-label">{title}</div>
      <MapContainer
        center={center}
        zoom={zoom ?? 5}
        style={{ height: `${height}px`, borderRadius: '10px', marginTop: '8px' }}
        scrollWheelZoom
        bounds={
          coordinates.length > 1
            ? L.latLngBounds(coordinates.map((c) => [c.lat, c.lng]))
            : undefined
        }
        boundsOptions={{ padding: [40, 40] }}
      >
        <TileLayer url={DARK_TILE_URL} attribution={ATTRIBUTION} maxNativeZoom={MAX_NATIVE_ZOOM} />
        {coordinates.map((c) => (
          <Marker key={`${c.lat}-${c.lng}-${c.label}`} position={[c.lat, c.lng]}>
            <Popup>
              <strong>{c.label}</strong>
              <br />
              Lat: {c.lat}
              <br />
              Lng: {c.lng}
            </Popup>
          </Marker>
        ))}
        {polylinePositions.length > 1 && (
          <Polyline
            positions={polylinePositions}
            pathOptions={{ color: '#818cf8', weight: 3, dashArray: '5, 10' }}
          />
        )}
        <InvalidateSizeOnMount />
      </MapContainer>
    </div>
  );
}
