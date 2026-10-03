/*
 * assets/js/r2-arsiv/ortak.js — modüller arası ortak yardımcılar
 * (DOM kurma, biçimlendirme, Worker çağrısı, Türkçe-duyarsız normalizasyon).
 * CSP: inline style yok; kullanıcı verisi yalnızca textContent ile yazılır.
 */
import { supabase } from "../core/supabase-client.js";
import { ARSIV_WORKER_URL } from "./e2ee.js";

export function el(etiket, sinif, metin) {
  const e = document.createElement(etiket);
  if (sinif) e.className = sinif;
  if (metin != null) e.textContent = metin;
  return e;
}

export function btn(metin, sinif, tikla, ozellikler = {}) {
  const b = el("button", sinif || "ra-btn", metin);
  b.type = "button";
  Object.entries(ozellikler).forEach(([a, v]) => b.setAttribute(a, v));
  if (tikla) b.addEventListener("click", tikla);
  return b;
}

export function boyutYaz(b) {
  if (b == null) return "";
  const birim = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = Number(b);
  while (v >= 1024 && i < birim.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${birim[i]}`;
}

export function tarihYaz(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

// SQL'deki public.tr_ara_normalize() ile AYNI eşleme (birebir karakter; uzunluk korunur).
const TR_HARITA = { "İ": "i", "I": "i", "ı": "i", "Ğ": "g", "ğ": "g", "Ü": "u", "ü": "u", "Ş": "s", "ş": "s", "Ö": "o", "ö": "o", "Ç": "c", "ç": "c" };
export function normalize(s) {
  return String(s ?? "").replace(/[İIıĞğÜüŞşÖöÇç]/g, (m) => TR_HARITA[m]).toLowerCase();
}

export function aramaKelimeleri(q) {
  return normalize(q.trim()).split(/\s+/).filter(Boolean);
}

/** Arama eşleşmelerini <mark> ile vurgulayarak `hedef` içine yazar. */
export function vurgulu(hedef, metin, kelimeler) {
  hedef.replaceChildren();
  if (!kelimeler?.length) { hedef.textContent = metin; return; }
  const n = normalize(metin);
  const aralik = [];
  kelimeler.forEach((k) => {
    let i = n.indexOf(k);
    while (i !== -1) { aralik.push([i, i + k.length]); i = n.indexOf(k, i + k.length); }
  });
  aralik.sort((a, b) => a[0] - b[0]);
  const birlesik = [];
  aralik.forEach((r) => {
    const son = birlesik[birlesik.length - 1];
    if (son && r[0] <= son[1]) son[1] = Math.max(son[1], r[1]); else birlesik.push([...r]);
  });
  let imlec = 0;
  birlesik.forEach(([a, b]) => {
    if (a > imlec) hedef.appendChild(document.createTextNode(metin.slice(imlec, a)));
    hedef.appendChild(el("mark", "ra-vurgu", metin.slice(a, b)));
    imlec = b;
  });
  if (imlec < metin.length) hedef.appendChild(document.createTextNode(metin.slice(imlec)));
}

export const ROL_ETIKETI = {
  owner: "Site Sahibi", admin: "Yönetici", manager: "İçerik Sorumlusu", editor: "İçerik Editörü",
  special_user: "Özel Üye", user: "Üye",
};

export function basHarfler(ad) {
  const p = String(ad || "?").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toLocaleUpperCase("tr-TR");
}
export function avatarSinifi(ad) {
  let h = 0;
  for (const c of String(ad)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return `ra-av-${h % 8}`;
}

/** Worker'a oturum JWT'siyle POST. Hata: Error(hata mesajı); 429/403 gibi durum `durum` alanında. */
export async function worker(yol, govde) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Oturum bulunamadı. Sayfayı yenileyip tekrar giriş yap.");
  let r;
  try {
    r = await fetch(`${ARSIV_WORKER_URL}${yol}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(govde),
    });
  } catch {
    throw new Error("Dosya servisine ulaşılamadı (Worker adresi, CORS ya da ağ).");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.hata || `İşlem başarısız (${r.status}).`); e.durum = r.status; throw e; }
  return j;
}

export const adGecerli = (a) =>
  a.length >= 1 && a.length <= 200 && !/[\/\\\u0000-\u001f\u007f]/.test(a) && a !== "." && a !== "..";

/** Dosya kategorisi (filtre ve ikon için). */
export function kategori(s) {
  if (s.tur === "klasor") return "klasor";
  const m = (s.sifreli ? s.gercek_mime : s.mime) || "";
  if (m.startsWith("image/")) return "gorsel";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("audio/") || m.startsWith("video/")) return "medya";
  if (/zip|7z|gzip/.test(m)) return "arsiv";
  return "belge";
}
export const KATEGORI_IKON = { klasor: "📁", gorsel: "🖼️", pdf: "📕", medya: "🎞️", arsiv: "🗜️", belge: "📄" };
