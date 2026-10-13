import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { formatBDT } from "@/lib/format";
import { OwnerPartners } from "@/components/owner/OwnerPartners";
import {
  FINANCE_PAYMENT_METHODS,
  ownerGetFinanceOverview,
  ownerRecordWithdrawal,
  type FinancePaymentMethod,
} from "@/lib/owner-finance.functions";

/**
 * Owner Finance. Business profit comes from the existing sales calculation;
 * owner withdrawals sit in their own record and are never counted as a
 * business expense, so taking profit out doesn't change the profit figure.
 */
export const Route = createFileRoute("/_authenticated/owner/finance")({
  head: () => ({
    meta: [
      { title: "Owner Finance — Flamio" },
      { name: "description", content: "Business profit, owner withdrawals and profit partners." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerFinancePage,
});

const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

const METHOD_LABELS: Record<FinancePaymentMethod, string> = {
  cash: "Cash",
  bank: "Bank",
  mobile: "Mobile",
};

function OwnerFinancePage() {
  const queryClient = useQueryClient();
  const fetchOverview = useServerFn(ownerGetFinanceOverview);
  const recordWithdrawal = useServerFn(ownerRecordWithdrawal);

  const [month, setMonth] = useState(thisMonth);
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(today);
  const [entryTime, setEntryTime] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<FinancePaymentMethod>("cash");
  const [busy, setBusy] = useState(false);

  const overview = useQuery({
    queryKey: ["owner-finance", month],
    queryFn: () => fetchOverview({ data: { month } }),
  });

  if (overview.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (overview.error || !overview.data) {
    return (
      <EmptyState
        title="Couldn't load Owner Finance"
        description={
          overview.error instanceof Error
            ? overview.error.message
            : "Something went wrong while loading your finance records."
        }
        action={<Button onClick={() => void overview.refetch()}>Try again</Button>}
      />
    );
  }

  const data = overview.data;

  async function submitWithdrawal(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter the amount you took.");
      return;
    }
    if (reason.trim().length < 2) {
      toast.error("Add a short reason.");
      return;
    }
    setBusy(true);
    try {
      await recordWithdrawal({
        data: {
          amount: value,
          entryDate,
          entryTime: entryTime || null,
          reason: reason.trim(),
          note: note.trim() || null,
          paymentMethod: method,
        },
      });
      setAmount("");
      setReason("");
      setNote("");
      setEntryTime("");
      toast.success("Withdrawal recorded");
      await queryClient.invalidateQueries({ queryKey: ["owner-finance"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this withdrawal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Owner finance</h2>
          <p className="text-sm text-muted-foreground">
            Business profit, the profit you've taken out and what stays in the business.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="finance-month">Month</Label>
          <Input
            id="finance-month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value || thisMonth())}
            className="w-[170px]"
          />
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">This month</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Business profit" value={formatBDT(data.monthProfit)} />
          <Stat label="Owner withdrawals" value={formatBDT(data.monthWithdrawn)} />
          <Stat label="Profit retained" value={formatBDT(data.monthRetained)} />
          <Stat label="Partner share earned" value={formatBDT(data.partnerEarnedThisMonth)} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">All time</h3>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total business profit" value={formatBDT(data.totalProfit)} />
          <Stat label="Total profit withdrawn" value={formatBDT(data.totalWithdrawn)} />
          <Stat label="Profit retained in business" value={formatBDT(data.totalRetained)} />
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record a profit withdrawal</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitWithdrawal}>
            <div className="space-y-1">
              <Label htmlFor="w-amount">Amount</Label>
              <Input
                id="w-amount"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-date">Date</Label>
              <Input
                id="w-date"
                type="date"
                value={entryDate}
                onChange={(event) => setEntryDate(event.target.value || today())}
                disabled={busy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-time">Time (optional)</Label>
              <Input
                id="w-time"
                type="time"
                value={entryTime}
                onChange={(event) => setEntryTime(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-method">Payment method</Label>
              <Select value={method} onValueChange={(value) => setMethod(value as FinancePaymentMethod)}>
                <SelectTrigger id="w-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FINANCE_PAYMENT_METHODS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {METHOD_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="w-reason">Reason</Label>
              <Input
                id="w-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Personal"
                disabled={busy}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="w-note">Note (optional)</Label>
              <Textarea
                id="w-note"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Record withdrawal
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Owner withdrawals are kept separate from staff salary and business expenses, so
                they never change the business profit figure.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Withdrawal history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.withdrawals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No withdrawals recorded yet.</p>
          ) : (
            data.withdrawals.map((row) => (
              <div
                key={row.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{row.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.entryDate}
                    {row.entryTime ? ` · ${row.entryTime.slice(0, 5)}` : ""}
                    {row.paymentMethod ? ` · ${METHOD_LABELS[row.paymentMethod]}` : ""}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                </div>
                <p className="shrink-0 font-semibold">{formatBDT(row.amount)}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profit by month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.monthlyProfit.map((row) => (
            <div
              key={row.month}
              className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm"
            >
              <span className="font-medium">{row.month}</span>
              <span className="text-muted-foreground">
                Profit {formatBDT(row.profit)} · Withdrawn {formatBDT(row.withdrawn)} · Retained{" "}
                {formatBDT(row.retained)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <OwnerPartners month={month} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-lg font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
