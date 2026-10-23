import { describe, expect, test } from "bun:test";
import { buildTaskPhotoPath, checkTaskPhotoPath, validateTaskPhotoBytes, canCompleteTask } from "./attendance-task-photo.ts";
const user = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const photoId = "33333333-3333-4333-8333-333333333333";
const now = 1792771200000;
const path = () => buildTaskPhotoPath(user, taskId, new Date(now), photoId);
describe("attendance task photo path", () => {
 test("builds exact owner/task-bound path", () => expect(path()).toBe(`${user}/tasks/${taskId}/1792771200000-${photoId}.jpg`));
 test("accepts matching fresh path", () => expect(checkTaskPhotoPath(path(), user, taskId, now)).toMatchObject({ok:true,uploadedAtMs:now}));
 test("rejects another staff path", () => expect(checkTaskPhotoPath(path(), "44444444-4444-4444-8444-444444444444", taskId, now).ok).toBe(false));
 test("rejects another task path", () => expect(checkTaskPhotoPath(path(), user, "44444444-4444-4444-8444-444444444444", now).ok).toBe(false));
 test.each(["../x.jpg", "x/tasks/y/1-id.jpg", path().replace(".jpg", ".JPG"), path()+"?x=1", path().replace("/tasks/", "/tasks/../")])("rejects unsafe path %s", (v) => expect(checkTaskPhotoPath(v,user,taskId,now).ok).toBe(false));
 test("rejects stale path", () => expect(checkTaskPhotoPath(buildTaskPhotoPath(user,taskId,new Date(now-900001),photoId),user,taskId,now).ok).toBe(false));
 test("rejects far-future path", () => expect(checkTaskPhotoPath(buildTaskPhotoPath(user,taskId,new Date(now+61000),photoId),user,taskId,now).ok).toBe(false));
});
describe("task photo bytes", () => {
 test("accepts jpeg within size bounds", () => { const b=new Uint8Array(2048); b.set([255,216,255]); expect(validateTaskPhotoBytes(b).ok).toBe(true); });
 test("rejects too small", () => expect(validateTaskPhotoBytes(new Uint8Array([255,216,255])).ok).toBe(false));
 test("rejects non-jpeg", () => { const b=new Uint8Array(2048); b.set([137,80,78]); expect(validateTaskPhotoBytes(b).ok).toBe(false); });
 test("rejects oversized", () => { const b=new Uint8Array(1500001); b.set([255,216,255]); expect(validateTaskPhotoBytes(b).ok).toBe(false); });
});
describe("task completion gate", () => {
 const open={id:taskId,status:"pending",requires_photo:false};
 test("allows no checklist items",()=>expect(canCompleteTask(open,[],null,user,now).ok).toBe(true));
 test("rejects unchecked item",()=>expect(canCompleteTask(open,[{is_done:false}],null,user,now).ok).toBe(false));
 test("rejects closed task",()=>expect(canCompleteTask({...open,status:"verified"},[],null,user,now).ok).toBe(false));
 test("requires photo when configured",()=>expect(canCompleteTask({...open,requires_photo:true},[],null,user,now).ok).toBe(false));
 test("allows fresh matching photo when required",()=>expect(canCompleteTask({...open,requires_photo:true},[],path(),user,now).ok).toBe(true));
 test("rejects another task photo when required",()=>expect(canCompleteTask({...open,requires_photo:true},[],buildTaskPhotoPath(user,"44444444-4444-4444-8444-444444444444",new Date(now),photoId),user,now).ok).toBe(false));
 test("does not require photo when disabled",()=>expect(canCompleteTask(open,[],null,user,now).ok).toBe(true));
});
