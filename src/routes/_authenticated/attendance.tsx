import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Coffee, LogIn, LogOut, RefreshCw, Send, Volume2, VolumeX, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { QrScannerDialog } from "@/components/attendance/QrScannerDialog";
import { SelfieCaptureDialog } from "@/components/attendance/SelfieCaptureDialog";
import { staffUploadAttendanceSelfie } from "@/lib/attendance-selfie.functions";
import { staffUploadAttendanceTaskPhoto } from "@/lib/attendance-task-photo.functions";
import {
  staffClockIn, staffClockOut, staffCreateAttendanceRequest, staffCancelAttendanceRequest, staffEndBreak, staffToggleAttendanceTaskItem,
  staffGetAttendanceWorkspace, staffStartBreak, staffCompleteAttendanceTask,
} from "@/lib/attendance-workflow.functions";
import { browserQueueStorage, clearConfirmed, enqueue, flush, recoverInterruptedSync, isPermanentError, isTransientNetworkError, reconcileConflict, reconcileTaskConflict, isTaskKind, retryFailed, type QueueKind, type QueueStorage, type QueuedAction } from "@/lib/attendance-offline";
import { breakStatus } from "@/lib/attendance-rules";
import { EXCEPTION_REASON_MAX, EXCEPTION_REASON_MIN, parseExceptionRequired } from "@/lib/attendance-clockout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { isChimeMuted, playChime, setChimeMuted, type ChimeKind } from "@/lib/attendance-chimes";

const QUEUE_LABEL: Record<QueueKind, string> = { clock_in: "Clock in", clock_out: "Clock out", break_start: "Break start", break_end: "Break end", task_item_toggle: "Checklist tick", task_complete: "Task completion" };

const EXCEPTION_PENDING = Symbol("exception-pending");

async function readClockOutLocation(): Promise<{ latitude?: number; longitude?: number; accuracyMeters?: number; capturedAt?: number }> {
  // Single on-demand reading; failures are sent as "no location" so the server asks for a reason instead of trapping staff.
  if (typeof navigator === "undefined" || !navigator.geolocation) return {};
  try {
    const p = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
    return { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyMeters: p.coords.accuracy, capturedAt: Math.round(p.timestamp) };
  } catch { return {}; }
}

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "My Attendance — Flamio" }, { name: "robots", content: "noindex" }] }),
  component: MyAttendance,
});

type AttendanceShift = { id: string; start_time: string; end_time: string; is_overnight: boolean; duty_role: string | null; planned_break_minutes: number; status: string };
type AttendanceSession = { id: string; shift_id: string | null; clock_out_at: string | null; clock_in_at: string; late_minutes: number | null; duty_date: string; worked_minutes: number | null; status: string };
type AttendanceTask = { id: string; title: string; status: string; priority: string; description: string | null; due_date: string; due_at: string | null; checklist: Array<{ id: string; is_done: boolean; label: string }>; requires_verification: boolean; requires_photo: boolean; photo_path: string | null };
type AttendanceRequest = { id: string; request_type: string; status: string; reason: string; review_note: string | null };
type UpcomingShift = AttendanceShift & { shift_date: string; station_name: string | null };
type AttendanceWorkspace = { settings: { geofence_enabled: boolean; qr_verification_enabled: boolean; selfie_verification_enabled?: boolean } | null; shifts: AttendanceShift[]; upcomingShifts?: UpcomingShift[]; sessions: AttendanceSession[]; tasks: AttendanceTask[]; requests: AttendanceRequest[]; activeBreak: { id: string; session_id?: string; started_at: string } | null; lastClosedBreak?: { id: string; session_id: string; started_at: string; ended_at: string } | null };

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
  const uploadSelfie = useServerFn(staffUploadAttendanceSelfie);
  const uploadTaskPhoto = useServerFn(staffUploadAttendanceTaskPhoto);
  const [taskPhotoPaths, setTaskPhotoPaths] = useState<Record<string, string>>({});
  const [taskPhotoPreviews, setTaskPhotoPreviews] = useState<Record<string, string>>({});
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [selfie, setSelfie] = useState<{ base64: string; preview: string } | null>(null);
  const [exceptionPrompt, setExceptionPrompt] = useState<string | null>(null);
  const [exceptionReason, setExceptionReason] = useState("");
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
  const [muted, setMuted] = useState(false);
  useEffect(() => { setMuted(isChimeMuted(window.localStorage)); }, []);
  const chime = (k: ChimeKind) => { try { playChime(k, { store: window.localStorage }); } catch { /* never block */ } };
  const sendQueued = useCallback(async (item: QueuedAction) => {
    const p = (item.payload ?? {}) as Record<string, unknown>;
    try {
      if (item.kind === "clock_in") await clockIn({ data: p as never });
      else if (item.kind === "clock_out") await clockOut({ data: p as never });
      else if (item.kind === "break_start") await startBreak();
      else if (item.kind === "break_end") await endBreak();
      else if (item.kind === "task_item_toggle") await toggleTaskItem({ data: { itemId: String(p.itemId), isDone: Boolean(p.isDone) } });
      else if (item.kind === "task_complete") await completeTask({ data: { taskId: String(p.taskId), completionNote: (p.completionNote as string | null) ?? null, photoPath: null } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isPermanentError(message)) throw err;
      if (isTaskKind(item.kind)) {
        const tws = (await getWorkspace()) as AttendanceWorkspace;
        const tv = reconcileTaskConflict(item, { tasks: tws.tasks as never });
        if (!tv.confirmed) throw new Error(`${tv.reason} (${message})`);
        return;
      }
      // A previous attempt may have committed while its reply was lost: check the server's real state.
      const ws = (await getWorkspace()) as AttendanceWorkspace;
      const open = ws.sessions.find((s) => !s.clock_out_at);
      const closed = ws.sessions.filter((s) => s.clock_out_at).sort((a, b) => String(b.clock_out_at).localeCompare(String(a.clock_out_at)))[0];
      const verdict = reconcileConflict(item, {
        activeSession: open ? { clockInAt: open.clock_in_at } : null,
        activeBreak: ws.activeBreak ? { startedAt: ws.activeBreak.started_at } : null,
        lastClosedSession: closed?.clock_out_at ? { clockOutAt: closed.clock_out_at } : null,
        lastClosedBreak: ws.lastClosedBreak ? { id: ws.lastClosedBreak.id, sessionId: ws.lastClosedBreak.session_id, startedAt: ws.lastClosedBreak.started_at, endedAt: ws.lastClosedBreak.ended_at } : null,
      });
      if (!verdict.confirmed) throw new Error(`${verdict.reason} (${message})`);
    }
  }, [clockIn, clockOut, startBreak, endBreak, getWorkspace, toggleTaskItem, completeTask]);
  const flushingRef = useRef(false);
  const recoveredRef = useRef(false);
  const syncQueue = useCallback(async () => {
    const st = queueRef.current; if (!st) return;
    if (flushingRef.current) return; // never run two flushes at once
    flushingRef.current = true;
    try {
    await clearConfirmed(st);
    // Once per page load: a "syncing" item left by a previous page was interrupted; retry it.
    if (!recoveredRef.current) { recoveredRef.current = true; await recoverInterruptedSync(st); }
    if (navigator.onLine && (await st.all()).some((i) => i.state === "pending")) {
      setQueue(await st.all());
      await flush(st, async (item) => { setQueue((q) => q.map((x) => x.id === item.id ? { ...x, state: "syncing" } : x)); await sendQueued(item); });
      await qc.invalidateQueries({ queryKey: ["my-attendance-workspace"] });
    }
    setQueue(await st.all());
    } finally { flushingRef.current = false; }
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
    try { const r = await send(); if (r === EXCEPTION_PENDING) return; await refresh(); chime(kind === "clock_in" ? "clock_in" : kind === "clock_out" ? "clock_out" : "break"); toast.success(success); }
    catch (error) {
      const st = queueRef.current;
      const canQueue = st && !(payload && ("qrToken" in payload || "selfiePath" in payload)) && isTransientNetworkError(error, navigator.onLine);
      if (!canQueue) { chime("warning"); toast.error(error instanceof Error ? error.message : "Action failed"); return; }
      try { await enqueue(st, kind, crypto.randomUUID(), new Date(), payload); setQueue(await st.all()); toast.warning("No connection — saved on this phone. It is NOT recorded until it shows Confirmed."); chime("queued"); }
      catch (qe) { toast.error(qe instanceof Error ? qe.message : "Could not save offline"); }
    } finally { setBusy(false); }
  };
  const taskAction = async (kind: QueueKind, send: () => Promise<unknown>, payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    try { await send(); await refresh(); toast.success(success); }
    catch (error) {
      const st = queueRef.current;
      if (!st || !isTransientNetworkError(error, navigator.onLine)) { chime("warning"); toast.error(error instanceof Error ? error.message : "Action failed"); return; }
      try { await enqueue(st, kind, crypto.randomUUID(), new Date(), payload); setQueue(await st.all()); chime("queued"); toast.warning("No connection — saved on this phone. Shows Pending sync until the server confirms."); }
      catch (qe) { toast.error(qe instanceof Error ? qe.message : "Could not save offline"); }
    } finally { setBusy(false); }
  };
  const doClockOut = async (reason?: string) => {
    if (busy) return;
    const loc = query.data && (query.data as AttendanceWorkspace).settings?.geofence_enabled ? await readClockOutLocation() : {};
    const d = { note: note.trim() || null, ...loc, ...(reason ? { exceptionReason: reason } : {}) };
    await punch("clock_out", async () => {
      try { const r = await clockOut({ data: d }); setExceptionPrompt(null); setExceptionReason(""); return r; }
      catch (error) {
        const ex = parseExceptionRequired(error instanceof Error ? error.message : "");
        if (ex) { setExceptionPrompt(ex.message); return EXCEPTION_PENDING; }
        throw error;
      }
    }, d, reason ? "Clocked out — sent for Owner review" : "Clocked out");
  };
  const query = useQuery({ queryKey: ["my-attendance-workspace"], queryFn: () => getWorkspace(), refetchInterval: 60000 });
  const refresh = async () => qc.invalidateQueries({ queryKey: ["my-attendance-workspace"] });
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await operation(); await refresh(); toast.success(success); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Action failed"); }
    finally { setBusy(false); }
  };
  const chooseTaskPhoto = (taskId: string, file?: File) => {
    if (!file) return;
    if (file.size > 1_500_000) { toast.error("Photo must be 1.5 MB or smaller."); return; }
    setBusy(true);
    const reader = new FileReader();
    reader.onerror = () => { setBusy(false); toast.error("Could not read photo. Try again."); };
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      const base64 = dataUrl.split(",")[1];
      if (!base64) { setBusy(false); toast.error("Could not read photo. Try again."); return; }
      try {
        const uploaded = await uploadTaskPhoto({ data: { taskId, imageBase64: base64 } });
        setTaskPhotoPaths((old) => ({ ...old, [taskId]: uploaded.path }));
        setTaskPhotoPreviews((old) => ({ ...old, [taskId]: dataUrl }));
        toast.success("Task photo uploaded. Complete the task before the 15-minute expiry.");
      } catch (error) { toast.error(error instanceof Error ? error.message : "Photo upload failed."); }
      finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
  };
  if (query.isLoading) return <div className="space-y-3"><Skeleton className="h-32 w-full"/><Skeleton className="h-48 w-full"/></div>;
  if (query.error || !query.data) return <EmptyState title="Attendance unavailable" description="Your attendance workspace could not be loaded." action={<Button onClick={() => void query.refetch()}>Retry</Button>} />;
  const { shifts, sessions, tasks, requests, activeBreak, settings } = query.data as AttendanceWorkspace;
  const activeSession = sessions.find((s) => !s.clock_out_at);
  const pendingTasks = tasks.filter((t) => !["completed","verified","cancelled"].includes(t.status));
  const dateTime = (v: string) => new Date(v).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return <div className="space-y-5">
      <div className="flex justify-end"><Button type="button" size="sm" variant="ghost" aria-pressed={!muted} onClick={() => { const m = !muted; setMuted(m); setChimeMuted(window.localStorage, m); if (!m) playChime("break", { store: window.localStorage }); }}>{muted ? <VolumeX className="mr-1 h-4 w-4"/> : <Volume2 className="mr-1 h-4 w-4"/>}{muted ? "Sounds off" : "Sounds on"}</Button></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-bold">My Attendance & Tasks</h2><p className="text-sm text-muted-foreground">Bangladesh time · Your records only</p></div><Button variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button></div>
    <Card><CardContent className="space-y-4 p-4">
      <h3 className="font-display font-bold">Duty punch</h3>
      {!online ? <p className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">You are offline. Clock-in/out, breaks, checklist ticks and task completions (without photo) will be saved on this phone and sent when the connection returns. QR clock-in needs a connection.</p> : null}
      {queue.length ? <div className="space-y-1 rounded-md border p-2 text-sm"><p className="font-semibold">Pending sync ({queue.filter((q) => q.state !== "confirmed").length})</p>{!persistent ? <p className="text-xs text-destructive">This browser cannot store offline punches safely — they will be lost if you close or reload the page.</p> : null}{queue.map((q) => <div key={q.id} className="flex flex-wrap items-center justify-between gap-2"><span>{QUEUE_LABEL[q.kind]} · tapped {dateTime(q.requestedAt)}{q.error && q.state === "failed" ? ` · ${q.error}` : ""}</span><span className="flex items-center gap-2"><span className={"rounded-full px-2 py-0.5 text-xs " + (q.state === "failed" ? "bg-destructive/15 text-destructive" : q.state === "confirmed" ? "bg-primary/15 text-primary" : "bg-muted")}>{q.state === "pending" ? "Pending" : q.state === "syncing" ? "Syncing" : q.state === "confirmed" ? "Confirmed" : "Failed"}</span>{q.state === "failed" ? <Button size="sm" variant="outline" onClick={() => void (async () => { if (queueRef.current) { await retryFailed(queueRef.current, q.id); await syncQueue(); } })()}>Retry</Button> : null}</span></div>)}<p className="text-xs text-muted-foreground">Server time is recorded when the action syncs, not when you tapped.</p></div> : null}
      {activeSession ? <div className="rounded-lg border p-3"><p className="font-semibold">On duty since {dateTime(activeSession.clock_in_at)}</p><p className="text-sm text-muted-foreground">Status: {activeBreak ? "On break" : "On duty"} · Late {activeSession.late_minutes ?? 0} min</p>{activeBreak ? (() => { const b = breakStatus(activeBreak.started_at, now, shifts.find((x) => x.id === activeSession.shift_id)?.planned_break_minutes ?? null); return b.allowanceMinutes == null ? <p className="mt-1 text-xs text-muted-foreground">On break {b.minutes} min · no scheduled break limit for this session.{b.minutes > 30 ? " Possible long break (unscheduled estimate, over 30 min)." : ""}</p> : b.exceeded ? <p className="mt-2 rounded-md border border-destructive/40 p-2 text-sm text-destructive">Scheduled limit exceeded: your break is {b.overBy} min over your scheduled {b.allowanceMinutes} min. Please end your break.</p> : <p className="mt-1 text-xs text-muted-foreground">On break {b.minutes} of {b.allowanceMinutes} scheduled min.</p>; })() : null}<div className="mt-3 flex flex-wrap gap-2">{activeBreak ? <Button disabled={busy} onClick={() => void punch("break_end", () => endBreak(), activeBreak.session_id ? { breakId: activeBreak.id, sessionId: activeBreak.session_id } : undefined, "Break ended")}><Coffee className="mr-2 h-4 w-4"/>End break</Button> : <Button variant="outline" disabled={busy} onClick={() => void punch("break_start", () => startBreak(), undefined, "Break started")}><Coffee className="mr-2 h-4 w-4"/>Start break</Button>}<Button variant="destructive" disabled={busy || Boolean(activeBreak)} onClick={() => void doClockOut()}><LogOut className="mr-2 h-4 w-4"/>Clock out</Button></div></div> : <form className="space-y-3" onSubmit={(e) => {e.preventDefault(); void (async () => {
          const payload: { shiftId: string | null; note: string | null; latitude?: number; longitude?: number; accuracyMeters?: number; capturedAt?: number; qrToken?: string; selfiePath?: string } = { shiftId: shiftId || null, note: note.trim() || null };
          try {
            if (settings?.geofence_enabled) { if (!navigator.onLine) throw new Error("Geofence clock-in needs an online connection so the GPS reading can be checked immediately."); if (!navigator.geolocation) throw new Error("This browser does not support GPS location."); const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Location permission is required to clock in.")), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })); payload.latitude = position.coords.latitude; payload.longitude = position.coords.longitude; payload.accuracyMeters = position.coords.accuracy; payload.capturedAt = Math.round(position.timestamp); }
            if (settings?.qr_verification_enabled) { if (!qrToken.trim()) throw new Error("Enter the station QR token before clocking in."); payload.qrToken = qrToken.trim(); }
            if (settings?.selfie_verification_enabled) {
              if (!selfie) throw new Error("Take a selfie before clocking in.");
              if (!navigator.onLine) throw new Error("Selfie clock-in needs a connection. Try again when online.");
              setBusy(true);
              try { const up = await uploadSelfie({ data: { imageBase64: selfie.base64 } }); payload.selfiePath = up.path; }
              finally { setBusy(false); }
            }
          } catch (err) { toast.error(err instanceof Error ? err.message : "Clock-in failed"); return; }
          await punch("clock_in", () => clockIn({ data: payload }), payload, "Clocked in");
          setSelfie(null);
        })();}}>
        <div className="space-y-1"><Label htmlFor="attendance-shift">Today's shift</Label><select id="attendance-shift" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={shiftId} onChange={(e)=>setShiftId(e.target.value)}><option value="">Unscheduled / automatic selection</option>{shifts.filter((s) =>s.status==="scheduled").map((s) =><option key={s.id} value={s.id}>{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}{s.is_overnight?" overnight":""}{s.duty_role?" · "+s.duty_role:""}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="punch-note">Note (optional)</Label><Input id="punch-note" maxLength={500} value={note} onChange={(e)=>setNote(e.target.value)}/></div>
        {settings?.geofence_enabled ? <p className="text-xs text-muted-foreground">GPS geofence is enabled. Allow precise location when prompted; location is checked against your assigned station on the server.</p> : null}{settings?.qr_verification_enabled ? <div className="space-y-2"><Label htmlFor="attendance-qr-token">Station QR token</Label><Input id="attendance-qr-token" autoComplete="off" maxLength={512} value={qrToken} onChange={(e) => setQrToken(e.target.value)} placeholder="Paste the token from your station QR"/><Button type="button" variant="outline" disabled={busy} onClick={()=>setQrScannerOpen(true)}><Camera className="mr-2 h-4 w-4"/>Scan station QR</Button><p className="text-xs text-muted-foreground">Camera scanning requires permission and a supported Android browser. Manual token entry remains available.</p></div> : null}{settings?.selfie_verification_enabled ? <div className="space-y-2"><Label>Clock-in selfie (required)</Label>{selfie ? <img src={selfie.preview} alt="Your clock-in selfie" className="h-24 w-24 rounded-md object-cover" /> : null}<Button type="button" variant="outline" disabled={busy} onClick={() => setSelfieOpen(true)}><Camera className="mr-2 h-4 w-4"/>{selfie ? "Retake selfie" : "Take selfie"}</Button><p className="text-xs text-muted-foreground">Photo evidence for Owner review only. Face matching is not implemented. Clock-out never needs a selfie.</p></div> : null}<p className="text-xs text-muted-foreground">Clock-in uses server time and current Owner settings.</p><Button disabled={busy}><LogIn className="mr-2 h-4 w-4"/>Clock in</Button>
      </form>}
    </CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Today's schedule</h3>{shifts.length?shifts.map((s) =><div key={s.id} className="rounded-lg border p-3"><p className="font-semibold">{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}{s.is_overnight?" · overnight":""}</p><p className="text-sm text-muted-foreground">{s.duty_role||"Scheduled duty"} · break {s.planned_break_minutes} min · {s.status}</p></div>):<p className="text-sm text-muted-foreground">No shift assigned for today.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Upcoming shifts (next 14 days)</h3><p className="text-xs text-muted-foreground">View only. You can clock in only on the day of the shift.</p>{(query.data as AttendanceWorkspace).upcomingShifts?.length ? (query.data as AttendanceWorkspace).upcomingShifts!.map((s) => <div key={s.id} className="rounded-lg border p-3"><p className="font-semibold">{new Date(`${s.shift_date}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short" })} · {s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}{s.is_overnight?" · overnight":""}</p><p className="text-sm text-muted-foreground">{s.duty_role||"Scheduled duty"}{s.station_name?" · "+s.station_name:""} · break {s.planned_break_minutes} min{s.status==="on_leave"?" · on leave":""}</p></div>) : <p className="text-sm text-muted-foreground">No upcoming shifts assigned.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">My tasks</h3>{pendingTasks.length?pendingTasks.map((task) =><div key={task.id} className="space-y-2 rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{task.title}</p><span className="rounded-full bg-muted px-2 py-1 text-xs">{task.status} · {task.priority}</span></div>{task.description?<p className="text-sm text-muted-foreground">{task.description}</p>:null}{task.requires_photo?<div className="space-y-2 rounded-md border p-3"><p className="text-sm font-medium"><Camera className="mr-1 inline h-4 w-4"/>Photo proof required</p><input type="file" accept="image/jpeg,image/*" capture="environment" disabled={busy} onChange={(e)=>{chooseTaskPhoto(task.id,e.target.files?.[0]);e.currentTarget.value="";}} className="block w-full text-sm"/>{taskPhotoPreviews[task.id]?<div className="space-y-1"><img src={taskPhotoPreviews[task.id]} alt="Task proof preview" className="max-h-48 rounded-md object-contain"/><p className="text-xs text-muted-foreground">Uploaded and ready to attach</p></div>:task.photo_path?<p className="text-xs text-muted-foreground">A photo is already attached to this task.</p>:<p className="text-xs text-muted-foreground">Take a JPEG photo. Maximum 1.5 MB.</p>}</div>:null}<p className="text-xs text-muted-foreground">Due {task.due_date}{task.due_at?" · "+dateTime(task.due_at):""}</p>{task.checklist?.length?<div className="space-y-2 rounded-md bg-muted/40 p-2">{task.checklist.map((item) =><label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(item.is_done)} disabled={busy} onChange={(e)=>void taskAction("task_item_toggle",()=>toggleTaskItem({data:{itemId:item.id,isDone:e.target.checked}}),{itemId:item.id,isDone:e.target.checked},e.target.checked?"Checklist item completed":"Checklist item reopened")}/>{queue.some((q)=>q.kind==="task_item_toggle"&&q.payload?.itemId===item.id&&q.state!=="confirmed")?<span className="rounded-full bg-muted px-2 py-0.5 text-xs">Pending sync</span>:null}<span className={item.is_done?"line-through text-muted-foreground":""}>{item.label}</span></label>)}</div>:null}<Textarea rows={2} maxLength={1000} placeholder="Completion note (optional)" value={completionNotes[task.id]||""} onChange={(e)=>setCompletionNotes((old)=>({...old,[task.id]:e.target.value}))}/><Button size="sm" disabled={busy||(task.checklist??[]).some((item)=>!item.is_done)||(task.requires_photo&&!taskPhotoPaths[task.id]&&!task.photo_path)} onClick={()=>{const d={taskId:task.id,completionNote:completionNotes[task.id]?.trim()||null,photoPath:taskPhotoPaths[task.id]??task.photo_path??null};void taskAction("task_complete",()=>completeTask({data:d}),{...d,requiresPhoto:Boolean(task.requires_photo)}, task.requires_verification?"Submitted for Owner verification":"Task completed");}}><CheckCircle2 className="mr-2 h-4 w-4"/>Mark complete</Button>{queue.some((q)=>q.kind==="task_complete"&&q.payload?.taskId===task.id&&q.state!=="confirmed")?<span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">Completion pending sync</span>:null}</div>):<p className="text-sm text-muted-foreground">No open tasks assigned to you.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Attendance history</h3>{sessions.length?sessions.map((s) =><div key={s.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3"><div><p className="font-semibold">{s.duty_date}</p><p className="text-xs text-muted-foreground">In {dateTime(s.clock_in_at)} · Out {s.clock_out_at?dateTime(s.clock_out_at):"—"}</p></div><div className="text-right text-sm"><p>{s.worked_minutes} worked min</p><p className={(s.late_minutes ?? 0)>0?"text-destructive":"text-muted-foreground"}>{(s.late_minutes ?? 0)>0?"Late "+s.late_minutes+" min":s.status}</p></div></div>):<p className="text-sm text-muted-foreground">No attendance history yet.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Submit a request</h3><form className="grid gap-3 sm:grid-cols-2" onSubmit={(e)=>{e.preventDefault();void run(async()=>{await createRequest({data:{requestType,leaveType:requestType==="leave"?leaveType:null,leaveStartDate:requestType==="leave"?leaveStart:null,leaveEndDate:requestType==="leave"?leaveEnd:null,targetDate:requestType!=="leave"?targetDate:null,sessionId:requestType==="correction"||requestType==="overtime"?requestSessionId||null:null,requestedClockIn:(requestType==="correction"||requestType==="missed_punch")&&requestedIn?new Date(requestedIn).toISOString():null,requestedClockOut:(requestType==="correction"||requestType==="missed_punch")&&requestedOut?new Date(requestedOut).toISOString():null,requestedOvertimeMinutes:requestType==="overtime"?Number(overtime):null,reason}});setReason("");}, "Request submitted");}}>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="request-type">Request type</Label><select id="request-type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={requestType} onChange={(e)=>setRequestType(e.target.value as typeof requestType)}><option value="leave">Leave</option><option value="correction">Attendance correction</option><option value="missed_punch">Missed punch (both times)</option><option value="overtime">Overtime</option></select></div>
      {requestType==="leave"?<><div className="space-y-1"><Label htmlFor="leave-type">Leave type</Label><select id="leave-type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={leaveType} onChange={(e)=>setLeaveType(e.target.value)}><option value="annual">Annual</option><option value="sick">Sick</option><option value="casual">Casual</option><option value="unpaid">Unpaid</option></select></div><div/><div className="space-y-1"><Label htmlFor="leave-start">From</Label><Input id="leave-start" type="date" required value={leaveStart} onChange={(e)=>setLeaveStart(e.target.value)}/></div><div className="space-y-1"><Label htmlFor="leave-end">To</Label><Input id="leave-end" type="date" min={leaveStart||undefined} required value={leaveEnd} onChange={(e)=>setLeaveEnd(e.target.value)}/></div></>:null}
      {requestType!=="leave"?<>{(requestType==="correction"||requestType==="overtime")?<div className="space-y-1 sm:col-span-2"><Label htmlFor="request-session">Attendance session</Label><select id="request-session" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={requestSessionId} onChange={(e)=>setRequestSessionId(e.target.value)}><option value="">Select session</option>{sessions.map((s) =><option key={s.id} value={s.id}>{s.duty_date} · {dateTime(s.clock_in_at)}</option>)}</select></div>:null}<div className="space-y-1"><Label htmlFor="request-date">Target date</Label><Input id="request-date" type="date" required value={targetDate} onChange={(e)=>setTargetDate(e.target.value)}/></div>{requestType==="correction"||requestType==="missed_punch"?<><div className="space-y-1"><Label htmlFor="requested-in">Requested clock-in</Label><Input id="requested-in" type="datetime-local" required value={requestedIn} onChange={(e)=>setRequestedIn(e.target.value)}/></div><div className="space-y-1"><Label htmlFor="requested-out">Requested clock-out</Label><Input id="requested-out" type="datetime-local" required value={requestedOut} onChange={(e)=>setRequestedOut(e.target.value)}/></div></>:<div className="space-y-1"><Label htmlFor="overtime-minutes">Overtime minutes</Label><Input id="overtime-minutes" type="number" min={1} max={960} value={overtime} onChange={(e)=>setOvertime(e.target.value)}/></div>}</>:null}
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="request-reason">Reason</Label><Textarea id="request-reason" required minLength={5} maxLength={1000} value={reason} onChange={(e)=>setReason(e.target.value)}/></div><Button disabled={busy} className="sm:col-span-2"><Send className="mr-2 h-4 w-4"/>Submit request</Button>
    </form>
    <div className="space-y-2">{requests.map((r) =><div key={r.id} className="rounded-lg border p-3"><div className="flex justify-between gap-2"><p className="font-semibold">{r.request_type.replaceAll("_"," ")}</p><span className="text-xs">{r.status}</span></div><p className="text-sm text-muted-foreground">{r.reason}</p>{r.review_note?<p className="text-xs">Owner note: {r.review_note}</p>:null}{r.status==="pending"?<Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void run(()=>cancelRequest({data:{requestId:r.id}}),"Request cancelled")}><XCircle className="mr-1 h-4 w-4"/>Cancel request</Button>:null}</div>)}</div>
    </CardContent></Card>
    <Dialog open={exceptionPrompt !== null} onOpenChange={(o) => { if (!o && !busy) { setExceptionPrompt(null); setExceptionReason(""); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Location could not be verified</DialogTitle><DialogDescription>{exceptionPrompt}</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="clockout-reason">Reason for clocking out without verified location</Label><Textarea id="clockout-reason" rows={3} maxLength={EXCEPTION_REASON_MAX} value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} placeholder="e.g. Closed the shop and left, phone GPS not working" /><p className="text-xs text-muted-foreground">Your actual clock-out time is recorded now. This session will be marked unverified for Owner review. No location is invented.</p></div>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setExceptionPrompt(null); setExceptionReason(""); }}>Cancel</Button><Button variant="destructive" disabled={busy || exceptionReason.trim().length < EXCEPTION_REASON_MIN} onClick={() => void doClockOut(exceptionReason.trim())}>Clock out for review</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <SelfieCaptureDialog open={selfieOpen} onOpenChange={setSelfieOpen} onCapture={(base64, preview) => setSelfie({ base64, preview })} />
    <QrScannerDialog open={qrScannerOpen} onOpenChange={setQrScannerOpen} onScan={(token)=>{setQrToken(token);toast.success("Station QR scanned");}} />
  </div>;
}
