/**
 * ui-konum.js — Konum şeridi + arama + kaydetme + düzenleme (v4).
 *  • Kayıtlı konumlar yatay KARTLAR olarak görünür: her kartta AÇIK KONUM İSMİ (ör. "Evim - Kadıköy"), yer ayrıntısı ve son sıcaklık; dokununca seçilir.
 *    Kayıtlı kartların köşesinde ✏️ "Düzenle" düğmesi: isim/etiket, simge ve (yeni arama ile) koordinat güncellenir (bulutta UPDATE).
 *  • Arama: önce İNTERNETSİZ il eşleşmesi, sonra dünya geneli Open-Meteo. Seçim AÇIKTIR (listeden seçmeden konum değişmez).
 *  • Sokak/adres (küresel): Enter ya da 🔎 düğmesiyle SERBEST METİN ("Times Square, New York") ve "Adım adım" HİYERARŞİK arama (Ülke → Şehir → İlçe → Mahalle/Cadde).
 *    Koordinat yuvarlanmaz; rakım hava yanıtıyla birlikte gelir ve aktif konum satırında gösterilir.
 *  • Vitrin modu (demo/misafir): konum kaydetme/düzenleme pasif; arama ve görüntüleme açık.
 *  • "Bulunduğum yer": izin yoksa/reddedilmişse tarayıcıya özel adımlarla yönlendirir.
 */
import { el, olay, rozet, ipucu, cipGrubu, izinYardimKarti, bosalt, etiket } from "./ui-temel.js";
import { yerAra, adresAra, sonSicaklik, adEnTamamla } from "./veri.js";
import { yerelIlAra, ilAdindan, enYakinIl, BOLGELER } from "./iller.js";
import { IKONLAR, IKON_ADLARI, kayitliMi, konumKimligi, sonAramalar, sonAramaEkle, gorunenAd } from "./konumlar.js";
import { izinDurumu, konumHataMetni } from "./izin-yardim.js";

/** Open-Meteo/Nominatim/Photon/yerel sonucu → konum nesnesi */
export function sonucuKonumaCevir(r) {
  const k = { omId: r.omId, ad: r.ad, adEn: r.adEn, lat: r.lat, lon: r.lon, ulke: r.ulke, ulkeAd: r.ulkeAd, ulkeAdEn: r.ulkeAdEn, admin1: r.admin1, admin1En: r.admin1En, mahalle: r.mahalle, sokak: r.sokak };
  if (r.ulke === "TR") {
    const il = ilAdindan(r.il || r.admin1) || enYakinIl(r.lat, r.lon);
    if (il) { k.il = il.ad; k.admin1 = il.ad; k.admin1En = il.ad; }
    const ilce = r.admin2 || (r.ad && il && r.ad !== il.ad ? r.ad : "");
    if (ilce && (!il || ilce !== il.ad)) k.ilce = ilce;
  } else if (r.admin2 && r.admin2 !== r.ad) k.ilce = r.admin2;
  return k;
}
const BAYRAK = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "🌍");
const altMetin = (k) => [k.etiket && k.etiket !== k.ad ? k.ad : null, k.mahalle, k.ilce, k.il || k.admin1, k.ulkeAd].filter((x, i, a) => x && a.indexOf(x) === i && x !== gorunenAd(k)).slice(0, 3).join(" · ");

/**
 * @param {{konum:object, konumlar:object[], vitrin?:boolean, hava?:object}} d  paylaşılan durum
 * @param {{sec:(k:object, o?:object)=>void, kaydetDegistir:(k:object)=>void, guncelle:(id:string,a:object)=>void, sil:(id:string)=>void, ilkeAl:(id:string)=>void}} kb
 */
export function konumBileseni(d, kb) {
  const seritKutu = el("div", { class: "hv-serit", role: "list", "aria-label": "Konumlarım" });
  const aktifBaslik = el("div", { class: "hv-aktif-konum" });
  const duzenle = el("div", { class: "hv-duzenle", hidden: true });
  const giris = el("input", { type: "search", class: "hv-girdi", placeholder: "Şehir, ilçe, mahalle ya da adres yaz (örn. Times Square, New York)", "aria-label": "Konum ara", autocomplete: "off", maxlength: "120", enterkeyhint: "search" });
  const sonuclar = el("ul", { class: "hv-sonuclar", role: "listbox" });
  const mesaj = el("p", { class: "hv-ipucu", hidden: true });
  const yardimYeri = el("div");
  const adresDugme = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "🔎 Adres/sokak ara" }), "click", () => serbestAdres());
  const hiyerarsi = hiyerarsiKutusu();
  const arama = el("div", { class: "hv-arama", hidden: true }, el("div", { class: "hv-arama-satir" }, giris, adresDugme), mesaj, yardimYeri, sonuclar, hiyerarsi.kok,
    el("p", { class: "hv-ipucu hv-gizlilik-not", text: "Aradığın yerler hesabına kaydedilmez: öneriler Open-Meteo'dan, adres/sokak aramaları OpenStreetMap'ten (yalnızca yazdığın metinle ve sen istediğinde) alınır." }));
  const kok = el("div", { class: "hv-konum" }, seritKutu, aktifBaslik, duzenle, arama);

  let aktifSatir = -1, satirlar = [], no = 0, zamanlayici = 0, duzenlenen = null;
  const vitrin = () => !!d.vitrin;

  /* ---------------- şerit ---------------- */
  function kartCiz(k, { gps = false } = {}) {
    const son = sonSicaklik(k.lat, k.lon);
    const secili = !gps && (d.konum && konumKimligi(d.konum) === k.id);
    const b = el("button", { type: "button", class: `hv-konum-kart${secili ? " aktif" : ""}`, role: "listitem", "aria-current": secili ? "true" : null },
      el("span", { class: "hv-konum-ikon", text: gps ? "📍" : IKONLAR[k.ikon] || "📍" }),
      el("span", { class: "hv-konum-metin" }, el("strong", { text: gps ? "Bulunduğum yer" : gorunenAd(k) }), el("small", { text: gps ? "Cihaz konumu" : altMetin(k) || "—" })),
      son ? el("span", { class: "hv-konum-sic", text: `${son.app}°` }) : null);
    olay(b, "click", () => (gps ? gpsDene() : kb.sec(k)));
    if (gps || vitrin()) return b;
    const kalem = olay(el("button", { type: "button", class: "hv-kalem", "aria-label": `${gorunenAd(k)} konumunu düzenle`, title: "Düzenle" }, el("span", { "aria-hidden": "true", text: "✏️" })), "click", (e) => { e.stopPropagation(); duzenleAc(k); });
    return el("div", { class: "hv-konum-sarmal" }, b, kalem);
  }
  function ciz() {
    const kartlar = d.konumlar.map((k) => kartCiz(k));
    const ekleBtn = el("button", { type: "button", class: "hv-konum-kart hv-konum-ekle", role: "listitem", "aria-expanded": String(!arama.hidden) },
      el("span", { class: "hv-konum-ikon", text: "＋" }), el("span", { class: "hv-konum-metin" }, el("strong", { text: "Konum ekle" }), el("small", { text: "Ara veya bul" })));
    olay(ekleBtn, "click", () => aramaAcKapa());
    seritKutu.replaceChildren(...kartlar, kartCiz({ lat: 0, lon: 0, id: "gps" }, { gps: true }), ekleBtn);
    aktifCiz();
  }
  function aktifCiz() {
    const k = d.konum;
    const kayitli = kayitliMi(d.konumlar, k);
    const kayitliKonum = kayitli ? d.konumlar.find((x) => x.id === konumKimligi(k) || (x.ad === k.ad && Math.abs(x.lat - k.lat) < 0.01 && Math.abs(x.lon - k.lon) < 0.01)) : null;
    const baslikAd = gorunenAd(kayitliKonum || k);
    const rakim = d.hava?.ham?.rakim;
    const alt = [kayitliKonum?.etiket && kayitliKonum.etiket !== k.ad ? k.ad : null, k.mahalle, k.ilce, k.il || k.admin1, k.ulkeAd].filter((x, i, a) => x && a.indexOf(x) === i && x !== baslikAd).join(" · ");
    const koord = `${Number(k.lat).toFixed(5)}, ${Number(k.lon).toFixed(5)}${Number.isFinite(rakim) ? ` · rakım ${rakim} m` : ""}`;
    let yildiz;
    if (vitrin()) yildiz = el("button", { type: "button", class: "hv-yildiz", disabled: true, "aria-label": "Vitrin modunda konum kaydedilemez", title: "Vitrin modunda konum kaydedilemez" }, el("span", { "aria-hidden": "true", text: "☆" }));
    else {
      yildiz = el("button", { type: "button", class: `hv-yildiz${kayitli ? " dolu" : ""}`, "aria-pressed": String(kayitli), "aria-label": kayitli ? "Kayıtlı konum (düzenlemek için dokun)" : "Bu konumu kaydet", title: kayitli ? "Kayıtlı — düzenle" : "Kaydet" }, el("span", { "aria-hidden": "true", text: kayitli ? "★" : "☆" }));
      olay(yildiz, "click", () => { if (kayitli) { duzenleAc(kayitliKonum || k); } else { kb.kaydetDegistir(k); const yeni = d.konumlar.find((x) => x.id === konumKimligi(k)); if (yeni) duzenleAc(yeni, true); } });
    }
    aktifBaslik.replaceChildren(
      el("div", { class: "hv-aktif-metin" }, el("strong", { text: baslikAd }), alt ? el("small", { text: alt }) : null, el("small", { class: "hv-koordinat", text: koord })),
      vitrin() ? rozet("Vitrin · İstanbul", "hv-rozet-onemli") : kayitli ? rozet("Kayıtlı", "hv-rozet-ok") : rozet("Kayıtlı değil"), yildiz);
  }

  /* ---------------- düzenleme paneli (isim + simge + yeni arama ile koordinat) ---------------- */
  function duzenleAc(k, yeni = false) {
    if (vitrin()) return;
    duzenlenen = { ...k, _yeniNokta: null };
    const ad = el("input", { type: "text", class: "hv-girdi", value: gorunenAd(k), maxlength: "40", "aria-label": "Konum ismi", placeholder: "Örn. Evim - Kadıköy" });
    const ikonGrup = cipGrubu({ baslik: "Simge", secenekler: Object.entries(IKON_ADLARI).map(([id, a]) => [id, `${IKONLAR[id]} ${a}`]), aktif: () => duzenlenen.ikon || "diger", onSec: (v) => { duzenlenen = { ...duzenlenen, ikon: v }; }, kucuk: true });
    const yeniAra = el("input", { type: "search", class: "hv-girdi", placeholder: "Yeni konum ara (isteğe bağlı): şehir, mahalle ya da adres", "aria-label": "Yeni konum ara", maxlength: "120" });
    const yeniSonuc = el("ul", { class: "hv-sonuclar hv-mini-sonuc" });
    const yeniDurum = el("p", { class: "hv-ipucu", text: `Şu an: ${Number(k.lat).toFixed(5)}, ${Number(k.lon).toFixed(5)}` });
    const araBtn = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "🔎 Ara" }), "click", async () => {
      const q = yeniAra.value.trim(); if (q.length < 3) { yeniDurum.textContent = "En az 3 harf yaz."; return; }
      araBtn.disabled = true; yeniDurum.textContent = "Aranıyor…";
      let liste = [];
      try { liste = (await yerAra(q)).slice(0, 8); } catch { /* adrese düş */ }
      if (!liste.length) { try { liste = (await adresAra(q)).slice(0, 8); } catch { /* sonuç yok */ } }   // TEK kaynak sırayla: yalnız gerekirse ikincisine gidilir
      araBtn.disabled = false;
      yeniDurum.textContent = liste.length ? "Yeni noktayı seç:" : "Sonuç bulunamadı.";
      yeniSonuc.replaceChildren(...liste.map((r) => el("li", { class: "hv-sonuc", role: "presentation" }, olay(el("button", { type: "button", class: "hv-sonuc-ana" },
        el("span", { class: "hv-bayrak", "aria-hidden": "true", text: BAYRAK(r.ulke) }), el("span", { class: "hv-konum-metin" }, el("strong", { text: r.ad }), el("small", { text: r.ayrinti || [r.admin2, r.admin1, r.ulkeAd].filter(Boolean).join(", ") }))), "click", () => {
        duzenlenen._yeniNokta = sonucuKonumaCevir(r);
        yeniDurum.textContent = `Yeni nokta seçildi: ${r.ad} (${Number(r.lat).toFixed(5)}, ${Number(r.lon).toFixed(5)}). “Kaydet”e basınca güncellenir.`;
        yeniSonuc.replaceChildren();
      }))));
    });
    olay(yeniAra, "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); araBtn.click(); } });
    const kaydet = el("button", { type: "button", class: "hv-btn hv-btn-birincil", text: "Kaydet" });
    const ilk = el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "İlk sıraya al" });
    const sil = el("button", { type: "button", class: "hv-btn hv-btn-ince hv-btn-tehlike", text: "Kaldır" });
    const kapat = el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Vazgeç" });
    olay(kaydet, "click", () => {
      const yeniAd = ad.value.trim();
      const alanlar = { ikon: duzenlenen.ikon || "diger", etiket: yeniAd && yeniAd !== k.ad ? yeniAd : "" };
      const n = duzenlenen._yeniNokta;
      if (n) Object.assign(alanlar, { lat: n.lat, lon: n.lon, ad: n.ad, adEn: n.adEn, ulke: n.ulke, ulkeAd: n.ulkeAd, ulkeAdEn: n.ulkeAdEn, admin1: n.admin1, admin1En: n.admin1En, il: n.il, ilce: n.ilce, mahalle: n.mahalle, sokak: n.sokak, etiket: yeniAd || n.ad });
      kb.guncelle(k.id, alanlar); duzenle.hidden = true;
    });
    olay(ilk, "click", () => { kb.ilkeAl(k.id); duzenle.hidden = true; });
    olay(sil, "click", () => { kb.sil(k.id); duzenle.hidden = true; });
    olay(kapat, "click", () => { duzenle.hidden = true; });
    olay(ad, "keydown", (e) => { if (e.key === "Enter") kaydet.click(); });
    duzenle.replaceChildren(etiket(yeni ? "Konum kaydedildi — ismini ve simgesini seç" : "Konumu düzenle"), etiket("Konum ismi"), ad, ikonGrup.kok,
      etiket("Konumu değiştir (isteğe bağlı)"), el("div", { class: "hv-arama-satir" }, yeniAra, araBtn), yeniDurum, yeniSonuc, el("div", { class: "hv-btn-satir" }, kaydet, ilk, sil, kapat));
    duzenle.hidden = false;
    ad.focus(); ad.select();
  }

  /* ---------------- hiyerarşik arama ---------------- */
  function hiyerarsiKutusu() {
    const alan = (ad, ph) => el("input", { type: "text", class: "hv-girdi", placeholder: ph, "aria-label": ad, maxlength: "60", autocomplete: "off" });
    const ulke = alan("Ülke", "Ülke (örn. Almanya)"), sehir = alan("Şehir", "Şehir (örn. Münih)"), ilce = alan("İlçe", "İlçe / semt (isteğe bağlı)"), mahalle = alan("Mahalle veya cadde", "Mahalle / cadde (isteğe bağlı)");
    const git = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Adım adım ara" }), "click", () => {
      const girdi = { ulke: ulke.value, sehir: sehir.value, ilce: ilce.value, mahalle: mahalle.value };
      if ([girdi.ulke, girdi.sehir, girdi.ilce, girdi.mahalle].join("").trim().length < 3) { mesajGoster("Ülke → Şehir → İlçe → Mahalle/Cadde alanlarından en az birkaçını doldur."); return; }
      adresCalistir(girdi, [girdi.mahalle, girdi.ilce, girdi.sehir, girdi.ulke].filter((x) => x.trim()).join(", "));
    });
    return { kok: el("details", { class: "hv-hiyerarsi" }, el("summary", { text: "🧭 Adım adım ara: Ülke → Şehir → İlçe → Mahalle/Cadde" }), el("div", { class: "hv-hiyerarsi-govde" }, ulke, sehir, ilce, mahalle, git)) };
  }

  /* ---------------- arama ---------------- */
  function aramaAcKapa(ac) {
    arama.hidden = ac === undefined ? !arama.hidden : !ac;
    ciz();
    if (!arama.hidden) { sonuclariGoster(); giris.focus(); }
  }
  function satirYap(r, tur) {
    const konum = sonucuKonumaCevir(r);
    const kayitli = kayitliMi(d.konumlar, konum);
    const sec = el("button", { type: "button", class: "hv-sonuc-ana", role: "option" },
      el("span", { class: "hv-bayrak", "aria-hidden": "true", text: tur === "son" ? "🕘" : BAYRAK(r.ulke || (konum.il ? "TR" : "")) }),
      el("span", { class: "hv-konum-metin" }, el("strong", { text: r.ad }), el("small", { text: r.ayrinti || [r.admin2, r.admin1, r.ulkeAd].filter(Boolean).join(", ") })),
      tur === "il" ? rozet("İl") : r.kaynak ? rozet(r.kaynak) : null);
    olay(sec, "click", async () => { aramaAcKapa(false); giris.value = ""; const tam = await adEnTamamla(konum); sonAramaEkle(tam); kb.sec(tam); });
    if (vitrin()) return el("li", { class: "hv-sonuc", role: "presentation" }, sec);
    const yildiz = el("button", { type: "button", class: `hv-yildiz${kayitli ? " dolu" : ""}`, "aria-pressed": String(kayitli), "aria-label": `${r.ad} konumunu ${kayitli ? "kayıttan çıkar" : "kaydet"}`, title: kayitli ? "Kayıtlı" : "Kaydet" }, el("span", { "aria-hidden": "true", text: kayitli ? "★" : "☆" }));
    olay(yildiz, "click", (e) => { e.stopPropagation(); kb.kaydetDegistir(konum); const yeni = d.konumlar.find((x) => x.id === konumKimligi(konum)); yildiz.classList.toggle("dolu", !!yeni); yildiz.setAttribute("aria-pressed", String(!!yeni)); yildiz.firstChild.textContent = yeni ? "★" : "☆"; ciz(); if (yeni) duzenleAc(yeni, true); });
    return el("li", { class: "hv-sonuc", role: "presentation" }, sec, yildiz);
  }
  function sonuclariCiz(bolumler) {
    const lis = []; satirlar = [];
    for (const b of bolumler) {
      if (!b.liste.length && !b.bos) continue;
      lis.push(el("li", { class: "hv-sonuc-baslik", role: "presentation", text: b.baslik }));
      if (!b.liste.length) lis.push(el("li", { class: "hv-sonuc-bos", role: "presentation", text: b.bos }));
      for (const r of b.liste) { const li = satirYap(r, b.tur); lis.push(li); satirlar.push(li.firstChild); }
    }
    sonuclar.replaceChildren(...lis);
    aktifSatir = -1;
  }
  function sonuclariGoster() {
    const son = sonAramalar();
    sonuclariCiz([{ baslik: "Son aramalar", tur: "son", liste: son.map((k) => ({ ...k, ayrinti: [k.ilce, k.il || k.admin1, k.ulkeAd].filter(Boolean).join(", ") })) }]);
    if (!son.length) sonuclar.replaceChildren(el("li", { class: "hv-sonuc-bos", role: "presentation", text: "İl adının ilk harflerini yazman yeterli (“Ank” → Ankara). Sokak/mahalle için adresi yazıp Enter'a bas: “Esatpaşa Mahallesi, Ataşehir”, “Times Square, New York”." }));
  }
  function mesajGoster(m) { mesaj.hidden = !m; mesaj.textContent = m || ""; }
  let iptal = null;
  async function ara(q) {
    const benim = ++no;
    iptal?.abort(); iptal = new AbortController();
    const yerel = yerelIlAra(q).map((il) => ({ id: `il_${il.ad}`, ad: il.ad, adEn: il.ad, lat: il.lat, lon: il.lon, ulke: "TR", ulkeAd: "Türkiye", ulkeAdEn: "Turkey", admin1: il.ad, il: il.ad, ayrinti: `Türkiye · ${BOLGELER[il.bolge].ad} Bölgesi` }));
    sonuclariCiz([{ baslik: "Türkiye illeri", tur: "il", liste: yerel }, ...(q.length >= 3 ? [{ baslik: "Dünya geneli", tur: "dunya", liste: [], bos: "Aranıyor…" }] : [])]);
    if (q.length < 3) return;
    try {
      const r = await yerAra(q, { sinyal: iptal.signal });
      if (benim !== no) return;
      const ilAdlari = new Set(yerel.map((x) => x.ad));
      const digerleri = r.filter((x) => !(x.ulke === "TR" && ilAdlari.has(x.ad) && !x.admin2)).slice(0, 8);
      sonuclariCiz([{ baslik: "Türkiye illeri", tur: "il", liste: yerel }, { baslik: "Şehir, ilçe, semt (dünya geneli)", tur: "dunya", liste: digerleri, bos: "Eşleşme bulunamadı. Adres/sokak için Enter'a bas." }]);
    } catch (h) { if (h?.name === "AbortError" || benim !== no) return; mesajGoster("Öneriler alınamadı (ağ). İl adı yazarak yine de seçebilirsin."); }
    if (benim === no) sokakDugmesiEkle(q);
  }
  function sokakDugmesiEkle(q) {
    if (q.length < 3) return;
    const b = el("button", { type: "button", class: "hv-sokak-ara", text: `🔎 “${q}” için sokak/adres ara (küresel · OpenStreetMap)` });
    olay(b, "click", () => serbestAdres());
    sonuclar.append(el("li", { class: "hv-sonuc", role: "presentation" }, b));
  }
  async function adresCalistir(girdi, gosterim) {
    mesajGoster(`“${gosterim}” aranıyor…`);
    try {
      const r = await adresAra(girdi);
      mesajGoster("");
      sonuclariCiz([{ baslik: "Sokak / adres sonuçları (küresel)", tur: "dunya", liste: r, bos: "Adres bulunamadı. Yazımı değiştir (örn. şehir ve ülkeyi ekle) ya da hiyerarşik alanları kullan." }]);
    } catch { mesajGoster("Adres araması şu an yapılamadı. Biraz sonra dene."); }
  }
  function serbestAdres() {
    const q = giris.value.trim();
    if (q.length < 3) { mesajGoster("Önce en az 3 harf yaz."); return; }
    ++no; clearTimeout(zamanlayici);
    adresCalistir(q, q);
  }
  olay(giris, "input", () => {
    clearTimeout(zamanlayici); mesajGoster("");
    const q = giris.value.trim();
    if (q.length < 2) { no++; sonuclariGoster(); return; }
    zamanlayici = setTimeout(() => ara(q), 380);          // v5: daha seyrek istek (takılma yok), önceki istek iptal edilir
  });
  olay(giris, "keydown", (e) => {
    if (e.key === "Escape") { aramaAcKapa(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!satirlar.length) return;
      aktifSatir = (aktifSatir + (e.key === "ArrowDown" ? 1 : -1) + satirlar.length) % satirlar.length;
      satirlar.forEach((s, i) => s.classList.toggle("odak", i === aktifSatir));
      satirlar[aktifSatir].scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (aktifSatir >= 0) satirlar[aktifSatir].click();      // ↑↓ ile seçilmiş satır
      else serbestAdres();                                     // Enter = küresel serbest metin / adres araması
    }
  });

  /* ---------------- GPS ---------------- */
  async function gpsDene() {
    mesajGoster(""); bosalt(yardimYeri);
    arama.hidden = false;
    if (!navigator.geolocation) { mesajGoster("Bu tarayıcı konum desteklemiyor; şehir adı yazarak devam edebilirsin."); return; }
    // Sitenin kendi güvenlik başlığı (Permissions-Policy: geolocation=()) konumu engelliyorsa tarayıcı HİÇ sormaz; ayar yardımı işe yaramaz.
    const pp = document.permissionsPolicy || document.featurePolicy;
    if (pp?.allowsFeature && !pp.allowsFeature("geolocation")) { mesajGoster("Bu sitenin güvenlik başlığı (Permissions-Policy) konumu engelliyor, bu yüzden tarayıcı izin sormuyor. Site sahibi: _headers dosyasında geolocation=(self) olmalı ve site yeniden yayınlanmalı. O zamana kadar şehir adı yazabilirsin."); return; }
    const izin = await izinDurumu("geolocation");
    if (izin === "denied") { mesajGoster("Konum izni daha önce reddedilmiş. Tarayıcı bir daha sormaz; aşağıdaki adımlarla açabilirsin — ya da şehir adı yazman yeterli."); yardimYeri.replaceChildren(izinYardimKarti("konum")); return; }
    mesajGoster("Konum alınıyor… (tarayıcı izin sorarsa “İzin ver” de)");
    navigator.geolocation.getCurrentPosition(
      (p) => { mesajGoster(""); kb.sec({ ad: "Bulunduğum yer", lat: p.coords.latitude, lon: p.coords.longitude, gps: true }); aramaAcKapa(false); },
      (hata) => { mesajGoster(konumHataMetni(hata)); if (hata.code === 1 || hata.code === 2) yardimYeri.replaceChildren(izinYardimKarti("konum", { mesaj: hata.code === 1 ? "Bu site için konum izni kapalı." : "" })); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5 * 60 * 1000 });
  }

  ciz();
  return { kok, ciz, gpsDene };
}
