import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { getOwnerRewardConfig, updateOwnerRewardConfig } from "@/lib/burger-boost-owner.functions";
import {
  INITIAL_REWARD_CONFIG,
  REWARD_CONFIG_CEILING_PERCENT,
  validateRewardConfig,
  type RewardConfig,
} from "@/lib/burger-boost-reward-config";

const KEY = ["owner", "burger-boost", "reward-config"];

export function RewardConfigForm() {
  const fetchConfig = useServerFn(getOwnerRewardConfig);
  const saveConfig = useServerFn(updateOwnerRewardConfig);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => fetchConfig(), retry: false });
  const [form, setForm] = useState<RewardConfig>({ ...INITIAL_REWARD_CONFIG });
  useEffect(() => {
    if (q.data?.config) setForm(q.data.config);
  }, [q.data]);
  const m = useMutation({
    mutationFn: (c: RewardConfig) => saveConfig({ data: c }),
    onSuccess: (v) => {
      qc.setQueryData(KEY, v);
      toast.success("Reward settings saved");
    },
  });
  const available = q.data?.available === true;
  const check = validateRewardConfig(form);
  const num = (k: keyof RewardConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((c) => ({ ...c, [k]: e.target.valueAsNumber }));

  return (
    <section className="space-y-4 border-y border-border py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Future reward settings</h2>
        <Badge variant="outline">{available ? "Saved settings" : "Unavailable · not saved"}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Prepared for a later release. Customers still get 0% today · coupons locked · checkout locked.
      </p>
      {q.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (available && check.ok && !m.isPending) m.mutate(form);
          }}
        >
          {!available && (
            <p role="status" className="text-sm text-muted-foreground">
              {q.error
                ? "Owner settings access could not be verified."
                : "The approved TEST database update is pending. Starting values below are not saved."}
            </p>
          )}
          <fieldset disabled={!available || m.isPending} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rc-default">Default Discount (%)</Label>
              <Input id="rc-default" type="number" step={1} min={0} max={form.ownerMaxDiscountPercent}
                value={form.defaultDiscountPercent} onChange={num("defaultDiscountPercent")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-max">Maximum Discount (%) · limit {REWARD_CONFIG_CEILING_PERCENT}%</Label>
              <Input id="rc-max" type="number" step={1} min={0} max={REWARD_CONFIG_CEILING_PERCENT}
                value={form.ownerMaxDiscountPercent} onChange={num("ownerMaxDiscountPercent")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-days">Coupon Validity (days)</Label>
              <Input id="rc-days" type="number" step={1} min={1} max={365}
                value={form.couponValidityDays} onChange={num("couponValidityDays")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-min">Minimum Order (৳)</Label>
              <Input id="rc-min" type="number" step={1} min={0}
                value={form.minimumOrderAmount} onChange={num("minimumOrderAmount")} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="rc-stack">Coupon Stacking</Label>
              <Switch id="rc-stack" checked={form.couponStackingEnabled}
                onCheckedChange={(v) => setForm((c) => ({ ...c, couponStackingEnabled: v }))} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="rc-enabled">Reward System</Label>
              <Switch id="rc-enabled" checked={form.rewardSystemEnabled}
                onCheckedChange={(v) => setForm((c) => ({ ...c, rewardSystemEnabled: v }))} />
            </div>
          </fieldset>
          {!check.ok && available && (
            <p role="alert" className="text-sm text-destructive">{check.errors.join(" ")}</p>
          )}
          {m.error && <p role="alert" className="text-sm text-destructive">{m.error.message}</p>}
          <Button type="submit" disabled={!available || !check.ok || m.isPending}>
            {m.isPending ? "Saving…" : "Save reward settings"}
          </Button>
        </form>
      )}
    </section>
  );
}
