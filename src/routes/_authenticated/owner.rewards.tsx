import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ChallengeRewardRules } from "@/components/owner/ChallengeRewardRules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ownerGetRewards, ownerReviewRewardClaim, ownerUpdateRewardRule } from "@/lib/rewards.functions";

export const Route = createFileRoute("/_authenticated/owner/rewards")({
  head: () => ({
    meta: [
      { title: "Rewards Management — Flamio" },
      { name: "description", content: "Manage Flamio reward actions and customer claims." },
      { property: "og:title", content: "Rewards Management — Flamio" },
      { property: "og:description", content: "Manage Flamio reward actions and customer claims." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerRewards,
});

function OwnerRewards() {
  const getRewards = useServerFn(ownerGetRewards);
  const saveRule = useServerFn(ownerUpdateRewardRule);
  const reviewClaim = useServerFn(ownerReviewRewardClaim);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const rewards = useQuery({ queryKey: ["owner-rewards"], queryFn: () => getRewards() });
  if (rewards.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!rewards.data) return <p className="text-sm text-muted-foreground">Rewards management is unavailable.</p>;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner-rewards"] });
  return <div className="space-y-6">
    <div><h2 className="font-display text-xl font-bold">Reward actions</h2><p className="mt-1 text-sm text-muted-foreground">Choose which actions earn points and set each value.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">{rewards.data.rules.map((rule) => <RewardRuleCard key={rule.id} rule={rule} busy={busy === rule.id} onSave={async (points, isEnabled) => { setBusy(rule.id); try { await saveRule({ data: { id: rule.id, points, isEnabled } }); await refresh(); toast.success("Reward action saved"); } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't save reward action"); } finally { setBusy(null); } }} />)}</div>
    <ChallengeRewardRules />
    <div><h2 className="font-display text-xl font-bold">Manual claims</h2><p className="mt-1 text-sm text-muted-foreground">Verify referrals, reviews, promotions and challenges before awarding points.</p></div>
    <div className="space-y-3">{rewards.data.claims.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No reward claims yet.</p> : rewards.data.claims.map((claim) => <Card key={claim.id}><CardContent className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="font-semibold">{claim.ruleName}</p><Badge variant={claim.status === "pending" ? "secondary" : claim.status === "approved" ? "default" : "destructive"}>{claim.status}</Badge></div><p className="mt-1 break-all text-sm text-muted-foreground">{claim.reference}</p>{claim.note ? <p className="mt-2 text-sm">{claim.note}</p> : null}<p className="mt-2 text-xs text-muted-foreground">Customer {claim.userId.slice(0, 8)} · {new Date(claim.createdAt).toLocaleDateString()}</p></div>{claim.status === "pending" ? <div className="flex gap-2"><Button size="sm" disabled={busy === claim.id} onClick={async () => { setBusy(claim.id); try { await reviewClaim({ data: { claimId: claim.id, decision: "approved", reviewNote: null } }); await refresh(); toast.success("Claim approved and points awarded"); } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't approve claim"); } finally { setBusy(null); } }}>{busy === claim.id ? <Loader2 className="animate-spin" /> : <Check />} Approve</Button><Button size="sm" variant="outline" disabled={busy === claim.id} onClick={async () => { setBusy(claim.id); try { await reviewClaim({ data: { claimId: claim.id, decision: "rejected", reviewNote: null } }); await refresh(); toast.success("Claim rejected"); } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't reject claim"); } finally { setBusy(null); } }}><X /> Reject</Button></div> : null}</div></CardContent></Card>)}</div>
  </div>;
}

function RewardRuleCard({ rule, busy, onSave }: { rule: { id: string; name: string; description: string | null; points: number; isEnabled: boolean; requiresClaim: boolean }; busy: boolean; onSave: (points: number, enabled: boolean) => Promise<void> }) {
  const [points, setPoints] = useState(String(rule.points));
  const [enabled, setEnabled] = useState(rule.isEnabled);
  return <Card><CardContent className="space-y-4 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{rule.name}</h3><p className="mt-1 text-sm text-muted-foreground">{rule.description}</p></div><Switch checked={enabled} onCheckedChange={setEnabled} aria-label={`Enable ${rule.name}`} /></div><div className="flex items-end gap-3"><div className="flex-1 space-y-1.5"><Label htmlFor={`points-${rule.id}`}>Points</Label><Input id={`points-${rule.id}`} type="number" min="0" step="1" value={points} onChange={(event) => setPoints(event.target.value)} /></div><Button disabled={busy} onClick={() => void onSave(Number(points) || 0, enabled)}>{busy ? <Loader2 className="animate-spin" /> : null} Save</Button></div><p className="text-xs text-muted-foreground">{rule.requiresClaim ? "Owner review required" : "Awarded automatically"}</p></CardContent></Card>;
}