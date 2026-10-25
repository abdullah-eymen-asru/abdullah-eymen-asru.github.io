/*
 * /sw-bildirim.js — Mesaj bildirimleri + "HER SEFERİNDE GÜNCEL KOD" için hafif Service Worker.
 * ÖNBELLEK YOK (Cache API kullanılmaz). Tek ağ davranışı: aynı kaynaklı sayfa/JS/CSS/JSON GET isteklerini tarayıcı önbelleğini
 * ATLAYARAK sunucuyla doğrulatmak (cache:"no-cache" → ETag/If-None-Match; değişmediyse 304). GitHub Pages'in sabit 10 dk
 * önbelleği yüzünden eski kodun gelmesi böylece biter. Hata olursa istek olduğu gibi (SW yokmuş gibi) tarayıcıya bırakılır.
 * Bildirime tıklayınca ilgili sohbeti açar. (İçerik şifreli olduğu için bildirimde mesaj metni ASLA yoktur.)
 * Web Push (uygulama kapalıyken) için push olayı da dinlenir; gönderici sunucu kurulmadıkça tetiklenmez.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// GÜNCEL KOD: yalnızca aynı kaynaklı GET; HavaStil kendi SW'sini (daha dar kapsam) kullanır; Range/akış istekleri ve diğer kaynaklar dokunulmaz.
const DOGRULA = /\.(?:js|mjs|css|json|html|webmanifest)$/i;
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET" || r.headers.has("range")) return;
  let u; try { u = new URL(r.url); } catch { return; }
  if (u.origin !== self.location.origin) return;
  if (u.pathname.startsWith("/panel/havastil")) return;
  if (u.pathname === "/surum.json" || u.pathname === "/sw-bildirim.js") return;       // kendi no-store / tarayıcının SW güncelleme denetimi
  const sayfa = r.mode === "navigate";
  const varlik = DOGRULA.test(u.pathname) || u.pathname.endsWith("/");
  if (!sayfa && !varlik) return;                                                      // görsel/yazı tipi/medya: normal önbellek
  if (r.cache === "no-store" || r.cache === "reload" || r.cache === "no-cache") return; // zaten taze isteniyor
  e.respondWith((async () => {
    try {
      return await fetch(r.mode === "navigate" ? r : new Request(r, { cache: "no-cache" }), r.mode === "navigate" ? { cache: "no-cache" } : undefined);
    } catch {
      try { return await fetch(r); } catch (h) { return Response.error(); }
    }
  })());
});

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
