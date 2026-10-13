import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Percent, Plus } from "lucide-react";
import { toast } from "sonner";

import { PrintReceiptButton, type PrintReceiptOrder } from "@/components/order/PrintReceiptButton";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardAccess } from "@/hooks/use-dashboard-access";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatTaka } from "@/lib/format";
import { placeholderByCategorySlug } from "@/lib/menu-repository";
import { placeOrder } from "@/lib/orders.functions";
import { ownerGetCatalog, ownerSetCounterPrice } from "@/lib/owner.functions";

function clampDiscount(amount: number, subtotal: number): number {
  return Math.max(0, Math.min(amount, subtotal));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Counter (POS) sales. This is a thin till on top of the EXISTING order
 * architecture: it calls the same `placeOrder` server function as checkout, so
 * the sale lands in the existing orders table, appears in the existing Kitchen
 * queue and consumes ingredients through the existing inventory logic
 * (Advanced mode). No separate POS order or inventory system.
 */
export const Route = createFileRoute("/_authenticated/owner/pos")({
  head: () => ({
    meta: [
      { title: "Counter Sale — Flamio Owner Dashboard" },
      { name: "description", content: "Record Flamio counter sales and discounts." },
      { property: "og:title", content: "Counter Sale — Flamio Owner Dashboard" },
      { property: "og:description", content: "Record Flamio counter sales and discounts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerPos,
});

let latestCounterSaleReceipt: PrintReceiptOrder | null = null;

function OwnerPos() {
  const getCatalog = useServerFn(ownerGetCatalog);
  const submitOrder = useServerFn(placeOrder);
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { isManager } = useDashboardAccess();

  const [lines, setLines] = useState<Record<string, number>>({});
  // Owner-only editor for the saved Counter Sale price (products.counter_price).
  const saveCounterPrice = useServerFn(ownerSetCounterPrice);
  const [priceEditId, setPriceEditId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("Walk-in customer");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [saving, setSaving] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  // Snapshot of the last SAVED sale, kept only so the cashier can optionally
  // print its receipt. It never re-submits anything.
  const [lastSale, setLastSale] = useState<PrintReceiptOrder | null>(
    () => latestCounterSaleReceipt,
  );

  const catalog = useQuery({
    queryKey: ["owner-catalog"],
    queryFn: () => getCatalog(),
  });

  const products = (catalog.data?.products ?? []).filter((p) => p.isAvailable);
  const categories = catalog.data?.categories ?? [];

  // Saved Counter Sale price when set, otherwise the normal menu price.
  // The server enforces the same rule when the sale is recorded.
  const counterById = new Map(products.map((p) => [p.id, p.counterPrice ?? null]));
  const priceFor = (productId: string, basePrice: number) =>
    counterById.get(productId) ?? basePrice;

  const total = useMemo(
    () =>
      products.reduce(
        (sum, product) =>
          sum + (product.counterPrice ?? product.basePrice) * (lines[product.id] ?? 0),
        0,
      ),
    [products, lines],
  );
  const itemCount = Object.values(lines).reduce((sum, n) => sum + n, 0);

  const subtotal = total;
  const discountAmountNum = useMemo(() => {
    const parsed = parseFloat(discountAmount);
    return Number.isNaN(parsed) ? 0 : clampDiscount(round2(parsed), subtotal);
  }, [discountAmount, subtotal]);
  const discountPercentNum = useMemo(() => {
    if (subtotal <= 0 || discountAmountNum <= 0) return 0;
    return round2((discountAmountNum / subtotal) * 100);
  }, [discountAmountNum, subtotal]);
  const finalTotal = useMemo(
    () => Math.max(round2(subtotal - discountAmountNum), 0),
    [subtotal, discountAmountNum],
  );

  useEffect(() => {
    if (subtotal <= 0) {
      setDiscountAmount("");
      setDiscountPercent("");
      return;
    }
    const parsed = parseFloat(discountAmount);
    if (discountAmount !== "" && !Number.isNaN(parsed) && parsed > subtotal) {
      setDiscountAmount(round2(subtotal).toString());
      setDiscountPercent("100");
    }
  }, [subtotal]);

  const updateDiscountAmount = (value: string) => {
    setDiscountAmount(value);
    const parsed = parseFloat(value);
    if (value === "" || Number.isNaN(parsed) || subtotal <= 0) {
      setDiscountPercent("");
      return;
    }
    const clamped = clampDiscount(round2(parsed), subtotal);
    setDiscountPercent(round2((clamped / subtotal) * 100).toString());
  };

  const updateDiscountPercent = (value: string) => {
    setDiscountPercent(value);
    const parsed = parseFloat(value);
    if (value === "" || Number.isNaN(parsed) || subtotal <= 0) {
      setDiscountAmount("");
      return;
    }
    const pct = Math.max(0, Math.min(parsed, 100));
    setDiscountAmount(round2((subtotal * pct) / 100).toString());
  };

  if (catalog.isLoading) return <Skeleton className="h-96 w-full" />;

  if (catalog.error) {
    return (
      <EmptyState
        title="Couldn't load the menu"
        description="Please try again."
        action={<Button onClick={() => void catalog.refetch()}>Try again</Button>}
      />
    );
  }

  const bump = (id: string, delta: number) =>
    setLines((prev) => {
      const next = Math.max((prev[id] ?? 0) + delta, 0);
      const copy = { ...prev };
      if (next === 0) {
        delete copy[id];
        setPriceEditId((prevEdit) => (prevEdit === id ? null : prevEdit));
      } else copy[id] = next;
      return copy;
    });

  const commitPriceEdit = async (productId: string, basePrice: number) => {
    const raw = priceDraft.trim();
    const parsed = raw === "" ? null : parseFloat(raw);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
      toast.error("Enter a valid price.");
      setPriceEditId(null);
      return;
    }
    setPriceEditId(null);
    // Same as the normal price (or empty) clears the saved Counter Sale price.
    const price = parsed === null || round2(parsed) === basePrice ? null : round2(parsed);
    try {
      await saveCounterPrice({ data: { productId, price } });
      await queryClient.invalidateQueries({ queryKey: ["owner-catalog"] });
      toast.success(price === null ? "Counter price reset to normal price" : "Counter price saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the Counter Sale price.");
    }
  };

  const charge = async () => {
    const selected = products.filter((p) => (lines[p.id] ?? 0) > 0);
    if (selected.length === 0) {
      toast.error("Add at least one item to the sale.");
      return;
    }
    setSaving(true);
    try {
      const result = await submitOrder({
        data: {
          // Counter sale: completed/sold immediately, no online status flow.
          channel: "counter",
          fulfillment: "pickup",
          paymentMethod: "cash",
          paymentLabel: "Cash at counter (POS)",
          customerName: customerName.trim() || "Walk-in customer",
          customerPhone: customerPhone.trim() || "000000",
          addressLine: null,
          area: null,
          landmark: null,
          deliveryNotes: null,
          zoneId: null,
          zoneName: null,
          estimatedTime: null,
          pickupNote: "Counter sale",
          subtotal,
          discount: discountAmountNum,
          deliveryCharge: 0,
          total: finalTotal,
          items: selected.map((p) => ({
            productId: p.id,
            productSlug: p.slug,
            productName: p.name,
            variantId: null,
            variantName: null,
            unitPrice: priceFor(p.id, p.basePrice),
            quantity: lines[p.id] ?? 1,
            imageUrl: p.imageUrl,
          })),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["owner-inventory"] });
      const receipt: PrintReceiptOrder = {
        orderCode: result.code,
        orderId: result.id,
        createdAt: result.createdAt,
        cashierName: profile?.fullName ?? null,
        customerName: customerName.trim() || "Walk-in customer",
        customerPhone: customerPhone.trim() || null,
        items: selected.map((p) => ({
          productName: p.name,
          quantity: lines[p.id] ?? 1,
          unitPrice: priceFor(p.id, p.basePrice),
        })),
        subtotal,
        discount: discountAmountNum,
        deliveryCharge: 0,
        total: finalTotal,
        paymentLabel: "Cash at counter (POS)",
      };
      latestCounterSaleReceipt = receipt;
      setLastSale(receipt);
      setLines({});
      setPriceEditId(null);
      setCustomerPhone("");
      setDiscountAmount("");
      setDiscountPercent("");
      toast.success(`Sale recorded — ${result.code}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't record this sale");
    } finally {
      setSaving(false);
    }
  };

  const visibleCategories = categories.filter((c) =>
    products.some((p) => p.categoryId === c.id),
  );
  const selectedCategory = activeCategory ?? visibleCategories[0]?.id ?? null;
  const visibleProducts = products.filter((p) => p.categoryId === selectedCategory);

  return (
    <div className="space-y-5">
      {products.length === 0 ? (
        <EmptyState
          title="No items available"
          description="Make menu items available to sell them at the counter."
        />
      ) : (
        <>
          {/* Category switcher — existing categories, horizontal scroll on mobile */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {visibleCategories.map((category) => (
              <Button
                key={category.id}
                size="sm"
                variant={category.id === selectedCategory ? "default" : "outline"}
                className="shrink-0"
                onClick={() => setActiveCategory(category.id)}
              >
                {category.name}
              </Button>
            ))}
          </div>

          {/* Visual product grid — same catalog data/images as the customer menu */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visibleProducts.map((product) => {
              const qty = lines[product.id] ?? 0;
              const categorySlug =
                categories.find((c) => c.id === product.categoryId)?.slug ?? "";
              const imageUrl =
                product.imageUrl ?? placeholderByCategorySlug[categorySlug] ?? null;
              return (
                <Card key={product.id} className="overflow-hidden">
                  <button
                    type="button"
                    className="block w-full text-left"
                    aria-label={`Add one ${product.name}`}
                    onClick={() => bump(product.id, 1)}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={product.name}
                        className="aspect-[4/3] w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="grid aspect-[4/3] w-full place-items-center bg-muted text-2xl font-bold text-muted-foreground">
                        {product.name.charAt(0)}
                      </div>
                    )}
                    <div className="space-y-0.5 p-2.5">
                      <p className="truncate text-sm font-semibold">{product.name}</p>
                      <p className="text-sm font-bold text-primary">
                        {formatTaka(priceFor(product.id, product.basePrice))}
                      </p>
                    </div>
                  </button>
                  <div className="space-y-1.5 px-2.5 pb-2.5">
                    {isManager ? (
                      priceEditId === product.id ? (
                        <Input
                          autoFocus
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-7 text-xs"
                          aria-label={`Counter Sale price for ${product.name}`}
                          value={priceDraft}
                          onChange={(e) => setPriceDraft(e.target.value)}
                          onBlur={() => void commitPriceEdit(product.id, product.basePrice)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitPriceEdit(product.id, product.basePrice);
                            if (e.key === "Escape") setPriceEditId(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="text-[11px] text-muted-foreground underline underline-offset-2"
                          onClick={() => {
                            setPriceEditId(product.id);
                            setPriceDraft(String(priceFor(product.id, product.basePrice)));
                          }}
                        >
                          Set counter price
                        </button>
                      )
                    ) : null}
                    <div className="flex items-center justify-between gap-2">
                    {qty > 0 ? (
                      <>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-9 w-9 shrink-0"
                          aria-label={`Remove one ${product.name}`}
                          onClick={() => bump(product.id, -1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-semibold">{qty}</span>
                        <Button
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          aria-label={`Add one ${product.name}`}
                          onClick={() => bump(product.id, 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        className="h-9 w-full"
                        aria-label={`Add one ${product.name}`}
                        onClick={() => bump(product.id, 1)}
                      >
                        <Plus className="mr-1 h-4 w-4" /> Add
                      </Button>
                    )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pos-name">Customer name</Label>
              <Input
                id="pos-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-phone">Phone (optional)</Label>
              <Input
                id="pos-phone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {discountAmountNum > 0
                ? `Discount: ${formatTaka(discountAmountNum)} (${discountPercentNum}%)`
                : "No discount applied"}
            </span>
            <Popover open={discountOpen} onOpenChange={setDiscountOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Percent className="h-4 w-4" />
                  {discountAmountNum > 0 ? `${formatTaka(discountAmountNum)} off` : "Discount"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-3" align="end">
                <p className="text-sm font-medium">Add discount</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={discountMode === "amount" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDiscountMode("amount")}
                  >
                    ৳ Amount
                  </Button>
                  <Button
                    type="button"
                    variant={discountMode === "percent" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDiscountMode("percent")}
                  >
                    % Percentage
                  </Button>
                </div>
                {discountMode === "amount" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="pos-discount-amount">Discount Amount (৳)</Label>
                    <Input
                      id="pos-discount-amount"
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0"
                      value={discountAmount}
                      onChange={(e) => updateDiscountAmount(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="pos-discount-percent">Discount (%)</Label>
                    <Input
                      id="pos-discount-percent"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      placeholder="0"
                      value={discountPercent}
                      onChange={(e) => updateDiscountPercent(e.target.value)}
                    />
                  </div>
                )}
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => setDiscountOpen(false)}
                >
                  Apply
                </Button>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatTaka(subtotal)}</span>
            </div>
            {discountAmountNum > 0 ? (
              <div className="flex items-center justify-between text-sm text-destructive">
                <span>Discount</span>
                <span>-{formatTaka(discountAmountNum)} ({discountPercentNum}%)</span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{itemCount} items</Badge>
                <span className="text-sm text-muted-foreground">Cash sale</span>
              </div>
              <span className="font-display text-lg font-bold">{formatTaka(finalTotal)}</span>
            </div>
          </div>
          <Button disabled={saving} onClick={() => void charge()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Take payment &amp; send to kitchen
          </Button>
        </CardContent>
      </Card>

      {/* Optional receipt for the last saved sale. Printing is never required. */}
      {lastSale ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Sale saved — {lastSale.orderCode}</p>
              <p className="text-xs text-muted-foreground">
                {formatTaka(lastSale.total)} · printing is optional
              </p>
            </div>
            <PrintReceiptButton order={lastSale} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
