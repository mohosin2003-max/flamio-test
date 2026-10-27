import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, Plus, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackToAttendance } from "@/components/owner/BackToAttendance";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OpenTasksEditCard, StoreChecklistsCard } from "@/components/owner/AttendanceOwnerTools";
import { ownerListAttendanceManagement } from "@/lib/attendance-management.functions";
import {
  ownerCreateAttendanceTask, ownerListAttendanceRequests, ownerReviewAttendanceRequest, ownerReviewAttendanceTask,
} from "@/lib/attendance-workflow.functions";
import { ownerGetAttendanceTaskPhotoUrl } from "@/lib/attendance-task-photo.functions";

export const Route = createFileRoute("/_authenticated/owner/attendance-workflow")({
  head: () => ({ meta: [{ title: "Attendance Tasks & Requests — Flamio" }, { name: "robots", content: "noindex" }] }),
  component: AttendanceWorkflow,
});

type ManagementData = {
  staff: Array<{ id: string; name: string }>;
  stations: Array<{ id: string; name: string; isActive: boolean }>;
  tasks: Array<{ id: string; title: string; staffName: string; dueDate: string; dueAt: string | null; priority: string; status: string; description: string | null; completionNote: string | null; reviewNote: string | null; requiresPhoto: boolean; photoPath: string | null }>;
};
type OwnerAttendanceRequest = { id: string; status: string; staff_name: string; request_type: string; leave_start_date: string | null; leave_end_date: string | null; target_date: string | null; reason: string; review_note: string | null };

function AttendanceWorkflow() {
  const qc = useQueryClient();
  const listManagement = useServerFn(ownerListAttendanceManagement);
  const listRequests = useServerFn(ownerListAttendanceRequests);
  const createTask = useServerFn(ownerCreateAttendanceTask);
  const reviewRequest = useServerFn(ownerReviewAttendanceRequest);
  const reviewTaskFn = useServerFn(ownerReviewAttendanceTask);
  const getTaskPhotoUrl = useServerFn(ownerGetAttendanceTaskPhotoUrl);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [assignedTo, setAssignedTo] = useState("");
  const [stationId, setStationId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Dhaka"}));
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<"low"|"medium"|"high"|"urgent">("medium");
  const [verify, setVerify] = useState(true);
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [items, setItems] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewDialog, setReviewDialog] = useState<{ kind: "task" | "request"; id: string } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const management = useQuery({queryKey:["owner-attendance-management"],queryFn:()=>listManagement()});
  const requests = useQuery({queryKey:["owner-attendance-requests"],queryFn:()=>listRequests()});
  const refresh = async()=>{await Promise.all([qc.invalidateQueries({queryKey:["owner-attendance-management"]}),qc.invalidateQueries({queryKey:["owner-attendance-requests"]})]);};
  const run=async(op:()=>Promise<unknown>,success:string):Promise<boolean>=>{setBusy(true);try{await op();await refresh();toast.success(success);return true;}catch(e){toast.error(e instanceof Error?e.message:"Action failed");return false;}finally{setBusy(false);}};
  const openReviewDialog=(kind:"task"|"request",id:string)=>{setReviewNote("");setReviewDialog({kind,id});};
  const submitReviewNote=async()=>{if(!reviewDialog)return;const note=reviewNote.trim();if(reviewDialog.kind==="task"&&note.length<3){toast.error("Please explain what the staff member needs to correct.");return;}const ok=await run(()=>reviewDialog.kind==="task"?reviewTaskFn({data:{taskId:reviewDialog.id,decision:"rejected",reviewNote:note||"Please review and resubmit."}}):reviewRequest({data:{requestId:reviewDialog.id,decision:"rejected",reviewNote:note||null}}),reviewDialog.kind==="task"?"Task returned to staff":"Request rejected");if(ok)setReviewDialog(null);};
  if(management.isLoading||requests.isLoading)return <div className="space-y-3"><Skeleton className="h-40 w-full"/><Skeleton className="h-48 w-full"/></div>;
  if(management.error||requests.error||!management.data||!requests.data)return <EmptyState title="Attendance workflow unavailable" description="Could not load tasks or requests." action={<Button onClick={()=>{void management.refetch();void requests.refetch();}}>Retry</Button>}/>;
  const {staff,stations,tasks}=management.data as ManagementData;
  const ownerRequests = requests.data as OwnerAttendanceRequest[];
  const pendingRequests = ownerRequests.filter((r) => r.status === "pending");
  return <div className="space-y-5">
    <BackToAttendance />
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-bold">Attendance Tasks & Requests</h2><p className="text-sm text-muted-foreground">Owner-only workflow controls · TEST</p></div><Button variant="outline" onClick={()=>{void management.refetch();void requests.refetch();}}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button></div>
    <Tabs defaultValue="tasks" className="space-y-4">
    <TabsList><TabsTrigger value="tasks" type="button">Tasks & Checklists</TabsTrigger><TabsTrigger value="requests" type="button">Staff Requests ({pendingRequests.length})</TabsTrigger></TabsList>
    <TabsContent value="tasks" forceMount className="space-y-5 data-[state=inactive]:hidden">
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Assign task</h3><form className="grid gap-3 sm:grid-cols-2" onSubmit={(e)=>{e.preventDefault();if(!assignedTo){toast.error("Choose staff");return;}void run(async()=>{await createTask({data:{assignedTo,stationId:stationId||null,title,description:description.trim()||null,dueDate,dueAt:dueTime?new Date(dueDate+"T"+dueTime+":00+06:00").toISOString():null,priority,requiresVerification:verify,requiresPhoto,items:items.split("\n").map(v=>v.trim()).filter(Boolean)}});setTitle("");setDescription("");setItems("");},"Task assigned");}}>
      <div className="space-y-1"><Label htmlFor="task-staff">Assign to staff</Label><select id="task-staff" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={assignedTo} onChange={e=>setAssignedTo(e.target.value)}><option value="">Select staff</option>{staff.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="task-station">Station (optional)</Label><select id="task-station" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={stationId} onChange={e=>setStationId(e.target.value)}><option value="">No station</option>{stations.filter((s)=>s.isActive).map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="task-title">Task title</Label><Input id="task-title" required minLength={2} maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="task-description">Description (optional)</Label><Textarea id="task-description" rows={2} maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></div>
      <div className="space-y-1"><Label htmlFor="task-date">Due date</Label><Input id="task-date" type="date" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></div>
      <div className="space-y-1"><Label htmlFor="task-time">Due time (optional)</Label><Input id="task-time" type="time" value={dueTime} onChange={e=>setDueTime(e.target.value)}/></div>
      <div className="space-y-1"><Label htmlFor="task-priority">Priority</Label><select id="task-priority" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={priority} onChange={e=>setPriority(e.target.value as typeof priority)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
      <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={verify} onChange={e=>setVerify(e.target.checked)}/> Require Owner verification</label>
      <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={requiresPhoto} onChange={e=>setRequiresPhoto(e.target.checked)}/> Require photo proof</label>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="task-items">Checklist items (one per line)</Label><Textarea id="task-items" rows={3} maxLength={5000} value={items} onChange={e=>setItems(e.target.value)} placeholder={"Clean station\nCheck stock\nSubmit handover"}/></div>
      <Button disabled={busy||staff.length===0} className="sm:col-span-2"><Plus className="mr-2 h-4 w-4"/>Assign task</Button>
    </form></CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Task review queue</h3>{tasks.length?tasks.map((task)=><div key={task.id} className="space-y-2 rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{task.title} · {task.staffName}</p><p className="text-xs text-muted-foreground">Due {task.dueDate}{task.dueAt?" · "+new Date(task.dueAt).toLocaleString("en-GB",{timeZone:"Asia/Dhaka"}):""} · {task.priority}</p></div><span className="text-xs">{task.status}</span></div>{task.description?<p className="text-sm">{task.description}</p>:null}{task.completionNote?<p className="text-sm text-muted-foreground">Completion note: {task.completionNote}</p>:null}{task.reviewNote?<p className="text-sm text-muted-foreground">Review note: {task.reviewNote}</p>:null}{task.requiresPhoto?<div className="space-y-2 rounded-md border p-2"><p className="text-xs font-medium">Photo proof required</p>{task.photoPath?(photoUrls[task.id]?<img src={photoUrls[task.id]} alt="Task photo proof" className="max-h-64 rounded-md object-contain"/>:<Button size="sm" variant="outline" disabled={busy} onClick={()=>void run(async()=>{const result=await getTaskPhotoUrl({data:{taskId:task.id}});if(!result.url)throw new Error(result.reason??"Photo proof unavailable.");setPhotoUrls((old)=>({...old,[task.id]:result.url!}));},"Photo proof loaded")}>View photo proof</Button>):<p className="text-xs text-muted-foreground">No photo proof attached yet.</p>}</div>:null}{["completed"].includes(task.status)?<div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={()=>void run(()=>reviewTaskFn({data:{taskId:task.id,decision:"verified"}}),"Task verified")}><CheckCircle2 className="mr-1 h-4 w-4"/>Verify</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>openReviewDialog("task",task.id)}><XCircle className="mr-1 h-4 w-4"/>Return</Button></div>:null}</div>):<p className="text-sm text-muted-foreground">No tasks created yet.</p>}</CardContent></Card>
    <StoreChecklistsCard />
    <OpenTasksEditCard />
    </TabsContent>
    <TabsContent value="requests" forceMount className="space-y-5 data-[state=inactive]:hidden">
    <Card><CardContent className="space-y-3 p-4"><h3 className="font-display font-bold">Pending staff requests ({pendingRequests.length})</h3>{ownerRequests.length?ownerRequests.map((r)=><div key={r.id} className="space-y-2 rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{r.staff_name} · {String(r.request_type).replaceAll("_"," ")}</p><p className="text-xs text-muted-foreground">{r.leave_start_date? r.leave_start_date+" – "+r.leave_end_date : r.target_date||"No target date"} · {r.status}</p></div></div><p className="text-sm">{r.reason}</p>{r.review_note?<p className="text-sm text-muted-foreground">Previous note: {r.review_note}</p>:null}{r.status==="pending"?<div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={()=>void run(()=>reviewRequest({data:{requestId:r.id,decision:"approved"}}),"Request approved")}><CheckCircle2 className="mr-1 h-4 w-4"/>Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>openReviewDialog("request",r.id)}><XCircle className="mr-1 h-4 w-4"/>Reject</Button></div>:null}</div>):<p className="text-sm text-muted-foreground">No attendance requests yet.</p>}</CardContent></Card>
    </TabsContent>
    </Tabs>
    <Dialog open={Boolean(reviewDialog)} onOpenChange={(open)=>{if(!open&&!busy)setReviewDialog(null);}}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{reviewDialog?.kind==="task"?"Return task to staff":"Reject attendance request"}</DialogTitle>
          <DialogDescription>{reviewDialog?.kind==="task"?"Explain what needs to be corrected before the staff member resubmits.":"Optionally explain why this attendance request is rejected."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="attendance-review-note">Review note {reviewDialog?.kind==="task"?"(required)":"(optional)"}</Label>
          <Textarea id="attendance-review-note" rows={4} maxLength={1000} value={reviewNote} onChange={(event)=>setReviewNote(event.target.value)} placeholder={reviewDialog?.kind==="task"?"Describe the correction needed":"Add a reason for rejection (optional)"} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={()=>setReviewDialog(null)}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={busy||(reviewDialog?.kind==="task"&&reviewNote.trim().length<3)} onClick={()=>void submitReviewNote()}>{busy?"Saving…":reviewDialog?.kind==="task"?"Return task":"Reject request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
