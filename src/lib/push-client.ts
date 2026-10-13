/**
 * Browser side of push notifications: service worker registration, permission
 * request and subscription handling. Everything degrades gracefully — if the
 * browser has no push support or permission is denied, the app keeps working
 * with in-app notifications only.
 */

const VAPID_PUBLIC_KEY = import.meta.env["VITE_VAPID_PUBLIC_KEY"] as string | undefined;

export type PushState = "unsupported" | "unconfigured" | "default" | "granted" | "denied";

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output.buffer;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function pushState(): PushState {
  if (!pushSupported()) return "unsupported";
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  return Notification.permission as PushState;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/sw.js");
  return existing ?? (await navigator.serviceWorker.register("/sw.js"));
}

function keyToBase64(key: ArrayBuffer | null): string {
  if (!key) return "";
  const bytes = new Uint8Array(key);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export type SubscriptionPayload = {
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: string;
};

/** Asks for permission (if needed) and returns the subscription to store. */
export async function subscribeToPush(): Promise<SubscriptionPayload> {
  if (!pushSupported()) throw new Error("This browser can't show phone notifications.");
  if (!VAPID_PUBLIC_KEY) throw new Error("Notifications are not configured yet.");

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications are blocked. Allow them in your browser settings.");
  }

  const reg = await registration();
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  return {
    endpoint: subscription.endpoint,
    p256dh: keyToBase64(subscription.getKey("p256dh")),
    auth: keyToBase64(subscription.getKey("auth")),
    platform: "web",
  };
}

/** Current subscription endpoint on this device, if any. */
export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await reg?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

export async function unsubscribeFromPush(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
