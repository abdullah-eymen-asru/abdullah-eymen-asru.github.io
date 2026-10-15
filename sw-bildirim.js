/*
 * /sw-bildirim.js — Mesaj bildirimleri için hafif Service Worker (PWA / arka plan sekmesi).
 * ÖNBELLEK YOK, ağ yakalama YOK: yalnızca bildirime tıklayınca ilgili sohbeti açar. (İçerik şifreli olduğu için bildirimde mesaj metni ASLA yoktur.)
 * Web Push (uygulama kapalıyken) için push olayı da dinlenir; gönderici sunucu kurulmadıkça tetiklenmez.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let v = {};
  try { v = e.data ? e.data.json() : {}; } catch { /* metin olmayan yük */ }
  e.waitUntil(self.registration.showNotification(v.baslik || "Yeni mesaj", {
    body: v.govde || "Yeni bir mesajın var.", tag: v.sohbet ? `sohbet-${v.sohbet}` : "mesaj", renotify: true,
    data: { sohbet: v.sohbet || null },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const sohbet = e.notification.data?.sohbet || null;
  const hedef = `/panel/dashboard.html${sohbet ? `?sohbet=${encodeURIComponent(sohbet)}` : ""}#users-mesajlar`;
  e.waitUntil((async () => {
    const liste = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of liste) {
      if (c.url.includes("/panel/dashboard")) { await c.focus(); c.postMessage({ tip: "sohbet-ac", sohbet }); return; }
    }
    await self.clients.openWindow(hedef);
  })());
});
