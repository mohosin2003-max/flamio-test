import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatBDT } from "@/lib/format";
import {
  ownerDeleteCoupon,
  ownerListCoupons,
  ownerSaveCoupon,
  type CouponRecord,
} from "@/lib/coupons.functions";

/**
 * Owner → Coupons. Thin UI over the EXISTING coupon server functions; all
 * validation and pricing stays server-side.
 */
export const Route = createFileRoute("/_authenticated/owner/coupons")({
  head: () => ({
    meta: [
      { title: "Coupons — Flamio Owner Dashboard" },
      { name: "description", content: "Create and manage Flamio discount coupons." },
      { property: "og:title", content: "Coupons — Flamio Owner Dashboard" },
      { property: "og:description", content: "Create and manage Flamio discount coupons." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerCoupons,
});

type FormState = {
  id: string | null;
  code: string;
  description: string;
  discountType: "percent" | "fixed";
  discountValue: string;
  minOrderTotal: string;
  maxDiscount: string;
  startsOn: string;
  expiresOn: string;
  usageLimit: string;
  isActive: boolean;
};

const emptyForm = (): FormState => ({
  id: null,
  code: "",
  description: "",
  discountType: "percent",
  discountValue: "10",
  minOrderTotal: "0",
  maxDiscount: "",
  startsOn: "",
  expiresOn: "",
  usageLimit: "",
  isActive: true,
});

function toForm(c: CouponRecord): FormState {
  return {
    id: c.id,
    code: c.code,
    description: c.description ?? "",
    discountType: c.discountType,
    discountValue: String(c.discountValue),
    minOrderTotal: String(c.minOrderTotal),
    maxDiscount: c.maxDiscount === null ? "" : String(c.maxDiscount),
    startsOn: c.startsOn ?? "",
    expiresOn: c.expiresOn ?? "",
    usageLimit: c.usageLimit === null ? "" : String(c.usageLimit),
    isActive: c.isActive,
  };
}

function OwnerCoupons() {
  const list = useServerFn(ownerListCoupons);
  const save = useServerFn(ownerSaveCoupon);
  const remove = useServerFn(ownerDeleteCoupon);
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const coupons = useQuery({
    queryKey: ["owner-coupons"],
    queryFn: () => list(),
  });

  if (coupons.isLoading) return <Skeleton className="h-96 w-full" />;

  if (coupons.error) {
    return (
      <EmptyState
        title="Couldn't load coupons"
        description="Something went wrong loading your coupons."
        action={<Button onClick={() => void coupons.refetch()}>Try again</Button>}
      />
    );
  }

  const rows = coupons.data ?? [];

  const submit = async () => {
    setSaving(true);
    try {
      await save({
        data: {
          id: form.id,
          code: form.code.trim(),
          description: form.description.trim() || null,
          discountType: form.discountType,
          discountValue: Number(form.discountValue) || 0,
          minOrderTotal: Number(form.minOrderTotal) || 0,
          maxDiscount: form.maxDiscount.trim() ? Number(form.maxDiscount) : null,
          startsOn: form.startsOn || null,
          expiresOn: form.expiresOn || null,
          usageLimit: form.usageLimit.trim() ? Number(form.usageLimit) : null,
          isActive: form.isActive,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["owner-coupons"] });
      setForm(emptyForm());
      toast.success("Coupon saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this coupon");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="font-display text-base font-bold">
            {form.id ? "Edit coupon" : "New coupon"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp-code">Code</Label>
              <Input
                id="cp-code"
                value={form.code}
                placeholder="FLAMIO10"
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-desc">Description (optional)</Label>
              <Input
                id="cp-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Discount type</Label>
              <Select
                value={form.discountType}
                onValueChange={(value) =>
                  setForm({ ...form, discountType: value as "percent" | "fixed" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percentage off</SelectItem>
                  <SelectItem value="fixed">Fixed amount off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-value">
                {form.discountType === "percent" ? "Percent off" : "Amount off"}
              </Label>
              <Input
                id="cp-value"
                type="number"
                min="0"
                step="0.01"
                value={form.discountValue}
                onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-min">Minimum order</Label>
              <Input
                id="cp-min"
                type="number"
                min="0"
                step="0.01"
                value={form.minOrderTotal}
                onChange={(e) => setForm({ ...form, minOrderTotal: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-max">Maximum discount (optional)</Label>
              <Input
                id="cp-max"
                type="number"
                min="0"
                step="0.01"
                value={form.maxDiscount}
                onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-start">Starts on (optional)</Label>
              <Input
                id="cp-start"
                type="date"
                value={form.startsOn}
                onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-end">Expires on (optional)</Label>
              <Input
                id="cp-end"
                type="date"
                value={form.expiresOn}
                onChange={(e) => setForm({ ...form, expiresOn: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-limit">Usage limit (optional)</Label>
              <Input
                id="cp-limit"
                type="number"
                min="1"
                step="1"
                value={form.usageLimit}
                onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <Label htmlFor="cp-active">Active</Label>
              <Switch
                id="cp-active"
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={saving} onClick={() => void submit()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {form.id ? "Save changes" : "Create coupon"}
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
        <h2 className="font-display text-base font-bold">Coupons</h2>
        {rows.length === 0 ? (
          <EmptyState title="No coupons yet" description="Create a coupon to offer a discount." />
        ) : (
          rows.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    {c.code}
                    <Badge variant={c.isActive ? "default" : "secondary"}>
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>

                  <p className="mt-1 text-sm text-muted-foreground">
                    {c.discountType === "percent"
                      ? `${c.discountValue}% off`
                      : `${formatBDT(c.discountValue)} off`}
                    {c.minOrderTotal > 0 ? ` · min ${formatBDT(c.minOrderTotal)}` : ""}
                    {c.expiresOn ? ` · until ${c.expiresOn}` : ""}
                    {` · used ${c.timesUsed}${c.usageLimit ? `/${c.usageLimit}` : ""}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setForm(toForm(c))}>
                    Edit
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete coupon ${c.code}`}
                    onClick={async () => {
                      try {
                        await remove({ data: { id: c.id } });
                        await queryClient.invalidateQueries({ queryKey: ["owner-coupons"] });
                        toast.success("Coupon deleted");
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Couldn't delete this coupon",
                        );
                      }
                    }}
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
