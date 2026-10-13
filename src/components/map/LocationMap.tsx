import { useEffect, useMemo } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";

import "leaflet/dist/leaflet.css";

/**
 * Shared OpenStreetMap view. Used by the owner (restaurant point + delivery
 * rings) and by the customer (delivery pin at checkout). Browser-only — always
 * load it through `MapPicker`, never import it directly from a route.
 */

export interface MapCircle {
  innerM: number;
  outerM: number;
  label: string;
  color: string;
}

export interface LocationMapProps {
  center: { lat: number; lng: number };
  /** Draggable / clickable pin. */
  marker?: { lat: number; lng: number } | null;
  /** Fixed restaurant point, drawn as the centre of the rings. */
  origin?: { lat: number; lng: number } | null;
  circles?: MapCircle[];
  zoom?: number;
  onPick?: (lat: number, lng: number) => void;
  height?: number;
}

function pinIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C6.3 0 0 6.3 0 14c0 10 14 26 14 26s14-16 14-26C28 6.3 21.7 0 14 0z" fill="${color}"/><circle cx="14" cy="14" r="5" fill="#fff"/></svg>`,
    iconSize: [28, 40],
    iconAnchor: [14, 40],
  });
}

function ClickCatcher({ onPick }: { onPick?: ((lat: number, lng: number) => void) | undefined }) {
  useMapEvents({
    click(e) {
      onPick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
}

export default function LocationMap({
  center,
  marker,
  origin,
  circles = [],
  zoom = 14,
  onPick,
  height = 320,
}: LocationMapProps) {
  const customerIcon = useMemo(() => pinIcon("#e0533d"), []);
  const originIcon = useMemo(() => pinIcon("#1f2937"), []);

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      scrollWheelZoom={false}
      style={{ height, width: "100%" }}
      className="z-0 overflow-hidden rounded-xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickCatcher onPick={onPick} />
      <Recenter lat={center.lat} lng={center.lng} />

      {origin ? (
        <>
          {circles.map((c) => (
            <Circle
              key={`${c.innerM}-${c.outerM}-${c.label}`}
              center={[origin.lat, origin.lng]}
              radius={c.outerM}
              pathOptions={{ color: c.color, fillColor: c.color, fillOpacity: 0.08, weight: 2 }}
            >
              <Tooltip direction="top">{c.label}</Tooltip>
            </Circle>
          ))}
          <Marker position={[origin.lat, origin.lng]} icon={originIcon} />
        </>
      ) : null}

      {marker ? (
        <Marker
          position={[marker.lat, marker.lng]}
          icon={customerIcon}
          draggable={Boolean(onPick)}
          eventHandlers={{
            dragend: (e) => {
              const p = (e.target as L.Marker).getLatLng();
              onPick?.(p.lat, p.lng);
            },
          }}
        />
      ) : null}
    </MapContainer>
  );
}
