import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDashboardAccess } from "@/hooks/use-dashboard-access";
import { canManage, hasPermission } from "@/lib/permissions";
import {
  approveRecoveryRequest,
  listRecoveryRequests,
  rejectRecoveryRequest,
} from "@/lib/recovery.functions";

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4 ? "••••" : `•••• ${digits.slice(-4)}`;
}

/**
 * Pending manual password-recovery requests, shown at the top of the existing
 * notification list for owners and staff with the Account Recovery permission.
 * Approve/Reject call the existing server functions, which re-check permission.
 */
interface IssuedCode {
  id: string;
  code: string;
  expiresAt: string;
  customerName: string | null;
  phone: string;
}

// In-memory only: keeps the just-issued one-time code across re-renders and
// in-app navigation until the owner presses "Done". Never persisted anywhere.
let issuedCodeMemory: IssuedCode | null = null;

export function RecoveryRequestNotices() {
  const access = useDashboardAccess();
  const allowed = hasPermission(access.data ?? null, "account_recovery");
  const manage = canManage(access.data ?? null, "account_recovery");
  const qc = useQueryClient();
  const list = useServerFn(listRecoveryRequests);
  const approve = useServerFn(approveRecoveryRequest);
  const reject = useServerFn(rejectRecoveryRequest);
  const [issued, setIssuedState] = useState<IssuedCode | null>(() => issuedCodeMemory);
  const setIssued = (value: IssuedCode | null) => {
    issuedCodeMemory = value;
    setIssuedState(value);
  };
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["recovery-requests"],
    queryFn: () => list(),
    enabled: allowed,
    retry: false,
    refetchInterval: 30_000,
  });

  const action = useMutation({
    mutationFn: async ({
      id,
      kind,
      customerName,
      phone,
    }: {
      id: string;
      kind: "approve" | "reject";
      customerName: string | null;
      phone: string;
    }) => {
      if (kind === "approve") {
        const res = await approve({ data: { id } });
        setIssued({ id, code: res.code, expiresAt: res.expiresAt, customerName, phone });
      } else {
        await reject({ data: { id } });
      }
    },
    onMutate: () => setError(null),
    onError: (e) => setError(e instanceof Error ? e.message : "Something went wrong."),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["recovery-requests"] }),
  });

  if (!allowed) return null;
  const pending = (query.data ?? []).filter((r) => r.status === "pending");
  if (pending.length === 0 && !issued) return null;

  return (
    <>
      <AlertDialog open={issued !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request approved</AlertDialogTitle>
            <AlertDialogDescription>
              Read this one-time code to the customer by phone. It works once and expires in 30
              days. You never see or set their password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {issued ? (
            <div className="space-y-1 text-sm">
              <p className="font-bold">{issued.customerName ?? "Customer"}</p>
              <p className="text-muted-foreground">{maskPhone(issued.phone)}</p>
              <p className="font-mono text-lg font-bold tracking-widest text-primary">
                {issued.code}
              </p>
              <p className="text-xs text-muted-foreground">
                Expires {new Date(issued.expiresAt).toLocaleString()}
              </p>
            </div>
          ) : null}
          <AlertDialogFooter>
            <Button onClick={() => setIssued(null)}>Done</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ul className="divide-y divide-border/70 border-b border-border/70">
        {pending.map((r) => {
        const busy = action.isPending && action.variables?.id === r.id;
          return (
            <li key={r.id} className="space-y-2 bg-secondary/40 px-4 py-3">
            <span className="flex items-start justify-between gap-3">
              <span className="text-sm font-bold leading-snug">Password recovery request</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {new Date(r.requestedAt).toLocaleString()}
              </span>
            </span>
            <span className="block text-xs text-muted-foreground">
              {r.customerName ?? "Customer"} · {maskPhone(r.phone)} · Pending — call and verify
              identity first.
            </span>
            {manage ? (
              <span className="flex gap-2">
                <Button
                  size="sm"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      id: r.id,
                      kind: "approve",
                      customerName: r.customerName,
                      phone: r.phone,
                    })
                  }
                >
                  {busy && action.variables?.kind === "approve" ? (
                    <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                  ) : null}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ id: r.id, kind: "reject", customerName: null, phone: "" })
                  }
                >
                  Reject
                </Button>
              </span>
            ) : null}
          </li>
        );
      })}
        {error ? (
          <li role="alert" className="px-4 py-2 text-xs text-destructive">
            {error}
          </li>
        ) : null}
      </ul>
    </>
  );
}
