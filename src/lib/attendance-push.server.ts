/**
 * Attendance-specific notifications. Uses the existing in-app/Web Push pipeline.
 * Callers must invoke these after the attendance database mutation succeeds.
 * Delivery is best-effort and must never roll back or mask the attendance result.
 */
import {
  managerUserIds,
  notifyUsers,
} from "@/lib/push.server";

async function bestEffort(label: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    console.error(`Attendance notification failed (${label})`, error);
  }
}

async function staffDisplayName(userId: string): Promise<string> {
  try {
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { data } = await db.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    return typeof data?.full_name === "string" && data.full_name.trim()
      ? data.full_name.trim().slice(0, 100)
      : "A staff member";
  } catch {
    return "A staff member";
  }
}

export async function sendLateArrivalAlert(input: {
  sessionId: string;
  userId: string;
  minutesLate: number;
}): Promise<void> {
  if (!Number.isFinite(input.minutesLate) || input.minutesLate <= 0) return;
  await bestEffort("late-arrival", async () => {
    const recipients = await managerUserIds();
    if (!recipients.length) return;
    const name = await staffDisplayName(input.userId);
    await notifyUsers(
      recipients.map((userId) => ({
        userId,
        kind: "personal" as const,
        title: `Late arrival: ${name}`,
        body: `${name} checked in ${Math.floor(input.minutesLate)} minutes late.`,
        status: "attendance_late",
        dedupeKey: `attendance:late:${input.sessionId}:${userId}`,
      })),
      {
        title: `Late arrival: ${name}`,
        body: `${name} checked in ${Math.floor(input.minutesLate)} minutes late.`,
        url: "/owner/attendance",
        tag: `attendance-late-${input.sessionId}`,
        urgency: "high",
        requireInteraction: true,
        vibrate: [300, 150, 300],
      },
    );
  });
}

export async function sendPendingRequestAlert(input: {
  requestId: string;
  userId: string;
  requestType: string;
}): Promise<void> {
  await bestEffort("pending-request", async () => {
    const recipients = await managerUserIds();
    if (!recipients.length) return;
    const requestType = input.requestType.replaceAll("_", " ");
    await notifyUsers(
      recipients.map((userId) => ({
        userId,
        kind: "personal" as const,
        title: "New attendance request",
        body: `A staff member submitted a ${requestType} request.`,
        status: "attendance_request",
        dedupeKey: `attendance:request:${input.requestId}:${userId}`,
      })),
      {
        title: "New attendance request",
        body: `A staff member submitted a ${requestType} request.`,
        url: "/owner/attendance-workflow",
        tag: `attendance-request-${input.requestId}`,
        urgency: "normal",
      },
    );
  });
}

export async function sendRequestDecisionAlert(input: {
  requestId: string;
  userId: string;
  requestType: string;
  approved: boolean;
  note?: string | null;
}): Promise<void> {
  await bestEffort("request-decision", async () => {
    const requestType = input.requestType.replaceAll("_", " ");
    const status = input.approved ? "approved" : "rejected";
    const body = `Your ${requestType} request was ${status}.${input.note?.trim() ? ` Note: ${input.note.trim().slice(0, 180)}` : ""}`;
    await notifyUsers(
      [{
        userId: input.userId,
        kind: "personal",
        title: `Attendance request ${status}`,
        body,
        status: `attendance_${status}`,
        dedupeKey: `attendance:decision:${input.requestId}:${status}`,
      }],
      {
        title: `Attendance request ${status}`,
        body,
        url: "/attendance",
        tag: `attendance-decision-${input.requestId}`,
        urgency: "normal",
      },
    );
  });
}

/** Overlong break / missed clock-out alert. dedupeKey makes repeats no-ops. */
export async function sendAttendanceIssueAlert(input: {
  kind: "overlong_break" | "missed_clock_out";
  recordId: string;
  userId: string;
  minutes: number;
}): Promise<boolean> {
  let sent = false;
  await bestEffort(input.kind, async () => {
    const recipients = await managerUserIds();
    if (!recipients.length) return;
    const name = await staffDisplayName(input.userId);
    const title = input.kind === "overlong_break" ? `Long break: ${name}` : `Missed clock-out: ${name}`;
    const body = input.kind === "overlong_break"
      ? `${name} has been on break for ${Math.floor(input.minutes)} minutes.`
      : `${name} is still clocked in after the shift should have ended.`;
    await notifyUsers(
      recipients.map((userId) => ({
        userId, kind: "personal" as const, title, body, status: `attendance_${input.kind}`,
        dedupeKey: `attendance:${input.kind}:${input.recordId}:${userId}`,
      })),
      { title, body, url: "/owner/attendance-reports", tag: `attendance-${input.kind}-${input.recordId}`, urgency: "high" },
    );
    sent = true;
  });
  return sent;
}
