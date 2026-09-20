/* AttendFlow service worker — receives Web Push events and shows
 * low-attendance notifications even when the site (or browser) is closed. */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "AttendFlow", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "AttendFlow";
  const options = {
    body: data.body || "",
    tag: data.tag || "attendflow",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    renotify: true,
    requireInteraction: false,
    vibrate: [80, 40, 80],
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
