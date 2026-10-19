import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Coffee, LogIn, LogOut, RefreshCw, Send, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { QrScannerDialog } from "@/components/attendance/QrScannerDialog";
import {
  staffClockIn, staffClockOut, staffCreateAttendanceRequest, staffCancelAttendanceRequest, staffEndBreak, staffToggleAttendanceTaskItem,
  staffGetAttendanceWorkspace, staffStartBreak, staffCompleteAttendanceTask,
} from "@/lib/attendance-workflow.functions";
import { browserQueueStorage, clearConfirmed, enqueue, flush, isPermanentError, isTransientNetworkError, reconcileConflict, retryFailed, type QueueKind, type QueueStorage, type QueuedAction } from "@/lib/attendance-offline";
import { breakStatus } from "@/lib/attendance-rules";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "My Attendance — Flamio" }, { name: "robots", content: "noindex" }] }),
  component: MyAttendance,
});

type AttendanceShift = { id: string; start_time: string; end_time: string; is_overnight: boolean; duty_role: string | null; planned_break_minutes: number; status: string };
type AttendanceSession = { id: string; shift_id: string | null; clock_out_at: string | null; clock_in_at: string; late_minutes: number | null; duty_date: string; worked_minutes: number | null; status: string };
type AttendanceTask = { id: string; title: string; status: string; priority: string; description: string | null; due_date: string; due_at: string | null; checklist: Array<{ id: string; is_done: boolean; label: string }>; requires_verification: boolean };
type AttendanceRequest = { id: string; request_type: string; status: string; reason: string; review_note: string | null };
type AttendanceWorkspace = { settings: { geofence_enabled: boolean; qr_verification_enabled: boolean } | null; shifts: AttendanceShift[]; sessions: AttendanceSession[]; tasks: AttendanceTask[]; requests: AttendanceRequest[]; activeBreak: { id: string; started_at: string } | null };

function MyAttendance() {
  const qc = useQueryClient();
  const getWorkspace = useServerFn(staffGetAttendanceWorkspace);
  const clockIn = useServerFn(staffClockIn);
  const clockOut = useServerFn(staffClockOut);
  const startBreak = useServerFn(staffStartBreak);
  const endBreak = useServerFn(staffEndBreak);
  const completeTask = useServerFn(staffCompleteAttendanceTask);
  const toggleTaskItem = useServerFn(staffToggleAttendanceTaskItem);
  const createRequest = useServerFn(staffCreateAttendanceRequest);
  const cancelRequest = useServerFn(staffCancelAttendanceRequest);
  const [shiftId, setShiftId] = useState("");
  const [note, setNote] = useState("");
  const [qrToken, setQrToken] = useState("");
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [completionNotes, setCompletionNotes] = useState<Record<string,string>>({});
  const [requestType, setRequestType] = useState<"leave"|"correction"|"missed_punch"|"overtime">("leave");
  const [leaveType, setLeaveType] = useState("annual");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [requestSessionId, setRequestSessionId] = useState("");
  const [requestedIn, setRequestedIn] = useState("");
  const [requestedOut, setRequestedOut] = useState("");
  const [overtime, setOvertime] = useState("60");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const queueRef = useRef<QueueStorage | null>(null);
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const sendQueued = useCallback(async (item: QueuedAction) => {
    const p = (item.payload ?? {}) as Record<string, unknown>;
    try {
      if (item.kind === "clock_in") await clockIn({ data: p as never });
      else if (item.kind === "clock_out") await clockOut({ data: p as never });
      else if (item.kind === "break_start") await startBreak();
      else await endBreak();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isPermanentError(message)) throw err;
      // A previous attempt may have committed while its reply was lost: check the server's real state.
      const ws = (await getWorkspace()) as AttendanceWorkspace;
      const open = ws.sessions.find((s) => !s.clock_out_at);
      const closed = ws.sessions.filter((s) => s.clock_out_at).sort((a, b) => String(b.clock_out_at).localeCompare(String(a.clock_out_at)))[0];
      const verdict = reconcileConflict(item, {
        activeSession: open ? { clockInAt: open.clock_in_at } : null,
        activeBreak: ws.activeBreak ? { startedAt: ws.activeBreak.started_at } : null,
        lastClosedSession: closed?.clock_out_at ? { clockOutAt: closed.clock_out_at } : null,
      });
      if (!verdict.confirmed) throw new Error(`${verdict.reason} (${message})`);
    }
  }, [clockIn, clockOut, startBreak, endBreak, getWorkspace]);
  const syncQueue = useCallback(async () => {
    const st = queueRef.current; if (!st) return;
    await clearConfirmed(st);
    if (navigator.onLine && (await st.all()).some((i) => i.state === "pending")) {
      setQueue(await st.all());
      await flush(st, async (item) => { setQueue((q) => q.map((x) => x.id === item.id ? { ...x, state: "syncing" } : x)); await sendQueued(item); });
      await qc.invalidateQueries({ queryKey: ["my-attendance-workspace"] });
    }
    setQueue(await st.all());
  }, [qc, sendQueued]);
  useEffect(() => {
    let alive = true;
    setOnline(navigator.onLine);
    void browserQueueStorage().then(({ storage, persistent: p }) => { if (!alive) return; queueRef.current = storage; setPersistent(p); void syncQueue(); });
    const up = () => { setOnline(true); void syncQueue(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { alive = false; window.removeEventListener("online", up); window.removeEventListener("offline", down); window.clearInterval(tick); };
  }, [syncQueue]);
  const punch = async (kind: QueueKind, send: () => Promise<unknown>, payload: Record<string, unknown> | undefined, success: string) => {
    setBusy(true);
    try { await send(); await refresh(); toast.success(success); }
    catch (error) {
      const st = queueRef.current;
      const canQueue = st && !(payload && "qrToken" in payload) && isTransientNetworkError(error, navigator.onLine);
      if (!canQueue) { toast.error(error instanceof Error ? error.message : "Action failed"); return; }
      try { await enqueue(st, kind, crypto.randomUUID(), new Date(), payload); setQueue(await st.all()); toast.warning("No connection — saved on this phone. It is NOT recorded until it shows Confirmed."); }
      catch (qe) { toast.error(qe instanceof Error ? qe.message : "Could not save offline"); }
    } finally { setBusy(false); }
  };
  const query = useQuery({ queryKey: ["my-attendance-workspace"], queryFn: () => getWorkspace(), refetchInterval: 60000 });
  const refresh = async () => qc.invalidateQueries({ queryKey: ["my-attendance-workspace"] });
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await operation(); await refresh(); toast.success(success); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Action failed"); }
    finally { setBusy(false); }
  };
  if (query.isLoading) return <div className="space-y-3"><Skeleton className="h-32 w-full"/><Skeleton className="h-48 w-full"/></div>;
  if (query.error || !query.data) return <EmptyState title="Attendance unavailable" description="Your attendance workspace could not be loaded." action={<Button onClick={() => void query.refetch()}>Retry</Button>} />;
  const { shifts, sessions, tasks, requests, activeBreak, settings } = query.data as AttendanceWorkspace;
  const activeSession = sessions.find((s) => !s.clock_out_at);
  const pendingTasks = tasks.filter((t) => !["completed","verified","cancelled"].includes(t.status));
  const dateTime = (v: string) => new Date(v).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-bold">My Attendance & Tasks</h2><p className="text-sm text-muted-foreground">Bangladesh time · Your records only</p></div><Button variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button></div>
    <Card><CardContent className="space-y-4 p-4">
      <h3 className="font-display font-bold">Duty punch</h3>
      {!online ? <p className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">You are offline. Clock-in/out and breaks will be saved on this phone and sent when the connection returns. QR clock-in needs a connection.</p> : null}
      {queue.length ? <div className="space-y-1 rounded-md border p-2 text-sm"><p className="font-semibold">Waiting to sync</p>{!persistent ? <p className="text-xs text-destructive">This browser cannot store offline punches safely — they will be lost if you close or reload the page.</p> : null}{queue.map((q) => <div key={q.id} className="flex flex-wrap items-center justify-between gap-2"><span>{q.kind.replace("_", " ")} · tapped {dateTime(q.requestedAt)}{q.error && q.state === "failed" ? ` · ${q.error}` : ""}</span><span className="flex items-center gap-2"><span className={"rounded-full px-2 py-0.5 text-xs " + (q.state === "failed" ? "bg-destructive/15 text-destructive" : q.state === "confirmed" ? "bg-primary/15 text-primary" : "bg-muted")}>{q.state === "pending" ? "Pending" : q.state === "syncing" ? "Syncing" : q.state === "confirmed" ? "Confirmed" : "Failed"}</span>{q.state === "failed" ? <Button size="sm" variant="outline" onClick={() => void (async () => { if (queueRef.current) { await retryFailed(queueRef.current, q.id); await syncQueue(); } })()}>Retry</Button> : null}</span></div>)}<p className="text-xs text-muted-foreground">Server time is recorded when the action syncs, not when you tapped.</p></div> : null}
      {activeSession ? <div className="rounded-lg border p-3"><p className="font-semibold">On duty since {dateTime(activeSession.clock_in_at)}</p><p className="text-sm text-muted-foreground">Status: {activeBreak ? "On break" : "On duty"} · Late {activeSession.late_minutes ?? 0} min</p>{activeBreak ? (() => { const b = breakStatus(activeBreak.started_at, now, shifts.find((x) => x.id === activeSession.shift_id)?.planned_break_minutes ?? null); return b.allowanceMinutes == null ? <p className="mt-1 text-xs text-muted-foreground">On break {b.minutes} min · no scheduled break limit for this session.{b.minutes > 30 ? " Possible long break (unscheduled estimate, over 30 min)." : ""}</p> : b.exceeded ? <p className="mt-2 rounded-md border border-destructive/40 p-2 text-sm text-destructive">Scheduled limit exceeded: your break is {b.overBy} min over your scheduled {b.allowanceMinutes} min. Please end your break.</p> : <p className="mt-1 text-xs text-muted-foreground">On break {b.minutes} of {b.allowanceMinutes} scheduled min.</p>; })() : null}<div className="mt-3 flex flex-wrap gap-2">{activeBreak ? <Button disabled={busy} onClick={() => void punch("break_end", () => endBreak(), undefined, "Break ended")}><Coffee className="mr-2 h-4 w-4"/>End break</Button> : <Button variant="outline" disabled={busy} onClick={() => void punch("break_start", () => startBreak(), undefined, "Break started")}><Coffee className="mr-2 h-4 w-4"/>Start break</Button>}<Button variant="destructive" disabled={busy || Boolean(activeBreak)} onClick={() => { const d = { note: note.trim() || null }; void punch("clock_out", () => clockOut({ data: d }), d, "Clocked out"); }}><LogOut className="mr-2 h-4 w-4"/>Clock out</Button></div></div> : <form className="space-y-3" onSubmit={(e) => {e.preventDefault(); void (async () => {
          const payload: { shiftId: string | null; note: string | null; latitude?: number; longitude?: number; accuracyMeters?: number; qrToken?: string } = { shiftId: shiftId || null, note: note.trim() || null };
          try {
            if (settings?.geofence_enabled) { if (!navigator.geolocation) throw new Error("This browser does not support GPS location."); const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Location permission is required to clock in.")), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })); payload.latitude = position.coords.latitude; payload.longitude = position.coords.longitude; payload.accuracyMeters = position.coords.accuracy; }
            if (settings?.qr_verification_enabled) { if (!qrToken.trim()) throw new Error("Enter the station QR token before clocking in."); payload.qrToken = qrToken.trim(); }
          } catch (err) { toast.error(err instanceof Error ? err.message : "Clock-in failed"); return; }
          await punch("clock_in", () => clockIn({ data: payload }), payload, "Clocked in");
        })();}}>
        <div className="space-y-1"><Label htmlFor="attendance-shift">Today's shift</Label><select id="attendance-shift" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={shiftId} onChange={(e)=>setShiftId(e.target.value)}><option value="">Unscheduled / automatic selection</option>{shifts.filter((s) =>s.status==="scheduled").map((s) =><option key={s.id} value={s.id}>{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}{s.is_overnight?" overnight":""}{s.duty_role?" · "+s.duty_role:""}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="punch-note">Note (optional)</Label><Input id="punch-note" maxLength={500} value={note} onChange={(e)=>setNote(e.target.value)}/></div>
        {settings?.geofence_enabled ? <p className="text-xs text-muted-foreground">GPS geofence is enabled. Allow precise location when prompted; location is checked against your assigned station on the server.</p> : null}{settings?.qr_verification_enabled ? <div className="space-y-2"><Label htmlFor="attendance-qr-token">Station QR token</Label><Input id="attendance-qr-token" autoComplete="off" maxLength={512} value={qrToken} onChange={(e) => setQrToken(e.target.value)} placeholder="Paste the token from your station QR"/><Button type="button" variant="outline" disabled={busy} onClick={()=>setQrScannerOpen(true)}><Camera className="mr-2 h-4 w-4"/>Scan station QR</Button><p className="text-xs text-muted-foreground">Camera scanning requires permission and a supported Android browser. Manual token entry remains available.</p></div> : null}<p className="text-xs text-muted-foreground">Clock-in uses server time and current Owner settings. Selfie verification is not available.</p><Button disabled={busy}><LogIn className="mr-2 h-4 w-4"/>Clock in</Button>
      </form>}
    </CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Today's schedule</h3>{shifts.length?shifts.map((s) =><div key={s.id} className="rounded-lg border p-3"><p className="font-semibold">{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}{s.is_overnight?" · overnight":""}</p><p className="text-sm text-muted-foreground">{s.duty_role||"Scheduled duty"} · break {s.planned_break_minutes} min · {s.status}</p></div>):<p className="text-sm text-muted-foreground">No shift assigned for today.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">My tasks</h3>{pendingTasks.length?pendingTasks.map((task) =><div key={task.id} className="space-y-2 rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{task.title}</p><span className="rounded-full bg-muted px-2 py-1 text-xs">{task.status} · {task.priority}</span></div>{task.description?<p className="text-sm text-muted-foreground">{task.description}</p>:null}<p className="text-xs text-muted-foreground">Due {task.due_date}{task.due_at?" · "+dateTime(task.due_at):""}</p>{task.checklist?.length?<div className="space-y-2 rounded-md bg-muted/40 p-2">{task.checklist.map((item) =><label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(item.is_done)} disabled={busy} onChange={(e)=>void run(()=>toggleTaskItem({data:{itemId:item.id,isDone:e.target.checked}}),e.target.checked?"Checklist item completed":"Checklist item reopened")}/><span className={item.is_done?"line-through text-muted-foreground":""}>{item.label}</span></label>)}</div>:null}<Textarea rows={2} maxLength={1000} placeholder="Completion note (optional)" value={completionNotes[task.id]||""} onChange={(e)=>setCompletionNotes((old)=>({...old,[task.id]:e.target.value}))}/><Button size="sm" disabled={busy} onClick={()=>void run(()=>completeTask({data:{taskId:task.id,completionNote:completionNotes[task.id]?.trim()||null}}), task.requires_verification?"Submitted for Owner verification":"Task completed")}><CheckCircle2 className="mr-2 h-4 w-4"/>Mark complete</Button></div>):<p className="text-sm text-muted-foreground">No open tasks assigned to you.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Attendance history</h3>{sessions.length?sessions.map((s) =><div key={s.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3"><div><p className="font-semibold">{s.duty_date}</p><p className="text-xs text-muted-foreground">In {dateTime(s.clock_in_at)} · Out {s.clock_out_at?dateTime(s.clock_out_at):"—"}</p></div><div className="text-right text-sm"><p>{s.worked_minutes} worked min</p><p className={(s.late_minutes ?? 0)>0?"text-destructive":"text-muted-foreground"}>{(s.late_minutes ?? 0)>0?"Late "+s.late_minutes+" min":s.status}</p></div></div>):<p className="text-sm text-muted-foreground">No attendance history yet.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Submit a request</h3><form className="grid gap-3 sm:grid-cols-2" onSubmit={(e)=>{e.preventDefault();void run(async()=>{await createRequest({data:{requestType,leaveType:requestType==="leave"?leaveType:null,leaveStartDate:requestType==="leave"?leaveStart:null,leaveEndDate:requestType==="leave"?leaveEnd:null,targetDate:requestType!=="leave"?targetDate:null,sessionId:requestType==="correction"||requestType==="overtime"?requestSessionId||null:null,requestedClockIn:(requestType==="correction"||requestType==="missed_punch")&&requestedIn?new Date(requestedIn).toISOString():null,requestedClockOut:(requestType==="correction"||requestType==="missed_punch")&&requestedOut?new Date(requestedOut).toISOString():null,requestedOvertimeMinutes:requestType==="overtime"?Number(overtime):null,reason}});setReason("");}, "Request submitted");}}>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="request-type">Request type</Label><select id="request-type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={requestType} onChange={(e)=>setRequestType(e.target.value as typeof requestType)}><option value="leave">Leave</option><option value="correction">Attendance correction</option><option value="missed_punch">Missed punch (both times)</option><option value="overtime">Overtime</option></select></div>
      {requestType==="leave"?<><div className="space-y-1"><Label htmlFor="leave-type">Leave type</Label><select id="leave-type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={leaveType} onChange={(e)=>setLeaveType(e.target.value)}><option value="annual">Annual</option><option value="sick">Sick</option><option value="casual">Casual</option><option value="unpaid">Unpaid</option></select></div><div/><div className="space-y-1"><Label htmlFor="leave-start">From</Label><Input id="leave-start" type="date" required value={leaveStart} onChange={(e)=>setLeaveStart(e.target.value)}/></div><div className="space-y-1"><Label htmlFor="leave-end">To</Label><Input id="leave-end" type="date" min={leaveStart||undefined} required value={leaveEnd} onChange={(e)=>setLeaveEnd(e.target.value)}/></div></>:null}
      {requestType!=="leave"?<>{(requestType==="correction"||requestType==="overtime")?<div className="space-y-1 sm:col-span-2"><Label htmlFor="request-session">Attendance session</Label><select id="request-session" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={requestSessionId} onChange={(e)=>setRequestSessionId(e.target.value)}><option value="">Select session</option>{sessions.map((s) =><option key={s.id} value={s.id}>{s.duty_date} · {dateTime(s.clock_in_at)}</option>)}</select></div>:null}<div className="space-y-1"><Label htmlFor="request-date">Target date</Label><Input id="request-date" type="date" required value={targetDate} onChange={(e)=>setTargetDate(e.target.value)}/></div>{requestType==="correction"||requestType==="missed_punch"?<><div className="space-y-1"><Label htmlFor="requested-in">Requested clock-in</Label><Input id="requested-in" type="datetime-local" required value={requestedIn} onChange={(e)=>setRequestedIn(e.target.value)}/></div><div className="space-y-1"><Label htmlFor="requested-out">Requested clock-out</Label><Input id="requested-out" type="datetime-local" required value={requestedOut} onChange={(e)=>setRequestedOut(e.target.value)}/></div></>:<div className="space-y-1"><Label htmlFor="overtime-minutes">Overtime minutes</Label><Input id="overtime-minutes" type="number" min={1} max={960} value={overtime} onChange={(e)=>setOvertime(e.target.value)}/></div>}</>:null}
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="request-reason">Reason</Label><Textarea id="request-reason" required minLength={5} maxLength={1000} value={reason} onChange={(e)=>setReason(e.target.value)}/></div><Button disabled={busy} className="sm:col-span-2"><Send className="mr-2 h-4 w-4"/>Submit request</Button>
    </form>
    <div className="space-y-2">{requests.map((r) =><div key={r.id} className="rounded-lg border p-3"><div className="flex justify-between gap-2"><p className="font-semibold">{r.request_type.replaceAll("_"," ")}</p><span className="text-xs">{r.status}</span></div><p className="text-sm text-muted-foreground">{r.reason}</p>{r.review_note?<p className="text-xs">Owner note: {r.review_note}</p>:null}{r.status==="pending"?<Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void run(()=>cancelRequest({data:{requestId:r.id}}),"Request cancelled")}><XCircle className="mr-1 h-4 w-4"/>Cancel request</Button>:null}</div>)}</div>
    </CardContent></Card>
    <QrScannerDialog open={qrScannerOpen} onOpenChange={setQrScannerOpen} onScan={(token)=>{setQrToken(token);toast.success("Station QR scanned");}} />
  </div>;
}
