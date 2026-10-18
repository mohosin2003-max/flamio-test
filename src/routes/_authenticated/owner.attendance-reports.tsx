import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ownerAssignStoreChecklist, ownerCheckAttendanceIssues, ownerCreateRecurringShifts, ownerGetAttendanceFeatures,
  ownerGetAttendanceReport, ownerListStoreChecklists, ownerPreviewAttendanceRetention, ownerRecoverStaleSession,
  ownerRunAttendanceRetention, ownerSetAttendanceFeatures,
} from "@/lib/attendance-extras.functions";
import { ownerListAttendanceManagement } from "@/lib/attendance-management.functions";
import { reportToCsv, type ReportPeriod, type ReportRow } from "@/lib/attendance-rules";
import { formatMinutes } from "@/lib/attendance-logic";
import { dhakaDateKey } from "@/lib/dates";

export const Route = createFileRoute("/_authenticated/owner/attendance-reports")({
  head: () => ({ meta: [{ title: "Attendance Reports & Tools — Flamio" }, { name: "description", content: "Owner attendance reports, schedules, checklists and retention." }, { name: "robots", content: "noindex" }] }),
  component: AttendanceReports,
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dt = (v: string) => new Date(v).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Action failed");

function AttendanceReports() {
  const qc = useQueryClient();
  const today = dhakaDateKey();
  const monthAgo = dhakaDateKey(new Date(Date.now() - 30 * 86400000));
  const getReport = useServerFn(ownerGetAttendanceReport);
  const checkIssues = useServerFn(ownerCheckAttendanceIssues);
  const recover = useServerFn(ownerRecoverStaleSession);
  const getFeatures = useServerFn(ownerGetAttendanceFeatures);
  const setFeatures = useServerFn(ownerSetAttendanceFeatures);
  const createRecurring = useServerFn(ownerCreateRecurringShifts);
  const listMgmt = useServerFn(ownerListAttendanceManagement);
  const assignChecklist = useServerFn(ownerAssignStoreChecklist);
  const listChecklists = useServerFn(ownerListStoreChecklists);
  const previewRetention = useServerFn(ownerPreviewAttendanceRetention);
  const runRetention = useServerFn(ownerRunAttendanceRetention);

  const [range, setRange] = useState({ from: monthAgo, to: today, period: "daily" as ReportPeriod });
  const [busy, setBusy] = useState(false);
  const report = useQuery({ queryKey: ["att-report", range], queryFn: () => getReport({ data: { fromDate: range.from, toDate: range.to, period: range.period } }) });
  const issues = useQuery({ queryKey: ["att-issues"], queryFn: () => checkIssues({ data: { sendAlerts: false } }), refetchInterval: 60000 });
  const features = useQuery({ queryKey: ["att-features"], queryFn: () => getFeatures() });
  const mgmt = useQuery({ queryKey: ["att-mgmt-staff"], queryFn: () => listMgmt() });
  const checklists = useQuery({ queryKey: ["att-checklists"], queryFn: () => listChecklists() });
  const retention = useQuery({ queryKey: ["att-retention"], queryFn: () => previewRetention() });

  type Issues = { overlongBreaks: { id: string; staffName: string; minutes: number; startedAt: string }[]; missedClockOuts: { id: string; staffName: string; clockInAt: string; shiftEndsAt: string | null }[]; alertsEnabled: boolean };
  type Checklist = { id: string; title: string; status: string; staffName: string; items: { label: string; isDone: boolean; doneAt: string | null; doneBy: string | null }[] };
  const issuesData = issues.data as Issues | undefined;
  const checklistData = checklists.data as Checklist[] | undefined;
  const staff: { id: string; name: string }[] = (mgmt.data as { staff?: { id: string; name: string }[] } | undefined)?.staff ?? [];
  const stations: { id: string; name: string; isActive: boolean }[] = ((mgmt.data as { stations?: { id: string; name: string; isActive: boolean }[] } | undefined)?.stations ?? []).filter((s) => s.isActive);
  const [rec, setRec] = useState({ userId: "", stationId: "", from: today, to: today, weekdays: [6, 0, 1, 2, 3] as number[], start: "10:00", end: "18:00", breakMin: 30 });
  const recKey = JSON.stringify(rec);
  const [recPreview, setRecPreview] = useState<{ key: string; items: { date: string; startAt: string; endAt: string; overnight: boolean; conflict: boolean }[] } | null>(null);
  const [cl, setCl] = useState({ kind: "opening" as "opening" | "closing", userId: "", date: today });
  const [confirmText, setConfirmText] = useState("");

  const act = async (fn: () => Promise<unknown>, ok: string, keys: string[][]) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k }))); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const downloadCsv = (rows: ReportRow[]) => {
    const blob = new Blob([reportToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `attendance-${range.period}-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      <div><h2 className="font-display text-xl font-bold">Attendance Reports & Tools</h2><p className="text-sm text-muted-foreground">Bangladesh time · Owner only · weeks start Saturday</p></div>

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

      <Card><CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display font-bold">Needs attention</h3>
          <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void issues.refetch()}><RefreshCw className="mr-1 h-4 w-4" />Check</Button>
          <Button size="sm" disabled={busy} onClick={() => void act(async () => { const r = await checkIssues({ data: { sendAlerts: true } }); if (!r.alertsEnabled) throw new Error("Attendance alerts are switched off in Attendance settings."); }, "Alerts sent (repeat alerts are skipped)", [["att-issues"]])}>Alert managers</Button></div></div>
        {issues.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : issues.error ? <p className="text-sm text-destructive">{errMsg(issues.error)}</p> : (
          <>
            <p className="text-sm font-semibold">Long breaks (over 30 min)</p>
            {issuesData?.overlongBreaks.length ? issuesData!.overlongBreaks.map((b) => <p key={b.id} className="text-sm">{b.staffName} · on break {formatMinutes(b.minutes)} since {dt(b.startedAt)}</p>) : <p className="text-sm text-muted-foreground">None.</p>}
            <p className="text-sm font-semibold">Possible missed clock-outs</p>
            {issuesData?.missedClockOuts.length ? issuesData!.missedClockOuts.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                <span>{m.staffName} · in since {dt(m.clockInAt)}{m.shiftEndsAt ? ` · shift ended ${dt(m.shiftEndsAt)}` : " · unscheduled"}</span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => recover({ data: { sessionId: m.id } }), "Recovery requested — check the record is flagged for review", [["att-issues"]])}>Close if over max length</Button>
              </div>
            )) : <p className="text-sm text-muted-foreground">None.</p>}
          </>
        )}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-4">
        <h3 className="font-display font-bold">Attendance report</h3>
        <div className="grid gap-2 sm:grid-cols-4">
          <div><Label htmlFor="r-from">From</Label><Input id="r-from" type="date" value={range.from} onChange={(e) => setRange((o) => ({ ...o, from: e.target.value }))} /></div>
          <div><Label htmlFor="r-to">To</Label><Input id="r-to" type="date" value={range.to} onChange={(e) => setRange((o) => ({ ...o, to: e.target.value }))} /></div>
          <div><Label htmlFor="r-period">Group by</Label><select id="r-period" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={range.period} onChange={(e) => setRange((o) => ({ ...o, period: e.target.value as ReportPeriod }))}><option value="daily">Day</option><option value="weekly">Week</option><option value="monthly">Month</option></select></div>
          <div className="flex items-end"><Button variant="outline" className="w-full" disabled={!report.data?.rows.length} onClick={() => report.data && downloadCsv(report.data.rows)}><Download className="mr-2 h-4 w-4" />CSV</Button></div>
        </div>
        {report.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : report.error ? <p className="text-sm text-destructive">{errMsg(report.error)}</p> : report.data?.rows.length ? (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="p-1">Period</th><th className="p-1">Staff</th><th className="p-1">Worked</th><th className="p-1">Breaks</th><th className="p-1">Late</th><th className="p-1">Scheduled</th><th className="p-1">Overtime</th></tr></thead>
            <tbody>{report.data.rows.map((r) => <tr key={`${r.period}-${r.userId}`} className="border-t"><td className="p-1">{r.period}</td><td className="p-1">{r.staffName}{r.openSessions ? ` (${r.openSessions} open)` : ""}</td><td className="p-1">{formatMinutes(r.workedMinutes)}</td><td className="p-1">{formatMinutes(r.breakMinutes)}</td><td className="p-1">{r.lateCount}× / {formatMinutes(r.lateMinutes)}</td><td className="p-1">{formatMinutes(r.scheduledMinutes)}</td><td className="p-1">{formatMinutes(r.overtimeMinutes)}</td></tr>)}</tbody></table>
            <p className="mt-2 text-xs text-muted-foreground">Open sessions are excluded from worked time. Overtime is counted only for sessions linked to a scheduled shift.{report.data.truncated ? " Showing the first 5,000 sessions — narrow the dates." : ""}</p></div>
        ) : <p className="text-sm text-muted-foreground">No sessions in this range.</p>}
      </CardContent></Card>

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
            <Button size="sm" disabled={busy || !recPreview.items.some((i) => !i.conflict)} onClick={() => void act(async () => { const r = await createRecurring({ data: { userId: rec.userId, stationId: rec.stationId || null, fromDate: rec.from, toDate: rec.to, weekdays: rec.weekdays, startTime: rec.start, endTime: rec.end, plannedBreakMinutes: rec.breakMin } }); setRecPreview(null); toast.message(`${r.created} shifts created${r.skippedOverlaps ? `, ${r.skippedOverlaps} skipped (already booked)` : ""}`); }, "Schedule saved", [["att-mgmt-staff"]])}>Confirm and create</Button>
          </div>
        ) : recPreview ? <p className="text-xs text-muted-foreground">Settings changed — preview again before creating.</p> : null}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-4">
        <h3 className="font-display font-bold">Store opening & closing</h3>
        <form className="grid gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void act(() => assignChecklist({ data: { kind: cl.kind, assignedTo: cl.userId, dueDate: cl.date } }), "Checklist assigned", [["att-checklists"]]); }}>
          <select aria-label="Checklist type" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={cl.kind} onChange={(e) => setCl((o) => ({ ...o, kind: e.target.value as "opening" | "closing" }))}><option value="opening">Opening</option><option value="closing">Closing</option></select>
          <select aria-label="Responsible staff" required className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={cl.userId} onChange={(e) => setCl((o) => ({ ...o, userId: e.target.value }))}><option value="">Responsible staff…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <Input aria-label="Date" type="date" required value={cl.date} onChange={(e) => setCl((o) => ({ ...o, date: e.target.value }))} />
          <Button disabled={busy}>Assign</Button>
        </form>
        <p className="text-xs text-muted-foreground">Staff tick items in My duty. Approve or return completed checklists in Tasks & Requests.</p>
        {checklistData?.length ? checklistData.map((c) => (
          <div key={c.id} className="rounded border p-2 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{c.title}</span><span className="text-xs">{c.status} · {c.staffName}</span></div>
            <ul className="mt-1 space-y-0.5 text-xs">{c.items.map((i) => <li key={i.label} className={i.isDone ? "" : "text-muted-foreground"}>{i.isDone ? "✓" : "○"} {i.label}{i.isDone && i.doneAt ? ` — ${i.doneBy ?? ""} ${dt(i.doneAt)}` : ""}</li>)}</ul>
          </div>
        )) : <p className="text-sm text-muted-foreground">No checklists yet.</p>}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-4">
        <h3 className="font-display font-bold">Old attendance cleanup</h3>
        {retention.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : retention.error ? <p className="text-sm text-destructive">{errMsg(retention.error)}</p> : retention.data ? (
          <>
            <p className="text-sm">Keeps the last {retention.data.days} days (rolling). Finished sessions before {dt(retention.data.cutoff)}: <b>{retention.data.eligibleSessions}</b> can be removed, {retention.data.protectedSessions} kept (open, auto-closed, disputed or waiting on a request).</p>
            <p className="text-xs text-muted-foreground">Accounts, shifts, tasks, requests and the audit log are never removed. Nothing runs automatically.</p>
            <div className="flex flex-wrap gap-2"><Input className="max-w-40" placeholder="Type DELETE" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              <Button variant="destructive" disabled={busy || confirmText !== "DELETE" || !retention.data.eligibleSessions} onClick={() => void act(async () => { await runRetention({ data: { confirm: "DELETE", expectedCount: retention.data!.eligibleSessions } }); setConfirmText(""); }, "Old sessions removed", [["att-retention"], ["att-report"]])}>Remove {retention.data.eligibleSessions}</Button></div>
          </>
        ) : null}
      </CardContent></Card>
    </div>
  );
}
