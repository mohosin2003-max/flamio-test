import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { LocationFields, type LatLng } from "@/components/address/LocationFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useSavedAddresses } from "@/hooks/use-saved-addresses";
import { emptyAddress } from "@/lib/addresses";
import { isValidPhone, normalizePhone } from "@/lib/phone";

export const Route = createFileRoute("/_authenticated/onboarding/location")({
  head: () => ({
    meta: [
      { title: "Set Your Delivery Location — Flamio" },
      { name: "description", content: "Set your delivery location once so ordering is quick." },
      { property: "og:title", content: "Set Your Delivery Location — Flamio" },
      { property: "og:description", content: "Choose where Flamio should deliver your food." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LocationOnboarding,
});

function nextPath(): string {
  if (typeof window === "undefined") return "/menu";
  const raw = new URLSearchParams(window.location.search).get("redirect");
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/menu";
}

function LocationOnboarding() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { addresses, isLoading, isSaving, save } = useSavedAddresses();

  const [point, setPoint] = useState<LatLng | null>(null);
  const [area, setArea] = useState("");
  const [geoLabel, setGeoLabel] = useState<string | null>(null);
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (profile?.phone && !phone) setPhone(profile.phone);
  }, [profile, phone]);

  // Customers who already have an address never see this step.
  useEffect(() => {
    if (!isLoading && addresses.length > 0) window.location.replace(nextPath());
  }, [isLoading, addresses.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!point) return void toast.error("Please use your current location or pick it on the map.");
    const areaName = area.trim();
    if (!isValidPhone(phone)) return void toast.error("Please enter a valid phone number.");
    const fullName = (profile?.fullName ?? "").trim();
    let addressLine = (geoLabel ?? "").trim();
    if (addressLine.length < 5)
      addressLine = areaName
        ? `${areaName} (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`
        : `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
    try {
      await save({
        ...emptyAddress(),
        fullName: fullName.length >= 2 ? fullName : "Customer",
        phone: normalizePhone(phone),
        addressLine: addressLine.slice(0, 300),
        area: areaName || null,
        latitude: point.lat,
        longitude: point.lng,
        isDefault: true,
      });
      toast.success("Delivery location saved");
      await navigate({ to: nextPath() as "/menu", replace: true });
    } catch {
      toast.error("We couldn't save your location. Please try again.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 pb-28 sm:px-6">
      <h1 className="font-display text-3xl font-black">Set Your Delivery Location</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tell us where to deliver. You can change it anytime in Account → Addresses.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-card">
        <LocationFields
          point={point}
          onPoint={setPoint}
          area={area}
          onArea={setArea}
          onGeocoded={setGeoLabel}
        />
        {geoLabel ? <p className="text-xs text-muted-foreground">{geoLabel}</p> : null}
        <div className="space-y-2">
          <Label htmlFor="onb-phone">Delivery phone</Label>
          <Input id="onb-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
        </div>
        <Button type="submit" className="w-full" disabled={isSaving || !point}>
          {isSaving && <Loader2 className="animate-spin" aria-hidden="true" />}
          {isSaving ? "Saving..." : "Save and continue"}
        </Button>
      </form>
    </div>
  );
}
