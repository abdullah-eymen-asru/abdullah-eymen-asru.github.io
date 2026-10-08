/*
 * assets/js/akademik/atif.js
 * -----------------------------------------------------------------------
 * Akademik Kütüphane — atıf/kaynakça üretimi (APA 7, MLA 9, Chicago 17) ve
 * BibTeX (.bib) / RIS (.ris) içe-dışa aktarma. SAF mantık: DOM, ağ ya da Supabase yok;
 * bu yüzden Node'da da test edilir (tests/akademik-atif.test.mjs).
 *
 * KAYIT BİÇİMİ (veritabanı satırıyla aynı):
 *   { baslik, yazarlar:[{adi,soyadi}|{kurum}], yayin_yili, dergi_veya_yayinevi, doi, isbn, url,
 *     ozet, etiketler:[], tur, ek_alanlar:{cilt,sayi,sayfa,baski,sehir,editor,kitap_adi,yayinevi,
 *     tez_turu,rapor_no,kisaltma,issn,dil} }
 *
 * "dergi_veya_yayinevi" türe göre: makale → dergi · kitap/rapor → yayınevi · bildiri → bildiri/kitap
 * adı · tez → üniversite · web → site adı · kitap_bolumu → yayınevi (kitap adı ek_alanlar.kitap_adi).
 *
 * ÇIKTI: { html, text, md } — italikler içeride \u0001…\u0002 işaretleriyle taşınır, sonda
 * md (*…*), text (düz) ve html (<em>…</em>, kaçışlı) biçimlerine çevrilir. html çıktısı sitedeki
 * _includes/atif-kutusu.html'in <p class="atif-metin"> gövdesiyle birebir uyumludur.
 * -----------------------------------------------------------------------
 */

export const TURLER = {
  makale: "Makale",
  kitap: "Kitap",
  kitap_bolumu: "Kitap bölümü",
  bildiri: "Bildiri",
  tez: "Tez",
  rapor: "Rapor",
  web: "Web sayfası",
  diger: "Diğer",
};

export const BICIMLER = [
  { anahtar: "apa", etiket: "APA 7" },
  { anahtar: "mla", etiket: "MLA 9" },
  { anahtar: "chicago", etiket: "Chicago 17" },
];

const I1 = "\u0001";
const I2 = "\u0002";
const it = (s) => (s ? `${I1}${s}${I2}` : "");

const AYLAR_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const AYLAR_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AYLAR_MLA = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

const S = (v) => (v === undefined || v === null ? "" : String(v).trim());

/* ----------------------------- yazar yardımcıları ----------------------------- */

/** Serbest metni yazar listesine çevirir.
 *  Satır sonu, ";" ya da " and " ile ayrılır. "Soyad, Ad" ya da "Ad Soyad"; kurum için {Kurum Adı}. */
export function yazarMetniAyristir(metin) {
  const parcalar = String(metin || "")
    .split(/\r?\n|;|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parcalar.map((p) => {
    const kurum = /^\{(.+)\}$/.exec(p);
    if (kurum) return { kurum: kurum[1].trim() };
    if (p.includes(",")) {
      const [soyadi, ...geri] = p.split(",");
      return { adi: geri.join(",").trim(), soyadi: soyadi.trim() };
    }
    const kelimeler = p.split(/\s+/);
    if (kelimeler.length === 1) return { adi: "", soyadi: kelimeler[0] };
    return { adi: kelimeler.slice(0, -1).join(" "), soyadi: kelimeler[kelimeler.length - 1] };
  });
}

/** Düzenleme kutusu için: yazar listesi → "Soyad, Ad" satırları. */
export function yazarlariMetneCevir(yazarlar) {
  return (yazarlar || [])
    .map((y) => (y.kurum ? `{${y.kurum}}` : y.adi ? `${y.soyadi}, ${y.adi}` : y.soyadi || ""))
    .filter(Boolean)
    .join("\n");
}

function basHarf(ch, dil) {
  return ch.toLocaleUpperCase(dil === "tr" ? "tr" : "en");
}

/** "Ayşe Nur" → "A. N."   ·   "Jean-Paul" → "J.-P." */
export function basHarfler(ad, dil = "en") {
  return S(ad)
    .split(/\s+/)
    .filter(Boolean)
    .map((kelime) =>
      kelime
        .split("-")
        .map((p) => (p ? `${basHarf([...p][0], dil)}.` : ""))
        .join("-")
    )
    .join(" ");
}

const tamAd = (y) => (y.kurum ? y.kurum : [y.adi, y.soyadi].filter(Boolean).join(" "));
const tersAd = (y) => (y.kurum ? y.kurum : y.adi ? `${y.soyadi}, ${y.adi}` : y.soyadi || "");

/* --------------------------------- ortak araçlar -------------------------------- */

/** Cümle sonu noktası: zaten ./?/!/… ile bitiyorsa (italik/tırnak işaretleri hariç) ekleme. */
function nokta(s) {
  const v = S(s);
  if (!v) return "";
  const govde = v.replace(new RegExp(`[${I2}"”’')\\]]+$`), "");
  return /[.!?…]$/.test(govde) ? v : `${v}.`;
}

const aralik = (s, tire) => S(s).replace(/\s*[-–—]+\s*/g, tire);
const doiUrl = (doi) => (doi ? `https://doi.org/${doi}` : "");

function temizle(s) {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/,\s*\./g, ".")
    .replace(/\.\u0002\./g, `.${I2}`)
    .replace(/\.{2,}(?!\.)/g, ".")
    .replace(/([?!])\./g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function sonlandir(s) {
  const t = temizle(s);
  const html = t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(new RegExp(I1, "g"), "<em>")
    .replace(new RegExp(I2, "g"), "</em>")
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;)])/g, '<a href="$1">$1</a>');
  return {
    text: t.replace(new RegExp(`[${I1}${I2}]`, "g"), ""),
    md: t.replace(new RegExp(`[${I1}${I2}]`, "g"), "*"),
    html,
  };
}

function etiketler(dil) {
  return dil === "tr"
    ? { ve: "ve", vd: "vd.", cilt: "cilt", sayi: "sayı", sayfa: "s.", sayfalar: "ss.", baski: "bs.", erisim: "Erişim tarihi", yok: "t.y.", editor: "Ed.", editorler: "Ed.", tez: { doktora: "Doktora tezi", yuksek: "Yüksek lisans tezi" } }
    : { ve: "and", vd: "et al.", cilt: "vol.", sayi: "no.", sayfa: "p.", sayfalar: "pp.", baski: "ed.", erisim: "Accessed", yok: "n.d.", editor: "Ed.", editorler: "Eds.", tez: { doktora: "Doctoral dissertation", yuksek: "Master's thesis" } };
}

function tarihYazi(tarih, dil, kisaMla = false) {
  const d = tarih instanceof Date ? tarih : new Date();
  const gun = d.getDate();
  const yil = d.getFullYear();
  if (dil === "tr") return `${gun} ${AYLAR_TR[d.getMonth()]} ${yil}`;
  if (kisaMla) return `${gun} ${AYLAR_MLA[d.getMonth()]} ${yil}`;
  return `${AYLAR_EN[d.getMonth()]} ${gun}, ${yil}`;
}

function normalize(k) {
  const ek = k.ek_alanlar || {};
  return {
    tur: k.tur || "makale",
    baslik: S(k.baslik),
    yazarlar: Array.isArray(k.yazarlar) ? k.yazarlar.filter((y) => y && (y.kurum || y.soyadi || y.adi)) : [],
    yil: S(k.yayin_yili),
    kap: S(k.dergi_veya_yayinevi),
    doi: S(k.doi),
    isbn: S(k.isbn),
    url: S(k.url),
    cilt: S(ek.cilt),
    sayi: S(ek.sayi),
    sayfa: S(ek.sayfa),
    baski: S(ek.baski),
    sehir: S(ek.sehir),
    editor: yazarMetniAyristir(ek.editor),
    kitapAdi: S(ek.kitap_adi),
    yayinevi: S(ek.yayinevi),
    tezTuru: S(ek.tez_turu),
    raporNo: S(ek.rapor_no),
  };
}

/* ==================================== APA 7 ==================================== */

function apaYazarlar(yz, dil) {
  const L = etiketler(dil);
  const adlar = yz.map((y) => (y.kurum ? y.kurum : `${y.soyadi}${y.adi ? `, ${basHarfler(y.adi, dil)}` : ""}`));
  const n = adlar.length;
  if (n === 0) return "";
  if (n === 1) return adlar[0];
  if (n > 20) return `${adlar.slice(0, 19).join(", ")}, … ${adlar[n - 1]}`;
  if (dil === "tr") return n === 2 ? `${adlar[0]} ${L.ve} ${adlar[1]}` : `${adlar.slice(0, -1).join(", ")} ${L.ve} ${adlar[n - 1]}`;
  return n === 2 ? `${adlar[0]}, & ${adlar[1]}` : `${adlar.slice(0, -1).join(", ")}, & ${adlar[n - 1]}`;
}

function apaEditorler(ed, dil) {
  const L = etiketler(dil);
  const adlar = ed.map((y) => (y.kurum ? y.kurum : `${y.adi ? basHarfler(y.adi, dil) + " " : ""}${y.soyadi}`));
  if (!adlar.length) return "";
  const liste = adlar.length === 1 ? adlar[0] : adlar.length === 2 ? `${adlar[0]} ${dil === "tr" ? "ve" : "&"} ${adlar[1]}` : `${adlar.slice(0, -1).join(", ")}, ${dil === "tr" ? "ve" : "&"} ${adlar[adlar.length - 1]}`;
  return `${liste} (${adlar.length > 1 ? L.editorler : L.editor})`;
}

function apa(r, dil, bugun) {
  const L = etiketler(dil);
  const yz = apaYazarlar(r.yazarlar, dil);
  const tarih = `(${r.yil || L.yok})`;
  const dUrl = doiUrl(r.doi) || r.url;
  const erisim = r.tur === "web" && r.url && !r.doi ? (dil === "tr" ? ` ${tarihYazi(bugun, "tr")} tarihinde erişildi.` : ` Retrieved ${tarihYazi(bugun, "en")}, from`) : "";
  const baslikOnde = (b) => (yz ? `${nokta(yz)} ${tarih}. ${b}` : `${b} ${tarih}.`);
  let s;
  switch (r.tur) {
    case "makale": {
      const ciltSayi = `${r.cilt ? `, ${it(r.cilt)}` : ""}${r.sayi ? `(${r.sayi})` : ""}`;
      s = `${baslikOnde(nokta(r.baslik))} ${it(r.kap)}${ciltSayi}${r.sayfa ? `, ${aralik(r.sayfa, "–")}` : ""}. ${dUrl}`;
      break;
    }
    case "kitap":
    case "rapor": {
      const ek = r.tur === "rapor" ? (r.raporNo ? ` (${r.raporNo})` : "") : r.baski ? ` (${r.baski} ${L.baski})` : "";
      s = `${baslikOnde(`${it(r.baslik)}${ek}.`)} ${r.kap || r.yayinevi}. ${dUrl}`;
      break;
    }
    case "kitap_bolumu": {
      const ed = apaEditorler(r.editor, dil);
      const sf = r.sayfa ? ` (${L.sayfalar} ${aralik(r.sayfa, "–")})` : "";
      s = `${baslikOnde(nokta(r.baslik))} ${dil === "tr" ? "İçinde" : "In"} ${ed ? ed + ", " : ""}${it(r.kitapAdi)}${sf}. ${r.kap || r.yayinevi}. ${dUrl}`;
      break;
    }
    case "bildiri":
      s = `${baslikOnde(nokta(r.baslik))} ${dil === "tr" ? "İçinde" : "In"} ${it(r.kap)}${r.sayfa ? ` (${L.sayfalar} ${aralik(r.sayfa, "–")})` : ""}. ${r.yayinevi} ${dUrl}`;
      break;
    case "tez": {
      const turAd = r.tezTuru ? r.tezTuru : L.tez.doktora;
      s = `${baslikOnde(`${it(r.baslik)} [${turAd}${r.kap ? `, ${r.kap}` : ""}].`)} ${dUrl}`;
      break;
    }
    case "web":
      s = `${baslikOnde(`${it(r.baslik)}.`)} ${r.kap ? nokta(r.kap) : ""}${erisim} ${dUrl}`;
      break;
    default:
      s = `${baslikOnde(`${it(r.baslik)}.`)} ${r.kap ? nokta(r.kap) : ""} ${dUrl}`;
  }
  return sonlandir(s);
}

/* ==================================== MLA 9 ==================================== */

function mlaYazarlar(yz, dil) {
  const L = etiketler(dil);
  if (yz.length === 0) return "";
  if (yz.length === 1) return tersAd(yz[0]);
  if (yz.length === 2) return `${tersAd(yz[0])}, ${L.ve} ${tamAd(yz[1])}`;
  return `${tersAd(yz[0])}, ${L.vd}`;
}

function mla(r, dil, bugun) {
  const L = etiketler(dil);
  const yz = mlaYazarlar(r.yazarlar, dil);
  const bas = yz ? `${nokta(yz)} ` : "";
  const dUrl = doiUrl(r.doi) || r.url;
  const sf = r.sayfa ? `${r.sayfa.includes("-") || r.sayfa.includes("–") ? L.sayfalar : L.sayfa} ${aralik(r.sayfa, "-")}` : "";
  const liste = (...p) => p.filter(Boolean).join(", ");
  let s;
  switch (r.tur) {
    case "makale":
      s = `${bas}"${nokta(r.baslik)}" ${liste(it(r.kap), r.cilt ? `${L.cilt} ${r.cilt}` : "", r.sayi ? `${L.sayi} ${r.sayi}` : "", r.yil, sf, dUrl)}.`;
      break;
    case "kitap":
    case "rapor":
      s = `${bas}${nokta(it(r.baslik))} ${liste(r.baski ? `${r.baski} ${L.baski}` : "", r.kap || r.yayinevi, r.yil)}.${dUrl ? ` ${dUrl}.` : ""}`;
      break;
    case "kitap_bolumu": {
      const ed = r.editor.length ? `${dil === "tr" ? "hazırlayan" : "edited by"} ${r.editor.map(tamAd).join(dil === "tr" ? " ve " : " and ")}` : "";
      s = `${bas}"${nokta(r.baslik)}" ${liste(it(r.kitapAdi), ed, r.kap || r.yayinevi, r.yil, sf)}.${dUrl ? ` ${dUrl}.` : ""}`;
      break;
    }
    case "bildiri":
      s = `${bas}"${nokta(r.baslik)}" ${liste(it(r.kap), r.yil, sf, dUrl)}.`;
      break;
    case "tez":
      s = `${bas}${nokta(it(r.baslik))} ${r.yil ? `${r.yil}. ` : ""}${r.kap ? r.kap + ", " : ""}${r.tezTuru || (dil === "tr" ? "doktora tezi" : "PhD dissertation")}.${dUrl ? ` ${dUrl}.` : ""}`;
      break;
    case "web":
      s = `${bas}"${nokta(r.baslik)}" ${liste(it(r.kap), r.yil, dUrl)}.${r.url ? ` ${L.erisim} ${tarihYazi(bugun, dil, true)}.` : ""}`;
      break;
    default:
      s = `${bas}"${nokta(r.baslik)}" ${liste(it(r.kap), r.yil, dUrl)}.`;
  }
  return sonlandir(s);
}

/* ================================== Chicago 17 ================================== */

function chicagoYazarlar(yz, dil) {
  const L = etiketler(dil);
  const adlar = yz.map((y, i) => (i === 0 ? tersAd(y) : tamAd(y)));
  const n = adlar.length;
  if (n === 0) return "";
  if (n === 1) return adlar[0];
  if (n > 10) return `${adlar.slice(0, 7).join(", ")}, ${L.vd}`;
  if (n === 2) return `${adlar[0]}, ${L.ve} ${adlar[1]}`;
  return `${adlar.slice(0, -1).join(", ")}, ${L.ve} ${adlar[n - 1]}`;
}

function chicago(r, dil, bugun) {
  const L = etiketler(dil);
  const yz = chicagoYazarlar(r.yazarlar, dil);
  const bas = yz ? `${nokta(yz)} ` : "";
  const dUrl = doiUrl(r.doi) || r.url;
  const yayin = (yer, yayinci, yil) => [yer && yayinci ? `${yer}: ${yayinci}` : yayinci, yil].filter(Boolean).join(", ");
  let s;
  switch (r.tur) {
    case "makale": {
      const cs = `${r.cilt ? ` ${r.cilt}` : ""}${r.sayi ? `, ${L.sayi} ${r.sayi}` : ""}`;
      s = `${bas}"${nokta(r.baslik)}" ${it(r.kap)}${cs}${r.yil ? ` (${r.yil})` : ""}${r.sayfa ? `: ${aralik(r.sayfa, "–")}` : ""}. ${dUrl}`;
      break;
    }
    case "kitap":
    case "rapor":
      s = `${bas}${nokta(it(r.baslik))} ${r.baski ? `${r.baski} ${L.baski}. ` : ""}${nokta(yayin(r.sehir, r.kap || r.yayinevi, r.yil))} ${dUrl}`;
      break;
    case "kitap_bolumu": {
      const ed = r.editor.length ? `${dil === "tr" ? "hazırlayan" : "edited by"} ${r.editor.map(tamAd).join(dil === "tr" ? " ve " : " and ")}, ` : "";
      s = `${bas}"${nokta(r.baslik)}" ${dil === "tr" ? "İçinde" : "In"} ${it(r.kitapAdi)}, ${ed}${r.sayfa ? aralik(r.sayfa, "–") + ". " : ""}${nokta(yayin(r.sehir, r.kap || r.yayinevi, r.yil))} ${dUrl}`;
      break;
    }
    case "bildiri":
      s = `${bas}"${nokta(r.baslik)}" ${dil === "tr" ? "Bildiri sunumu:" : "Paper presented at"} ${r.kap}${r.yil ? `, ${r.yil}` : ""}. ${dUrl}`;
      break;
    case "tez":
      s = `${bas}"${nokta(r.baslik)}" ${r.tezTuru || "PhD diss."}, ${r.kap ? r.kap + ", " : ""}${r.yil}. ${dUrl}`;
      break;
    case "web":
      s = `${bas}"${nokta(r.baslik)}" ${r.kap ? nokta(r.kap) : ""} ${r.yil ? nokta(r.yil) : ""} ${r.url ? `${L.erisim.replace("Accessed", "Accessed")} ${tarihYazi(bugun, dil)}.` : ""} ${dUrl}`;
      break;
    default:
      s = `${bas}"${nokta(r.baslik)}" ${r.kap ? nokta(r.kap) : ""} ${r.yil ? nokta(r.yil) : ""} ${dUrl}`;
  }
  return sonlandir(s);
}

/**
 * Tek kaynak için atıf üretir.
 * @param {object} kayit   veritabanı satırı biçiminde kayıt
 * @param {'apa'|'mla'|'chicago'} bicim
 * @param {{dil?:'tr'|'en', bugun?:Date}} [secenek]
 * @returns {{text:string, md:string, html:string}}
 */
export function atifUret(kayit, bicim = "apa", { dil = "tr", bugun = new Date() } = {}) {
  const r = normalize(kayit);
  if (bicim === "mla") return mla(r, dil, bugun);
  if (bicim === "chicago") return chicago(r, dil, bugun);
  return apa(r, dil, bugun);
}

/** Sitedeki atif-kutusu.html ile aynı işaretleme: <p class="atif-metin">…</p> */
export function atifKutusuHtml(kayit, bicim, secenek) {
  return `<p class="atif-metin">${atifUret(kayit, bicim, secenek).html}</p>`;
}

/** Blog Markdown'una yapıştırılacak kaynakça maddesi: "- Soyad, A. (2020). *Başlık*. …" */
export function markdownKaynakca(kayitlar, bicim = "apa", secenek = {}) {
  return kayitlar
    .map((k) => `- ${atifUret(k, bicim, secenek).md}`)
    .sort((a, b) => a.localeCompare(b, secenek.dil === "en" ? "en" : "tr"))
    .join("\n");
}

/* ============================== alıntı → Markdown ============================== */

/** Bir PDF açıklamasını Markdown alıntısı yapar (tek tıkla kopyalama).
 *  > “alıntılanan metin” — *Soyad (2020), s. 12*
 *  Yorum varsa altına eklenir. */
export function alintiMarkdown(not, kayit) {
  const yz = (kayit?.yazarlar || []).filter((y) => y.soyadi || y.kurum);
  const kisa =
    yz.length === 0 ? "" : yz.length === 1 ? yz[0].soyadi || yz[0].kurum : yz.length === 2 ? `${yz[0].soyadi || yz[0].kurum} & ${yz[1].soyadi || yz[1].kurum}` : `${yz[0].soyadi || yz[0].kurum} et al.`;
  const kaynakEtiketi = [kisa, kayit?.yayin_yili ? `(${kayit.yayin_yili})` : ""].filter(Boolean).join(" ");
  const sayfa = not.sayfa ? `s. ${not.sayfa}` : "";
  const kunye = [kaynakEtiketi, sayfa].filter(Boolean).join(", ");
  const metin = S(not.metin).replace(/\s*\n\s*/g, " ");
  const satirlar = [];
  if (metin) satirlar.push(`> “${metin}”${kunye ? ` — *${kunye}*` : ""}`);
  else if (kunye) satirlar.push(`> *${kunye}*`);
  if (S(not.yorum)) satirlar.push("", ...S(not.yorum).split("\n"));
  return satirlar.join("\n");
}

/* ===================================== BibTeX ===================================== */

const TR_KATLA = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u", é: "e", è: "e", ñ: "n", ä: "a", ß: "ss", ø: "o", å: "a", æ: "ae", ł: "l" };
function asciiKatla(s) {
  return String(s || "")
    .toLocaleLowerCase("en")
    .replace(/İ/g, "i")
    .split("")
    .map((c) => TR_KATLA[c] ?? c)
    .join("")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const BIB_TUR = { makale: "article", kitap: "book", kitap_bolumu: "incollection", bildiri: "inproceedings", tez: "phdthesis", rapor: "techreport", web: "misc", diger: "misc" };

function bibKacis(s) {
  return String(s ?? "").replace(/([&%$#_])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");
}

export function bibAnahtari(kayit, kullanilan = new Set()) {
  const y0 = (kayit.yazarlar || [])[0];
  const soyad = asciiKatla(y0?.soyadi || y0?.kurum || "kaynak") || "kaynak";
  const ilkKelime = asciiKatla(S(kayit.baslik).split(/\s+/).find((k) => k.length > 3) || "") || "";
  let anahtar = `${soyad}${S(kayit.yayin_yili)}${ilkKelime}`;
  const taban = anahtar;
  for (let i = 2; kullanilan.has(anahtar); i++) anahtar = `${taban}${i}`;
  kullanilan.add(anahtar);
  return anahtar;
}

export function bibtexUret(kayitlar) {
  const kullanilan = new Set();
  return kayitlar
    .map((k) => {
      const ek = k.ek_alanlar || {};
      let tur = BIB_TUR[k.tur] || "misc";
      if (k.tur === "tez" && /y[uü]ksek|master/i.test(S(ek.tez_turu))) tur = "mastersthesis";
      const alan = [];
      const ekle = (ad, deger) => {
        if (S(deger)) alan.push(`  ${ad} = {${deger}}`);
      };
      const yazar = (k.yazarlar || []).map((y) => (y.kurum ? `{${bibKacis(y.kurum)}}` : y.adi ? `${bibKacis(y.soyadi)}, ${bibKacis(y.adi)}` : bibKacis(y.soyadi))).join(" and ");
      ekle("author", yazar);
      ekle("title", `{${bibKacis(k.baslik)}}`);
      const kap = bibKacis(k.dergi_veya_yayinevi);
      if (tur === "article") ekle("journal", kap);
      else if (tur === "book" || tur === "techreport") ekle(tur === "book" ? "publisher" : "institution", kap);
      else if (tur === "incollection") { ekle("booktitle", bibKacis(ek.kitap_adi)); ekle("publisher", kap || bibKacis(ek.yayinevi)); ekle("editor", (yazarMetniAyristir(ek.editor)).map((y) => (y.adi ? `${y.soyadi}, ${y.adi}` : y.soyadi)).join(" and ")); }
      else if (tur === "inproceedings") { ekle("booktitle", kap); ekle("publisher", bibKacis(ek.yayinevi)); }
      else if (tur === "phdthesis" || tur === "mastersthesis") ekle("school", kap);
      else ekle("howpublished", kap);
      ekle("year", k.yayin_yili);
      ekle("volume", ek.cilt);
      ekle("number", tur === "techreport" ? ek.rapor_no || ek.sayi : ek.sayi);
      ekle("pages", aralik(ek.sayfa, "--"));
      ekle("edition", ek.baski);
      ekle("address", bibKacis(ek.sehir));
      ekle("doi", k.doi);
      ekle("isbn", k.isbn);
      ekle("issn", ek.issn);
      ekle("url", k.url);
      ekle("abstract", bibKacis(k.ozet));
      ekle("keywords", (k.etiketler || []).join(", "));
      ekle("language", ek.dil);
      return `@${tur}{${bibAnahtari(k, kullanilan)},\n${alan.join(",\n")}\n}`;
    })
    .join("\n\n");
}

/* ---- BibTeX ayrıştırıcı ---- */

const LATEX_HARFLER = {
  '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü", y: "ÿ" },
  "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", c: "ć", n: "ń", s: "ś", z: "ź", y: "ý" },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" },
  "~": { a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ", O: "Õ" },
  c: { c: "ç", C: "Ç", s: "ş", S: "Ş", t: "ţ" },
  u: { g: "ğ", G: "Ğ", a: "ă", A: "Ă" },
  v: { c: "č", C: "Č", s: "š", S: "Š", z: "ž", Z: "Ž", r: "ř", e: "ě", n: "ň" },
  ".": { I: "İ", z: "ż", Z: "Ż" },
  "=": { a: "ā", e: "ē", i: "ī", o: "ō", u: "ū" },
  H: { o: "ő", u: "ű" },
};
const LATEX_OZEL = { "\\i": "ı", "\\ss": "ß", "\\o": "ø", "\\O": "Ø", "\\aa": "å", "\\AA": "Å", "\\ae": "æ", "\\AE": "Æ", "\\l": "ł", "\\L": "Ł", "\\&": "&", "\\%": "%", "\\$": "$", "\\#": "#", "\\_": "_", "\\textendash": "–", "\\textemdash": "—", "\\textquoteright": "’" };

export function latexTemizle(metin) {
  let s = String(metin ?? "");
  for (const [k, v] of Object.entries(LATEX_OZEL)) s = s.split(k).join(v);
  // {\"o}  \"o  \"{o}  \c{s}  \c s  \u{g}  {\.I}
  s = s.replace(/\\(["'`^~.=])\s*\{?\\?(i|[A-Za-z])\}?/g, (m, aksan, h) => (h === "i" ? LATEX_HARFLER[aksan]?.i ?? m : LATEX_HARFLER[aksan]?.[h] ?? m));
  s = s.replace(/\\([cuvH])\s*\{(\w)\}|\\([cuvH])\s+(\w)/g, (m, a1, h1, a2, h2) => {
    const a = a1 || a2;
    const h = h1 || h2;
    return LATEX_HARFLER[a]?.[h] ?? m;
  });
  s = s.replace(/\\textit\{([^}]*)\}|\\emph\{([^}]*)\}|\\textbf\{([^}]*)\}/g, (m, a, b, c) => a ?? b ?? c);
  s = s.replace(/[{}]/g, "").replace(/\\\\/g, " ").replace(/~/g, " ").replace(/\s+/g, " ");
  return s.trim();
}

/** Kaba ama sağlam .bib ayrıştırıcı: @string makroları, iç içe parantez, "…" ve {…} değerler, # birleştirme. */
export function bibtexAyristir(metin) {
  const girdi = String(metin || "").replace(/^\uFEFF/, "");
  const makrolar = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const kayitlar = [];
  let i = 0;
  const n = girdi.length;
  const bosluk = () => { while (i < n && /\s/.test(girdi[i])) i++; };

  function degerOku() {
    const parcalar = [];
    for (;;) {
      bosluk();
      let p = "";
      if (girdi[i] === "{") {
        let derin = 0;
        const bas = i + 1;
        for (; i < n; i++) {
          if (girdi[i] === "\\") { i++; continue; }
          if (girdi[i] === "{") derin++;
          else if (girdi[i] === "}") { derin--; if (derin === 0) break; }
        }
        p = girdi.slice(bas, i);
        i++;
      } else if (girdi[i] === '"') {
        const bas = ++i;
        let derin = 0;
        for (; i < n; i++) {
          if (girdi[i] === "\\") { i++; continue; }
          if (girdi[i] === "{") derin++;
          else if (girdi[i] === "}") derin--;
          else if (girdi[i] === '"' && derin === 0) break;
        }
        p = girdi.slice(bas, i);
        i++;
      } else {
        const m = /^[A-Za-z0-9_:.+\-/]+/.exec(girdi.slice(i, i + 200));
        if (!m) break;
        i += m[0].length;
        p = makrolar[m[0].toLowerCase()] ?? m[0];
      }
      parcalar.push(p);
      bosluk();
      if (girdi[i] === "#") { i++; continue; }
      break;
    }
    return parcalar.join("");
  }

  while (i < n) {
    const at = girdi.indexOf("@", i);
    if (at === -1) break;
    i = at + 1;
    const m = /^([A-Za-z]+)\s*([{(])/.exec(girdi.slice(i, i + 40));
    if (!m) continue;
    const tur = m[1].toLowerCase();
    i += m[0].length;
    const kapat = m[2] === "{" ? "}" : ")";
    if (tur === "comment" || tur === "preamble") {
      let derin = 1;
      for (; i < n && derin > 0; i++) { if (girdi[i] === m[2]) derin++; else if (girdi[i] === kapat) derin--; }
      continue;
    }
    if (tur === "string") {
      bosluk();
      const ad = /^[A-Za-z0-9_:\-]+/.exec(girdi.slice(i, i + 100));
      if (ad) { i += ad[0].length; bosluk(); if (girdi[i] === "=") { i++; makrolar[ad[0].toLowerCase()] = degerOku(); } }
      while (i < n && girdi[i] !== kapat) i++;
      i++;
      continue;
    }
    bosluk();
    const anahtarM = /^[^,\s]+/.exec(girdi.slice(i, i + 200));
    const citekey = anahtarM ? anahtarM[0] : "";
    i += citekey.length;
    const alanlar = {};
    for (;;) {
      bosluk();
      if (girdi[i] === ",") { i++; continue; }
      if (i >= n || girdi[i] === kapat) { i++; break; }
      const ad = /^[A-Za-z0-9_:\-]+/.exec(girdi.slice(i, i + 100));
      if (!ad) { i++; continue; }
      i += ad[0].length;
      bosluk();
      if (girdi[i] !== "=") continue;
      i++;
      alanlar[ad[0].toLowerCase()] = degerOku();
    }
    kayitlar.push({ tur, citekey, alanlar });
  }
  return kayitlar.map(bibKaydiniKayda);
}

/** "Soyad, Ad and Ad Soyad and {Kurum}" → [{adi,soyadi}|{kurum}] (ayraç yalnızca parantez dışındaki " and ") */
function bibYazarlari(ham) {
  const parcalar = [];
  let derin = 0, bas = 0;
  for (let k = 0; k < ham.length; k++) {
    if (ham[k] === "{") derin++;
    else if (ham[k] === "}") derin--;
    else if (derin === 0 && /\sand\s/i.test(ham.slice(k, k + 5)) && /\s/.test(ham[k])) {
      parcalar.push(ham.slice(bas, k));
      bas = k + 5;
      k += 4;
    }
  }
  parcalar.push(ham.slice(bas));
  return parcalar
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const kurum = /^\{([^{}]+)\}$/.exec(p);
      if (kurum) return { kurum: latexTemizle(kurum[1]) };
      const kisimlar = p.split(",").map((x) => x.trim());
      if (kisimlar.length >= 2) return { adi: latexTemizle(kisimlar[kisimlar.length - 1]), soyadi: latexTemizle(kisimlar[0]) };
      const kelimeler = latexTemizle(p).split(/\s+/);
      return kelimeler.length === 1 ? { adi: "", soyadi: kelimeler[0] } : { adi: kelimeler.slice(0, -1).join(" "), soyadi: kelimeler[kelimeler.length - 1] };
    });
}

const TUR_BIB_TERS = { article: "makale", book: "kitap", booklet: "kitap", inbook: "kitap_bolumu", incollection: "kitap_bolumu", inproceedings: "bildiri", conference: "bildiri", phdthesis: "tez", mastersthesis: "tez", thesis: "tez", techreport: "rapor", report: "rapor", misc: "diger", online: "web", electronic: "web", unpublished: "diger" };

function bibKaydiniKayda({ tur, alanlar: a }) {
  const t = TUR_BIB_TERS[tur] || "diger";
  const al = (k) => latexTemizle(a[k] || "");
  const yilM = /(\d{4})/.exec(a.year || a.date || "");
  const doiHam = al("doi").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  const kap = t === "makale" ? al("journal") || al("journaltitle") : t === "bildiri" ? al("booktitle") : t === "tez" ? al("school") || al("institution") : t === "rapor" ? al("institution") || al("publisher") : t === "web" || t === "diger" ? al("howpublished") || al("organization") || al("publisher") : al("publisher");
  const ek = {};
  const koy = (k, v) => { if (v) ek[k] = v; };
  koy("cilt", al("volume"));
  koy("sayi", al("number") || al("issue"));
  koy("sayfa", al("pages").replace(/\s*[-–—]+\s*/g, "-"));
  koy("baski", al("edition"));
  koy("sehir", al("address") || al("location"));
  koy("issn", al("issn"));
  koy("dil", al("language"));
  if (t === "kitap_bolumu") { koy("kitap_adi", al("booktitle")); koy("yayinevi", al("publisher")); koy("editor", bibYazarlari(a.editor || "").map((y) => (y.adi ? `${y.soyadi}, ${y.adi}` : y.soyadi || "")).join("\n")); }
  if (t === "bildiri") koy("yayinevi", al("publisher"));
  if (t === "tez") koy("tez_turu", tur === "mastersthesis" ? "Yüksek lisans tezi" : al("type") || "Doktora tezi");
  if (t === "rapor") koy("rapor_no", al("number"));
  return {
    baslik: al("title") || "(Başlıksız)",
    yazarlar: bibYazarlari(a.author || ""),
    yayin_yili: yilM ? Number(yilM[1]) : null,
    dergi_veya_yayinevi: kap || null,
    doi: /^10\.\d{4,9}\/\S+$/.test(doiHam) ? doiHam : null,
    isbn: /^[0-9Xx-]{10,17}$/.test(al("isbn")) ? al("isbn") : null,
    url: al("url") || null,
    ozet: al("abstract") || null,
    etiketler: al("keywords").split(/\s*[,;]\s*/).filter(Boolean),
    tur: t,
    ek_alanlar: ek,
  };
}

/* ======================================= RIS ======================================= */

const RIS_TUR = { JOUR: "makale", JFULL: "makale", MGZN: "makale", NEWS: "makale", BOOK: "kitap", EBOOK: "kitap", CHAP: "kitap_bolumu", ECHAP: "kitap_bolumu", CONF: "bildiri", CPAPER: "bildiri", THES: "tez", RPRT: "rapor", ELEC: "web", WEB: "web", BLOG: "web", GEN: "diger" };
const TUR_RIS = { makale: "JOUR", kitap: "BOOK", kitap_bolumu: "CHAP", bildiri: "CPAPER", tez: "THES", rapor: "RPRT", web: "ELEC", diger: "GEN" };

function risIsim(ham) {
  const p = S(ham);
  if (!p) return null;
  if (p.includes(",")) {
    const [soyadi, ...geri] = p.split(",");
    return { adi: geri.join(",").trim(), soyadi: soyadi.trim() };
  }
  const k = p.split(/\s+/);
  return k.length === 1 ? { kurum: p } : { adi: k.slice(0, -1).join(" "), soyadi: k[k.length - 1] };
}

export function risAyristir(metin) {
  const satirlar = String(metin || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const kayitlar = [];
  let akim = null;
  let son = null;
  for (const satir of satirlar) {
    const m = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/.exec(satir);
    if (m) {
      const [, etiket, deger] = m;
      if (etiket === "TY") { akim = { TY: deger.trim(), alanlar: {} }; son = null; continue; }
      if (etiket === "ER") { if (akim) kayitlar.push(akim); akim = null; son = null; continue; }
      if (!akim) continue;
      (akim.alanlar[etiket] ||= []).push(deger.trim());
      son = etiket;
    } else if (akim && son && satir.trim()) {
      const liste = akim.alanlar[son];
      liste[liste.length - 1] += ` ${satir.trim()}`;
    }
  }
  if (akim) kayitlar.push(akim);

  return kayitlar.map(({ TY, alanlar: a }) => {
    const ilk = (...k) => { for (const x of k) if (a[x]?.[0]) return a[x][0]; return ""; };
    const t = RIS_TUR[TY] || "diger";
    const yilM = /(\d{4})/.exec(ilk("PY", "Y1", "DA", "Y2"));
    const sn = ilk("SN").replace(/[^0-9Xx-]/g, "");
    const sade = sn.replace(/-/g, "");
    const isbn = sade.length === 10 || sade.length === 13 ? sn : "";
    const issn = sade.length === 8 ? sn : "";
    const ek = {};
    const koy = (k, v) => { if (v) ek[k] = v; };
    koy("cilt", ilk("VL"));
    koy("sayi", ilk("IS"));
    const sp = ilk("SP");
    const ep = ilk("EP");
    koy("sayfa", sp && ep ? `${sp}-${ep}` : sp);
    koy("baski", ilk("ET"));
    koy("sehir", ilk("CY"));
    koy("issn", issn);
    koy("dil", ilk("LA"));
    if (t === "kitap_bolumu") { koy("kitap_adi", ilk("T2", "BT")); koy("yayinevi", ilk("PB")); koy("editor", (a.A2 || a.ED || []).join("\n")); }
    if (t === "tez") koy("tez_turu", ilk("M3"));
    if (t === "rapor") koy("rapor_no", ilk("M1"));
    const doiHam = ilk("DO").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    const kap = t === "makale" ? ilk("JO", "JF", "JA", "T2", "J2") : t === "bildiri" ? ilk("T2", "BT", "JO") : t === "kitap" || t === "rapor" ? ilk("PB") : t === "tez" ? ilk("PB", "T2") : t === "web" ? ilk("T2", "PB") : ilk("PB", "T2");
    return {
      baslik: ilk("TI", "T1", "CT") || "(Başlıksız)",
      yazarlar: [...(a.AU || []), ...(a.A1 || [])].map(risIsim).filter(Boolean),
      yayin_yili: yilM ? Number(yilM[1]) : null,
      dergi_veya_yayinevi: kap || null,
      doi: /^10\.\d{4,9}\/\S+$/.test(doiHam) ? doiHam : null,
      isbn: isbn || null,
      url: ilk("UR", "L1") || null,
      ozet: ilk("AB", "N2") || null,
      etiketler: (a.KW || []).flatMap((k) => k.split(/\s*;\s*/)).filter(Boolean),
      tur: t,
      ek_alanlar: ek,
    };
  });
}

export function risUret(kayitlar) {
  return kayitlar
    .map((k) => {
      const ek = k.ek_alanlar || {};
      const t = k.tur || "makale";
      const s = [`TY  - ${TUR_RIS[t] || "GEN"}`];
      const ekle = (etiket, deger) => { if (S(deger)) s.push(`${etiket}  - ${S(deger).replace(/\r?\n/g, " ")}`); };
      (k.yazarlar || []).forEach((y) => ekle("AU", y.kurum ? y.kurum : y.adi ? `${y.soyadi}, ${y.adi}` : y.soyadi));
      ekle("TI", k.baslik);
      if (t === "makale") ekle("JO", k.dergi_veya_yayinevi);
      else if (t === "bildiri") ekle("T2", k.dergi_veya_yayinevi);
      else if (t === "web") ekle("T2", k.dergi_veya_yayinevi);
      else if (t === "tez") ekle("PB", k.dergi_veya_yayinevi);
      else { ekle("PB", k.dergi_veya_yayinevi || ek.yayinevi); if (t === "kitap_bolumu") { ekle("T2", ek.kitap_adi); yazarMetniAyristir(ek.editor).forEach((y) => ekle("A2", y.adi ? `${y.soyadi}, ${y.adi}` : y.soyadi)); } }
      ekle("PY", k.yayin_yili);
      ekle("VL", ek.cilt);
      ekle("IS", ek.sayi);
      const [sp, ep] = S(ek.sayfa).split(/\s*[-–—]+\s*/);
      ekle("SP", sp);
      ekle("EP", ep);
      ekle("ET", ek.baski);
      ekle("CY", ek.sehir);
      ekle("DO", k.doi);
      ekle("SN", k.isbn || ek.issn);
      ekle("UR", k.url);
      ekle("AB", k.ozet);
      ekle("LA", ek.dil);
      (k.etiketler || []).forEach((e) => ekle("KW", e));
      s.push("ER  - ");
      return s.join("\r\n");
    })
    .join("\r\n\r\n");
}

/** Dosya adına/içeriğe bakarak biçimi tahmin eder: 'bib' | 'ris' | null */
export function icerikBicimiTahmin(ad, metin) {
  if (/\.bib(tex)?$/i.test(ad)) return "bib";
  if (/\.ris$/i.test(ad)) return "ris";
  const bas = String(metin || "").slice(0, 2000);
  if (/^\s*@\w+\s*[{(]/m.test(bas)) return "bib";
  if (/^TY\s{1,2}-/m.test(bas)) return "ris";
  return null;
}
