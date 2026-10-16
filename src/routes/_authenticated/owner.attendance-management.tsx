import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CalendarClock, Plus, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  ownerCancelAttendanceShift,
  ownerCreateAttendanceShift,
  ownerCreateAttendanceStation,
  ownerListAttendanceManagement,
  ownerSetAttendanceStationActive,
} from "@/lib/attendance-management.functions";

export const Route = createFileRoute("/owner/attendance-management")({
  head: () => ({ meta: [{ title: "Attendance Schedules — Flamio" }, { name: "robots", content: "noindex" }] }),
  component: AttendanceManagement,
});

function AttendanceManagement() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(ownerListAttendanceManagement);
  const createStation = useServerFn(ownerCreateAttendanceStation);
  const setStationActive = useServerFn(ownerSetAttendanceStationActive);
  const createShift = useServerFn(ownerCreateAttendanceShift);
  const cancelShift = useServerFn(ownerCancelAttendanceShift);
  const [stationName, setStationName] = useState("");
  const [stationDescription, setStationDescription] = useState("");
  const [userId, setUserId] = useState("");
  const [stationId, setStationId] = useState("");
  const [shiftDate, setShiftDate] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [dutyRole, setDutyRole] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("30");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ["owner-attendance-management"], queryFn: () => listFn(), staleTime: 0 });

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["owner-attendance-management"] });
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await operation(); await refresh(); toast.success(success); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Action failed"); }
    finally { setBusy(false); }
  };

  if (query.isLoading) return <div className="space-y-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (query.error || !query.data) return <EmptyState title="Attendance management unavailable" description="Could not load staff schedules from the TEST database." action={<Button onClick={() => void query.refetch()}>Retry</Button>} />;

  const { stations, shifts, staff } = query.data;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-display text-xl font-bold">Attendance schedules</h2><p className="text-sm text-muted-foreground">Owner-only controls · TEST environment</p></div>
      <Button variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
    <Card><CardContent className="space-y-3 p-4">
      <h3 className="font-display font-bold">Stations / work areas</h3>
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void run(async () => { await createStation({ data: { name: stationName, description: stationDescription.trim() || null } }); setStationName(""); setStationDescription(""); }, "Station created"); }}>
        <div className="space-y-1"><Label htmlFor="station-name">Station name</Label><Input id="station-name" required minLength={2} maxLength={80} value={stationName} onChange={(e) => setStationName(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="station-description">Description (optional)</Label><Input id="station-description" maxLength={300} value={stationDescription} onChange={(e) => setStationDescription(e.target.value)} /></div>
        <Button type="submit" disabled={busy} className="self-end"><Plus className="mr-2 h-4 w-4" />Add station</Button>
      </form>
      {stations.length ? <div className="space-y-2">{stations.map((station) => <div key={station.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><p className="font-medium">{station.name}</p>{station.description ? <p className="text-sm text-muted-foreground">{station.description}</p> : null}</div><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => setStationActive({ data: { id: station.id, isActive: !station.isActive } }), station.isActive ? "Station disabled" : "Station enabled")}>{station.isActive ? "Disable" : "Enable"}</Button></div>)}</div> : <p className="text-sm text-muted-foreground">No stations yet.</p>}
    </CardContent></Card>
    <Card><CardContent className="space-y-3 p-4">
      <h3 className="font-display font-bold">Schedule a shift</h3>
      <p className="text-sm text-muted-foreground">Times use Bangladesh time. Overnight shifts are supported. Overlapping scheduled shifts for the same staff member are rejected.</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!userId) { toast.error("Choose a staff member"); return; } void run(async () => { await createShift({ data: { userId, stationId: stationId || null, dutyRole: dutyRole.trim() || null, shiftDate, startTime, endTime, plannedBreakMinutes: Number(breakMinutes), notes: notes.trim() || null } }); setNotes(""); }, "Shift scheduled"); }}>
        <div className="space-y-1"><Label htmlFor="shift-staff">Staff member</Label><select id="shift-staff" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Select staff</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="shift-station">Station (optional)</Label><select id="shift-station" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={stationId} onChange={(e) => setStationId(e.target.value)}><option value="">No station</option>{stations.filter((s) => s.isActive).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="shift-date">Duty date</Label><Input id="shift-date" type="date" required value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="shift-role">Duty role (optional)</Label><Input id="shift-role" maxLength={80} value={dutyRole} onChange={(e) => setDutyRole(e.target.value)} placeholder="e.g. Kitchen" /></div>
        <div className="space-y-1"><Label htmlFor="shift-start">Start time</Label><Input id="shift-start" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="shift-end">End time</Label><Input id="shift-end" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="shift-break">Planned break (minutes)</Label><Input id="shift-break" type="number" min={0} max={240} required value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="shift-notes">Notes (optional)</Label><Textarea id="shift-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <Button type="submit" disabled={busy || staff.length === 0} className="sm:col-span-2"><CalendarClock className="mr-2 h-4 w-4" />Create shift</Button>
      </form>
    </CardContent></Card>
    <Card><CardContent className="space-y-3 p-4">
      <h3 className="font-display font-bold">Upcoming / recent shifts</h3>
      {shifts.length === 0 ? <p className="text-sm text-muted-foreground">No shifts found in the current window.</p> : <div className="space-y-2">{shifts.map((shift) => <div key={shift.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"><div><p className="font-semibold">{shift.staffName}{shift.dutyRole ? " · " + shift.dutyRole : ""}</p><p className="text-sm text-muted-foreground">{shift.shiftDate} · {shift.startTime.slice(0,5)}–{shift.endTime.slice(0,5)}{shift.isOvernight ? " (overnight)" : ""}</p><p className="text-xs text-muted-foreground">{stations.find((s) => s.id === shift.stationId)?.name ?? "No station"} · break {shift.plannedBreakMinutes} min · {shift.status}</p>{shift.notes ? <p className="mt-1 text-sm">{shift.notes}</p> : null}</div>{shift.status === "scheduled" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (confirm("Cancel this scheduled shift?")) void run(() => cancelShift({ data: { id: shift.id } }), "Shift cancelled"); }}><XCircle className="mr-1 h-4 w-4" />Cancel</Button> : null}</div>)}</div>}
    </CardContent></Card>
  </div>;
}
