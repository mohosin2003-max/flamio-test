import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, Coffee, LogIn, LogOut, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  staffClockIn, staffClockOut, staffCreateAttendanceRequest, staffEndBreak,
  staffGetAttendanceWorkspace, staffStartBreak, staffCompleteAttendanceTask,
} from "@/lib/attendance-workflow.functions";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "My Attendance — Flamio" }, { name: "robots", content: "noindex" }] }),
  component: MyAttendance,
});

function MyAttendance() {
  const qc = useQueryClient();
  const getWorkspace = useServerFn(staffGetAttendanceWorkspace);
  const clockIn = useServerFn(staffClockIn);
  const clockOut = useServerFn(staffClockOut);
  const startBreak = useServerFn(staffStartBreak);
  const endBreak = useServerFn(staffEndBreak);
  const completeTask = useServerFn(staffCompleteAttendanceTask);
  const createRequest = useServerFn(staffCreateAttendanceRequest);
  const [shiftId, setShiftId] = useState("");
  const [note, setNote] = useState("");
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
  const { shifts, sessions, tasks, requests, activeBreak } = query.data;
  const activeSession = sessions.find((s: any) => !s.clock_out_at);
  const pendingTasks = tasks.filter((t: any) => !["completed","verified","cancelled"].includes(t.status));
  const dateTime = (v: string) => new Date(v).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-bold">My Attendance & Tasks</h2><p className="text-sm text-muted-foreground">Bangladesh time · Your records only</p></div><Button variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button></div>
    <Card><CardContent className="space-y-4 p-4">
      <h3 className="font-display font-bold">Duty punch</h3>
      {activeSession ? <div className="rounded-lg border p-3"><p className="font-semibold">On duty since {dateTime(activeSession.clock_in_at)}</p><p className="text-sm text-muted-foreground">Status: {activeBreak ? "On break" : "On duty"} · Late {activeSession.late_minutes ?? 0} min</p><div className="mt-3 flex flex-wrap gap-2">{activeBreak ? <Button disabled={busy} onClick={() => void run(() => endBreak(), "Break ended")}><Coffee className="mr-2 h-4 w-4"/>End break</Button> : <Button variant="outline" disabled={busy} onClick={() => void run(() => startBreak(), "Break started")}><Coffee className="mr-2 h-4 w-4"/>Start break</Button>}<Button variant="destructive" disabled={busy || Boolean(activeBreak)} onClick={() => void run(() => clockOut({ data: { note: note.trim() || null } }), "Clocked out")}><LogOut className="mr-2 h-4 w-4"/>Clock out</Button></div></div> : <form className="space-y-3" onSubmit={(e) => {e.preventDefault(); void run(() => clockIn({data:{shiftId:shiftId||null,note:note.trim()||null}}), "Clocked in");}}>
        <div className="space-y-1"><Label htmlFor="attendance-shift">Today's shift</Label><select id="attendance-shift" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={shiftId} onChange={(e)=>setShiftId(e.target.value)}><option value="">Unscheduled / automatic selection</option>{shifts.filter((s:any)=>s.status==="scheduled").map((s:any)=><option key={s.id} value={s.id}>{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}{s.is_overnight?" overnight":""}{s.duty_role?" · "+s.duty_role:""}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="punch-note">Note (optional)</Label><Input id="punch-note" maxLength={500} value={note} onChange={(e)=>setNote(e.target.value)}/></div>
        <p className="text-xs text-muted-foreground">Clock-in follows current server settings. GPS/geofence and selfie/QR verification are not yet enabled in this build.</p><Button disabled={busy}><LogIn className="mr-2 h-4 w-4"/>Clock in</Button>
      </form>}
    </CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Today's schedule</h3>{shifts.length?shifts.map((s:any)=><div key={s.id} className="rounded-lg border p-3"><p className="font-semibold">{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}{s.is_overnight?" · overnight":""}</p><p className="text-sm text-muted-foreground">{s.duty_role||"Scheduled duty"} · break {s.planned_break_minutes} min · {s.status}</p></div>):<p className="text-sm text-muted-foreground">No shift assigned for today.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">My tasks</h3>{pendingTasks.length?pendingTasks.map((task:any)=><div key={task.id} className="space-y-2 rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{task.title}</p><span className="rounded-full bg-muted px-2 py-1 text-xs">{task.status} · {task.priority}</span></div>{task.description?<p className="text-sm text-muted-foreground">{task.description}</p>:null}<p className="text-xs text-muted-foreground">Due {task.due_date}{task.due_at?" · "+dateTime(task.due_at):""}</p><Textarea rows={2} maxLength={1000} placeholder="Completion note (optional)" value={completionNotes[task.id]||""} onChange={(e)=>setCompletionNotes((old)=>({...old,[task.id]:e.target.value}))}/><Button size="sm" disabled={busy} onClick={()=>void run(()=>completeTask({data:{taskId:task.id,completionNote:completionNotes[task.id]?.trim()||null}}), task.requires_verification?"Submitted for Owner verification":"Task completed")}><CheckCircle2 className="mr-2 h-4 w-4"/>Mark complete</Button></div>):<p className="text-sm text-muted-foreground">No open tasks assigned to you.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Attendance history</h3>{sessions.length?sessions.map((s:any)=><div key={s.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3"><div><p className="font-semibold">{s.duty_date}</p><p className="text-xs text-muted-foreground">In {dateTime(s.clock_in_at)} · Out {s.clock_out_at?dateTime(s.clock_out_at):"—"}</p></div><div className="text-right text-sm"><p>{s.worked_minutes} worked min</p><p className={s.late_minutes>0?"text-destructive":"text-muted-foreground"}>{s.late_minutes>0?"Late "+s.late_minutes+" min":s.status}</p></div></div>):<p className="text-sm text-muted-foreground">No attendance history yet.</p>}</CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Submit a request</h3><form className="grid gap-3 sm:grid-cols-2" onSubmit={(e)=>{e.preventDefault();void run(async()=>{await createRequest({data:{requestType,leaveType:requestType==="leave"?leaveType:null,leaveStartDate:requestType==="leave"?leaveStart:null,leaveEndDate:requestType==="leave"?leaveEnd:null,targetDate:requestType!=="leave"?targetDate:null,requestedClockIn:requestType==="attendance_correction"&&requestedIn?new Date(requestedIn).toISOString():null,requestedClockOut:requestType==="attendance_correction"&&requestedOut?new Date(requestedOut).toISOString():null,requestedOvertimeMinutes:requestType==="overtime"?Number(overtime):null,reason}});setReason("");}, "Request submitted");}}>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="request-type">Request type</Label><select id="request-type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={requestType} onChange={(e)=>setRequestType(e.target.value as typeof requestType)}><option value="leave">Leave</option><option value="correction">Attendance correction</option><option value="missed_punch">Missed punch (both times)</option><option value="overtime">Overtime</option></select></div>
      {requestType==="leave"?<><div className="space-y-1"><Label htmlFor="leave-type">Leave type</Label><select id="leave-type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={leaveType} onChange={(e)=>setLeaveType(e.target.value)}><option value="annual">Annual</option><option value="sick">Sick</option><option value="personal">Personal</option><option value="unpaid">Unpaid</option></select></div><div/><div className="space-y-1"><Label htmlFor="leave-start">From</Label><Input id="leave-start" type="date" required value={leaveStart} onChange={(e)=>setLeaveStart(e.target.value)}/></div><div className="space-y-1"><Label htmlFor="leave-end">To</Label><Input id="leave-end" type="date" min={leaveStart||undefined} required value={leaveEnd} onChange={(e)=>setLeaveEnd(e.target.value)}/></div></>:null}
      {requestType!=="leave"?<>{(requestType==="correction"||requestType==="overtime")?<div className="space-y-1 sm:col-span-2"><Label htmlFor="request-session">Attendance session</Label><select id="request-session" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={requestSessionId} onChange={(e)=>setRequestSessionId(e.target.value)}><option value="">Select session</option>{sessions.map((s:any)=><option key={s.id} value={s.id}>{s.duty_date} · {dateTime(s.clock_in_at)}</option>)}</select></div>:null}<div className="space-y-1"><Label htmlFor="request-date">Target date</Label><Input id="request-date" type="date" required value={targetDate} onChange={(e)=>setTargetDate(e.target.value)}/></div>{requestType==="correction"||requestType==="missed_punch"?<><div className="space-y-1"><Label htmlFor="requested-in">Requested clock-in (optional)</Label><Input id="requested-in" type="datetime-local" required={requestType==="missed_punch"} value={requestedIn} onChange={(e)=>setRequestedIn(e.target.value)}/></div><div className="space-y-1"><Label htmlFor="requested-out">Requested clock-out (optional)</Label><Input id="requested-out" type="datetime-local" required={requestType==="missed_punch"} value={requestedOut} onChange={(e)=>setRequestedOut(e.target.value)}/></div></>:<div className="space-y-1"><Label htmlFor="overtime-minutes">Overtime minutes</Label><Input id="overtime-minutes" type="number" min={1} max={720} value={overtime} onChange={(e)=>setOvertime(e.target.value)}/></div>}</>:null}
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="request-reason">Reason</Label><Textarea id="request-reason" required minLength={5} maxLength={1000} value={reason} onChange={(e)=>setReason(e.target.value)}/></div><Button disabled={busy} className="sm:col-span-2"><Send className="mr-2 h-4 w-4"/>Submit request</Button>
    </form>
    <div className="space-y-2">{requests.map((r:any)=><div key={r.id} className="rounded-lg border p-3"><div className="flex justify-between gap-2"><p className="font-semibold">{r.request_type.replaceAll("_"," ")}</p><span className="text-xs">{r.status}</span></div><p className="text-sm text-muted-foreground">{r.reason}</p>{r.review_note?<p className="text-xs">Owner note: {r.review_note}</p>:null}</div>)}</div>
    </CardContent></Card>
  </div>;
}
