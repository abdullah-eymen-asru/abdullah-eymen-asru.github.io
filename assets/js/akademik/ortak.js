/*
 * assets/js/akademik/ortak.js — Akademik Kütüphane ortak yardımcıları.
 * CSP uyumu: satır içi stil/olay yok; DOM'a yalnızca textContent / sınıf / CSSOM ile dokunulur,
 * kullanıcı verisi innerHTML'e HER ZAMAN esc() ile girer.
 */
import { supabase, escapeHtml } from "../core/supabase-client.js";

export { supabase };
export const esc = escapeHtml;

/** wrangler deploy sonrası adresi doğrula (rehber/04-cloudflare-secretlar.md § 4.9). */
export const AKADEMIK_WORKER_URL = "https://akademik-kutuphane-worker.aeymena.workers.dev";

/** Veritabanındaki sabitlenmiş sürüm okunamazsa kullanılan, SINANMIŞ sürümler. */
export const MOTOR_VARSAYILAN = { pdfjs: "5.6.205", pdflib: "1.17.1" };

/** Cloudflare "istek gövdesi" üst sınırının altında kalmak için bu boyuttan büyük PDF'ler imzalı yolla yazılır. */
export const DOGRUDAN_PUT_ESIGI = 90 * 1024 * 1024;

export async function jeton() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) throw new Error("Oturum bulunamadı. Lütfen yeniden giriş yap.");
  return data.session.access_token;
}

export async function workerFetch(yol, { method = "GET", body, headers = {}, signal } = {}) {
  const t = await jeton();
  return fetch(AKADEMIK_WORKER_URL + yol, { method, body, signal, headers: { Authorization: `Bearer ${t}`, ...headers } });
}

export async function workerJson(yol, secenek = {}) {
  const r = await workerFetch(yol, secenek);
  let j = null;
  try { j = await r.json(); } catch { /* gövde JSON değil */ }
  if (!r.ok) {
    const e = new Error(j?.error || `Sunucu hatası (${r.status})`);
    e.durum = r.status;
    throw e;
  }
  return j;
}

export function bayt(n) {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  const birimler = ["KB", "MB", "GB", "TB"];
  let x = v / 1024, i = 0;
  while (x >= 1024 && i < birimler.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x < 10 ? 1 : 0)} ${birimler[i]}`;
}

export function tarih(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("tr-TR", { year: "numeric", month: "short", day: "numeric" }); } catch { return ""; }
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Küçük DOM yapıcı: el("button", {class:"x", "data-ak":"y"}, "metin" | Node ...) */
export function el(etiket, ozellikler = {}, ...cocuklar) {
  const n = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellikler || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuklar.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

let toastKutusu = null;
export function toast(mesaj, tur = "bilgi", sureMs = 4200) {
  if (!toastKutusu || !document.body.contains(toastKutusu)) {
    toastKutusu = el("div", { class: "ak-toast-kutu", role: "status", "aria-live": "polite" });
    document.body.append(toastKutusu);
  }
  const t = el("div", { class: `ak-toast ak-toast-${tur}` }, mesaj);
  toastKutusu.append(t);
  setTimeout(() => t.remove(), sureMs);
}

export function dosyaIndir(ad, icerik, mime = "text/plain;charset=utf-8") {
  const blob = icerik instanceof Blob ? icerik : new Blob([icerik], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: ad });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Panoya kopyalar; html verilirse zengin (italikli) biçim de eklenir. */
export async function panoyaKopyala(metin, html = null) {
  try {
    if (html && window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([metin], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
      return true;
    }
    await navigator.clipboard.writeText(metin);
    return true;
  } catch {
    const ta = el("textarea", { class: "ak-gizli-alan", "aria-hidden": "true" });
    ta.value = metin;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); });
}

export const RENKLER = [
  { ad: "Sarı", hex: "#ffd400" },
  { ad: "Kırmızı", hex: "#ff6666" },
  { ad: "Yeşil", hex: "#5fb236" },
  { ad: "Mavi", hex: "#2ea8e5" },
  { ad: "Mor", hex: "#a28ae5" },
  { ad: "Eflatun", hex: "#e56eee" },
  { ad: "Turuncu", hex: "#f19837" },
  { ad: "Gri", hex: "#aaaaaa" },
];

/* ----------------------------- PDF yükleme (R2) ----------------------------- */

function xhrPut(url, basliklar, govde, ilerleme) {
  return new Promise((coz, red) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    for (const [k, v] of Object.entries(basliklar)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => { if (e.lengthComputable && ilerleme) ilerleme(e.loaded / e.total); };
    x.onload = () => {
      let j = null;
      try { j = JSON.parse(x.responseText); } catch { /* R2 imzalı yanıtı boş olabilir */ }
      if (x.status >= 200 && x.status < 300) coz(j || {});
      else { const e = new Error(j?.error || `Yükleme hatası (${x.status})`); e.durum = x.status; red(e); }
    };
    x.onerror = () => red(new Error("Ağ hatası: yükleme tamamlanamadı."));
    x.send(govde);
  });
}

/**
 * PDF'i R2'ye yazar (ilk yükleme ya da açıklamalı sürümün üzerine yazma). BOYUT SINIRI YOK:
 * DOGRUDAN_PUT_ESIGI'ne kadar Worker'a, üstü Worker'ın verdiği imzalı adresle doğrudan R2'ye gider.
 * @returns {{boyut:number, rev:number, yol:string}}
 */
export async function pdfYukle(kaynakId, govde, { dosyaAdi, beklenenRev, ilerleme } = {}) {
  const boyut = govde.size ?? govde.byteLength;
  const t = await jeton();
  if (boyut <= DOGRUDAN_PUT_ESIGI) {
    const b = { Authorization: `Bearer ${t}`, "Content-Type": "application/pdf" };
    if (dosyaAdi) b["X-Dosya-Adi"] = encodeURIComponent(dosyaAdi);
    if (beklenenRev !== undefined && beklenenRev !== null) b["X-Beklenen-Rev"] = String(beklenenRev);
    return xhrPut(`${AKADEMIK_WORKER_URL}/pdf/${kaynakId}`, b, govde, ilerleme);
  }
  const imza = await workerJson(`/pdf/${kaynakId}/yukleme-imzasi`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dosya_adi: dosyaAdi }),
  });
  await xhrPut(imza.url, { "Content-Type": "application/pdf" }, govde, ilerleme);
  return workerJson(`/pdf/${kaynakId}/yukleme-tamam`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anahtar: imza.anahtar, dosya_adi: dosyaAdi }),
  });
}

/** PDF baytlarını ilerleme bildirerek indirir. @returns {{bayt:Uint8Array, rev:number}} */
export async function pdfIndirBayt(kaynakId, ilerleme) {
  const r = await workerFetch(`/pdf/${kaynakId}`);
  if (!r.ok) {
    let j = null;
    try { j = await r.json(); } catch { /* */ }
    throw new Error(j?.error || `PDF alınamadı (${r.status})`);
  }
  const toplam = Number(r.headers.get("Content-Length") || 0);
  const rev = Number(r.headers.get("X-Pdf-Rev") || 0);
  const okuyucu = r.body.getReader();
  const parcalar = [];
  let alinan = 0;
  for (;;) {
    const { done, value } = await okuyucu.read();
    if (done) break;
    parcalar.push(value);
    alinan += value.byteLength;
    if (ilerleme && toplam) ilerleme(alinan / toplam);
  }
  const bayt = new Uint8Array(alinan);
  let o = 0;
  for (const p of parcalar) { bayt.set(p, o); o += p.byteLength; }
  return { bayt, rev };
}
