/*
 * assets/js/notlar/ice-aktar/ayristir.js
 * -----------------------------------------------------------------------
 * İçeri aktarma AYRIŞTIRICILARI: dosya → not taslağı. Ağ yok, kasa yok; yalnızca okur.
 * Desteklenen: Markdown (.md/.markdown, YAML başlık bilgisiyle), düz metin (.txt), JSON (.json),
 * Web sayfası (.html/.htm), Word (.docx), PDF (.pdf; bu uygulamanın PDF'i birebir, diğerleri düz metin), ZIP paketi (bu uygulamanın dışa aktardığı paket dahil).
 *
 * Tüm içerik bicim.js'in BEYAZ LİSTESİNDEN geçirilir (ham HTML hiçbir zaman olduğu gibi alınmaz).
 * Dönen taslak: {baslik, html, govde, etiketler[], klasorYolu[], kategori, durum, tarih,
 *                olusturma, alintilar[], kaynak, uyarilar[]}
 * -----------------------------------------------------------------------
 */
import * as Bicim from "../bicim.js";
import { zipOku } from "./zip-oku.js";

const UZANTI = { md: "md", markdown: "md", mdown: "md", txt: "txt", text: "txt", json: "json", html: "html", htm: "html", docx: "docx", pdf: "pdf", zip: "zip" };
export const KABUL_EDILEN = ".md,.markdown,.mdown,.txt,.text,.json,.html,.htm,.docx,.pdf,.zip";
const DOSYA_UST = 60 * 1024 * 1024;
const NOT_UST = 3000;
const BICIM_KLASORLERI = new Set(["markdown", "pdf", "word", "html", "metin"]);

const AYLAR = { ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12 };

/** Türkçe/aksan duyarsız anahtar: "Son güncelleme" → "son_guncelleme" */
const katla = (s) =>
  String(s ?? "")
    .toLocaleLowerCase("tr")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const ANAHTAR = {
  baslik: "baslik", title: "baslik", name: "baslik", ad: "baslik",
  klasor: "klasor", folder: "klasor", klasor_yolu: "klasor", klasoryolu: "klasor", path: "klasor",
  tur: "kategori", kategori: "kategori", type: "kategori", category: "kategori",
  durum: "durum", status: "durum",
  konu_tarihi: "tarih", tarih: "tarih", date: "tarih",
  etiketler: "etiketler", etiket: "etiketler", tags: "etiketler", tag: "etiketler",
  olusturma: "olusturma", created: "olusturma", created_at: "olusturma", olusturulma: "olusturma",
  guncelleme: "guncelleme", son_guncelleme: "guncelleme", updated: "guncelleme", updated_at: "guncelleme", modified: "guncelleme",
};

/* ---------- küçük yardımcılar ---------- */

const uzantiAl = (ad) => (/\.([a-z0-9]+)$/i.exec(ad) || [])[1]?.toLowerCase() || "";
const dosyaGovdesi = (ad) => String(ad).split("/").pop().replace(/\.[^.]+$/, "").replace(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_/, "").trim();

function tarihCoz(s) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(t);
  if (m) {
    const d = m[4] ? new Date(t.replace(" ", "T")) : new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(t);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 12), +(m[5] || 0));
  m = /^(\d{1,2})\s+(\p{L}+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/u.exec(t);
  if (m && AYLAR[katla(m[2])]) return new Date(+m[3], AYLAR[katla(m[2])] - 1, +m[1], +(m[4] || 12), +(m[5] || 0));
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}
const yerelGun = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const etiketListesi = (v) =>
  [...new Set((Array.isArray(v) ? v : String(v ?? "").split(/[,;]/)).map((e) => String(e).trim().replace(/^#/, "").replace(/\s+/g, " ")).filter(Boolean))].slice(0, 20);

const klasorParcalari = (v) =>
  (Array.isArray(v) ? v : String(v ?? "").split(/\s*[\/\\>]\s*/)).map((a) => String(a).trim().slice(0, 80)).filter(Boolean).slice(0, 8);

/** Ham meta ({anahtar: değer}) → tekdüze alanlar. */
function metaDuzelt(ham, ctx) {
  const m = {};
  for (const [k, v] of Object.entries(ham || {})) {
    const a = ANAHTAR[katla(k)];
    if (a && v != null && v !== "" && m[a] === undefined) m[a] = v;
  }
  const cikti = {};
  if (m.baslik) cikti.baslik = String(m.baslik).trim().slice(0, 200);
  if (m.klasor) cikti.klasorYolu = klasorParcalari(m.klasor);
  if (m.kategori) cikti.kategori = ctx.turBul(m.kategori);
  if (m.durum) cikti.durum = ctx.durumBul(m.durum);
  if (m.tarih) {
    const d = tarihCoz(m.tarih);
    if (d) cikti.tarih = yerelGun(d);
  }
  if (m.etiketler) cikti.etiketler = etiketListesi(m.etiketler);
  if (m.olusturma) {
    const d = tarihCoz(m.olusturma);
    if (d && d.getTime() <= Date.now() + 86400000) cikti.olusturma = d.toISOString();
  }
  return cikti;
}

/** DOM düğümü → beyaz listeden geçmiş HTML metni. */
const temizHtml = (dugum) => Bicim.duzenleyiciHtml(dugum);

function taslak(ad, parca, ctx) {
  const t = {
    baslik: "", html: "", govde: "", etiketler: [], klasorYolu: [], kategori: null, durum: null, tarih: "", olusturma: null,
    alintilar: [], kaynak: ad, uyarilar: [], ...parca,
  };
  if (!t.govde && t.html) t.govde = Bicim.htmlMarkdown(t.html);
  if (!t.baslik) t.baslik = dosyaGovdesi(ad).slice(0, 200);
  return t;
}

/* ---------- Markdown ---------- */

function yamlAyir(metin) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(metin);
  if (!m) return { meta: null, govde: metin };
  const meta = {};
  let sonAnahtar = null;
  for (const satir of m[1].split(/\r?\n/)) {
    const liste = /^\s+-\s+(.*)$/.exec(satir);
    if (liste && sonAnahtar) {
      meta[sonAnahtar] = [...(Array.isArray(meta[sonAnahtar]) ? meta[sonAnahtar] : []), degerCoz(liste[1])];
      continue;
    }
    const kv = /^([^:#\s][^:]*):\s*(.*)$/.exec(satir);
    if (!kv) continue;
    sonAnahtar = kv[1].trim();
    meta[sonAnahtar] = kv[2] === "" ? "" : degerCoz(kv[2]);
  }
  return { meta, govde: metin.slice(m[0].length) };
}
function degerCoz(v) {
  const s = String(v).trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
  }
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      /* düz metin */
    }
  }
  return s.replace(/^'(.*)'$/, "$1");
}

/** "## Kaynaklı alıntılar" bölümünü ayır ve alıntı nesnelerine çevir (dışa aktarılan biçimle simetrik). */
function alintiBolumuAyir(govde) {
  const m = /\n##\s+Kaynaklı alıntılar\s*\n([\s\S]*?)(?=\n##\s+|$)/.exec("\n" + govde);
  if (!m) return { govde, alintilar: [] };
  const alintilar = [];
  for (const parca of m[1].split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    if (parca.startsWith(">")) {
      const satirlar = parca.split("\n").map((s) => s.replace(/^>\s?/, ""));
      let kaynak = "";
      if (/^—\s/.test(satirlar[satirlar.length - 1])) kaynak = satirlar.pop().replace(/^—\s*/, "");
      if (!satirlar.join("").trim() && kaynak && alintilar.length && !alintilar[alintilar.length - 1].kaynak) alintilar[alintilar.length - 1].kaynak = kaynak;
      else alintilar.push({ alinti: satirlar.join("\n").trim(), kaynak, sayfa: "", yorum: "" });
    } else if (/^\*\*Yorumum:\*\*/.test(parca)) {
      const yorum = parca.replace(/^\*\*Yorumum:\*\*\s*/, "");
      if (alintilar.length && !alintilar[alintilar.length - 1].yorum) alintilar[alintilar.length - 1].yorum = yorum;
      else alintilar.push({ alinti: "", kaynak: "", sayfa: "", yorum });
    }
  }
  const bas = "\n" + govde;
  const kes = bas.indexOf(m[0]);
  const geri = (bas.slice(0, kes) + bas.slice(kes + m[0].length)).replace(/^\n/, "");
  return { govde: geri, alintilar };
}

/** Markdown → beyaz listeden geçmiş HTML (bicim.js markdownKur: iç içe liste, görev listesi, kaçışlar, ~~, <u>, <mark>). */
function markdownHtml(md) {
  const kap = document.createElement("div");
  Bicim.markdownKur(md, kap);
  return temizHtml(kap);
}

function markdownCoz(ad, metin, ctx) {
  const { meta, govde: g0 } = yamlAyir(metin.replace(/^\uFEFF/, ""));
  const m = metaDuzelt(meta, ctx);
  let govde = g0.trim();
  const baslikSatiri = /^#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(govde);
  if (baslikSatiri && (!m.baslik || katla(m.baslik) === katla(baslikSatiri[1]))) {
    m.baslik = m.baslik || baslikSatiri[1].trim().slice(0, 200);
    govde = govde.slice(baslikSatiri[0].length).trim();
  }
  const { govde: sade, alintilar } = alintiBolumuAyir(govde);
  const uyarilar = [];
  if (/!\[[^\]]*\]\((?!ek:)[^)]+\)/.test(sade)) uyarilar.push("Görsel başvuruları not içinde metin olarak kaldı (ekler şifreli depoya taşınmaz).");
  return taslak(ad, { ...m, govde: sade, html: markdownHtml(sade), alintilar, uyarilar }, ctx);
}

/* ---------- düz metin ---------- */

const KUNYE_ANAHTARLARI = new Set(["klasor", "tur", "durum", "konu_tarihi", "etiketler", "olusturma", "son_guncelleme"]);

const MD_KACIS = (t) => t.replace(/\\/g, "\\\\").replace(/([*_`~])/g, "\\$1").replace(/</g, "&lt;");

/**
 * Düz metin → HTML. Bu uygulamanın düz metin dışa aktarımıyla simetriktir: "## / ###" başlık, "•", "1.", "[ ]/[x]"
 * liste (4 boşluk = bir alt düzey), "  | " alıntı, "----" ayraç. Başka metinlerdeki *, _ gibi işaretler biçim sayılmaz.
 */
function metinHtml(metin) {
  const md = [];
  for (const ham of metin.replace(/\r\n?/g, "\n").split("\n")) {
    const satir = ham.replace(/\s+$/, "");
    let m;
    if (!satir.trim()) md.push("");
    else if ((m = /^(\s*)\[( |x|X)\]\s+(.*)$/.exec(satir))) md.push(`${m[1]}- ${m[2] === " " ? "☐" : "☑"} ${MD_KACIS(m[3])}`);
    else if ((m = /^(\s*)(?:•|[-*])\s+(.*)$/.exec(satir))) md.push(`${m[1]}- ${MD_KACIS(m[2])}`);
    else if ((m = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(satir))) md.push(`${m[1]}${m[2]}. ${MD_KACIS(m[3])}`);
    else if ((m = /^\s*\|\s?(.*)$/.exec(satir))) md.push(`> ${MD_KACIS(m[1])}`);
    else if ((m = /^(#{1,3})\s+(.*)$/.exec(satir))) md.push(`${m[1].length === 1 ? "##" : m[1]} ${MD_KACIS(m[2])}`);
    else if (/^\s*-{3,}\s*$/.test(satir)) md.push("---");
    else md.push(MD_KACIS(satir.trim()));
  }
  return markdownHtml(md.join("\n"));
}

function metinCoz(ad, metin, ctx) {
  const satirlar = metin.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < satirlar.length && !satirlar[i].trim()) i++;
  const meta = {};
  let baslik = "";
  // Bu uygulamanın düz metin biçimi: başlık + "====" + "Anahtar: değer" satırları
  if (satirlar[i + 1] && /^={3,}$/.test(satirlar[i + 1].trim())) {
    baslik = satirlar[i].trim();
    i += 2;
    while (i < satirlar.length) {
      const kv = /^([^:]{2,20}):\s*(.*)$/.exec(satirlar[i]);
      if (!kv || !KUNYE_ANAHTARLARI.has(katla(kv[1]))) break;
      meta[kv[1]] = kv[2];
      i++;
    }
  }
  let icerik = satirlar.slice(i).join("\n").trim();
  const alintilar = [];
  const kb = /(?:^|\n)KAYNAKLI ALINTILAR\s*\n([\s\S]*)$/.exec(icerik);
  if (kb) {
    icerik = icerik.slice(0, kb.index).trim();
    for (const parca of kb[1].split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)) {
      const a = { alinti: "", kaynak: "", sayfa: "", yorum: "" };
      for (const sat of parca.split("\n")) {
        const t = sat.trim();
        if (t.startsWith("|")) a.alinti += (a.alinti ? "\n" : "") + t.replace(/^\|\s?/, "");
        else if (t.startsWith("—")) a.kaynak = t.replace(/^—\s*/, "");
        else if (/^Yorumum:/.test(t)) a.yorum = t.replace(/^Yorumum:\s*/, "");
      }
      if (a.alinti || a.yorum) alintilar.push(a);
    }
  }
  const m = metaDuzelt({ ...meta, ...(baslik ? { baslik } : {}) }, ctx);
  return taslak(ad, { ...m, html: metinHtml(icerik), govde: "", alintilar }, ctx);
}

/* ---------- JSON ---------- */

function jsonNotlari(ad, veri, ctx) {
  const dizi = Array.isArray(veri) ? veri : Array.isArray(veri?.notlar) ? veri.notlar : Array.isArray(veri?.notes) ? veri.notes : [veri];
  const cikti = [];
  for (const o of dizi) {
    if (!o || typeof o !== "object") continue;
    const m = metaDuzelt(o, ctx);
    const alan = (...adlar) => {
      for (const a of adlar) if (typeof o[a] === "string" && o[a].trim()) return o[a];
      return "";
    };
    const html = alan("html");
    const md = alan("govde", "icerik", "içerik", "content", "body", "markdown", "text", "metin");
    let htmlSon = "";
    if (html) {
      const kap = document.createElement("div");
      Bicim.htmlKur(html, kap);
      htmlSon = temizHtml(kap);
    } else if (md) htmlSon = /^\s*(#|[-*]\s|\d+\.\s|>)/m.test(md) ? markdownHtml(md) : metinHtml(md);
    const alintilar = Array.isArray(o.alintilar)
      ? o.alintilar.map((a) => ({ alinti: String(a?.alinti || ""), kaynak: String(a?.kaynak || ""), sayfa: String(a?.sayfa || ""), yorum: String(a?.yorum || "") })).filter((a) => a.alinti || a.yorum)
      : [];
    cikti.push(taslak(ad, { ...m, html: htmlSon, govde: html ? "" : md, alintilar }, ctx));
  }
  return cikti;
}

/* ---------- HTML ---------- */

function alintilariHtmldenCikar(belge) {
  const baslik = [...belge.querySelectorAll("h1,h2,h3")].find((h) => /^Kaynaklı alıntılar$/i.test(h.textContent.trim()));
  if (!baslik) return [];
  const alintilar = [];
  let s = baslik.nextElementSibling;
  const kaldir = [baslik];
  while (s) {
    const sonraki = s.nextElementSibling;
    if (/^H[1-3]$/.test(s.tagName)) break;
    if (s.localName === "blockquote") {
      const foot = s.querySelector("footer");
      const kaynak = foot ? foot.textContent.replace(/^\s*—\s*/, "").trim() : "";
      foot?.remove();
      alintilar.push({ alinti: [...s.querySelectorAll("p")].map((p) => p.textContent.trim()).join("\n\n") || s.textContent.trim(), kaynak, sayfa: "", yorum: "" });
    } else if (/^Yorumum:/.test(s.textContent.trim())) {
      const yorum = s.textContent.replace(/^\s*Yorumum:\s*/, "").trim();
      if (alintilar.length && !alintilar[alintilar.length - 1].yorum) alintilar[alintilar.length - 1].yorum = yorum;
      else alintilar.push({ alinti: "", kaynak: "", sayfa: "", yorum });
    }
    kaldir.push(s);
    s = sonraki;
  }
  kaldir.forEach((d) => d.remove());
  return alintilar;
}

function htmlCoz(ad, metin, ctx) {
  const belge = new DOMParser().parseFromString(metin, "text/html");
  const meta = {};
  const dl = belge.querySelector("dl.k");
  if (dl) {
    for (const dt of dl.querySelectorAll("dt")) meta[dt.textContent.trim()] = dt.nextElementSibling?.textContent.trim() || "";
    dl.remove();
  }
  for (const mt of belge.querySelectorAll('meta[name="created"],meta[name="modified"]')) meta[mt.getAttribute("name") === "created" ? "olusturma" : "guncelleme"] ??= mt.getAttribute("content");
  const m = metaDuzelt(meta, ctx);
  const alintilar = alintilariHtmldenCikar(belge.body); // "Kaynaklı alıntılar" <article> dışında durabilir
  for (const ul of belge.querySelectorAll("ul.g")) ul.className = "nt-gorev";
  const kok = belge.querySelector("article") || belge.querySelector("main") || belge.body;
  let baslik = m.baslik;
  const h1 = kok.querySelector("h1");
  if (!baslik) baslik = (h1?.textContent || belge.title || "").trim().slice(0, 200);
  if (h1 && h1.textContent.trim() === baslik) h1.remove();
  const sayac = kok.querySelectorAll("img").length;
  const kap = document.createElement("div");
  Bicim.htmlKur(kok.innerHTML, kap);
  const uyarilar = sayac ? [`${sayac} görsel alınmadı (ekler şifreli depoya taşınmaz).`] : [];
  return taslak(ad, { ...m, baslik, html: temizHtml(kap), alintilar, uyarilar }, ctx);
}

/* ---------- Word (.docx) ---------- */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

async function docxCoz(ad, bayt, ctx) {
  const z = await zipOku(bayt);
  const g = z.girisler.find((e) => e.ad === "word/document.xml");
  if (!g) throw new Error("Word belgesi okunamadı (document.xml yok).");
  const xml = new DOMParser().parseFromString(await z.metin(g), "application/xml");
  const govde = xml.getElementsByTagNameNS(W, "body")[0];
  if (!govde) throw new Error("Word belgesi boş görünüyor.");

  const kap = document.createElement("div");
  const meta = {};
  let baslik = "";
  const yigin = []; // iç içe listeler (düzey -> <ul|ol>)
  let alintiModu = false;
  const alintilar = [];
  let gorselSayisi = 0;
  const durum = { kunyeBitti: false };

  const bayrak = (r, ad) => {
    const e = r.getElementsByTagNameNS(W, ad)[0];
    return !!e && !["0", "false", "none"].includes(e.getAttributeNS(W, "val") || "");
  };
  const satirIci = (p, hedef) => {
    for (const r of p.getElementsByTagNameNS(W, "r")) {
      const kur = (ic) => {
        let ust = ic;
        if (bayrak(r, "highlight")) ust = ((x) => (x.append(ust), x))(document.createElement("mark"));
        if (bayrak(r, "strike")) ust = ((x) => (x.append(ust), x))(document.createElement("s"));
        if (bayrak(r, "u")) ust = ((x) => (x.append(ust), x))(document.createElement("u"));
        if (bayrak(r, "i")) ust = ((x) => (x.append(ust), x))(document.createElement("em"));
        if (bayrak(r, "b")) ust = ((x) => (x.append(ust), x))(document.createElement("strong"));
        return ust;
      };
      let tampon = "";
      const bosalt = () => {
        if (tampon) {
          hedef.append(kur(document.createTextNode(tampon)));
          tampon = "";
        }
      };
      for (const c of r.children) {
        if (c.localName === "t") tampon += c.textContent;
        else if (c.localName === "tab") tampon += "\t";
        else if (c.localName === "br") {
          bosalt();
          hedef.append(document.createElement("br"));
        } else if (c.localName === "drawing" || c.localName === "pict") gorselSayisi++;
      }
      bosalt();
    }
  };
  const duzMetin = (p) => [...p.getElementsByTagNameNS(W, "t")].map((t) => t.textContent).join("");
  /** t + tab öğeleri sırayla (liste işaretinden sonraki sekmeyi görebilmek için) */
  const sekmeliMetin = (p) =>
    [...p.getElementsByTagNameNS(W, "*")].map((x) => (x.localName === "t" ? x.textContent : x.localName === "tab" && x.parentNode.localName === "r" ? "\t" : "")).join("");
  const bastanKirp = (kap, n) => {
    const yur = document.createTreeWalker(kap, NodeFilter.SHOW_TEXT);
    for (let t = yur.nextNode(); t && n > 0; t = yur.nextNode()) {
      const al = Math.min(n, t.nodeValue.length);
      t.nodeValue = t.nodeValue.slice(al);
      n -= al;
    }
    for (const c of [...kap.querySelectorAll("*")]) if (!c.textContent && c.localName !== "br") c.remove();
  };

  const paragraf = (p) => {
    const stil = p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") || "";
    const metin = duzMetin(p).trim();
    const numPr = p.getElementsByTagNameNS(W, "numPr").length > 0;

    if (stil === "Title") {
      if (!baslik && metin) baslik = metin;
      return;
    }
    if (stil === "Kunye" && !durum.kunyeBitti && !alintiModu) {
      const kv = /^([^:]{2,20}):\s*(.*)$/.exec(metin);
      if (kv) {
        meta[kv[1]] = kv[2];
        return;
      }
    }
    if (alintiModu) {
      if (stil === "Quote") return void alintilar.push({ alinti: metin, kaynak: "", sayfa: "", yorum: "" });
      if (/^—\s/.test(metin) && alintilar.length) return void (alintilar[alintilar.length - 1].kaynak = metin.replace(/^—\s*/, ""));
      if (/^Yorumum:/.test(metin)) {
        const yorum = metin.replace(/^Yorumum:\s*/, "");
        if (alintilar.length && !alintilar[alintilar.length - 1].yorum) alintilar[alintilar.length - 1].yorum = yorum;
        else alintilar.push({ alinti: "", kaynak: "", sayfa: "", yorum });
        return;
      }
    }
    if (!metin && !p.getElementsByTagNameNS(W, "drawing").length) {
      yigin.length = 0;
      if (durum.kunyeBitti && p.getElementsByTagNameNS(W, "pBdr").length) kap.append(document.createElement("hr")); // ayraç çizgisi
      if (!durum.kunyeBitti) durum.kunyeBitti = true; // künyeyi kapatan ayraç satırı
      return;
    }
    durum.kunyeBitti = true;

    if (/^(Heading1|Heading 1|1)$/i.test(stil) && /^Kaynaklı alıntılar$/i.test(metin)) {
      alintiModu = true;
      return;
    }
    const baslikMi = /^Heading([1-9])$/i.exec(stil.replace(/\s+/g, ""));
    if (baslikMi || stil === "Subtitle") {
      yigin.length = 0;
      const h = document.createElement(baslikMi && +baslikMi[1] === 1 ? "h2" : "h3");
      satirIci(p, h);
      return void kap.append(h);
    }
    if (stil === "Quote") {
      yigin.length = 0;
      const q = document.createElement("blockquote");
      satirIci(p, q);
      return void kap.append(q);
    }

    // Liste: bu uygulamanın "•\t", "3.\t", "☐\t" işaretleri ya da Word'ün kendi numaralı/madde işaretli listeleri
    const isaret = /^(•|\d+\.|☐|☑)\t/.exec(sekmeliMetin(p));
    if (isaret || numPr) {
      const gorev = isaret && /[☐☑]/.test(isaret[1]);
      const sirali = isaret ? /\d/.test(isaret[1]) : false;
      const tur = sirali ? "ol" : "ul";
      // girinti düzeyi: Word listesinde w:ilvl, bu uygulamanın dışa aktardığı Word'de sol girinti (540 + 360×düzey)
      const ilvl = parseInt(p.getElementsByTagNameNS(W, "ilvl")[0]?.getAttributeNS(W, "val") || "", 10);
      const sol = parseInt(p.getElementsByTagNameNS(W, "ind")[0]?.getAttributeNS(W, "left") || "0", 10);
      const derinlik = Number.isFinite(ilvl) ? Math.min(ilvl, 6) : Math.max(0, Math.min(6, Math.round((sol - 540) / 360)));
      while (yigin.length > derinlik + 1) yigin.pop();
      let ust = yigin[derinlik];
      if (ust && (ust.localName !== tur || ust.classList.contains("nt-gorev") !== !!gorev)) {
        yigin.length = derinlik;
        ust = null;
      }
      const kapsayici = (l) => l.lastElementChild || l.appendChild(document.createElement("li"));
      while (yigin.length < derinlik) {
        const ara = document.createElement("ul");
        (yigin.length ? kapsayici(yigin[yigin.length - 1]) : kap).append(ara);
        yigin.push(ara);
      }
      if (!ust) {
        ust = document.createElement(tur);
        if (gorev) ust.className = "nt-gorev";
        (derinlik ? kapsayici(yigin[derinlik - 1]) : kap).append(ust);
        yigin[derinlik] = ust;
      }
      const li = document.createElement("li");
      if (isaret && isaret[1] === "☑") li.setAttribute("data-yapildi", "1");
      const gecici = document.createElement("div");
      satirIci(p, gecici);
      if (isaret) bastanKirp(gecici, isaret[0].length);
      li.append(...gecici.childNodes);
      return void ust.append(li);
    }
    yigin.length = 0;
    const pe = document.createElement("p");
    satirIci(p, pe);
    kap.append(pe);
  };

  for (const c of govde.children) {
    if (c.localName === "p") paragraf(c);
    else if (c.localName === "tbl") {
      yigin.length = 0;
      for (const tr of c.getElementsByTagNameNS(W, "tr")) {
        const pe = document.createElement("p");
        pe.append([...tr.getElementsByTagNameNS(W, "tc")].map((tc) => [...tc.getElementsByTagNameNS(W, "p")].map(duzMetin).join(" ").trim()).join(" | "));
        kap.append(pe);
      }
    }
  }
  const m = metaDuzelt({ ...meta, ...(baslik ? { baslik } : {}) }, ctx);
  const uyarilar = gorselSayisi ? [`${gorselSayisi} görsel alınmadı (ekler şifreli depoya taşınmaz).`] : [];
  return taslak(ad, { ...m, html: temizHtml(kap), alintilar, uyarilar }, ctx);
}

/* ---------- PDF ---------- */

const ARA = (u8, igne, bas = 0) => {
  const ilk = igne[0];
  for (let i = bas; i <= u8.length - igne.length; i++) {
    if (u8[i] !== ilk) continue;
    let k = 1;
    while (k < igne.length && u8[i + k] === igne[k]) k++;
    if (k === igne.length) return i;
  }
  return -1;
};
const bayt = (m) => new TextEncoder().encode(m);

async function zlibAc(u8) {
  const akis = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(akis).arrayBuffer());
}

/** PDF literal dizgisini ("(...)" içi) çöz: \n \( \) \\ \ddd kaçışları. */
function pdfDizgisi(ham) {
  const cikti = [];
  for (let i = 0; i < ham.length; i++) {
    const c = ham[i];
    if (c !== "\\") {
      cikti.push(c.charCodeAt(0) & 255);
      continue;
    }
    const n = ham[++i];
    if (n === "n") cikti.push(10);
    else if (n === "r") cikti.push(13);
    else if (n === "t") cikti.push(9);
    else if (n >= "0" && n <= "7") {
      let o = n;
      while (o.length < 3 && ham[i + 1] >= "0" && ham[i + 1] <= "7") o += ham[++i];
      cikti.push(parseInt(o, 8) & 255);
    } else if (n !== undefined && n !== "\n") cikti.push(n.charCodeAt(0) & 255);
  }
  const TR = { 1: "Ğ", 2: "ğ", 3: "İ", 4: "ı", 5: "Ş", 6: "ş" }; // bu uygulamanın PDF kodlaması (Differences)
  return new TextDecoder("windows-1252").decode(new Uint8Array(cikti)).replace(/[\u0001-\u0006]/g, (c) => TR[c.charCodeAt(0)]);
}

/** Bu uygulamanın PDF'ine gömülen not verisi (varsa): dışa aktarılan notu BİREBİR geri kurar. */
function pdfGomuluVeri(u8) {
  const i = ARA(u8, bayt("NOTLAR-V1\n"));
  if (i < 0) return null;
  const bas = i + 10;
  const son = ARA(u8, bayt("\nendstream"), bas);
  if (son < 0) return null;
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(u8.subarray(bas, son)).trim());
  } catch {
    return null;
  }
}

/** Başka kaynaktan PDF: içerik akışlarındaki Tj/TJ metinlerini sırayla toplar (en iyi çaba). */
export async function pdfMetniCikar(u8) {
  const latin = new TextDecoder("latin1").decode(u8);
  const satirlar = [];
  let sonY = null;
  let simdiki = "";
  const bitir = () => {
    if (simdiki.trim()) satirlar.push(simdiki.replace(/\s+/g, " ").trim());
    simdiki = "";
  };
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(latin))) {
    const bas = m.index + m[0].length;
    const son = latin.indexOf("endstream", bas);
    if (son < 0) break;
    const sozluk = latin.slice(Math.max(0, m.index - 300), m.index);
    let veri = u8.subarray(bas, son);
    try {
      if (/FlateDecode/.test(sozluk.slice(sozluk.lastIndexOf("obj")))) {
        // "endstream"den önceki satır sonu akışın parçası değildir (PDF 7.3.8); sıkıştırma artığı sayılıp reddedilmesin
        const kesik = veri.subarray(0, veri.length - (veri[veri.length - 1] === 10 ? (veri[veri.length - 2] === 13 ? 2 : 1) : veri[veri.length - 1] === 13 ? 1 : 0));
        veri = await zlibAc(kesik).catch(() => zlibAc(veri));
      }
    } catch {
      continue;
    }
    const icerik = new TextDecoder("latin1").decode(veri);
    if (!/\bBT\b/.test(icerik)) continue;
    for (const bt of icerik.matchAll(/BT([\s\S]*?)ET/g)) {
      const jeton = /\((?:\\[\s\S]|[^\\)])*\)|\[(?:\((?:\\[\s\S]|[^\\)])*\)|[^\]])*\]\s*TJ|-?[\d.]+\s+-?[\d.]+\s+T[dD]|T\*|-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+Tm/g;
      let j;
      let ilkKonum = true; // BT içindeki İLK konum mutlaktır, sonrakiler göreli
      while ((j = jeton.exec(bt[1]))) {
        const t = j[0];
        if (t.startsWith("(")) simdiki += pdfDizgisi(t.slice(1, -1));
        else if (t.startsWith("[")) {
          for (const p of t.matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)|(-?[\d.]+)/g)) {
            if (p[1] !== undefined) simdiki += pdfDizgisi(p[1]);
            else if (parseFloat(p[2]) < -250) simdiki += " ";
          }
        } else if (t === "T*") bitir();
        else {
          const say = t.trim().split(/\s+/);
          const y = parseFloat(t.endsWith("Tm") ? say[5] : say[1]);
          if (ilkKonum) {
            // aynı satırdaki parçalar (aynı y) boşlukla birleşir, y değişince satır biter
            if (sonY !== null && Math.abs(y - sonY) > 1) bitir();
            else if (simdiki) simdiki += " ";
            sonY = y;
            ilkKonum = false;
          } else if (!t.endsWith("Tm") && Math.abs(y) > 0.5) bitir();
        }
      }
    }
    bitir();
    sonY = null; // sayfa/akış değişti
  }
  return satirlar;
}

async function pdfCoz(ad, u8, ctx) {
  const v = pdfGomuluVeri(u8);
  if (v && typeof v === "object") {
    const kap = document.createElement("div");
    Bicim.htmlKur(String(v.html || ""), kap);
    const m = metaDuzelt({ baslik: v.baslik, klasor: v.klasor, kategori: v.kategori, durum: v.durum, tarih: v.tarih, etiketler: v.etiketler, olusturma: v.olusturma }, ctx);
    const alintilar = Array.isArray(v.alintilar)
      ? v.alintilar.map((a) => ({ alinti: String(a?.alinti || ""), kaynak: String(a?.kaynak || ""), sayfa: String(a?.sayfa || ""), yorum: String(a?.yorum || "") })).filter((a) => a.alinti || a.yorum)
      : [];
    return taslak(ad, { ...m, html: temizHtml(kap), alintilar }, ctx);
  }
  const satirlar = await pdfMetniCikar(u8);
  const metin = satirlar.join("\n");
  if ((metin.match(/\p{L}/gu) || []).length < 20) throw new Error("Bu PDF'ten metin okunamadı (taranmış görüntü ya da özel kodlamalı olabilir). Word, Markdown veya HTML sürümünü kullan.");
  // Başka kaynaktan PDF'te yapı bilgisi yoktur: satırlar paragraf olur
  const md = satirlar.map((x) => MD_KACIS(x)).join("\n\n");
  return taslak(ad, { html: markdownHtml(md), uyarilar: ["Başka kaynaktan PDF: yalnızca düz metin alındı; biçimlendirme ve görseller yok. Satır kırılmaları paragraf sayıldı."] }, ctx);
}

/* ---------- ZIP paketi ---------- */

const TERCIH = { md: 0, html: 1, pdf: 2, docx: 3, txt: 4, json: 5 };

async function zipCoz(ad, bayt, ctx, atlanan) {
  const z = await zipOku(bayt);
  const adaylar = [];
  for (const g of z.girisler) {
    if (g.dizin) continue;
    const yol = g.ad.replace(/\\/g, "/");
    const parcalar = yol.split("/");
    const dosya = parcalar[parcalar.length - 1];
    if (!dosya || dosya.startsWith(".") || yol.startsWith("__MACOSX/")) continue;
    if (parcalar.some((p, i) => i < parcalar.length - 1 && katla(p) === "ekler")) continue; // ek klasörü
    if (/^Dizin\.md$/i.test(dosya)) continue;
    const u = UZANTI[uzantiAl(dosya)];
    if (!u || u === "zip") continue;
    adaylar.push({ g, yol, u, parcalar });
  }
  // Aynı not birden çok biçimde paketlenmişse (Markdown/ Word/ HTML/ Metin/) yalnızca en iyi biçimi al.
  const gruplar = new Map();
  for (const a of adaylar) {
    const yolParcalari = a.parcalar.slice(0, -1);
    const bicimIdx = yolParcalari.findIndex((p) => BICIM_KLASORLERI.has(katla(p)));
    const klasorDizisi = bicimIdx >= 0 ? yolParcalari.slice(bicimIdx + 1) : yolParcalari.slice(Math.min(1, yolParcalari.length));
    const anahtar = klasorDizisi.join("/") + "/" + dosyaGovdesi(a.yol).toLocaleLowerCase("tr");
    a.klasorDizisi = klasorDizisi;
    const onceki = gruplar.get(anahtar);
    if (!onceki || TERCIH[a.u] < TERCIH[onceki.u]) gruplar.set(anahtar, a);
  }
  const notlar = [];
  for (const a of gruplar.values()) {
    try {
      const bytes = await z.oku(a.g);
      for (const n of await dosyaCoz(a.yol.split("/").pop(), bytes, ctx, atlanan, false)) {
        if (!n.klasorYolu.length) n.klasorYolu = a.klasorDizisi.map((p) => p.slice(0, 80)).slice(0, 8);
        notlar.push(n);
      }
    } catch (h) {
      atlanan.push(`${a.yol}: ${h.message || h}`);
    }
  }
  return notlar;
}

/* ---------- ortak giriş ---------- */

async function dosyaCoz(ad, bayt, ctx, atlanan, zipAcilsin = true) {
  const u = UZANTI[uzantiAl(ad)];
  const metin = () => new TextDecoder("utf-8").decode(bayt);
  switch (u) {
    case "md": return [markdownCoz(ad, metin(), ctx)];
    case "txt": return [metinCoz(ad, metin(), ctx)];
    case "json": return jsonNotlari(ad, JSON.parse(metin()), ctx);
    case "html": return [htmlCoz(ad, metin(), ctx)];
    case "pdf": return [await pdfCoz(ad, bayt, ctx)];
    case "docx": return [await docxCoz(ad, bayt.buffer.slice(bayt.byteOffset, bayt.byteOffset + bayt.byteLength), ctx)];
    case "zip":
      if (!zipAcilsin) return [];
      return zipCoz(ad, bayt.buffer.slice(bayt.byteOffset, bayt.byteOffset + bayt.byteLength), ctx, atlanan);
    default:
      throw new Error("Desteklenmeyen dosya türü (desteklenenler: Markdown, metin, JSON, HTML, Word, PDF, ZIP).");
  }
}

/** File[] → {notlar:[taslak], atlanan:[metin]} */
export async function dosyalariCoz(dosyalar, ctx) {
  const notlar = [];
  const atlanan = [];
  for (const f of dosyalar) {
    try {
      if (f.size > DOSYA_UST) throw new Error("Dosya çok büyük (60 MB üstü).");
      const bayt = new Uint8Array(await f.arrayBuffer());
      notlar.push(...(await dosyaCoz(f.name, bayt, ctx, atlanan)));
    } catch (h) {
      atlanan.push(`${f.name}: ${h.message || h}`);
    }
    if (notlar.length > NOT_UST) {
      atlanan.push(`Bir seferde en fazla ${NOT_UST} not alınır; fazlası bırakıldı.`);
      notlar.length = NOT_UST;
      break;
    }
  }
  const dolu = notlar.filter((n) => {
    const bos = !n.html.replace(/<[^>]*>/g, "").trim() && !/<(img|hr)/.test(n.html) && !n.alintilar.length;
    if (bos && !n.baslik) {
      atlanan.push(`${n.kaynak}: içerik bulunamadı.`);
      return false;
    }
    return true;
  });
  return { notlar: dolu, atlanan };
}
