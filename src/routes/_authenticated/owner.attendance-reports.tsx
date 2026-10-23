import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ownerGetAttendanceReport, ownerDryRunMonthlyRetention } from "@/lib/attendance-extras.functions";
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
  const [range, setRange] = useState({ from: monthAgo, to: today, period: "daily" as ReportPeriod });
  const report = useQuery({ queryKey: ["att-report", range], queryFn: () => getReport({ data: { fromDate: range.from, toDate: range.to, period: range.period } }) });
  const monthly = useQuery({ queryKey: ["att-retention-monthly"], queryFn: () => dryRunMonthly() });
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
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="p-1">Period</th><th className="p-1">Staff</th><th className="p-1">Worked</th><th className="p-1">Breaks</th><th className="p-1">Late</th><th className="p-1">Scheduled</th><th className="p-1">Overtime</th><th className="p-1">Selfie</th></tr></thead>
            <tbody>{report.data.rows.map((r) => <tr key={`${r.period}-${r.userId}`} className="border-t"><td className="p-1">{r.period}</td><td className="p-1">{r.staffName}{r.openSessions ? ` (${r.openSessions} open)` : ""}</td><td className="p-1">{formatMinutes(r.workedMinutes)}</td><td className="p-1">{formatMinutes(r.breakMinutes)}</td><td className="p-1">{r.lateCount}× / {formatMinutes(r.lateMinutes)}</td><td className="p-1">{formatMinutes(r.scheduledMinutes)}</td><td className="p-1">{formatMinutes(r.overtimeMinutes)}</td><td className="p-1">{r.selfieCaptured > 0 ? <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">Captured {r.selfieCaptured}/{r.sessions}</span> : <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">None</span>}</td></tr>)}</tbody></table>
            <p className="mt-2 text-xs text-muted-foreground">Open sessions are excluded from worked time. Overtime is counted only for sessions linked to a scheduled shift.{report.data.truncated ? " Showing the first 5,000 sessions — narrow the dates." : ""}</p></div>
        ) : <p className="text-sm text-muted-foreground">No sessions in this range.</p>}
      </CardContent></Card>

      <Card><CardContent className="space-y-2 p-4">
        <h3 className="font-display font-bold">Not supported (manual review only)</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li><b>Face matching: Not supported.</b> Clock-in selfies are photo evidence only; an Owner or Manager must review them by eye. No automatic identity check is done.</li>
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
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Eligible</p><p className="text-lg font-bold">{monthly.data.eligible.length}</p><p className="text-xs text-muted-foreground">{monthly.data.eligible.filter((e) => e.hasSelfie).length} with selfie</p></div>
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
