import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Slot } from "@/lib/opening-hours";

/**
 * One popup with Date + Time + Continue. Used both when the restaurant is
 * closed (auto-opens) and for "Schedule for later" while open.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  closed,
  slots,
  opensAt,
  value,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closed: boolean;
  slots: Slot[];
  opensAt: string | null;
  value: string | null;
  onConfirm: (iso: string) => void;
}) {
  const days = useMemo(() => {
    const map = new Map<string, { key: string; label: string; slots: Slot[] }>();
    for (const s of slots) {
      const day = map.get(s.dateKey) ?? { key: s.dateKey, label: s.dateLabel, slots: [] };
      day.slots.push(s);
      map.set(s.dateKey, day);
    }
    return [...map.values()];
  }, [slots]);

  const [dayKey, setDayKey] = useState<string>("");
  const [iso, setIso] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    const current = slots.find((s) => s.iso === value);
    const firstDay = current?.dateKey ?? days[0]?.key ?? "";
    setDayKey(firstDay);
    setIso(current?.iso ?? days.find((d) => d.key === firstDay)?.slots[0]?.iso ?? "");
  }, [open, value, slots, days]);

  const day = days.find((d) => d.key === dayKey);
  const selectClass =
    "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{closed ? "We're Closed Right Now" : "Schedule for later"}</DialogTitle>
          <DialogDescription>
            {days.length === 0
              ? closed
                ? `Our restaurant is closed right now.${opensAt ? ` We open at ${opensAt}.` : ""} Scheduled orders aren't available at the moment.`
                : "No times are available to schedule right now."
              : closed
                ? "Our restaurant is closed for today. You can schedule this order for tomorrow or another available date."
                : "Pick when you'd like your order."}
          </DialogDescription>
        </DialogHeader>

        {days.length > 0 ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-date">Date</Label>
              <select
                id="schedule-date"
                className={selectClass}
                value={dayKey}
                onChange={(e) => {
                  setDayKey(e.target.value);
                  setIso(days.find((d) => d.key === e.target.value)?.slots[0]?.iso ?? "");
                }}
              >
                {days.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-time">Time</Label>
              <select id="schedule-time" className={selectClass} value={iso} onChange={(e) => setIso(e.target.value)}>
                {(day?.slots ?? []).map((s) => (
                  <option key={s.iso} value={s.iso}>{s.timeLabel}</option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          {days.length > 0 ? (
            <Button
              className="w-full"
              disabled={!iso}
              onClick={() => {
                onConfirm(iso);
                onOpenChange(false);
              }}
            >
              Continue to Checkout
            </Button>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>OK</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
