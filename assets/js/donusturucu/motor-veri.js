/*
 * assets/js/donusturucu/motor-veri.js — CSV ↔ JSON ↔ XML dönüştürücüleri (bağımlılıksız, istemci tarafı).
 *  - CSV: RFC 4180 (tırnaklı alan, çift tırnak kaçışı, alan içi satır sonu), ayraç otomatik (, ; \t |), BOM temizliği.
 *  - JSON → CSV: iç içe nesneler "a.b" anahtarına düzleşir; diziler JSON metni olarak tek hücrede kalır.
 *  - XML ↔ JSON: öznitelikler "@_ad", metin düğümü "#text"; aynı adlı kardeşler dizi olur.
 *  Saf mantık: yalnızca XML ayrıştırma/serileştirme için tarayıcının DOMParser'ı kullanılır.
 */

const BOM = /^\uFEFF/;

/* ------------------------------------ CSV ------------------------------------ */

export function ayiracTahmin(metin) {
  const ornek = metin.slice(0, 4000).split(/\r?\n/).slice(0, 5).filter(Boolean);
  const adaylar = [",", ";", "\t", "|"];
  let en = ",";
  let enSkor = -1;
  for (const a of adaylar) {
    const sayilar = ornek.map((s) => {
      let n = 0;
      let tirnak = false;
      for (const c of s) {
        if (c === '"') tirnak = !tirnak;
        else if (c === a && !tirnak) n += 1;
      }
      return n;
    });
    if (!sayilar.length || sayilar[0] === 0) continue;
    const tutarli = sayilar.every((x) => x === sayilar[0]);
    const skor = sayilar[0] * (tutarli ? 10 : 1);
    if (skor > enSkor) { enSkor = skor; en = a; }
  }
  return en;
}

/** @returns {string[][]} */
export function csvAyristir(metin, ayirac) {
  const s = String(metin ?? "").replace(BOM, "");
  const d = ayirac || ayiracTahmin(s);
  const satirlar = [];
  let satir = [];
  let alan = "";
  let tirnakta = false;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (tirnakta) {
      if (c === '"') {
        if (s[i + 1] === '"') { alan += '"'; i += 2; continue; }
        tirnakta = false; i += 1; continue;
      }
      alan += c; i += 1; continue;
    }
    if (c === '"' && alan === "") { tirnakta = true; i += 1; continue; }
    if (c === d) { satir.push(alan); alan = ""; i += 1; continue; }
    if (c === "\r") { i += 1; continue; }
    if (c === "\n") { satir.push(alan); satirlar.push(satir); satir = []; alan = ""; i += 1; continue; }
    alan += c; i += 1;
  }
  if (alan !== "" || satir.length) { satir.push(alan); satirlar.push(satir); }
  // tamamen boş son satırları at
  while (satirlar.length && satirlar[satirlar.length - 1].every((x) => x === "")) satirlar.pop();
  return satirlar;
}

export function csvKacis(deger, ayirac = ",") {
  const s = deger == null ? "" : String(deger);
  return new RegExp(`["\\n\\r${ayirac === "\t" ? "\\t" : ayirac.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}]`).test(s) || /^\s|\s$/.test(s)
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function csvYaz(satirlar, { ayirac = ",", bom = true, satirSonu = "\r\n" } = {}) {
  return (bom ? "\uFEFF" : "") + satirlar.map((r) => r.map((h) => csvKacis(h, ayirac)).join(ayirac)).join(satirSonu) + satirSonu;
}

function tipCikar(v) {
  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  // Sayı: baştaki sıfırlı (007), "+90..." ve 15 haneden uzun kimlik benzeri değerler METİN kalır.
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][+-]?\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

function benzersizBasliklar(ham) {
  const goruldu = new Map();
  return ham.map((h, i) => {
    let ad = String(h ?? "").trim() || `sutun_${i + 1}`;
    const n = goruldu.get(ad) || 0;
    goruldu.set(ad, n + 1);
    if (n > 0) ad = `${ad}_${n + 1}`;
    return ad;
  });
}

/** @returns {object[]} */
export function csvDenNesneler(metin, { ayirac, tipler = true } = {}) {
  const sat = csvAyristir(metin, ayirac);
  if (!sat.length) return [];
  const bas = benzersizBasliklar(sat[0]);
  return sat.slice(1).map((r) => {
    const o = {};
    bas.forEach((b, i) => { const v = r[i] ?? ""; o[b] = tipler ? tipCikar(v) : v; });
    return o;
  });
}

export function csvDenJson(metin, secenek = {}) {
  return JSON.stringify(csvDenNesneler(metin, secenek), null, 2);
}

/* ------------------------------------ JSON → tablo ------------------------------------ */

function duzlestir(deger, onek, cikti) {
  if (deger !== null && typeof deger === "object" && !Array.isArray(deger)) {
    const anahtarlar = Object.keys(deger);
    if (!anahtarlar.length && onek) { cikti[onek] = ""; return cikti; }
    for (const k of anahtarlar) duzlestir(deger[k], onek ? `${onek}.${k}` : k, cikti);
    return cikti;
  }
  cikti[onek || "deger"] = Array.isArray(deger) ? JSON.stringify(deger) : deger;
  return cikti;
}

/** Herhangi bir JSON → satır dizisi (ilk satır başlık). */
export function jsonDenTablo(veri) {
  let kayitlar;
  if (Array.isArray(veri)) {
    if (veri.length && veri.every((x) => Array.isArray(x))) {
      return veri.map((r) => r.map((h) => (h !== null && typeof h === "object" ? JSON.stringify(h) : h)));
    }
    kayitlar = veri;
  } else if (veri !== null && typeof veri === "object") {
    // { liste: [ {...}, {...} ] } → ilk "nesne dizisi"ni bul
    const aday = Object.values(veri).find((v) => Array.isArray(v) && v.length && v.every((x) => x !== null && typeof x === "object" && !Array.isArray(x)));
    kayitlar = aday || [veri];
  } else {
    kayitlar = [veri];
  }
  const duz = kayitlar.map((k) => duzlestir(k, "", {}));
  const basliklar = [];
  const gorulen = new Set();
  for (const r of duz) for (const k of Object.keys(r)) if (!gorulen.has(k)) { gorulen.add(k); basliklar.push(k); }
  return [basliklar, ...duz.map((r) => basliklar.map((k) => (r[k] === undefined || r[k] === null ? "" : r[k])))];
}

export function jsonDenCsv(metin, secenek = {}) {
  let veri;
  try { veri = JSON.parse(String(metin).replace(BOM, "")); } catch (h) { throw new Error(`Geçersiz JSON: ${h.message}`); }
  return csvYaz(jsonDenTablo(veri), secenek);
}

/* ------------------------------------ XML ------------------------------------ */

const XML_GECERSIZ = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g;
const xmlKacis = (s) => String(s).replace(XML_GECERSIZ, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function xmlDenNesne(metin) {
  const doc = new DOMParser().parseFromString(String(metin).replace(BOM, ""), "application/xml");
  const hata = doc.getElementsByTagName("parsererror")[0];
  if (hata) throw new Error(`Geçersiz XML: ${hata.textContent.replace(/\s+/g, " ").trim().slice(0, 180)}`);

  const dugum = (e) => {
    const o = {};
    for (const a of e.attributes) o[`@_${a.name}`] = a.value;
    const cocuklar = [...e.childNodes];
    let metinler = "";
    const alt = new Map();
    for (const c of cocuklar) {
      if (c.nodeType === 1) {
        const v = dugum(c);
        if (!alt.has(c.nodeName)) alt.set(c.nodeName, []);
        alt.get(c.nodeName).push(v);
      } else if (c.nodeType === 3 || c.nodeType === 4) metinler += c.nodeValue;
    }
    const kirp = metinler.trim();
    for (const [ad, liste] of alt) o[ad] = liste.length === 1 ? liste[0] : liste;
    if (!alt.size && !Object.keys(o).length) return kirp;
    if (kirp) o["#text"] = kirp;
    return o;
  };
  const kok = doc.documentElement;
  return { [kok.nodeName]: dugum(kok) };
}

export function xmlDenJson(metin) {
  return JSON.stringify(xmlDenNesne(metin), null, 2);
}

function elemanAdi(ad) {
  let s = String(ad).replace(/[^A-Za-z0-9_.\-\u00C0-\uFFFF]/g, "_");
  if (!/^[A-Za-z_\u00C0-\uFFFF]/.test(s)) s = `_${s}`;
  if (/^xml/i.test(s)) s = `_${s}`;
  return s;
}

function nesneDenXml(ad, deger, derinlik, cikti) {
  const gir = "  ".repeat(derinlik);
  const tag = elemanAdi(ad);
  if (Array.isArray(deger)) { for (const x of deger) nesneDenXml(ad, x, derinlik, cikti); return; }
  if (deger === null || deger === undefined) { cikti.push(`${gir}<${tag}/>`); return; }
  if (typeof deger !== "object") {
    const t = String(deger);
    cikti.push(t === "" ? `${gir}<${tag}/>` : `${gir}<${tag}>${xmlKacis(t)}</${tag}>`);
    return;
  }
  const oznitelik = [];
  const cocuk = [];
  let metin = null;
  for (const [k, v] of Object.entries(deger)) {
    if (k.startsWith("@_")) oznitelik.push(` ${elemanAdi(k.slice(2))}="${xmlKacis(v)}"`);
    else if (k === "#text") metin = String(v);
    else cocuk.push([k, v]);
  }
  const ac = `${gir}<${tag}${oznitelik.join("")}`;
  if (!cocuk.length) {
    cikti.push(metin ? `${ac}>${xmlKacis(metin)}</${tag}>` : `${ac}/>`);
    return;
  }
  cikti.push(`${ac}>`);
  if (metin) cikti.push(`${gir}  ${xmlKacis(metin)}`);
  for (const [k, v] of cocuk) nesneDenXml(k, v, derinlik + 1, cikti);
  cikti.push(`${gir}</${tag}>`);
}

export function jsonDenXml(metin, { kok = "kok", oge = "oge" } = {}) {
  let veri;
  try { veri = JSON.parse(String(metin).replace(BOM, "")); } catch (h) { throw new Error(`Geçersiz JSON: ${h.message}`); }
  const cikti = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const anahtarlar = veri !== null && typeof veri === "object" && !Array.isArray(veri)
    ? Object.keys(veri).filter((k) => !k.startsWith("@_") && k !== "#text") : [];
  const tekKok = anahtarlar.length === 1 && Object.keys(veri).length === 1;
  if (tekKok) nesneDenXml(anahtarlar[0], veri[anahtarlar[0]], 0, cikti);
  else if (Array.isArray(veri)) nesneDenXml(kok, { [oge]: veri }, 0, cikti);
  else nesneDenXml(kok, veri, 0, cikti);
  return `${cikti.join("\n")}\n`;
}

/* ------------------------------------ çapraz dönüşümler ------------------------------------ */

export function csvDenXml(metin, secenek = {}) {
  return jsonDenXml(JSON.stringify({ satirlar: { satir: csvDenNesneler(metin, secenek) } }));
}

export function xmlDenCsv(metin, secenek = {}) {
  return csvYaz(jsonDenTablo(xmlBulTablo(xmlDenNesne(metin))), secenek);
}

/** XML'den dönen nesnede "nesne dizisi" bulur (ör. <satirlar><satir>…</satir>…</satirlar>). */
function xmlBulTablo(nesne) {
  const ara = (v) => {
    if (Array.isArray(v) && v.length && v.every((x) => x !== null && typeof x === "object")) return v;
    if (v !== null && typeof v === "object") for (const x of Object.values(v)) { const r = ara(x); if (r) return r; }
    return null;
  };
  return ara(nesne) || nesne;
}

/** Hedef biçime göre metin üretir. Dönüş: { metin, uzanti, mime }. */
export function veriDonustur(kaynakTur, hedefTur, metin, secenek = {}) {
  const f = `${kaynakTur}>${hedefTur}`;
  switch (f) {
    case "csv>json": return { metin: csvDenJson(metin, secenek), uzanti: "json", mime: "application/json" };
    case "csv>xml": return { metin: csvDenXml(metin, secenek), uzanti: "xml", mime: "application/xml" };
    case "json>csv": return { metin: jsonDenCsv(metin, secenek), uzanti: "csv", mime: "text/csv" };
    case "json>xml": return { metin: jsonDenXml(metin, secenek), uzanti: "xml", mime: "application/xml" };
    case "xml>json": return { metin: xmlDenJson(metin), uzanti: "json", mime: "application/json" };
    case "xml>csv": return { metin: xmlDenCsv(metin, secenek), uzanti: "csv", mime: "text/csv" };
    default: throw new Error(`Desteklenmeyen veri dönüşümü: ${kaynakTur} → ${hedefTur}`);
  }
}
