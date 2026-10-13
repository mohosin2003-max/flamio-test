import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { HoursSettings } from "@/lib/opening-hours";
import { isOpenAt } from "@/lib/opening-hours";
import { ownerGetScheduling, ownerUpdateScheduling } from "@/lib/scheduling.functions";

export function ScheduledOrdersSettings() {
  const getFn = useServerFn(ownerGetScheduling);
  const saveFn = useServerFn(ownerUpdateScheduling);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["owner-scheduling"], queryFn: () => getFn() });
  const [form, setForm] = useState<HoursSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);
  if (!form) return null;
  const set = <K extends keyof HoursSettings>(k: K, v: HoursSettings[K]) => setForm({ ...form, [k]: v });
  const num = (k: "maxAdvanceDays" | "prepMinutes" | "slotMinutes", v: string) => set(k, Math.max(0, Math.round(Number(v) || 0)));
  const openNow = isOpenAt(form);

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: {
        autoHours: form.autoHours,
        scheduledEnabled: form.scheduledEnabled,
        maxAdvanceDays: Math.min(Math.max(form.maxAdvanceDays, 1), 14),
        paymentRequired: form.paymentRequired,
        prepMinutes: Math.min(form.prepMinutes, 240),
        slotMinutes: Math.min(Math.max(form.slotMinutes, 10), 120),
        allowWhileClosed: form.allowWhileClosed,
      } });
      toast.success("Opening hours & scheduling saved");
      qc.invalidateQueries({ queryKey: ["owner-scheduling"] });
      qc.invalidateQueries({ queryKey: ["public-hours"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const Row = ({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between rounded-lg border border-border p-3">
      <div className="pr-3"><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{hint}</p></div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <h2 className="font-display text-lg font-bold">Opening hours & scheduled orders</h2>
          <p className="text-sm text-muted-foreground">Right now: <span className={openNow ? "font-semibold text-primary" : "font-semibold text-destructive"}>{openNow ? "Open" : "Closed"}</span> (Bangladesh time, based on saved hours).</p>
        </div>
        <Row title="Open & close automatically" hint="Uses the Opening and Closing time below. 'Accepting orders' off still closes the restaurant." checked={form.autoHours} onChange={(v) => set("autoHours", v)} />
        <Row title="Scheduled orders" hint="Let customers order ahead for a later time." checked={form.scheduledEnabled} onChange={(v) => set("scheduledEnabled", v)} />
        <Row title="Allow scheduling while closed" hint="Customers can schedule for when you open next." checked={form.allowWhileClosed} onChange={(v) => set("allowWhileClosed", v)} />
        <Row title="Payment required for scheduled orders" hint="Scheduled orders must be paid online before they are accepted." checked={form.paymentRequired} onChange={(v) => set("paymentRequired", v)} />
        {form.paymentRequired ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Online payment isn't available yet, so customers can't place scheduled orders while this is on.</p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label>Book up to (days ahead)</Label><Input type="number" min={1} max={14} value={form.maxAdvanceDays} onChange={(e) => num("maxAdvanceDays", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Preparation time (minutes)</Label><Input type="number" min={0} max={240} value={form.prepMinutes} onChange={(e) => num("prepMinutes", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Time slot every (minutes)</Label><Input type="number" min={10} max={120} value={form.slotMinutes} onChange={(e) => num("slotMinutes", e.target.value)} /></div>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} Save</Button>
      </CardContent>
    </Card>
  );
}
