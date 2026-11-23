/*
 * assets/js/demo/demo-sistem-durumu.js — Demo/vitrin modunda "Sistem Durumu" sekmesi: tamamen ÖRNEK (statik) görünüm.
 * -----------------------------------------------------------------------
 *  • Hiçbir ağ isteği YAPMAZ (Supabase, Worker, R2, GitHub, üçüncü taraf API'ler dahil). Gerçek servis adı/adresi/kota/anahtar durumu GÖSTERİLMEZ;
 *    yalnızca "böyle bir sayfa var" izlenimini veren genel kart başlıkları ve örnek rakamlar çizilir. Salt okunurdur; düğme yoktur.
 *  • Gerçek sayfayla aynı sd-* sınıflarını kullanır (assets/css/kesinti.css) → görünüm birebir aynıdır.
 *  • innerHTML yok (CSP + XSS); metinler textContent.
 */
const el = (t, oz = {}, ...c) => {
  const n = document.createElement(t);
  for (const [k, v] of Object.entries(oz)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v);
  }
  for (const x of c.flat()) if (x != null && x !== false) n.append(x);
  return n;
};
const kart = (baslik, deger, aciklama, seviye = "ok") =>
  el("article", { class: `sd-kart sd-${seviye}` },
    el("h3", {}, el("span", { class: "sd-nokta", "aria-hidden": "true" }), baslik),
    el("div", { class: "sd-deger", text: deger }),
    aciklama ? el("p", { class: "muted", text: aciklama }) : null);

const CEKIRDEK = [
  ["Giriş ve oturum servisi", "Çalışıyor", "Örnek gecikme: 112 ms"],
  ["Veritabanı", "Çalışıyor", "Örnek gecikme: 148 ms"],
  ["Site ve internet bağlantısı", "Çalışıyor", "Örnek gecikme: 64 ms"],
];
const DIS = [
  ["Kod barındırma (GitHub)", "Çalışıyor", "Örnek gecikme: 190 ms"],
  ["Bulut altyapısı (Cloudflare)", "Çalışıyor", "Örnek gecikme: 71 ms"],
  ["Hava tahmini servisi", "Çalışıyor", "Örnek gecikme: 220 ms"],
  ["Yağış radarı", "Çalışıyor", "Örnek gecikme: 98 ms"],
  ["PDF motoru (CDN)", "Çalışıyor", "Örnek gecikme: 83 ms"],
];
const HAVASTIL = [
  ["Hava tahmini ve hava kalitesi modeli", "Çalışıyor"],
  ["Resmî hava gözlemi", "Çalışıyor"],
  ["Havalimanı raporu", "Çalışıyor"],
  ["Hava kalitesi istasyonları", "Sınırlı veri (bölgeye göre)"],
  ["Harita ve konum arama", "Çalışıyor"],
  ["Yapay zekâ yorumu", "Çalışıyor"],
  ["Cihaz önbelleği ve çevrimdışı mod", "Çalışıyor"],
];

export function demoSistemDurumuCiz(kok) {
  if (!kok) return;
  kok.replaceChildren(
    el("p", { class: "kst-alt", text: "Bu sayfa vitrin modunda ÖRNEK verilerle gösterilir; gerçek servislere hiçbir istek yapılmaz." }),
    el("h3", { class: "sd-bolum-baslik", text: "Çekirdek servisler" }),
    el("div", { class: "sd-izgara" }, ...CEKIRDEK.map(([b, d, a]) => kart(b, d, a))),
    el("h3", { class: "sd-bolum-baslik", text: "Bağımlı dış servisler" }),
    el("div", { class: "sd-izgara" }, ...DIS.map(([b, d, a]) => kart(b, d, a))),
    el("h3", { class: "sd-bolum-baslik", text: "HavaStil" }),
    el("div", { class: "sd-izgara" }, ...HAVASTIL.map(([b, d]) => kart(b, d, "Örnek durum", /Sınırlı/.test(d) ? "uyari" : "ok"))),
  );
}
