import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatBDT } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import {
  ownerListNotifiableCustomers,
  ownerSendCustomerNotification,
} from "@/lib/push.functions";
import { ownerListCustomers, ownerSendPromotion } from "@/lib/reports.functions";

/**
 * Owner → Customers. Reads the EXISTING CRM server function (built from order
 * history) and sends promotions through the existing notifications table.
 */
export const Route = createFileRoute("/_authenticated/owner/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Flamio Owner Dashboard" },
      { name: "description", content: "Review Flamio customer history and communication tools." },
      { property: "og:title", content: "Customers — Flamio Owner Dashboard" },
      { property: "og:description", content: "Review Flamio customer history and communication tools." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerCustomers,
});

type Segment = "all" | "new" | "returning" | "frequent" | "inactive";
type SortKey = "recent" | "spend" | "orders" | "name";

function OwnerCustomers() {
  const listCustomers = useServerFn(ownerListCustomers);
  const sendPromotion = useServerFn(ownerSendPromotion);
  const listAccounts = useServerFn(ownerListNotifiableCustomers);
  const sendCustomerNotification = useServerFn(ownerSendCustomerNotification);

  const [segment, setSegment] = useState<Segment>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [promo, setPromo] = useState({ title: "", body: "" });
  const [sending, setSending] = useState(false);
  const [personal, setPersonal] = useState({ userId: "", title: "", body: "" });
  const [sendingPersonal, setSendingPersonal] = useState(false);

  const customers = useQuery({
    queryKey: ["owner-customers"],
    queryFn: () => listCustomers(),
  });

  const accounts = useQuery({
    queryKey: ["owner-customer-accounts"],
    queryFn: () => listAccounts(),
    retry: false,
  });

  const sendPersonal = async () => {
    setSendingPersonal(true);
    try {
      const result = await sendCustomerNotification({
        data: {
          userId: personal.userId,
          title: personal.title.trim(),
          body: personal.body.trim(),
        },
      });
      toast.success(
        result.pushed > 0
          ? "Sent to their phone."
          : "Saved in their notifications — no phone registered yet.",
      );
      setPersonal({ userId: "", title: "", body: "" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't send this message");
    } finally {
      setSendingPersonal(false);
    }
  };


  if (customers.isLoading) return <Skeleton className="h-96 w-full" />;

  if (customers.error) {
    return (
      <EmptyState
        title="Couldn't load customers"
        description="Something went wrong loading your customers."
        action={<Button onClick={() => void customers.refetch()}>Try again</Button>}
      />
    );
  }

  const rows = customers.data ?? [];
  const needle = search.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const visible = rows
    .filter((c) => (segment === "all" ? true : c.segment === segment))
    .filter((c) => {
      if (!needle) return true;
      if (c.name.toLowerCase().includes(needle)) return true;
      return digits.length > 0 && normalizePhone(c.key).includes(digits);
    })
    .sort((a, b) => {
      if (sort === "spend") return b.totalSpent - a.totalSpent;
      if (sort === "orders") return b.orderCount - a.orderCount;
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.lastOrderAt.localeCompare(a.lastOrderAt);
    });

  const send = async () => {
    setSending(true);
    try {
      const result = await sendPromotion({
        data: { title: promo.title.trim(), body: promo.body.trim(), segment },
      });
      toast.success(
        result.sent === 0
          ? "No customers with an account matched this group."
          : `Sent to ${result.sent} customer${result.sent === 1 ? "" : "s"}`,
      );
      setPromo({ title: "", body: "" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't send this promotion");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Customers" value={String(rows.length)} />
        <Stat
          label="Repeat customers"
          value={String(rows.filter((c) => c.orderCount > 1).length)}
        />
        <Stat
          label="Total spend"
          value={formatBDT(rows.reduce((sum, c) => sum + c.totalSpent, 0))}
        />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="font-display text-base font-bold">Send a promotion</h2>
          <div className="space-y-1.5">
            <Label>Customer group</Label>
            <Select value={segment} onValueChange={(value) => setSegment(value as Segment)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All customers</SelectItem>
                <SelectItem value="new">New (1 order)</SelectItem>
                <SelectItem value="returning">Returning (2-4 orders)</SelectItem>
                <SelectItem value="frequent">Frequent (5+ orders)</SelectItem>
                <SelectItem value="inactive">Inactive (60+ days)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-title">Title</Label>
            <Input
              id="cr-title"
              value={promo.title}
              onChange={(e) => setPromo({ ...promo, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-body">Message</Label>
            <Textarea
              id="cr-body"
              rows={3}
              value={promo.body}
              onChange={(e) => setPromo({ ...promo, body: e.target.value })}
            />
          </div>
          <Button
            disabled={sending || promo.title.trim().length < 3 || promo.body.trim().length < 3}
            onClick={() => void send()}
          >
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send promotion
          </Button>
          <p className="text-xs text-muted-foreground">
            Promotions appear in the notification bell of customers who have an account.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="font-display text-base font-bold">Message one customer</h2>
          <p className="text-xs text-muted-foreground">
            A personal notification, separate from order updates and promotions. It reaches the
            customer&apos;s phone when they have turned phone notifications on.
          </p>
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select
              value={personal.userId}
              onValueChange={(value) => setPersonal({ ...personal, userId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a customer" />
              </SelectTrigger>
              <SelectContent>
                {(accounts.data ?? []).map((c) => (
                  <SelectItem key={c.userId} value={c.userId}>
                    {c.name}
                    {c.hasDevice ? " · phone ready" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pn-title">Title</Label>
            <Input
              id="pn-title"
              value={personal.title}
              onChange={(e) => setPersonal({ ...personal, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pn-body">Message</Label>
            <Textarea
              id="pn-body"
              rows={3}
              value={personal.body}
              onChange={(e) => setPersonal({ ...personal, body: e.target.value })}
            />
          </div>
          <Button
            disabled={
              sendingPersonal ||
              !personal.userId ||
              personal.title.trim().length < 3 ||
              personal.body.trim().length < 3
            }
            onClick={() => void sendPersonal()}
          >
            {sendingPersonal ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send to this customer
          </Button>
        </CardContent>
      </Card>



      <div className="space-y-3">
        <h2 className="font-display text-base font-bold">
          Customers {segment === "all" ? "" : `· ${segment}`}
        </h2>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={search}
            placeholder="Search by name or phone"
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
            <SelectTrigger className="sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most recent order</SelectItem>
              <SelectItem value="spend">Highest spend</SelectItem>
              <SelectItem value="orders">Most orders</SelectItem>
              <SelectItem value="name">Name (A–Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Customers appear here once orders are placed."
          />
        ) : (
          visible.map((c) => (
            <Link
              key={c.key}
              to="/owner/customers/$customerId"
              params={{ customerId: normalizePhone(c.key) }}
              className="block"
            >
              <Card className="transition-colors hover:border-primary/60">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold">
                      {c.name}
                      <Badge variant="secondary">{c.segment}</Badge>
                    </div>

                    <p className="mt-1 text-sm text-muted-foreground">
                      {c.phoneMasked} · {c.orderCount} order{c.orderCount === 1 ? "" : "s"} · last{" "}
                      {c.lastOrderAt.slice(0, 10)}
                    </p>
                  </div>
                  <span className="font-semibold">{formatBDT(c.totalSpent)}</span>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
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
        <p className="mt-1 font-display text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
