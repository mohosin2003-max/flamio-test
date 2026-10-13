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
  ownerDeleteRider,
  ownerListRiders,
  ownerSaveRider,
  type RiderRecord,
} from "@/lib/riders.functions";

/**
 * Owner → Riders. Thin UI over the rider server functions. Orders, delivery
 * charges and zones are untouched; riders are only assigned from the Orders
 * screen.
 */
export const Route = createFileRoute("/_authenticated/owner/riders")({
  head: () => ({
    meta: [
      { title: "Riders — Flamio Owner Dashboard" },
      { name: "description", content: "Manage Flamio delivery rider records." },
      { property: "og:title", content: "Riders — Flamio Owner Dashboard" },
      { property: "og:description", content: "Manage Flamio delivery rider records." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerRiders,
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

function OwnerRiders() {
  const list = useServerFn(ownerListRiders);
  const save = useServerFn(ownerSaveRider);
  const remove = useServerFn(ownerDeleteRider);
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const riders = useQuery({
    queryKey: ["owner-riders"],
    queryFn: () => list(),
  });

  if (riders.isLoading) return <Skeleton className="h-96 w-full" />;

  if (riders.error) {
    return (
      <EmptyState
        title="Couldn't load riders"
        description="Something went wrong loading your riders."
        action={<Button onClick={() => void riders.refetch()}>Try again</Button>}
      />
    );
  }

  const rows = riders.data ?? [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["owner-riders"] });
    await queryClient.invalidateQueries({ queryKey: ["owner-orders"] });
  };

  const submit = async () => {
    if (form.name.trim().length < 2) {
      toast.error("Enter a rider name.");
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
      toast.success("Rider saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this rider");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rider: RiderRecord, isActive: boolean) => {
    try {
      await save({
        data: {
          id: rider.id,
          name: rider.name,
          phone: rider.phone,
          note: rider.note,
          isActive,
        },
      });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update this rider");
    }
  };

  const del = async (rider: RiderRecord) => {
    if (!window.confirm(`Remove ${rider.name} from the rider list?`)) return;
    try {
      await remove({ data: { id: rider.id } });
      await refresh();
      toast.success("Rider removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove this rider");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="font-display text-base font-bold">
            {form.id ? "Edit rider" : "New rider"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rd-name">Rider name</Label>
              <Input
                id="rd-name"
                value={form.name}
                placeholder="e.g. Rakib"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rd-phone">Phone (optional)</Label>
              <Input
                id="rd-phone"
                value={form.phone}
                placeholder="01XXXXXXXXX"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rd-note">Note (optional)</Label>
            <Textarea
              id="rd-note"
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
              {form.id ? "Save rider" : "Add rider"}
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
        <h2 className="font-display text-base font-bold">Riders</h2>
        {rows.length === 0 ? (
          <EmptyState
            title="No riders yet"
            description="Add your delivery riders here, then assign them to delivery orders from the Orders screen."
          />
        ) : (
          rows.map((rider) => (
            <Card key={rider.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{rider.name}</h3>
                  <Badge variant={rider.isActive ? "default" : "secondary"}>
                    {rider.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {rider.phone ? (
                  <p className="text-sm text-muted-foreground">{rider.phone}</p>
                ) : null}
                {rider.note ? <p className="text-sm text-muted-foreground">{rider.note}</p> : null}
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={rider.isActive}
                    onCheckedChange={(checked) => void toggleActive(rider, checked)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm({
                        id: rider.id,
                        name: rider.name,
                        phone: rider.phone ?? "",
                        note: rider.note ?? "",
                        isActive: rider.isActive,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${rider.name}`}
                    onClick={() => void del(rider)}
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
