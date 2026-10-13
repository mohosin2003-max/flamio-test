import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  approveRecoveryRequest,
  listRecoveryRequests,
  rejectRecoveryRequest,
} from "@/lib/recovery.functions";

export const Route = createFileRoute("/_authenticated/owner/recovery")({
  head: () => ({
    meta: [
      { title: "Account Recovery — Flamio Owner" },
      { name: "description", content: "Review customer password-recovery requests and issue one-time codes." },
      { property: "og:title", content: "Account Recovery — Flamio Owner" },
      { property: "og:description", content: "Owner tools for verified customer account recovery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerRecovery,
});

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

function OwnerRecovery() {
  const queryClient = useQueryClient();
  const list = useServerFn(listRecoveryRequests);
  const approve = useServerFn(approveRecoveryRequest);
  const reject = useServerFn(rejectRecoveryRequest);
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ id: string; code: string; expiresAt: string } | null>(null);

  const query = useQuery({ queryKey: ["owner", "recovery"], queryFn: () => list(), retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner", "recovery"] });

  async function onApprove(id: string) {
    if (!window.confirm("Have you called this customer and verified their identity?")) return;
    setBusy(id);
    try {
      const res = await approve({ data: { id } });
      setIssued({ id, ...res });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't approve.");
    } finally {
      setBusy(null);
    }
  }

  async function onReject(id: string) {
    if (!window.confirm("Reject this recovery request?")) return;
    setBusy(id);
    try {
      await reject({ data: { id } });
      toast.success("Request rejected.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reject.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Account recovery</h1>
        <p className="text-sm text-muted-foreground">
          Call the customer and verify their identity before approving. You never see or set their password.
        </p>
      </div>

      {issued && (
        <Card className="border-primary">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-semibold">One-time recovery code (shown only once)</p>
            <p className="font-mono text-2xl font-bold tracking-widest">{issued.code}</p>
            <p className="text-xs text-muted-foreground">
              Read it to the customer by phone. Valid until {fmt(issued.expiresAt)}, single use.
            </p>
            <Button size="sm" variant="outline" onClick={() => setIssued(null)}>
              Done
            </Button>
          </CardContent>
        </Card>
      )}

      {query.isLoading && <Skeleton className="h-32 w-full" />}
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Couldn't load requests."}
        </p>
      )}
      {query.data?.length === 0 && <p className="text-sm text-muted-foreground">No recovery requests.</p>}

      <div className="space-y-3">
        {query.data?.map((r) => (
          <Card key={r.id}>
            <CardContent className="space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{r.customerName ?? "Customer"} · +{r.phone}</p>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold capitalize">
                  {r.status}
                </span>
              </div>
              <p className="text-muted-foreground">
                Account since {fmt(r.accountCreatedAt)} · {r.orderCount} orders
              </p>
              <p className="text-xs text-muted-foreground">
                Requested {fmt(r.requestedAt)} · Approved {fmt(r.approvedAt)} · Expires {fmt(r.expiresAt)} · Used{" "}
                {fmt(r.usedAt)} · Wrong attempts {r.attempts}
              </p>
              {(r.status === "pending" || r.status === "approved") && (
                <div className="flex gap-2">
                  {r.status === "pending" && (
                    <Button size="sm" disabled={busy === r.id} onClick={() => onApprove(r.id)}>
                      Approve & issue code
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => onReject(r.id)}>
                    Reject
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
