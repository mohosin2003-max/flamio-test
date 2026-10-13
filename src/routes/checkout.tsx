import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2 } from "lucide-react";


import { MapPicker } from "@/components/map/MapPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/states";
import { StaffCartNotice } from "@/components/account/StaffCartNotice";
import { useDashboardAccess } from "@/hooks/use-dashboard-access";
import { useCart } from "@/context/cart";
import { useAuth } from "@/hooks/use-auth";
import { useSavedAddresses } from "@/hooks/use-saved-addresses";

import { paymentMethods } from "@/data/restaurant";
import { emptyAddress } from "@/lib/addresses";
import { deliveryQueryOptions, quoteDelivery, resolveZone } from "@/lib/delivery";
import { quoteDeliveryForLocation } from "@/lib/delivery.functions";
import { formatDistance, haversineMeters, pickRadiusZone } from "@/lib/geo";
import { reverseGeocode } from "@/lib/customer-location";
import { formatBDT } from "@/lib/format";
import { checkCoupon } from "@/lib/coupons.functions";
import { saveOrder, type PlacedOrder } from "@/lib/orders";
import { placeOrder } from "@/lib/orders.functions";
import { canScheduleNow, formatScheduled, isOpenAt, listSlots } from "@/lib/opening-hours";
import { getPublicHours } from "@/lib/scheduling.functions";
import { ScheduleDialog } from "@/components/checkout/ScheduleDialog";
import { clearPendingCheckout, readPendingCheckout, savePendingCheckout } from "@/lib/pending-checkout";
import { cn } from "@/lib/utils";
import type { CustomerAddress, FulfillmentType } from "@/types/menu";


/** Only used before the owner has placed the restaurant on the map. */
const MAP_FALLBACK = { lat: 24.4449, lng: 90.7766 };

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout — Flamio" },
      {
        name: "description",
        content: "Confirm your delivery details and place your Flamio order in Kishoreganj Sadar.",
      },
      { property: "og:title", content: "Checkout — Flamio" },
      {
        property: "og:description",
        content: "Confirm your delivery details and place your Flamio order.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(deliveryQueryOptions()),
  component: CheckoutPage,
});

function CheckoutPage() {
  const { lines, subtotal, isHydrated, clear } = useCart();
  const { profile, isAuthenticated } = useAuth();
  const { isStaffOnly } = useDashboardAccess();

  const { data } = useSuspenseQuery(deliveryQueryOptions());
  const { settings, zones } = data;
  const origin = data.origin;
  /** Distance pricing only kicks in once the owner has both a restaurant
   * location and at least one distance ring. Otherwise everything below stays
   * exactly as it was. */
  const radiusMode =
    origin !== null && zones.some((z) => z.zoneType === "radius" && z.radiusMaxM !== null);
  const navigate = useNavigate();

  const submitOrder = useServerFn(placeOrder);

  // Opening hours (Asia/Dhaka). The server re-checks everything on submit.
  const fetchHours = useServerFn(getPublicHours);
  const hoursQuery = useQuery({ queryKey: ["public-hours"], queryFn: () => fetchHours(), refetchInterval: 60_000, staleTime: 30_000 });
  const hours = hoursQuery.data ?? null;
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [closedPromptShown, setClosedPromptShown] = useState(false);
  const restaurantOpen = hours ? isOpenAt(hours) : true;
  const scheduleAllowed = hours ? canScheduleNow(hours) : false;
  const slots = useMemo(() => (hours && scheduleAllowed ? listSlots(hours) : []), [hours, scheduleAllowed, hoursQuery.dataUpdatedAt]);
  const closedWithoutSlot = !restaurantOpen && !scheduledFor;
  useEffect(() => {
    if (hours && !restaurantOpen && !scheduledFor && !closedPromptShown) {
      setClosedPromptShown(true);
      setScheduleOpen(true);
    }
  }, [hours, restaurantOpen, scheduledFor, closedPromptShown]);
  useEffect(() => {
    if (scheduledFor && hours && slots.length > 0 && !slots.some((s) => s.iso === scheduledFor)) {
      setScheduledFor(null);
    }
  }, [slots, scheduledFor, hours]);

  const [placed, setPlaced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const enabledMethods = paymentMethods.filter((m) => m.isEnabled);
  const [method, setMethod] = useState(enabledMethods[0]?.id ?? "cash_on_delivery");


  const [fulfillment, setFulfillment] = useState<FulfillmentType>(
    settings.isDeliveryEnabled ? "delivery" : "pickup",
  );
  const [zoneId, setZoneId] = useState<string | null>(
    settings.defaultZoneId ?? zones[0]?.id ?? null,
  );

  /**
   * Saved addresses come from the database for signed-in customers (row-level
   * security scoped) and from the existing local store for guests.
   */
  const {
    addresses: saved,
    isLoading: addressesLoading,
    error: addressesError,
    isSaving: addressSaving,
    remove: removeSavedAddress,
    save: persistSavedAddress,
  } = useSavedAddresses();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [form, setForm] = useState<CustomerAddress>(() => emptyAddress());
  const [addressTouched, setAddressTouched] = useState(false);

  /** Sets one delivery location from either GPS or the existing map picker. */
  async function setDeliveryLocation(lat: number, lng: number) {
    setPoint({ lat, lng });
    setAddressTouched(true);
    let label: string | null = null;
    try {
      label = await reverseGeocode(lat, lng);
    } catch {
      /* Coordinates remain a valid selected location when lookup is unavailable. */
    }
    setForm((current) => ({
      ...current,
      addressLine: label ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    }));
  }

  /**
   * Below the delivery minimum: go back to the Menu keeping the cart (it lives
   * in the cart store) and this exact Checkout (same tab-only temporary state
   * used for sign-in, restored below on return). No order is created.
   */
  function handleAddMoreItems() {
    savePendingCheckout({
      form,
      point,
      fulfillment,
      method,
      zoneId,
      couponCode: coupon?.code ?? null,
      scheduledFor,
    });
    void navigate({ to: "/menu", search: {} as never });
  }

  // Returning from sign-in/sign-up: restore the exact Checkout the customer
  // prepared. Marking it as touched stops saved/default addresses replacing it.
  useEffect(() => {
    const pending = readPendingCheckout();
    if (!pending) return;
    clearPendingCheckout();
    setForm(pending.form);
    setPoint(pending.point);
    setFulfillment(pending.fulfillment);
    setMethod(pending.method as typeof method);
    setZoneId(pending.zoneId);
    setSelectedId(null);
    setAddressTouched(true);
    if (pending.couponCode) setCouponInput(pending.couponCode);
    if (pending.scheduledFor) setScheduledFor(pending.scheduledFor);
  }, []);

  // Preselect the default (or first) saved address once, without clobbering typing.
  useEffect(() => {
    if (addressTouched || addressesLoading || saved.length === 0) return;
    const preferred = saved.find((a) => a.isDefault) ?? saved[0];
    if (!preferred) return;
    setSelectedId(preferred.id);
    setForm(preferred);
    if (preferred.latitude !== null && preferred.longitude !== null) {
      setPoint({ lat: preferred.latitude, lng: preferred.longitude });
    }
    if (preferred.zoneId) setZoneId(preferred.zoneId);
    setAddressTouched(true);
  }, [saved, addressesLoading, addressTouched]);

  // Signed-in customers get their profile details prefilled (never overwrites typed input).
  useEffect(() => {
    if (!profile) return;
    setForm((current) => ({
      ...current,
      fullName: current.fullName || (profile.fullName ?? ""),
      phone: current.phone || (profile.phone ?? ""),
      addressLine: current.addressLine || (profile.addressLine ?? ""),
    }));
  }, [profile]);


  /**
   * Coupons. The code is only ever priced by the existing `checkCoupon` server
   * function, and `placeOrder` re-validates it, so the browser never decides
   * the discount.
   */
  const applyCoupon = useServerFn(checkCoupon);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  const discount = coupon ? Math.min(coupon.discount, subtotal) : 0;

  // A coupon priced against an older subtotal must be re-checked.
  useEffect(() => {
    if (!coupon) return;
    let active = true;
    setCouponChecking(true);
    void applyCoupon({ data: { code: coupon.code, subtotal } })
      .then((res) => {
        if (!active) return;
        if (res.ok) {
          setCoupon({ code: res.code, discount: res.discount });
          setCouponError(null);
        } else {
          setCoupon(null);
          setCouponError(res.error);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCoupon(null);
        setCouponError(err instanceof Error ? err.message : "This coupon is no longer valid.");
      })
      .finally(() => {
        if (active) setCouponChecking(false);
      });
    return () => {
      active = false;
    };
    // Re-priced whenever the cart subtotal changes.
  }, [subtotal]);

  /**
   * Distance pricing. The browser only previews the fee — `placeOrder`
   * recalculates it from the same coordinates on the server, so a tampered
   * client can never buy cheap delivery.
   */
  const quoteLocation = useServerFn(quoteDeliveryForLocation);
  const distanceM =
    radiusMode && origin && point
      ? haversineMeters(origin, { latitude: point.lat, longitude: point.lng })
      : null;
  const radiusZone = distanceM === null ? null : pickRadiusZone(zones, distanceM);

  const locationQuote = useQuery({
    queryKey: ["delivery-location-quote", point?.lat, point?.lng, subtotal, discount],
    queryFn: () =>
      quoteLocation({
        data: { latitude: point!.lat, longitude: point!.lng, subtotal, discount },
      }),
    enabled: radiusMode && fulfillment === "delivery" && point !== null,
  });

  const zone = useMemo(
    () => (radiusMode ? radiusZone : resolveZone(zones, zoneId)),
    [radiusMode, radiusZone, zones, zoneId],
  );
  const baseQuote = useMemo(
    () => quoteDelivery({ settings, zone, fulfillment, subtotal, discount }),
    [settings, zone, fulfillment, subtotal, discount],
  );

  const served = radiusMode ? (locationQuote.data ?? null) : null;
  const quote =
    served && served.radiusMode && served.available
      ? {
          ...baseQuote,
          charge: served.charge,
          estimatedTime: served.estimatedTime,
          minimumOrder: served.minimumOrder,
          meetsMinimumOrder: served.meetsMinimumOrder,
          freeDeliveryThreshold: served.freeDeliveryThreshold,
          amountToFreeDelivery: served.amountToFreeDelivery,
          isFree: served.isFree,
        }
      : radiusMode && fulfillment === "delivery"
        ? // No usable location yet: don't quote a charge we can't honour.
          { ...baseQuote, charge: 0, estimatedTime: null }
        : baseQuote;

  const outOfRange =
    radiusMode && fulfillment === "delivery" && (point === null || served?.available === false);
  const outOfRangeMessage =
    point === null
      ? "Choose your delivery location on the map to see the delivery charge."
      : (served?.message ?? "Sorry, we don't deliver to that location yet.");

  const grandTotal = Math.max(subtotal - discount, 0) + quote.charge;

  if (isHydrated && lines.length === 0 && !placed) {

    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Nothing to check out"
          description="Your cart is empty. Pick something from the menu first."
          action={
            <Button asChild>
              <Link to="/menu" search={{}}>
                Browse the menu
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (isStaffOnly) return <StaffCartNotice />;

  const isDelivery = fulfillment === "delivery";
  const blocked = isDelivery && (!quote.meetsMinimumOrder || outOfRange);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 pb-32 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-black sm:text-4xl">Checkout</h1>

      <form
        className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting) return; // guard against double submission
          // Lock immediately — before any await — so rapid taps or Go/Enter
          // during the address save cannot start a second submission.
          setSubmitting(true);
          setSubmitError(null);

          const fail = (message: string) => {
            setSubmitting(false); // release the lock so the customer can retry
            setSubmitError(message);
            toast.error(message);
          };

          if (closedWithoutSlot) {
            setScheduleOpen(true);
            fail("We're closed right now. Please choose a time to schedule this order.");
            return;
          }
          if (isDelivery && outOfRange) {
            fail(outOfRangeMessage);
            return;
          }
          if (blocked) {
            fail(`Minimum order for delivery is ${formatBDT(quote.minimumOrder)}`);
            return;
          }
          const name = form.fullName.trim();
          const phone = form.phone.trim();
          if (name.length < 2) {
            fail("Please enter your full name.");
            return;
          }
          if (phone.replace(/\D/g, "").length < 6) {
            fail("Please enter a valid phone number.");
            return;
          }
          if (isDelivery && form.addressLine.trim().length < 5) {
            fail("Please enter your delivery address.");
            return;
          }
          if (lines.length === 0) {
            fail("Your cart is empty.");
            return;
          }

          if (!isAuthenticated) {
            // No order yet: keep this Checkout for the current tab only and
            // ask the guest to sign in or create an account first.
            savePendingCheckout({
              form,
              point,
              fulfillment,
              method,
              zoneId,
              couponCode: coupon?.code ?? null,
              scheduledFor,
            });
            setSubmitting(false);
            await navigate({
              to: "/auth",
              search: { redirect: "/checkout", from: "checkout" } as never,
            });
            return;
          }

          const record: CustomerAddress = {
            ...form,
            zoneId: radiusMode ? (zone?.id ?? null) : zoneId,
            latitude: isDelivery ? (point?.lat ?? null) : null,
            longitude: isDelivery ? (point?.lng ?? null) : null,
            isDefault: saved.length === 0 || Boolean(saved.find((a) => a.id === form.id)?.isDefault),
          };
          if (isDelivery) {
            try {
              await persistSavedAddress(record);
            } catch (err) {
              // Saving the address for next time must never block the order.
              console.error("[checkout] saving address failed", err);
            }
          }

          try {
            const created = await submitOrder({
              data: {
                fulfillment,
                paymentMethod: method,
                paymentLabel:
                  paymentMethods.find((m) => m.id === method)?.label ?? "Cash on Delivery",
                customerName: name,
                customerPhone: phone,
                addressLine: isDelivery ? form.addressLine.trim() : null,
                area: form.area?.trim() || null,
                landmark: form.landmark?.trim() || null,
                deliveryNotes: form.deliveryNotes?.trim() || null,
                zoneId: isDelivery ? (radiusMode ? (zone?.id ?? null) : zoneId) : null,
                zoneName: isDelivery ? (zone?.name ?? null) : null,
                latitude: isDelivery ? (point?.lat ?? null) : null,
                longitude: isDelivery ? (point?.lng ?? null) : null,
                estimatedTime: quote.estimatedTime,
                pickupNote: settings.pickupNote,
                subtotal,
                discount,
                couponCode: coupon?.code ?? null,
                scheduledFor,
                deliveryCharge: quote.charge,
                total: grandTotal,
                items: lines.map((l) => ({
                  productId: l.productId,
                  productSlug: l.productSlug,
                  productName: l.productName,
                  variantId: l.variantId,
                  variantName: l.variantName,
                  unitPrice: l.unitPrice,
                  quantity: l.quantity,
                  imageUrl: l.imageUrl,
                  comboId: l.comboId ?? null,
                  comboName: l.comboName ?? null,
                  comboKey: l.comboKey ?? null,
                  comboGroupId: l.comboGroupId ?? null,
                })),
              },
            });

            // Orders live in the database only — nothing private is kept on the device.

            setPlaced(true);
            clear();
            toast.success(scheduledFor ? "Order scheduled" : "Order placed");
            await navigate({ to: "/order/$orderId", params: { orderId: created.id } });
          } catch (err) {
            console.error("[checkout] placeOrder failed", err);
            const message =
              err instanceof Error && err.message
                ? err.message
                : "We couldn't place your order. Please try again.";
            // Cart is intentionally left untouched so the customer can retry.
            setSubmitError(message);
            toast.error(message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="space-y-6">
          {/* Fulfillment */}
          <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-card">
            <h2 className="font-display text-lg font-extrabold">How would you like your order?</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(
                [
                  {
                    id: "delivery" as const,
                    label: "Delivery",
                    enabled: settings.isDeliveryEnabled,
                    note: quote.estimatedTime
                      ? `Estimated ${zone?.estimatedDeliveryTime ?? settings.defaultEstimatedDeliveryTime}`
                      : "Delivered to your address",
                  },
                  {
                    id: "pickup" as const,
                    label: "Pickup",
                    enabled: settings.isPickupEnabled,
                    note: settings.pickupNote ?? "Collect from the restaurant",
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={!opt.enabled}
                  aria-pressed={fulfillment === opt.id}
                  onClick={() => setFulfillment(opt.id)}
                  className={cn(
                    "rounded-xl border px-4 py-3 text-left transition-smooth disabled:opacity-50",
                    fulfillment === opt.id
                      ? "border-primary bg-secondary text-foreground"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  <span className="block text-sm font-semibold">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.note}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Contact + address */}
          <section className="space-y-5 rounded-2xl border border-border/70 bg-card p-6 shadow-card">
            <h2 className="font-display text-lg font-extrabold">
              {isDelivery ? "Delivery details" : "Contact details"}
            </h2>

            {isDelivery && addressesError ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {addressesError}
              </p>
            ) : null}

            {isDelivery && addressesLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy="true">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                Loading your saved addresses...
              </p>
            ) : null}

            {isDelivery && saved.length > 0 ? (
              <div className="space-y-2">
                <Label>Saved addresses</Label>
                <div className="flex flex-col gap-2">
                  {saved.map((a) => (
                    <div
                      key={a.id}
                      className={cn(
                        "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm transition-smooth",
                        selectedId === a.id ? "border-primary bg-secondary" : "border-border",
                      )}
                    >
                      <button
                        type="button"
                        className="flex-1 text-left"
                        aria-pressed={selectedId === a.id}
                        onClick={() => {
                          setSelectedId(a.id);
                          setAddressTouched(true);
                          setForm(a);
                          if (a.latitude !== null && a.longitude !== null) {
                            setPoint({ lat: a.latitude, lng: a.longitude });
                          }
                          if (a.zoneId) setZoneId(a.zoneId);
                        }}
                      >
                        <span className="font-medium">{a.fullName || "Saved address"}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[a.addressLine, a.area].filter(Boolean).join(", ")}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="Edit address"
                        className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setSelectedId(a.id);
                          setAddressTouched(true);
                          setForm(a);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete address"
                        className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
                        disabled={addressSaving}
                        onClick={async () => {
                          try {
                            await removeSavedAddress(a.id);
                            if (selectedId === a.id) {
                              setSelectedId(null);
                              setForm(emptyAddress());
                            }
                          } catch {
                            toast.error("We couldn't delete this address. Please try again.");
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedId(null);
                    setAddressTouched(true);
                    setForm(emptyAddress());
                  }}
                >
                  Add new address
                </Button>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                required
                autoComplete="name"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                type="tel"
                required
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            {isDelivery ? (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Set Delivery Location</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={locating}
                      onClick={() => {
                        if (!navigator.geolocation) {
                          toast.error("Your device can't share its location.");
                          return;
                        }
                        setLocating(true);
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            void setDeliveryLocation(pos.coords.latitude, pos.coords.longitude).finally(
                              () => setLocating(false),
                            );
                          },
                          () => {
                            setLocating(false);
                            toast.error(
                              "We couldn't get your location. Please pick it on the map instead.",
                            );
                          },
                          { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
                        );
                      }}
                    >
                      {locating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Use Current Location
                    </Button>
                    <Button
                      type="button"
                      variant={showMap ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setShowMap((value) => !value)}
                    >
                      Choose on Map
                    </Button>
                  </div>
                  {showMap ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Tap the map or drag the pin to where you want your order delivered.
                      </p>
                      <MapPicker
                        center={
                          point ??
                          (origin ? { lat: origin.latitude, lng: origin.longitude } : MAP_FALLBACK)
                        }
                        marker={point}
                        origin={origin ? { lat: origin.latitude, lng: origin.longitude } : null}
                        height={280}
                        zoom={point || origin ? 15 : 12}
                        onPick={(lat, lng) => void setDeliveryLocation(lat, lng)}
                      />
                    </>
                  ) : null}
                  {point || form.addressLine.trim() ? (
                    <div className="space-y-2">
                      <Label htmlFor="address">Delivery Location / Address</Label>
                      <Textarea
                        id="address"
                        required
                        rows={3}
                        autoComplete="street-address"
                        value={form.addressLine}
                        onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
                      />
                      {point && distanceM !== null ? (
                        <p className="text-xs text-muted-foreground">
                          {formatDistance(distanceM)} from the restaurant
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Use your current location or choose a point on the map.
                    </p>
                  )}
                  {radiusMode && outOfRange ? (
                    <p
                      role="alert"
                      className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      {outOfRangeMessage}
                    </p>
                  ) : null}
                  {radiusMode && zone && !outOfRange ? (
                    <p className="text-xs text-muted-foreground">
                      Delivery area: {zone.name} · {formatBDT(quote.charge)}
                      {quote.estimatedTime ? ` · ${quote.estimatedTime}` : ""}
                    </p>
                  ) : null}
                </div>
                {!radiusMode && zones.length > 0 ? (
                  <div className="space-y-2">
                    <Label>Delivery area</Label>
                    <div className="flex flex-wrap gap-2">
                      {zones.map((z) => (
                        <button
                          key={z.id}
                          type="button"
                          aria-pressed={zoneId === z.id}
                          onClick={() => setZoneId(z.id)}
                          className={cn(
                            "rounded-full border px-4 py-2 text-sm transition-smooth",
                            zoneId === z.id
                              ? "border-primary bg-secondary text-foreground"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {z.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="area">Area (optional)</Label>
                    <Input
                      id="area"
                      value={form.area ?? ""}
                      onChange={(e) => setForm({ ...form, area: e.target.value || null })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="landmark">Landmark (optional)</Label>
                    <Input
                      id="landmark"
                      value={form.landmark ?? ""}
                      onChange={(e) => setForm({ ...form, landmark: e.target.value || null })}
                    />
                  </div>
                </div>
              </>
            ) : (
              <p className="rounded-xl border border-border/70 bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
                {settings.pickupNote ?? "Collect your order from the restaurant."}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">
                {isDelivery ? "Delivery notes (optional)" : "Order notes (optional)"}
              </Label>
              <Textarea
                id="notes"
                rows={2}
                value={form.deliveryNotes ?? ""}
                onChange={(e) => setForm({ ...form, deliveryNotes: e.target.value || null })}
              />
            </div>

            <fieldset>
              <legend className="text-sm font-semibold">Payment method</legend>
              <div className="mt-3 flex flex-col gap-2">
                {paymentMethods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!m.isEnabled}
                    aria-pressed={method === m.id}
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left text-sm transition-smooth disabled:opacity-50",
                      method === m.id
                        ? "border-primary bg-secondary text-foreground"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    <span className="font-medium">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.description}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          </section>
        </div>

        <aside className="h-fit rounded-2xl border border-border/70 bg-card p-5 shadow-card lg:sticky lg:top-24">
          <h2 className="font-display text-xl font-extrabold">Order summary</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {lines.map((line) => (
              <li key={line.lineId} className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{line.productName}</span>
                  {line.variantName ? (
                    <span className="block text-xs">{line.variantName}</span>
                  ) : null}
                  <span className="block text-xs">
                    {line.quantity} × {formatBDT(line.unitPrice)}
                  </span>
                </span>
                <span className="font-medium">{formatBDT(line.unitPrice * line.quantity)}</span>
              </li>
            ))}
          </ul>

          {/* Coupon — priced by the server, never in the browser. */}
          <div className="mt-4 space-y-2 border-t border-border/70 pt-3">
            <Label htmlFor="coupon">Coupon code</Label>
            {coupon ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/50 bg-secondary px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-semibold">{coupon.code}</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">−{formatBDT(discount)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCoupon(null);
                      setCouponError(null);
                      setCouponInput("");
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="coupon"
                  value={couponInput}
                  placeholder="e.g. FLAMIO10"
                  autoComplete="off"
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={couponChecking || couponInput.trim().length < 2}
                  aria-busy={couponChecking}
                  onClick={async () => {
                    setCouponError(null);
                    setCouponChecking(true);
                    try {
                      const res = await applyCoupon({
                        data: { code: couponInput.trim(), subtotal },
                      });
                      if (res.ok) {
                        setCoupon({ code: res.code, discount: res.discount });
                        toast.success(`Coupon ${res.code} applied`);
                      } else {
                        setCouponError(res.error);
                      }
                    } catch (err) {
                      const message =
                        err instanceof Error && err.message
                          ? err.message
                          : "We couldn't check this coupon. Please try again.";
                      setCouponError(message);
                    } finally {
                      setCouponChecking(false);
                    }
                  }}
                >
                  {couponChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                </Button>
              </div>
            )}
            {couponError ? (
              <p role="alert" className="text-xs text-destructive">
                {couponError}
              </p>
            ) : null}
          </div>

          <dl className="mt-4 space-y-2 border-t border-border/70 pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-medium">{formatBDT(subtotal)}</dd>
            </div>
            {discount > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="font-medium">−{formatBDT(discount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {isDelivery ? "Delivery charge" : "Delivery (pickup)"}
              </dt>
              <dd className="font-medium">
                {quote.charge === 0 ? (isDelivery ? "Free" : formatBDT(0)) : formatBDT(quote.charge)}
              </dd>
            </div>
          </dl>

          {isDelivery && !outOfRange && quote.meetsMinimumOrder ? (
            quote.amountToFreeDelivery !== null ? (
              <>
                <p className="mt-3 text-xs font-medium text-primary">
                  {zone?.reducedDeliveryFee != null && zone.reducedDeliveryFee > 0
                    ? `Add ${formatBDT(quote.amountToFreeDelivery)} more to get delivery for only ${formatBDT(zone.reducedDeliveryFee)}.`
                    : `Add ${formatBDT(quote.amountToFreeDelivery)} more to get FREE delivery.`}
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={handleAddMoreItems}>
                  Add More Items
                </Button>
              </>
            ) : quote.freeDeliveryThreshold !== null &&
              Math.max(subtotal - discount, 0) >= quote.freeDeliveryThreshold ? (
              // Threshold reached: mirror the quote rule — a reduced fee > 0
              // replaces free delivery; unset or 0 stays FREE.
              zone?.reducedDeliveryFee != null && zone.reducedDeliveryFee > 0 ? (
                <p className="mt-3 text-xs font-medium text-primary">
                  You’ve unlocked reduced delivery — only {formatBDT(zone.reducedDeliveryFee)}{" "}
                  delivery fee.
                </p>
              ) : (
                <p className="mt-3 text-xs font-medium text-primary">
                  You’ve unlocked FREE delivery.
                </p>
              )
            ) : null
          ) : null}
          {isDelivery && distanceM !== null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Distance from the restaurant: {formatDistance(distanceM)}
            </p>
          ) : null}
          {isDelivery && quote.estimatedTime ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Estimated delivery: {quote.estimatedTime}
            </p>
          ) : null}
          {blocked ? (
            outOfRange ? (
              <p className="mt-2 text-xs text-destructive">{outOfRangeMessage}</p>
            ) : (
              <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
                <p className="text-sm font-medium text-destructive">
                  {formatBDT(
                    Math.max(quote.minimumOrder - Math.max(subtotal - discount, 0), 0),
                  )}{" "}
                  more needed to place this delivery order.
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Minimum order for delivery is {formatBDT(quote.minimumOrder)}.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={handleAddMoreItems}
                >
                  Add More Items
                </Button>
              </div>
            )
          ) : null}

          <div className="mt-4 flex justify-between border-t border-border/70 pt-3">
            <span className="font-semibold">Grand total</span>
            <span className="font-display text-xl font-extrabold text-gradient-ember">
              {formatBDT(grandTotal)}
            </span>
          </div>

          {submitError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {submitError}
            </p>
          ) : null}

          {scheduledFor ? (
            <div className="mt-4 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
              <p className="font-semibold">Scheduled for {formatScheduled(scheduledFor)}</p>
              <div className="mt-1 flex gap-3 text-xs">
                <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setScheduleOpen(true)}>Change</button>
                {restaurantOpen ? (
                  <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setScheduledFor(null)}>Order now instead</button>
                ) : null}
              </div>
            </div>
          ) : closedWithoutSlot && hours ? (
            <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <p>We're closed right now{hours.opensAt ? ` — we open at ${hours.opensAt}` : ""}.</p>
              {slots.length > 0 ? (
                <button type="button" className="mt-1 text-xs font-semibold underline" onClick={() => setScheduleOpen(true)}>Choose a time to schedule</button>
              ) : null}
            </div>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="mt-5 w-full shadow-ember"
            disabled={blocked || submitting || (closedWithoutSlot && Boolean(hours))}
            aria-busy={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Placing order…
              </>
            ) : (
              scheduledFor ? "Schedule order" : "Place order"
            )}
          </Button>
          {restaurantOpen && !scheduledFor && slots.length > 0 ? (
            <button
              type="button"
              className="mt-2 w-full text-center text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setScheduleOpen(true)}
            >
              Schedule for later
            </button>
          ) : null}
          <ScheduleDialog
            open={scheduleOpen}
            onOpenChange={setScheduleOpen}
            closed={!restaurantOpen}
            slots={slots}
            opensAt={hours?.opensAt ?? null}
            value={scheduledFor}
            onConfirm={setScheduledFor}
          />
        </aside>
      </form>
    </div>
  );
}
