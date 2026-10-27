import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BackToAttendance } from "@/components/owner/BackToAttendance";
import { AttendanceFeatureTogglesCard, OrphanSelfieScanCard } from "@/components/owner/AttendanceOwnerTools";
import { ownerGetAttendanceOverview } from "@/lib/attendance.functions";
import { ownerUpdateAttendanceSettings } from "@/lib/attendance-settings.functions";

export const Route = createFileRoute("/_authenticated/owner/attendance-settings")({
  head: () => ({ meta: [{ title: "Attendance Settings — Flamio" }, { name: "robots", content: "noindex" }] }),
  component: AttendanceSettings,
});

function AttendanceSettings() {
  const qc = useQueryClient();
  const getOverview = useServerFn(ownerGetAttendanceOverview);
  const updateSettings = useServerFn(ownerUpdateAttendanceSettings);
  const overview = useQuery({ queryKey: ["owner-attendance-overview"], queryFn: () => getOverview() });
  const settings = overview.data?.settings;
  const [f, setF] = useState({ lateGraceMinutes: 10, earlyClockInMinutes: 60, minPunchGapSeconds: 60, maxSessionHours: 16, allowUnscheduledClockIn: true, geofenceEnabled: false, qrVerificationEnabled: false, attendanceAlertsEnabled: false });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings && !loaded) {
      setF({ lateGraceMinutes: settings.late_grace_minutes, earlyClockInMinutes: settings.early_clock_in_minutes, minPunchGapSeconds: settings.min_punch_gap_seconds, maxSessionHours: settings.max_session_hours, allowUnscheduledClockIn: settings.allow_unscheduled_clock_in, geofenceEnabled: settings.geofence_enabled, qrVerificationEnabled: settings.qr_verification_enabled, attendanceAlertsEnabled: settings.attendance_alerts_enabled });
      setLoaded(true);
    }
  }, [settings, loaded]);

  return (
    <div className="space-y-5">
      <BackToAttendance />
      <h2 className="font-display text-xl font-bold">Attendance Settings</h2>
      {overview.isLoading ? <Skeleton className="h-64 w-full" /> : overview.error ? <p className="text-sm text-destructive">Settings could not be loaded.</p> : (
        <Card><CardContent className="space-y-3 p-4">
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setBusy(true); void updateSettings({ data: { timezone: "Asia/Dhaka", ...f } }).then(async () => { await qc.invalidateQueries({ queryKey: ["owner-attendance-overview"] }); toast.success("Attendance settings saved"); }).catch((err) => toast.error(err instanceof Error ? err.message : "Could not save settings")).finally(() => setBusy(false)); }}>
            <div className="space-y-1"><Label htmlFor="late-grace">Late grace (minutes)</Label><Input id="late-grace" type="number" min={0} max={120} value={f.lateGraceMinutes} onChange={(e) => setF((o) => ({ ...o, lateGraceMinutes: Number(e.target.value) }))} /></div>
            <div className="space-y-1"><Label htmlFor="early-window">Early clock-in window (minutes)</Label><Input id="early-window" type="number" min={0} max={240} value={f.earlyClockInMinutes} onChange={(e) => setF((o) => ({ ...o, earlyClockInMinutes: Number(e.target.value) }))} /></div>
            <div className="space-y-1"><Label htmlFor="punch-gap">Minimum punch gap (seconds)</Label><Input id="punch-gap" type="number" min={10} max={3600} value={f.minPunchGapSeconds} onChange={(e) => setF((o) => ({ ...o, minPunchGapSeconds: Number(e.target.value) }))} /></div>
            <div className="space-y-1"><Label htmlFor="max-session">Maximum session (hours)</Label><Input id="max-session" type="number" min={1} max={24} value={f.maxSessionHours} onChange={(e) => setF((o) => ({ ...o, maxSessionHours: Number(e.target.value) }))} /></div>
            <label className="flex min-h-12 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.allowUnscheduledClockIn} onChange={(e) => setF((o) => ({ ...o, allowUnscheduledClockIn: e.target.checked }))} /> Allow clock-in without a scheduled shift</label>
            <label className="flex min-h-12 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.geofenceEnabled} onChange={(e) => setF((o) => ({ ...o, geofenceEnabled: e.target.checked }))} /> Require GPS geofence at clock-in</label>
            <label className="flex min-h-12 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.qrVerificationEnabled} onChange={(e) => setF((o) => ({ ...o, qrVerificationEnabled: e.target.checked }))} /> Require a station QR token at clock-in</label>
            <p className="text-sm sm:col-span-2 rounded-md border p-3">A fresh photo must be taken with the live camera for every staff check-in. Photos are stored privately for Owner/Manager review.</p>
            <label className="flex min-h-12 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.attendanceAlertsEnabled} onChange={(e) => setF((o) => ({ ...o, attendanceAlertsEnabled: e.target.checked }))} /> Attendance notification switch</label>
            <Button type="submit" disabled={busy} className="min-h-12 sm:col-span-2">{busy ? "Saving…" : "Save attendance settings"}</Button>
          </form>
        </CardContent></Card>
      )}
      <AttendanceFeatureTogglesCard />
      <OrphanSelfieScanCard />
    </div>
  );
}
