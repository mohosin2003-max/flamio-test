import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatBDT } from "@/lib/format";
import { ownerListStaffAccounts } from "@/lib/staff-finance.functions";
import {
  FINANCE_PAYMENT_METHODS,
  ownerEndPartner,
  ownerListPartners,
  ownerRecordPartnerPayment,
  ownerSavePartnerTerm,
  type FinancePaymentMethod,
  type PartnerSummary,
} from "@/lib/owner-finance.functions";

/**
 * Owner-only profit partner management. Partners are existing team members —
 * no second account is created. Each percentage change is stored with its own
 * start date, so months already earned keep the percentage they were earned
 * under.
 */
export function OwnerPartners({ month }: { month: string }) {
  const queryClient = useQueryClient();
  const listPartners = useServerFn(ownerListPartners);
  const listStaff = useServerFn(ownerListStaffAccounts);
  const saveTerm = useServerFn(ownerSavePartnerTerm);

  const [userId, setUserId] = useState("");
  const [percent, setPercent] = useState("");
  const [from, setFrom] = useState(() => `${month}-01`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const partners = useQuery({
    queryKey: ["owner-partners", month],
    queryFn: () => listPartners({ data: { month } }),
  });
  const staff = useQuery({
    queryKey: ["staff-accounts", month],
    queryFn: () => listStaff({ data: { month } }),
  });

  const candidates = (staff.data?.accounts ?? []).filter((account) =>
    account.roles.some((role) => role === "staff" || role === "admin"),
  );

  async function submitTerm(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const share = Number(percent);
    if (!userId) {
      toast.error("Choose a team member.");
      return;
    }
    if (!Number.isFinite(share) || share <= 0 || share > 100) {
      toast.error("Enter a profit share between 1 and 100.");
      return;
    }
    setBusy(true);
    try {
      const result = await saveTerm({
        data: { userId, sharePercent: share, effectiveFrom: from, note: note.trim() || null },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setPercent("");
      setNote("");
      toast.success("Profit share saved");
      await queryClient.invalidateQueries({ queryKey: ["owner-partners"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this partner");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profit partners</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitTerm}>
            <div className="space-y-1">
              <Label htmlFor="partner-user">Team member</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="partner-user">
                  <SelectValue placeholder="Choose a team member" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((account) => (
                    <SelectItem key={account.userId} value={account.userId}>
                      {account.fullName || account.phone || "Team member"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="partner-percent">Profit share %</Label>
              <Input
                id="partner-percent"
                type="number"
                min="1"
                max="100"
                step="0.1"
                inputMode="decimal"
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="partner-from">Effective from</Label>
              <Input
                id="partner-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value || `${month}-01`)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="partner-note">Note (optional)</Label>
              <Input
                id="partner-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save profit share
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Profit share starts from this date only. Earlier months never earn partner profit,
                and changing the percentage later leaves past months untouched.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      {(partners.data ?? []).map((partner) => (
        <PartnerCard key={partner.userId} partner={partner} month={month} />
      ))}

      {partners.data && partners.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No profit partners yet.</p>
      ) : null}
    </div>
  );
}

function PartnerCard({ partner, month }: { partner: PartnerSummary; month: string }) {
  const queryClient = useQueryClient();
  const recordPayment = useServerFn(ownerRecordPartnerPayment);
  const endPartner = useServerFn(ownerEndPartner);

  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodMonth, setPeriodMonth] = useState(month);
  const [method, setMethod] = useState<FinancePaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showHistory, setShowHistory] = useState(false);

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter the amount paid.");
      return;
    }
    setBusy(true);
    try {
      await recordPayment({
        data: {
          userId: partner.userId,
          amount: value,
          paidOn,
          periodMonth,
          paymentMethod: method,
          note: note.trim() || null,
        },
      });
      setAmount("");
      setNote("");
      toast.success("Payment recorded");
      await queryClient.invalidateQueries({ queryKey: ["owner-partners"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">
          {partner.fullName || partner.phone || "Partner"}{" "}
          <Badge variant={partner.status === "active" ? "default" : "secondary"}>
            {partner.status === "active" ? "Active" : "Disabled"}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {partner.sharePercent ?? 0}% · from {partner.effectiveFrom ?? "—"}
          {partner.effectiveTo ? ` to ${partner.effectiveTo}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Figure label={`Earned (${month})`} value={formatBDT(partner.monthEarned)} />
          <Figure label="Paid" value={formatBDT(partner.monthPaid)} />
          <Figure label="Remaining" value={formatBDT(partner.monthRemaining)} />
          <Figure label="Total earned" value={formatBDT(partner.totalEarned)} />
          <Figure label="Total paid" value={formatBDT(partner.totalPaid)} />
          <Figure label="Total remaining" value={formatBDT(partner.totalRemaining)} />
        </div>

        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitPayment}>
          <div className="space-y-1">
            <Label htmlFor={`pay-${partner.userId}`}>Pay amount</Label>
            <Input
              id={`pay-${partner.userId}`}
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
            <Label htmlFor={`paid-on-${partner.userId}`}>Paid on</Label>
            <Input
              id={`paid-on-${partner.userId}`}
              type="date"
              value={paidOn}
              onChange={(event) => setPaidOn(event.target.value || paidOn)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`period-${partner.userId}`}>For month</Label>
            <Input
              id={`period-${partner.userId}`}
              type="month"
              value={periodMonth}
              onChange={(event) => setPeriodMonth(event.target.value || month)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`method-${partner.userId}`}>Payment method</Label>
            <Select value={method} onValueChange={(value) => setMethod(value as FinancePaymentMethod)}>
              <SelectTrigger id={`method-${partner.userId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FINANCE_PAYMENT_METHODS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item === "cash" ? "Cash" : item === "bank" ? "Bank" : "Mobile"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`note-${partner.userId}`}>Note (optional)</Label>
            <Textarea
              id={`note-${partner.userId}`}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Record payment
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowHistory((value) => !value)}>
              {showHistory ? "Hide history" : "View history"}
            </Button>
          </div>
        </form>

        {partner.status === "active" ? (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border px-3 py-2">
            <div className="space-y-1">
              <Label htmlFor={`end-${partner.userId}`}>Disable from</Label>
              <Input
                id={`end-${partner.userId}`}
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value || endDate)}
                className="w-[170px]"
              />
            </div>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await endPartner({
                    data: { userId: partner.userId, effectiveTo: endDate },
                  });
                  if (!result.ok) {
                    toast.error(result.message);
                    return;
                  }
                  toast.success("Profit partner disabled");
                  await queryClient.invalidateQueries({ queryKey: ["owner-partners"] });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't disable this partner");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Disable partner
            </Button>
            <p className="text-xs text-muted-foreground">
              No new profit share after this date. Past earnings and payments stay as they are.
            </p>
          </div>
        ) : null}

        {showHistory ? (
          <div className="space-y-2">
            {partner.months.length === 0 ? (
              <p className="text-sm text-muted-foreground">No earnings yet.</p>
            ) : (
              partner.months.map((row) => (
                <div
                  key={row.month}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {row.month} · {row.sharePercent}%
                  </span>
                  <span className="text-muted-foreground">
                    Earned {formatBDT(row.earned)} · Paid {formatBDT(row.paid)} · Remaining{" "}
                    {formatBDT(row.remaining)}
                  </span>
                </div>
              ))
            )}
            {partner.payments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
              >
                <span>
                  Paid {payment.paidOn}
                  {payment.periodMonth ? ` · for ${payment.periodMonth}` : ""}
                  {payment.note ? ` · ${payment.note}` : ""}
                </span>
                <span className="font-semibold text-foreground">{formatBDT(payment.amount)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-base font-bold">{value}</p>
    </div>
  );
}
