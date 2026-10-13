import { useState } from "react";
import { Check, Loader2, MapPin, Navigation, Store, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { restaurant } from "@/data/restaurant";
import {
  loadCustomerLocation,
  reverseGeocode,
  saveCustomerLocation,
} from "@/lib/customer-location";
import type { CustomerLocation } from "@/types/menu";

const RESTAURANT_LABEL = restaurant.addressLine ?? restaurant.city;

export function useCustomerLocation() {
  const [location, setLocationState] = useState<CustomerLocation | null>(() =>
    typeof window === "undefined" ? null : loadCustomerLocation(),
  );

  const setLocation = (next: CustomerLocation | null) => {
    setLocationState(next);
    saveCustomerLocation(next);
  };

  return { location, setLocation };
}

export function LocationSelector({
  location,
  onSelect,
  savedLabel = null,
}: {
  location: CustomerLocation | null;
  onSelect: (next: CustomerLocation | null) => void;
  /** Signed-in customer's saved/default address label; preferred when present. */
  savedLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<CustomerLocation | null>(null);

  const label = savedLabel || location?.label || RESTAURANT_LABEL;

  async function useCurrentLocation() {
    setError(null);
    setPending(null);
    if (!("geolocation" in navigator)) {
      setError("Your device does not support location services. Please enter your address manually at checkout.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let address: string | null = null;
        try {
          address = await reverseGeocode(latitude, longitude);
        } catch {
          address = null;
        }
        setPending({
          label: address ?? `GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          latitude,
          longitude,
        });
        setBusy(false);
      },
      (err) => {
        setBusy(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Allow location access in your browser settings, or enter your address manually at checkout."
            : "We could not determine your current location. Please try again or enter your address manually at checkout.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Change delivery location"
          className="flex min-w-0 flex-1 items-center gap-1 rounded-lg px-1 py-1.5 text-left text-muted-foreground transition-smooth hover:bg-secondary hover:text-foreground"
        >
          <MapPin aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <span className="truncate text-xs font-medium sm:text-sm">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 p-3">
        <p className="text-sm font-semibold">Delivery location</p>

        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2"
          disabled={busy}
          onClick={() => void useCurrentLocation()}
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Navigation aria-hidden="true" className="size-4 text-primary" />
          )}
          {busy ? "Detecting your location…" : "📍 Use My Current Location"}
        </Button>

        {pending ? (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">Confirm this location</p>
            <p className="text-sm leading-snug">{pending.label}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  onSelect(pending);
                  setPending(null);
                  setOpen(false);
                }}
              >
                <Check aria-hidden="true" className="size-4" /> Confirm
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs leading-snug text-destructive">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        ) : null}

        {location ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={() => {
              onSelect(null);
              setPending(null);
              setOpen(false);
            }}
          >
            <Store aria-hidden="true" className="size-4" />
            Reset to restaurant area ({RESTAURANT_LABEL})
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
