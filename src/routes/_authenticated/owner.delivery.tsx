import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { MapPicker } from "@/components/map/MapPicker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatBDT } from "@/lib/format";
import { formatDistance } from "@/lib/geo";
import {
  getDeliveryOrigin,
  ownerDeleteDeliveryZone,
  ownerListDeliveryZones,
  ownerSaveDeliveryZone,
  ownerSaveRestaurantLocation,
  type DeliveryZoneRecord,
} from "@/lib/delivery.functions";

/** Fallback view when the owner hasn't placed the restaurant yet. */
const FALLBACK_CENTER = { lat: 24.4449, lng: 90.7766 };

const RING_COLORS = ["#e0533d", "#f59e0b", "#3b82f6", "#10b981", "#8b5cf6"];

/**
 * Owner → Delivery zones. Thin UI over the delivery-zone server functions;
 * the checkout delivery-charge maths in `src/lib/delivery.ts` is untouched.
 */
export const Route = createFileRoute("/_authenticated/owner/delivery")({
  head: () => ({
    meta: [
      { title: "Delivery Zones — Flamio Owner Dashboard" },
      { name: "description", content: "Manage Flamio restaurant location and delivery zones." },
      { property: "og:title", content: "Delivery Zones — Flamio Owner Dashboard" },
      { property: "og:description", content: "Manage Flamio restaurant location and delivery zones." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerDelivery,
});

type FormState = {
  id: string | null;
  name: string;
  deliveryCharge: string;
  minimumOrder: string;
  freeDeliveryThreshold: string;
  reducedDeliveryFee: string;
  isFreeDeliveryEnabled: boolean;
  estimatedDeliveryTime: string;
  isActive: boolean;
  sortOrder: string;
  zoneType: "area" | "radius";
  radiusMinM: string;
  radiusMaxM: string;
};

const emptyForm = (): FormState => ({
  id: null,
  name: "",
  deliveryCharge: "50",
  minimumOrder: "0",
  freeDeliveryThreshold: "",
  reducedDeliveryFee: "",
  isFreeDeliveryEnabled: true,
  estimatedDeliveryTime: "",
  isActive: true,
  sortOrder: "0",
  zoneType: "area",
  radiusMinM: "0",
  radiusMaxM: "",
});

function toForm(z: DeliveryZoneRecord): FormState {
  return {
    id: z.id,
    name: z.name,
    deliveryCharge: String(z.deliveryCharge),
    minimumOrder: String(z.minimumOrder),
    freeDeliveryThreshold: z.freeDeliveryThreshold === null ? "" : String(z.freeDeliveryThreshold),
    reducedDeliveryFee: z.reducedDeliveryFee === null ? "" : String(z.reducedDeliveryFee),
    isFreeDeliveryEnabled: z.isFreeDeliveryEnabled,
    estimatedDeliveryTime: z.estimatedDeliveryTime ?? "",
    isActive: z.isActive,
    sortOrder: String(z.sortOrder),
    zoneType: z.zoneType,
    radiusMinM: z.radiusMinM === null ? "0" : String(z.radiusMinM),
    radiusMaxM: z.radiusMaxM === null ? "" : String(z.radiusMaxM),
  };
}

function OwnerDelivery() {
  const list = useServerFn(ownerListDeliveryZones);
  const save = useServerFn(ownerSaveDeliveryZone);
  const remove = useServerFn(ownerDeleteDeliveryZone);
  const readOrigin = useServerFn(getDeliveryOrigin);
  const saveOrigin = useServerFn(ownerSaveRestaurantLocation);
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [savingPin, setSavingPin] = useState(false);

  const zones = useQuery({
    queryKey: ["owner-delivery-zones"],
    queryFn: () => list(),
  });

  const origin = useQuery({
    queryKey: ["restaurant-origin"],
    queryFn: () => readOrigin(),
  });

  if (zones.isLoading) return <Skeleton className="h-96 w-full" />;

  if (zones.error) {
    return (
      <EmptyState
        title="Couldn't load delivery zones"
        description="Something went wrong loading your delivery areas."
        action={<Button onClick={() => void zones.refetch()}>Try again</Button>}
      />
    );
  }

  const rows = zones.data ?? [];
  const rings = rows.filter((z) => z.zoneType === "radius" && z.radiusMaxM !== null);
  const savedOrigin = origin.data ?? null;
  const mapPin =
    pin ?? (savedOrigin ? { lat: savedOrigin.latitude, lng: savedOrigin.longitude } : null);
  const mapCenter = mapPin ?? FALLBACK_CENTER;

  const circles = rings
    .slice()
    .sort((a, b) => (a.radiusMaxM ?? 0) - (b.radiusMaxM ?? 0))
    .map((z, i) => ({
      innerM: z.radiusMinM ?? 0,
      outerM: z.radiusMaxM ?? 0,
      label: `${z.name} · ${formatDistance(z.radiusMinM ?? 0)}–${formatDistance(z.radiusMaxM ?? 0)}`,
      color: RING_COLORS[i % RING_COLORS.length]!,
    }));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["owner-delivery-zones"] });
    // Checkout reads the public zone list under this key.
    await queryClient.invalidateQueries({ queryKey: ["delivery-settings"] });
  };

  const saveLocation = async () => {
    if (!pin) return;
    setSavingPin(true);
    try {
      await saveOrigin({ data: { latitude: pin.lat, longitude: pin.lng } });
      await origin.refetch();
      await queryClient.invalidateQueries({ queryKey: ["delivery-settings"] });
      setPin(null);
      toast.success("Restaurant location saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the location");
    } finally {
      setSavingPin(false);
    }
  };

  /** Overlapping rings are allowed but confusing — warn before saving. */
  const overlapWarning = (() => {
    if (form.zoneType !== "radius") return null;
    const min = Number(form.radiusMinM) || 0;
    const max = Number(form.radiusMaxM) || 0;
    if (max <= min) return null;
    const clash = rings.find(
      (z) => z.id !== form.id && min < (z.radiusMaxM ?? 0) && max > (z.radiusMinM ?? 0),
    );
    return clash
      ? `This distance range overlaps "${clash.name}". The nearer ring wins for customers in both.`
      : null;
  })();

  const submit = async () => {
    if (form.name.trim().length < 2) {
      toast.error("Please enter a zone name.");
      return;
    }
    if (form.zoneType === "radius") {
      const min = Number(form.radiusMinM) || 0;
      const max = Number(form.radiusMaxM) || 0;
      if (max <= min) {
        toast.error("The end distance must be larger than the start distance.");
        return;
      }
      if (!savedOrigin) {
        toast.error("Set the restaurant location on the map first.");
        return;
      }
    }
    setSaving(true);
    try {
      await save({
        data: {
          id: form.id,
          name: form.name.trim(),
          deliveryCharge: Number(form.deliveryCharge) || 0,
          minimumOrder: Number(form.minimumOrder) || 0,
          freeDeliveryThreshold: form.freeDeliveryThreshold.trim()
            ? Number(form.freeDeliveryThreshold)
            : null,
          reducedDeliveryFee: form.reducedDeliveryFee.trim()
            ? Number(form.reducedDeliveryFee)
            : null,
          isFreeDeliveryEnabled: form.isFreeDeliveryEnabled,
          estimatedDeliveryTime: form.estimatedDeliveryTime.trim() || null,
          isActive: form.isActive,
          sortOrder: Number(form.sortOrder) || 0,
          zoneType: form.zoneType,
          radiusMinM: form.zoneType === "radius" ? Number(form.radiusMinM) || 0 : null,
          radiusMaxM: form.zoneType === "radius" ? Number(form.radiusMaxM) || 0 : null,
        },
      });
      await refresh();
      setForm(emptyForm());
      toast.success("Delivery zone saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this delivery zone");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (zone: DeliveryZoneRecord, isActive: boolean) => {
    setBusyId(zone.id);
    try {
      await save({
        data: {
          id: zone.id,
          name: zone.name,
          deliveryCharge: zone.deliveryCharge,
          minimumOrder: zone.minimumOrder,
          freeDeliveryThreshold: zone.freeDeliveryThreshold,
          reducedDeliveryFee: zone.reducedDeliveryFee,
          isFreeDeliveryEnabled: zone.isFreeDeliveryEnabled,
          estimatedDeliveryTime: zone.estimatedDeliveryTime,
          isActive,
          sortOrder: zone.sortOrder,
          zoneType: zone.zoneType,
          radiusMinM: zone.radiusMinM,
          radiusMaxM: zone.radiusMaxM,
        },
      });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update this zone");
    } finally {
      setBusyId(null);
    }
  };

  const deleteZone = async (zone: DeliveryZoneRecord) => {
    if (!window.confirm(`Delete "${zone.name}"? Past orders are not affected.`)) return;
    setBusyId(zone.id);
    try {
      await remove({ data: { id: zone.id } });
      if (form.id === zone.id) setForm(emptyForm());
      await refresh();
      toast.success("Delivery zone deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete this zone");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="font-display text-base font-bold">Restaurant location</h2>
          <p className="text-sm text-muted-foreground">
            Tap the map to place your restaurant. Distance rings are measured from this point.
          </p>
          <MapPicker
            center={mapCenter}
            marker={null}
            origin={mapPin}
            circles={circles}
            height={300}
            zoom={savedOrigin ? 14 : 12}
            onPick={(lat, lng) => setPin({ lat, lng })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!navigator.geolocation) {
                  toast.error("Your device can't share its location.");
                  return;
                }
                navigator.geolocation.getCurrentPosition(
                  (pos) => setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                  () => toast.error("We couldn't get your current location."),
                );
              }}
            >
              Use my current location
            </Button>
            <Button disabled={!pin || savingPin} onClick={() => void saveLocation()}>
              {savingPin ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save location
            </Button>
            {pin ? (
              <Button variant="ghost" size="sm" onClick={() => setPin(null)}>
                Reset
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {savedOrigin
              ? `Saved: ${savedOrigin.latitude.toFixed(5)}, ${savedOrigin.longitude.toFixed(5)}`
              : "Not set yet — distance-based delivery stays off until you save a location."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="font-display text-base font-bold">
            {form.id ? "Edit delivery zone" : "New delivery zone"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dz-name">Zone name</Label>
              <Input
                id="dz-name"
                value={form.name}
                placeholder="Kishoreganj Sadar"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dz-type">Zone type</Label>
              <select
                id="dz-type"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.zoneType}
                onChange={(e) =>
                  setForm({ ...form, zoneType: e.target.value === "radius" ? "radius" : "area" })
                }
              >
                <option value="area">Named area (customer picks)</option>
                <option value="radius">Distance from restaurant (automatic)</option>
              </select>
            </div>
            {form.zoneType === "radius" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="dz-rmin">From distance (metres)</Label>
                  <Input
                    id="dz-rmin"
                    type="number"
                    min="0"
                    step="10"
                    inputMode="numeric"
                    value={form.radiusMinM}
                    onChange={(e) => setForm({ ...form, radiusMinM: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dz-rmax">To distance (metres)</Label>
                  <Input
                    id="dz-rmax"
                    type="number"
                    min="1"
                    step="10"
                    inputMode="numeric"
                    placeholder="1000"
                    value={form.radiusMaxM}
                    onChange={(e) => setForm({ ...form, radiusMaxM: e.target.value })}
                  />
                </div>
              </>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="dz-charge">Delivery charge</Label>
              <Input
                id="dz-charge"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={form.deliveryCharge}
                onChange={(e) => setForm({ ...form, deliveryCharge: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dz-min">Minimum order</Label>
              <Input
                id="dz-min"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={form.minimumOrder}
                onChange={(e) => setForm({ ...form, minimumOrder: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dz-free">Free delivery above (optional)</Label>
              <Input
                id="dz-free"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={form.freeDeliveryThreshold}
                onChange={(e) => setForm({ ...form, freeDeliveryThreshold: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dz-reduced">Reduced delivery fee (optional)</Label>
              <Input
                id="dz-reduced"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                placeholder="Not set"
                value={form.reducedDeliveryFee}
                onChange={(e) => setForm({ ...form, reducedDeliveryFee: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Lower fee for this zone. Leave empty to use the normal charge, or set 0 for free
                delivery.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dz-time">Estimated delivery time (optional)</Label>
              <Input
                id="dz-time"
                value={form.estimatedDeliveryTime}
                placeholder="30–45 min"
                onChange={(e) => setForm({ ...form, estimatedDeliveryTime: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dz-sort">Display order</Label>
              <Input
                id="dz-sort"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <Label htmlFor="dz-freeon">Free delivery enabled</Label>
              <Switch
                id="dz-freeon"
                checked={form.isFreeDeliveryEnabled}
                onCheckedChange={(checked) =>
                  setForm({ ...form, isFreeDeliveryEnabled: checked })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <Label htmlFor="dz-active">Active</Label>
              <Switch
                id="dz-active"
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
              />
            </div>
          </div>
          {overlapWarning ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {overlapWarning}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={saving} onClick={() => void submit()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {form.id ? "Save changes" : "Create zone"}
            </Button>
            {form.id ? (
              <Button variant="outline" onClick={() => setForm(emptyForm())}>
                Cancel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="font-display text-base font-bold">Delivery zones</h2>
        <p className="text-sm text-muted-foreground">
          Distance zones are matched automatically from the customer's map pin. Named areas stay
          as they are — the customer picks one at checkout. If no zone matches, the default
          delivery charge is used.
        </p>
        {rows.length === 0 ? (
          <EmptyState
            title="No delivery zones yet"
            description="Add a zone to charge different delivery rates by area."
          />
        ) : (
          rows.map((z) => (
            <Card key={z.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    {z.name}
                    <Badge variant={z.isActive ? "default" : "secondary"}>
                      {z.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Badge variant="outline">
                      {z.zoneType === "radius" ? "Distance" : "Area"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {z.zoneType === "radius" && z.radiusMaxM !== null
                      ? `${formatDistance(z.radiusMinM ?? 0)}–${formatDistance(z.radiusMaxM)} · `
                      : ""}
                    {formatBDT(z.deliveryCharge)} delivery
                    {z.minimumOrder > 0 ? ` · min ${formatBDT(z.minimumOrder)}` : ""}
                    {z.isFreeDeliveryEnabled && z.freeDeliveryThreshold !== null
                      ? ` · free above ${formatBDT(z.freeDeliveryThreshold)}`
                      : ""}
                    {z.estimatedDeliveryTime ? ` · ${z.estimatedDeliveryTime}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    aria-label={`${z.isActive ? "Disable" : "Enable"} ${z.name}`}
                    checked={z.isActive}
                    disabled={busyId === z.id}
                    onCheckedChange={(checked) => void toggleActive(z, checked)}
                  />
                  <Button variant="outline" size="sm" onClick={() => setForm(toForm(z))}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${z.name}`}
                    disabled={busyId === z.id}
                    onClick={() => void deleteZone(z)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
