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
  if (/does not exist|42883|PGRST202|schema cache/i.test(m)) return "Gerekli migration (0074) henüz çalıştırılmamış.";
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

export const BILESENLER = [
  { id: "veritabani", ikon: "🗃️", ad: "Supabase Veritabanı", aciklama: "Tablolar JSON ve/veya SQL dump olarak. Yetki kapsamına göre filtrelenir." },
  { id: "r2", ikon: "☁️", ad: "R2 Arşiv Dosyaları", aciklama: "Kütüphane PDF'leri ve Dosya Yöneticisi belgeleri. Yönetici yalnızca kendi dosyalarını alır." },
  { id: "icerik_md", ikon: "📝", ad: "İçerik & Markdown (.md)", aciklama: "Deponun tüm .md yazıları, sayfaları ve araştırma içerikleri (klasör yapısıyla)." },
  { id: "notlar", ikon: "🗒️", ad: "Kişisel Notlar & Alıntılar", aciklama: "Yalnızca SENİN notların, alıntıların, kaynakların ve not ekleri (not metinleri uçtan uca şifreli kalır)." },
  { id: "github", ikon: "🐙", ad: "GitHub Kaynak Kodu (.zip)", aciklama: "Site deposunun güncel kodu, tek zip olarak." },
];
