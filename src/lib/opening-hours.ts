/**
 * Opening hours + scheduled-order slots, always in Asia/Dhaka (UTC+6, no DST).
 * Pure functions shared by the browser (preview) and the server (authority).
 */

export interface HoursSettings {
  /** Manual switch. Off = force closed regardless of hours. */
  isOpen: boolean;
  /** When on, Opening/Closing time decides open/closed automatically. */
  autoHours: boolean;
  opensAt: string | null;
  closesAt: string | null;
  scheduledEnabled: boolean;
  maxAdvanceDays: number;
  paymentRequired: boolean;
  prepMinutes: number;
  slotMinutes: number;
  allowWhileClosed: boolean;
}

export interface Slot {
  iso: string;
  dateKey: string;
  dateLabel: string;
  timeLabel: string;
}

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** "11:30AM", "10:00 pm", "22:00", "9" → minutes after midnight. */
export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === "am" && h === 12) h = 0;
    if (m[3] === "pm" && h !== 12) h += 12;
  } else if (h > 24) return null;
  return (h % 24) * 60 + min;
}

/** Dhaka-local midnight (as a UTC ms timestamp) for the day containing `ms`. */
function dhakaMidnight(ms: number): number {
  return Math.floor((ms + DHAKA_OFFSET_MS) / DAY_MS) * DAY_MS - DHAKA_OFFSET_MS;
}

function hoursWindow(settings: HoursSettings): { open: number; close: number } | null {
  const open = parseTime(settings.opensAt);
  const close = parseTime(settings.closesAt);
  if (open === null || close === null || open === close) return null;
  // Overnight hours (e.g. 6 PM → 2 AM) end on the next day.
  return { open, close: close > open ? close : close + 1440 };
}

export function isOpenAt(settings: HoursSettings, at: Date = new Date()): boolean {
  if (!settings.isOpen) return false;
  if (!settings.autoHours) return true;
  const w = hoursWindow(settings);
  if (!w) return true; // hours not configured: manual switch decides
  const ms = at.getTime();
  const today = dhakaMidnight(ms);
  // Check today's window and yesterday's overnight window.
  for (const day of [today, today - DAY_MS]) {
    const start = day + w.open * 60_000;
    const end = day + w.close * 60_000;
    if (ms >= start && ms < end) return true;
  }
  return false;
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Dhaka",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Dhaka",
  hour: "numeric",
  minute: "2-digit",
});
const keyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatScheduled(iso: string): string {
  const d = new Date(iso);
  return `${dateFmt.format(d)} · ${timeFmt.format(d)}`;
}

/** Every bookable slot from now + preparation time up to the advance window. */
export function listSlots(settings: HoursSettings, now: Date = new Date()): Slot[] {
  if (!settings.scheduledEnabled || !settings.isOpen) return [];
  const w = hoursWindow(settings);
  if (!w) return [];
  const step = Math.max(settings.slotMinutes, 5) * 60_000;
  const nowMs = now.getTime();
  const earliest = nowMs + Math.max(settings.prepMinutes, 0) * 60_000;
  const today = dhakaMidnight(nowMs);
  const lastDay = today + Math.max(settings.maxAdvanceDays, 0) * DAY_MS;
  const todayKey = keyFmt.format(now);
  const tomorrowKey = keyFmt.format(new Date(nowMs + DAY_MS));
  const out: Slot[] = [];
  for (let day = today - DAY_MS; day <= lastDay; day += DAY_MS) {
    const start = day + w.open * 60_000;
    const end = day + w.close * 60_000;
    for (let t = start; t < end; t += step) {
      if (t < earliest || t >= lastDay + DAY_MS) continue;
      const d = new Date(t);
      const key = keyFmt.format(d);
      const prefix = key === todayKey ? "Today — " : key === tomorrowKey ? "Tomorrow — " : "";
      out.push({ iso: d.toISOString(), dateKey: key, dateLabel: prefix + dateFmt.format(d), timeLabel: timeFmt.format(d) });
    }
  }
  return out;
}

export function isValidSlot(settings: HoursSettings, iso: string, now: Date = new Date()): boolean {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return false;
  return listSlots(settings, now).some((s) => new Date(s.iso).getTime() === ms);
}

/** Whether a customer may schedule right now (considers the closed rule). */
export function canScheduleNow(settings: HoursSettings, now: Date = new Date()): boolean {
  if (!settings.scheduledEnabled) return false;
  if (!isOpenAt(settings, now) && !settings.allowWhileClosed) return false;
  return listSlots(settings, now).length > 0;
}
