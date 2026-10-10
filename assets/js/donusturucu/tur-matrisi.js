/*
 * assets/js/donusturucu/tur-matrisi.js — Dosya türü tanıma + "Akıllı Format Eşleme".
 * Saf mantık (DOM yok): yüklenen dosyanın türüne göre hedef formatlar mantıksal olarak filtrelenir.
 */
import { uzantiAl } from "./ortak.js";

/** aile: belge | pdf | gorsel | veri.  cikis:false → yalnızca girdi olarak desteklenir. */
export const FORMATLAR = {
  pdf: { ad: "PDF", aile: "pdf", mime: "application/pdf", uzanti: "pdf" },
  docx: { ad: "Word (.docx)", aile: "belge", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", uzanti: "docx" },
  html: { ad: "HTML", aile: "belge", mime: "text/html", uzanti: "html" },
  md: { ad: "Markdown", aile: "belge", mime: "text/markdown", uzanti: "md" },
  txt: { ad: "Düz metin", aile: "belge", mime: "text/plain", uzanti: "txt" },
  epub: { ad: "EPUB", aile: "belge", mime: "application/epub+zip", uzanti: "epub" },
  jpg: { ad: "JPG", aile: "gorsel", mime: "image/jpeg", uzanti: "jpg" },
  png: { ad: "PNG", aile: "gorsel", mime: "image/png", uzanti: "png" },
  webp: { ad: "WebP", aile: "gorsel", mime: "image/webp", uzanti: "webp" },
  avif: { ad: "AVIF", aile: "gorsel", mime: "image/avif", uzanti: "avif" },
  bmp: { ad: "BMP", aile: "gorsel", mime: "image/bmp", uzanti: "bmp" },
  ico: { ad: "ICO (simge)", aile: "gorsel", mime: "image/x-icon", uzanti: "ico" },
  svg: { ad: "SVG", aile: "gorsel", mime: "image/svg+xml", uzanti: "svg" },
  gif: { ad: "GIF", aile: "gorsel", mime: "image/gif", uzanti: "gif", cikis: false },
  heic: { ad: "HEIC/HEIF", aile: "gorsel", mime: "image/heic", uzanti: "heic", cikis: false },
  csv: { ad: "CSV", aile: "veri", mime: "text/csv", uzanti: "csv" },
  json: { ad: "JSON", aile: "veri", mime: "application/json", uzanti: "json" },
  xml: { ad: "XML", aile: "veri", mime: "application/xml", uzanti: "xml" },
};

const UZANTI_HARITASI = {
  pdf: "pdf", docx: "docx", html: "html", htm: "html", xhtml: "html", md: "md", markdown: "md", mdown: "md",
  txt: "txt", text: "txt", log: "txt", epub: "epub",
  jpg: "jpg", jpeg: "jpg", jpe: "jpg", jfif: "jpg", png: "png", webp: "webp", avif: "avif", bmp: "bmp",
  ico: "ico", cur: "ico", svg: "svg", gif: "gif", heic: "heic", heif: "heic",
  csv: "csv", tsv: "csv", json: "json", xml: "xml",
};

/** Kod/yapılandırma dosyaları → düz metin düzenleyicide açılır (türü "txt" sayılır, dil ipucu korunur). */
const KOD_UZANTILARI = new Set([
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "less", "py", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "rb",
  "php", "sh", "bash", "zsh", "ps1", "sql", "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "tex", "rtf", "srt", "vtt", "gitignore",
]);

const MIME_HARITASI = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/html": "html", "application/xhtml+xml": "html", "text/markdown": "md", "text/plain": "txt",
  "application/epub+zip": "epub", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif",
  "image/bmp": "bmp", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/svg+xml": "svg", "image/gif": "gif",
  "image/heic": "heic", "image/heif": "heic", "text/csv": "csv", "application/json": "json", "application/xml": "xml", "text/xml": "xml",
};

/** @returns {{tur:string|null, uzanti:string, kod:boolean}} */
export function turBul(dosya) {
  const uzanti = uzantiAl(dosya?.name);
  if (UZANTI_HARITASI[uzanti]) return { tur: UZANTI_HARITASI[uzanti], uzanti, kod: false };
  if (KOD_UZANTILARI.has(uzanti)) return { tur: "txt", uzanti, kod: true };
  const m = MIME_HARITASI[String(dosya?.type || "").toLowerCase().split(";")[0]];
  if (m) return { tur: m, uzanti, kod: false };
  return { tur: null, uzanti, kod: false };
}

const BELGE_HEDEFLERI = ["pdf", "docx", "md", "html", "txt", "epub"];
const GORSEL_HEDEFLERI = ["jpg", "png", "webp", "avif", "bmp", "ico", "svg", "pdf"];

/** Tek dosya için hedef formatlar (kendisi hariç). Çalışma zamanı yetenek süzgeci arayüzde uygulanır. */
export function hedefler(tur) {
  const f = FORMATLAR[tur];
  if (!f) return [];
  if (tur === "pdf") return ["docx", "md", "html", "txt", "epub", "png", "jpg", "webp"];
  if (f.aile === "belge") return BELGE_HEDEFLERI.filter((x) => x !== tur);
  if (f.aile === "gorsel") return GORSEL_HEDEFLERI.filter((x) => x !== tur);
  if (tur === "csv") return ["json", "xml"];
  if (tur === "json") return ["csv", "xml"];
  if (tur === "xml") return ["json", "csv"];
  return [];
}

/** "Aç ve Düzenle" hangi düzenleyiciyi kullanır? */
export function duzenleyiciTuru(tur) {
  if (tur === "pdf") return "pdf";
  if (["docx", "html", "epub"].includes(tur)) return "zengin";
  if (["md", "txt", "csv", "json", "xml"].includes(tur)) return "metin";
  return null;
}

/** Vurgulama dili ipucu (metin düzenleyici). */
export function vurguDili(tur, uzanti) {
  if (tur === "md") return "md";
  if (tur === "json") return "json";
  if (tur === "xml" || tur === "html") return "xml";
  if (tur === "csv") return "csv";
  if (["yml", "yaml", "toml", "ini", "cfg", "conf", "env"].includes(uzanti)) return "yaml";
  if (["py"].includes(uzanti)) return "py";
  if (["css", "scss", "less"].includes(uzanti)) return "css";
  if (["sh", "bash", "zsh", "ps1"].includes(uzanti)) return "sh";
  if (["sql"].includes(uzanti)) return "sql";
  if (KOD_UZANTILARI.has(uzanti)) return "kod";
  return "duz";
}

/**
 * Çoklu dosya: hepsi aynı aileden olmalı. Dönüş: { uygun, tur?, hedefler, birlestir:boolean, mesaj? }
 * birlestir: görsellerden tek PDF / PDF'leri tek PDF'te birleştirme seçeneği sunulur.
 */
export function cokluDegerlendir(turler) {
  const farkli = [...new Set(turler)];
  if (turler.some((t) => !t)) return { uygun: false, mesaj: "Desteklenmeyen bir dosya türü var." };
  const aileler = [...new Set(farkli.map((t) => FORMATLAR[t].aile))];
  if (aileler.length !== 1) return { uygun: false, mesaj: "Birden çok dosya seçtiysen hepsi aynı aileden olmalı (hepsi görsel, hepsi PDF, hepsi belge ya da hepsi veri)." };
  const aile = aileler[0];
  if (aile === "gorsel") {
    const ortak = GORSEL_HEDEFLERI.filter((h) => farkli.every((t) => t !== h));
    return { uygun: true, aile, hedefler: ortak, birlestir: true, birlestirHedef: "pdf" };
  }
  if (aile === "pdf") return { uygun: true, aile, hedefler: ["pdf-birlestir", ...hedefler("pdf")], birlestir: true, birlestirHedef: "pdf-birlestir" };
  if (aile === "belge") {
    const ortak = BELGE_HEDEFLERI.filter((h) => farkli.every((t) => t !== h));
    return { uygun: true, aile, hedefler: ortak, birlestir: false };
  }
  const ortak = farkli.length === 1 ? hedefler(farkli[0]) : [];
  return { uygun: ortak.length > 0, aile, hedefler: ortak, birlestir: false, mesaj: ortak.length ? undefined : "Veri dosyaları için aynı türde dosyalar seç." };
}
