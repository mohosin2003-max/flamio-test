import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CheckCircle2, Clock3, RefreshCw, ShieldAlert, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { ownerGetAttendanceOverview } from "@/lib/attendance.functions";

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
  const getOverview = useServerFn(ownerGetAttendanceOverview);
  const overview = useQuery({
    queryKey: ["owner-attendance-overview"],
    queryFn: () => getOverview(),
    refetchInterval: 60_000,
  });

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

  const { settings, sessions, tasks } = overview.data;
  const openSessions = sessions.filter((session) => !session.clockOutAt);
  const lateSessions = sessions.filter((session) => session.lateMinutes > 0);
  const pendingTasks = tasks.filter((task) => !["completed", "verified", "cancelled"].includes(task.status));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Staff Duty Monitoring</h2>
          <p className="text-sm text-muted-foreground">Read-only overview · TEST environment · refreshes every minute</p>
        </div>
        <Button variant="outline" onClick={() => void overview.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Users} label="Recent sessions" value={String(sessions.length)} />
        <Stat icon={Clock3} label="Currently on duty" value={String(openSessions.length)} />
        <Stat icon={ShieldAlert} label="Late records" value={String(lateSessions.length)} />
        <Stat icon={CheckCircle2} label="Open tasks" value={String(pendingTasks.length)} />
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
            </div>
          ) : <p className="text-sm text-muted-foreground">No settings row found.</p>}
          <p className="text-xs text-muted-foreground">This initial page does not change settings or write attendance records.</p>
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
