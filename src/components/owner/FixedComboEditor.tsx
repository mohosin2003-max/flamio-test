import { useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  FIXED_COMBO_MAX_QTY, fixedRecipeGroups, offerMaths, regularTotal, type FixedRecipeItem,
} from "@/lib/combos";
import { formatBDT } from "@/lib/format";
import type { Product } from "@/types/menu";

export interface FixedComboForm {
  id: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  offerPrice: number | null;
  isActive: boolean;
  showInOffers: boolean;
  showInPopular: boolean;
  sortOrder: number;
  items: FixedRecipeItem[];
}

export const emptyFixedCombo = (sortOrder: number): FixedComboForm => ({
  id: null, name: "", description: null, imageUrl: null, offerPrice: null,
  isActive: false, showInOffers: true, showInPopular: false, sortOrder, items: [],
});

/** Payload for the existing ownerSaveCombo server function. */
export function fixedComboPayload(f: FixedComboForm) {
  return {
    id: f.id, name: f.name, description: f.description, imageUrl: f.imageUrl,
    pricingMode: "fixed" as const, fixedPrice: f.offerPrice, isActive: f.isActive,
    showInOffers: f.showInOffers, showInPopular: f.showInPopular, sortOrder: f.sortOrder,
    groups: fixedRecipeGroups(f.items),
  };
}

export function FixedComboEditor({
  initial, products, onClose, onSave,
}: {
  initial: FixedComboForm;
  products: Product[];
  onClose: () => void;
  onSave: (form: FixedComboForm) => Promise<void>;
}) {
  const [f, setF] = useState<FixedComboForm>(initial);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  const byId = new Map(products.map((p) => [p.id, p]));
  const rows = f.items.map((i) => ({ ...i, product: byId.get(i.productId) }));
  const regular = regularTotal(rows.map((r) => ({ unitPrice: r.product?.basePrice ?? 0, quantity: r.quantity })));
  const maths = offerMaths(regular, f.offerPrice);
  const setQty = (productId: string, q: number) =>
    setF({ ...f, items: f.items.map((i) => (i.productId === productId ? { ...i, quantity: Math.min(Math.max(q, 1), FIXED_COMBO_MAX_QTY) } : i)) });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{f.id ? "Edit fixed combo" : "New fixed combo"}</DialogTitle>
          <p className="text-sm text-muted-foreground">A ready-made bundle: customers get exactly these items at one offer price.</p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="fc-name">Combo name</Label>
            <Input id="fc-name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="fc-desc">Description</Label>
            <Textarea id="fc-desc" maxLength={400} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value || null })} /></div>
          <div className="space-y-1.5"><Label htmlFor="fc-img">Combo picture link</Label>
            <Input id="fc-img" placeholder="https://…" maxLength={600} value={f.imageUrl ?? ""} onChange={(e) => setF({ ...f, imageUrl: e.target.value || null })} />
            {f.imageUrl ? <img src={f.imageUrl} alt="Combo picture preview" className="mt-2 h-28 w-full rounded-lg object-cover" /> : null}</div>

          <div className="space-y-2 rounded-xl border border-border p-3">
            <p className="text-sm font-semibold">Items in this combo</p>
            <div className="flex gap-2">
              <select aria-label="Add a menu item" className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose a menu item…</option>
                {products.filter((p) => !f.items.some((i) => i.productId === p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {formatBDT(p.basePrice)}{p.isAvailable ? "" : " (sold out)"}</option>
                ))}
              </select>
              <Button type="button" variant="outline" disabled={!pick} onClick={() => { setF({ ...f, items: [...f.items, { productId: pick, quantity: 1 }] }); setPick(""); }}>
                <Plus className="mr-1 h-4 w-4" />Add</Button>
            </div>
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">No items yet.</p> : rows.map((r) => (
              <div key={r.productId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{r.product?.name ?? "Removed item"}</p>
                  <p className="text-xs text-muted-foreground">{formatBDT(r.product?.basePrice ?? 0)} each</p></div>
                <div className="flex items-center gap-1">
                  <Button type="button" size="icon" variant="outline" aria-label="Less" onClick={() => setQty(r.productId, r.quantity - 1)}><Minus className="h-4 w-4" /></Button>
                  <span className="w-8 text-center text-sm font-semibold" aria-label="Quantity">{r.quantity}</span>
                  <Button type="button" size="icon" variant="outline" aria-label="More" onClick={() => setQty(r.productId, r.quantity + 1)}><Plus className="h-4 w-4" /></Button>
                  <span className="w-20 text-right text-sm">{formatBDT((r.product?.basePrice ?? 0) * r.quantity)}</span>
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${r.product?.name ?? "item"}`} onClick={() => setF({ ...f, items: f.items.filter((i) => i.productId !== r.productId) })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
            <div className="flex justify-between"><span>Regular total</span><span>{formatBDT(regular)}</span></div>
            <div className="flex items-center justify-between gap-3"><Label htmlFor="fc-price">Offer price (৳)</Label>
              <Input id="fc-price" type="number" min={1} className="w-32" value={f.offerPrice ?? ""} onChange={(e) => setF({ ...f, offerPrice: e.target.value === "" ? null : Number(e.target.value) })} /></div>
            <div className="flex justify-between"><span>Save</span><span>{formatBDT(maths.savings)}</span></div>
            <div className="flex justify-between font-semibold"><span>Discount</span><span>{maths.discountPercent}% OFF</span></div>
            {maths.error ? <p className="text-xs text-destructive">{maths.error}</p> : null}
          </div>

          <div className="space-y-2 rounded-xl border border-border p-3">
            <label className="flex items-center justify-between gap-3 text-sm"><span><b>Active</b> — master on/off for customers</span>
              <Switch checked={f.isActive} onCheckedChange={(c) => setF({ ...f, isActive: c })} aria-label="Active" /></label>
            <label className="flex items-center justify-between gap-3 text-sm"><span>Show in Offers</span>
              <Switch checked={f.showInOffers} onCheckedChange={(c) => setF({ ...f, showInOffers: c })} aria-label="Show in Offers" /></label>
            <label className="flex items-center justify-between gap-3 text-sm"><span>Show in Home Popular</span>
              <Switch checked={f.showInPopular} onCheckedChange={(c) => setF({ ...f, showInPopular: c })} aria-label="Show in Home Popular" /></label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={async () => {
            if (f.items.length === 0) { toast.error("Add at least one item."); return; }
            if (!maths.valid) { toast.error(maths.error ?? "Check the offer price."); return; }
            setSaving(true);
            try { await onSave(f); } finally { setSaving(false); }
          }}>{saving ? "Saving…" : "Save fixed combo"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
