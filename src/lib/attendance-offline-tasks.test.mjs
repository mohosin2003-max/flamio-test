import { describe, expect, test } from "bun:test";
import {
  enqueue,
  flush,
  memoryStorage,
  recoverInterruptedSync,
  reconcileTaskConflict,
  reconcileConflict,
  isTaskKind,
  isAuthError,
  isPermanentError,
  MAX_ATTEMPTS,
} from "./attendance-offline.ts";

const at = (s) => new Date(`2026-10-24T06:00:${s}Z`);
const toggle = (itemId, isDone) => ({ itemId, isDone });

describe("offline task queue", () => {
  test("1. queue preservation: payload, order and state survive until acked", async () => {
    const st = memoryStorage();
    await enqueue(st, "task_item_toggle", "t1", at("01"), toggle("i1", true));
    await enqueue(st, "task_complete", "t2", at("02"), { taskId: "task1" });
    const all = await st.all();
    expect(all.map((i) => [i.id, i.state, i.attempts])).toEqual([
      ["t1", "pending", 0],
      ["t2", "pending", 0],
    ]);
    expect(all[0].payload).toEqual({ itemId: "i1", isDone: true });
    expect(isTaskKind("task_complete")).toBe(true);
    expect(isTaskKind("clock_in")).toBe(false);
  });

  test("2. checklist coalescing: latest tick wins, keeps original id; other items separate", async () => {
    const st = memoryStorage();
    await enqueue(st, "task_item_toggle", "a", at("01"), toggle("i1", true));
    const r = await enqueue(st, "task_item_toggle", "b", at("05"), toggle("i1", false));
    await enqueue(st, "task_item_toggle", "c", at("06"), toggle("i2", true));
    const all = await st.all();
    expect(all.length).toBe(2);
    expect(r.id).toBe("a");
    expect(all.find((i) => i.id === "a").payload.isDone).toBe(false);
  });

  test("3. completion deduplication: same task twice rejected, different task allowed", async () => {
    const st = memoryStorage();
    await enqueue(st, "task_complete", "a", at("01"), { taskId: "T" });
    await expect(enqueue(st, "task_complete", "b", at("02"), { taskId: "T" })).rejects.toThrow(
      /already waiting/,
    );
    await enqueue(st, "task_complete", "c", at("03"), { taskId: "U" });
    expect((await st.all()).length).toBe(2);
  });

  test("4. FIFO and retry: transient failure halts later items; gives up after MAX_ATTEMPTS", async () => {
    const st = memoryStorage();
    await enqueue(st, "task_item_toggle", "a", at("01"), toggle("i1", true));
    await enqueue(st, "task_complete", "b", at("02"), { taskId: "T" });
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      const sent = [];
      await flush(st, async (i) => {
        sent.push(i.id);
        if (i.id === "a") throw new TypeError("Failed to fetch");
      });
      if (n < MAX_ATTEMPTS) expect(sent).toEqual(["a"]);
    }
    const all = await st.all();
    expect(all[0]).toMatchObject({ state: "failed", attempts: MAX_ATTEMPTS });
    expect(all[1].state).toBe("confirmed");
  });

  test("5. idempotency: a confirmed task action is never resent", async () => {
    const st = memoryStorage();
    await enqueue(st, "task_complete", "k", at("01"), { taskId: "T" });
    let n = 0;
    await flush(st, async () => {
      n++;
    });
    await flush(st, async () => {
      n++;
    });
    expect(n).toBe(1);
  });

  test("6. conflicts: completed is confirmed; cancelled/missing is a real conflict", () => {
    const item = { kind: "task_complete", payload: { taskId: "T" } };
    expect(
      reconcileTaskConflict(item, { tasks: [{ id: "T", status: "completed" }] }).confirmed,
    ).toBe(true);
    expect(
      reconcileTaskConflict(item, { tasks: [{ id: "T", status: "cancelled" }] }).confirmed,
    ).toBe(false);
    expect(reconcileTaskConflict(item, { tasks: [] }).confirmed).toBe(false);
    const t = { kind: "task_item_toggle", payload: toggle("i1", true) };
    expect(
      reconcileTaskConflict(t, {
        tasks: [{ id: "T", status: "open", checklist: [{ id: "i1", is_done: true }] }],
      }).confirmed,
    ).toBe(true);
    expect(
      reconcileTaskConflict(t, {
        tasks: [{ id: "T", status: "open", checklist: [{ id: "i1", is_done: false }] }],
      }).confirmed,
    ).toBe(false);
    expect(reconcileTaskConflict(t, { tasks: [] }).confirmed).toBe(false);
  });

  test("7. photo guard and payload validation: photo tasks never queue", async () => {
    const st = memoryStorage();
    await expect(
      enqueue(st, "task_complete", "a", at("01"), { taskId: "T", requiresPhoto: true }),
    ).rejects.toThrow(/live connection/);
    await expect(
      enqueue(st, "task_complete", "b", at("01"), { taskId: "T", photoPath: "x/y.jpg" }),
    ).rejects.toThrow(/live connection/);
    await expect(enqueue(st, "task_complete", "c", at("01"), {})).rejects.toThrow(/Invalid/);
    await expect(enqueue(st, "task_item_toggle", "d", at("01"), { itemId: "i1" })).rejects.toThrow(
      /Invalid/,
    );
    expect((await st.all()).length).toBe(0);
  });

  test("8. status transitions: pending -> syncing -> confirmed; interrupted syncing recovers to pending", async () => {
    const st = memoryStorage();
    await enqueue(st, "task_complete", "a", at("01"), { taskId: "T" });
    await flush(st, async (i) => {
      expect((await st.all()).find((x) => x.id === i.id).state).toBe("syncing");
    });
    expect((await st.all())[0].state).toBe("confirmed");
    await enqueue(st, "task_complete", "b", at("02"), { taskId: "U" });
    const b = (await st.all()).find((i) => i.id === "b");
    await st.put({ ...b, state: "syncing" });
    expect(await recoverInterruptedSync(st)).toBe(1);
    expect((await st.all()).find((i) => i.id === "b").state).toBe("pending");
  });

  test("9. authorization/stale safety: auth and closed-task errors fail without retry", async () => {
    const st = memoryStorage();
    await enqueue(st, "task_complete", "a", at("01"), { taskId: "T" });
    await enqueue(st, "task_item_toggle", "b", at("02"), toggle("i1", true));
    await flush(st, async (i) => {
      throw new Error(i.id === "a" ? "Unauthorized" : "Task is closed");
    });
    expect(isAuthError("Unauthorized")).toBe(true);
    expect(isPermanentError("Task is closed")).toBe(true);
    expect((await st.all()).map((i) => [i.state, i.attempts])).toEqual([
      ["failed", 1],
      ["failed", 1],
    ]);
  });

  test("10. regression: punches still queue, dedupe and reconcile alongside tasks", async () => {
    const st = memoryStorage();
    await enqueue(st, "clock_in", "p1", at("01"));
    await enqueue(st, "task_item_toggle", "t1", at("02"), toggle("i1", true));
    await enqueue(st, "break_start", "p2", at("03"));
    await expect(enqueue(st, "clock_in", "p3", at("04"))).rejects.toThrow();
    await expect(enqueue(st, "clock_in", "q", at("04"), { qrToken: "x" })).rejects.toThrow(/QR/);
    const sent = [];
    await flush(st, async (i) => {
      sent.push(i.id);
    });
    expect(sent).toEqual(["p1", "t1", "p2"]);
    expect(
      reconcileConflict(
        { kind: "clock_in", requestedAt: at("01").toISOString() },
        {
          activeSession: { clockInAt: at("30").toISOString() },
          activeBreak: null,
          lastClosedSession: null,
        },
      ).confirmed,
    ).toBe(true);
  });
});
