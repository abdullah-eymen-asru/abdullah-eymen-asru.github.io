/**
 * ui-uzman.js — "Derin analiz": meteoroloji ve veri meraklıları için uzman görünümü (ayrı sekme; ana ekranı yormaz).
 * Bölümler: CAPE (J/kg + fırtına skalası) · Yağışın fiziği (konvektif/geniş cephe) · Beklenen efektif yağış E = PoP × P ve üç karar kuralı ·
 * Mikro-iklim (hamle, çiğ noktası, basınç eğilimi, UV, yüzey ozonu) · Yalıtım (CLO) · 48 saatlik saat saat matris.
 * Tüm sayılar yagis-fizigi.js ve veri.js'ten gelir; burada hesap yok, yalnızca gösterim.
 */
import { el, rozet, ipucu, kart, bolumBasligi, olcek, saatlikGrafik, olay } from "./ui-temel.js";
import { ruzgarYonu, uvSeviye, aqiSeviye, gorusSeviye, nemSeviye, cigNoktasiKonfor, gunAdi } from "./hava-kodlari.js";
import { hedefClo } from "./cekirdek.js";
import { CAPE_BANTLARI, capeOrani, capeSeviye, saatAnaliz, saatMetniTam } from "./yagis-fizigi.js";
import { cloBar, zamanPlaniKarti, tumOnerilerKarti } from "./ui-kombin.js";

const sayiMetni = (x, n = 1) => String(Number(x).toFixed(n)).replace(".", ",");
const isaretli = (x) => (x == null ? "—" : `${x > 0 ? "+" : ""}${sayiMetni(x)}`);
const TUR_AD = { yok: "—", cise: "Çisenti", genis: "Geniş cephe", konvektif: "Konvektif", karma: "Karma", kar: "Kar" };
const TUR_ACIKLAMA = {
  konvektif: "Konvektif sağanak (showers): sıcak, nemli havanın hızla yükselmesiyle oluşan kısa ve yoğun yağış. Ani başlar, ani biter; gök gürültüsü ve dolu eşlik edebilir.",
  genis: "Geniş cephe yağışı (large-scale rain): cephe sistemiyle gelen, geniş alana yayılan, daha uzun süren ve düzgün yağış. Ne kadar süreceği saatlik tahminde okunur.",
  karma: "Karma yağış: geniş cephe yağışının içinde konvektif sağanak hücreleri var. Yağış şiddeti saatten saate hızlı değişebilir.",
  cise: "Çisenti: ince damlalı, düşük hacimli yağış. Gün boyu sürse de kısa bir yürüyüşte bile belirgin ıslanma yapmaz.",
  kar: "Kar yağışı: katı yağış. Hacim su eşdeğeri olarak (mm) verilir; zemin ve ayakkabı kısıtları kar kuralına göre uygulanır.",
  yok: "Pencerede ölçülebilir yağış yok.",
};

function metrik(baslik, deger, alt, ek) {
  return el("div", { class: "hv-metrik" }, el("span", { class: "hv-metrik-baslik", text: baslik }), el("strong", { text: deger }), alt ? el("small", { text: alt }) : null, ek || null);
}
const uzmanKart = (baslik, aciklama, ...c) => kart("hv-uzman-kart", bolumBasligi(baslik), aciklama ? ipucu(aciklama) : null, ...c);

/* ------------------------------ 1) CAPE ------------------------------ */
function capeKarti(d) {
  const f = d.fizik, cs = f.capeSeviye;
  const isaret = el("span", { class: "hv-skala-isaret", "aria-hidden": "true" });
  isaret.style.left = `${capeOrani(f.capeMax) * 100}%`;
  const skala = el("div", { class: "hv-skala" },
    el("div", { class: "hv-skala-seritler", role: "img", "aria-label": `CAPE ${f.capeMax} J/kg: ${cs.ad}` }, ...CAPE_BANTLARI.map((b) => el("span", { class: `hv-skala-bant ${b.sinif}${b.skor === cs.skor ? " aktif" : ""}` })), isaret),
    el("div", { class: "hv-skala-etiketler" }, ...CAPE_BANTLARI.map((b) => el("small", { text: b.alt === 0 ? "0" : b.alt >= 4000 ? "4000+" : String(b.alt) }))));
  const mx = 4000;
  const cubuklar = f.saatler.map((x) => { const b = el("span", { class: `hv-cape-cubuk ${capeSeviye(x.cape).sinif}`, title: `${saatMetniTam(x.saat)} · ${x.cape} J/kg` }); b.style.height = `${Math.max(4, Math.min(1, x.cape / mx) * 100)}%`; return b; });
  return uzmanKart("Atmosferik kararsızlık (CAPE)", "Havanın termodinamik patlama enerjisi: yükselen bir hava paketinin ne kadar ivmeleneceğini J/kg olarak ölçer. Yüksek değer, gök gürültülü fırtına ve dolu için yakıttır.",
    el("div", { class: "hv-buyuk-deger" }, el("strong", { text: String(f.capeMax) }), el("span", { text: " J/kg" }), rozet(cs.ad, "hv-rozet-onemli")),
    skala,
    el("p", { class: "hv-uzman-not", text: `Fırtına potansiyeli skoru ${cs.skor}/4. ${cs.aciklama}` }),
    f.capeMax > 0 ? el("small", { class: "hv-ipucu", text: `En yüksek değer ${f.gun === "yarın" ? "yarın " : ""}${saatMetniTam(f.capeSaat)} civarında.` }) : null,
    cubuklar.length ? el("div", { class: "hv-cape-seridi", role: "img", "aria-label": "Saatlik CAPE değerleri" }, ...cubuklar) : null);
}

/* ------------------------------ 2) yağışın fiziği ------------------------------ */
function fizikKarti(d) {
  const f = d.fizik;
  const topla = f.saganakToplam + f.yagmurToplam;
  const pay = topla > 0 ? f.saganakToplam / topla : 0;
  const konv = el("span", { class: "hv-pay-konv" }); konv.style.width = `${Math.round(pay * 100)}%`;
  return uzmanKart("Yağışın fiziği", "Aynı miktardaki yağış, nasıl oluştuğuna göre farklı giyim ve davranış ister.",
    el("div", { class: "hv-pay-kutu" },
      el("div", { class: "hv-pay", role: "img", "aria-label": `Konvektif yağış payı yüzde ${Math.round(pay * 100)}` }, konv),
      el("div", { class: "hv-pay-yazi" },
        el("span", {}, el("strong", { text: `${sayiMetni(f.saganakToplam)} mm` }), " konvektif sağanak (showers)"),
        el("span", {}, el("strong", { text: `${sayiMetni(f.yagmurToplam)} mm` }), " geniş cephe yağışı (large-scale rain)"))),
    el("p", { class: "hv-uzman-not", text: TUR_ACIKLAMA[f.tur] || TUR_ACIKLAMA.yok }));
}

/* ------------------------------ 3) beklenen efektif yağış + karar kuralları ------------------------------ */
function beklenenKarti(d) {
  const f = d.fizik;
  return uzmanKart("Beklenen efektif yağış ve karar kuralları", "E = PoP × P: olasılık ile saatlik hacmin çarpımı, her saat için hesaplanır ve toplanır. Şemsiye kararı tek başına olasılığa değil bu beklentiye bakar.",
    el("div", { class: "hv-formul" },
      el("div", {}, el("small", { text: "PoP (en yüksek)" }), el("strong", { text: `%${f.enYuksekPop}` })),
      el("span", { class: "hv-formul-isaret", "aria-hidden": "true", text: "×" }),
      el("div", {}, el("small", { text: "P (toplam hacim)" }), el("strong", { text: `${sayiMetni(f.toplamMm)} mm` })),
      el("span", { class: "hv-formul-isaret", "aria-hidden": "true", text: "→" }),
      el("div", { class: "vurgu" }, el("small", { text: "E (saatlik toplam)" }), el("strong", { text: `${sayiMetni(f.beklenenMm, 2)} mm` }))),
    el("small", { class: "hv-ipucu", text: `En yoğun saat: ${f.zirveSaat != null ? saatMetniTam(f.zirveSaat) : "—"} (${sayiMetni(f.zirveMm)} mm/sa). Pencere: ${f.gun === "yarın" ? "yarın 07:00–22:00" : "şimdiden 22:00'ye kadar"}.` }),
    el("div", { class: "hv-kurallar" }, ...f.kurallar.map((k) => el("div", { class: `hv-kural${k.tetik ? " tetik" : ""}` },
      el("div", { class: "hv-kural-ust" }, el("strong", { text: k.ad }), rozet(k.tetik ? "Tetiklendi" : "Tetiklenmedi", k.tetik ? "hv-rozet-onemli" : "")),
      el("small", { class: "hv-ipucu", text: `Koşul: ${k.kosul}` }),
      el("small", { text: k.ozet })))),
    f.sureklilik ? el("p", { class: "hv-uyari", text: `Birikim kuralı: tek tek saatler zararsız olsa da toplam ${sayiMetni(f.toplamMm)} mm ≥ 3 mm olduğu için seviye "sürekli yağmur"a yükseltildi.` }) : null);
}

/* ------------------------------ 4) mikro-iklim ------------------------------ */
const ozonSeviye = (o) => (o < 50 ? { ad: "Çok iyi", sinif: "d1" } : o < 100 ? { ad: "İyi", sinif: "d1" } : o < 130 ? { ad: "Orta", sinif: "d2" } : o < 240 ? { ad: "Kötü", sinif: "d3" } : { ad: "Çok kötü", sinif: "d5" });
function basincYorumu(f3) {
  if (f3 == null) return "—";
  return f3 <= -3 ? "hızlı düşüş: hava bozuyor" : f3 <= -1 ? "düşüyor" : f3 >= 3 ? "hızlı yükseliş: hava açıyor" : f3 >= 1 ? "yükseliyor" : "sabit";
}
function mikroKarti(d) {
  const h = d.hava, f = d.fizik, s0 = h.saatListe?.[0];
  const uv = uvSeviye(h.uv), aq = aqiSeviye(h.aqi);
  const hamleSinif = f.hamleMax > 55 ? "d5" : f.hamleMax > 40 ? "d4" : f.hamleMax > 28 ? "d3" : "d1";
  const oz = h.kalite?.ozon ? ozonSeviye(h.kalite.ozon) : null;
  return uzmanKart("Mikro-iklim parametreleri", "Kombini ve gün içi davranışı ince ayarlayan yerel değerler.",
    el("div", { class: "hv-detay-grid" },
      metrik("Rüzgâr hamlesi", `${f.hamleMax} km/s`, `Şimdi ${s0?.hamle ?? "—"} km/s · ortalama ${h.wind} km/s, ${ruzgarYonu(h.ruzgarYon)} yönünden${f.hamleMax > 40 ? " · şemsiye devre dışı" : ""}`, olcek(Math.min(1, f.hamleMax / 80), hamleSinif)),
      metrik("Çiğ noktası", `${h.cigNoktasi}°`, `${cigNoktasiKonfor(h.cigNoktasi)} · sıcaklıkla fark ${h.raw - h.cigNoktasi}° (fark küçülürse sis ve yoğuşma artar)`),
      metrik("Yüzey basıncı", `${h.basinc} hPa`, `3 sa: ${isaretli(h.basincFark3)} hPa · 12 sa: ${isaretli(h.basincFark12)} hPa · ${basincYorumu(h.basincFark3)}`),
      metrik("UV indeksi", `${h.uv}`, `${uv.ad} · ${uv.oneri}`, olcek(h.uv / 11, uv.sinif)),
      metrik("Yüzey ozonu", h.kalite?.ozon ? `${h.kalite.ozon} µg/m³` : "Veri yok", oz ? `${oz.ad} · zemin seviyesindeki ozon (stratosferik ozon tabakası değil)` : "Bu bölge için ölçüm yok", oz ? olcek(Math.min(1, h.kalite.ozon / 240), oz.sinif) : null),
      metrik("Nem ve bulut", `%${h.hum} · %${h.cloud}`, `${nemSeviye(h.hum)} · güneş ışınımı en çok ${h.rad} W/m²`),
      metrik("Görüş", h.gorus != null ? gorusSeviye(h.gorus) : "—", ""),
      metrik("Hava kalitesi", h.aqi != null ? `${h.aqi} · ${aq.ad}` : "Veri yok", h.kalite ? `PM2,5 ${h.kalite.pm25} · PM10 ${h.kalite.pm10} · toz ${h.kalite.dust} µg/m³` : "Bu bölge için ölçüm yok", h.aqi != null ? olcek(Math.min(1, h.aqi / 120), aq.sinif) : null)));
}

/* ------------------------------ 5) yalıtım (CLO) ------------------------------ */
function yalitimBlogu(d, kb) {
  const s = d.sonuc, no = Math.min(d.kombinNo, s.kombinler.length - 1), k = s.kombinler[no];
  const secici = el("div", { class: "hv-cipgrup", role: "group", "aria-label": "Kombin alternatifleri" },
    ...s.kombinler.map((x, i) => olay(el("button", { type: "button", class: "hv-cip-btn", "aria-pressed": String(i === no), text: x.ad }), "click", () => { d.kombinNo = i; kb.ciz(); })));
  return [
    uzmanKart("Yalıtım (CLO) bütçesi", "Hedef CLO = (33 − T_etkin) / 15 − aktivite. Seçilen parçaların toplamı: 0,10 + 0,85 × Σ parça CLO. Ana ekranda bu hesap gizlidir.",
      secici, cloBar(k, s), el("ul", { class: "hv-liste" }, ...s.neden.map((t) => el("li", { text: t })))),
    zamanPlaniKarti(s),
    tumOnerilerKarti(d, s),
  ];
}

/* ------------------------------ 6) 48 saatlik matris ------------------------------ */
const yalitimAdi = (c) => (c < 0.5 ? "çok ince" : c < 0.8 ? "ince" : c < 1.1 ? "orta" : c < 1.5 ? "kalın" : "çok kalın");
function matrisKarti(d) {
  const h = d.hava, sl = (h.saatListe || []).slice(0, 48);
  const td = (metin, sinif) => el("td", { class: sinif || null, text: metin });
  const govde = [];
  sl.forEach((x, i) => {
    if (i === 0 || x.saat === 0) govde.push(el("tr", { class: "hv-matris-gun" }, el("th", { colspan: 6, scope: "colgroup", text: i === 0 ? `Şimdi · ${gunAdi(x.t)}` : gunAdi(x.t) })));
    const a = saatAnaliz(x);
    const clo = hedefClo({ apparent: x.app, raw: x.temp, precip: x.yagis, hum: x.nem }, d.tercih.tol, d.tercih.sen).clo;
    govde.push(el("tr", { class: `s${a.seviye}` },
      el("th", { scope: "row", text: saatMetniTam(x.saat) }),
      td(TUR_AD[a.tur], a.tur === "yok" ? "sessiz" : ""),
      td(a.mm >= 0.05 ? `${sayiMetni(a.mm)} (E ${sayiMetni(a.E, 2)})` : "—", a.mm >= 0.05 ? "" : "sessiz"),
      td(String(a.cape), `cape ${capeSeviye(a.cape).sinif}`),
      td(`${a.hamle}`, a.hamle > 40 ? "hamle-yuksek" : ""),
      td(`${sayiMetni(clo, 2)} · ${yalitimAdi(clo)}`)));
  });
  const tablo = el("table", { class: "hv-matris" },
    el("thead", {}, el("tr", {}, ...["Saat", "Yağış türü", "mm (E = PoP×P)", "CAPE J/kg", "Hamle km/s", "Yalıtım ihtiyacı (CLO)"].map((t) => el("th", { scope: "col", text: t })))),
    el("tbody", {}, ...govde));
  return uzmanKart("48 saatlik saat saat matris", "Satır rengi yağış kademesini gösterir (kurak → sağanak). Yalıtım ihtiyacı, o saatin hissedilen sıcaklığı ve senin plan/tercihlerinle hesaplanır.",
    saatlikGrafik(sl.slice(0, 49)),
    ipucu("Çizgi: sıcaklık · kesikli: hissedilen · mavi çubuklar: yağış ihtimali"),
    el("div", { class: "hv-matris-kaydir", tabindex: "0", role: "region", "aria-label": "48 saatlik matris, yatay kaydırılabilir" }, tablo));
}

/* ------------------------------ sekme ------------------------------ */
export function derinSekmesi(d, kb) {
  if (!d.hava || !d.sonuc || !d.fizik) return kart("hv-bos", ipucu("Hava verisi yükleniyor…"));
  return el("div", { class: "hv-sekme-govde" },
    el("p", { class: "hv-uzman-giris", text: "Bu sayfa meteoroloji ve veri meraklıları içindir. Günlük karar ana ekranda; burada kararın arkasındaki sayılar var." }),
    capeKarti(d), fizikKarti(d), beklenenKarti(d), mikroKarti(d), ...yalitimBlogu(d, kb), matrisKarti(d));
}
