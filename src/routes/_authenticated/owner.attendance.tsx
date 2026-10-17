import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Clock3, RefreshCw, ShieldAlert, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { ownerGetAttendanceOverview } from "@/lib/attendance.functions";
import { ownerUpdateAttendanceSettings } from "@/lib/attendance-settings.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/owner/attendance")({
  head: () => ({
    meta: [
      { title: "Staff Duty Monitoring — Flamio" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerAttendance,
});

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function duration(minutes: number) {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function OwnerAttendance() {
  const queryClient = useQueryClient();
  const getOverview = useServerFn(ownerGetAttendanceOverview);
  const updateSettings = useServerFn(ownerUpdateAttendanceSettings);
  const [settingsForm, setSettingsForm] = useState({ lateGraceMinutes: 10, earlyClockInMinutes: 60, minPunchGapSeconds: 60, maxSessionHours: 16, allowUnscheduledClockIn: true, geofenceEnabled: false, qrVerificationEnabled: false, selfieVerificationEnabled: false, attendanceAlertsEnabled: false });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const overview = useQuery({
    queryKey: ["owner-attendance-overview"],
    queryFn: () => getOverview(),
    refetchInterval: 30_000,
  });
  const settings = overview.data?.settings;
  useEffect(() => {
    if (settings && !settingsLoaded) {
      setSettingsForm({ lateGraceMinutes: settings.late_grace_minutes, earlyClockInMinutes: settings.early_clock_in_minutes, minPunchGapSeconds: settings.min_punch_gap_seconds, maxSessionHours: settings.max_session_hours, allowUnscheduledClockIn: settings.allow_unscheduled_clock_in, geofenceEnabled: settings.geofence_enabled, qrVerificationEnabled: settings.qr_verification_enabled, selfieVerificationEnabled: settings.selfie_verification_enabled, attendanceAlertsEnabled: settings.attendance_alerts_enabled });
      setSettingsLoaded(true);
    }
  }, [settings, settingsLoaded]);

  if (overview.isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>;
  }

  if (overview.error || !overview.data) {
    return (
      <EmptyState
        title="Attendance data is not ready"
        description={overview.error instanceof Error ? overview.error.message : "The TEST database may need setup. No database changes were made by this page."}
        action={<Button onClick={() => void overview.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>}
      />
    );
  }

  const sessions: { id: string; staffName: string; clockOutAt: string | null; lateMinutes: number; status: string; clockInAt: string; dutyDate: string; workedMinutes: number; verificationStatus: string }[] = overview.data.sessions;
  const tasks: { id: string; title: string; staffName: string; dueDate: string; dueAt: string | null; priority: string; status: string; completedAt: string | null }[] = overview.data.tasks;
  const openSessions = sessions.filter((session) => !session.clockOutAt);
  const lateSessions = sessions.filter((session) => session.lateMinutes > 0);
  const pendingTasks = tasks.filter((task) => !["completed", "verified", "cancelled"].includes(task.status));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Staff Duty Monitoring</h2>
          <p className="text-sm text-muted-foreground">Duty overview · TEST environment · refreshes every 30 seconds</p>
        </div>
        <Button variant="outline" onClick={() => void overview.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Users} label="Recent sessions" value={String(sessions.length)} />
        <Stat icon={Clock3} label="Currently on duty" value={String(openSessions.length)} />
        <Stat icon={ShieldAlert} label="Late records" value={String(lateSessions.length)} />
        <Stat icon={CheckCircle2} label="Open tasks" value={String(pendingTasks.length)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/owner/attendance-management" className="rounded-xl border p-4 transition-colors hover:bg-muted/50">
          <p className="font-semibold">Stations & shifts</p>
          <p className="mt-1 text-sm text-muted-foreground">Manage work areas, assign staff shifts, and cancel scheduled shifts.</p>
        </Link>
        <Link to="/owner/attendance-workflow" className="rounded-xl border p-4 transition-colors hover:bg-muted/50">
          <p className="font-semibold">Tasks & requests</p>
          <p className="mt-1 text-sm text-muted-foreground">Assign checklist tasks, review completions, and process staff requests.</p>
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="font-display font-bold">Attendance settings</h3>
          {settings ? (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Setting label="Time zone" value={settings.timezone} />
              <Setting label="Late grace period" value={`${settings.late_grace_minutes} minutes`} />
              <Setting label="Early clock-in window" value={`${settings.early_clock_in_minutes} minutes`} />
              <Setting label="Minimum punch gap" value={`${settings.min_punch_gap_seconds} seconds`} />
              <Setting label="Maximum session" value={`${settings.max_session_hours} hours`} />
              <Setting label="Unscheduled clock-in" value={settings.allow_unscheduled_clock_in ? "Allowed" : "Not allowed"} />
              <Setting label="GPS geofence" value={settings.geofence_enabled ? "Enabled" : "Disabled"} />
              <Setting label="QR verification" value={settings.qr_verification_enabled ? "Enabled" : "Disabled"} />
              <Setting label="Selfie verification" value={settings.selfie_verification_enabled ? "Enabled" : "Disabled"} />
              <Setting label="Attendance alerts" value={settings.attendance_alerts_enabled ? "Enabled" : "Disabled"} />
            </div>
          ) : <p className="text-sm text-muted-foreground">No settings row found.</p>}
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); setSettingsBusy(true); void updateSettings({ data: { timezone: "Asia/Dhaka", ...settingsForm } }).then(async () => { await queryClient.invalidateQueries({ queryKey: ["owner-attendance-overview"] }); toast.success("Attendance settings saved"); }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not save settings")).finally(() => setSettingsBusy(false)); }}>
            <div className="space-y-1"><Label htmlFor="late-grace">Late grace (minutes)</Label><Input id="late-grace" type="number" min={0} max={120} value={settingsForm.lateGraceMinutes} onChange={(e) => setSettingsForm((old) => ({ ...old, lateGraceMinutes: Number(e.target.value) }))} /></div>
            <div className="space-y-1"><Label htmlFor="early-window">Early clock-in window (minutes)</Label><Input id="early-window" type="number" min={0} max={240} value={settingsForm.earlyClockInMinutes} onChange={(e) => setSettingsForm((old) => ({ ...old, earlyClockInMinutes: Number(e.target.value) }))} /></div>
            <div className="space-y-1"><Label htmlFor="punch-gap">Minimum punch gap (seconds)</Label><Input id="punch-gap" type="number" min={10} max={3600} value={settingsForm.minPunchGapSeconds} onChange={(e) => setSettingsForm((old) => ({ ...old, minPunchGapSeconds: Number(e.target.value) }))} /></div>
            <div className="space-y-1"><Label htmlFor="max-session">Maximum session (hours)</Label><Input id="max-session" type="number" min={1} max={24} value={settingsForm.maxSessionHours} onChange={(e) => setSettingsForm((old) => ({ ...old, maxSessionHours: Number(e.target.value) }))} /></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={settingsForm.allowUnscheduledClockIn} onChange={(e) => setSettingsForm((old) => ({ ...old, allowUnscheduledClockIn: e.target.checked }))} /> Allow clock-in without a scheduled shift</label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={settingsForm.geofenceEnabled} onChange={(e) => setSettingsForm((old) => ({ ...old, geofenceEnabled: e.target.checked }))} /> Require GPS geofence at clock-in (stations need coordinates)</label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={settingsForm.qrVerificationEnabled} onChange={(e) => setSettingsForm((old) => ({ ...old, qrVerificationEnabled: e.target.checked }))} /> Require a single-use station QR token at clock-in (issuance UI still under development)</label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={settingsForm.selfieVerificationEnabled} disabled={!settingsForm.selfieVerificationEnabled} onChange={(e) => setSettingsForm((old) => ({ ...old, selfieVerificationEnabled: e.target.checked }))} /> Selfie verification (not implemented; if currently enabled, uncheck to allow staff clock-in)</label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={settingsForm.attendanceAlertsEnabled} onChange={(e) => setSettingsForm((old) => ({ ...old, attendanceAlertsEnabled: e.target.checked }))} /> Attendance notification switch (delivery wiring still incomplete)</label>
            <Button type="submit" disabled={settingsBusy} className="sm:col-span-2">{settingsBusy ? "Saving…" : "Save attendance settings"}</Button>
          </form>
          <p className="text-xs text-muted-foreground">Owner-only server authorization and TEST database RLS are enforced. GPS/QR checks run only when enabled; configure station coordinates first. Selfie and notification delivery are not yet end-to-end.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" /><h3 className="font-display font-bold">Recent attendance</h3></div>
          {sessions.length === 0 ? <p className="text-sm text-muted-foreground">No attendance sessions found.</p> : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <div key={session.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="font-semibold">{session.staffName}</p><p className="text-xs text-muted-foreground">Duty date: {session.dutyDate}</p></div>
                    <span className={session.lateMinutes > 0 ? "rounded-full bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive" : "rounded-full bg-muted px-2 py-1 text-xs"}>{session.lateMinutes > 0 ? `Late ${duration(session.lateMinutes)}` : session.status}</span>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <p>In: {formatDate(session.clockInAt)}</p>
                    <p>Out: {session.clockOutAt ? formatDate(session.clockOutAt) : "Still on duty"}</p>
                    <p>Worked: {duration(session.workedMinutes)}</p>
                    <p>Verification: {session.verificationStatus}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="font-display font-bold">Recent staff tasks</h3>
          {tasks.length === 0 ? <p className="text-sm text-muted-foreground">No tasks found.</p> : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div key={task.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3">
                  <div><p className="font-semibold">{task.title}</p><p className="text-xs text-muted-foreground">{task.staffName} · Due {task.dueDate}{task.dueAt ? ` · ${formatDate(task.dueAt)}` : ""}</p></div>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs">{task.status} · {task.priority}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return <Card><CardContent className="space-y-2 p-3"><Icon className="h-5 w-5 text-primary" /><p className="text-xs text-muted-foreground">{label}</p><p className="font-display text-2xl font-bold">{value}</p></CardContent></Card>;
}

function Setting({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}
