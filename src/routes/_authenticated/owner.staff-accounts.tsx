import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBDT } from "@/lib/format";
import {
  LEDGER_TYPES,
  LEDGER_TYPE_LABELS,
  PAYMENT_METHODS,
  ownerCreateLedgerEntry,
  ownerDeleteLedgerEntry,
  ownerListLedgerAudit,
  ownerListLedgerEntries,
  ownerListPendingMoneyEntries,
  ownerDecideMoneyEntry,
  ownerListStaffAccounts,
  ownerSaveSalaryProfile,
  ownerUpdateLedgerEntry,
} from "@/lib/staff-finance.functions";
import type {
  LedgerEntry,
  LedgerType,
  PaymentMethod,
  StaffAccount,
} from "@/lib/staff-finance.functions";

/**
 * Owner → Staff Accounts. Salary setup, the money ledger and corrections for
 * each team member. Reads the existing team from roles/profiles; nothing else
 * in the app changes.
 */
export const Route = createFileRoute("/_authenticated/owner/staff-accounts")({
  validateSearch: (search: Record<string, unknown>): { date?: string } => typeof search["date"] === "string" ? { date: search["date"] } : {},
  head: () => ({
    meta: [
      { title: "Staff Accounts — Flamio" },
      {
        name: "description",
        content: "Track salaries, advances, loans, bonuses and deductions for the Flamio team.",
      },
      { property: "og:title", content: "Staff Accounts — Flamio" },
      {
        property: "og:description",
        content: "Track salaries, advances, loans, bonuses and deductions for the Flamio team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerStaffAccounts,
});

const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

const methodLabel = (m: string) =>
  m === "cash" ? "Cash" : m === "bank" ? "Bank" : m === "mobile" ? "Mobile banking" : m;

const memberName = (m: StaffAccount) => m.fullName ?? m.phone ?? m.email ?? "Unnamed team member";

function OwnerStaffAccounts() {
  const { date } = Route.useSearch();
  const listAccounts = useServerFn(ownerListStaffAccounts);
  const [month, setMonth] = useState(date?.slice(0, 7) ?? thisMonth());
  const [openUser, setOpenUser] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: ["staff-accounts", month],
    queryFn: () => listAccounts({ data: { month } }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Staff accounts</h2>
          <p className="text-sm text-muted-foreground">
            Salaries, advances, loans, bonuses and deductions for your team.
          </p>
        </div>
        <div className="w-40 space-y-1">
          <Label htmlFor="month">Month</Label>
          <Input
            id="month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || thisMonth())}
          />
        </div>
      </div>

      <PendingMoneyApprovals month={month} />

      {accounts.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : accounts.error ? (
        <EmptyState
          title="Couldn't load staff accounts"
          description="Something went wrong while loading your team's records."
          action={<Button onClick={() => void accounts.refetch()}>Try again</Button>}
        />
      ) : !accounts.data?.accounts.length ? (
        <EmptyState
          title="No team members yet"
          description="Add people in Staff first, then set up their salary here."
        />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap gap-6 p-4 text-sm">
              <div>
                <p className="text-muted-foreground">Paid this month</p>
                <p className="font-display text-lg font-bold">
                  {formatBDT(accounts.data.payrollPaid)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Still due this month</p>
                <p className="font-display text-lg font-bold">
                  {formatBDT(accounts.data.accounts.reduce((a, m) => a + m.salaryDue, 0))}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Outstanding loans</p>
                <p className="font-display text-lg font-bold">
                  {formatBDT(accounts.data.accounts.reduce((a, m) => a + m.outstandingLoan, 0))}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Team members</p>
                <p className="font-display text-lg font-bold">{accounts.data.accounts.length}</p>
              </div>
            </CardContent>
          </Card>

          <GiveMoneyCard members={accounts.data.accounts} month={month} />

          <div className="space-y-3">
            {accounts.data.accounts.map((member) => (
              <AccountRow
                key={member.userId}
                member={member}
                month={month}
                open={openUser === member.userId}
                onToggle={() => setOpenUser(openUser === member.userId ? null : member.userId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type EntryForm = {
  entryType: LedgerType;
  amount: string;
  entryDate: string;
  paymentMethod: PaymentMethod | "none";
  note: string;
};

const emptyForm = (): EntryForm => ({
  entryType: "salary_payment",
  amount: "",
  entryDate: today(),
  paymentMethod: "cash",
  note: "",
});

function EntryFields({
  form,
  setForm,
}: {
  form: EntryForm;
  setForm: (updater: (f: EntryForm) => EntryForm) => void;
}) {
  return (
    <>
      <div className="space-y-1">
        <Label>Reason</Label>
        <Select
          value={form.entryType}
          onValueChange={(v) => setForm((f) => ({ ...f, entryType: v as LedgerType }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEDGER_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {LEDGER_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Amount</Label>
          <Input
            type="number"
            min="0"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Date</Label>
          <Input
            type="date"
            value={form.entryDate}
            onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Paid by</Label>
        <Select
          value={form.paymentMethod}
          onValueChange={(v) =>
            setForm((f) => ({ ...f, paymentMethod: v as PaymentMethod | "none" }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {methodLabel(m)}
              </SelectItem>
            ))}
            <SelectItem value="none">Not applicable</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Note (optional)</Label>
        <Textarea
          rows={2}
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        />
      </div>
    </>
  );
}

const toPayload = (form: EntryForm) => ({
  entryType: form.entryType,
  amount: Number(form.amount) || 0,
  entryDate: form.entryDate,
  paymentMethod: form.paymentMethod === "none" ? null : form.paymentMethod,
  note: form.note.trim() ? form.note.trim() : null,
});

/** Owner-only quick form: pick anyone on the team and record money given. */
function GiveMoneyCard({ members, month }: { members: StaffAccount[]; month: string }) {
  const create = useServerFn(ownerCreateLedgerEntry);
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState(members[0]?.userId ?? "");
  const [form, setForm] = useState<EntryForm>(emptyForm());

  const mutation = useMutation({
    mutationFn: () => create({ data: { userId, ...toPayload(form) } }),
    onSuccess: async () => {
      toast.success("Record saved");
      setForm((f) => ({ ...emptyForm(), entryType: f.entryType, entryDate: f.entryDate }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["staff-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["staff-ledger", userId] }),
        queryClient.invalidateQueries({ queryKey: ["staff-ledger-audit", userId] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="font-semibold">Give money / Add record</p>
          <p className="text-xs text-muted-foreground">
            Salary advances reduce this month's salary due. Loans stay separate.
          </p>
        </div>
        <div className="space-y-1">
          <Label>Team member</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a team member" />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {memberName(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <EntryFields form={form} setForm={setForm} />
        <Button
          className="w-full"
          disabled={mutation.isPending || !userId || !form.amount}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save record
        </Button>
        <p className="text-[11px] text-muted-foreground">
          {month === thisMonth()
            ? "Records are also listed under each person below."
            : "Viewing another month — records are saved on the date you choose."}
        </p>
      </CardContent>
    </Card>
  );
}

function AccountRow({
  member,
  month,
  open,
  onToggle,
}: {
  member: StaffAccount;
  month: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{memberName(member)}</p>
            <p className="text-xs text-muted-foreground">
              {member.phone ?? member.email ?? "No contact saved"}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {member.roles.map((role) => (
                <Badge key={role} variant="secondary" className="text-[10px] uppercase">
                  {role}
                </Badge>
              ))}
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">
              {member.profile
                ? member.profile.payType === "monthly"
                  ? `${formatBDT(member.profile.monthlyRate)} / month`
                  : `${formatBDT(member.profile.dailyRate)} / day`
                : "No salary set"}
            </p>
            <p className="text-xs text-muted-foreground">
              Paid {formatBDT(member.paidThisMonth)} · Remaining salary{" "}
              {formatBDT(member.salaryDue)}
            </p>
            <p className="text-xs text-muted-foreground">
              Advance {formatBDT(member.outstandingAdvance)} · Loan{" "}
              {formatBDT(member.outstandingLoan)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <SalaryDialog member={member} month={month} />
          <EntryDialog member={member} month={month} />
          <Button size="sm" variant="ghost" onClick={onToggle}>
            {open ? "Hide history" : "View history"}
          </Button>
        </div>

        {open ? <History userId={member.userId} month={month} /> : null}
      </CardContent>
    </Card>
  );
}

function SalaryDialog({ member, month }: { member: StaffAccount; month: string }) {
  const save = useServerFn(ownerSaveSalaryProfile);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    payType: member.profile?.payType ?? "monthly",
    monthlyRate: String(member.profile?.monthlyRate ?? 0),
    dailyRate: String(member.profile?.dailyRate ?? 0),
    overtimeHourlyRate: String(member.profile?.overtimeHourlyRate ?? 0),
    payday: String(member.profile?.payday ?? 1),
    startsOn: member.profile?.startsOn ?? "",
    isActive: member.profile?.isActive ?? true,
  });

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          userId: member.userId,
          payType: form.payType as "monthly" | "daily",
          monthlyRate: Number(form.monthlyRate) || 0,
          dailyRate: Number(form.dailyRate) || 0,
          overtimeHourlyRate: Number(form.overtimeHourlyRate) || 0,
          payday: Number(form.payday) || 1,
          startsOn: form.startsOn ? form.startsOn : null,
          isActive: form.isActive,
        },
      }),
    onSuccess: async () => {
      toast.success("Salary setup saved");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["staff-accounts", month] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {member.profile ? "Edit salary" : "Set salary"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salary setup</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Pay type</Label>
            <Select
              value={form.payType}
              onValueChange={(v) => setForm((f) => ({ ...f, payType: v as "monthly" | "daily" }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly salary</SelectItem>
                <SelectItem value="daily">Daily wage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Monthly salary</Label>
              <Input
                type="number"
                min="0"
                value={form.monthlyRate}
                onChange={(e) => setForm((f) => ({ ...f, monthlyRate: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Daily wage</Label>
              <Input
                type="number"
                min="0"
                value={form.dailyRate}
                onChange={(e) => setForm((f) => ({ ...f, dailyRate: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Overtime per hour</Label>
              <Input
                type="number"
                min="0"
                value={form.overtimeHourlyRate}
                onChange={(e) => setForm((f) => ({ ...f, overtimeHourlyRate: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Payday (day of month)</Label>
              <Input
                type="number"
                min="1"
                max="31"
                value={form.payday}
                onChange={(e) => setForm((f) => ({ ...f, payday: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Started on</Label>
            <Input
              type="date"
              value={form.startsOn}
              onChange={(e) => setForm((f) => ({ ...f, startsOn: e.target.value }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span className="text-sm">Currently employed</span>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            />
          </div>
          <Button
            className="w-full"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save salary setup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EntryDialog({ member, month }: { member: StaffAccount; month: string }) {
  const create = useServerFn(ownerCreateLedgerEntry);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EntryForm>(emptyForm());

  const mutation = useMutation({
    mutationFn: () => create({ data: { userId: member.userId, ...toPayload(form) } }),
    onSuccess: async () => {
      toast.success("Record saved");
      setOpen(false);
      setForm(emptyForm());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["staff-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["staff-ledger", member.userId] }),
        queryClient.invalidateQueries({ queryKey: ["staff-ledger-audit", member.userId] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Add record</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Money for {memberName(member)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <EntryFields form={form} setForm={setForm} />
          <Button
            className="w-full"
            disabled={mutation.isPending || !form.amount}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save record
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Correcting a mistake: keeps a reason and writes the change history. */
function EditEntryDialog({
  entry,
  month,
  onDone,
}: {
  entry: LedgerEntry;
  month: string;
  onDone: () => void;
}) {
  const update = useServerFn(ownerUpdateLedgerEntry);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState<EntryForm>({
    entryType: entry.entryType,
    amount: String(entry.amount),
    entryDate: entry.entryDate,
    paymentMethod: entry.paymentMethod ?? "none",
    note: entry.note ?? "",
  });

  const mutation = useMutation({
    mutationFn: () => update({ data: { id: entry.id, ...toPayload(form), reason: reason.trim() } }),
    onSuccess: async () => {
      toast.success("Record corrected");
      setOpen(false);
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["staff-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["staff-ledger", entry.userId] }),
        queryClient.invalidateQueries({ queryKey: ["staff-ledger-audit", entry.userId] }),
      ]);
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Correct record">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct this record</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <EntryFields form={form} setForm={setForm} />
          <div className="space-y-1">
            <Label>Why is this being corrected?</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button
            className="w-full"
            disabled={mutation.isPending || !form.amount || !reason.trim()}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save correction
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function History({ userId, month }: { userId: string; month: string }) {
  const list = useServerFn(ownerListLedgerEntries);
  const listAudit = useServerFn(ownerListLedgerAudit);
  const remove = useServerFn(ownerDeleteLedgerEntry);
  const queryClient = useQueryClient();
  const [allTime, setAllTime] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState<LedgerType | "all">("all");
  const [showAudit, setShowAudit] = useState(false);

  const entries = useQuery({
    queryKey: [
      "staff-ledger",
      userId,
      allTime ? "all" : month,
      fromDate,
      toDate,
      typeFilter,
    ],
    queryFn: () =>
      list({
        data: {
          userId,
          month: allTime || fromDate || toDate ? null : month,
          fromDate: fromDate || null,
          toDate: toDate || null,
          entryType: typeFilter === "all" ? null : typeFilter,
        },
      }),
  });

  const audit = useQuery({
    queryKey: ["staff-ledger-audit", userId],
    queryFn: () => listAudit({ data: { userId } }),
    enabled: showAudit,
  });

  const del = useMutation({
    mutationFn: (id: string) => remove({ data: { id, reason: "Removed by owner" } }),
    onSuccess: async () => {
      toast.success("Record removed");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["staff-ledger", userId] }),
        queryClient.invalidateQueries({ queryKey: ["staff-ledger-audit", userId] }),
        queryClient.invalidateQueries({ queryKey: ["staff-accounts"] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">History</p>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setAllTime((v) => !v)}>
            {allTime ? "This month only" : "Show all time"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowAudit((v) => !v)}>
            {showAudit ? "Hide changes" : "Change log"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Reason</Label>
          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as LedgerType | "all")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              {LEDGER_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {LEDGER_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {entries.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !entries.data?.length ? (
        <p className="text-sm text-muted-foreground">No records yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.data.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <p className="font-medium">
                  {LEDGER_TYPE_LABELS[entry.entryType]}
                  {entry.wasCorrected ? (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      corrected
                    </Badge>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.entryDate}
                  {entry.paymentMethod ? ` · ${methodLabel(entry.paymentMethod)}` : ""}
                  {entry.note ? ` · ${entry.note}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-semibold">{formatBDT(entry.amount)}</span>
                <EditEntryDialog
                  entry={entry}
                  month={month}
                  onDone={() => void entries.refetch()}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={del.isPending}
                  onClick={() => del.mutate(entry.id)}
                  aria-label="Remove record"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showAudit ? (
        <div className="space-y-2 rounded-lg bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Change log</p>
          {audit.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : !audit.data?.length ? (
            <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {audit.data.map((row) => (
                <li key={row.id} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {row.action === "create"
                      ? "Added"
                      : row.action === "update"
                        ? "Corrected"
                        : "Removed"}
                  </span>{" "}
                  {new Date(row.createdAt).toLocaleString()}
                  {row.changedByName ? ` by ${row.changedByName}` : ""}
                  {row.reason ? ` — ${row.reason}` : ""}
                  {row.before && row.after
                    ? ` (${formatBDT(Number(row.before.amount ?? 0))} → ${formatBDT(
                        Number(row.after.amount ?? 0),
                      )})`
                    : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Money-taken requests from staff. Only the owner can approve or reject. */
function PendingMoneyApprovals({ month }: { month: string }) {
  const list = useServerFn(ownerListPendingMoneyEntries);
  const decide = useServerFn(ownerDecideMoneyEntry);
  const queryClient = useQueryClient();

  const pending = useQuery({
    queryKey: ["staff-money-pending"],
    queryFn: () => list(),
  });

  const mutation = useMutation({
    mutationFn: (input: { id: string; decision: "approved" | "rejected" }) =>
      decide({ data: input }),
    onSuccess: async (_result, input) => {
      toast.success(input.decision === "approved" ? "Approved" : "Rejected");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["staff-money-pending"] }),
        queryClient.invalidateQueries({ queryKey: ["staff-accounts"] }),
      ]);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Couldn't save this decision"),
  });

  if (pending.isLoading || !pending.data?.length) return null;

  return (
    <Card className="border-amber-300">
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="font-display text-base font-bold">Money taken — waiting for you</h3>
          <p className="text-xs text-muted-foreground">
            Pending requests don't affect balances until you approve them.
          </p>
        </div>
        {pending.data.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium">
                {entry.staffName ?? "Team member"} · {formatBDT(entry.amount)}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.entryDate}
                {entry.reason ? ` · ${entry.reason}` : ""}
                {entry.note ? ` · ${entry.note}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ id: entry.id, decision: "approved" })}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ id: entry.id, decision: "rejected" })}
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
        <p className="sr-only">{month}</p>
      </CardContent>
    </Card>
  );
}
