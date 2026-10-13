import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  isAudioUnlocked,
  playAlarmOnce,
  writeAlarmSettings,
  readAlarmSettings,
  startAlarm,
  stopAlarm,
  unlockAudio,
  type OrderAlarmSettings,
} from "@/lib/order-alarm";
import { ownerListOrders } from "@/lib/owner.functions";

/**
 * Foreground New Order Alarm for the Owner/Staff dashboard. Reuses the Orders
 * page's own query (same key, same 20s refresh) — no new data source. Only
 * mounted for Owner/Manager and staff with Online Orders / Order Management.
 */
export function NewOrderAlarm() {
  const listOrders = useServerFn(ownerListOrders);
  const orders = useQuery({
    queryKey: ["owner-orders"],
    queryFn: () => listOrders(),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });

  const [settings, setSettings] = useState<OrderAlarmSettings | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [alarming, setAlarming] = useState<{ id: string; code: string }[]>([]);
  const seenRef = useRef<Set<string> | null>(null);
  const silencedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setSettings(readAlarmSettings());
    setUnlocked(isAudioUnlocked());
    const onChange = () => setSettings(readAlarmSettings());
    window.addEventListener("flamio-order-alarm-settings", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("flamio-order-alarm-settings", onChange);
      window.removeEventListener("storage", onChange);
      stopAlarm();
    };
  }, []);

  // Track "placed" orders: the first load is the baseline (no alarm); later
  // ones that appear start it. Orders leave the list once confirmed/cancelled.
  useEffect(() => {
    const data = orders.data;
    if (!data) return;
    const placed = data.filter((o) => o.status === "placed");
    const placedIds = new Set(placed.map((o) => o.id));
    if (seenRef.current === null) {
      seenRef.current = placedIds;
      return;
    }
    const seen = seenRef.current;
    const fresh = placed.filter((o) => !seen.has(o.id));
    for (const o of placed) seen.add(o.id);
    setAlarming((current) => {
      const stillPlaced = current.filter((o) => placedIds.has(o.id));
      const added = fresh
        .filter((o) => !silencedRef.current.has(o.id))
        .map((o) => ({ id: o.id, code: o.code }));
      const next = [...stillPlaced, ...added];
      return next.length === current.length && added.length === 0 ? current : next;
    });
  }, [orders.data]);

  const active = alarming.length > 0 && settings?.enabled === true;
  const volume = settings?.volume ?? 0;
  const interval = settings?.intervalSec ?? 3;

  useEffect(() => {
    if (active && unlocked) startAlarm(volume, interval);
    else stopAlarm();
  }, [active, unlocked, volume, interval]);

  // Optional: keep the screen awake while the alarm is ringing and visible.
  useEffect(() => {
    if (!active) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    return () => void lock?.release().catch(() => undefined);
  }, [active]);

  if (!settings?.enabled) return null;

  const enableButton = !unlocked ? (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => setUnlocked(await unlockAudio())}
    >
      <BellRing aria-hidden="true" /> Enable Order Alarm
    </Button>
  ) : null;

  if (!active) {
    return enableButton ? (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <span>Tap once so this device can ring for new orders.</span>
        {enableButton}
      </div>
    ) : null;
  }

  const first = alarming[0]!;
  return (
    <div
      role="alert"
      className="sticky top-2 z-40 mb-4 rounded-2xl border-2 border-primary bg-primary px-4 py-3 text-primary-foreground shadow-ember"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-display text-xl font-black sm:text-2xl">
          <BellRing className="size-6 animate-pulse" aria-hidden="true" />
          NEW ORDER #{first.code}
          {alarming.length > 1 ? <span className="text-sm font-bold">+{alarming.length - 1} more</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {enableButton}
          <Button asChild size="sm" variant="secondary">
            <Link to="/owner/orders/$orderId" params={{ orderId: first.id }}>Open Order</Link>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              for (const o of alarming) silencedRef.current.add(o.id);
              setAlarming([]);
            }}
          >
            <VolumeX aria-hidden="true" /> Silence
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Owner Settings controls — stored on this device/browser only. */
export function NewOrderAlarmSettings() {
  const [s, setS] = useState<OrderAlarmSettings | null>(null);
  useEffect(() => setS(readAlarmSettings()), []);
  if (!s) return null;
  const update = (patch: Partial<OrderAlarmSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    writeAlarmSettings(next);
  };
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between">
        <div className="pr-3">
          <p className="font-medium">New Order Alarm on this device</p>
          <p className="text-sm text-muted-foreground">
            Repeating alarm while the dashboard is open. Saved on this device only.
          </p>
        </div>
        <Switch checked={s.enabled} onCheckedChange={(v) => update({ enabled: v })} />
      </div>
      <label className="block text-sm">
        Alarm volume: {Math.round(s.volume * 100)}%
        <input
          type="range" min={0.1} max={1} step={0.1} value={s.volume}
          className="mt-1 w-full accent-primary"
          onChange={(e) => update({ volume: Number(e.target.value) })}
        />
      </label>
      <label className="block text-sm">
        Repeat every {s.intervalSec} seconds
        <input
          type="range" min={2} max={15} step={1} value={s.intervalSec}
          className="mt-1 w-full accent-primary"
          onChange={(e) => update({ intervalSec: Number(e.target.value) })}
        />
      </label>
      <Button
        type="button" size="sm" variant="outline"
        onClick={async () => {
          await unlockAudio();
          playAlarmOnce(s.volume);
        }}
      >
        <BellRing aria-hidden="true" /> Test Alarm
      </Button>
    </div>
  );
}
