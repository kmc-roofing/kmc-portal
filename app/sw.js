// KMC Field service worker: receives web push and shows the notification.
const APP = "/kmc-portal/app/";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: "KMC Field", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(
    self.registration.showNotification(d.title || "KMC Field", {
      body: d.body || "",
      icon: APP + "icon-192.png",
      badge: APP + "icon-192.png",
      tag: d.id || undefined,
      data: d,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.indexOf(APP) !== -1) {
          c.postMessage({ type: "kmc-open-inbox" });
          return c.focus();
        }
      }
      return self.clients.openWindow(APP + "?inbox=1");
    })
  );
});
