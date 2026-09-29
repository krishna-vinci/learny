// Web Push subscribe helper (M3a T6 slice d). `PushManager.subscribe` needs the VAPID
// public key as a `Uint8Array`, but the server hands it over as a base64url string.
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** Requests notification permission, subscribes this device's service worker to Web
 * Push, and returns the subscription in the shape `POST /api/me/notifications/push`
 * expects. Throws with a readable message on denial or when push isn't supported. */
export async function subscribeToPush(vapidPublicKey: string): Promise<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
}> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push notifications aren't supported in this browser.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was denied.");
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}
