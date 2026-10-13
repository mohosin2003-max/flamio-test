import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, MapPin, Pencil, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { LocationFields } from "@/components/address/LocationFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useSavedAddresses } from "@/hooks/use-saved-addresses";
import { deliveryQueryOptions } from "@/lib/delivery";
import { emptyAddress } from "@/lib/addresses";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { CustomerAddress } from "@/types/menu";

export const Route = createFileRoute("/_authenticated/account/addresses")({
  head: () => ({
    meta: [
      { title: "Saved Addresses — Flamio" },
      { name: "description", content: "Manage your saved delivery addresses for faster checkout." },
      { property: "og:title", content: "Saved Addresses — Flamio" },
      { property: "og:description", content: "Manage your saved Flamio delivery addresses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(deliveryQueryOptions()),
  component: AddressesPage,
});

function AddressesPage() {
  const { zones } = useSuspenseQuery(deliveryQueryOptions()).data;
  const { addresses, isLoading, error, isSaving, save, remove, setDefault } = useSavedAddresses();

  const [form, setForm] = useState<CustomerAddress | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!form || isSaving) return;

    if (form.fullName.trim().length < 2) {
      toast.error("Please enter the full name.");
      return;
    }
    if (!isValidPhone(form.phone)) {
      toast.error("Please enter a valid phone number.");
      return;
    }
    if (form.addressLine.trim().length < 5) {
      toast.error("Please enter the full address.");
      return;
    }

    try {
      await save({
        ...form,
        fullName: form.fullName.trim(),
        phone: normalizePhone(form.phone),
        addressLine: form.addressLine.trim(),
        isDefault: form.isDefault || addresses.length === 0,
      });
      toast.success("Address saved");
      setForm(null);
    } catch {
      toast.error("We couldn't save this address. Please try again.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 pb-28 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-black sm:text-4xl">Saved Addresses</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Save the places you order to and pick one at checkout.
      </p>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : error ? (
        <p role="alert" className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : addresses.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No saved addresses yet"
            description="Add your first address so checkout only takes a few taps."
            action={<Button onClick={() => setForm(emptyAddress())}>Add address</Button>}
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {addresses.map((a) => (
            <li
              key={a.id}
              className={cn(
                "flex items-start gap-2 rounded-2xl border bg-card px-4 py-4 shadow-card",
                a.isDefault ? "border-primary/60" : "border-border/70",
              )}
            >
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {a.label || a.fullName}
                  {a.isDefault ? (
                    <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-foreground">
                      Default
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[a.addressLine, a.area, a.landmark].filter(Boolean).join(", ")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">+{a.phone}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                {!a.isDefault && (
                  <button
                    type="button"
                    aria-label="Set as default address"
                    className="rounded-md p-2 text-muted-foreground hover:text-foreground"
                    onClick={() => void setDefault(a.id).then(() => toast.success("Default updated"))}
                  >
                    <Star className="size-4" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Edit address"
                  className="rounded-md p-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setForm(a)}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete address"
                  className="rounded-md p-2 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    void remove(a.id)
                      .then(() => toast.success("Address deleted"))
                      .catch(() => toast.error("We couldn't delete this address."))
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {addresses.length > 0 && !form && (
        <Button className="mt-4" variant="outline" onClick={() => setForm(emptyAddress())}>
          Add new address
        </Button>
      )}

      {form && (
        <form
          onSubmit={handleSubmit}
          className="mt-6 space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-card sm:p-6"
        >
          <h2 className="font-display text-lg font-extrabold">
            {addresses.some((a) => a.id === form.id) ? "Edit address" : "New address"}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="label">Label (optional)</Label>
              <Input
                id="label"
                value={form.label ?? ""}
                onChange={(e) => setForm({ ...form, label: e.target.value || null })}
                placeholder="Home, Office"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr-name">Full name</Label>
              <Input
                id="addr-name"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr-phone">Phone number</Label>
              <Input
                id="addr-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
          </div>

          <LocationFields
            point={
              form.latitude !== null && form.longitude !== null
                ? { lat: form.latitude, lng: form.longitude }
                : null
            }
            onPoint={(p) => setForm((f) => (f ? { ...f, latitude: p.lat, longitude: p.lng } : f))}
            area={form.area ?? ""}
            onArea={(v) => setForm((f) => (f ? { ...f, area: v || null } : f))}
            onGeocoded={(label) =>
              setForm((f) => (f && !f.addressLine.trim() ? { ...f, addressLine: label } : f))
            }
          />

          <div className="space-y-2">
            <Label htmlFor="addr-line">Address</Label>
            <Textarea
              id="addr-line"
              value={form.addressLine}
              onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
              rows={2}
              autoComplete="street-address"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="addr-landmark">Landmark (optional)</Label>
            <Input
              id="addr-landmark"
              value={form.landmark ?? ""}
              onChange={(e) => setForm({ ...form, landmark: e.target.value || null })}
            />
          </div>

          {zones.length > 0 && (
            <div className="space-y-2">
              <Label>Delivery zone</Label>
              <div className="flex flex-wrap gap-2">
                {zones.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    aria-pressed={form.zoneId === z.id}
                    onClick={() => setForm({ ...form, zoneId: z.id })}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm transition-smooth",
                      form.zoneId === z.id
                        ? "border-primary bg-secondary text-foreground"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {z.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            Use as my default address
          </label>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSaving} aria-busy={isSaving}>
              {isSaving && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isSaving ? "Saving..." : "Save address"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
