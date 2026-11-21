import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getOwnerRewardConfig, updateOwnerRewardConfig } from "@/lib/burger-boost-owner.functions";
import { DEFAULT_REWARD_CONFIG, REWARD_CONFIG_CEILING_PERCENT, type RewardConfig } from "@/lib/burger-boost-reward-config";

export function RewardConfigForm() {
  const getConfig = useServerFn(getOwnerRewardConfig);
  const saveConfig = useServerFn(updateOwnerRewardConfig);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["owner", "burger-boost", "reward-config"], queryFn: () => getConfig() });
  const [draft, setDraft] = useState<RewardConfig | null>(null);

  const current = draft ?? q.data ?? DEFAULT_REWARD_CONFIG;
  const m = useMutation({
    mutationFn: (value: RewardConfig) => saveConfig({ data: value }),
    onSuccess: (value) => {
      setDraft(value);
      qc.setQueryData(["owner", "burger-boost", "reward-config"], value);
    },
  });

  const set = <K extends keyof RewardConfig>(key: K, value: RewardConfig[K]) =>
    setDraft({ ...current, [key]: value });

  if (q.isPending) return <Card><CardContent className="p-4 text-sm text-muted-foreground">Loading reward settings…</CardContent></Card>;
  if (q.error) return <Card><CardContent className="p-4 text-sm text-destructive">Reward settings are not available yet. Apply the approved TEST database migration first.</CardContent></Card>;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold">Reward settings</p>
            <p className="text-sm text-muted-foreground">Owner-controlled Phase 2 configuration. Phase 1 rewards remain locked.</p>
          </div>
          <Badge variant="outline"><ShieldCheck className="mr-1 size-3" />Max {REWARD_CONFIG_CEILING_PERCENT}%</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Default Discount (%)</Label>
            <Input type="number" min={0} max={current.ownerMaxDiscountPercent} value={current.defaultDiscountPercent} onChange={(e) => set("defaultDiscountPercent", Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Maximum Discount (%)</Label>
            <Input type="number" min={0} max={REWARD_CONFIG_CEILING_PERCENT} value={current.ownerMaxDiscountPercent} onChange={(e) => set("ownerMaxDiscountPercent", Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Coupon Validity (Days)</Label>
            <Input type="number" min={1} max={365} value={current.couponValidityDays} onChange={(e) => set("couponValidityDays", Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Minimum Order (৳)</Label>
            <Input type="number" min={0} max={100000} value={current.minimumOrderAmount} onChange={(e) => set("minimumOrderAmount", Number(e.target.value))} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div><Label>Coupon Stacking</Label><p className="text-xs text-muted-foreground">Allow another coupon with this reward</p></div>
            <Switch checked={current.couponStackingEnabled} onCheckedChange={(v) => set("couponStackingEnabled", v)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div><Label>Reward System</Label><p className="text-xs text-muted-foreground">Configuration only; Phase 1 remains locked</p></div>
            <Switch checked={current.rewardSystemEnabled} onCheckedChange={(v) => set("rewardSystemEnabled", v)} />
          </div>
        </div>

        {m.error && <p className="text-sm text-destructive">{m.error instanceof Error ? m.error.message : "Could not save reward settings."}</p>}
        {m.isSuccess && <p className="text-sm text-green-600">Reward settings saved.</p>}

        <Button onClick={() => m.mutate(current)} disabled={m.isPending} className="gap-2">
          <Save className="size-4" /> {m.isPending ? "Saving…" : "Save settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
