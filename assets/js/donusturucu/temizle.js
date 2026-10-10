/*
 * assets/js/donusturucu/temizle.js — HTML temizleme (XSS + gizlilik).
 * -----------------------------------------------------------------------
 *  KATMAN 1 (varsa): DOMPurify (pinli CDN sürümü, bkz. cdn.js).
 *  KATMAN 2 (HER ZAMAN): yerleşik katı İZİN LİSTESİ temizleyici — DOMPurify yüklenemese bile içerik asla
 *  "temizlenmeden" düzenleyiciye / önizlemeye girmez (başarısızlıkta güvenli yön: kapalı).
 *
 *  Politika:
 *   - Yalnızca düz belge etiketleri; script/style/iframe/object/embed/form/svg/math ATILIR, bilinmeyen sarmalayıcılar açılır.
 *   - Öznitelikler: href (http/https/mailto/tel/#), src (YALNIZCA data:image/*), alt, title, colspan, rowspan, align, start, lang, dir.
 *     style/class/id/on* hepsi silinir (CSP zaten inline stili engeller).
 *   - UZAK GÖRSELLER KALDIRILIR: render sırasında ağ isteği (IP/izleme sızıntısı) oluşmasın; alt metin kalır.
 *   - Çıktı kararlı olana dek (en çok 3 tur) yeniden temizlenir → mXSS (parse→serialize→parse) farklılıklarına karşı.
 * -----------------------------------------------------------------------
 */
import { kutuphaneYukle } from "./cdn.js";

const IZINLI_ETIKETLER = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "cite", "code", "col", "colgroup", "dd", "del", "div", "dl", "dt", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q",
  "s", "samp", "small", "span", "strike", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "var", "tt",
]);
// İçeriğiyle birlikte tamamen atılan etiketler
const ATILAN_ETIKETLER = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "textarea", "select", "option",
  "link", "meta", "base", "svg", "math", "canvas", "audio", "video", "source", "track", "noscript", "template", "title", "head", "dialog", "portal",
]);
const GORSEL_VERI = /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml)(;charset=[\w-]+)?;base64,[A-Za-z0-9+/=\s]+$/i;
const LINK_URI = /^(https?:|mailto:|tel:|#)/i;

function hizaGecerli(v) { return /^(left|right|center|justify)$/i.test(v) ? v.toLowerCase() : null; }

function nitelikSuz(kaynak, hedef) {
  const ad = kaynak.localName;
  const al = (n) => kaynak.getAttribute(n);
  for (const n of ["lang", "dir", "title"]) {
    const v = al(n);
    if (v != null && (n !== "dir" || /^(ltr|rtl|auto)$/i.test(v))) hedef.setAttribute(n, v.slice(0, 300));
  }
  if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "td", "th", "li", "blockquote"].includes(ad)) {
    const h = hizaGecerli(al("align") || "");
    if (h && h !== "left") hedef.setAttribute("align", h);
  }
  if (ad === "a") {
    const h = (al("href") || "").trim().replace(/[\u0000-\u001f\u007f\s]+/g, "");
    if (LINK_URI.test(h)) { hedef.setAttribute("href", h); hedef.setAttribute("rel", "noopener noreferrer nofollow"); }
  }
  if (ad === "td" || ad === "th") {
    for (const n of ["colspan", "rowspan"]) {
      const v = parseInt(al(n), 10);
      if (v > 1 && v <= 100) hedef.setAttribute(n, String(v));
    }
  }
  if (ad === "ol") {
    const s = parseInt(al("start"), 10);
    if (Number.isFinite(s) && s > 0 && s < 100000) hedef.setAttribute("start", String(s));
  }
  if (ad === "img") {
    const src = (al("src") || "").trim();
    if (GORSEL_VERI.test(src)) hedef.setAttribute("src", src.replace(/\s+/g, ""));
    hedef.setAttribute("alt", (al("alt") || "").slice(0, 500));
  }
}

function dolas(kaynakDugumleri, hedefKok, belge) {
  for (const k of kaynakDugumleri) {
    if (k.nodeType === 3) { hedefKok.append(belge.createTextNode(k.nodeValue)); continue; }
    if (k.nodeType !== 1) continue; // yorum, işlem yönergesi vb. atılır
    const ad = k.localName;
    if (ATILAN_ETIKETLER.has(ad)) continue;
    if (ad === "img") {
      const src = (k.getAttribute("src") || "").trim();
      if (!GORSEL_VERI.test(src)) {
        const alt = (k.getAttribute("alt") || "").trim();
        if (alt) hedefKok.append(belge.createTextNode(`[Görsel: ${alt}]`));
        continue;
      }
    }
    if (!IZINLI_ETIKETLER.has(ad)) { dolas(k.childNodes, hedefKok, belge); continue; } // sarmalayıcıyı aç
    const y = belge.createElement(ad);
    nitelikSuz(k, y);
    if (ad !== "img" && ad !== "br" && ad !== "hr" && ad !== "col") dolas(k.childNodes, y, belge);
    hedefKok.append(y);
  }
}

/** Yerleşik izin-listesi temizleyici (eşzamanlı, saf DOM). */
export function yerlesikTemizle(html) {
  let s = String(html ?? "");
  for (let tur = 0; tur < 3; tur++) {
    const kaynak = new DOMParser().parseFromString(`<!doctype html><body>${s}`, "text/html");
    const hedefBelge = document.implementation.createHTMLDocument("");
    dolas(kaynak.body.childNodes, hedefBelge.body, hedefBelge);
    const sonuc = hedefBelge.body.innerHTML;
    if (sonuc === s) break;
    s = sonuc;
  }
  return s;
}

let purifyDeneme = null;
async function purifyAl() {
  if (!purifyDeneme) purifyDeneme = kutuphaneYukle("dompurify").catch(() => null);
  return purifyDeneme;
}

/** Ana giriş: güvenli HTML metni döner (yalnızca gövde içeriği). */
export async function temizHtml(html) {
  let s = String(html ?? "");
  const P = await purifyAl();
  if (P && typeof P.sanitize === "function") {
    try {
      s = P.sanitize(s, {
        FORBID_TAGS: [...ATILAN_ETIKETLER],
        FORBID_ATTR: ["style", "class", "id", "srcset"],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|data:image\/|#)/i,
        ALLOW_DATA_ATTR: false,
      });
    } catch { /* yerleşik katman zaten çalışacak */ }
  }
  return yerlesikTemizle(s);
}

/** Düz metinden güvenli HTML: boş satırla ayrılan bloklar paragraf, tek satır sonları <br>. */
export function metinDenHtml(metin) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return String(metin ?? "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.replace(/^\n+|\n+$/g, "")).filter((b) => b.trim())
    .map((b) => `<p>${esc(b).replace(/\n/g, "<br>")}</p>`).join("\n");
}
