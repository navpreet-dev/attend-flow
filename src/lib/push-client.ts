"use client";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export type PushSetupResult = "granted" | "denied" | "unsupported";

/**
 * Registers the service worker, asks for notification permission and
 * subscribes this device to Web Push, saving the subscription server-side.
 */
export async function enablePushAlerts(): Promise<PushSetupResult> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    typeof Notification === "undefined" ||
    !VAPID_PUBLIC_KEY
  ) {
    return "unsupported";
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = sub.toJSON();
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
    });
    if (!res.ok) return "unsupported";
    return "granted";
  } catch {
    return "unsupported";
  }
}

/** Removes this device's push subscription (when alerts are disabled). */
export async function disablePushAlerts(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe().catch(() => {});
    }
  } catch {
    /* non-fatal */
  }
}

/** Pre-registers the service worker so pushes can arrive ASAP. */
export async function registerServiceWorker(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.register("/sw.js");
    }
  } catch {
    /* non-fatal */
  }
}
