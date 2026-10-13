/* Flamio service worker — real web push delivery + tap handling. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Flamio", body: event.data ? event.data.text() : "" };
  }

  const silent = payload.silent === true;
  const options = {
    body: payload.body || "",
    icon: "/favicon.png?v=20261009",
    badge: "/favicon.png?v=20261009",
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag) && !silent,
    silent,
    requireInteraction: payload.requireInteraction === true,
    timestamp: Date.now(),
    data: { url: payload.url || "/account/notifications" },
  };
  // Vibration is only honoured where the platform supports it; a plain
  // notification is shown everywhere else.
  if (!silent) options.vibrate = payload.vibrate || [200, 100, 200, 100, 200];
  // Staff/owner new-order alerts get a direct "Open Order" button.
  if (payload.tag && String(payload.tag).startsWith("order-")) {
    options.actions = [{ action: "open", title: "Open Order" }];
  }

  event.waitUntil(self.registration.showNotification(payload.title || "Flamio", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              /* navigation blocked — the window is still focused */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
