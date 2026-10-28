import { createFileRoute } from "@tanstack/react-router";
import { BackToAttendance } from "@/components/owner/BackToAttendance";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ownerGetAttendanceReport, ownerDryRunMonthlyRetention } from "@/lib/attendance-extras.functions";
import { ownerGetGpsMovementReport } from "@/lib/attendance-location-report.functions";
import { reportToCsv, type ReportPeriod, type ReportRow } from "@/lib/attendance-rules";
import { formatMinutes } from "@/lib/attendance-logic";
import { dhakaDateKey } from "@/lib/dates";

export const Route = createFileRoute("/_authenticated/owner/attendance-reports")({
  head: () => ({ meta: [{ title: "Attendance Reports — Flamio" }, { name: "description", content: "Read-only owner attendance reports, CSV export and retention preview." }, { name: "robots", content: "noindex" }] }),
  component: AttendanceReports,
});

const dt = (v: string) => new Date(v).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Could not load");

// Read-only page: no mutating server functions are imported here.
function AttendanceReports() {
  const today = dhakaDateKey();
  const monthAgo = dhakaDateKey(new Date(Date.now() - 30 * 86400000));
  const getReport = useServerFn(ownerGetAttendanceReport);
  const dryRunMonthly = useServerFn(ownerDryRunMonthlyRetention);
  const getGpsReport = useServerFn(ownerGetGpsMovementReport);
  const [range, setRange] = useState({ from: monthAgo, to: today, period: "daily" as ReportPeriod });
  const report = useQuery({ queryKey: ["att-report", range], queryFn: () => getReport({ data: { fromDate: range.from, toDate: range.to, period: range.period } }) });
  const monthly = useQuery({ queryKey: ["att-retention-monthly"], queryFn: () => dryRunMonthly() });
  const gpsReport = useQuery({ queryKey: ["att-gps-movement-report", range.from, range.to], queryFn: () => getGpsReport({ data: { fromDate: range.from, toDate: range.to } }) });
  const downloadGpsCsv = () => {
    const rows = gpsReport.data?.rows ?? [];
    if (!rows.length) return;
    const columns = ["Staff", "Duty date", "Role", "Station", "Exit time (Dhaka)", "Return time (Dhaka)", "Outside minutes", "Status", "Distance from site (m)", "GPS accuracy (m)", "Clock in", "Clock out"] as const;
    const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '\"\"')}"`;
    const lines = [columns.map(cell).join(","), ...rows.map((r) => [r.staffName, r.dutyDate, r.shiftRole, r.stationName, dt(r.exitAt), r.returnAt ? dt(r.returnAt) : "", r.outsideMinutes, r.status, r.distanceMeters, r.accuracyMeters, r.clockInAt ? dt(r.clockInAt) : "", r.clockOutAt ? dt(r.clockOutAt) : ""].map(cell).join(","))];
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `gps-exit-return-${range.from}-to-${range.to}.csv`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      <BackToAttendance />
      <div><h2 className="font-display text-xl font-bold">Attendance Reports</h2><p className="text-sm text-muted-foreground">Read-only · Bangladesh time · Owner only · weeks start Saturday</p></div>
      <Card><CardContent className="space-y-3 p-4">
        <h3 className="font-display font-bold">Attendance report</h3>
        <div className="grid gap-2 sm:grid-cols-4">
          <div><Label htmlFor="r-from">From</Label><Input id="r-from" type="date" value={range.from} onChange={(e) => setRange((o) => ({ ...o, from: e.target.value }))} /></div>
          <div><Label htmlFor="r-to">To</Label><Input id="r-to" type="date" value={range.to} onChange={(e) => setRange((o) => ({ ...o, to: e.target.value }))} /></div>
          <div><Label htmlFor="r-period">Group by</Label><select id="r-period" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={range.period} onChange={(e) => setRange((o) => ({ ...o, period: e.target.value as ReportPeriod }))}><option value="daily">Day</option><option value="weekly">Week</option><option value="monthly">Month</option></select></div>
          <div className="flex items-end"><Button variant="outline" className="w-full" disabled={!report.data?.rows.length} onClick={() => report.data && downloadCsv(report.data.rows)}><Download className="mr-2 h-4 w-4" />CSV</Button></div>
        </div>
        {report.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : report.error ? <p className="text-sm text-destructive">{errMsg(report.error)}</p> : report.data?.rows.length ? (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="p-1">Period</th><th className="p-1">Staff</th><th className="p-1">Worked</th><th className="p-1">Breaks</th><th className="p-1">Late</th><th className="p-1">Scheduled</th><th className="p-1">Overtime</th><th className="p-1">Check-in photo</th></tr></thead>
            <tbody>{report.data.rows.map((r) => <tr key={`${r.period}-${r.userId}`} className="border-t"><td className="p-1">{r.period}</td><td className="p-1">{r.staffName}{r.openSessions ? ` (${r.openSessions} open)` : ""}</td><td className="p-1">{formatMinutes(r.workedMinutes)}</td><td className="p-1">{formatMinutes(r.breakMinutes)}</td><td className="p-1">{r.lateCount}× / {formatMinutes(r.lateMinutes)}</td><td className="p-1">{formatMinutes(r.scheduledMinutes)}</td><td className="p-1">{formatMinutes(r.overtimeMinutes)}</td><td className="p-1">{r.selfieCaptured > 0 ? <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">Captured {r.selfieCaptured}/{r.sessions}</span> : <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">None</span>}</td></tr>)}</tbody></table>
            <p className="mt-2 text-xs text-muted-foreground">Open sessions are excluded from worked time. Overtime is counted only for sessions linked to a scheduled shift.{report.data.truncated ? " Showing the first 5,000 sessions — narrow the dates." : ""}</p></div>
        ) : <p className="text-sm text-muted-foreground">No sessions in this range.</p>}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display font-bold">GPS exit/return report</h3><Button variant="outline" size="sm" disabled={!gpsReport.data?.rows.length} onClick={downloadGpsCsv}><Download className="mr-2 h-4 w-4" />Export GPS CSV</Button></div>
        <p className="text-xs text-muted-foreground">Owner only · Bangladesh time · one row per exit; later return events are matched across the same duty session. No raw GPS coordinates are stored or shown.</p>
        {gpsReport.isLoading ? <p className="text-sm text-muted-foreground">Loading GPS events…</p> : gpsReport.error ? <p className="text-sm text-destructive">{errMsg(gpsReport.error)}</p> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Exit events</p><p className="text-xl font-bold">{gpsReport.data?.summary.reduce((n, r) => n + r.exits, 0) ?? 0}</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Completed trips</p><p className="text-xl font-bold">{gpsReport.data?.summary.reduce((n, r) => n + r.completedTrips, 0) ?? 0}</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Total outside</p><p className="text-xl font-bold">{formatMinutes(gpsReport.data?.summary.reduce((n, r) => n + r.outsideMinutes, 0) ?? 0)}</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Unreturned exits</p><p className="text-xl font-bold">{gpsReport.data?.summary.reduce((n, r) => n + r.currentlyOutside, 0) ?? 0}</p></div>
            </div>
            {gpsReport.data?.summary.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="p-2">Staff</th><th className="p-2">Exits</th><th className="p-2">Returned</th><th className="p-2">Outside total</th><th className="p-2">Still out</th></tr></thead><tbody>{gpsReport.data.summary.map((r) => <tr key={r.userId} className="border-t"><td className="p-2">{r.staffName}</td><td className="p-2">{r.exits}</td><td className="p-2">{r.completedTrips}</td><td className="p-2">{formatMinutes(r.outsideMinutes)}</td><td className="p-2">{r.currentlyOutside}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No staff exits were recorded in this date range.</p>}
            {gpsReport.data?.rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="p-2">Exit time (Dhaka)</th><th className="p-2">Staff</th><th className="p-2">Duty / role</th><th className="p-2">Station</th><th className="p-2">Return time (Dhaka)</th><th className="p-2">Outside duration</th><th className="p-2">Exit distance</th><th className="p-2">GPS accuracy</th><th className="p-2">Status</th></tr></thead><tbody>{gpsReport.data.rows.map((r) => <tr key={r.id} className="border-t"><td className="p-2 whitespace-nowrap">{dt(r.exitAt)}</td><td className="p-2">{r.staffName}</td><td className="p-2">{r.shiftRole || "—"}{r.dutyDate ? <span className="block text-xs text-muted-foreground">{r.dutyDate}</span> : null}</td><td className="p-2">{r.stationName}</td><td className="p-2 whitespace-nowrap">{r.returnAt ? dt(r.returnAt) : "—"}</td><td className="p-2">{r.outsideMinutes == null ? "—" : formatMinutes(r.outsideMinutes)}</td><td className="p-2">{Math.round(r.distanceMeters)} m</td><td className="p-2">±{Math.round(r.accuracyMeters)} m</td><td className="p-2">{r.status}</td></tr>)}</tbody></table></div> : null}
            {gpsReport.data?.truncated ? <p className="text-xs text-muted-foreground">Showing the first 10,000 events. Narrow the date range.</p> : null}
          </>
        )}
      </CardContent></Card>

      <Card><CardContent className="space-y-2 p-4">
        <h3 className="font-display font-bold">Not supported (manual review only)</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Each staff check-in requires a new camera photo. Photos are private evidence for Owner/Manager review.</li>
          <li><b>Background GPS: Not supported.</b> Location is checked only at the moment staff tap clock in/out with the app open. Staff are not tracked during the shift.</li>
          <li><b>Incomplete-task notifications: Not active.</b> Overdue badges show on the Tasks & Requests page only; nothing is sent automatically.</li>
        </ul>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-4">
        <h3 className="font-display font-bold">Monthly cleanup preview (dry run)</h3>
        <p className="text-xs text-muted-foreground">Preview only — nothing is deleted. Previous full month, Dhaka time.</p>
        {monthly.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : monthly.error ? <p className="text-sm text-destructive">{errMsg(monthly.error)}</p> : monthly.data ? (
          <div className="space-y-2 text-sm">
            <p>Month <b>{monthly.data.window.label}</b> ({dt(monthly.data.window.startUtc)} → {dt(monthly.data.window.endUtc)})</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Eligible</p><p className="text-lg font-bold">{monthly.data.eligible.length}</p><p className="text-xs text-muted-foreground">{monthly.data.eligible.filter((e) => e.hasSelfie).length} with photo</p></div>
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Protected</p><p className="text-lg font-bold">{monthly.data.protected.length}</p><p className="text-xs text-muted-foreground">{(["open", "auto_closed", "disputed", "pending_request"] as const).map((k) => `${k.replace("_", " ")}: ${monthly.data!.protected.filter((x) => x.reason === k).length}`).join(" · ")}</p></div>
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Skipped</p><p className="text-lg font-bold">{monthly.data.skipped.length}</p><p className="text-xs text-muted-foreground">outside month</p></div>
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Failed</p><p className="text-lg font-bold">{monthly.data.failed.length}</p><p className="text-xs text-muted-foreground">unreadable data</p></div>
            </div>
          </div>
        ) : null}
      </CardContent></Card>
    </div>
  );
}
