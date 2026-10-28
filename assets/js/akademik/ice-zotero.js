/*
 * assets/js/akademik/ice-zotero.js — ZOTERO RDF içe aktarma (Dosya ▸ Kütüphaneyi Dışa Aktar ▸ "Zotero RDF" + "Dosyaları dışa aktar").
 * RDF; künyeleri, etiketleri, ek dosya yollarını ve KOLEKSİYON (klasör) ağacını eksiksiz taşır. Çıktı bibtex/ris ayrıştırıcılarıyla AYNI biçimdedir
 * (kayıt + _klasor yolları + _dosya yolları) → tek bir içe aktarma hattı kullanılır. Tüm işlem tarayıcıda yapılır; hiçbir şey üçüncü tarafa gönderilmez.
 * NOT (Zotero'nun kendi sınırı): Zotero 7 vurgu/notları PDF'in İÇİNE değil kendi veritabanına yazar; dışa aktarılan RDF/dosyalarda bulunmaz.
 * Vurguların gelmesi için Zotero'da PDF'e sağ tık ▸ "PDF'yi Aç/Dışa Aktar…" ile açıklamalı PDF'yi kaydedip bu sitede yükle.
 */
import { doiTemizle } from "./kunye.js";
import { yazarMetniAyristir } from "./atif.js";

const NS = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", z: "http://www.zotero.org/namespaces/export#", dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/", bib: "http://purl.org/net/biblio#", foaf: "http://xmlns.com/foaf/0.1/", prism: "http://prismstandard.org/namespaces/1.2/basic/",
  link: "http://purl.org/rss/1.0/modules/link/", vcard: "http://nwalsh.com/rdf/vCard#",
};
const TUR = { journalArticle: "makale", magazineArticle: "makale", newspaperArticle: "makale", book: "kitap", bookSection: "kitap_bolumu", conferencePaper: "bildiri", thesis: "tez", report: "rapor", webpage: "web", blogPost: "web", document: "diger" };

const cocuklar = (el, ns, yerel) => [...el.children].filter((c) => c.namespaceURI === NS[ns] && c.localName === yerel);
const ilk = (el, ns, yerel) => cocuklar(el, ns, yerel)[0] || null;
const metin = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const derin = (el, ns, yerel) => [...el.getElementsByTagNameNS(NS[ns], yerel)];
const kaynakAdi = (el) => el.getAttributeNS(NS.rdf, "about") || el.getAttributeNS(NS.rdf, "resource") || "";
const yil = (s) => { const m = /(\d{4})/.exec(s || ""); return m ? Number(m[1]) : null; };

/** @returns {{kayitlar: object[], klasorSayisi: number}} her kayıtta _klasor (yol dizileri) ve _dosya (RDF'teki göreli dosya yolları) bulunur. */
export function rdfAyristir(xml) {
  const belge = new DOMParser().parseFromString(String(xml || "").replace(/^\uFEFF/, ""), "application/xml");
  if (belge.querySelector("parsererror")) throw new Error("RDF dosyası okunamadı (geçerli bir XML değil).");
  const kok = belge.documentElement;
  const hepsi = [...kok.children];
  const zTur = (el) => metin(ilk(el, "z", "itemType"));

  // Ekler: z:Attachment → dosya yolu
  const ekler = new Map();
  for (const el of hepsi) {
    if (el.namespaceURI === NS.z && el.localName === "Attachment") {
      const r = ilk(el, "rdf", "resource");
      const yol = r?.getAttributeNS(NS.rdf, "resource") || "";
      const tip = metin(ilk(el, "link", "type"));
      ekler.set(kaynakAdi(el), { yol, pdf: /pdf/i.test(tip) || /\.pdf$/i.test(yol) });
    }
  }
  // Koleksiyonlar
  const kolek = new Map();
  for (const el of hepsi) {
    if (el.namespaceURI === NS.z && el.localName === "Collection") {
      kolek.set(kaynakAdi(el), { ad: metin(ilk(el, "dc", "title")) || "Adsız klasör", parcalar: cocuklar(el, "dcterms", "hasPart").map((h) => h.getAttributeNS(NS.rdf, "resource")).filter(Boolean) });
    }
  }
  const ustu = new Map(); const ogeKlasor = new Map();
  for (const [id, k] of kolek) for (const p of k.parcalar) { if (kolek.has(p)) ustu.set(p, id); else { if (!ogeKlasor.has(p)) ogeKlasor.set(p, []); ogeKlasor.get(p).push(id); } }
  const yolu = (id) => { const y = []; let c = id, n = 0; while (c && n++ < 30) { y.unshift(kolek.get(c)?.ad || "?"); c = ustu.get(c); } return y; };

  // Notlar: bib:Memo / z:itemType=note → ana kaynağa dcterms:isReferencedBy ile bağlanır
  const notlar = new Map();
  for (const el of hepsi) {
    if (el.namespaceURI === NS.bib && el.localName === "Memo") {
      const govde = metin(ilk(el, "rdf", "value")) || metin(el);
      if (govde) notlar.set(kaynakAdi(el), govde.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    }
  }
  const kayitlar = [];
  for (const el of hepsi) {
    if (el.namespaceURI === NS.z && (el.localName === "Attachment" || el.localName === "Collection")) continue;
    if (el.namespaceURI === NS.bib && ["Memo", "Recording"].includes(el.localName) && !ilk(el, "dc", "title")) continue;
    const baslik = metin(ilk(el, "dc", "title"));
    const tip = zTur(el);
    if (!baslik || tip === "note" || tip === "attachment") continue;

    const yazarlar = [];
    for (const rol of ["authors", "contributors"]) {
      const a = ilk(el, "bib", rol); if (!a) continue;
      for (const kisi of derin(a, "foaf", "Person")) { const soyad = metin(ilk(kisi, "foaf", "surname")), ad = metin(ilk(kisi, "foaf", "givenName")); if (soyad || ad) yazarlar.push(ad ? { adi: ad, soyadi: soyad } : { kurum: soyad }); }
      if (yazarlar.length) break;
    }
    const kap = ilk(el, "dcterms", "isPartOf"); const kapIc = kap ? [...kap.children][0] : null;
    const kapBaslik = metin(kapIc ? ilk(kapIc, "dc", "title") : null);
    const yayinevi = metin(derin(el, "foaf", "name")[0]) || "";
    const sehir = metin(derin(el, "vcard", "locality")[0]) || "";
    const idler = cocuklar(el, "dc", "identifier");
    let doi = ""; let url = ""; let isbn = "";
    for (const i of idler) {
      const m = metin(i) || metin(derin(i, "rdf", "value")[0]);
      if (/^DOI\b/i.test(m) || /^10\.\d{4,9}\//.test(m)) doi = doiTemizle(m.replace(/^DOI\s*/i, "")) || doi;
      else if (/^ISBN/i.test(m)) isbn = m.replace(/^ISBN\s*/i, "");
      else if (derin(i, "dcterms", "URI").length) url = metin(derin(i, "rdf", "value")[0]) || url;
    }
    if (kapIc) for (const i of cocuklar(kapIc, "dc", "identifier")) { const m = metin(i); if (/^DOI/i.test(m) || /^10\./.test(m)) doi = doiTemizle(m.replace(/^DOI\s*/i, "")) || doi; }
    const etiketler = cocuklar(el, "dc", "subject").map((s) => metin(s) || metin(derin(s, "rdf", "value")[0])).filter(Boolean);
    const sayfa = metin(ilk(el, "bib", "pages")) || [metin(ilk(el, "prism", "pageStart")), metin(ilk(el, "prism", "endingPage"))].filter(Boolean).join("-");
    const t = TUR[tip] || "diger";
    const ek = {};
    const koy = (k, v) => { if (v) ek[k] = v; };
    koy("cilt", metin(kapIc ? ilk(kapIc, "prism", "volume") : null)); koy("sayi", metin(kapIc ? ilk(kapIc, "prism", "number") : null));
    koy("sayfa", sayfa.replace(/\s*[-–—]+\s*/g, "-")); koy("sehir", sehir); koy("baski", metin(ilk(el, "z", "edition")) || "");
    if (t === "kitap_bolumu") { koy("kitap_adi", kapBaslik); koy("yayinevi", yayinevi); }
    if (t === "tez") koy("tez_turu", metin(ilk(el, "z", "type")));
    const adres = kaynakAdi(el);
    const dosyalar = cocuklar(el, "link", "link").map((l) => ekler.get(l.getAttributeNS(NS.rdf, "resource"))).filter((x) => x?.pdf && x.yol).map((x) => x.yol);
    kayitlar.push({
      baslik, yazarlar,
      yayin_yili: yil(metin(ilk(el, "dc", "date"))),
      dergi_veya_yayinevi: (t === "makale" || t === "bildiri" ? kapBaslik : yayinevi || kapBaslik) || null,
      doi: doi || null, isbn: isbn || null, url: url || null, ozet: metin(ilk(el, "dcterms", "abstract")) || null,
      etiketler, tur: t, ek_alanlar: ek,
      _klasor: (ogeKlasor.get(adres) || []).map(yolu), _dosya: dosyalar,
      _notlar: cocuklar(el, "dcterms", "isReferencedBy").map((r) => notlar.get(r.getAttributeNS(NS.rdf, "resource"))).filter(Boolean),
    });
  }
  return { kayitlar, klasorSayisi: kolek.size };
}

/** Seçilen klasördeki (webkitdirectory) dosyalardan, göreli yola göre eşleşeni bulur. */
export function dosyaBul(dosyalar, goreli) {
  const hedef = String(goreli).replace(/^\.?\//, "").replace(/\\/g, "/").toLowerCase();
  return dosyalar.find((f) => { const y = (f.webkitRelativePath || f.name).replace(/\\/g, "/").toLowerCase(); return y.endsWith(`/${hedef}`) || y === hedef; }) || null;
}
