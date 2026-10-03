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

// SQL'deki public.tr_ara_normalize() ile AYNI mantık:
//   NFD'ye ayır -> birleştirici işaretleri at (ö->o, ş->s, ğ->g, ç->c, ü->u; Mac/NFD dosya adları da eşleşir)
//   -> İ / I / ı hepsi "i" -> küçük harf.  Böylece "ISIK", "ışık", "isik", "Işık" aynı şeydir.
function katla(ch) {
  return ch.normalize("NFD").replace(/\p{M}+/gu, "").replace(/[İIı]/g, "i").toLowerCase();
}
export function normalize(s) {
  let o = "";
  for (const ch of String(s ?? "")) o += katla(ch);
  return o;
}
/** normalize() + katlanmış her karakterin ORİJİNAL metindeki başlangıç indeksi (vurgulama için). */
function katlaIndeksli(s) {
  let n = "";
  const harita = [];
  let i = 0;
  for (const ch of s) {
    const k = katla(ch);
    for (let j = 0; j < k.length; j++) { n += k[j]; harita.push(i); }
    i += ch.length;
  }
  return { n, harita };
}

/** Türkçe alfabe sırası (a b c ç d e f g ğ h ı i j k l m n o ö p r s ş t u ü v y z), "dosya2" < "dosya10". */
export const trSirala = new Intl.Collator("tr", { sensitivity: "variant", numeric: true });

export function aramaKelimeleri(q) {
  return normalize(q.trim()).split(/\s+/).filter(Boolean);
}

/** Arama eşleşmelerini <mark> ile vurgulayarak `hedef` içine yazar (Türkçe harf / NFD farkı gözetmeden). */
export function vurgulu(hedef, metin, kelimeler) {
  hedef.replaceChildren();
  if (!kelimeler?.length) { hedef.textContent = metin; return; }
  const { n, harita } = katlaIndeksli(metin);
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
    const bas = harita[a];
    let bit = harita[b - 1] + 1;
    while (bit < metin.length && /\p{M}/u.test(metin[bit])) bit++;     // sonda kalan birleştirici işaretleri de kapsa
    if (bas > imlec) hedef.appendChild(document.createTextNode(metin.slice(imlec, bas)));
    hedef.appendChild(el("mark", "ra-vurgu", metin.slice(bas, bit)));
    imlec = bit;
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

/* ---------------------------- tarih / zaman gösterimi ---------------------------- */
const GUN_MS = 86400000;
const gunBasi = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** { goreli: "3 sa önce" | "Dün 14:20" | "03 Eki 2026", tam: "3 Ekim 2026 Cumartesi 14:20" } */
export function zamanYaz(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { goreli: "", tam: "" };
  const saat = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const tam = d.toLocaleString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long", hour: "2-digit", minute: "2-digit" });
  const simdi = new Date();
  const fark = simdi.getTime() - d.getTime();
  const gunFarki = Math.round((gunBasi(simdi) - gunBasi(d)) / GUN_MS);
  let goreli;
  if (fark < 60000) goreli = "az önce";
  else if (fark < 3600000) goreli = `${Math.floor(fark / 60000)} dk önce`;
  else if (gunFarki === 0) goreli = `${Math.floor(fark / 3600000)} sa önce`;
  else if (gunFarki === 1) goreli = `Dün ${saat}`;
  else if (gunFarki < 7) goreli = `${d.toLocaleDateString("tr-TR", { weekday: "long" })} ${saat}`;
  else goreli = d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
  return { goreli, tam };
}

/** Listeleri bölümlemek için: "Bugün" | "Dün" | "Bu hafta" | "Eylül 2026" */
export function gunGrubu(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Tarihsiz";
  const gunFarki = Math.round((gunBasi(new Date()) - gunBasi(d)) / GUN_MS);
  if (gunFarki <= 0) return "Bugün";
  if (gunFarki === 1) return "Dün";
  if (gunFarki < 7) return "Bu hafta";
  return d.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
}
