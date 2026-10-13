import { useServerFn } from "@tanstack/react-start";
import { BellRing, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  currentEndpoint,
  pushState,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";
import { disablePushSubscription, registerPushSubscription } from "@/lib/push.functions";

/**
 * Turns real phone notifications on/off for THIS device. Reuses the existing
 * push_tokens table through registerPushSubscription.
 */
export function PushToggle({ className }: { className?: string }) {
  const register = useServerFn(registerPushSubscription);
  const disable = useServerFn(disablePushSubscription);

  const [state, setState] = useState<ReturnType<typeof pushState>>("unsupported");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setState(pushState());
    void currentEndpoint().then((endpoint) => setEnabled(Boolean(endpoint)));
  }, []);

  if (state === "unsupported") {
    return (
      <p className={className}>
        <span className="text-xs text-muted-foreground">
          This browser can&apos;t show phone notifications. You&apos;ll still see everything
          here in the app.
        </span>
      </p>
    );
  }

  if (state === "unconfigured") return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      const subscription = await subscribeToPush();
      await register({ data: subscription });
      setEnabled(true);
      setState(pushState());
      toast.success("Phone notifications are on for this device.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't turn on notifications.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) await disable({ data: { endpoint } });
      setEnabled(false);
      toast.success("Phone notifications are off for this device.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't turn off notifications.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <Button
        variant={enabled ? "secondary" : "default"}
        size="sm"
        disabled={busy}
        onClick={() => void (enabled ? turnOff() : turnOn())}
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
        ) : (
          <BellRing aria-hidden="true" className="mr-2 size-4" />
        )}
        {enabled ? "Phone notifications on" : "Turn on phone notifications"}
      </Button>
      {state === "denied" ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Notifications are blocked for this site — allow them in your browser settings first.
        </p>
      ) : null}
    </div>
  );
}
