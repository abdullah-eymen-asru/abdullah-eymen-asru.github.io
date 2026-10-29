/*
 * assets/js/sistem-yedek/r2-kota.js — R2 KOTA KARTI (Akademik Kütüphane, Dosya Yöneticisi ve Sistem Durumu'nda AYNI kaynaktan, eş zamanlı).
 * Kaynak: sistem-yedek-worker GET /r2/kota (Cloudflare ücretsiz GraphQL Analytics; sunucuda 60 sn önbellek → tüm sekmeler aynı sayıyı görür).
 * Tek paylaşımlı sorgu: sayfada kaç kart olursa olsun 60 sn'de en çok 1 istek; sekme görünür değilse istek yok; sekmeler arası localStorage ortaklaşa.
 * Yetki: yalnızca Site Sahibi / yetkili yönetici — Worker 403 verirse kart HİÇ çizilmez (üyeler görmez).
 * Gösterilen: Class A (yazma/listeleme) · Class B (okuma/indirme dahil GET/HEAD) · depolama · ücretsiz işlemler (silme) · bugünkü toplamlar. Çıkış (egress) R2'de ücretsizdir.
 */
import { workerJson } from "./ortak.js";

const ANAHTAR = "aea_r2kota_v1", TTL = 60000;
const aboneler = new Set();
let son = null, ucusta = null, zamanlayici = null;
const sayi = (n) => Number(n || 0).toLocaleString("tr-TR");
const bayt = (n) => { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0, v = Number(n || 0); while (v >= 1024 && i < 4) { v /= 1024; i++; } return `${v.toLocaleString("tr-TR", { maximumFractionDigits: v >= 100 || i === 0 ? 0 : 1 })} ${u[i]}`; };
const yuzde = (a, b) => (b ? Math.min(999, (a / b) * 100) : 0);
const el = (t, oz = {}, ...c) => { const n = document.createElement(t); for (const [k, v] of Object.entries(oz)) { if (v == null || v === false) continue; if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v); } n.append(...c.filter((x) => x != null)); return n; };

async function cek(zorla = false) {
  if (!zorla) { try { const p = JSON.parse(localStorage.getItem(ANAHTAR) || "null"); if (p && Date.now() - p.t < TTL) { son = p; return p; } } catch { /* yok say */ } }
  if (ucusta) return ucusta;
  ucusta = (async () => {
    let kayit;
    try { kayit = { t: Date.now(), veri: await workerJson("/r2/kota") }; }
    catch (h) { kayit = { t: Date.now(), hata: h.durum === 403 || h.durum === 401 ? "yetki" : h.message || "okunamadı" }; }
    son = kayit;
    try { localStorage.setItem(ANAHTAR, JSON.stringify(kayit)); } catch { /* yok say */ }
    return kayit;
  })().finally(() => { ucusta = null; });
  return ucusta;
}
async function dongu(zorla = false) {
  if (document.hidden && !zorla) return;
  const k = await cek(zorla);
  aboneler.forEach((f) => { try { f(k); } catch { /* yok say */ } });
}
function abone(f) {
  aboneler.add(f);
  if (son) f(son);
  if (!zamanlayici) { zamanlayici = setInterval(() => dongu(), TTL); document.addEventListener("visibilitychange", () => { if (!document.hidden) dongu(); }); }
  dongu();
  return () => { aboneler.delete(f); if (!aboneler.size) { clearInterval(zamanlayici); zamanlayici = null; } };
}
function satir(ad, deger, sinir, ek, birim = "sayi") {
  const y = yuzde(deger, sinir);
  const s = el("div", { class: `rk-satir${y >= 90 ? " rk-tehlike" : y >= 70 ? " rk-uyari" : ""}` });
  const p = el("progress", { max: "100", value: String(Math.min(100, y)), "aria-label": `${ad} kullanımı` });
  s.append(el("div", { class: "rk-ust" }, el("span", { text: ad }), el("span", { text: `${birim === "bayt" ? bayt(deger) : sayi(deger)} / ${birim === "bayt" ? bayt(sinir) : sayi(sinir)} · %${y.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}` })), p);
  if (ek) s.append(el("div", { class: "rk-not", text: ek }));
  return s;
}

/** yer: kartın çizileceği kapsayıcı. Yetki yoksa yer boşaltılır ve gizlenir. @returns {() => void} söküm */
export function r2KotaKartiKur(yer, { baslik = "R2 kullanımı (bu ay)" } = {}) {
  if (!yer) return () => {};
  yer.hidden = true;
  const sok = abone((k) => {
    if (k.hata === "yetki") { yer.replaceChildren(); yer.hidden = true; return; }
    const kart = el("section", { class: "rk-kart", "aria-label": "R2 kota kullanımı" });
    const zaman = new Date(k.t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const yenile = el("button", { type: "button", class: "sd-btn", "aria-label": "Şimdi yenile" }, "⟳");
    yenile.addEventListener("click", () => dongu(true));
    kart.append(el("h3", {}, el("span", { text: `🪣 ${baslik}` }), el("span", {}, el("small", { text: `güncelleme ${zaman} · UTC ay ` }), yenile)));
    if (k.hata || !k.veri || k.veri.yapilandirilmadi) {
      kart.append(el("p", { class: "rk-not rk-hata", text: k.veri?.yapilandirilmadi ? "R2 kota izleme kurulu değil (Worker'da CF_ACCOUNT_ID ve CF_API_TOKEN gerekir)." : `Kota okunamadı: ${k.hata || "bilinmeyen hata"}` }));
    } else {
      const v = k.veri, s = v.sinirlar, a = v.aylik, g = v.gunluk;
      const satirlar = el("div", { class: "rk-satirlar" });
      satirlar.append(
        satir("Yazma + listeleme (Class A)", a.a, s.a, `Bugün: ${sayi(g?.a)} · yükleme, kopyalama, listeleme sayılır`),
        satir("Okuma + indirme (Class B)", a.b, s.b, `Bugün: ${sayi(g?.b)} · her dosya açma/indirme/HEAD bir okumadır`),
      );
      if (v.depolama) satirlar.append(satir("Depolama", v.depolama.bayt, s.depolamaBayt, `${sayi(v.depolama.nesne)} nesne · ${Object.entries(v.depolama.kovalar).map(([b, x]) => `${b}: ${bayt(x.bayt)}`).join(" · ")}`, "bayt"));
      kart.append(satirlar, el("p", { class: "rk-not", text: `Silme işlemleri ücretsizdir (bu ay ${sayi(a.ucretsiz)}). Çıkış (egress/indirme trafiği) R2'de ücretsizdir; yalnızca işlem sayısı sayılır. Aylık kotalar her ayın 1'inde (UTC) sıfırlanır; depolama kotası sürekli toplamdır. Yalnızca site sahibi ve yetkili yöneticiler görür.` }));
    }
    yer.replaceChildren(kart); yer.hidden = false;
  });
  return sok;
}
export const r2KotaVerisi = () => son;
export const r2KotaYenile = () => dongu(true);
