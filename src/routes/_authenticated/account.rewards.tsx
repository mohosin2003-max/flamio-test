import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Clock3, Coins, Gift, Loader2, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getMyRewards, submitRewardClaim } from "@/lib/rewards.functions";

export const Route = createFileRoute("/_authenticated/account/rewards")({
  head: () => ({ meta: [
    { title: "Flamio Rewards — My Points" },
    { name: "description", content: "View your Flamio points, earning methods and reward history." },
    { property: "og:title", content: "Flamio Rewards — My Points" },
    { property: "og:description", content: "View your Flamio points and rewards." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: RewardsPage,
});

function RewardsPage() {
  const getRewards = useServerFn(getMyRewards);
  const submitClaim = useServerFn(submitRewardClaim);
  const queryClient = useQueryClient();
  const [claimingRule, setClaimingRule] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const rewards = useQuery({ queryKey: ["my-rewards"], queryFn: () => getRewards() });
  const submit = useMutation({
    mutationFn: () => submitClaim({ data: { ruleId: claimingRule ?? "", reference, note: note.trim() || null } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["my-rewards"] });
      setClaimingRule(null); setReference(""); setNote("");
      toast.success("Reward claim submitted for review");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't submit claim"),
  });

  if (rewards.isLoading) return <div className="mx-auto max-w-3xl px-4 py-8"><Skeleton className="h-64 w-full" /></div>;
  if (rewards.error || !rewards.data) return <div className="mx-auto max-w-3xl px-4 py-10 text-center text-muted-foreground">We couldn&apos;t load your rewards.</div>;
  const data = rewards.data;
  const manualRules = data.rules.filter((rule) => rule.requiresClaim);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 pb-28 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-black">Flamio Rewards</h1>
      <section className="mt-5 overflow-hidden rounded-2xl border border-primary/25 bg-gradient-ember p-5 text-primary-foreground shadow-ember">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-sm font-semibold opacity-80">Available balance</p><p className="mt-1 text-4xl font-black">{data.balance} <span className="text-lg">points</span></p></div>
          <span className="grid size-14 place-items-center rounded-full bg-background/15"><Coins className="size-7" /></span>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-xl font-extrabold">Ways to earn</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {data.rules.map((rule) => (
            <div key={rule.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3"><Sparkles className="size-5 shrink-0 text-primary" /><Badge>{rule.points} pts</Badge></div>
              <h3 className="mt-3 font-bold">{rule.name}</h3><p className="mt-1 text-sm text-muted-foreground">{rule.description}</p>
              {rule.requiresClaim ? <Button className="mt-4" size="sm" variant="outline" onClick={() => setClaimingRule(rule.id)}>Submit claim</Button> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-secondary/40 p-4">
        <div className="flex gap-3"><Gift className="mt-0.5 size-5 text-primary" /><div><h2 className="font-display font-bold">Redeeming points</h2><p className="mt-1 text-sm text-muted-foreground">Your points stay in your Flamio balance. Redemption offers will appear here when the restaurant enables them.</p></div></div>
      </section>

      {claimingRule ? (
        <section className="mt-8 rounded-xl border border-primary/30 bg-card p-4">
          <h2 className="font-display text-lg font-bold">Submit reward claim</h2>
          <p className="mt-1 text-sm text-muted-foreground">{manualRules.find((rule) => rule.id === claimingRule)?.name}. The owner will verify it before points are added.</p>
          <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
            <div className="space-y-1.5"><Label htmlFor="claim-reference">Proof or reference</Label><Input id="claim-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Link, order, referral, or review reference" required minLength={3} /></div>
            <div className="space-y-1.5"><Label htmlFor="claim-note">Note (optional)</Label><Textarea id="claim-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} /></div>
            <div className="flex gap-2"><Button type="submit" disabled={submit.isPending}>{submit.isPending ? <Loader2 className="animate-spin" /> : null} Submit</Button><Button type="button" variant="ghost" onClick={() => setClaimingRule(null)}>Cancel</Button></div>
          </form>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="font-display text-xl font-extrabold">History &amp; status</h2>
        <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
          {data.claims.map((claim) => <HistoryRow key={`claim-${claim.id}`} icon={claim.status === "approved" ? CheckCircle2 : claim.status === "rejected" ? XCircle : Clock3} title={claim.ruleName} detail={claim.status === "pending" ? "Pending owner review" : claim.status === "approved" ? "Approved" : "Not approved"} date={claim.createdAt} />)}
          {data.transactions.map((transaction) => <HistoryRow key={`tx-${transaction.id}`} icon={Coins} title={transaction.description} detail={`${transaction.points > 0 ? "+" : ""}${transaction.points} points`} date={transaction.createdAt} />)}
          {data.claims.length === 0 && data.transactions.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Your reward activity will appear here.</p> : null}
        </div>
      </section>
    </div>
  );
}

function HistoryRow({ icon: Icon, title, detail, date }: { icon: typeof Coins; title: string; detail: string; date: string }) {
  return <div className="flex items-center gap-3 p-4"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{title}</p><p className="text-xs text-muted-foreground">{detail}</p></div><time className="text-xs text-muted-foreground">{new Date(date).toLocaleDateString()}</time></div>;
}