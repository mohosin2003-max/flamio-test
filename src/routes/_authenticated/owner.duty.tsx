import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Clock, Coffee, Loader2, LogIn, LogOut, Play } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { elapsedMinutes, formatMinutes } from "@/lib/attendance-logic";
import {
  attendanceCancelRequest,
  attendanceClockIn,
  attendanceClockOut,
  attendanceEndBreak,
  attendanceMyOverview,
  attendanceStartBreak,
  attendanceSubmitRequest,
  attendanceToggleTaskItem,
  attendanceUpdateTaskProgress,
} from "@/lib/attendance.functions";

export const Route = createFileRoute("/_authenticated/owner/duty")({
  head: () => ({
    meta: [
      { title: "My duty — Flamio Attendance" },
      { name: "description", content: "Clock in, take breaks, complete your tasks and send attendance requests." },
      { property: "og:title", content: "My duty — Flamio Attendance" },
      { property: "og:description", content: "Staff duty, breaks, tasks and requests." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DutyPage,
});

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" }) : "—";

function errMsg(e: unknown) {
  const m = e instanceof Error ? e.message : "Something went wrong";
  return m.startsWith("Forbidden") ? "You don't have access to attendance." : m;
}

function useTick() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function DutyPage() {
  const qc = useQueryClient();
  const load = useServerFn(attendanceMyOverview);
  const q = useQuery({ queryKey: ["attendance", "me"], queryFn: () => load(), retry: false });
  const now = useTick();

  const run = (fn: () => Promise<unknown>, ok: string) => async () => {
    try {
      await fn();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["attendance"] });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const clockIn = useServerFn(attendanceClockIn);
  const clockOut = useServerFn(attendanceClockOut);
  const startBreak = useServerFn(attendanceStartBreak);
  const endBreak = useServerFn(attendanceEndBreak);
  const punch = useMutation({ mutationFn: (f: () => Promise<unknown>) => f() });

  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (q.error)
    return <EmptyState title="Attendance unavailable" description={errMsg(q.error)} action={<Button onClick={() => void q.refetch()}>Try again</Button>} />;

  const d = q.data;
  const open = d.sessions.find((s) => s.status === "open") ?? null;
  const busy = punch.isPending;
  const act = (f: () => Promise<unknown>, ok: string) => () => punch.mutate(run(f, ok) as never);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
            <p className="mt-1 font-display text-2xl font-bold">
              {!open ? "Off duty" : d.openBreak ? "On break" : "On duty"}
            </p>
            {open && (
              <p className="mt-1 text-sm text-muted-foreground">
                Since {fmtTime(open.clock_in_at)} · {formatMinutes(elapsedMinutes(open.clock_in_at, now))}
                {open.late_minutes > 0 && <Badge variant="destructive" className="ml-2">Late {formatMinutes(open.late_minutes)}</Badge>}
              </p>
            )}
            {d.openBreak && <p className="text-sm text-muted-foreground">Break {formatMinutes(elapsedMinutes(d.openBreak.started_at, now))}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {!open ? (
              <Button size="lg" disabled={busy} onClick={act(() => clockIn({ data: {} }), "Clocked in")}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />} Clock in
              </Button>
            ) : (
              <>
                {d.openBreak ? (
                  <Button variant="secondary" disabled={busy} onClick={act(() => endBreak(), "Break ended")}>
                    <Play className="mr-2 h-4 w-4" /> End break
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={busy} onClick={act(() => startBreak(), "Break started")}>
                    <Coffee className="mr-2 h-4 w-4" /> Start break
                  </Button>
                )}
                <Button variant="destructive" disabled={busy} onClick={act(() => clockOut({ data: {} }), "Clocked out")}>
                  <LogOut className="mr-2 h-4 w-4" /> Clock out
                </Button>
              </>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Times are recorded by the server (Asia/Dhaka), not by your phone.</p>
      </section>

      <Tabs defaultValue="tasks">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="tasks">Tasks ({d.tasks.length})</TabsTrigger>
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks"><MyTasks tasks={d.tasks} /></TabsContent>
        <TabsContent value="shifts">
          {d.shifts.length === 0 ? <EmptyState title="No upcoming shifts" description="Your manager hasn't scheduled you yet." /> : (
            <ul className="space-y-2">
              {d.shifts.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                  <span><Clock className="mr-1 inline h-4 w-4" />{fmtTime(s.starts_at)} → {fmtTime(s.ends_at)}{s.is_overnight && " (overnight)"}</span>
                  <Badge variant="outline">{s.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="history">
          {d.sessions.length === 0 ? <EmptyState title="No attendance yet" description="Your last 31 days will show here." /> : (
            <ul className="space-y-2">
              {d.sessions.map((s) => (
                <li key={s.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex justify-between gap-2"><span className="font-medium">{s.duty_date}</span><Badge variant="outline">{s.status} · {s.verification_status}</Badge></div>
                  <p className="text-muted-foreground">{fmtTime(s.clock_in_at)} → {fmtTime(s.clock_out_at)}</p>
                  <p className="text-muted-foreground">Worked {formatMinutes(s.worked_minutes)} · Break {formatMinutes(s.break_minutes)}{s.late_minutes > 0 && ` · Late ${formatMinutes(s.late_minutes)}`}{s.overtime_minutes > 0 && ` · OT ${formatMinutes(s.overtime_minutes)}`}</p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="requests"><MyRequests requests={d.requests} sessions={d.sessions} /></TabsContent>
      </Tabs>
    </div>
  );
}

type Overview = Awaited<ReturnType<typeof attendanceMyOverview>>;

function MyTasks({ tasks }: { tasks: Overview["tasks"] }) {
  const qc = useQueryClient();
  const toggle = useServerFn(attendanceToggleTaskItem);
  const progress = useServerFn(attendanceUpdateTaskProgress);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const go = async (f: () => Promise<unknown>, ok?: string) => {
    try { await f(); if (ok) toast.success(ok); await qc.invalidateQueries({ queryKey: ["attendance"] }); }
    catch (e) { toast.error(errMsg(e)); }
  };
  if (tasks.length === 0) return <EmptyState title="No tasks assigned" description="Tasks from your manager appear here." />;
  return (
    <ul className="space-y-3">
      {tasks.map((t) => (
        <li key={t.id} className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{t.title}</p>
            <div className="flex gap-1"><Badge variant="outline">{t.priority}</Badge><Badge variant={t.status === "rejected" ? "destructive" : "secondary"}>{t.status === "rejected" ? "returned" : t.status}</Badge></div>
          </div>
          <p className="text-xs text-muted-foreground">Due {t.due_date}</p>
          {t.description && <p className="mt-1 text-sm">{t.description}</p>}
          {t.review_note && <p className="mt-1 text-sm text-destructive">Manager: {t.review_note}</p>}
          <ul className="mt-2 space-y-1">
            {[...t.items].sort((a, b) => a.sort_order - b.sort_order).map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-sm">
                <Checkbox id={i.id} checked={i.is_done} disabled={t.status === "completed"} onCheckedChange={(v) => void go(() => toggle({ data: { itemId: i.id, done: v === true } }))} />
                <label htmlFor={i.id} className={i.is_done ? "line-through text-muted-foreground" : ""}>{i.label}</label>
              </li>
            ))}
          </ul>
          {t.status !== "completed" && (
            <div className="mt-3 space-y-2">
              <Textarea placeholder="Completion note (optional)" value={notes[t.id] ?? ""} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
              <div className="flex gap-2">
                {t.status === "pending" && <Button size="sm" variant="outline" onClick={() => void go(() => progress({ data: { taskId: t.id, status: "in_progress", note: null } }), "Task started")}>Start</Button>}
                <Button size="sm" onClick={() => void go(() => progress({ data: { taskId: t.id, status: "completed", note: notes[t.id] || null } }), "Submitted for review")}>Submit as done</Button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

type FKey = "reason" | "leaveType" | "start" | "end" | "sessionId" | "target" | "in" | "out" | "ot";

function MyRequests({ requests, sessions }: { requests: Overview["requests"]; sessions: Overview["sessions"] }) {
  const qc = useQueryClient();
  const submit = useServerFn(attendanceSubmitRequest);
  const cancel = useServerFn(attendanceCancelRequest);
  const [type, setType] = useState<"leave" | "missed_punch" | "correction" | "overtime">("leave");
  const [f, setF] = useState<Partial<Record<FKey, string>>>({});
  const [sending, setSending] = useState(false);
  const iso = (v?: string) => (v ? new Date(`${v}:00+06:00`).toISOString() : null);

  const onSubmit = async () => {
    setSending(true);
    try {
      await submit({
        data: {
          requestType: type,
          reason: f.reason ?? "",
          leaveType: type === "leave" ? ((f.leaveType as "casual") || "casual") : null,
          leaveStartDate: type === "leave" ? f.start || null : null,
          leaveEndDate: type === "leave" ? f.end || null : null,
          sessionId: type === "correction" || type === "overtime" ? f.sessionId || null : null,
          targetDate: type === "missed_punch" ? f.target || null : null,
          requestedClockIn: type === "missed_punch" || type === "correction" ? iso(f.in) : null,
          requestedClockOut: type === "missed_punch" || type === "correction" ? iso(f.out) : null,
          requestedOvertimeMinutes: type === "overtime" && f.ot ? Number(f.ot) : null,
        },
      });
      toast.success("Request sent to your manager");
      setF({});
      await qc.invalidateQueries({ queryKey: ["attendance"] });
    } catch (e) { toast.error(errMsg(e)); } finally { setSending(false); }
  };

  const field = (k: FKey, label: string, t = "text") => (
    <div className="space-y-1"><Label htmlFor={`r-${k}`}>{label}</Label><Input id={`r-${k}`} type={t} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap gap-2">
          {(["leave", "missed_punch", "correction", "overtime"] as const).map((t) => (
            <Button key={t} size="sm" variant={type === t ? "default" : "outline"} onClick={() => setType(t)}>{t.replace("_", " ")}</Button>
          ))}
        </div>
        {type === "leave" && (<div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="r-lt">Leave type</Label>
            <select id="r-lt" className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={f.leaveType ?? "casual"} onChange={(e) => setF({ ...f, leaveType: e.target.value })}>
              {["casual", "sick", "annual", "unpaid", "emergency", "other"].map((o) => <option key={o}>{o}</option>)}
            </select></div>
          {field("start", "From", "date")}{field("end", "To", "date")}</div>)}
        {type === "missed_punch" && <div className="grid gap-2 sm:grid-cols-3">{field("target", "Duty date", "date")}{field("in", "Clock in", "datetime-local")}{field("out", "Clock out", "datetime-local")}</div>}
        {(type === "correction" || type === "overtime") && (
          <div className="space-y-1"><Label htmlFor="r-s">Session</Label>
            <select id="r-s" className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={f.sessionId ?? ""} onChange={(e) => setF({ ...f, sessionId: e.target.value })}>
              <option value="">Choose a session</option>
              {sessions.filter((s) => s.status !== "open").map((s) => <option key={s.id} value={s.id}>{s.duty_date} · {fmtTime(s.clock_in_at)}</option>)}
            </select></div>)}
        {type === "correction" && <div className="grid gap-2 sm:grid-cols-2">{field("in", "Correct clock in", "datetime-local")}{field("out", "Correct clock out", "datetime-local")}</div>}
        {type === "overtime" && field("ot", "Overtime minutes", "number")}
        <div className="space-y-1"><Label htmlFor="r-reason">Reason</Label><Textarea id="r-reason" value={f.reason ?? ""} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        <Button disabled={sending || (f.reason ?? "").trim().length < 3} onClick={() => void onSubmit()}>{sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send request</Button>
      </div>
      {requests.length === 0 ? <EmptyState title="No requests yet" description="Requests you send appear here." /> : (
        <ul className="space-y-2">{requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
            <div><p className="font-medium">{r.request_type.replace("_", " ")} · {fmtTime(r.created_at)}</p><p className="text-muted-foreground">{r.reason}</p>{r.review_note && <p className="text-muted-foreground">Manager: {r.review_note}</p>}</div>
            <div className="flex items-center gap-2"><Badge variant={r.status === "rejected" ? "destructive" : "outline"}>{r.status}</Badge>
              {r.status === "pending" && <Button size="sm" variant="ghost" onClick={async () => { try { await cancel({ data: { requestId: r.id } }); await qc.invalidateQueries({ queryKey: ["attendance"] }); } catch (e) { toast.error(errMsg(e)); } }}>Cancel</Button>}</div>
          </li>))}</ul>)}
    </div>
  );
}
