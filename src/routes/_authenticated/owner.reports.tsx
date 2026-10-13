import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBDT } from "@/lib/format";
import { ownerGetSalesReport } from "@/lib/reports.functions";

/**
 * Owner → Reports. Reads the EXISTING sales report server function, which
 * derives everything from orders and order_items.
 */
export const Route = createFileRoute("/_authenticated/owner/reports")({
  head: () => ({
    meta: [
      { title: "Sales Reports — Flamio Owner Dashboard" },
      { name: "description", content: "Review Flamio sales, revenue and expense reports." },
      { property: "og:title", content: "Sales Reports — Flamio Owner Dashboard" },
      { property: "og:description", content: "Review Flamio sales, revenue and expense reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { from?: string; to?: string } => {
    const parsed: { from?: string; to?: string } = {};
    if (typeof search["from"] === "string") parsed.from = search["from"];
    if (typeof search["to"] === "string") parsed.to = search["to"];
    return parsed;
  },
  component: OwnerReports,
});

const iso = (d: Date) => d.toISOString().slice(0, 10);

function OwnerReports() {
  const search = Route.useSearch();
  const getReport = useServerFn(ownerGetSalesReport);

  const today = iso(new Date());
  const monthAgo = iso(new Date(Date.now() - 29 * 86_400_000));
  const [range, setRange] = useState({ from: search.from ?? monthAgo, to: search.to ?? today });

  const report = useQuery({
    queryKey: ["owner-sales-report", range.from, range.to],
    queryFn: () => getReport({ data: range }),
  });

  const setPreset = (days: number) =>
    setRange({ from: iso(new Date(Date.now() - (days - 1) * 86_400_000)), to: iso(new Date()) });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rp-from">From</Label>
              <Input
                id="rp-from"
                type="date"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-to">To</Label>
              <Input
                id="rp-to"
                type="date"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setPreset(1)}>
              Today
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreset(7)}>
              Last 7 days
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreset(30)}>
              Last 30 days
            </Button>
          </div>
        </CardContent>
      </Card>

      {report.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : report.error ? (
        <EmptyState
          title="Couldn't build this report"
          description="Something went wrong while building the report."
          action={<Button onClick={() => void report.refetch()}>Try again</Button>}
        />
      ) : report.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Orders" value={String(report.data.orderCount)} />
            <Stat label="Order value" value={formatBDT(report.data.orderTotal)} />
            <Stat label="Completed revenue" value={formatBDT(report.data.paidRevenue)} />
            <Stat label="Average order" value={formatBDT(report.data.averageOrderValue)} />
            <Stat label="Expenses" value={formatBDT(report.data.expenses)} />
            <Stat label="Net / profit" value={formatBDT(report.data.net)} />
          </div>

          {report.data.orderCount === 0 ? (
            <EmptyState
              title="No orders in this range"
              description="Pick a different date range to see sales."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <ListCard
                title="By day"
                rows={report.data.byDay.map((d) => [
                  `${d.date} · ${d.orders} orders`,
                  formatBDT(d.total),
                ])}
              />
              <ListCard
                title="By payment method"
                rows={report.data.byPayment.map((p) => [
                  `${p.label} · ${p.orders} orders`,
                  formatBDT(p.total),
                ])}
              />
              <ListCard
                title="Order status"
                rows={report.data.byStatus.map((s) => [s.status, String(s.orders)])}
              />
              <ListCard
                title="Top items"
                rows={report.data.topProducts.map((p) => [
                  `${p.name} · ${p.quantity} sold`,
                  formatBDT(p.revenue),
                ])}
              />
              <ListCard
                title="Top categories"
                rows={report.data.topCategories.map((c) => [
                  `${c.name} · ${c.quantity} sold`,
                  formatBDT(c.revenue),
                ])}
              />
            </div>
          )}
        </>
      ) : null}
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

function ListCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h3 className="font-display text-sm font-bold">{title}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
