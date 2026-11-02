/*
 * assets/js/core/r2-bloklar.js — Supabase'te yayınlanan yazılar ve önizleme sayfası için R2 medya blokları (tur 18).
 * Bu sayfaların markdown dönüştürücüsü TÜM HTML'i kaçırır (güvenlik); bu yüzden editörün ürettiği <figure data-r2…> ve <div data-r2…> blokları
 * ham metin olarak görünüyordu. Burada bu iki biçim ve ![alt](/m/…) ŞEMA DOĞRULAMALI olarak ayıklanır; hiçbir ham HTML geçirilmez:
 * yalnızca izinli öznitelikler (yol, tür, sınıf anahtar sözcükleri, sayısal seçenekler) okunur ve KENDİMİZ yeniden üretilir.
 * Üretilen bloklar assets/js/r2-medya.js tarafından görsel / PDF okuyucu / oynatıcı / indirme kartına dönüştürülür.
 */
const YOL = /^[a-z0-9][a-z0-9-]{0,119}\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const TURLER = new Set(["gorsel", "pdf", "ses", "video", "dosya"]);
const KONUMLAR = new Set(["orta", "sol", "sag", "tam"]), BOYUTLAR = new Set(["25", "50", "75", "100"]);
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const kac = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const coz = (t) => String(t ?? "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const duzMetin = (t) => coz(String(t ?? "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().slice(0, 300);

function nitelikler(ham) {
  const o = {}; String(ham || "").replace(/([\w:-]+)\s*=\s*"([^"]*)"/g, (_t, ad, deger) => { o[ad.toLowerCase()] = coz(deger); return ""; }); return o;
}
function figur(nit, ic) {
  const yol = nit["data-r2"]; if (!YOL.test(yol || "")) return null;
  const sinif = String(nit.class || "").split(/\s+/);
  const konum = (sinif.find((c) => c.startsWith("r2-konum-")) || "").slice(9), boyut = (sinif.find((c) => /^r2-w\d+$/.test(c)) || "").slice(4);
  const alt = duzMetin((/alt\s*=\s*"([^"]*)"/i.exec(ic) || [])[1] || yol.split("/")[1]), baslik = duzMetin((/<figcaption>([\s\S]*?)<\/figcaption>/i.exec(ic) || [])[1] || "");
  return `<figure class="r2-fig r2-konum-${KONUMLAR.has(konum) ? konum : "orta"} r2-w${BOYUTLAR.has(boyut) ? boyut : "75"}" data-r2="${kac(yol)}" data-tur="gorsel"><img src="${GIF}" alt="${kac(alt)}">${baslik ? `<figcaption>${kac(baslik)}</figcaption>` : ""}</figure>`;
}
function kutu(nit) {
  const yol = nit["data-r2"]; if (!YOL.test(yol || "")) return null;
  const tur = TURLER.has(nit["data-tur"]) ? nit["data-tur"] : "dosya", baslik = duzMetin(nit["data-baslik"] || "");
  return `<div data-r2="${kac(yol)}" data-tur="${tur}"${tur === "pdf" ? ` data-gom="${nit["data-gom"] === "0" ? "0" : "1"}" data-yukseklik="${nit["data-yukseklik"] === "800" ? "800" : "600"}"` : ""}${baslik ? ` data-baslik="${kac(baslik)}"` : ""}></div>`;
}

/** md içindeki medya bloklarını yer tutucuya çevirir. Dönüş: { md, bloklar } — md'yi escape/dönüştürdükten sonra r2BloklariGeriKoy() ile yerleştir. */
export function r2BloklariAyikla(md) {
  const bloklar = [], yer = (html) => { bloklar.push(html); return `\n\n@@R2BLOK${bloklar.length - 1}@@\n\n`; };
  let m = String(md ?? "");
  m = m.replace(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi, (t, a, ic) => { const b = figur(nitelikler(a), ic); return b ? yer(b) : t; });
  m = m.replace(/<div\b([^>]*)>\s*<\/div>/gi, (t, a) => { const b = kutu(nitelikler(a)); return b ? yer(b) : t; });
  m = m.replace(/!\[([^\]]*)\]\(\/m\/([^)\s]+)\)/g, (t, alt, yol) => { const b = figur({ "data-r2": yol, class: "r2-konum-orta r2-w75" }, `alt="${kac(alt)}"`); return b ? yer(b) : t; });
  return { md: m, bloklar };
}
export function r2BloklariGeriKoy(html, bloklar) {
  if (!bloklar?.length) return html;
  return html.replace(/<p>\s*@@R2BLOK(\d+)@@\s*<\/p>|@@R2BLOK(\d+)@@/g, (_t, a, b) => bloklar[Number(a ?? b)] ?? "");
}
/** [metin](/m/yazi/dosya) bağlantıları (çıktıda zaten kaçırılmış HTML üzerinde çalışır). */
export function r2BaglantilariCevir(html) {
  return html.replace(/\[([^\]]+?)\]\(\/m\/([a-z0-9][a-z0-9-]{0,119}\/[A-Za-z0-9][A-Za-z0-9._-]{0,150})\)/g, '<a href="/m/$2" class="r2-medya-baglanti">$1</a>');
}
