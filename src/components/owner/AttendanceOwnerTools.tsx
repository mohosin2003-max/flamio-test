// Owner attendance controls moved out of the read-only Attendance Reports page.
// Each card reuses the existing server functions and contracts unchanged.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ownerAssignStoreChecklist, ownerCheckAttendanceIssues, ownerCreateRecurringShifts, ownerGetAttendanceFeatures,
  ownerListStoreChecklists, ownerRecoverStaleSession, ownerSetAttendanceFeatures,
  ownerListEditableTasks, ownerUpdateAttendanceTask, ownerDisableAttendanceTask,
} from "@/lib/attendance-extras.functions";
import { ownerListAttendanceManagement } from "@/lib/attendance-management.functions";
import { STORE_CHECKLISTS } from "@/lib/attendance-rules";
import { formatMinutes } from "@/lib/attendance-logic";
import { dhakaDateKey } from "@/lib/dates";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dt = (v: string) => new Date(v).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Action failed");
const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

function useAct() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, ok: string, keys: string[][]) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k }))); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };
  return { busy, act };
}

function useStaffAndStations() {
  const listMgmt = useServerFn(ownerListAttendanceManagement);
  const mgmt = useQuery({ queryKey: ["att-mgmt-staff"], queryFn: () => listMgmt() });
  const staff: { id: string; name: string }[] = (mgmt.data as { staff?: { id: string; name: string }[] } | undefined)?.staff ?? [];
  const stations: { id: string; name: string; isActive: boolean }[] = ((mgmt.data as { stations?: { id: string; name: string; isActive: boolean }[] } | undefined)?.stations ?? []).filter((s) => s.isActive);
  return { staff, stations };
}

export function AttendanceFeatureTogglesCard() {
  const getFeatures = useServerFn(ownerGetAttendanceFeatures);
  const setFeatures = useServerFn(ownerSetAttendanceFeatures);
  const features = useQuery({ queryKey: ["att-features"], queryFn: () => getFeatures() });
  const { busy, act } = useAct();
  return (
    <Card><CardContent className="space-y-3 p-4">
      <h3 className="font-display font-bold">On/off switches</h3>
      {features.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : features.error ? <p className="text-sm text-destructive">{errMsg(features.error)}</p> : features.data && !features.data.columnsPresent ? (
        <p className="text-sm text-muted-foreground">Separate Attendance and Tasks switches need a database update that hasn't been applied to TEST yet. Both stay ON until then.</p>
      ) : features.data ? (
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={features.data.attendanceEnabled} onChange={(e) => void act(() => setFeatures({ data: { attendanceEnabled: e.target.checked, tasksEnabled: features.data!.tasksEnabled } }), "Saved", [["att-features"]])} /> Attendance (clock in/out, breaks)</label>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={features.data.tasksEnabled} onChange={(e) => void act(() => setFeatures({ data: { attendanceEnabled: features.data!.attendanceEnabled, tasksEnabled: e.target.checked } }), "Saved", [["att-features"]])} /> Tasks & checklists</label>
        </div>
      ) : null}
    </CardContent></Card>
  );
}

type Issues = { overlongBreaks: { id: string; staffName: string; minutes: number; startedAt: string; kind: "scheduled_exceeded" | "unscheduled_estimate"; limitMinutes: number; overBy: number }[]; missedClockOuts: { id: string; staffName: string; clockInAt: string; shiftEndsAt: string | null }[]; alertsEnabled: boolean };

export function AttendanceNeedsAttentionCard() {
  const checkIssues = useServerFn(ownerCheckAttendanceIssues);
  const recover = useServerFn(ownerRecoverStaleSession);
  const issues = useQuery({ queryKey: ["att-issues"], queryFn: () => checkIssues({ data: { sendAlerts: false } }), refetchInterval: 60000 });
  const issuesData = issues.data as Issues | undefined;
  const { busy, act } = useAct();
  return (
    <Card><CardContent className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display font-bold">Needs attention</h3>
        <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void issues.refetch()}><RefreshCw className="mr-1 h-4 w-4" />Check</Button>
        <Button size="sm" disabled={busy} onClick={() => void act(async () => { const r = await checkIssues({ data: { sendAlerts: true } }); if (!r.alertsEnabled) throw new Error("Attendance alerts are switched off in Attendance settings."); }, "Alerts sent (repeat alerts are skipped)", [["att-issues"]])}>Alert managers</Button></div></div>
      {issues.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : issues.error ? <p className="text-sm text-destructive">{errMsg(issues.error)}</p> : (
        <>
          <p className="text-sm font-semibold">Long breaks</p>
          {issuesData?.overlongBreaks.length ? issuesData.overlongBreaks.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className={"rounded-full px-2 py-0.5 text-xs " + (b.kind === "scheduled_exceeded" ? "bg-destructive/15 text-destructive" : "bg-muted")}>
                {b.kind === "scheduled_exceeded" ? "Scheduled limit exceeded" : "Possible long break (unscheduled estimate)"}
              </span>
              <span>{b.staffName} · on break {formatMinutes(b.minutes)} since {dt(b.startedAt)} · {b.kind === "scheduled_exceeded" ? `scheduled ${b.limitMinutes} min, over by ${b.overBy} min` : `no scheduled break; ${b.limitMinutes}-min estimate`}</span>
            </div>
          )) : <p className="text-sm text-muted-foreground">None.</p>}
          <p className="text-sm font-semibold">Possible missed clock-outs</p>
          {issuesData?.missedClockOuts.length ? issuesData.missedClockOuts.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
              <span>{m.staffName} · in since {dt(m.clockInAt)}{m.shiftEndsAt ? ` · shift ended ${dt(m.shiftEndsAt)}` : " · unscheduled"}</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => recover({ data: { sessionId: m.id } }), "Recovery requested — check the record is flagged for review", [["att-issues"], ["owner-attendance-overview"]])}>Close if over max length</Button>
            </div>
          )) : <p className="text-sm text-muted-foreground">None.</p>}
        </>
      )}
    </CardContent></Card>
  );
}

export function RecurringShiftsCard() {
  const today = dhakaDateKey();
  const createRecurring = useServerFn(ownerCreateRecurringShifts);
  const { staff, stations } = useStaffAndStations();
  const { busy, act } = useAct();
  const [rec, setRec] = useState({ userId: "", stationId: "", from: today, to: today, weekdays: [6, 0, 1, 2, 3] as number[], start: "10:00", end: "18:00", breakMin: 30 });
  const recKey = JSON.stringify(rec);
  const [recPreview, setRecPreview] = useState<{ key: string; items: { date: string; startAt: string; endAt: string; overnight: boolean; conflict: boolean }[] } | null>(null);
  return (
    <Card><CardContent className="space-y-3 p-4">
      <h3 className="font-display font-bold">Repeat a weekly shift</h3>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void act(async () => { const r = await createRecurring({ data: { userId: rec.userId, stationId: rec.stationId || null, fromDate: rec.from, toDate: rec.to, weekdays: rec.weekdays, startTime: rec.start, endTime: rec.end, plannedBreakMinutes: rec.breakMin, preview: true } }); setRecPreview({ key: recKey, items: r.items }); }, "Preview ready — check it, then confirm", []); }}>
        <div><Label htmlFor="rec-staff">Staff</Label><select id="rec-staff" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={rec.userId} onChange={(e) => setRec((o) => ({ ...o, userId: e.target.value }))}><option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><Label htmlFor="rec-station">Station (optional)</Label><select id="rec-station" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={rec.stationId} onChange={(e) => setRec((o) => ({ ...o, stationId: e.target.value }))}><option value="">None</option>{stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><Label htmlFor="rec-from">From</Label><Input id="rec-from" type="date" required value={rec.from} onChange={(e) => setRec((o) => ({ ...o, from: e.target.value }))} /></div>
        <div><Label htmlFor="rec-to">To (max 62 days)</Label><Input id="rec-to" type="date" required value={rec.to} onChange={(e) => setRec((o) => ({ ...o, to: e.target.value }))} /></div>
        <div><Label htmlFor="rec-start">Start</Label><Input id="rec-start" type="time" required value={rec.start} onChange={(e) => setRec((o) => ({ ...o, start: e.target.value }))} /></div>
        <div><Label htmlFor="rec-end">End (earlier = next day)</Label><Input id="rec-end" type="time" required value={rec.end} onChange={(e) => setRec((o) => ({ ...o, end: e.target.value }))} /></div>
        <div><Label htmlFor="rec-break">Break minutes</Label><Input id="rec-break" type="number" min={0} max={240} value={rec.breakMin} onChange={(e) => setRec((o) => ({ ...o, breakMin: Number(e.target.value) }))} /></div>
        <div className="flex flex-wrap items-end gap-2 text-sm">{WEEKDAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={rec.weekdays.includes(i)} onChange={(e) => setRec((o) => ({ ...o, weekdays: e.target.checked ? [...o.weekdays, i] : o.weekdays.filter((x) => x !== i) }))} />{d}</label>)}</div>
        <Button disabled={busy} variant="outline" className="sm:col-span-2">Preview shifts</Button>
      </form>
      {recPreview && recPreview.key === recKey ? (
        <div className="space-y-2 rounded border p-2 text-sm">
          <p className="font-semibold">{recPreview.items.filter((i) => !i.conflict).length} new · {recPreview.items.filter((i) => i.conflict).length} skipped (already booked)</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto">{recPreview.items.map((i) => <li key={i.date} className={i.conflict ? "text-muted-foreground line-through" : ""}>{i.date} · {dt(i.startAt)} → {dt(i.endAt)}{i.overnight ? " (overnight)" : ""}{i.conflict ? " · overlaps existing shift" : ""}</li>)}</ul>
          <Button size="sm" disabled={busy || !recPreview.items.some((i) => !i.conflict)} onClick={() => void act(async () => { const r = await createRecurring({ data: { userId: rec.userId, stationId: rec.stationId || null, fromDate: rec.from, toDate: rec.to, weekdays: rec.weekdays, startTime: rec.start, endTime: rec.end, plannedBreakMinutes: rec.breakMin } }); setRecPreview(null); toast.message(`${r.created} shifts created${r.skippedOverlaps ? `, ${r.skippedOverlaps} skipped (already booked)` : ""}`); }, "Schedule saved", [["att-mgmt-staff"], ["owner-attendance-management"]])}>Confirm and create</Button>
        </div>
      ) : recPreview ? <p className="text-xs text-muted-foreground">Settings changed — preview again before creating.</p> : null}
    </CardContent></Card>
  );
}

type Checklist = { id: string; title: string; status: string; staffName: string; items: { label: string; isDone: boolean; doneAt: string | null; doneBy: string | null }[] };

export function StoreChecklistsCard() {
  const today = dhakaDateKey();
  const assignChecklist = useServerFn(ownerAssignStoreChecklist);
  const listChecklists = useServerFn(ownerListStoreChecklists);
  const checklists = useQuery({ queryKey: ["att-checklists"], queryFn: () => listChecklists() });
  const checklistData = checklists.data as Checklist[] | undefined;
  const { staff } = useStaffAndStations();
  const { busy, act } = useAct();
  const [cl, setCl] = useState({ kind: "opening" as "opening" | "closing", userId: "", date: today, items: STORE_CHECKLISTS.opening.items.join("\n") });
  return (
    <Card><CardContent className="space-y-3 p-4">
      <h3 className="font-display font-bold">Store opening & closing</h3>
      <form className="grid gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void act(() => assignChecklist({ data: { kind: cl.kind, assignedTo: cl.userId, dueDate: cl.date, items: lines(cl.items) } }), "Checklist assigned", [["att-checklists"], ["att-open-tasks"]]); }}>
        <select aria-label="Checklist type" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={cl.kind} onChange={(e) => { const kind = e.target.value as "opening" | "closing"; setCl((o) => ({ ...o, kind, items: STORE_CHECKLISTS[kind].items.join("\n") })); }}><option value="opening">Opening</option><option value="closing">Closing</option></select>
        <select aria-label="Responsible staff" required className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={cl.userId} onChange={(e) => setCl((o) => ({ ...o, userId: e.target.value }))}><option value="">Responsible staff…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <Input aria-label="Date" type="date" required value={cl.date} onChange={(e) => setCl((o) => ({ ...o, date: e.target.value }))} />
        <Button disabled={busy}>Assign</Button>
        <div className="sm:col-span-4"><Label htmlFor="cl-items">Checklist items (one per line, max 30)</Label>
          <textarea id="cl-items" rows={6} className="w-full rounded-md border border-input bg-background p-2 text-sm" value={cl.items} onChange={(e) => setCl((o) => ({ ...o, items: e.target.value }))} />
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setCl((o) => ({ ...o, items: STORE_CHECKLISTS[o.kind].items.join("\n") }))}>Reset to default items</button></div>
      </form>
      <p className="text-xs text-muted-foreground">Staff tick items in My duty. Approve or return completed checklists in the task review queue on this page.</p>
      {checklists.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : checklists.error ? <p className="text-sm text-destructive">{errMsg(checklists.error)}</p> : checklistData?.length ? checklistData.map((c) => (
        <div key={c.id} className="rounded border p-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{c.title}</span><span className="text-xs">{c.status} · {c.staffName}</span></div>
          <ul className="mt-1 space-y-0.5 text-xs">{c.items.map((i) => <li key={i.label} className={i.isDone ? "" : "text-muted-foreground"}>{i.isDone ? "✓" : "○"} {i.label}{i.isDone && i.doneAt ? ` — ${i.doneBy ?? ""} ${dt(i.doneAt)}` : ""}</li>)}</ul>
        </div>
      )) : <p className="text-sm text-muted-foreground">No checklists yet.</p>}
    </CardContent></Card>
  );
}

type OpenTask = { id: string; title: string; description: string | null; dueDate: string; priority: string; status: string; staffName: string; totalItems: number; doneItems: number; alert: string | null };

export function OpenTasksEditCard() {
  const listTasks = useServerFn(ownerListEditableTasks);
  const updateTask = useServerFn(ownerUpdateAttendanceTask);
  const disableTask = useServerFn(ownerDisableAttendanceTask);
  const openTasks = useQuery({ queryKey: ["att-open-tasks"], queryFn: () => listTasks() });
  const { busy, act } = useAct();
  const [edit, setEdit] = useState<{ id: string; title: string; description: string; dueDate: string; priority: "low" | "medium" | "high" | "urgent"; addItems: string } | null>(null);
  const keys = [["att-open-tasks"], ["att-checklists"], ["owner-attendance-management"]];
  return (
    <Card><CardContent className="space-y-3 p-4">
      <h3 className="font-display font-bold">Open tasks — edit or disable</h3>
      <p className="text-xs text-muted-foreground">Finished tasks can't be changed. Disabling keeps the task and ticked items in history. Automatic incomplete-task notifications are <b>not active yet</b> — the badges below are on-screen only.</p>
      {openTasks.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : openTasks.error ? <p className="text-sm text-destructive">{errMsg(openTasks.error)}</p> : openTasks.data?.tasks.length ? openTasks.data.tasks.map((t: OpenTask) => (
        <div key={t.id} className="space-y-2 rounded border p-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><b>{t.title}</b> · {t.staffName} · due {t.dueDate} · {t.priority}{t.totalItems ? ` · ${t.doneItems}/${t.totalItems} items` : ""}</span>
            <span className="flex items-center gap-2">
              {t.alert === "overdue" ? <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">Overdue</span> : t.alert === "due_today" ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs">Due today</span> : null}
              <span className="text-xs text-muted-foreground">{t.status}</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEdit({ id: t.id, title: t.title, description: t.description ?? "", dueDate: t.dueDate, priority: t.priority as "low", addItems: "" })}>Edit</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm("Disable this task? It stays in history.")) void act(() => disableTask({ data: { taskId: t.id } }), "Task disabled", keys); }}>Disable</Button>
            </span>
          </div>
          {edit?.id === t.id ? (
            <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!edit) return; void act(async () => { await updateTask({ data: { taskId: edit.id, title: edit.title, description: edit.description.trim() || null, dueDate: edit.dueDate, priority: edit.priority, addItems: lines(edit.addItems) } }); setEdit(null); }, "Task saved", keys); }}>
              <Input aria-label="Title" required value={edit.title} onChange={(e) => setEdit((o) => o && ({ ...o, title: e.target.value }))} />
              <Input aria-label="Due date" type="date" required value={edit.dueDate} onChange={(e) => setEdit((o) => o && ({ ...o, dueDate: e.target.value }))} />
              <Input aria-label="Description" placeholder="Description" value={edit.description} onChange={(e) => setEdit((o) => o && ({ ...o, description: e.target.value }))} />
              <select aria-label="Priority" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={edit.priority} onChange={(e) => setEdit((o) => o && ({ ...o, priority: e.target.value as "low" }))}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="urgent">urgent</option></select>
              <textarea aria-label="Add checklist items" placeholder="Add checklist items (one per line). Existing items are kept." rows={3} className="rounded-md border border-input bg-background p-2 text-sm sm:col-span-2" value={edit.addItems} onChange={(e) => setEdit((o) => o && ({ ...o, addItems: e.target.value }))} />
              <div className="flex gap-2 sm:col-span-2"><Button size="sm" disabled={busy}>Save</Button><Button size="sm" type="button" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
            </form>
          ) : null}
        </div>
      )) : <p className="text-sm text-muted-foreground">No open tasks.</p>}
    </CardContent></Card>
  );
}
