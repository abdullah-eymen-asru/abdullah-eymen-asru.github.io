/**
 * ui-konum.js — Konum şeridi + arama + kaydetme.
 *  • Kayıtlı konumlar yatay KARTLAR olarak görünür (ikon, ad, son sıcaklık); dokununca seçilir. ＋ kartı aramayı açar.
 *  • Arama: önce İNTERNETSİZ il eşleşmesi ("ank" → Ankara; yanlış yere düşmez), sonra dünya geneli Open-Meteo. Seçim AÇIKTIR:
 *    listeden seçmeden hiçbir konum otomatik seçilmez. Her sonucun yanındaki ☆ ile tek dokunuşta kaydedilir (ikon seçerek).
 *  • Sokak/adres: yalnızca kullanıcı isterse (OpenStreetMap), otomatik tamamlama yok.
 *  • "Bulunduğum yer": izin yoksa/reddedilmişse tarayıcıya özel adımlarla yönlendirir.
 */
import { el, olay, rozet, ipucu, cipGrubu, izinYardimKarti, bosalt, etiket } from "./ui-temel.js";
import { yerAra, sokakAra, sonSicaklik } from "./veri.js";
import { yerelIlAra, ilAdindan, enYakinIl, BOLGELER } from "./iller.js";
import { IKONLAR, IKON_ADLARI, kayitliMi, konumKimligi, sonAramalar, sonAramaEkle, temizle } from "./konumlar.js";
import { izinDurumu, konumHataMetni } from "./izin-yardim.js";

/** Open-Meteo/Nominatim/yerel sonucu → konum nesnesi */
export function sonucuKonumaCevir(r) {
  const k = { ad: r.ad, adEn: r.adEn, lat: r.lat, lon: r.lon, ulke: r.ulke, ulkeAd: r.ulkeAd, ulkeAdEn: r.ulkeAdEn, admin1: r.admin1, admin1En: r.admin1En, mahalle: r.mahalle, sokak: r.sokak };
  if (r.ulke === "TR") {
    const il = ilAdindan(r.il || r.admin1) || enYakinIl(r.lat, r.lon);
    if (il) { k.il = il.ad; k.admin1 = il.ad; k.admin1En = il.ad; }
    const ilce = r.admin2 || (r.ad && il && r.ad !== il.ad ? r.ad : "");
    if (ilce && (!il || ilce !== il.ad)) k.ilce = ilce;
  }
  return k;
}
const BAYRAK = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "🌍");

/**
 * @param {{konum:object, konumlar:object[]}} d  paylaşılan durum
 * @param {{sec:(k:object, o?:object)=>void, kaydetDegistir:(k:object)=>void, guncelle:(id:string,a:object)=>void, sil:(id:string)=>void, ilkeAl:(id:string)=>void}} kb
 */
export function konumBileseni(d, kb) {
  const seritKutu = el("div", { class: "hv-serit", role: "list", "aria-label": "Konumlarım" });
  const aktifBaslik = el("div", { class: "hv-aktif-konum" });
  const duzenle = el("div", { class: "hv-duzenle", hidden: true });
  const giris = el("input", { type: "search", class: "hv-girdi", placeholder: "Şehir, ilçe veya mahalle yaz (örn. Ank…)", "aria-label": "Konum ara", autocomplete: "off", maxlength: "80", enterkeyhint: "search" });
  const sonuclar = el("ul", { class: "hv-sonuclar", role: "listbox" });
  const mesaj = el("p", { class: "hv-ipucu", hidden: true });
  const yardimYeri = el("div");
  const arama = el("div", { class: "hv-arama", hidden: true }, giris, mesaj, yardimYeri, sonuclar,
    el("p", { class: "hv-ipucu hv-gizlilik-not", text: "Aradığın yerler cihazından çıkmaz: öneriler Open-Meteo'dan (yalnızca yazdığın metinle) alınır; hiçbir şey hesabına kaydedilmez." }));
  const kok = el("div", { class: "hv-konum" }, seritKutu, aktifBaslik, duzenle, arama);

  let aktifSatir = -1, satirlar = [], no = 0, zamanlayici = 0, duzenlenen = null;

  /* ---------------- şerit ---------------- */
  function kartCiz(k, { gps = false } = {}) {
    const son = sonSicaklik(k.lat, k.lon);
    const secili = !gps && (d.konum && konumKimligi(d.konum) === k.id);
    const b = el("button", { type: "button", class: `hv-konum-kart${secili ? " aktif" : ""}`, role: "listitem", "aria-current": secili ? "true" : null },
      el("span", { class: "hv-konum-ikon", text: gps ? "📍" : IKONLAR[k.ikon] || "📍" }),
      el("span", { class: "hv-konum-metin" }, el("strong", { text: gps ? "Bulunduğum yer" : k.ad }), el("small", { text: gps ? "Cihaz konumu" : [k.ilce, k.il || k.admin1, k.ulkeAd].filter((x, i, a) => x && a.indexOf(x) === i && x !== k.ad).slice(0, 2).join(" · ") || "—" })),
      son ? el("span", { class: "hv-konum-sic", text: `${son.app}°` }) : null);
    olay(b, "click", () => (gps ? gpsDene() : kb.sec(k)));
    return b;
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
    const alt = [k.ilce, k.il || k.admin1, k.ulkeAd].filter((x, i, a) => x && a.indexOf(x) === i && x !== k.ad).join(" · ");
    const yildiz = el("button", { type: "button", class: `hv-yildiz${kayitli ? " dolu" : ""}`, "aria-pressed": String(kayitli), "aria-label": kayitli ? "Kayıtlı konum (düzenlemek için dokun)" : "Bu konumu kaydet", title: kayitli ? "Kayıtlı — düzenle" : "Kaydet" }, el("span", { "aria-hidden": "true", text: kayitli ? "★" : "☆" }));
    olay(yildiz, "click", () => { if (kayitli) { duzenleAc(d.konumlar.find((x) => x.id === konumKimligi(k)) || k); } else { kb.kaydetDegistir(k); const yeni = d.konumlar.find((x) => x.id === konumKimligi(k)); if (yeni) duzenleAc(yeni, true); } });
    aktifBaslik.replaceChildren(
      el("div", { class: "hv-aktif-metin" }, el("strong", { text: k.ad }), alt ? el("small", { text: alt }) : null),
      kayitli ? rozet("Kayıtlı", "hv-rozet-ok") : rozet("Kayıtlı değil"), yildiz);
  }

  /* ---------------- düzenleme paneli ---------------- */
  function duzenleAc(k, yeni = false) {
    duzenlenen = k;
    const ad = el("input", { type: "text", class: "hv-girdi", value: k.ad, maxlength: "40", "aria-label": "Konum adı" });
    const ikonGrup = cipGrubu({ baslik: "Simge", secenekler: Object.entries(IKON_ADLARI).map(([id, a]) => [id, `${IKONLAR[id]} ${a}`]), aktif: () => duzenlenen.ikon || "diger", onSec: (v) => { duzenlenen = { ...duzenlenen, ikon: v }; }, kucuk: true });
    const kaydet = el("button", { type: "button", class: "hv-btn hv-btn-birincil", text: "Tamam" });
    const ilk = el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "İlk sıraya al" });
    const sil = el("button", { type: "button", class: "hv-btn hv-btn-ince hv-btn-tehlike", text: "Kaldır" });
    olay(kaydet, "click", () => { kb.guncelle(k.id, { ad: ad.value.trim() || k.ad, ikon: duzenlenen.ikon || "diger" }); duzenle.hidden = true; });
    olay(ilk, "click", () => { kb.ilkeAl(k.id); duzenle.hidden = true; });
    olay(sil, "click", () => { kb.sil(k.id); duzenle.hidden = true; });
    olay(ad, "keydown", (e) => { if (e.key === "Enter") kaydet.click(); });
    duzenle.replaceChildren(etiket(yeni ? "Konum kaydedildi — adını ve simgesini seç" : "Konumu düzenle"), ad, ikonGrup.kok, el("div", { class: "hv-btn-satir" }, kaydet, ilk, sil));
    duzenle.hidden = false;
    ad.focus(); ad.select();
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
      tur === "il" ? rozet("İl") : null);
    const yildiz = el("button", { type: "button", class: `hv-yildiz${kayitli ? " dolu" : ""}`, "aria-pressed": String(kayitli), "aria-label": `${r.ad} konumunu ${kayitli ? "kayıttan çıkar" : "kaydet"}`, title: kayitli ? "Kayıtlı" : "Kaydet" }, el("span", { "aria-hidden": "true", text: kayitli ? "★" : "☆" }));
    olay(sec, "click", () => { sonAramaEkle(konum); kb.sec(konum); aramaAcKapa(false); giris.value = ""; });
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
    if (!son.length) sonuclar.replaceChildren(el("li", { class: "hv-sonuc-bos", role: "presentation", text: "İl adının ilk harflerini yazman yeterli: “Ank” → Ankara, “Ist” → İstanbul." }));
  }
  function mesajGoster(m) { mesaj.hidden = !m; mesaj.textContent = m || ""; }
  async function ara(q) {
    const benim = ++no;
    const yerel = yerelIlAra(q).map((il) => ({ id: `il_${il.ad}`, ad: il.ad, adEn: il.ad, lat: il.lat, lon: il.lon, ulke: "TR", ulkeAd: "Türkiye", ulkeAdEn: "Turkey", admin1: il.ad, il: il.ad, ayrinti: `Türkiye · ${BOLGELER[il.bolge].ad} Bölgesi` }));
    sonuclariCiz([{ baslik: "Türkiye illeri", tur: "il", liste: yerel }, ...(q.length >= 3 ? [{ baslik: "Dünya geneli", tur: "dunya", liste: [], bos: "Aranıyor…" }] : [])]);
    if (q.length < 3) return;
    try {
      const r = await yerAra(q);
      if (benim !== no) return;
      const ilAdlari = new Set(yerel.map((x) => x.ad));
      const digerleri = r.filter((x) => !(x.ulke === "TR" && ilAdlari.has(x.ad) && !x.admin2)).slice(0, 8);
      sonuclariCiz([{ baslik: "Türkiye illeri", tur: "il", liste: yerel }, { baslik: "Şehir, ilçe, semt (dünya geneli)", tur: "dunya", liste: digerleri, bos: "Eşleşme bulunamadı. Yazımı kontrol et ya da aşağıdan sokak/adres ara." }]);
    } catch { if (benim === no) mesajGoster("Öneriler alınamadı (ağ). İl adı yazarak yine de seçebilirsin."); }
    if (benim === no) sokakDugmesiEkle(q);
  }
  function sokakDugmesiEkle(q) {
    if (q.length < 3) return;
    const b = el("button", { type: "button", class: "hv-sokak-ara", text: `🔎 “${q}” için sokak/adres ara (OpenStreetMap)` });
    olay(b, "click", async () => {
      b.disabled = true; b.textContent = "Aranıyor…";
      try { const r = await sokakAra(q); sonuclariCiz([{ baslik: "Sokak / adres sonuçları", tur: "dunya", liste: r, bos: "Sokak/adres bulunamadı." }]); }
      catch { mesajGoster("Adres araması şu an yapılamadı. Biraz sonra dene."); }
    });
    sonuclar.append(el("li", { class: "hv-sonuc", role: "presentation" }, b));
  }
  olay(giris, "input", () => {
    clearTimeout(zamanlayici); mesajGoster("");
    const q = giris.value.trim();
    if (q.length < 2) { no++; sonuclariGoster(); return; }
    zamanlayici = setTimeout(() => ara(q), 260);
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
      if (aktifSatir >= 0) satirlar[aktifSatir].click();
      else if (satirlar.length === 1) satirlar[0].click();
      else mesajGoster(satirlar.length ? "Listeden bir konum seç (↑↓ ve Enter ya da dokun)." : "Önce birkaç harf yaz.");
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
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 });
  }

  ciz();
  return { kok, ciz, gpsDene };
}
