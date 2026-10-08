/*
 * assets/js/akademik/motor.js — PDF okuyucu motorunun (PDF.js) ve pdf-lib'in CDN'den, SÜRÜM SABİTLİ yüklenmesi.
 *
 *  - Kod tabanına PDF.js gömülmez; resmi npm paketi (pdfjs-dist) jsDelivr'den, yedek olarak unpkg'den gelir.
 *  - Hangi sürümün kullanılacağını veritabanındaki tek satır belirler (akademik_okuyucu_ayarlari).
 *    Owner sürümü panelden değiştirir ("Okuyucu Motorunu Güncelle") → herkes bir sonraki açılışta yeni
 *    sürümü kullanır. Sürüm yüklenemezse sınanmış MOTOR_VARSAYILAN'a düşülür; okuyucu hiçbir zaman "bozuk" kalmaz.
 *  - CSP: sitenin script-src'si https: kaynaklara izin verir; Worker için ayrıca "worker-src 'self' blob:"
 *    gerekir (_layouts/default.html ve _headers'a eklendi). Eklenmemişse PDF.js ana iş parçacığında çalışır (yavaş ama çalışır).
 */
import { supabase, MOTOR_VARSAYILAN } from "./ortak.js";

const CDN_TABANLARI = [
  (s) => `https://cdn.jsdelivr.net/npm/pdfjs-dist@${s}`,
  (s) => `https://unpkg.com/pdfjs-dist@${s}`,
];
const PDFLIB_URL = (s) => `https://cdn.jsdelivr.net/npm/pdf-lib@${s}/dist/pdf-lib.min.js`;

let yuklemeSozu = null;

export async function motorAyarlari() {
  try {
    const { data, error } = await supabase.from("akademik_okuyucu_ayarlari").select("pdfjs_surum, pdflib_surum, updated_at").eq("id", 1).maybeSingle();
    if (!error && data) return { pdfjs: data.pdfjs_surum, pdflib: data.pdflib_surum, guncelleme: data.updated_at };
  } catch { /* varsayılan */ }
  return { ...MOTOR_VARSAYILAN, guncelleme: null };
}

function cssEkle(href) {
  if (document.querySelector(`link[data-ak-motor-css="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  l.dataset.akMotorCss = href;
  document.head.append(l);
}

function scriptYukle(src) {
  return new Promise((coz, red) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = coz;
    s.onerror = () => red(new Error(`Yüklenemedi: ${src}`));
    document.head.append(s);
  });
}

/** PDF.js 5.x'in "modern" derlemesi yeni JS özelliklerine (Uint8Array.toHex, Promise.try…) dayanır.
 *  Tarayıcıda yoksa aynı sürümün "legacy" derlemesi (çok-dolgulu, her tarayıcıda çalışan) kullanılır. */
export const MODERN_DERLEME_UYGUN = () =>
  typeof Uint8Array.prototype.toHex === "function" &&
  typeof Uint8Array.fromBase64 === "function" &&
  typeof Promise.try === "function" &&
  typeof Promise.withResolvers === "function";

async function pdfjsYukle(surum) {
  let sonHata;
  const dizin = MODERN_DERLEME_UYGUN() ? "" : "/legacy";
  for (const taban of CDN_TABANLARI.map((f) => f(surum))) {
    try {
      const pdfjsLib = await import(/* @vite-ignore */ `${taban}${dizin}/build/pdf.min.mjs`);
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${taban}${dizin}/build/pdf.worker.min.mjs`;
      globalThis.pdfjsLib = globalThis.pdfjsLib || pdfjsLib; // pdf_viewer.mjs bu global'i bekler
      const pdfjsViewer = await import(/* @vite-ignore */ `${taban}${dizin}/web/pdf_viewer.mjs`);
      cssEkle(`${taban}/web/pdf_viewer.css`);
      return { pdfjsLib, pdfjsViewer, taban, surum, legacy: !!dizin };
    } catch (h) {
      sonHata = h;
    }
  }
  throw sonHata || new Error("PDF.js yüklenemedi.");
}

async function pdfLibYukle(surum) {
  if (globalThis.PDFLib?.PDFDocument) return globalThis.PDFLib;
  await scriptYukle(PDFLIB_URL(surum));
  if (!globalThis.PDFLib?.PDFDocument) throw new Error("pdf-lib yüklenemedi.");
  return globalThis.PDFLib;
}

/** Motoru (bir kez) yükler. { pdfjsLib, pdfjsViewer, taban, surum, PDFLib } döner. */
export function motoruYukle() {
  if (!yuklemeSozu) {
    yuklemeSozu = (async () => {
      const ayar = await motorAyarlari();
      let pdfjs;
      try {
        pdfjs = await pdfjsYukle(ayar.pdfjs);
      } catch (e) {
        console.warn(`PDF.js ${ayar.pdfjs} yüklenemedi, varsayılana (${MOTOR_VARSAYILAN.pdfjs}) düşülüyor:`, e);
        pdfjs = await pdfjsYukle(MOTOR_VARSAYILAN.pdfjs);
      }
      // pdf-lib yalnızca kaydederken gerekir; ayrı, tembel yüklenir.
      return { ...pdfjs, pdflibSurumu: ayar.pdflib };
    })().catch((h) => { yuklemeSozu = null; throw h; });
  }
  return yuklemeSozu;
}

export async function pdfLibAl() {
  const m = await motoruYukle();
  try {
    return await pdfLibYukle(m.pdflibSurumu);
  } catch {
    return pdfLibYukle(MOTOR_VARSAYILAN.pdflib);
  }
}

/** Owner paneli için: yayımlanmış sürümler (yalnızca kararlı x.y.z, 4.0.0 ve üstü), yeniden eskiye. */
export async function yayimlananSurumler() {
  const r = await fetch("https://data.jsdelivr.com/v1/packages/npm/pdfjs-dist");
  if (!r.ok) throw new Error("Sürüm listesi alınamadı.");
  const j = await r.json();
  return (j.versions || [])
    .map((v) => (typeof v === "string" ? v : v.version))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v) && Number(v.split(".")[0]) >= 4)
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
    .slice(0, 25);
}

/** Bir sürümü AKTİF yapmadan, yalıtılmış olarak yüklemeyi dener (owner "Güncelle" demeden önce). */
export async function surumuDene(surum) {
  for (const taban of CDN_TABANLARI.map((f) => f(surum))) {
    try {
      const dizin = MODERN_DERLEME_UYGUN() ? "" : "/legacy";
      const m = await import(/* @vite-ignore */ `${taban}${dizin}/build/pdf.min.mjs`);
      if (typeof m.getDocument !== "function") throw new Error("getDocument yok");
      const w = await fetch(`${taban}${dizin}/build/pdf.worker.min.mjs`, { method: "GET", cache: "force-cache" });
      if (!w.ok) throw new Error("worker dosyası yok");
      return { ok: true, surum: m.version || surum, taban };
    } catch { /* sonraki CDN */ }
  }
  return { ok: false };
}

export async function surumuSabitle(pdfjs, pdflib = null) {
  const { error } = await supabase.rpc("owner_akademik_okuyucu_surumu_ayarla", { p_pdfjs: pdfjs, p_pdflib: pdflib });
  if (error) throw new Error(error.message);
}
