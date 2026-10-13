import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ownerDeleteSupplier,
  ownerListSuppliers,
  ownerSaveSupplier,
  type SupplierRecord,
} from "@/lib/suppliers.functions";

/**
 * Owner → Suppliers. Thin UI over the supplier server functions. Purchases and
 * their history are untouched; this list only feeds the supplier name field.
 */
export const Route = createFileRoute("/_authenticated/owner/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers — Flamio Owner Dashboard" },
      { name: "description", content: "Manage Flamio supplier records for purchases." },
      { property: "og:title", content: "Suppliers — Flamio Owner Dashboard" },
      { property: "og:description", content: "Manage Flamio supplier records for purchases." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerSuppliers,
});

type FormState = {
  id: string | null;
  name: string;
  phone: string;
  note: string;
  isActive: boolean;
};

const emptyForm = (): FormState => ({
  id: null,
  name: "",
  phone: "",
  note: "",
  isActive: true,
});

function OwnerSuppliers() {
  const list = useServerFn(ownerListSuppliers);
  const save = useServerFn(ownerSaveSupplier);
  const remove = useServerFn(ownerDeleteSupplier);
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const suppliers = useQuery({
    queryKey: ["owner-suppliers"],
    queryFn: () => list(),
  });

  if (suppliers.isLoading) return <Skeleton className="h-96 w-full" />;

  if (suppliers.error) {
    return (
      <EmptyState
        title="Couldn't load suppliers"
        description="Something went wrong loading your suppliers."
        action={<Button onClick={() => void suppliers.refetch()}>Try again</Button>}
      />
    );
  }

  const rows = suppliers.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner-suppliers"] });

  const submit = async () => {
    if (form.name.trim().length < 2) {
      toast.error("Enter a supplier name.");
      return;
    }
    setSaving(true);
    try {
      await save({
        data: {
          id: form.id,
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          note: form.note.trim() || null,
          isActive: form.isActive,
        },
      });
      await refresh();
      setForm(emptyForm());
      toast.success("Supplier saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this supplier");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (supplier: SupplierRecord, isActive: boolean) => {
    try {
      await save({
        data: {
          id: supplier.id,
          name: supplier.name,
          phone: supplier.phone,
          note: supplier.note,
          isActive,
        },
      });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update this supplier");
    }
  };

  const del = async (supplier: SupplierRecord) => {
    if (!window.confirm(`Remove ${supplier.name} from the supplier list?`)) return;
    try {
      await remove({ data: { id: supplier.id } });
      await refresh();
      toast.success("Supplier removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove this supplier");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="font-display text-base font-bold">
            {form.id ? "Edit supplier" : "New supplier"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sp-name">Supplier name</Label>
              <Input
                id="sp-name"
                value={form.name}
                placeholder="e.g. Karwan Bazar Traders"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-phone">Phone / contact (optional)</Label>
              <Input
                id="sp-phone"
                value={form.phone}
                placeholder="01XXXXXXXXX"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp-note">Address / note (optional)</Label>
            <Textarea
              id="sp-note"
              value={form.note}
              rows={2}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <span className="text-sm font-medium">Active</span>
            <Switch
              checked={form.isActive}
              onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void submit()} disabled={saving}>
              {form.id ? "Save supplier" : "Add supplier"}
            </Button>
            {form.id ? (
              <Button variant="outline" onClick={() => setForm(emptyForm())}>
                Cancel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="font-display text-base font-bold">Suppliers</h2>
        {rows.length === 0 ? (
          <EmptyState
            title="No suppliers yet"
            description="Add your regular suppliers here. Supplier stays optional when recording a purchase."
          />
        ) : (
          rows.map((supplier) => (
            <Card key={supplier.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{supplier.name}</h3>
                  <Badge variant={supplier.isActive ? "default" : "secondary"}>
                    {supplier.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {supplier.phone ? (
                  <p className="text-sm text-muted-foreground">{supplier.phone}</p>
                ) : null}
                {supplier.note ? (
                  <p className="text-sm text-muted-foreground">{supplier.note}</p>
                ) : null}
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={supplier.isActive}
                    onCheckedChange={(checked) => void toggleActive(supplier, checked)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm({
                        id: supplier.id,
                        name: supplier.name,
                        phone: supplier.phone ?? "",
                        note: supplier.note ?? "",
                        isActive: supplier.isActive,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${supplier.name}`}
                    onClick={() => void del(supplier)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
