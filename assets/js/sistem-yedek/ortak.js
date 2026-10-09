/*
 * assets/js/sistem-yedek/ortak.js — Sistem Yedekleme modülünün ortak yardımcıları.
 * innerHTML YOK, inline stil YOK (CSP): DOM yalnızca el() ile kurulur.
 */
import { supabase } from "../core/supabase-client.js";

// Worker adresi: Cloudflare > Workers & Pages > sistem-yedek-worker > adres (rehber § 4.10, adım 7).
export const SISTEM_YEDEK_WORKER_URL = "https://sistem-yedek-worker.aeymena.workers.dev";

// Kota referansları (Supabase ücretsiz plan 500 MB, Cloudflare R2 ücretsiz katman 10 GB).
// Asıl değerler veritabanından (sistem_depolama_durumu) gelir; bu sabitler yalnızca yedektir.
export const VARSAYILAN_DB_KOTA = 524288000;
export const VARSAYILAN_R2_KOTA = 10737418240;

export function el(etiket, ozellikler = {}, ...cocuklar) {
  const d = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellikler)) {
    if (v == null || v === false) continue;
    if (k === "class") d.className = v;
    else if (k === "text") d.textContent = v;
    else if (k.startsWith("on")) d.addEventListener(k.slice(2), v);
    else d.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuklar.flat()) if (c != null) d.append(c);
  return d;
}

export function bayt(n) {
  const x = Number(n) || 0;
  if (x < 1024) return `${x} B`;
  const birimler = ["KB", "MB", "GB", "TB"];
  let v = x / 1024;
  let i = 0;
  while (v >= 1024 && i < birimler.length - 1) { v /= 1024; i += 1; }
  return `${v.toLocaleString("tr-TR", { maximumFractionDigits: v >= 100 ? 0 : 1 })} ${birimler[i]}`;
}

export function tarihMetni(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

export const bugunDamga = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function hataMetni(h) {
  const m = h?.message || String(h || "");
  if (/does not exist|42883|PGRST202|schema cache/i.test(m)) return "Gerekli migration (0074 / 0075) henüz çalıştırılmamış.";
  return m;
}

export async function erisimJetonu() {
  const { data } = await supabase.auth.getSession();
  const t = data?.session?.access_token;
  if (!t) throw new Error("Oturum bulunamadı; yeniden giriş yap.");
  return t;
}

export async function workerFetch(yol, { sinyal } = {}) {
  const jeton = await erisimJetonu();
  return fetch(`${SISTEM_YEDEK_WORKER_URL}${yol}`, { headers: { Authorization: `Bearer ${jeton}` }, signal: sinyal });
}

/* ------------------------------ ikonlar (inline SVG, CSP uyumlu) ------------------------------ */

const IKON_YOLLARI = {
  indir: "M12 3v12|M8 11l4 4 4-4|M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2",
  cop: "M3 6h18|M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2|M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6|M10 11v6|M14 11v6",
  ara: "M11 19a8 8 0 100-16 8 8 0 000 16z|M21 21l-4.3-4.3",
  kapat: "M18 6L6 18|M6 6l12 12",
  yenile: "M21 12a9 9 0 11-3-6.7|M21 4v5h-5",
  tik: "M5 13l4 4L19 7",
  kisi: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8z",
  kisiler: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8z|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
  kalkan: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  uyari: "M12 9v4|M12 17h.01|M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  durdur: "M6 6h12v12H6z",
};

export function ikon(ad) {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", "18");
  s.setAttribute("height", "18");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.classList.add("sy-ikon");
  for (const d of (IKON_YOLLARI[ad] || "").split("|")) {
    if (!d) continue;
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}

/**
 * Tutarlı düğme: sy-btn + varyant (birincil | ikincil | tehlike | tehlike-hafif | hayalet) + isteğe bağlı ikon.
 * Tüm düğmeler en az 44px yüksekliğindedir (dokunma hedefi) ve koyu/açık temada okunur renkler taşır.
 */
export function dugme({ metin, ikonAdi, tur = "ikincil", kucuk = false, ...oz } = {}) {
  const b = el("button", { type: "button", ...oz, class: `sy-btn sy-btn--${tur}${kucuk ? " sy-btn--kucuk" : ""}${oz.class ? ` ${oz.class}` : ""}` });
  if (ikonAdi) b.append(ikon(ikonAdi));
  if (metin) b.append(el("span", { text: metin }));
  return b;
}

/**
 * window.confirm yerine uygulama içi onay penceresi (<dialog>). Tehlikeli işlemlerde kırmızı onay düğmesi.
 * <dialog> desteklenmiyorsa (çok eski tarayıcı) güvenli geri dönüş olarak window.confirm kullanılır.
 * @returns {Promise<boolean>}
 */
export function onayIste({ baslik, metin, tamam = "Onayla", vazgec = "Vazgeç", tehlike = false }) {
  if (typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") {
    return Promise.resolve(window.confirm(`${baslik}\n\n${metin}`));
  }
  return new Promise((coz) => {
    const d = document.createElement("dialog");
    d.className = "sy-dialog";
    const metinler = (Array.isArray(metin) ? metin : [metin]).filter(Boolean).map((m) => el("p", { text: m }));
    const iptal = dugme({ metin: vazgec, tur: "ikincil" });
    const onay = dugme({ metin: tamam, tur: tehlike ? "tehlike" : "birincil" });
    d.append(
      el("div", { class: "sy-dialog-govde" },
        el("h3", { text: baslik, class: "sy-dialog-baslik" }),
        ...metinler,
        el("div", { class: "sy-dialog-eylem" }, iptal, onay)
      )
    );
    let sonuc = false;
    iptal.addEventListener("click", () => d.close());
    onay.addEventListener("click", () => { sonuc = true; d.close(); });
    d.addEventListener("close", () => { d.remove(); coz(sonuc); });
    d.addEventListener("cancel", () => { sonuc = false; });
    document.body.append(d);
    d.showModal();
    iptal.focus();
  });
}

export const BILESENLER = [
  { id: "veritabani", ikon: "🗃️", ad: "Supabase Veritabanı", aciklama: "Tablolar JSON ve/veya SQL dump olarak. Yetki kapsamına göre filtrelenir." },
  { id: "r2", ikon: "☁️", ad: "R2 Arşiv Dosyaları", aciklama: "Kütüphane PDF'leri ve Dosya Yöneticisi belgeleri. Yönetici yalnızca kendi dosyalarını alır." },
  { id: "icerik_md", ikon: "📝", ad: "İçerik & Markdown (.md)", aciklama: "Deponun tüm .md yazıları, sayfaları ve araştırma içerikleri (klasör yapısıyla)." },
  { id: "notlar", ikon: "🗒️", ad: "Kişisel Notlar & Alıntılar", aciklama: "Yalnızca SENİN notların, alıntıların, kaynakların ve not ekleri (not metinleri uçtan uca şifreli kalır)." },
  { id: "github", ikon: "🐙", ad: "GitHub Kaynak Kodu (.zip)", aciklama: "Site deposunun güncel kodu, tek zip olarak." },
];
