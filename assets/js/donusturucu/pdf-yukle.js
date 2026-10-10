/*
 * assets/js/donusturucu/pdf-yukle.js — PDF.js + pdf-lib yükleyici.
 * Önce mevcut Akademik Kütüphane motoru (akademik/motor.js: sürüm sabitli, owner panelinden güncellenebilir,
 * modern/legacy derleme seçimi, iki CDN) yeniden kullanılır; o modül yoksa/çalışmazsa aynı sürümlerle yerel yedek yükleyici devreye girer.
 * Test/özel dağıtım: globalThis.__DN_PDF__ = { pdfjsLib, PDFLib } verilirse doğrudan kullanılır.
 */
const VARSAYILAN = { pdfjs: "5.6.205", pdflib: "1.17.1" };
const CDNLER = [
  (p, s, d) => `https://cdn.jsdelivr.net/npm/${p}@${s}/${d}`,
  (p, s, d) => `https://unpkg.com/${p}@${s}/${d}`,
];
const cdnler = () => (globalThis.__DN_CDN__ ? [globalThis.__DN_CDN__, ...CDNLER] : CDNLER);

let sozPdfjs = null;
let sozPdflib = null;

function scriptYukle(src) {
  return new Promise((coz, red) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.referrerPolicy = "no-referrer";
    s.onload = () => { s.remove(); coz(); };
    s.onerror = () => { s.remove(); red(new Error(`Yüklenemedi: ${src}`)); };
    document.head.append(s);
  });
}

async function yedekPdfjs() {
  const legacy = !(typeof Uint8Array.prototype.toHex === "function" && typeof Promise.try === "function" && typeof Promise.withResolvers === "function" && typeof Map.prototype.getOrInsertComputed === "function");
  const dizin = legacy ? "legacy/" : "";
  let son;
  for (const f of cdnler()) {
    try {
      const m = await import(/* @vite-ignore */ f("pdfjs-dist", VARSAYILAN.pdfjs, `${dizin}build/pdf.min.mjs`));
      m.GlobalWorkerOptions.workerSrc = f("pdfjs-dist", VARSAYILAN.pdfjs, `${dizin}build/pdf.worker.min.mjs`);
      globalThis.pdfjsLib = globalThis.pdfjsLib || m;
      return m;
    } catch (h) { son = h; }
  }
  throw son || new Error("PDF.js yüklenemedi.");
}

export function pdfjsAl() {
  if (globalThis.__DN_PDF__?.pdfjsLib) return Promise.resolve(globalThis.__DN_PDF__.pdfjsLib);
  if (!sozPdfjs) {
    sozPdfjs = (async () => {
      try {
        const { motoruYukle } = await import("../akademik/motor.js");
        return (await motoruYukle()).pdfjsLib;
      } catch { return yedekPdfjs(); }
    })().catch((h) => { sozPdfjs = null; throw h; });
  }
  return sozPdfjs;
}

export function pdfLibAl() {
  if (globalThis.__DN_PDF__?.PDFLib) return Promise.resolve(globalThis.__DN_PDF__.PDFLib);
  if (globalThis.PDFLib?.PDFDocument) return Promise.resolve(globalThis.PDFLib);
  if (!sozPdflib) {
    sozPdflib = (async () => {
      try {
        const { pdfLibAl: al } = await import("../akademik/motor.js");
        return await al();
      } catch {
        let son;
        for (const f of cdnler()) {
          try {
            await scriptYukle(f("pdf-lib", VARSAYILAN.pdflib, "dist/pdf-lib.min.js"));
            if (globalThis.PDFLib?.PDFDocument) return globalThis.PDFLib;
          } catch (h) { son = h; }
        }
        throw son || new Error("pdf-lib yüklenemedi.");
      }
    })().catch((h) => { sozPdflib = null; throw h; });
  }
  return sozPdflib;
}
