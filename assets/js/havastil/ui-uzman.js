/**
 * ui-uzman.js — "Derin analiz" (v3.1): meteoroloji ve veri meraklıları için, GÜN SEÇİCİLİ uzman görünümü.
 * Her bölüm: ne olduğu → gösterge → nasıl okunur → senin için anlamı. Seçilen günün 24 saati (bugün için geçmiş saatler soluk) + sonraki günler.
 *   Gün özeti · PoP = Güven × Kapsam · CAPE (şimdi + saatlik + 10 gün) · Yağışın fiziği (konvektif/geniş cephe) · E = PoP × P ve karar kuralları ·
 *   Mikro-iklim · Saat saat matris.  Kombin/CLO ayrıntıları artık "Kombin" sekmesinde.
 * Tüm sayılar yagis-fizigi.js ve veri.js'ten gelir; burada hesap yok, yalnızca gösterim.
 */
import { el, rozet, ipucu, kart, bolumBasligi, olcek, olay, zamanOnce } from "./ui-temel.js";
import { ruzgarYonu, uvSeviye, aqiSeviye, cigNoktasiKonfor, gunAdi } from "./hava-kodlari.js";
import { hedefClo } from "./cekirdek.js";
import { CAPE_BANTLARI, ESIK, YAGIS_SEVIYELERI, capeOrani, capeSeviye, saatAnaliz, saatMetniTam, gunAnalizleri, popYorumu, popPratik, guvenMetni, efektifSiddet, capeHalk } from "./yagis-fizigi.js";

const n1 = (x, n = 1) => String(Number(x).toFixed(n));          // v4: ondalık NOKTA (10 günlük liste ve ekran görüntüleriyle aynı biçim: 4.4 mm)
const isaretli = (x) => (x == null ? "—" : `${x > 0 ? "+" : ""}${n1(x)}`);
const gunEtiketi = (tarih, i) => (i === 0 ? "Bugün" : i === 1 ? "Yarın" : gunAdi(tarih));
const TUR_AD = { yok: "—", cise: "Çisenti", genis: "Geniş cephe", konvektif: "Konvektif", karma: "Karma", kar: "Kar" };

const uzmanKart = (baslik, aciklama, ...c) => kart("hv-uzman-kart", bolumBasligi(baslik), aciklama ? el("p", { class: "hv-uzman-ne", text: aciklama }) : null, ...c);
const okunus = (...satirlar) => el("div", { class: "hv-okunus" }, el("strong", { text: "Nasıl okunur?" }), ...satirlar.map((t) => el("small", { text: t })));
const anlam = (t) => el("p", { class: "hv-anlam" }, el("strong", { text: "Senin için anlamı: " }), el("span", { text: t }));

function metrik(baslik, deger, alt, ek, ne) {
  return el("div", { class: "hv-metrik" }, el("span", { class: "hv-metrik-baslik", text: baslik }), el("strong", { text: deger }), alt ? el("small", { text: alt }) : null, ek || null, ne ? el("small", { class: "hv-ipucu", text: ne }) : null);
}

/* ------------------------------ ortak grafik yapı taşı ------------------------------ */
/** Saatlik sütun grafiği. kolon(x,i) → [{oran 0..1, sinif}] (aşağıdan yukarı yığılır). cizgiler: [{oran, etiket}] */
function saatGrafigi(sl, simdiT, kolon, cizgiler = [], yEtiket = "") {
  const sutunlar = sl.map((x, i) => {
    const s = el("div", { class: `hv-sutun${x.t < simdiT ? " gecmis" : ""}${x.t === simdiT ? " simdi" : ""}`, title: x.baslik || "" });
    for (const p of kolon(x, i)) { const e = el("span", { class: `hv-sutun-parca ${p.sinif}` }); e.style.height = `${Math.max(0, Math.min(1, p.oran)) * 100}%`; s.append(e); }
    return s;
  });
  const cz = cizgiler.map((c) => { const e = el("div", { class: "hv-grafik-cizgi" }, el("small", { text: c.etiket })); e.style.bottom = `${c.oran * 100}%`; return e; });
  const eks = el("div", { class: "hv-grafik-x" }, ...sl.map((x) => el("small", { text: x.saat % 3 === 0 ? String(x.saat).padStart(2, "0") : "" })));
  return el("div", { class: "hv-grafik-kutu" }, yEtiket ? el("small", { class: "hv-grafik-y", text: yEtiket }) : null, el("div", { class: "hv-grafik" }, ...cz, ...sutunlar), eks);
}

/* ------------------------------ 0) gün seçici ------------------------------ */
function gunSecici(gunler, gi, d, kb) {
  return el("div", { class: "hv-gunsecici", role: "group", "aria-label": "Analiz edilecek gün" },
    ...gunler.map((g, i) => {
      const f = g.fizik;
      const b = olay(el("button", { type: "button", class: "hv-gunchip", "aria-pressed": String(i === gi), title: `${gunEtiketi(g.tarih, i)}: ${f.seviyeAd}, CAPE ${f.capeMax} J/kg` },
        el("strong", { text: gunEtiketi(g.tarih, i) }), el("small", { text: g.tarih.slice(8, 10) + "." + g.tarih.slice(5, 7) }),
        el("span", { class: "hv-gunchip-nokta" }, el("i", { class: `s${f.seviye}`, title: f.seviyeAd }), el("i", { class: `cape ${f.capeSeviye.sinif}`, title: `CAPE ${f.capeSeviye.ad}` }))), "click", () => { d.derinGun = i; kb.ciz(); });
      return b;
    }));
}

/* ------------------------------ 1) gün özeti ------------------------------ */
function ozetKarti(G, h, gi) {
  const f = G.fizik, a = G.saatler.map(saatAnaliz);
  const zirve = a.reduce((m, x) => (x.pop > (m?.pop ?? -1) ? x : m), null);
  const zi = a.indexOf(zirve);
  const sid = efektifSiddet(f.beklenenMm), ch = capeHalk(f.capeMax);
  // v4: büyük, kalın ve net değer + okunaklı alt etiket (eski sürümde değerler silik/kırpılmış görünüyordu)
  const kutu = (baslik, deger, birim, alt, sinif, ek) => el("div", { class: `hv-ozet-kutu ${sinif}` },
    el("small", { class: "hv-ozet-baslik", text: baslik }),
    el("strong", { class: "hv-ozet-deger" }, deger, birim ? el("span", { class: "hv-ozet-birim", text: ` ${birim}` }) : null),
    el("small", { class: "hv-ozet-alt", text: alt }), ek || null);
  const popSinif = zirve?.pop >= 70 ? "s2" : zirve?.pop >= 30 ? "s1" : "s0";
  return uzmanKart("Gün özeti", "Seçtiğin günün beş ana göstergesi. Renk, günlük karar için ne kadar dikkat gerektiğini söyler: yeşil sakin, sarı dikkat, kırmızı tehlike.",
    el("div", { class: "hv-ozet-grid" },
      kutu("Toplam yağış", n1(f.toplamMm), "mm", `${f.kisaAd}${f.toplamMm < 0.1 ? " · yağış yok" : ""}`, `s${f.seviye}`),
      kutu("Yağış riski (PoP)", `%${zirve?.pop ?? 0}`, "", zirve?.guven != null ? `Güven %${zirve.guven}${zirve.tahmini ? "*" : ""} × Kapsam %${zirve.kapsam}${zirve.tahmini ? "*" : ""}` : "en yüksek saat", popSinif,
        zirve?.guven != null ? el("small", { class: "hv-ozet-alt hv-ozet-yorum", text: guvenMetni(zirve.guven) }) : null),
      kutu("CAPE (fırtına enerjisi)", `${f.capeMax}`, "J/kg", ch.ad, ch.sinif, el("small", { class: "hv-ozet-alt hv-ozet-yorum", text: ch.aciklama })),
      kutu("Rüzgâr hamlesi", `${f.hamleMax}`, "km/s", f.hamleMax > ESIK.firtinaHamle ? "şemsiye yasak" : f.hamleMax > 28 ? "rahatsız edici" : "sakin", f.hamleMax > 55 ? "d5" : f.hamleMax > 40 ? "d4" : f.hamleMax > 28 ? "d3" : "d1"),
      kutu("Efektif yağış beklentisi", n1(f.beklenenMm), "mm", `${sid.ad} / ${sid.ayrinti}`, sid.sinif, el("em", { class: `hv-siddet ${sid.sinif}`, text: sid.ad }))),
    el("small", { class: "hv-ipucu", text: `${gunEtiketi(G.tarih, gi)} ${G.tarih.slice(8, 10)}.${G.tarih.slice(5, 7)} · 24 saat analiz edildi${zirve ? ` · PoP zirvesi ${saatMetniTam(G.saatler[zi].saat)}` : ""}. Efektif yağış = Σ (saatlik PoP × saatlik yağış).` }));
}

/* ------------------------------ 2) PoP = Güven × Kapsam ------------------------------ */
function popKarti(G, simdiT, h) {
  const a = G.saatler.map((x) => ({ x, ...saatAnaliz(x) }));
  const zirve = a.reduce((m, y) => (y.pop > (m?.pop ?? -1) ? y : m), null);
  const bar = (ad, yuzde, sinif, alt) => el("div", { class: "hv-pop-satir" }, el("span", { class: "hv-pop-ad", text: ad }),
    el("span", { class: "hv-pop-bar" }, (() => { const i = el("span", { class: sinif }); i.style.width = `${yuzde ?? 0}%`; return i; })()), el("strong", { text: yuzde == null ? "—" : `%${yuzde}` }), alt ? el("small", { text: alt }) : null);
  const hucre = (v, tur, y) => { const t = el("td", { class: `hv-isi ${tur}${y?.tahmini && tur !== "pop" ? " tahmini" : ""}`, text: v == null ? (y?.modelVar && tur !== "pop" ? "·" : "—") : `${v}${y?.tahmini && tur !== "pop" ? "*" : ""}` }); t.style.setProperty("--v", String((v ?? 0) / 100)); return t; };
  const baslikSatiri = el("tr", {}, el("th", { scope: "col", text: "Saat" }), ...a.map((y) => el("th", { scope: "col", class: y.x.t === simdiT ? "simdi" : "", text: String(y.x.saat).padStart(2, "0") })));
  const tablo = el("table", { class: "hv-isi-tablo" }, el("thead", {}, baslikSatiri),
    el("tbody", {},
      el("tr", {}, el("th", { scope: "row", text: "PoP %" }), ...a.map((y) => hucre(y.pop, "pop", y))),
      el("tr", {}, el("th", { scope: "row", text: "Güven %" }), ...a.map((y) => hucre(y.guven, "guven", y))),
      el("tr", {}, el("th", { scope: "row", text: "Kapsam %" }), ...a.map((y) => hucre(y.kapsam, "kapsam", y)))));
  const yok = a.every((y) => !y.modelVar);
  const pratik = zirve && zirve.pop >= 5 ? popPratik(zirve) : null;
  const tahminiVar = a.some((y) => y.tahmini);
  return uzmanKart("Yağış olasılığı = Güven × Kapsam",
    "“%40 yağış ihtimali” iki ayrı şeyin çarpımıdır: Güven (yağışın olacağından ne kadar eminiz) ve Kapsam (olursa bölgenin ne kadarına düşer). Aynı %40, bambaşka iki durumu gizleyebilir.",
    zirve && zirve.pop >= 10 ? el("div", { class: "hv-pop-ayrisma" },
      el("small", { class: "hv-ipucu", text: `En yüksek olasılık ${saatMetniTam(zirve.x.saat)}:` }),
      bar("PoP", zirve.pop, "pop", null), zirve.guven != null ? bar("= Güven", zirve.guven, "guven", "modellerin yağışta uyumu") : null, zirve.guven != null ? bar("× Kapsam", zirve.kapsam, "kapsam", "bölgenin yağış alacak payı") : null,
      pratik ? el("div", { class: "hv-pop-pratik" }, el("strong", { text: pratik.baslik }), el("code", { text: pratik.formul }), el("p", { class: "hv-pop-tavsiye", text: `Özet tavsiye: “${pratik.tavsiye}”` })) : null,
      el("p", { class: "hv-uzman-not", text: popYorumu(zirve) })) : el("p", { class: "hv-uzman-not", text: "Bu günün hiçbir saatinde belirgin yağış olasılığı yok (PoP < %10)." }),
    el("div", { class: "hv-matris-kaydir", tabindex: "0", role: "region", "aria-label": "Saatlik PoP, güven ve kapsam" }, tablo),
    okunus("Koyu hücre = yüksek değer. Üç satırı üst üste oku: PoP, Güven × Kapsam'a eşittir.",
      "Güven = ana tahmin + ECMWF + ICON + GFS modellerinden yağış gören modellerin oranı. Kapsam = PoP ÷ Güven.",
      "Güven yüksek, kapsam düşük → yağış kesin ama yerel hücrelerle (sağanak). Güven düşük, kapsam yüksek → olursa her yere düşer ama belirsiz.",
      "· = risk %5'in altında, ayrıştırma gerekmiyor. Hücre soluksa o saatte yağış yok demektir.",
      ...(tahminiVar ? ["* = tahmini: modellerin yağış gören oranı ana tahminin olasılığından düşük; Güven olasılığa eşitlendi, Kapsam bu yüzden üst sınırdır (kesin değil)."] : [])),
    el("small", { class: "hv-ipucu", text: yok ? "Bu gün için model uyumu verisi yok (modeller en fazla birkaç gün ileriye bakar): yalnızca PoP gösteriliyor." : "Not: Open-Meteo yalnızca PoP verir; Güven ve Kapsam, model uyumundan türetilen tahmini bir ayrıştırmadır (çarpımları her zaman PoP'a eşittir)." }),
    anlam(zirve && zirve.pop >= 30 ? "Güven yüksekse şemsiye/kabuk kararını ciddiye al; güven düşükse kabuğu çantada taşı, giymek zorunda kalmayabilirsin." : "Yağış için önlem gerekmiyor."));
}

/* ------------------------------ 3) CAPE ------------------------------ */
function capeKarti(G, gunler, gi, d, kb) {
  const h = d.hava, f = G.fizik, simdiT = h.saatListe?.[0]?.t, simdi = h.saatListe?.[0]?.cape ?? 0, sc = capeSeviye(simdi);
  const isaret = el("span", { class: "hv-skala-isaret", "aria-hidden": "true" }); isaret.style.left = `${capeOrani(f.capeMax) * 100}%`;
  const MAKS = 4000;
  const grafik = saatGrafigi(G.saatler.map((x) => ({ ...x, baslik: `${saatMetniTam(x.saat)} · CAPE ${x.cape} J/kg · ${capeSeviye(x.cape).ad}` })), simdiT, (x) => [{ oran: x.cape / MAKS, sinif: capeSeviye(x.cape).sinif }],
    [{ oran: ESIK.surprizCape / MAKS, etiket: "1000 · sürpriz sağanak eşiği" }, { oran: ESIK.firtinaCape / MAKS, etiket: "1500 · şemsiye kırıcı eşiği" }], "J/kg (üst sınır 4000)");
  const yenile = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "↻ Güncelle" }), "click", () => kb.yenile(true));
  const gunCubuk = gunler.map((g, i) => {
    const c = g.fizik.capeMax, b = olay(el("button", { type: "button", class: `hv-cape-gun ${capeSeviye(c).sinif}`, "aria-pressed": String(i === gi), title: `${gunEtiketi(g.tarih, i)}: en yüksek CAPE ${c} J/kg (${capeSeviye(c).ad})` }), "click", () => { d.derinGun = i; kb.ciz(); });
    const dolgu = el("span", { class: "hv-cape-gun-dolgu" }); dolgu.style.height = `${Math.max(6, Math.min(1, c / MAKS) * 100)}%`;
    b.append(dolgu, el("strong", { text: String(c) }), el("small", { text: gunEtiketi(g.tarih, i).slice(0, 3) }));
    return b;
  });
  return uzmanKart("Atmosferik kararsızlık (CAPE)",
    "CAPE, ısınan nemli havanın yükselirken ne kadar enerji biriktirdiğini J/kg olarak ölçer: gök gürültülü fırtınanın yakıtıdır. Yüksek CAPE tek başına yağış demek değildir; yağış tetiklenirse ne kadar şiddetli olabileceğini söyler.",
    el("div", { class: "hv-cape-ikili" },
      el("div", { class: `hv-cape-kutu ${sc.sinif}` }, el("small", { text: `Şimdi · ${d.konum.etiket || d.konum.ad}` }), el("strong", { text: `${Math.round(simdi)} J/kg` }), el("small", { text: sc.ad }), el("small", { class: "hv-cape-halk", text: `${capeHalk(simdi).ad}: ${capeHalk(simdi).aciklama}` }), el("small", { class: "hv-ipucu", text: `${zamanOnce(h.alinma || Date.now())} güncellendi` }), yenile),
      el("div", { class: `hv-cape-kutu ${f.capeSeviye.sinif}` }, el("small", { text: `${gunEtiketi(G.tarih, gi)} · en yüksek` }), el("strong", { text: `${f.capeMax} J/kg` }), el("small", { text: f.capeSeviye.ad }), el("small", { class: "hv-cape-halk", text: `${capeHalk(f.capeMax).ad}: ${capeHalk(f.capeMax).aciklama}` }), el("small", { class: "hv-ipucu", text: f.capeMax > 0 ? `${saatMetniTam(f.capeSaat)} civarında` : "gün boyu düşük" }))),
    el("div", { class: "hv-skala" },
      el("div", { class: "hv-skala-seritler", role: "img", "aria-label": `CAPE ${f.capeMax} J/kg: ${f.capeSeviye.ad}` }, ...CAPE_BANTLARI.map((b) => el("span", { class: `hv-skala-bant ${b.sinif}${b.skor === f.capeSeviye.skor ? " aktif" : ""}` })), isaret),
      el("div", { class: "hv-skala-etiketler" }, ...CAPE_BANTLARI.map((b) => el("small", { text: b.alt === 0 ? "0" : b.alt >= 4000 ? "4000+" : String(b.alt) })))),
    el("h3", { class: "hv-alt-baslik", text: `${gunEtiketi(G.tarih, gi)} saat saat` }), grafik,
    el("h3", { class: "hv-alt-baslik", text: "Önümüzdeki günler (günlük en yüksek CAPE)" }),
    el("div", { class: "hv-cape-gunler", role: "group", "aria-label": "Günlük en yüksek CAPE" }, ...gunCubuk),
    el("div", { class: "hv-cape-lejant" }, ...CAPE_BANTLARI.map((b) => el("div", { class: `hv-cape-lejant-satir ${b.sinif}` },
      el("span", { class: "hv-cape-lejant-nokta", "aria-hidden": "true" }), el("div", {}, el("strong", { text: `${b.alt}${Number.isFinite(b.ust) ? "–" + b.ust : "+"} J/kg · ${b.ad}` }), el("small", { text: `${b.aciklama} ${b.oneri}` }))))),
    okunus("Sütun yüksekliği = o saatin CAPE değeri; kesikli çizgiler karar kurallarının eşikleridir (1000 ve 1500).", "Gün çubuklarına dokunarak o günün analizine geç. Soluk sütunlar geçmiş saatlerdir, çerçeveli sütun şimdiki saattir."),
    anlam(f.capeMax > ESIK.firtinaCape ? "Şemsiye açmak tehlikeli ve işlevsiz; kapüşonlu teknik kabuk giy." : f.capeMax > ESIK.surprizCape ? "Yağış ihtimali düşük görünse bile ani sağanak çıkabilir; su geçirmez kabuk hazır olsun." : "Fırtına enerjisi düşük; CAPE kaynaklı özel bir önlem gerekmiyor."));
}

/* ------------------------------ 4) yağışın fiziği ------------------------------ */
function fizikKarti(G, simdiT) {
  const f = G.fizik, a = G.saatler.map(saatAnaliz);
  const topla = f.saganakToplam + f.yagmurToplam;
  const pay = topla > 0 ? f.saganakToplam / topla : null;
  const maks = Math.max(1, Math.ceil(Math.max(...a.map((x) => x.mm), 0)));
  const grafik = saatGrafigi(G.saatler.map((x, i) => ({ ...x, baslik: `${saatMetniTam(x.saat)} · ${TUR_AD[a[i].tur]} · ${n1(a[i].mm)} mm (konvektif ${n1(a[i].saganak)} · geniş cephe ${n1(a[i].yagmur)})` })), simdiT,
    (x, i) => { const s = a[i], diger = Math.max(0, s.mm - s.saganak - s.yagmur); return [{ oran: s.yagmur / maks, sinif: "genis" }, { oran: s.saganak / maks, sinif: "konv" }, { oran: diger / maks, sinif: "diger" }]; },
    maks > 1 ? [{ oran: 1 / maks, etiket: "1 mm/sa" }] : [], `mm/sa (üst sınır ${maks})`);
  const meter = el("div", { class: "hv-karakter" },
    el("div", { class: "hv-karakter-uclar" }, el("small", { text: "Sürekli · geniş cephe" }), el("small", { text: "Ani · konvektif" })),
    el("div", { class: "hv-karakter-cubuk", role: "img", "aria-label": pay == null ? "Yağış yok" : `Konvektif pay yüzde ${Math.round(pay * 100)}` }, (() => { const i = el("span", { class: "hv-karakter-isaret" }); i.style.left = `${pay == null ? 50 : Math.round(pay * 100)}%`; return i; })()),
    el("small", { class: "hv-ipucu", text: pay == null ? "Bu gün yağış yok: karakter belirlenemez." : `Yağış hacminin %${Math.round(pay * 100)}'i konvektif sağanak, %${100 - Math.round(pay * 100)}'i geniş cephe yağışı.` }));
  const turKarti = (ad, mm, ozellik, isaret, yap, baskin, sinif) => el("div", { class: `hv-fizik-kart ${sinif}${baskin ? " baskin" : ""}` },
    el("div", { class: "hv-fizik-ust" }, el("strong", { text: ad }), baskin ? rozet("Baskın", "hv-rozet-onemli") : null), el("span", { class: "hv-fizik-mm", text: `${n1(mm)} mm` }),
    el("small", { text: ozellik }), el("small", { class: "hv-ipucu", text: `İşaretleri: ${isaret}` }), el("small", { text: `Ne yapmalı: ${yap}` }));
  const anlamMetni = { konvektif: "Ani başlayıp ani biter; yoğun ve kısa. Kapüşonlu kabuğu elinin altında tut, şemsiyeyle uğraşma.", genis: "Uzun ve düzgün; sığınıp beklemek işe yaramaz. Su geçirmez dış kat ve su itici ayakkabı seç.", karma: "Geniş cephenin içinde sağanak hücreleri var; yoğunluk saatten saate oynar. Su geçirmez kat şart, kapüşon hazır.", cise: "İnce ve düşük hacimli; kısa yürüyüşte belirgin ıslatmaz. Ağır bot ve şemsiye gereksiz.", kar: "Katı yağış: kaymaz taban, su geçirmez ve sıcak tutan parçalar.", yok: "Yağış yok; fiziksel bir önlem gerekmiyor." }[f.tur];
  return uzmanKart("Yağışın fiziği",
    "Aynı miktardaki yağış iki farklı yoldan gelebilir: yerden yükselen hava hücreleriyle (konvektif sağanak) ya da cephe sistemleriyle (geniş cephe). Karakteri bilmek, ne giyeceğini ve ne kadar süreceğini belirler.",
    meter, grafik,
    el("div", { class: "hv-grafik-lejant" }, el("span", { class: "konv" }, "Konvektif sağanak (showers)"), el("span", { class: "genis" }, "Geniş cephe yağışı (rain)"), el("span", { class: "diger" }, "Diğer (çisenti / kar eşdeğeri)")),
    el("div", { class: "hv-fizik-ikili" },
      turKarti("Konvektif sağanak", f.saganakToplam, "Sıcak, nemli havanın hızla yükselmesiyle oluşan kısa, yoğun ve dar alanlı yağış. Gök gürültüsü ve dolu eşlik edebilir.", "yüksek CAPE, kümülonimbüs bulutu, ani rüzgâr hamlesi", "kapüşonlu kabuk, açıkta kalma", f.tur === "konvektif" || f.tur === "karma" && f.saganakToplam >= f.yagmurToplam, "konv"),
      turKarti("Geniş cephe yağışı", f.yagmurToplam, "Cephe veya alçak basınç sistemiyle gelen, geniş alana yayılan, saatlerce süren düzgün yağış.", "basınç düşüşü, kalın ve düşük bulut örtüsü, düşük CAPE", "su geçirmez dış kat ve su itici ayakkabı", f.tur === "genis" || f.tur === "karma" && f.yagmurToplam > f.saganakToplam, "genis")),
    okunus("Sütun yüksekliği = o saatte yağan su (mm/sa). Amber = konvektif, mavi = geniş cephe, gri = çisenti/kar eşdeğeri.", "İbre sağa gittikçe yağış ani ve yerel, sola gittikçe sürekli ve yaygın demektir."),
    anlam(anlamMetni));
}

/* ------------------------------ 5) E = PoP × P ve karar kuralları ------------------------------ */
function beklenenKarti(G) {
  const f = G.fizik, a = G.saatler.map((x) => ({ x, ...saatAnaliz(x) })).filter((y) => y.E > 0).sort((p, q) => q.E - p.E).slice(0, 4);
  return uzmanKart("Beklenen efektif yağış ve karar kuralları",
    "E = PoP × P: bir saatte yağış olasılığı ile o saatin yağış hacminin çarpımı. Saatlik E değerleri toplanarak günün beklenen yağışı bulunur. Şemsiye kararı yalnızca olasılığa değil, bu beklentiye bakar.",
    el("div", { class: "hv-formul" },
      el("div", {}, el("small", { text: "PoP (en yüksek)" }), el("strong", { text: `%${f.enYuksekPop}` })), el("span", { class: "hv-formul-isaret", "aria-hidden": "true", text: "×" }),
      el("div", {}, el("small", { text: "P (günün hacmi)" }), el("strong", { text: `${n1(f.toplamMm)} mm` })), el("span", { class: "hv-formul-isaret", "aria-hidden": "true", text: "→" }),
      el("div", { class: "vurgu" }, el("small", { text: "E (saatlik toplam)" }), el("strong", { text: `${n1(f.beklenenMm, 2)} mm` }))),
    (() => { const sd = efektifSiddet(f.beklenenMm); return el("p", { class: "hv-efektif-satir" }, el("strong", { text: "Efektif Yağış Beklentisi: " }), el("span", { text: `${n1(f.beklenenMm)} mm ` }), el("em", { class: `hv-siddet ${sd.sinif}`, text: `${sd.ad} / ${sd.ayrinti}` })); })(),
    a.length ? el("div", { class: "hv-e-liste" }, el("small", { class: "hv-ipucu", text: "E değerine en çok katkı yapan saatler:" }), ...a.map((y) => el("div", { class: "hv-e-satir" }, el("strong", { text: saatMetniTam(y.x.saat) }), el("span", { text: `%${y.pop} × ${n1(y.mm)} mm = ${n1(y.E, 2)} mm` })))) : null,
    el("div", { class: "hv-kurallar" }, ...f.kurallar.map((k) => el("div", { class: `hv-kural${k.tetik ? " tetik" : ""}` },
      el("div", { class: "hv-kural-ust" }, el("strong", { text: k.ad }), rozet(k.tetik ? "Tetiklendi" : "Tetiklenmedi", k.tetik ? "hv-rozet-onemli" : "")),
      el("small", { class: "hv-ipucu", text: `Koşul: ${k.kosul}` }), el("small", { text: k.ozet })))),
    f.sureklilik ? el("p", { class: "hv-uyari", text: `Birikim kuralı: tek tek saatler zararsız olsa da toplam ${n1(f.toplamMm)} mm ≥ ${ESIK.sureklilikToplamMm} mm olduğu için seviye “sürekli yağmur”a yükseltildi.` }) : null,
    okunus("Üç kural sırayla denenir: zararsız çisenti (1), gizli sağanak (2), şemsiye kırıcı fırtına (3).", `Seviye: ${YAGIS_SEVIYELERI.map((s) => `${s.id} ${s.kisa}`).join(" · ")}.`),
    anlam(f.baslik));
}

/* ------------------------------ 6) mikro-iklim ------------------------------ */
const ozonSeviye = (o) => (o < 50 ? { ad: "Çok iyi", sinif: "d1" } : o < 100 ? { ad: "İyi", sinif: "d1" } : o < 130 ? { ad: "Orta", sinif: "d2" } : o < 240 ? { ad: "Kötü", sinif: "d3" } : { ad: "Çok kötü", sinif: "d5" });
function basincYorumu(fark, saat) {
  if (fark == null) return "—";
  const oran = fark / (saat / 3);               // 3 saatlik eşdeğer
  return oran <= -3 ? "hızlı düşüş: hava bozuyor" : oran <= -1 ? "düşüyor" : oran >= 3 ? "hızlı yükseliş: hava açıyor" : oran >= 1 ? "yükseliyor" : "sabit";
}
function mikroKarti(G, gi, d) {
  const h = d.hava, f = G.fizik, sl = G.saatler, bugunMu = gi === 0, gunl = h.gunluk?.[gi];
  const cig = sl.map((x) => x.cig), tmp = sl.map((x) => x.temp);
  const minFark = Math.min(...sl.map((x) => x.temp - x.cig));
  const bas = sl.map((x) => x.basinc), bFark = bas.length > 1 ? Math.round((bas[bas.length - 1] - bas[0]) * 10) / 10 : null;
  const bMin = Math.min(...bas), bMaks = Math.max(...bas);
  const spark = el("div", { class: "hv-spark", role: "img", "aria-label": "Saatlik basınç" }, ...bas.map((b) => { const s = el("span"); s.style.height = `${8 + ((b - bMin) / (bMaks - bMin || 1)) * 92}%`; s.title = `${b} hPa`; return s; }));
  const uv = uvSeviye(gunl?.uv ?? 0), oz = bugunMu && h.kalite?.ozon ? ozonSeviye(h.kalite.ozon) : null;
  const hamleSinif = f.hamleMax > 55 ? "d5" : f.hamleMax > 40 ? "d4" : f.hamleMax > 28 ? "d3" : "d1";
  const nemOrt = Math.round(sl.reduce((t, x) => t + x.nem, 0) / sl.length), bulutOrt = Math.round(sl.reduce((t, x) => t + x.bulut, 0) / sl.length);
  return uzmanKart("Mikro-iklim parametreleri", "Kombini ve gün içi davranışını ince ayarlayan yerel değerler. Her kutuda önce değer, sonra ne anlama geldiği yazıyor.",
    el("div", { class: "hv-detay-grid" },
      metrik("Rüzgâr hamlesi", `${f.hamleMax} km/s`, `${f.hamleSaat != null ? saatMetniTam(f.hamleSaat) + " civarında zirve" : ""}${bugunMu ? ` · şimdi ${h.saatListe?.[0]?.hamle ?? "—"} km/s, ${ruzgarYonu(h.ruzgarYon)}` : ""}`, olcek(Math.min(1, f.hamleMax / 80), hamleSinif),
        "Hamle, ani rüzgâr patlamasıdır; ortalama rüzgârdan çok daha serttir. 28 üstü rahatsız eder, 40 üstü şemsiyeyi işlevsiz kılar, 55 üstü tehlikelidir."),
      metrik("Çiğ noktası", `${Math.min(...cig)}° – ${Math.max(...cig)}°`, `Hava ${cigNoktasiKonfor(Math.round(cig.reduce((t, x) => t + x, 0) / cig.length))} · en küçük sıcaklık-çiğ farkı ${minFark}°`, null,
        "Çiğ noktası, havanın içindeki nemin yoğuşmaya başladığı sıcaklıktır. Fark 2°'nin altına inerse sis, buğu ve ıslak his artar; yüksek çiğ noktası havayı bunaltıcı yapar."),
      metrik("Yüzey basıncı", `${bas[0]} → ${bas[bas.length - 1]} hPa`, `Gün içi değişim ${isaretli(bFark)} hPa · ${basincYorumu(bFark, Math.max(3, sl.length - 1))}`, spark,
        "Düşen basınç genelde bozulan havayı (cephe, yağış), yükselen basınç açan havayı gösterir. Saatte 1 hPa'dan fazla düşüş hızlı değişimdir."),
      metrik("UV indeksi (gün zirvesi)", `${gunl?.uv ?? "—"}`, `${uv.ad} · ${uv.oneri}`, olcek(Math.min(1, (gunl?.uv ?? 0) / 11), uv.sinif), "UV, güneşin cildi yakma gücüdür: 3'ten itibaren koruma, 6'dan sonra SPF 50 ve gölge gerekir. Bulutlu havada bile geçer."),
      metrik("Yüzey ozonu", bugunMu && h.kalite?.ozon ? `${h.kalite.ozon} µg/m³` : "Tahmin yok", oz ? `${oz.ad} · şu anki ölçüm` : bugunMu ? "Bu bölge için ölçüm yok" : "Yalnızca anlık değer sağlanır, ileri günler için tahmin yok.", oz ? olcek(Math.min(1, h.kalite.ozon / 240), oz.sinif) : null,
        "Zemin seviyesindeki ozon, güneşli sıcak günlerde trafik kirliliğinden oluşur ve solunumu zorlar. Stratosferdeki koruyucu ozon tabakasıyla ilgisi yoktur."),
      metrik("Nem ve bulut (gün ortalaması)", `%${nemOrt} · %${bulutOrt}`, `Bulut örtüsü ${bulutOrt >= 80 ? "kapalı" : bulutOrt >= 40 ? "parçalı" : "az"}`, null, "Yüksek nem soğuğu daha keskin, sıcağı daha bunaltıcı hissettirir; hissedilen sıcaklık bu yüzden ölçülenden farklıdır.")),
    okunus("Değerler seçili günün 24 saatinden hesaplanır; “şimdi” bilgisi yalnızca bugün için gösterilir."));
}

/* ------------------------------ 7) saat saat matris ------------------------------ */
const yalitimAdi = (c) => (c < 0.5 ? "çok ince" : c < 0.8 ? "ince" : c < 1.1 ? "orta" : c < 1.5 ? "kalın" : "çok kalın");
function matrisKarti(G, simdiT, d) {
  const td = (m, c) => el("td", { class: c || null, text: m });
  const govde = G.saatler.map((x) => {
    const a = saatAnaliz(x);
    const clo = hedefClo({ apparent: x.app, raw: x.temp, precip: x.yagis, hum: x.nem }, d.tercih.tol, d.tercih.sen).clo;
    return el("tr", { class: `s${a.seviye}${x.t < simdiT ? " gecmis" : ""}${x.t === simdiT ? " simdi" : ""}` },
      el("th", { scope: "row", text: saatMetniTam(x.saat) }), td(TUR_AD[a.tur], a.tur === "yok" ? "sessiz" : ""),
      td(a.guven != null ? `%${a.pop} (${a.guven}×${a.kapsam})` : `%${a.pop}`, a.pop < 10 ? "sessiz" : ""),
      td(a.mm >= 0.05 ? `${n1(a.mm)} (E ${n1(a.E, 2)})` : "—", a.mm >= 0.05 ? "" : "sessiz"),
      td(String(a.cape), `cape ${capeSeviye(a.cape).sinif}`), td(String(a.hamle), a.hamle > 40 ? "hamle-yuksek" : ""), td(`${n1(clo, 2)} · ${yalitimAdi(clo)}`));
  });
  return uzmanKart("Saat saat matris", "Seçili günün her saati için yağış, olasılık dağılımı, enerji, rüzgâr ve o saatin yalıtım ihtiyacı. Satır solundaki renkli şerit yağış kademesidir.",
    el("div", { class: "hv-matris-kaydir", tabindex: "0", role: "region", "aria-label": "Saat saat matris, yatay kaydırılabilir" },
      el("table", { class: "hv-matris" }, el("thead", {}, el("tr", {}, ...["Saat", "Yağış türü", "PoP (güven×kapsam)", "mm (E = PoP×P)", "CAPE J/kg", "Hamle km/s", "Yalıtım ihtiyacı (CLO)"].map((t) => el("th", { scope: "col", text: t })))), el("tbody", {}, ...govde))),
    okunus("Yalıtım ihtiyacı, o saatin hissedilen sıcaklığı ve plan/tercihlerinle hesaplanır (CLO: büyük sayı = daha kalın giyim).", "Soluk satırlar geçmiş saatlerdir; çerçeveli satır şimdiki saattir."));
}

/* ------------------------------ sekme ------------------------------ */
export function derinSekmesi(d, kb) {
  if (!d.hava || !d.sonuc || !d.fizik) return kart("hv-bos", ipucu("Hava verisi yükleniyor…"));
  const gunler = gunAnalizleri(d.hava.tumSaatler, { canta: d.tercih.canta });
  if (!gunler.length) return kart("hv-bos", ipucu("Saatlik veri yüklenemedi; yenile (↻) ve tekrar dene."));
  const gi = Math.min(d.derinGun || 0, gunler.length - 1), G = gunler[gi], simdiT = d.hava.saatListe?.[0]?.t;
  return el("div", { class: "hv-sekme-govde" },
    el("p", { class: "hv-uzman-giris", text: "Meteoroloji ve veri meraklıları için. Günlük karar “Bugün” ve “Kombin” sekmelerinde; burada kararın arkasındaki sayılar var. Bir gün seç, tüm bölümler o güne göre değişir." }),
    gunSecici(gunler, gi, d, kb), ozetKarti(G, d.hava, gi), popKarti(G, simdiT, d.hava), capeKarti(G, gunler, gi, d, kb), fizikKarti(G, simdiT), beklenenKarti(G), mikroKarti(G, gi, d), matrisKarti(G, simdiT, d));
}
