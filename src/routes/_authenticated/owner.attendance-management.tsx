import { createFileRoute } from "@tanstack/react-router";
import { BackToAttendance } from "@/components/owner/BackToAttendance";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CalendarClock, ChevronDown, Plus, QrCode, RefreshCw, XCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { RecurringShiftsCard } from "@/components/owner/AttendanceOwnerTools";
import {
  ownerCancelAttendanceShift,
  ownerCreateAttendanceShift,
  ownerUpdateAttendanceShift,
  ownerCreateAttendanceStation,
  ownerUpdateAttendanceStation,
  ownerIssueAttendanceQrChallenge,
  ownerListAttendanceManagement,
  ownerSetAttendanceStationActive,
  ownerDeleteAttendanceStation,
} from "@/lib/attendance-management.functions";

export const Route = createFileRoute("/_authenticated/owner/attendance-management")({
  head: () => ({ meta: [{ title: "Attendance Schedules — Flamio" }, { name: "robots", content: "noindex" }] }),
  component: AttendanceManagement,
});

function AttendanceManagement() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(ownerListAttendanceManagement);
  const createStation = useServerFn(ownerCreateAttendanceStation);
  const updateStation = useServerFn(ownerUpdateAttendanceStation);
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const issueQr = useServerFn(ownerIssueAttendanceQrChallenge);
  const [qrChallenge, setQrChallenge] = useState<{ stationId: string; stationName: string; token: string; expiresAt: string } | null>(null);
  const setStationActive = useServerFn(ownerSetAttendanceStationActive);
  const deleteStation = useServerFn(ownerDeleteAttendanceStation);
  const createShift = useServerFn(ownerCreateAttendanceShift);
  const cancelShift = useServerFn(ownerCancelAttendanceShift);
  const updateShift = useServerFn(ownerUpdateAttendanceShift);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [stationName, setStationName] = useState("");
  const [stationDescription, setStationDescription] = useState("");
  const [stationLatitude, setStationLatitude] = useState("");
  const [stationLongitude, setStationLongitude] = useState("");
  const [geofenceRadius, setGeofenceRadius] = useState("100");
  const [userId, setUserId] = useState("");
  const [stationId, setStationId] = useState("");
  const [shiftDate, setShiftDate] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [dutyRole, setDutyRole] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("30");
  const [notes, setNotes] = useState("");
  const [stationsOpen, setStationsOpen] = useState(false);
  const [shiftMode, setShiftMode] = useState<"single" | "weekly">("single");
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

  const stations: { id: string; name: string; description: string | null; isActive: boolean; sortOrder: number; latitude: number | null; longitude: number | null; geofenceRadiusMeters: number }[] = query.data.stations;
  const shifts: { id: string; userId: string; staffName: string; dutyRole: string | null; shiftDate: string; startTime: string; endTime: string; isOvernight: boolean; stationId: string | null; plannedBreakMinutes: number; status: string; notes: string | null }[] = query.data.shifts;
  const staff: { id: string; name: string }[] = query.data.staff;
  const showStations = stationsOpen || Boolean(editingStationId) || Boolean(qrChallenge);
  return <div className="space-y-5">
    <BackToAttendance />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-display text-xl font-bold">Attendance schedules</h2><p className="text-sm text-muted-foreground">Owner-only controls · TEST environment</p></div>
      <Button variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
    <Card><CardContent className="space-y-3 p-4">
      <button type="button" aria-expanded={showStations} aria-controls="stations-panel" className="flex min-h-11 w-full items-center justify-between gap-2 text-left" onClick={() => setStationsOpen((o) => !o)}>
        <h3 className="font-display font-bold">{editingStationId ? "Edit station / work area" : `Stations / work areas (${stations.filter((s) => s.isActive).length} active)`}</h3>
        <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${showStations ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {showStations ? <>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (Boolean(stationLatitude.trim()) !== Boolean(stationLongitude.trim())) { toast.error("Enter both latitude and longitude, or leave both blank."); return; } void run(async () => { const payload = { name: stationName, description: stationDescription.trim() || null, latitude: stationLatitude.trim() ? Number(stationLatitude) : null, longitude: stationLongitude.trim() ? Number(stationLongitude) : null, geofenceRadiusMeters: Number(geofenceRadius) }; if (editingStationId) { await updateStation({ data: { ...payload, stationId: editingStationId } }); } else { await createStation({ data: payload }); } setStationName(""); setStationDescription(""); setStationLatitude(""); setStationLongitude(""); setGeofenceRadius("100"); setEditingStationId(null); }, editingStationId ? "Station updated" : "Station created"); }}>
        <div className="space-y-1"><Label htmlFor="station-name">Station name</Label><Input id="station-name" required minLength={2} maxLength={80} value={stationName} onChange={(e) => setStationName(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="station-description">Description (optional)</Label><Input id="station-description" maxLength={300} value={stationDescription} onChange={(e) => setStationDescription(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="station-latitude">Latitude (optional, for GPS)</Label><Input id="station-latitude" type="number" step="any" min={-90} max={90} value={stationLatitude} onChange={(e) => setStationLatitude(e.target.value)} placeholder="e.g. 23.8103" /></div>
        <div className="space-y-1"><Label htmlFor="station-longitude">Longitude (optional, for GPS)</Label><Input id="station-longitude" type="number" step="any" min={-180} max={180} value={stationLongitude} onChange={(e) => setStationLongitude(e.target.value)} placeholder="e.g. 90.4125" /></div>
        <div className="space-y-1"><Label htmlFor="station-radius">Geofence radius (metres)</Label><Input id="station-radius" type="number" min={25} max={1000} value={geofenceRadius} onChange={(e) => setGeofenceRadius(e.target.value)} /></div>
        <div className="flex gap-2 self-end"><Button type="submit" disabled={busy}><Plus className="mr-2 h-4 w-4" />{editingStationId ? "Save station" : "Add station"}</Button>{editingStationId ? <Button type="button" variant="outline" onClick={() => { setEditingStationId(null); setStationName(""); setStationDescription(""); setStationLatitude(""); setStationLongitude(""); setGeofenceRadius("100"); }}>Cancel edit</Button> : null}</div>
      </form>
      {stations.length ? <div className="space-y-2">{stations.map((station) => <div key={station.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><p className="font-medium">{station.name}</p>{station.description ? <p className="text-sm text-muted-foreground">{station.description}</p> : null}<p className="text-xs text-muted-foreground">{station.latitude != null && station.longitude != null ? `GPS: ${station.latitude}, ${station.longitude} · radius ${station.geofenceRadiusMeters} m` : "No GPS coordinates configured"}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditingStationId(station.id); setStationName(station.name); setStationDescription(station.description ?? ""); setStationLatitude(station.latitude == null ? "" : String(station.latitude)); setStationLongitude(station.longitude == null ? "" : String(station.longitude)); setGeofenceRadius(String(station.geofenceRadiusMeters)); }}>Edit</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => setStationActive({ data: { id: station.id, isActive: !station.isActive } }), station.isActive ? "Station disabled" : "Station enabled")}>{station.isActive ? "Disable" : "Enable"}</Button><Button size="sm" variant="outline" disabled={busy || !station.isActive} onClick={() => void run(async () => { const challenge = await issueQr({ data: { stationId: station.id } }); setQrChallenge(challenge); }, "Single-use QR generated (expires in 60 seconds)") }><QrCode className="mr-1 h-4 w-4"/>Generate QR</Button><Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => { const typed = window.prompt(`Delete "${station.name}" permanently?\n\nOnly stations that were never used can be deleted. Stations with shifts, tasks or clock-in history must be disabled instead.\n\nType the station name to confirm:`); if (typed == null) return; void run(() => deleteStation({ data: { id: station.id, confirmName: typed } }), "Station deleted"); }}>Delete</Button></div></div>)}</div> : <p className="text-sm text-muted-foreground">No stations yet.</p>}
      {qrChallenge ? <div className="rounded-lg border p-4 text-center space-y-3"><p className="font-semibold">One-time QR · {qrChallenge.stationName}</p><QRCodeSVG value={qrChallenge.token} size={220} level="M" className="mx-auto max-w-full" /><p className="text-xs text-muted-foreground">Expires at {new Date(qrChallenge.expiresAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka" })} Bangladesh time. The token works once only; generate a fresh QR after expiry or use.</p><code className="block break-all rounded bg-muted p-2 text-xs">{qrChallenge.token}</code><Button type="button" variant="outline" onClick={() => { void navigator.clipboard?.writeText(qrChallenge.token); toast.success("Token copied"); }}>Copy token</Button><Button type="button" variant="ghost" onClick={() => setQrChallenge(null)}>Hide QR</Button></div> : null}
      </> : null}
    </CardContent></Card>
    <div role="tablist" aria-label="Shift type" className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1">
      <Button type="button" role="tab" aria-selected={shiftMode === "single"} variant={shiftMode === "single" ? "default" : "ghost"} className="min-h-11" onClick={() => setShiftMode("single")}>Single day shift</Button>
      <Button type="button" role="tab" aria-selected={shiftMode === "weekly"} variant={shiftMode === "weekly" ? "default" : "ghost"} className="min-h-11" disabled={Boolean(editingShiftId)} onClick={() => setShiftMode("weekly")}>Weekly recurring roster</Button>
    </div>
    {shiftMode === "single" ? <>
    <Card><CardContent className="space-y-3 p-4">
      <h3 className="font-display font-bold">{editingShiftId ? "Edit scheduled shift" : "Schedule a shift"}</h3>{editingShiftId ? <p className="text-sm text-primary">Editing an unstarted shift. The staff member cannot be changed — cancel and recreate instead.</p> : null}
      <p className="text-sm text-muted-foreground">Times use Bangladesh time. Overnight shifts are supported. Overlapping scheduled shifts for the same staff member are rejected.</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!userId) { toast.error("Choose a staff member"); return; } const common = { stationId: stationId || null, dutyRole: dutyRole.trim() || null, shiftDate, startTime, endTime, plannedBreakMinutes: Number(breakMinutes), notes: notes.trim() || null }; if (editingShiftId) { void run(async () => { await updateShift({ data: { id: editingShiftId, ...common } }); setEditingShiftId(null); setNotes(""); }, "Shift updated"); return; } void run(async () => { await createShift({ data: { userId, ...common } }); setNotes(""); }, "Shift scheduled"); }}>
        <div className="space-y-1"><Label htmlFor="shift-staff">Staff member</Label><select id="shift-staff" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required disabled={Boolean(editingShiftId)} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Select staff</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="shift-station">Station (optional)</Label><select id="shift-station" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={stationId} onChange={(e) => setStationId(e.target.value)}><option value="">No station</option>{stations.filter((s) => s.isActive).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="shift-date">Duty date</Label><Input id="shift-date" type="date" required value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="shift-role">Duty role (optional)</Label><Input id="shift-role" maxLength={80} value={dutyRole} onChange={(e) => setDutyRole(e.target.value)} placeholder="e.g. Kitchen" /></div>
        <div className="space-y-1"><Label htmlFor="shift-start">Start time</Label><Input id="shift-start" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="shift-end">End time</Label><Input id="shift-end" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="shift-break">Planned break (minutes)</Label><Input id="shift-break" type="number" min={0} max={240} required value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="shift-notes">Notes (optional)</Label><Textarea id="shift-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy || staff.length === 0} className="flex-1"><CalendarClock className="mr-2 h-4 w-4" />{editingShiftId ? "Save shift changes" : "Create shift"}</Button>{editingShiftId ? <Button type="button" variant="outline" onClick={() => { setEditingShiftId(null); setNotes(""); }}>Cancel edit</Button> : null}</div>
      </form>
    </CardContent></Card>
    </> : <RecurringShiftsCard />}
    <Card><CardContent className="space-y-3 p-4">
      <h3 className="font-display font-bold">Upcoming / recent shifts</h3>
      {shifts.length === 0 ? <p className="text-sm text-muted-foreground">No shifts found in the current window.</p> : <div className="space-y-2">{shifts.map((shift) => <div key={shift.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"><div><p className="font-semibold">{shift.staffName}{shift.dutyRole ? " · " + shift.dutyRole : ""}</p><p className="text-sm text-muted-foreground">{shift.shiftDate} · {shift.startTime.slice(0,5)}–{shift.endTime.slice(0,5)}{shift.isOvernight ? " (overnight)" : ""}</p><p className="text-xs text-muted-foreground">{stations.find((s) => s.id === shift.stationId)?.name ?? "No station"} · break {shift.plannedBreakMinutes} min · {shift.status}</p>{shift.notes ? <p className="mt-1 text-sm">{shift.notes}</p> : null}</div>{shift.status === "scheduled" ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setShiftMode("single"); setEditingShiftId(shift.id); setUserId(shift.userId); setStationId(shift.stationId ?? ""); setDutyRole(shift.dutyRole ?? ""); setShiftDate(shift.shiftDate); setStartTime(shift.startTime.slice(0,5)); setEndTime(shift.endTime.slice(0,5)); setBreakMinutes(String(shift.plannedBreakMinutes)); setNotes(shift.notes ?? ""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { if (confirm("Cancel this scheduled shift?")) void run(() => cancelShift({ data: { id: shift.id } }), "Shift cancelled"); }}><XCircle className="mr-1 h-4 w-4" />Cancel</Button></div> : null}</div>)}</div>}
    </CardContent></Card>
  </div>;
}
