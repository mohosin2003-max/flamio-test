import { useRef, useState } from "react";
import { Loader2, MapPin, Navigation } from "lucide-react";
import { toast } from "sonner";

import { MapPicker } from "@/components/map/MapPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reverseGeocode } from "@/lib/customer-location";

const MAP_FALLBACK = { lat: 24.4449, lng: 90.7766 };

export type LatLng = { lat: number; lng: number };

/**
 * Map pin + live location + Location/Area Name. Reuses the existing
 * MapPicker and reverseGeocode; the values map onto the existing address
 * latitude/longitude and `area` fields.
 */
export function LocationFields({
  point,
  onPoint,
  area,
  onArea,
  onGeocoded,
  areaRequired = false,
}: {
  point: LatLng | null;
  onPoint: (p: LatLng) => void;
  area: string;
  onArea: (v: string) => void;
  onGeocoded?: (label: string) => void;
  areaRequired?: boolean;
}) {
  const [locating, setLocating] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<string | null>(null);
  const requestId = useRef(0);

  // Looks up the place name for the chosen pin. Only a confirmation — it never
  // touches the customer's own Location / Area Name.
  async function detectPlace(lat: number, lng: number) {
    const id = ++requestId.current;
    setDetecting(true);
    setDetected(null);
    let label: string | null = null;
    try {
      label = await reverseGeocode(lat, lng);
    } catch {
      label = null;
    }
    if (id !== requestId.current) return;
    setDetecting(false);
    setDetected(label);
    if (label) onGeocoded?.(label);
  }

  function pick(lat: number, lng: number) {
    onPoint({ lat, lng });
    void detectPlace(lat, lng);
  }

  function useLive() {
    if (!("geolocation" in navigator)) {
      toast.error("Your device can't share its location. Please pick it on the map.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setLocating(false);
        pick(lat, lng);
      },
      () => {
        setLocating(false);
        toast.error("We couldn't get your location. Please pick it on the map instead.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" size="sm" disabled={locating} onClick={useLive}>
        {locating ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Navigation className="size-4 text-primary" aria-hidden="true" />
        )}
        {locating ? "Detecting your location…" : "Use My Current Location"}
      </Button>
      <div className="space-y-0.5">
        <p className="text-sm font-semibold">Choose Your Location on Map</p>
        <p className="text-xs text-muted-foreground">
          Tap or click anywhere on the map to place your pin. Tap again to move it.
        </p>
      </div>
      <MapPicker
        center={point ?? MAP_FALLBACK}
        marker={point}
        onPick={pick}
        height={260}
      />
      <div
        aria-live="polite"
        className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 p-2.5 text-xs leading-snug"
      >
        {detecting ? (
          <>
            <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden="true" />
            <span className="text-muted-foreground">Finding the place name…</span>
          </>
        ) : point ? (
          <>
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <span className="font-medium">Selected location: </span>
              {detected ?? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}
            </span>
          </>
        ) : (
          <>
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">No location selected yet.</span>
          </>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="loc-area">
          Location / Area Name{areaRequired ? "" : " (optional)"}
        </Label>
        <Input
          id="loc-area"
          value={area}
          onChange={(e) => onArea(e.target.value)}
          placeholder="e.g. Sholakia"
          maxLength={120}
        />
      </div>
    </div>
  );
}
