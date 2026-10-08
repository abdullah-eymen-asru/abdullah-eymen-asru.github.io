/*
 * assets/js/akademik/kunye.js — DOI / ISBN / URL'den otomatik künye.
 *   DOI   → Crossref (api.crossref.org)
 *   ISBN  → Open Library, olmazsa Google Books
 *   arXiv → arXiv API
 *   URL   → içinde DOI/arXiv varsa onlar; yoksa Worker'ın /meta uç noktası (citation_* meta etiketleri)
 * Hepsi açık/anahtarsız API'lerdir. Dönüş: veritabanı satırı biçiminde "taslak".
 */
import { yazarMetniAyristir } from "./atif.js";
import { workerJson } from "./ortak.js";

const DOI_DESENI = /10\.\d{4,9}\/[^\s"'<>]+/i;

export function doiTemizle(ham) {
  let d = String(ham || "");
  try { d = decodeURIComponent(d); } catch { /* olduğu gibi */ }
  const m = DOI_DESENI.exec(d);
  if (!m) return "";
  return m[0].replace(/[.,;:)\]}]+$/, "").replace(/\.pdf$/i, "").replace(/[?#].*$/, "");
}

export function isbnGecerli(ham) {
  const s = String(ham || "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(s)) {
    let t = 0;
    for (let i = 0; i < 12; i++) t += Number(s[i]) * (i % 2 ? 3 : 1);
    return (10 - (t % 10)) % 10 === Number(s[12]);
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    let t = 0;
    for (let i = 0; i < 9; i++) t += Number(s[i]) * (10 - i);
    t += s[9] === "X" ? 10 : Number(s[9]);
    return t % 11 === 0;
  }
  return false;
}

export function girdiyiTanimla(girdi) {
  const s = String(girdi || "").trim();
  if (!s) return { tur: null };
  if (/^[\d\s-]+[\dXx]?$/.test(s) && isbnGecerli(s)) return { tur: "isbn", deger: s.replace(/[\s-]/g, "").toUpperCase() };
  const doi = doiTemizle(s);
  if (doi) return { tur: "doi", deger: doi };
  const ax = /arxiv\.org\/(?:abs|pdf)\/([\w.\-/]+?)(?:v\d+)?(?:\.pdf)?$/i.exec(s) || /^arxiv:\s*([\w.\-/]+)/i.exec(s);
  if (ax) return { tur: "arxiv", deger: ax[1] };
  if (/^https?:\/\//i.test(s)) return { tur: "url", deger: s };
  return { tur: null };
}

const adCoz = (ad) => yazarMetniAyristir(ad)[0] || null;
const duzMetin = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function jsonGetir(url, zamanAsimiMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), zamanAsimiMs);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const CR_TUR = { "journal-article": "makale", "book": "kitap", "monograph": "kitap", "edited-book": "kitap", "reference-book": "kitap", "book-chapter": "kitap_bolumu", "proceedings-article": "bildiri", "dissertation": "tez", "report": "rapor", "posted-content": "makale", "peer-review": "diger" };

export async function crossrefKunyesi(doi) {
  let j;
  try {
    j = await jsonGetir(`https://api.crossref.org/works/${encodeURIComponent(doi).replace(/%2F/gi, "/")}`);
  } catch (e) {
    throw new Error(String(e.message) === "404" ? "Bu DOI Crossref'te bulunamadı." : "Crossref'e ulaşılamadı.");
  }
  const m = j.message || {};
  const tur = CR_TUR[m.type] || "diger";
  const yil = (m.issued?.["date-parts"]?.[0]?.[0]) || (m["published-print"]?.["date-parts"]?.[0]?.[0]) || (m["published-online"]?.["date-parts"]?.[0]?.[0]) || null;
  const baslik = [m.title?.[0], m.subtitle?.[0]].filter(Boolean).join(": ");
  const ek = {};
  if (m.volume) ek.cilt = String(m.volume);
  if (m.issue) ek.sayi = String(m.issue);
  if (m.page) ek.sayfa = String(m.page).replace(/\s*[-–—]+\s*/, "-");
  if (m["edition-number"]) ek.baski = String(m["edition-number"]);
  if (m["publisher-location"]) ek.sehir = m["publisher-location"];
  if (m.ISSN?.[0]) ek.issn = m.ISSN[0];
  if (m.language) ek.dil = m.language;
  const kapsayici = m["container-title"]?.[0] || "";
  if (tur === "kitap_bolumu") { ek.kitap_adi = kapsayici; ek.yayinevi = m.publisher || ""; }
  return {
    baslik,
    yazarlar: (m.author || []).map((a) => (a.name ? { kurum: a.name } : { adi: a.given || "", soyadi: a.family || "" })),
    yayin_yili: yil,
    dergi_veya_yayinevi: (tur === "makale" || tur === "bildiri" ? kapsayici : m.publisher) || kapsayici || null,
    doi: (m.DOI || doi).toLowerCase(),
    isbn: m.ISBN?.[0] ? m.ISBN[0].replace(/[^0-9Xx-]/g, "") : null,
    url: m.resource?.primary?.URL || m.URL || null,
    ozet: duzMetin(m.abstract) || null,
    etiketler: [],
    tur,
    ek_alanlar: ek,
  };
}

export async function isbnKunyesi(isbn) {
  try {
    const j = await jsonGetir(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const k = j[`ISBN:${isbn}`];
    if (k?.title) {
      const yil = /(\d{4})/.exec(k.publish_date || "");
      return {
        baslik: [k.title, k.subtitle].filter(Boolean).join(": "),
        yazarlar: (k.authors || []).map((a) => adCoz(a.name)).filter(Boolean),
        yayin_yili: yil ? Number(yil[1]) : null,
        dergi_veya_yayinevi: k.publishers?.[0]?.name || null,
        doi: null, isbn, url: k.url || null, ozet: null,
        etiketler: [], tur: "kitap",
        ek_alanlar: k.publish_places?.[0]?.name ? { sehir: k.publish_places[0].name } : {},
      };
    }
  } catch { /* Google Books'a düş */ }
  try {
    const j = await jsonGetir(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
    const v = j.items?.[0]?.volumeInfo;
    if (v?.title) {
      const yil = /(\d{4})/.exec(v.publishedDate || "");
      return {
        baslik: [v.title, v.subtitle].filter(Boolean).join(": "),
        yazarlar: (v.authors || []).map(adCoz).filter(Boolean),
        yayin_yili: yil ? Number(yil[1]) : null,
        dergi_veya_yayinevi: v.publisher || null,
        doi: null, isbn, url: v.infoLink || null, ozet: duzMetin(v.description) || null,
        etiketler: [], tur: "kitap", ek_alanlar: v.language ? { dil: v.language } : {},
      };
    }
  } catch { /* aşağıda hata */ }
  throw new Error("Bu ISBN için künye bulunamadı.");
}

export async function arxivKunyesi(id) {
  let xml;
  try {
    const r = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error("arxiv");
    xml = new DOMParser().parseFromString(await r.text(), "application/xml");
  } catch {
    throw new Error("arXiv'e ulaşılamadı.");
  }
  const e = xml.querySelector("entry");
  const baslik = e?.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim();
  if (!e || !baslik || /^error$/i.test(baslik)) throw new Error("arXiv kaydı bulunamadı.");
  const yil = /(\d{4})/.exec(e.querySelector("published")?.textContent || "");
  const doiEl = e.getElementsByTagName("arxiv:doi")[0]?.textContent?.trim();
  return {
    baslik,
    yazarlar: [...e.querySelectorAll("author > name")].map((n) => adCoz(n.textContent)).filter(Boolean),
    yayin_yili: yil ? Number(yil[1]) : null,
    dergi_veya_yayinevi: "arXiv",
    doi: doiEl && DOI_DESENI.test(doiEl) ? doiEl.toLowerCase() : `10.48550/arxiv.${id}`.toLowerCase(),
    isbn: null,
    url: `https://arxiv.org/abs/${id}`,
    ozet: e.querySelector("summary")?.textContent?.replace(/\s+/g, " ").trim() || null,
    etiketler: [], tur: "makale", ek_alanlar: {},
  };
}

async function sayfaKunyesi(url) {
  const j = await workerJson(`/meta?url=${encodeURIComponent(url)}`);
  const k = j.kunye || {};
  const doi = doiTemizle(k.doi);
  if (doi) {
    try {
      const cr = await crossrefKunyesi(doi);
      return { ...cr, url: cr.url || k.url };
    } catch { /* sayfa künyesiyle devam */ }
  }
  const ek = {};
  if (k.cilt) ek.cilt = k.cilt;
  if (k.sayi) ek.sayi = k.sayi;
  if (k.sayfa) ek.sayfa = k.sayfa;
  const dergili = !!k.dergi;
  return {
    baslik: k.baslik || url,
    yazarlar: (k.yazarlar || []).map(adCoz).filter(Boolean),
    yayin_yili: k.yil ? Number(k.yil) : null,
    dergi_veya_yayinevi: (dergili ? k.dergi : k.yayinevi || k.site) || null,
    doi: null,
    isbn: /^[0-9Xx-]{10,17}$/.test(k.isbn || "") ? k.isbn : null,
    url: k.url || url,
    ozet: k.ozet || null,
    etiketler: [],
    tur: dergili ? "makale" : "web",
    ek_alanlar: ek,
  };
}

/** Ana giriş: DOI / ISBN / arXiv / URL → { kunye, kaynak }. Hata durumunda Error fırlatır (Türkçe mesaj). */
export async function kunyeGetir(girdi) {
  const t = girdiyiTanimla(girdi);
  if (!t.tur) throw new Error("DOI, ISBN ya da http(s) bağlantısı gir.");
  if (t.tur === "doi") return { kunye: await crossrefKunyesi(t.deger), kaynak: "Crossref" };
  if (t.tur === "isbn") return { kunye: await isbnKunyesi(t.deger), kaynak: "Open Library / Google Books" };
  if (t.tur === "arxiv") return { kunye: await arxivKunyesi(t.deger), kaynak: "arXiv" };
  return { kunye: await sayfaKunyesi(t.deger), kaynak: "Sayfa meta etiketleri" };
}
