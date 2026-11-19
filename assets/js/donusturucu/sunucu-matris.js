/*
 * assets/js/donusturucu/sunucu-matris.js — "Sunucuda (LibreOffice)" yönteminin desteklediği dönüşümler. SAF mantık (DOM/ağ yok).
 * Bu tablo, Space'teki ytdlp-hf-space/app.py ve belge_donusturucu_worker/worker.js ile AYNI olmalı.
 */
export const SUNUCU_AILE = {
  yazi: ["doc", "docx", "odt", "rtf", "html", "txt"],
  tablo: ["xls", "xlsx", "ods", "csv"],
  sunum: ["ppt", "pptx", "odp"],
  pdf: ["pdf"],
};
const HEDEF = {
  yazi: ["pdf", "docx", "doc", "odt", "rtf", "txt", "html"],
  tablo: ["pdf", "xlsx", "xls", "ods", "csv", "html"],
  sunum: ["pdf", "pptx", "ppt", "odp"],
  pdf: ["docx", "odt", "rtf", "html", "pptx", "odp"],
};
export const sunucuAilesi = (tur) => Object.keys(SUNUCU_AILE).find((a) => SUNUCU_AILE[a].includes(tur)) || null;
/** Bu kaynak türü için sunucuda üretilebilecek hedefler (kendisi hariç). */
export const sunucuHedefleri = (tur) => { const a = sunucuAilesi(tur); return a ? HEDEF[a].filter((h) => h !== tur) : []; };
export const sunucuDestekler = (tur, hedef) => sunucuHedefleri(tur).includes(hedef);
/** Hepsi aynı aileden birden çok dosya için ortak hedefler. */
export function sunucuOrtakHedefler(turler) {
  const aileler = new Set(turler.map(sunucuAilesi));
  if (aileler.has(null) || aileler.size !== 1) return [];
  return turler.map(sunucuHedefleri).reduce((a, b) => a.filter((x) => b.includes(x)));
}
/** Kaba süre tahmini (sn): uyku/uyanma + dosya boyutu. */
export function sunucuTahminSn(bayt) { return Math.round(8 + (bayt / 1048576) * 3); }
export function yerelTahminSn(bayt, tur, hedef) {
  const mb = bayt / 1048576;
  if (tur === "pdf") return Math.round(4 + mb * 2.5);
  if (tur === "pptx" || tur === "ppt") return Math.round(5 + mb * 3);
  if (["png", "jpg", "webp"].includes(hedef)) return Math.round(3 + mb * 2);
  return Math.round(2 + mb * 1.2);
}
export const SUNUCU_UYKU_NOTU = "Ücretsiz sunucu uykudaysa ilk dönüştürme +30–60 sn sürebilir.";
