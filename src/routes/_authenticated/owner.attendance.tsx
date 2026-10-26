import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, ChevronRight, ClipboardList, Clock3, FileBarChart, RefreshCw, Settings2, ShieldAlert, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ownerGetAttendanceOverview } from "@/lib/attendance.functions";
import { ownerGetAttendanceSelfieUrl } from "@/lib/attendance-selfie.functions";
import { ownerReviewAttendanceSession } from "@/lib/attendance-workflow.functions";
import { ownerCheckAttendanceIssues } from "@/lib/attendance-extras.functions";
import { AttendanceNeedsAttentionCard } from "@/components/owner/AttendanceOwnerTools";

type View = "duty" | "late" | "review";

export const Route = createFileRoute("/_authenticated/owner/attendance")({
  validateSearch: (search: Record<string, unknown>): { view?: View } => {
    const v = search.view;
    return v === "duty" || v === "late" || v === "review" ? { view: v } : {};
  },
  head: () => ({
    meta: [
      { title: "Attendance — Flamio" },
      { name: "description", content: "Owner attendance dashboard: staff on duty, lateness, breaks and open tasks." },
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

type SessionRow = { id: string; userId: string; staffName: string; clockOutAt: string | null; lateMinutes: number; status: string; clockInAt: string; dutyDate: string; workedMinutes: number; verificationStatus: string };

function OwnerAttendance() {
  const { view } = Route.useSearch();
  const getOverview = useServerFn(ownerGetAttendanceOverview);
  const overview = useQuery({
    queryKey: ["owner-attendance-overview"],
    queryFn: () => getOverview(),
    refetchInterval: 30_000,
  });

  if (overview.isLoading) {
    return <div className="space-y-3"><Skeleton className="h-10 w-1/2" /><div className="grid grid-cols-2 gap-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div><Skeleton className="h-28 w-full" /></div>;
  }

  if (overview.error || !overview.data) {
    return (
      <EmptyState
        title="Attendance data is not ready"
        description={overview.error instanceof Error ? overview.error.message : "Attendance data could not be loaded."}
        action={<Button onClick={() => void overview.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>}
      />
    );
  }

  const { counts } = overview.data;
  if (view) return <MonitoringView view={view} data={overview.data as unknown as { sessions: SessionRow[]; openSessions: SessionRow[]; lateSessions: SessionRow[] }} onRefresh={() => void overview.refetch()} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Attendance</h2>
          <p className="text-sm text-muted-foreground">Live duty overview · Bangladesh time · refreshes every 30 seconds</p>
        </div>
        <Button variant="outline" className="min-h-12" onClick={() => void overview.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard to="/owner/staff" icon={Users} label="Total Staff" value={String(counts.totalStaff)} />
        <KpiCard to="/owner/attendance" search={{ view: "duty" }} icon={Clock3} label="On Duty" value={String(counts.onDuty)} />
        <KpiCard to="/owner/attendance" search={{ view: "late" }} icon={ShieldAlert} label="Late / Break" value={`${counts.lateToday} Late · ${counts.activeBreaks} Break`} small />
        <KpiCard to="/owner/attendance-workflow" icon={ClipboardList} label="Open Tasks" value={String(counts.openTasks)} />
      </div>

      <NeedsAttention disputed={counts.disputed} />

      <Link to="/owner/attendance-reports" className="flex min-h-24 items-center gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <FileBarChart className="h-8 w-8 shrink-0 text-primary" />
        <div className="flex-1">
          <p className="font-display text-lg font-bold">Attendance Reports</p>
          <p className="text-sm text-muted-foreground">Hours, attendance logs, CSV export and cleanup preview (read-only).</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </Link>

      <div className="grid gap-3 sm:grid-cols-2">
        <SmallLink to="/owner/attendance-management" icon={CalendarClock} label="Schedules & Stations" />
        <SmallLink to="/owner/attendance-settings" icon={Settings2} label="Attendance Settings" />
      </div>
    </div>
  );
}

function KpiCard({ to, search, icon: Icon, label, value, small }: { to: "/owner/staff" | "/owner/attendance" | "/owner/attendance-workflow"; search?: { view: View }; icon: LucideIcon; label: string; value: string; small?: boolean }) {
  return (
    <Link to={to} search={search as never} className="flex min-h-28 flex-col justify-between rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-center justify-between"><Icon className="h-5 w-5 text-primary" /><ChevronRight className="h-4 w-4 text-muted-foreground" /></div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={"font-display font-bold " + (small ? "text-lg" : "text-2xl")}>{value}</p>
      </div>
    </Link>
  );
}

function SmallLink({ to, icon: Icon, label }: { to: "/owner/attendance-management" | "/owner/attendance-settings"; icon: LucideIcon; label: string }) {
  return (
    <Link to={to} className="flex min-h-12 items-center gap-3 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Icon className="h-4 w-4 text-primary" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

type IssueData = { overlongBreaks: unknown[]; missedClockOuts: unknown[] };

/** Compact alert; renders nothing when there are no real issues. */
function NeedsAttention({ disputed }: { disputed: number }) {
  const checkIssues = useServerFn(ownerCheckAttendanceIssues);
  const issues = useQuery({ queryKey: ["att-issues"], queryFn: () => checkIssues({ data: { sendAlerts: false } }), refetchInterval: 60000 });
  const d = issues.data as IssueData | undefined;
  const longBreaks = d?.overlongBreaks.length ?? 0;
  const missed = d?.missedClockOuts.length ?? 0;
  if (!disputed && !longBreaks && !missed) return null;
  const items: { label: string; view: View }[] = [];
  if (disputed) items.push({ label: `${disputed} disputed session${disputed > 1 ? "s" : ""}`, view: "review" });
  if (missed) items.push({ label: `${missed} possible missed clock-out${missed > 1 ? "s" : ""}`, view: "duty" });
  if (longBreaks) items.push({ label: `${longBreaks} long break${longBreaks > 1 ? "s" : ""}`, view: "duty" });
  return (
    <div role="status" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive"><AlertTriangle className="h-4 w-4" />Needs attention</p>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.label}>
            <Link to="/owner/attendance" search={{ view: i.view }} className="flex min-h-10 items-center justify-between rounded-md px-2 text-sm hover:bg-muted/50">
              {i.label}<ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MonitoringView({ view, data, onRefresh }: { view: View; data: { sessions: SessionRow[]; openSessions: SessionRow[]; lateSessions: SessionRow[] }; onRefresh: () => void }) {
  const titles: Record<View, string> = { duty: "On Duty", late: "Late / Break", review: "Session review" };
  const list = view === "duty" ? data.openSessions : view === "late" ? data.lateSessions : data.sessions;
  const empty = view === "duty" ? "No one is on duty right now." : view === "late" ? "No late arrivals today." : "No attendance sessions found.";
  return (
    <div className="space-y-5">
      <Link to="/owner/attendance" className="inline-flex min-h-12 items-center gap-2 text-sm font-medium text-primary hover:underline">← Back to Attendance</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold">{titles[view]}</h2>
        <Button variant="outline" className="min-h-12" onClick={onRefresh}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Session views">
        {(["duty", "late", "review"] as View[]).map((v) => (
          <Link key={v} role="tab" aria-selected={v === view} to="/owner/attendance" search={{ view: v }} className={"min-h-10 rounded-full border px-4 py-2 text-sm " + (v === view ? "bg-primary text-primary-foreground" : "hover:bg-muted/50")}>{titles[v]}</Link>
        ))}
      </div>
      {view !== "review" ? <AttendanceNeedsAttentionCard /> : null}
      <SessionList sessions={list} empty={empty} />
    </div>
  );
}

function SessionList({ sessions, empty }: { sessions: SessionRow[]; empty: string }) {
  const viewerId = useAuth().user?.id ?? null;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {sessions.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
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
                {viewerId && session.userId === viewerId
                  ? <p className="mt-2 text-xs text-muted-foreground">Your own session — another manager must review it.</p>
                  : <SessionReviewControls sessionId={session.id} isOpen={!session.clockOutAt} current={session.verificationStatus} />}
                <SelfieEvidenceButton sessionId={session.id} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SessionReviewControls({ sessionId, isOpen, current }: { sessionId: string; isOpen: boolean; current: string }) {
  const review = useServerFn(ownerReviewAttendanceSession);
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (status: "verified" | "disputed" | "unverified") => {
    setBusy(true);
    try {
      await review({ data: { sessionId, status, note: note.trim() || null } });
      await queryClient.invalidateQueries({ queryKey: ["owner-attendance-overview"] });
      toast.success(`Session marked ${status}`);
      setNote("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not review session"); }
    finally { setBusy(false); }
  };
  return <div className="mt-2 flex flex-wrap items-center gap-2">
    <Input aria-label="Review note" placeholder="Review note (needed to dispute)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="h-8 max-w-xs text-xs" />
    <Button type="button" size="sm" disabled={busy || isOpen || current === "verified"} onClick={() => void run("verified")}>Verify</Button>
    <Button type="button" size="sm" variant="outline" disabled={busy || current === "disputed"} onClick={() => void run("disputed")}>Dispute</Button>
    <Button type="button" size="sm" variant="ghost" disabled={busy || current === "unverified"} onClick={() => void run("unverified")}>Reset</Button>
  </div>;
}

function SelfieEvidenceButton({ sessionId }: { sessionId: string }) {
  const getUrl = useServerFn(ownerGetAttendanceSelfieUrl);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = async () => {
    setBusy(true);
    try { const r = await getUrl({ data: { sessionId } }); setUrl(r.url); setNote(r.reason); }
    catch (e) { setNote(e instanceof Error ? e.message : "Could not load selfie"); }
    finally { setBusy(false); }
  };
  return <div className="mt-2 space-y-2">
    {!url ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "View clock-in selfie"}</Button> : <img src={url} alt="Clock-in selfie evidence" className="h-32 w-32 rounded-md object-cover" />}
    {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    {url ? <p className="text-xs text-muted-foreground">Photo evidence only. Face matching: NOT IMPLEMENTED. Link expires in 10 minutes.</p> : null}
  </div>;
}

