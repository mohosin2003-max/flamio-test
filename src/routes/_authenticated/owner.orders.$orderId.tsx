import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, MapPin, Navigation, Phone, UserRound } from "lucide-react";

import { MapPicker } from "@/components/map/MapPicker";
import { formatDistance } from "@/lib/geo";

import { OwnerOrderActions } from "@/components/order/OwnerOrderActions";
import { PrintReceiptButton } from "@/components/order/PrintReceiptButton";
import { CustomerNote, StaffOrderItemList, orderDateParts } from "@/components/order/StaffOrderDetails";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTaka } from "@/lib/format";
import { ownerGetOrder } from "@/lib/owner.functions";
import { statusLabel } from "@/lib/order-status";

export const Route = createFileRoute("/_authenticated/owner/orders/$orderId")({
  validateSearch: (search: Record<string, unknown>): { message?: boolean } =>
    search["message"] === true || search["message"] === "true" ? { message: true } : {},
  head: () => ({
    meta: [
      { title: "Order Details — Flamio Owner Dashboard" },
      { name: "description", content: "Review and process a Flamio order." },
      { property: "og:title", content: "Order Details — Flamio Owner Dashboard" },
      { property: "og:description", content: "Review and process a Flamio order." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerOrderDetailPage,
});

function OwnerOrderDetailPage() {
  const { orderId } = Route.useParams();
  const { message } = Route.useSearch();
  const getOrder = useServerFn(ownerGetOrder);
  const order = useQuery({
    queryKey: ["owner-order", orderId],
    queryFn: () => getOrder({ data: { orderId } }),
    refetchInterval: 20_000,
  });

  if (order.isLoading) {
    return <div className="space-y-3"><Skeleton className="h-10 w-40" /><Skeleton className="h-72 w-full" /></div>;
  }

  if (order.error) {
    return <EmptyState title="Couldn't load this order" description="Please try again." action={<Button onClick={() => void order.refetch()}>Retry</Button>} />;
  }

  if (!order.data) {
    return <EmptyState title="Order not found" description="This order may no longer be available." action={<Button asChild variant="outline"><Link to="/owner/orders" search={{}}>Back to orders</Link></Button>} />;
  }

  const details = order.data;
  const { date, time } = orderDateParts(details.createdAt);
  const fullAddress = [details.addressLine, details.area, details.landmark].filter(Boolean).join(", ");
  const mapUrl = details.latitude != null && details.longitude != null
    ? `https://www.google.com/maps?q=${details.latitude},${details.longitude}`
    : null;

  return (
    <div className="min-w-0 space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/owner/orders" search={{}}><ArrowLeft aria-hidden="true" /> Back to orders</Link>
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-muted-foreground">Order details</p>
          <h1 className="break-all font-display text-2xl font-black sm:text-3xl">{details.code}</h1>
          <p className="mt-1 text-sm text-muted-foreground">ID: <span className="break-all">{details.id}</span></p>
        </div>
        <Badge className="shrink-0">{statusLabel(details.status, details.fulfillment)}</Badge>
      </header>

      <Card>
        <CardContent className="space-y-5 p-4 sm:p-5">
          <section aria-labelledby="order-summary-heading">
            <h2 id="order-summary-heading" className="text-xs font-bold uppercase text-muted-foreground">Summary</h2>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Customer</dt><dd className="break-words font-semibold">{details.customerName}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Phone</dt><dd className="break-words font-semibold">{details.customerPhone}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Date</dt><dd className="font-semibold">{date}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Time</dt><dd className="font-semibold">{time}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Type</dt><dd className="font-semibold capitalize">{details.fulfillment}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Channel</dt><dd className="font-semibold capitalize">{details.channel}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="font-semibold">{statusLabel(details.status, details.fulfillment)}</dd></div>
              {details.zoneName ? <div><dt className="text-xs text-muted-foreground">Delivery zone</dt><dd className="font-semibold">{details.zoneName}</dd></div> : null}
              {details.estimatedTime ? <div><dt className="text-xs text-muted-foreground">Estimated time</dt><dd className="font-semibold">{details.estimatedTime}</dd></div> : null}
              <div className="col-span-2 min-w-0 sm:col-span-4">
                <dt className="text-xs text-muted-foreground">{details.fulfillment === "delivery" ? "Delivery address" : "Pickup"}</dt>
                <dd className="break-words font-semibold">
                  {details.fulfillment === "delivery" ? fullAddress || "Address unavailable" : details.pickupNote || "Restaurant pickup"}
                </dd>
                {mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><MapPin className="size-3.5" aria-hidden="true" /> Open location</a> : null}
              </div>
              {details.fulfillment === "delivery" ? (
                <DeliveryLocation
                  place={details.area || details.addressLine || fullAddress || null}
                  distanceM={details.distanceM}
                  point={details.latitude != null && details.longitude != null ? { lat: details.latitude, lng: details.longitude } : null}
                />
              ) : null}
            </dl>
          </section>

          <CustomerNote note={details.deliveryNotes} />
          <StaffOrderItemList items={details.items} showPrices />

          <section aria-labelledby="totals-heading">
            <h2 id="totals-heading" className="text-xs font-bold uppercase text-muted-foreground">Payment & totals</h2>
            <div className="mt-2 grid gap-4 border-t border-border/70 pt-3 sm:grid-cols-2">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Subtotal</dt><dd className="font-semibold">{formatTaka(details.subtotal)}</dd></div>
                {details.discount > 0 ? <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Discount{details.couponCode ? ` (${details.couponCode})` : ""}</dt><dd className="font-semibold">−{formatTaka(details.discount)}</dd></div> : null}
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Delivery charge</dt><dd className="font-semibold">{details.deliveryCharge === 0 && details.fulfillment === "delivery" ? "Free" : formatTaka(details.deliveryCharge)}</dd></div>
                <div className="flex justify-between gap-4 border-t border-border/70 pt-2"><dt className="font-bold">Grand total</dt><dd className="font-display text-lg font-black">{formatTaka(details.total)}</dd></div>
              </dl>
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">Payment method</dt><dd className="font-semibold">{details.paymentLabel}</dd></div>
                {details.channel === "counter" && details.recordedByName ? <div><dt className="text-xs text-muted-foreground">Sold by</dt><dd className="font-semibold">{details.recordedByName}</dd></div> : null}
                {details.couponCode && details.discount === 0 ? <div><dt className="text-xs text-muted-foreground">Coupon</dt><dd className="font-semibold">{details.couponCode}</dd></div> : null}
                {details.riderName ? <div><dt className="text-xs text-muted-foreground">Assigned rider</dt><dd className="flex flex-wrap items-center gap-2 font-semibold"><UserRound className="size-4" aria-hidden="true" /> {details.riderName}{details.riderPhone ? <a href={`tel:${details.riderPhone}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="size-3.5" aria-hidden="true" />{details.riderPhone}</a> : null}</dd></div> : null}
              </dl>
            </div>
          </section>

          {details.channel === "counter" ? (
            <div className="border-t border-border/70 pt-3">
              <PrintReceiptButton
                label="Print Receipt"
                order={{
                  orderCode: details.code,
                  orderId: details.id,
                  createdAt: details.createdAt,
                  customerName: details.customerName,
                  customerPhone: details.customerPhone,
                  items: details.items.map((item) => ({
                    productName: item.name,
                    variantName: item.variantName,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                  })),
                  subtotal: details.subtotal,
                  discount: details.discount,
                  deliveryCharge: details.deliveryCharge,
                  total: details.total,
                  paymentLabel: details.paymentLabel,
                  reprint: true,
                }}
              />
            </div>
          ) : null}

          {details.fulfillment === "delivery" ? (
            <ShareWithRider
              riderName={details.riderName}
              riderPhone={details.riderPhone}
              message={buildRiderMessage({
                code: details.code,
                customerName: details.customerName,
                customerPhone: details.customerPhone,
                area: details.area,
                address: details.addressLine,
                landmark: details.landmark,
                note: details.deliveryNotes,
                distanceM: details.distanceM,
                lat: details.latitude,
                lng: details.longitude,
              })}
            />
          ) : null}

          <OwnerOrderActions order={details} messageOpenInitially={message === true} />
        </CardContent>
      </Card>
    </div>
  );
}
/** Bangladesh-aware normalization for wa.me (digits only, 880 prefix). */
function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = `88${d}`;
  else if (/^1\d{9}$/.test(d)) d = `880${d}`;
  if (/^8801\d{9}$/.test(d)) return d;
  return d.length >= 10 && d.length <= 15 && !d.startsWith("0") ? d : null;
}

function buildRiderMessage(o: {
  code: string; customerName: string; customerPhone: string; area: string | null; address: string | null;
  landmark: string | null; note: string | null; distanceM: number | null; lat: number | null; lng: number | null;
}): string {
  const lines = ["🛵 FLAMIO DELIVERY", "", `📦 Order: #${o.code.replace(/^#/, "")}`, `👤 Customer: ${o.customerName}`, `📞 Customer Phone: ${o.customerPhone}`, ""];
  if (o.area) lines.push(`📍 Area: ${o.area}`);
  if (o.address) lines.push(`🏠 Address: ${o.address}`);
  const extra: string[] = [];
  if (o.landmark) extra.push(`📝 Landmark: ${o.landmark}`);
  if (o.note) extra.push(`📋 Delivery Note: ${o.note}`);
  if (extra.length) lines.push("", ...extra);
  if (o.distanceM != null) lines.push("", `📏 Distance: ${formatDistance(o.distanceM)}`);
  lines.push("");
  if (o.lat != null && o.lng != null) {
    lines.push("🗺️ Delivery Location:", `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`, "", "Please deliver to the exact location shown on the map.");
  } else {
    lines.push("🗺️ Delivery Location: No exact map pin available — please use the address above.");
  }
  return lines.join("\n");
}

function ShareWithRider({ riderName, riderPhone, message }: { riderName: string | null; riderPhone: string | null; message: string }) {
  const [typed, setTyped] = useState("");
  const number = toWhatsAppNumber(riderPhone) ?? toWhatsAppNumber(typed);
  return (
    <section aria-labelledby="share-rider-heading" className="space-y-2 rounded-lg border border-border p-3">
      <h2 id="share-rider-heading" className="text-xs font-bold uppercase text-muted-foreground">Share Delivery with Rider</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Rider</dt><dd className="break-words font-semibold">{riderName ?? "Not assigned"}</dd></div>
        {riderPhone ? <div className="min-w-0"><dt className="text-xs text-muted-foreground">Rider WhatsApp</dt><dd className="break-words font-semibold">{riderPhone}</dd></div> : null}
      </dl>
      {!toWhatsAppNumber(riderPhone) ? (
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">Rider WhatsApp Number</span>
          <input
            type="tel"
            inputMode="tel"
            value={typed}
            onChange={(e) => setTyped(e.target.value.slice(0, 20))}
            placeholder="01XXXXXXXXX"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
      ) : null}
      {number ? (
        <Button asChild className="w-full sm:w-auto">
          <a href={`https://wa.me/${number}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Share Delivery via WhatsApp</a>
        </Button>
      ) : (
        <Button type="button" className="w-full sm:w-auto" disabled>Share Delivery via WhatsApp</Button>
      )}
    </section>
  );
}

function DeliveryLocation({ place, distanceM, point }: { place: string | null; distanceM: number | null; point: { lat: number; lng: number } | null }) {
  const [showMap, setShowMap] = useState(false);
  return (
    <div className="col-span-2 min-w-0 space-y-2 rounded-lg border border-border p-3 sm:col-span-4">
      <dt className="text-xs font-bold uppercase text-muted-foreground">Delivery Location</dt>
      <dd className="space-y-1 text-sm">
        <p className="flex items-start gap-1.5 break-words font-semibold"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />{place ?? "Address unavailable"}</p>
        {distanceM != null ? <p className="text-muted-foreground">📏 {formatDistance(distanceM)} from restaurant</p> : null}
        {!point ? <p className="text-xs text-muted-foreground">No map pin saved for this order.</p> : null}
      </dd>
      {point ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setShowMap((v) => !v)}>
              <MapPin aria-hidden="true" /> {showMap ? "Hide Location" : "View Location"}
            </Button>
            <Button asChild size="sm">
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`} target="_blank" rel="noreferrer">
                <Navigation aria-hidden="true" /> Navigate to Customer
              </a>
            </Button>
          </div>
          {showMap ? <MapPicker center={point} marker={point} zoom={16} height={220} /> : null}
        </>
      ) : null}
    </div>
  );
}
