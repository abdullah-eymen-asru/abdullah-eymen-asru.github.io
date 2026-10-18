/* HavaStil servis çalışanı — kapsam: YALNIZCA /panel/havastil/ (panelin geri kalanına dokunmaz).
   ÖNBELLEĞE ALINANLAR: bu sayfanın kabuğu + havastil JS/CSS + site stilleri (aynı kaynaklı GET). 
   ÖNBELLEĞE ALINMAYANLAR: Supabase, Worker, Open-Meteo, Nominatim (çapraz kaynak: hiç dokunulmaz) ve oturum/kişisel veri.
   Hava verisi çevrimdışı desteği sayfanın kendi 30 dk localStorage önbelleğindedir. */
const SURUM = "havastil-v5";
const KABUK = ["/panel/havastil/", "/assets/css/havastil.css", "/assets/js/havastil/arayuz.js", "/assets/js/havastil/bildirim.js", "/assets/js/havastil/bulut.js", "/assets/js/havastil/cekirdek.js", "/assets/js/havastil/haber-filtre.js", "/assets/js/havastil/haber.js", "/assets/js/havastil/hava-kodlari.js", "/assets/js/havastil/iller.js", "/assets/js/havastil/izin-yardim.js", "/assets/js/havastil/katalog.js", "/assets/js/havastil/konumlar.js", "/assets/js/havastil/sayfa.js", "/assets/js/havastil/taktik.js", "/assets/js/havastil/ui-ayar.js", "/assets/js/havastil/ui-haber.js", "/assets/js/havastil/ui-hava.js", "/assets/js/havastil/ui-kombin.js", "/assets/js/havastil/ui-konum.js", "/assets/js/havastil/ui-temel.js", "/assets/js/havastil/veri.js", "/assets/js/havastil/yagis-fizigi.js", "/assets/js/havastil/tetikleyici.js", "/assets/js/havastil/ui-sade.js", "/assets/js/havastil/ui-uzman.js", "/assets/js/havastil/ui-plan.js", "/assets/js/havastil/ui-lab.js", "/assets/js/havastil/panel.js", "/panel/havastil/ikon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SURUM).then((c) => Promise.all(KABUK.map((u) => c.add(u).catch(() => { /* biri eksikse kurulum bozulmasın */ })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("havastil-") && k !== SURUM).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== self.location.origin) return;        // çapraz kaynak ve POST: tarayıcıya bırak
  const kabukSayfasi = r.mode === "navigate" && u.pathname.startsWith("/panel/havastil");
  const varlik = u.pathname.startsWith("/assets/") || u.pathname.startsWith("/panel/havastil/");
  if (!kabukSayfasi && !varlik) return;                                         // site/panel diğer sayfaları: dokunma
  e.respondWith((async () => {
    const c = await caches.open(SURUM);
    try {
      const taze = await fetch(r);                                              // ağ-öncelikli (güncel kod), düşerse önbellek
      if (taze.ok && taze.type === "basic") c.put(kabukSayfasi ? "/panel/havastil/" : r, taze.clone());
      return taze;
    } catch {
      return (await c.match(kabukSayfasi ? "/panel/havastil/" : r)) || Response.error();
    }
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((l) => (l[0] ? l[0].focus() : self.clients.openWindow("/panel/havastil/"))));
});
