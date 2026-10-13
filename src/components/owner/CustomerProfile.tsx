/**
 * Owner → Customers → one customer. Read-only view of existing data plus the
 * new internal notes and tags. Nothing here sends a message.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BadgeCheck, Eye, Link2, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerCommunication } from "@/components/owner/CustomerCommunication";
import { CustomerNotes } from "@/components/owner/CustomerNotes";
import { CustomerTags } from "@/components/owner/CustomerTags";
import { formatBDT } from "@/lib/format";
import { crmLinkAccount, crmRevealPhone } from "@/lib/crm.functions";
import type { CrmCustomerDetail } from "@/lib/crm.functions";

export function CustomerProfile({
  detail,
  phoneKey,
}: {
  detail: CrmCustomerDetail;
  phoneKey: string;
}) {
  const reveal = useServerFn(crmRevealPhone);
  const linkAccount = useServerFn(crmLinkAccount);
  const [linking, setLinking] = useState(false);
  const queryClient = useQueryClient();
  const [full, setFull] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  const showPhone = async () => {
    setRevealing(true);
    try {
      const result = await reveal({ data: { phone: phoneKey, crmId: detail.crmId } });
      setFull(result.phone);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't show this number");
    } finally {
      setRevealing(false);
    }
  };

  const link = async (authUserId: string) => {
    setLinking(true);
    try {
      await linkAccount({ data: { phone: phoneKey, authUserId } });
      toast.success("Account linked to this customer.");
      await queryClient.invalidateQueries({ queryKey: ["crm-customer", phoneKey] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't link this account");
    } finally {
      setLinking(false);
    }
  };

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["crm-customer", phoneKey] });

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-bold">{detail.name}</h2>
            <Badge variant={detail.customerType === "account" ? "default" : "secondary"}>
              {detail.customerType === "account" ? "Has account" : "Guest"}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{full ?? detail.phoneMasked}</span>
            {!full && detail.canManage ? (
              <Button size="sm" variant="outline" disabled={revealing} onClick={() => void showPhone()}>
                {revealing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                )}
                Show number
              </Button>
            ) : null}
          </div>

          {detail.accountEmail ? (
            <p className="text-sm text-muted-foreground">{detail.accountEmail}</p>
          ) : null}

          {detail.identityConflict ? (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>
                Possible duplicate: another customer record already uses one of these details.
                Nothing has been joined — both records are kept exactly as they are.
              </span>
            </div>
          ) : null}

          {detail.linkCandidate ? (
            <div className="space-y-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  A customer account uses this exact phone number
                  {detail.linkCandidate.emailMasked ? ` (${detail.linkCandidate.emailMasked})` : ""}.
                  Linking joins their guest history to that account here. Past orders stay exactly
                  as they were.
                </span>
              </div>
              {detail.canManage ? (
                <Button
                  size="sm"
                  disabled={linking}
                  onClick={() => void link(detail.linkCandidate!.authUserId)}
                >
                  {linking ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Link this account
                </Button>
              ) : null}
            </div>
          ) : null}

          {detail.identities.length > 0 ? (
            <div className="space-y-1.5 rounded-xl border border-border px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Identities
              </p>
              {detail.identities.map((identity) => (
                <div
                  key={`${identity.kind}-${identity.value}`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="font-medium">{identity.label}</span>
                  <span className="text-muted-foreground">{identity.value}</span>
                  <Badge variant={identity.verified ? "default" : "secondary"}>
                    {identity.verified ? (
                      <BadgeCheck className="mr-1 h-3 w-3" />
                    ) : null}
                    {identity.verified ? "Verified" : "Unverified"}
                  </Badge>
                  {identity.source ? (
                    <span className="text-xs text-muted-foreground">
                      {identity.source.replace(/_/g, " ")}
                    </span>
                  ) : null}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Account: {detail.accountLinked ? "Linked" : "Not linked"} · Guest orders{" "}
                {detail.guestOrderCount} · Account orders {detail.accountOrderCount}
              </p>
            </div>
          ) : null}

        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Orders" value={String(detail.orderCount)} />
        <Stat label="Total spend" value={formatBDT(detail.totalSpent)} />
        <Stat label="Average order" value={formatBDT(detail.averageOrder)} />
        <Stat
          label="Last order"
          value={detail.lastOrderAt ? detail.lastOrderAt.slice(0, 10) : "—"}
        />
      </div>

      {detail.customerType === "account" ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Reviews" value={String(detail.reviewCount)} />
          <Stat label="Reward points" value={String(detail.rewardPoints)} />
          <Stat label="Saved addresses" value={String(detail.addressCount)} />
          <Stat label="Favourites" value={String(detail.favoriteCount)} />
        </div>
      ) : null}

      {!detail.storageReady ? (
        <div className="rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          Notes and tags need the customer CRM tables installed once in your database.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <CustomerTags
            crmId={detail.crmId}
            tags={detail.tags}
            canManage={detail.canManage}
            onChanged={() => void refresh()}
          />
          <CustomerNotes
            crmId={detail.crmId}
            notes={detail.notes}
            canManage={detail.canManage}
            onChanged={() => void refresh()}
          />
        </div>
      )}

      <CustomerCommunication phoneKey={phoneKey} />

      <div className="space-y-2">
        <h3 className="font-display text-base font-bold">Order history</h3>
        {detail.orders.map((order) => (
          <Card key={order.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">#{order.code}</p>
                <p className="text-muted-foreground">
                  {order.createdAt.slice(0, 10)} · {order.status} · {order.fulfillment}
                </p>
              </div>
              <span className="font-semibold">{formatBDT(order.total)}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 font-display text-lg font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
